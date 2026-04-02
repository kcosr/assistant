package com.assistant.mobile.voice;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.util.HashMap;
import java.util.Map;

final class AssistantVoiceMicStreamer {
    private static final String TAG = "AssistantVoiceMicStreamer";

    interface Listener {
        void onStarted(int sampleRate, int channels, String encoding);
        void onChunk(byte[] chunk);
        void onStopped();
    }

    private static final class Token {
        private final String requestId;
        private final long sequence;

        private Token(String requestId, long sequence) {
            this.requestId = requestId;
            this.sequence = sequence;
        }
    }

    private static final class SessionState {
        private final Token token;
        private boolean stopRequested = false;

        private SessionState(Token token) {
            this.token = token;
        }
    }

    private static final class CaptureResources {
        private final Token token;
        private final AudioRecord audioRecord;
        private final boolean shouldUseCommunicationSource;
        private final Listener listener;
        private volatile Thread thread;

        private CaptureResources(
            Token token,
            AudioRecord audioRecord,
            boolean shouldUseCommunicationSource,
            Listener listener
        ) {
            this.token = token;
            this.audioRecord = audioRecord;
            this.shouldUseCommunicationSource = shouldUseCommunicationSource;
            this.listener = listener;
        }
    }

    private final Context context;
    private final AudioManager audioManager;
    private final Object gateLock = new Object();
    private final Object resourcesLock = new Object();
    private final Map<Long, SessionState> sessionsBySequence = new HashMap<>();
    private final Map<Long, CaptureResources> resourcesBySequence = new HashMap<>();
    private Long activeSequence = null;
    private long nextSequence = 1L;
    private Integer preferredDeviceId = null;

    AssistantVoiceMicStreamer(Context context) {
        this.context = context.getApplicationContext();
        this.audioManager = (AudioManager) this.context.getSystemService(Context.AUDIO_SERVICE);
    }

    void setPreferredDeviceId(String deviceId) {
        preferredDeviceId = parsePreferredDeviceId(deviceId);
    }

    boolean shouldUseCommunicationSourceForCurrentConfiguration() {
        AudioDeviceInfo preferredDevice = preferredDeviceId == null
            ? null
            : AssistantVoiceAudioDeviceUtils.findInputDevice(context, preferredDeviceId);
        return shouldUseCommunicationSource(preferredDevice);
    }

    boolean start(String requestId, Listener listener) {
        if (listener == null || requestId == null || requestId.trim().isEmpty()) {
            return false;
        }
        if (
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED
        ) {
            return false;
        }

        Token token = tryStartSession(requestId.trim());
        if (token == null) {
            return false;
        }

        final int sampleRate = 16000;
        final int channelConfig = AudioFormat.CHANNEL_IN_MONO;
        final int encoding = AudioFormat.ENCODING_PCM_16BIT;
        final AudioDeviceInfo preferredDevice = preferredDeviceId == null
            ? null
            : AssistantVoiceAudioDeviceUtils.findInputDevice(context, preferredDeviceId);
        final boolean shouldUseCommunicationSource = shouldUseCommunicationSource(preferredDevice);
        final int audioSource = shouldUseCommunicationSource
            ? MediaRecorder.AudioSource.VOICE_COMMUNICATION
            : MediaRecorder.AudioSource.VOICE_RECOGNITION;
        final int minBuffer = AudioRecord.getMinBufferSize(sampleRate, channelConfig, encoding);
        if (minBuffer <= 0) {
            finishSession(token);
            if (shouldUseCommunicationSource) {
                stopScoRouting();
            }
            return false;
        }

        if (shouldUseCommunicationSource) {
            startScoRouting();
        }

        final int bufferSize = Math.max(minBuffer, sampleRate / 5);
        final AudioRecord record = new AudioRecord(
            audioSource,
            sampleRate,
            channelConfig,
            encoding,
            bufferSize
        );
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
            record.release();
            finishSession(token);
            if (shouldUseCommunicationSource) {
                stopScoRouting();
            }
            return false;
        }

        if (preferredDevice != null) {
            try {
                boolean assigned = record.setPreferredDevice(preferredDevice);
                if (!assigned) {
                    Log.w(TAG, "preferred mic device was not applied: " + preferredDevice.getId());
                }
            } catch (Exception error) {
                Log.w(TAG, "failed to apply preferred mic device: " + preferredDevice.getId(), error);
            }
        }

        final CaptureResources resources = new CaptureResources(
            token,
            record,
            shouldUseCommunicationSource,
            listener
        );
        synchronized (resourcesLock) {
            resourcesBySequence.put(token.sequence, resources);
        }

