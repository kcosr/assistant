package com.assistant.mobile.voice;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

/**
 * Single process-local coordinator for AudioManager mode, Bluetooth SCO, and audio focus.
 * Thread (PcmPlayer / MicStreamer) and future Realtime (WebRTC ADM) must route shared policy here.
 *
 * Device objects remain owner-specific (PcmPlayer tracks vs WebRTC ADM). This class only owns
 * mode / focus / SCO so two capture paths never fight global AudioManager state.
 */
final class AssistantVoiceAudioRouter {
    private static final String TAG = "AssistantVoiceAudioRouter";

    enum FocusKind {
        NONE,
        PLAYBACK,
        CAPTURE,
        REALTIME
    }

    interface FocusListener {
        void onFocusLost(long ownerGeneration, boolean permanent);
        void onFocusGained(long ownerGeneration);
        void onFocusCanDuck(long ownerGeneration);
    }

    private final AudioManager audioManager;
    private final Handler mainHandler;
    private final Object lock = new Object();

    private FocusListener focusListener;
    private long activeOwnerGeneration = 0L;
    private FocusKind focusKind = FocusKind.NONE;
    private boolean communicationModeActive = false;
    private boolean scoStarted = false;
    private boolean speakerphoneEnabled = false;
    private AudioFocusRequest playbackFocusRequest;
    private AudioFocusRequest captureFocusRequest;
    private AudioFocusRequest realtimeFocusRequest;

    AssistantVoiceAudioRouter(Context context) {
        Context app = context == null ? null : context.getApplicationContext();
        audioManager = app == null ? null : app.getSystemService(AudioManager.class);
        mainHandler = app == null ? null : new Handler(Looper.getMainLooper());
        buildFocusRequests();
    }

    void setFocusListener(FocusListener listener) {
        synchronized (lock) {
            focusListener = listener;
        }
    }

    long activeOwnerGeneration() {
        synchronized (lock) {
            return activeOwnerGeneration;
        }
    }

    FocusKind focusKind() {
        synchronized (lock) {
            return focusKind;
        }
    }

    boolean isCommunicationModeActive() {
        synchronized (lock) {
            return communicationModeActive;
        }
    }

    boolean isSpeakerphoneEnabled() {
        synchronized (lock) {
            return speakerphoneEnabled;
        }
    }

