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
    /** True when we called {@link AudioManager#setCommunicationDevice} this session. */
    private boolean communicationDeviceSet = false;
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
     * @param preferSpeakerphone when true and no Bluetooth voice headset is available, force
     *     the built-in loudspeaker so Realtime is audible at arm's length (not quiet earpiece).
     *     Real HFP/SCO/BLE headsets always win over speakerphone.
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
                // Keep SCO/BT voice and speakerphone mutually exclusive if re-entered mid-call.
                if (!scoStarted && !isBluetoothCommunicationRouteActiveLocked()) {
                    applySpeakerphoneLocked(preferSpeakerphone);
                }
                return;
            }
            try {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                applyCommunicationRouteLocked(preferSpeakerphone, ownerGeneration);
                communicationModeActive = true;
            } catch (Exception error) {
                Log.w(TAG, "failed to enter communication mode", error);
            }
        }
    }

    /**
     * Route priority after {@link AudioManager#MODE_IN_COMMUNICATION}:
     * <ol>
     *   <li>Bluetooth voice (SCO / BLE headset) via {@code setCommunicationDevice} + SCO start</li>
     *   <li>Built-in speaker when {@code preferSpeakerphone}</li>
     *   <li>Default earpiece</li>
     * </ol>
     * Pure A2DP media speakers are not communication devices and do not take priority over
     * speakerphone. Dual-profile call headsets often only expose SCO after mode is set — use
     * {@link AudioManager#getAvailableCommunicationDevices()} rather than treating A2DP alone
     * as a voice headset.
     */
    private void applyCommunicationRouteLocked(boolean preferSpeakerphone, long ownerGeneration) {
        android.media.AudioDeviceInfo bluetoothComm = findBluetoothCommunicationDeviceLocked();
        if (bluetoothComm != null) {
            Log.d(
                TAG,
                "enterCommunicationMode route=bluetooth type="
                    + bluetoothComm.getType()
                    + " gen="
                    + ownerGeneration
            );
            routeToBluetoothCommunicationDeviceLocked(bluetoothComm);
            return;
        }

        // Legacy path: SCO type already present in outputs (pre-API 31 or OEM listing).
        if (hasLegacyScoOutputDeviceLocked()) {
            Log.d(TAG, "enterCommunicationMode route=sco-legacy gen=" + ownerGeneration);
            startLegacyBluetoothScoLocked();
            applySpeakerphoneLocked(false);
            return;
        }

        scoStarted = false;
        if (preferSpeakerphone) {
            Log.d(
                TAG,
                "enterCommunicationMode route=speakerphone prefer=true gen=" + ownerGeneration
            );
            applySpeakerphoneLocked(true);
        } else {
            Log.d(
                TAG,
                "enterCommunicationMode route=earpiece prefer=false gen=" + ownerGeneration
            );
            applySpeakerphoneLocked(false);
        }
    }

    private void routeToBluetoothCommunicationDeviceLocked(
        android.media.AudioDeviceInfo bluetoothComm
    ) {
        speakerphoneEnabled = false;
        try {
            audioManager.setSpeakerphoneOn(false);
        } catch (Exception error) {
            Log.w(TAG, "failed to clear speakerphone for bluetooth route", error);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                boolean ok = audioManager.setCommunicationDevice(bluetoothComm);
                communicationDeviceSet = ok;
                if (!ok) {
                    Log.w(TAG, "setCommunicationDevice(bluetooth) returned false");
                }
            } catch (Exception error) {
                Log.w(TAG, "setCommunicationDevice(bluetooth) failed", error);
            }
        }
        // Still start classic SCO: WebRTC / older paths often need the SCO link even when
        // setCommunicationDevice was used.
        startLegacyBluetoothScoLocked();
    }

    private void startLegacyBluetoothScoLocked() {
        try {
            audioManager.setBluetoothScoOn(true);
            audioManager.startBluetoothSco();
            scoStarted = true;
        } catch (Exception error) {
            Log.w(TAG, "failed to start bluetooth SCO", error);
            scoStarted = false;
        }
    }

    /**
     * Voice-capable Bluetooth devices after call mode is active. Prefer SCO/BLE headset over
     * anything else. Pure A2DP media speakers are intentionally ignored so speakerphone can win.
     * Dual-profile headsets (e.g. Shokz OpenComm) often expose both A2DP and SCO; we must pick
     * the SCO node or Android keeps routing VOICE_COMMUNICATION over quiet A2DP.
     */
    private android.media.AudioDeviceInfo findBluetoothCommunicationDeviceLocked() {
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return null;
        }
        android.media.AudioDeviceInfo fromAvailable =
            findFirstBluetoothVoiceDeviceLocked(listAvailableCommunicationDevicesLocked());
        if (fromAvailable != null) {
            return fromAvailable;
        }
        // Fallback: SCO may be listed only under GET_DEVICES_OUTPUTS until preferred.
        return findFirstBluetoothVoiceDeviceLocked(listOutputDevicesLocked());
    }

    private android.media.AudioDeviceInfo findFirstBluetoothVoiceDeviceLocked(
        android.media.AudioDeviceInfo[] devices
    ) {
        if (devices == null) {
            return null;
        }
        for (android.media.AudioDeviceInfo device : devices) {
            if (device != null && isBluetoothVoiceDeviceType(device.getType())) {
                return device;
            }
        }
        return null;
    }

    private android.media.AudioDeviceInfo[] listAvailableCommunicationDevicesLocked() {
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return new android.media.AudioDeviceInfo[0];
        }
        try {
            java.util.List<android.media.AudioDeviceInfo> devices =
                audioManager.getAvailableCommunicationDevices();
            if (devices == null || devices.isEmpty()) {
                return new android.media.AudioDeviceInfo[0];
            }
            return devices.toArray(new android.media.AudioDeviceInfo[0]);
        } catch (Exception error) {
            Log.w(TAG, "failed to list available communication devices for bluetooth", error);
            return new android.media.AudioDeviceInfo[0];
        }
    }

    private android.media.AudioDeviceInfo[] listOutputDevicesLocked() {
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return new android.media.AudioDeviceInfo[0];
        }
        try {
            android.media.AudioDeviceInfo[] devices =
                audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS);
            return devices == null ? new android.media.AudioDeviceInfo[0] : devices;
        } catch (Exception error) {
            Log.w(TAG, "failed to list output devices", error);
            return new android.media.AudioDeviceInfo[0];
        }
    }

    private boolean isBluetoothCommunicationRouteActiveLocked() {
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return scoStarted;
        }
        try {
            android.media.AudioDeviceInfo current = audioManager.getCommunicationDevice();
            return current != null && isBluetoothVoiceDeviceType(current.getType());
        } catch (Exception error) {
            return scoStarted;
        }
    }

    private static boolean isBluetoothVoiceDeviceType(int type) {
        if (type == android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            || type == android.media.AudioDeviceInfo.TYPE_BLE_HEADSET
            || type == android.media.AudioDeviceInfo.TYPE_HEARING_AID) {
            return true;
        }
        // API 31+: BLE speaker can be used for communication on some stacks.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && type == android.media.AudioDeviceInfo.TYPE_BLE_SPEAKER) {
            return true;
        }
        return false;
    }

    /**
     * Pre-communication-device-API detection: only true SCO/BLE headset outputs, never A2DP
     * alone (A2DP-only media speakers must not block loudspeaker preference).
     */
    private boolean hasLegacyScoOutputDeviceLocked() {
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
            // Prefer setCommunicationDevice(BUILTIN_SPEAKER) on API 31+: setSpeakerphoneOn is
            // deprecated and can lose to an A2DP media route while still leaving voice quiet.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (enabled) {
                    android.media.AudioDeviceInfo speaker = findBuiltinSpeakerLocked();
                    if (speaker != null) {
                        boolean ok = audioManager.setCommunicationDevice(speaker);
                        communicationDeviceSet = ok;
                        if (!ok) {
                            Log.w(TAG, "setCommunicationDevice(BUILTIN_SPEAKER) returned false");
                        }
                    } else {
                        Log.w(TAG, "no BUILTIN_SPEAKER for communication; falling back");
                    }
                    // Keep legacy flag in sync for OEM paths that still honor it.
                    audioManager.setSpeakerphoneOn(true);
                } else {
                    clearCommunicationDeviceLocked();
                    audioManager.setSpeakerphoneOn(false);
                }
            } else {
                audioManager.setSpeakerphoneOn(enabled);
            }
            speakerphoneEnabled = enabled;
        } catch (Exception error) {
            Log.w(TAG, "failed to set speakerphone=" + enabled, error);
        }
    }

    private void clearCommunicationDeviceLocked() {
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            communicationDeviceSet = false;
            return;
        }
        try {
            audioManager.clearCommunicationDevice();
        } catch (Exception error) {
            Log.w(TAG, "clearCommunicationDevice failed", error);
        }
        communicationDeviceSet = false;
    }

    private android.media.AudioDeviceInfo findBuiltinSpeakerLocked() {
        if (audioManager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return null;
        }
        try {
            for (android.media.AudioDeviceInfo device
                : audioManager.getAvailableCommunicationDevices()) {
                if (device.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    return device;
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "failed to list available communication devices", error);
        }
        try {
            for (android.media.AudioDeviceInfo device
                : audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (device.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                    return device;
                }
            }
        } catch (Exception error) {
            Log.w(TAG, "failed to list output devices for builtin speaker", error);
        }
        return null;
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
            communicationDeviceSet = false;
            return;
        }
        if (!communicationModeActive
            && !scoStarted
            && !speakerphoneEnabled
            && !communicationDeviceSet) {
            return;
        }
        try {
            if (scoStarted) {
                audioManager.stopBluetoothSco();
                audioManager.setBluetoothScoOn(false);
            }
            if (speakerphoneEnabled || communicationDeviceSet) {
                clearCommunicationDeviceLocked();
                audioManager.setSpeakerphoneOn(false);
            }
            audioManager.setMode(AudioManager.MODE_NORMAL);
        } catch (Exception error) {
            Log.w(TAG, "failed to leave communication mode", error);
        }
        scoStarted = false;
        speakerphoneEnabled = false;
        communicationDeviceSet = false;
        communicationModeActive = false;
    }
}