        Thread thread = new Thread(
            () -> runCaptureLoop(token, resources, bufferSize),
            "assistant-voice-mic-" + token.requestId
        );
        thread.setDaemon(true);
        resources.thread = thread;
        synchronized (resourcesLock) {
            resourcesBySequence.put(token.sequence, resources);
        }
        thread.start();
        return true;
    }

    void stop(String requestId) {
        Token token = requestStop(requestId == null ? null : requestId.trim());
        if (token == null) {
            return;
        }

        CaptureResources resources;
        synchronized (resourcesLock) {
            resources = resourcesBySequence.get(token.sequence);
        }
        if (resources == null) {
            return;
        }

        Thread threadToJoin = resources.thread;
        if (threadToJoin != null && threadToJoin != Thread.currentThread()) {
            try {
                threadToJoin.join(600);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        }

        if (threadToJoin == null || !threadToJoin.isAlive()) {
            return;
        }

        Log.w(TAG, "force-stopping stuck capture thread requestId=" + token.requestId);
        try {
            resources.audioRecord.stop();
        } catch (Exception ignored) {
        }
        try {
            resources.audioRecord.release();
        } catch (Exception ignored) {
        }
        if (resources.shouldUseCommunicationSource) {
            stopScoRouting();
        }
        synchronized (resourcesLock) {
            resourcesBySequence.remove(token.sequence);
        }
        if (finishSession(token)) {
            try {
                resources.listener.onStopped();
            } catch (Exception ignored) {
            }
        }
    }

    void release() {
        stop(null);
    }

    private void runCaptureLoop(Token token, CaptureResources resources, int bufferSize) {
        byte[] buffer = new byte[Math.max(bufferSize, 4096)];
        try {
            resources.audioRecord.startRecording();
            resources.listener.onStarted(16000, 1, "pcm_s16le");
            while (shouldContinue(token)) {
                int read = resources.audioRecord.read(buffer, 0, buffer.length);
                if (read <= 0) {
                    Log.w(TAG, "mic capture read ended requestId=" + token.requestId + " count=" + read);
                    break;
                }
                byte[] chunk = new byte[read];
                System.arraycopy(buffer, 0, chunk, 0, read);
                resources.listener.onChunk(chunk);
            }
        } catch (Exception error) {
            Log.w(TAG, "mic capture failed requestId=" + token.requestId, error);
        } finally {
            finishCapture(resources);
        }
    }

    private boolean shouldUseCommunicationSource(AudioDeviceInfo preferredDevice) {
        if (audioManager == null) {
            return false;
        }
        if (preferredDevice != null) {
            return isBluetoothInputDevice(preferredDevice);
        }
        for (AudioDeviceInfo device : audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            if (isBluetoothInputDevice(device)) {
                return true;
            }
        }
        return false;
    }

    private static boolean isBluetoothInputDevice(AudioDeviceInfo device) {
        if (device == null) {
            return false;
        }
        return device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            || device.getType() == AudioDeviceInfo.TYPE_BLE_HEADSET;
    }

    private static Integer parsePreferredDeviceId(String deviceId) {
        if (deviceId == null) {
            return null;
        }
        String trimmed = deviceId.trim();
        if (trimmed.isEmpty()) {
            return null;
        }
        try {
            return Integer.parseInt(trimmed);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private void startScoRouting() {
        try {
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audioManager.setBluetoothScoOn(true);
            audioManager.startBluetoothSco();
        } catch (Exception error) {
            Log.w(TAG, "failed to start bluetooth SCO", error);
        }
    }

    private void stopScoRouting() {
        if (audioManager == null) {
            return;
        }
        try {
            audioManager.stopBluetoothSco();
            audioManager.setBluetoothScoOn(false);
            audioManager.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception ignored) {
        }
    }

    private Token tryStartSession(String requestId) {
        synchronized (gateLock) {
            if (activeSequence != null) {
                return null;
            }
            Token token = new Token(requestId, nextSequence);
            nextSequence += 1L;
            sessionsBySequence.put(token.sequence, new SessionState(token));
            activeSequence = token.sequence;
            return token;
        }
    }

    private Token requestStop(String requestId) {
        synchronized (gateLock) {
            SessionState session = getActiveSessionLocked();
            if (session == null) {
                return null;
            }
            if (requestId != null && !requestId.isEmpty() && !requestId.equals(session.token.requestId)) {
                return null;
            }
            session.stopRequested = true;
            return session.token;
        }
    }

    private boolean shouldContinue(Token token) {
        synchronized (gateLock) {
            SessionState session = sessionsBySequence.get(token.sequence);
            return session != null && activeSequence != null && activeSequence == token.sequence && !session.stopRequested;
        }
    }

    private boolean finishSession(Token token) {
        synchronized (gateLock) {
            SessionState removed = sessionsBySequence.remove(token.sequence);
            if (removed == null) {
                return false;
            }
            if (activeSequence != null && activeSequence == removed.token.sequence) {
                activeSequence = null;
            }
            return true;
        }
    }

    private SessionState getActiveSessionLocked() {
        if (activeSequence == null) {
            return null;
        }
        return sessionsBySequence.get(activeSequence);
    }

    private void finishCapture(CaptureResources resources) {
        try {
            resources.audioRecord.stop();
        } catch (Exception ignored) {
        }
        try {
            resources.audioRecord.release();
        } catch (Exception ignored) {
        }
        if (resources.shouldUseCommunicationSource) {
            stopScoRouting();
        }
        synchronized (resourcesLock) {
            resourcesBySequence.remove(resources.token.sequence);
        }
        if (finishSession(resources.token)) {
            try {
                resources.listener.onStopped();
            } catch (Exception ignored) {
            }
        }
    }
}