    boolean requestPlaybackFocus(long ownerGeneration) {
        synchronized (lock) {
            if (audioManager == null) {
                activeOwnerGeneration = ownerGeneration;
                focusKind = FocusKind.PLAYBACK;
                return true;
            }
            if (focusKind == FocusKind.PLAYBACK && activeOwnerGeneration == ownerGeneration) {
                return true;
            }
            abandonFocusLocked();
            activeOwnerGeneration = ownerGeneration;
            boolean granted = requestFocusLocked(playbackFocusRequest, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            focusKind = granted ? FocusKind.PLAYBACK : FocusKind.NONE;
            if (!granted) {
                activeOwnerGeneration = 0L;
            }
            return granted;
        }
    }

    boolean requestCaptureFocus(long ownerGeneration) {
        synchronized (lock) {
            if (audioManager == null) {
                activeOwnerGeneration = ownerGeneration;
                focusKind = FocusKind.CAPTURE;
                return true;
            }
            if (focusKind == FocusKind.CAPTURE && activeOwnerGeneration == ownerGeneration) {
                return true;
            }
            abandonFocusLocked();
            activeOwnerGeneration = ownerGeneration;
            boolean granted =
                requestFocusLocked(captureFocusRequest, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE);
            focusKind = granted ? FocusKind.CAPTURE : FocusKind.NONE;
            if (!granted) {
                activeOwnerGeneration = 0L;
            }
            return granted;
        }
    }

    boolean requestRealtimeFocus(long ownerGeneration) {
        synchronized (lock) {
            if (audioManager == null) {
                activeOwnerGeneration = ownerGeneration;
                focusKind = FocusKind.REALTIME;
                return true;
            }
            if (focusKind == FocusKind.REALTIME && activeOwnerGeneration == ownerGeneration) {
                return true;
            }
            abandonFocusLocked();
            activeOwnerGeneration = ownerGeneration;
            boolean granted =
                requestFocusLocked(realtimeFocusRequest, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            focusKind = granted ? FocusKind.REALTIME : FocusKind.NONE;
            if (!granted) {
                activeOwnerGeneration = 0L;
            }
            return granted;
        }
    }

    void abandonFocus(long ownerGeneration) {
        synchronized (lock) {
            if (ownerGeneration != 0L && ownerGeneration != activeOwnerGeneration) {
                return;
            }
            abandonFocusLocked();
        }
    }

    void enterCommunicationMode(long ownerGeneration) {
        enterCommunicationMode(ownerGeneration, false);
    }

    /**
     * @param preferSpeakerphone when true and no Bluetooth SCO headset is in use, force
     *     speakerphone so Realtime is audible at arm's length (not quiet earpiece).
     */
    void enterCommunicationMode(long ownerGeneration, boolean preferSpeakerphone) {
        synchronized (lock) {
            if (ownerGeneration != 0L) {
                activeOwnerGeneration = ownerGeneration;
            }
            if (audioManager == null) {
                return;
            }
            if (communicationModeActive) {
                // Keep SCO and speakerphone mutually exclusive if this is re-entered mid-call.
                applySpeakerphoneLocked(preferSpeakerphone && !scoStarted);
                return;
            }
            try {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                boolean useSco = shouldStartBluetoothScoLocked();
                if (useSco) {
                    audioManager.setBluetoothScoOn(true);
                    audioManager.startBluetoothSco();
                    scoStarted = true;
                    applySpeakerphoneLocked(false);
                } else {
                    scoStarted = false;
                    applySpeakerphoneLocked(preferSpeakerphone);
                }
                communicationModeActive = true;
            } catch (Exception error) {
                Log.w(TAG, "failed to enter communication mode", error);
            }
        }
    }

    /**
     * Only SCO/HFP (and BLE headset) devices can carry voice-call audio. A2DP is media-only and
     * must not suppress speakerphone or trigger a non-functional SCO session.
     */
    private boolean shouldStartBluetoothScoLocked() {
        if (audioManager == null) {
            return false;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return false;
        }
        try {
            for (android.media.AudioDeviceInfo device
                : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                int type = device.getType();
                if (type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                    || type == android.media.AudioDeviceInfo.TYPE_BLE_HEADSET) {
                    return true;
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "failed to inspect audio devices for SCO", error);
        }
        return false;
    }

    private void applySpeakerphoneLocked(boolean enabled) {
        if (audioManager == null) {
            return;
        }
        try {
            audioManager.setSpeakerphoneOn(enabled);
            speakerphoneEnabled = enabled;
        } catch (Exception error) {
            Log.w(TAG, "failed to set speakerphone=" + enabled, error);
        }
    }

    void leaveCommunicationMode(long ownerGeneration) {
        synchronized (lock) {
            if (ownerGeneration != 0L
                && activeOwnerGeneration != 0L
                && ownerGeneration != activeOwnerGeneration) {
                return;
            }
            leaveCommunicationModeLocked();
        }
    }

    /**
     * Thread → Realtime / full release order:
     * leave SCO + MODE_NORMAL, abandon focus. Caller advances generation after quiescence.
     */
    void releaseAll(long ownerGeneration) {
        synchronized (lock) {
            if (ownerGeneration != 0L
                && activeOwnerGeneration != 0L
                && ownerGeneration != activeOwnerGeneration) {
                return;
            }
            leaveCommunicationModeLocked();
            abandonFocusLocked();
        }
    }

    void shutdown() {
        synchronized (lock) {
            leaveCommunicationModeLocked();
            abandonFocusLocked();
            focusListener = null;
        }
    }

    private void buildFocusRequests() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || audioManager == null || mainHandler == null) {
            playbackFocusRequest = null;
            captureFocusRequest = null;
            realtimeFocusRequest = null;
            return;
        }
        AudioManager.OnAudioFocusChangeListener listener = this::dispatchFocusChange;
        playbackFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(listener, mainHandler)
            .build();
        captureFocusRequest =
            new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
                .setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .setWillPauseWhenDucked(true)
                .setOnAudioFocusChangeListener(listener, mainHandler)
                .build();
        // Realtime / in-call arming cues share voice-comm usage so they do not fight the call.
        realtimeFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setWillPauseWhenDucked(true)
            .setOnAudioFocusChangeListener(listener, mainHandler)
            .build();
    }

    private void dispatchFocusChange(int change) {
        long generation;
        FocusListener listener;
        synchronized (lock) {
            generation = activeOwnerGeneration;
            listener = focusListener;
        }
        if (listener == null || generation == 0L) {
            return;
        }
        switch (change) {
            case AudioManager.AUDIOFOCUS_LOSS:
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT:
                listener.onFocusLost(generation, change == AudioManager.AUDIOFOCUS_LOSS);
                break;
            case AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK:
                listener.onFocusCanDuck(generation);
                break;
            case AudioManager.AUDIOFOCUS_GAIN:
                listener.onFocusGained(generation);
                break;
            default:
                break;
        }
    }

    private boolean requestFocusLocked(AudioFocusRequest request, int legacyFocusGain) {
        if (audioManager == null) {
            return true;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && request != null) {
                return audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
            }
            @SuppressWarnings("deprecation")
            int result = audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_MUSIC,
                legacyFocusGain
            );
            return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        } catch (Exception error) {
            Log.w(TAG, "requestAudioFocus failed", error);
            return false;
        }
    }

    private void abandonFocusLocked() {
        if (audioManager == null) {
            focusKind = FocusKind.NONE;
            activeOwnerGeneration = 0L;
            return;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusKind == FocusKind.PLAYBACK && playbackFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest(playbackFocusRequest);
                } else if (focusKind == FocusKind.CAPTURE && captureFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest(captureFocusRequest);
                } else if (focusKind == FocusKind.REALTIME && realtimeFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest(realtimeFocusRequest);
                }
            } else {
                @SuppressWarnings("deprecation")
                int ignored = audioManager.abandonAudioFocus(null);
            }
        } catch (Exception error) {
            Log.w(TAG, "abandonAudioFocus failed", error);
        }
        focusKind = FocusKind.NONE;
        activeOwnerGeneration = 0L;
    }

    private void leaveCommunicationModeLocked() {
        if (audioManager == null) {
            communicationModeActive = false;
            scoStarted = false;
            speakerphoneEnabled = false;
            return;
        }
        if (!communicationModeActive && !scoStarted && !speakerphoneEnabled) {
            return;
        }
        try {
            if (scoStarted) {
                audioManager.stopBluetoothSco();
                audioManager.setBluetoothScoOn(false);
            }
            if (speakerphoneEnabled) {
                audioManager.setSpeakerphoneOn(false);
            }
            audioManager.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception error) {
            Log.w(TAG, "failed to leave communication mode", error);
        }
        scoStarted = false;
        speakerphoneEnabled = false;
        communicationModeActive = false;
    }
}
