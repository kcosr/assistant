package com.assistant.mobile.voice;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class AssistantVoicePcmPlayer {
    enum RecognitionCueType {
        ARMING,
        SUCCESS_COMPLETION,
        FAILURE_COMPLETION,
    }

    private static final int DEFAULT_PLAYBACK_SAMPLE_RATE = 24000;
    private static final int DEFAULT_CUE_OUTPUT_SAMPLE_RATE = 48000;
    private static final int MIN_CUE_OUTPUT_SAMPLE_RATE = 16000;
    private static final int MAX_CUE_OUTPUT_SAMPLE_RATE = 48000;
    private static final int DEFAULT_STARTUP_PRE_ROLL_MS =
        AssistantVoiceConfig.DEFAULT_STARTUP_PRE_ROLL_MS;
    private static final long PLAYBACK_FOCUS_RELEASE_DELAY_MS = 1400L;
    private static final long RECOGNITION_CUE_POST_WRITE_CHECK_DELAY_MS = 220L;
    private static final int MAX_RECOGNITION_CUE_REPLAY_ATTEMPTS = 1;
    private static final int RECOGNITION_CUE_FADE_WINDOW_DIVISOR = 80;
    private static final int RECOGNITION_CUE_MIN_FADE_SAMPLES = 12;
    private static final byte[] ARMING_RECOGNITION_CUE_PCM =
        generateRecognitionCuePcmData(
            DEFAULT_CUE_OUTPUT_SAMPLE_RATE,
            RecognitionCueType.ARMING
        );
    private static final byte[] SUCCESS_COMPLETION_RECOGNITION_CUE_PCM =
        generateRecognitionCuePcmData(
            DEFAULT_CUE_OUTPUT_SAMPLE_RATE,
            RecognitionCueType.SUCCESS_COMPLETION
        );
    private static final byte[] FAILURE_COMPLETION_RECOGNITION_CUE_PCM =
        generateRecognitionCuePcmData(
            DEFAULT_CUE_OUTPUT_SAMPLE_RATE,
            RecognitionCueType.FAILURE_COMPLETION
        );

    interface Listener {
        void onPlaybackDrained(String requestId);
    }

    private enum FocusMode {
        NONE,
        PLAYBACK,
        CAPTURE,
    }

    private final Object lock = new Object();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AudioManager audioManager;
    private final Handler mainHandler;
    private AudioTrack audioTrack;
    private final Runnable abandonPlaybackFocusRunnable = this::releasePlaybackFocusIfIdle;
    private final AudioManager.OnAudioFocusChangeListener focusChangeListener = change -> {
        synchronized (lock) {
            if (audioTrack == null) {
                return;
            }
            if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                try {
                    audioTrack.setVolume(0.35f);
                } catch (Exception ignored) {
                }
                return;
            }
            if (change == AudioManager.AUDIOFOCUS_GAIN) {
                try {
                    audioTrack.setVolume(1f);
                } catch (Exception ignored) {
                }
            }
        }
    };
    private final AudioFocusRequest playbackFocusRequest;
    private final AudioFocusRequest captureFocusRequest;

    private Listener listener;
    private String activeRequestId = "";
    private int activeSampleRate = 0;
    private float ttsGain = AssistantVoiceConfig.DEFAULT_TTS_GAIN;
    private float recognitionCueGain = AssistantVoiceConfig.DEFAULT_RECOGNITION_CUE_GAIN;
    private int startupPreRollMs = DEFAULT_STARTUP_PRE_ROLL_MS;
    private boolean streamEnded = false;
    private int pendingWrites = 0;
    private int framesWritten = 0;
    private long generation = 0L;
    private FocusMode focusMode = FocusMode.NONE;

    AssistantVoicePcmPlayer(Context context) {
        Context appContext = context == null ? null : context.getApplicationContext();
        audioManager = appContext == null ? null : appContext.getSystemService(AudioManager.class);
        mainHandler =
            appContext == null
                ? null
                : new Handler(Looper.getMainLooper());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioManager != null && mainHandler != null) {
            playbackFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
                .build();
            captureFocusRequest = new AudioFocusRequest.Builder(
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
            )
                .setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(focusChangeListener, mainHandler)
                .build();
        } else {
            playbackFocusRequest = null;
            captureFocusRequest = null;
        }
    }

    void setListener(Listener listener) {
        synchronized (lock) {
            this.listener = listener;
        }
    }

    void setTtsGain(float gain) {
        synchronized (lock) {
            ttsGain = normalizeTtsGain(gain);
        }
    }

    void setRecognitionCueGain(float gain) {
        synchronized (lock) {
            recognitionCueGain = AssistantVoiceConfig.clampRecognitionCueGain(gain);
        }
    }

    void setStartupPreRollMs(int value) {
        synchronized (lock) {
            startupPreRollMs = Math.max(
                AssistantVoiceConfig.MIN_STARTUP_PRE_ROLL_MS,
                Math.min(AssistantVoiceConfig.MAX_STARTUP_PRE_ROLL_MS, value)
            );
        }
    }

    boolean beginRecognitionCaptureFocus() {
        synchronized (lock) {
            if (audioManager == null) {
                return true;
            }
            cancelPendingPlaybackFocusReleaseLocked();
            if (focusMode == FocusMode.CAPTURE) {
                return true;
            }
            if (focusMode == FocusMode.PLAYBACK) {
                abandonPlaybackFocusLocked();
            }
            boolean granted = requestCaptureFocusLocked();
            if (!granted) {
                focusMode = FocusMode.NONE;
            }
            return granted;
        }
    }

    void endRecognitionCaptureFocus() {
        synchronized (lock) {
            if (focusMode != FocusMode.CAPTURE) {
                return;
            }
            abandonCaptureFocusLocked();
        }
    }

    void startStream(String requestId) {
        synchronized (lock) {
            generation += 1L;
            activeRequestId = requestId == null ? "" : requestId.trim();
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
        }
    }

    void enqueueChunk(String requestId, String chunkBase64, int sampleRate) {
        final byte[] chunk;
        try {
            chunk = Base64.decode(chunkBase64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            return;
        }
        if (chunk.length == 0) {
            return;
        }

        final long taskGeneration;
        synchronized (lock) {
            if (!matchesActiveRequestLocked(requestId)) {
                return;
            }
            pendingWrites += 1;
            taskGeneration = generation;
        }

        executor.execute(() -> writeChunk(taskGeneration, requestId, chunk, sampleRate));
    }

    void finishStream(String requestId) {
        synchronized (lock) {
            if (!matchesActiveRequestLocked(requestId)) {
                return;
            }
            streamEnded = true;
            maybeCompletePlaybackLocked();
        }
    }

    void stop() {
        synchronized (lock) {
            generation += 1L;
            activeRequestId = "";
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
        }
    }

    void release() {
        synchronized (lock) {
            cancelPendingPlaybackFocusReleaseLocked();
        }
        stop();
        synchronized (lock) {
            abandonPlaybackFocusLocked();
            abandonCaptureFocusLocked();
        }
        executor.shutdownNow();
    }

    boolean playRecognitionCue(String requestId, RecognitionCueType cueType) {
        byte[] adjustedCue;
        int outputRate;
        long taskGeneration;
        synchronized (lock) {
            if (!requestPlaybackFocusIfNeededLocked()) {
                return false;
            }
            generation += 1L;
            activeRequestId = requestId == null ? "" : requestId.trim();
            activeSampleRate = 0;
            streamEnded = true;
            pendingWrites = 1;
            framesWritten = 0;
            releaseTrackLocked();
            outputRate = resolveCueOutputSampleRateLocked();
            if (ensureTrackLocked(outputRate) == null) {
                activeRequestId = "";
                streamEnded = false;
                pendingWrites = 0;
                schedulePlaybackFocusReleaseLocked();
                return false;
            }
            adjustedCue = buildRecognitionCueBytes(
                outputRate,
                cueType,
                resolveRecognitionCueGain(recognitionCueGain),
                startupPreRollMs
            );
            taskGeneration = generation;
        }

        executor.execute(
            () -> writeRecognitionCue(taskGeneration, cueType, adjustedCue, outputRate, 0)
        );
        return true;
    }

    private void writeChunk(long taskGeneration, String requestId, byte[] chunk, int sampleRate) {
        AudioTrack track;
        float chunkGain;
        synchronized (lock) {
            if (taskGeneration != generation || !matchesActiveRequestLocked(requestId)) {
                pendingWrites = Math.max(0, pendingWrites - 1);
                return;
            }
            track = ensureTrackLocked(sampleRate);
            chunkGain = ttsGain;
            if (track == null) {
                pendingWrites = Math.max(0, pendingWrites - 1);
                maybeCompletePlaybackLocked();
                return;
            }
        }

        byte[] adjustedChunk = applySoftwareGainPcm16(chunk, chunkGain);
        int bytesWritten = writePcm(track, adjustedChunk);

        synchronized (lock) {
            if (taskGeneration == generation && matchesActiveRequestLocked(requestId)) {
                framesWritten += bytesWritten / 2;
            }
            pendingWrites = Math.max(0, pendingWrites - 1);
            maybeCompletePlaybackLocked();
        }
    }

    static float normalizeTtsGain(float gain) {
        if (!Float.isFinite(gain) || gain <= 0f) {
            return AssistantVoiceConfig.DEFAULT_TTS_GAIN;
        }
        if (gain < AssistantVoiceConfig.MIN_TTS_GAIN) {
            return AssistantVoiceConfig.MIN_TTS_GAIN;
        }
        if (gain > AssistantVoiceConfig.MAX_TTS_GAIN) {
            return AssistantVoiceConfig.MAX_TTS_GAIN;
        }
        return gain;
    }

    static float resolveRecognitionCueGain(float gain) {
        float normalized = (
            AssistantVoiceConfig.clampRecognitionCueGain(gain)
                - AssistantVoiceConfig.MIN_RECOGNITION_CUE_GAIN
        ) / (
            AssistantVoiceConfig.MAX_RECOGNITION_CUE_GAIN
                - AssistantVoiceConfig.MIN_RECOGNITION_CUE_GAIN
        );
        double cueGainDb = -16.0d + (normalized * 28.0d);
        return (float) Math.max(
            0.15d,
            Math.min(4.0d, Math.pow(10.0d, cueGainDb / 20.0d))
        );
    }

    static int resolveCueOutputSampleRate(String rawSampleRate) {
        if (rawSampleRate == null || rawSampleRate.trim().isEmpty()) {
            return DEFAULT_CUE_OUTPUT_SAMPLE_RATE;
        }
        try {
            return Math.max(
                MIN_CUE_OUTPUT_SAMPLE_RATE,
                Math.min(MAX_CUE_OUTPUT_SAMPLE_RATE, Integer.parseInt(rawSampleRate.trim()))
            );
        } catch (NumberFormatException ignored) {
            return DEFAULT_CUE_OUTPUT_SAMPLE_RATE;
        }
    }

    static byte[] buildRecognitionCuePrerollPcm(int sampleRate, int startupPreRollMs) {
        if (sampleRate <= 0 || startupPreRollMs <= 0) {
            return new byte[0];
        }
        long sampleCount = (sampleRate * (long) startupPreRollMs) / 1000L;
        if (sampleCount <= 0L) {
            return new byte[0];
        }
        return new byte[(int) Math.min(Integer.MAX_VALUE, sampleCount * 2L)];
    }

    static byte[] applySoftwareGainPcm16(byte[] input, float gain) {
        if (input == null || input.length == 0) {
            return new byte[0];
        }

        float normalizedGain = normalizeTtsGain(gain);
        if (Math.abs(normalizedGain - 1f) < 0.001f) {
            return input;
        }

        byte[] output = input.clone();
        int index = 0;
        while (index + 1 < output.length) {
            int low = output[index] & 0xFF;
            int high = output[index + 1];
            int sample = (high << 8) | low;
            int scaled = Math.max(
                Short.MIN_VALUE,
                Math.min(Short.MAX_VALUE, (int) (sample * normalizedGain))
            );
            output[index] = (byte) (scaled & 0xFF);
            output[index + 1] = (byte) ((scaled >> 8) & 0xFF);
            index += 2;
        }
        return output;
    }

    static byte[] generateRecognitionCuePcmData(
        int sampleRate,
        RecognitionCueType cueType
    ) {
        if (sampleRate <= 0) {
            return new byte[0];
        }

        CueSegment[] segments;
        switch (cueType) {
            case SUCCESS_COMPLETION:
                segments = new CueSegment[] {
                    new CueSegment(523.25d, 1046.50d, 140, 0.16f),
                };
                break;
            case FAILURE_COMPLETION:
                segments = new CueSegment[] {
                    new CueSegment(659.25d, 105, 0.14f),
                    new CueSegment(0.0d, 55, 0.0f),
                    new CueSegment(493.88d, 140, 0.16f),
                };
                break;
            case ARMING:
            default:
                segments = new CueSegment[] {
                    new CueSegment(523.25d, 95, 0.14f),
                    new CueSegment(0.0d, 55, 0.0f),
                    new CueSegment(659.25d, 140, 0.16f),
                };
                break;
        }

        int totalSamples = 0;
        for (CueSegment segment : segments) {
            totalSamples += (sampleRate * segment.durationMs) / 1000;
        }

        byte[] pcm = new byte[totalSamples * 2];
        int sampleOffset = 0;
        for (CueSegment segment : segments) {
            int segmentSamples = (sampleRate * segment.durationMs) / 1000;
            int fadeWindow = Math.max(
                sampleRate / RECOGNITION_CUE_FADE_WINDOW_DIVISOR,
                RECOGNITION_CUE_MIN_FADE_SAMPLES
            );
            for (int index = 0; index < segmentSamples; index += 1) {
                float fadeIn = clamp01(index / (float) fadeWindow);
                float fadeOut = clamp01((segmentSamples - index) / (float) fadeWindow);
                float envelope = Math.min(fadeIn, fadeOut);
                double value = 0.0d;
                if (segment.frequencyHz > 0.0d && segment.amplitude > 0f) {
                    double phase = (2.0d * Math.PI * segment.frequencyHz * index) / sampleRate;
                    value = Math.sin(phase);
                    if (segment.secondaryFrequencyHz > 0.0d) {
                        double secondaryPhase =
                            (2.0d * Math.PI * segment.secondaryFrequencyHz * index) /
                            sampleRate;
                        value = (value + Math.sin(secondaryPhase)) * 0.5d;
                    }
                    value *= Short.MAX_VALUE * segment.amplitude * envelope;
                }
                int sample = Math.max(
                    Short.MIN_VALUE,
                    Math.min(Short.MAX_VALUE, (int) value)
                );
                int byteIndex = (sampleOffset + index) * 2;
                pcm[byteIndex] = (byte) (sample & 0xFF);
                pcm[byteIndex + 1] = (byte) ((sample >> 8) & 0xFF);
            }
            sampleOffset += segmentSamples;
        }
        return pcm;
    }

    private byte[] buildRecognitionCueBytes(
        int sampleRate,
        RecognitionCueType cueType,
        float gain,
        int startupPreRollMs
    ) {
        byte[] baseCue = resolveRecognitionCueBasePcm(sampleRate, cueType);
        byte[] adjustedCue = applySoftwareGainPcm16(baseCue, gain);
        byte[] preroll = buildRecognitionCuePrerollPcm(sampleRate, startupPreRollMs);
        if (preroll.length == 0) {
            return adjustedCue;
        }
        byte[] combined = new byte[preroll.length + adjustedCue.length];
        System.arraycopy(preroll, 0, combined, 0, preroll.length);
        System.arraycopy(adjustedCue, 0, combined, preroll.length, adjustedCue.length);
        return combined;
    }

    private static byte[] resolveRecognitionCueBasePcm(
        int sampleRate,
        RecognitionCueType cueType
    ) {
        if (sampleRate == DEFAULT_CUE_OUTPUT_SAMPLE_RATE) {
            switch (cueType) {
                case SUCCESS_COMPLETION:
                    return SUCCESS_COMPLETION_RECOGNITION_CUE_PCM;
                case FAILURE_COMPLETION:
                    return FAILURE_COMPLETION_RECOGNITION_CUE_PCM;
                case ARMING:
                default:
                    return ARMING_RECOGNITION_CUE_PCM;
            }
        }
        return generateRecognitionCuePcmData(sampleRate, cueType);
    }

    private void writeRecognitionCue(
        long taskGeneration,
        RecognitionCueType cueType,
        byte[] cuePcm,
        int outputRate,
        int replayAttempt
    ) {
        AudioTrack track;
        synchronized (lock) {
            if (taskGeneration != generation || audioTrack == null) {
                schedulePlaybackFocusReleaseLocked();
                return;
            }
            track = audioTrack;
        }
        int bytesWritten = writePcm(track, cuePcm);
        synchronized (lock) {
            if (taskGeneration != generation) {
                schedulePlaybackFocusReleaseLocked();
                return;
            }
            if (bytesWritten > 0) {
                framesWritten += bytesWritten / 2;
            }
            pendingWrites = Math.max(0, pendingWrites - 1);
            maybeCompletePlaybackLocked();
            schedulePlaybackFocusReleaseLocked();
            if (bytesWritten <= 0) {
                return;
            }
            scheduleRecognitionCueReplayCheckLocked(
                taskGeneration,
                cueType,
                outputRate,
                replayAttempt
            );
        }
    }

    private void scheduleRecognitionCueReplayCheckLocked(
        long taskGeneration,
        RecognitionCueType cueType,
        int outputRate,
        int replayAttempt
    ) {
        if (mainHandler == null || replayAttempt >= MAX_RECOGNITION_CUE_REPLAY_ATTEMPTS) {
            return;
        }
        mainHandler.postDelayed(
            () -> {
                byte[] replayCue = null;
                synchronized (lock) {
                    if (taskGeneration != generation || audioTrack == null) {
                        return;
                    }
                    if (audioTrack.getPlaybackHeadPosition() > 0) {
                        return;
                    }
                    releaseTrackLocked();
                    framesWritten = 0;
                    pendingWrites = 1;
                    streamEnded = true;
                    if (ensureTrackLocked(outputRate) == null) {
                        pendingWrites = 0;
                        streamEnded = false;
                        schedulePlaybackFocusReleaseLocked();
                        return;
                    }
                    replayCue = buildRecognitionCueBytes(
                        outputRate,
                        cueType,
                        resolveRecognitionCueGain(recognitionCueGain),
                        startupPreRollMs
                    );
                }
                byte[] cueForReplay = replayCue;
                if (cueForReplay != null) {
                    executor.execute(() -> writeRecognitionCue(
                        taskGeneration,
                        cueType,
                        cueForReplay,
                        outputRate,
                        replayAttempt + 1
                    ));
                }
            },
            RECOGNITION_CUE_POST_WRITE_CHECK_DELAY_MS
        );
    }

    private static int writePcm(AudioTrack track, byte[] pcm) {
        int offset = 0;
        while (offset < pcm.length) {
            int written;
            try {
                written = track.write(pcm, offset, pcm.length - offset);
            } catch (Exception error) {
                break;
            }
            if (written <= 0) {
                break;
            }
            offset += written;
        }
        return offset;
    }

    private AudioTrack ensureTrackLocked(int sampleRate) {
        int normalizedRate = sampleRate > 0 ? sampleRate : DEFAULT_PLAYBACK_SAMPLE_RATE;
        if (audioTrack != null && activeSampleRate == normalizedRate) {
            return audioTrack;
        }

        releaseTrackLocked();
        int minBuffer = AudioTrack.getMinBufferSize(
            normalizedRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuffer <= 0) {
            return null;
        }

        AudioTrack track = new AudioTrack.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                new AudioFormat.Builder()
                    .setSampleRate(normalizedRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(Math.max(minBuffer, normalizedRate / 2))
            .build();
        track.setPlaybackPositionUpdateListener(new AudioTrack.OnPlaybackPositionUpdateListener() {
            @Override
            public void onMarkerReached(AudioTrack track) {
                Listener currentListener;
                String requestIdForCallback;
                synchronized (lock) {
                    if (audioTrack != track || activeRequestId.isEmpty()) {
                        return;
                    }
                    currentListener = listener;
                    requestIdForCallback = activeRequestId;
                    generation += 1L;
                    activeRequestId = "";
                    activeSampleRate = 0;
                    streamEnded = false;
                    pendingWrites = 0;
                    framesWritten = 0;
                    releaseTrackLocked();
                }
                if (currentListener != null) {
                    currentListener.onPlaybackDrained(requestIdForCallback);
                }
            }

            @Override
            public void onPeriodicNotification(AudioTrack track) {
            }
        });
        track.play();
        audioTrack = track;
        activeSampleRate = normalizedRate;
        return audioTrack;
    }

    private void maybeCompletePlaybackLocked() {
        if (!streamEnded || pendingWrites > 0) {
            return;
        }
        if (activeRequestId.isEmpty()) {
            return;
        }
        if (framesWritten <= 0 || audioTrack == null) {
            Listener currentListener = listener;
            String requestIdForCallback = activeRequestId;
            generation += 1L;
            activeRequestId = "";
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
            if (currentListener != null) {
                currentListener.onPlaybackDrained(requestIdForCallback);
            }
            return;
        }

        try {
            audioTrack.setNotificationMarkerPosition(framesWritten);
        } catch (IllegalStateException ignored) {
            Listener currentListener = listener;
            String requestIdForCallback = activeRequestId;
            generation += 1L;
            activeRequestId = "";
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
            if (currentListener != null) {
                currentListener.onPlaybackDrained(requestIdForCallback);
            }
        }
    }

    private int resolveCueOutputSampleRateLocked() {
        if (audioManager == null) {
            return DEFAULT_CUE_OUTPUT_SAMPLE_RATE;
        }
        return resolveCueOutputSampleRate(
            audioManager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)
        );
    }

    private boolean requestPlaybackFocusIfNeededLocked() {
        if (audioManager == null) {
            return true;
        }
        cancelPendingPlaybackFocusReleaseLocked();
        if (focusMode == FocusMode.PLAYBACK) {
            return true;
        }
        if (focusMode == FocusMode.CAPTURE) {
            abandonCaptureFocusLocked();
        }
        boolean granted = requestPlaybackFocusLocked();
        if (!granted) {
            focusMode = FocusMode.NONE;
        }
        return granted;
    }

    private boolean requestPlaybackFocusLocked() {
        if (audioManager == null) {
            return true;
        }
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && playbackFocusRequest != null) {
            result = audioManager.requestAudioFocus(playbackFocusRequest);
        } else {
            result = audioManager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            );
        }
        boolean granted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        if (granted) {
            focusMode = FocusMode.PLAYBACK;
        }
        return granted;
    }

    private boolean requestCaptureFocusLocked() {
        if (audioManager == null) {
            return true;
        }
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && captureFocusRequest != null) {
            result = audioManager.requestAudioFocus(captureFocusRequest);
        } else {
            result = audioManager.requestAudioFocus(
                focusChangeListener,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
            );
        }
        boolean granted = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        if (granted) {
            focusMode = FocusMode.CAPTURE;
        }
        return granted;
    }

    private void abandonPlaybackFocusLocked() {
        if (audioManager == null || focusMode != FocusMode.PLAYBACK) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && playbackFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(playbackFocusRequest);
        } else {
            audioManager.abandonAudioFocus(focusChangeListener);
        }
        focusMode = FocusMode.NONE;
    }

    private void abandonCaptureFocusLocked() {
        if (audioManager == null || focusMode != FocusMode.CAPTURE) {
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && captureFocusRequest != null) {
            audioManager.abandonAudioFocusRequest(captureFocusRequest);
        } else {
            audioManager.abandonAudioFocus(focusChangeListener);
        }
        focusMode = FocusMode.NONE;
    }

    private void releasePlaybackFocusIfIdle() {
        synchronized (lock) {
            if (focusMode != FocusMode.PLAYBACK || activeRequestId.length() > 0) {
                return;
            }
            abandonPlaybackFocusLocked();
        }
    }

    private void schedulePlaybackFocusReleaseLocked() {
        if (mainHandler == null || focusMode != FocusMode.PLAYBACK) {
            return;
        }
        mainHandler.removeCallbacks(abandonPlaybackFocusRunnable);
        mainHandler.postDelayed(abandonPlaybackFocusRunnable, PLAYBACK_FOCUS_RELEASE_DELAY_MS);
    }

    private void cancelPendingPlaybackFocusReleaseLocked() {
        if (mainHandler == null) {
            return;
        }
        mainHandler.removeCallbacks(abandonPlaybackFocusRunnable);
    }

    private boolean matchesActiveRequestLocked(String requestId) {
        return requestId != null && requestId.trim().equals(activeRequestId);
    }

    private static float clamp01(float value) {
        if (value < 0f) {
            return 0f;
        }
        if (value > 1f) {
            return 1f;
        }
        return value;
    }

    private void releaseTrackLocked() {
        if (audioTrack == null) {
            return;
        }
        try {
            audioTrack.pause();
        } catch (Exception ignored) {
        }
        try {
            audioTrack.flush();
        } catch (Exception ignored) {
        }
        try {
            audioTrack.release();
        } catch (Exception ignored) {
        }
        audioTrack = null;
    }

    private static final class CueSegment {
        final double frequencyHz;
        final double secondaryFrequencyHz;
        final int durationMs;
        final float amplitude;

        CueSegment(double frequencyHz, int durationMs, float amplitude) {
            this(frequencyHz, 0.0d, durationMs, amplitude);
        }

        CueSegment(
            double frequencyHz,
            double secondaryFrequencyHz,
            int durationMs,
            float amplitude
        ) {
            this.frequencyHz = frequencyHz;
            this.secondaryFrequencyHz = secondaryFrequencyHz;
            this.durationMs = durationMs;
            this.amplitude = amplitude;
        }
    }
}
