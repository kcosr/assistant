package com.assistant.mobile.voice;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONObject;

@CapacitorPlugin(
    name = "AssistantNativeVoice",
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public final class AssistantVoicePlugin extends Plugin {
    private static final String TAG = "AssistantVoicePlugin";
    private static final String PENDING_ACTION_SET_VOICE_SETTINGS = "set_voice_settings";
    private static final String PENDING_ACTION_START_LISTEN = "start_manual_listen";
    private static final String PENDING_ACTION_NOTIFICATION_MIC = "notification_mic";

    private BroadcastReceiver receiver;
    private String pendingPermissionAction = "";
    private AssistantVoiceConfig pendingVoiceSettings = null;

    @Override
    public void load() {
        super.load();
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent == null || intent.getAction() == null) {
                    return;
                }
                if (AssistantVoiceRuntimeService.BROADCAST_STATE_CHANGED.equals(intent.getAction())) {
                    notifyListeners("stateChanged", buildStatePayload(), true);
                    return;
                }
                if (AssistantVoiceRuntimeService.BROADCAST_RUNTIME_ERROR.equals(intent.getAction())) {
                    String message = intent.getStringExtra(AssistantVoiceRuntimeService.EXTRA_MESSAGE);
                    if (message == null || message.trim().isEmpty()) {
                        return;
                    }
                    JSObject error = new JSObject();
                    error.put("message", message);
                    notifyListeners("runtimeError", error);
                }
            }
        };

        IntentFilter filter = new IntentFilter();
        filter.addAction(AssistantVoiceRuntimeService.BROADCAST_STATE_CHANGED);
        filter.addAction(AssistantVoiceRuntimeService.BROADCAST_RUNTIME_ERROR);
        ContextCompat.registerReceiver(
            getContext(),
            receiver,
            filter,
            ContextCompat.RECEIVER_NOT_EXPORTED
        );

        notifyListeners("stateChanged", buildStatePayload(), true);

        checkLaunchIntentForOpenSession();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        checkIntentForOpenSession(intent);
    }

    @Override
    protected void handleOnDestroy() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
            }
            receiver = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void setVoiceSettings(PluginCall call) {
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = extractVoiceSettingsConfig(call, current);
        if (updated == null) {
            call.reject("settings is required");
            return;
        }

        if (updated.isEnabled() && !hasVoiceModePermissions()) {
            pendingPermissionAction = PENDING_ACTION_SET_VOICE_SETTINGS;
            pendingVoiceSettings = updated;
            saveCall(call);
            requestVoiceModePermissions(call);
            return;
        }

        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setSelectedSession(PluginCall call) {
        JSONObject selection = call.getData().optJSONObject("selection");
        String panelId = selection == null
            ? call.getString(AssistantVoiceConfig.EXTRA_SELECTED_PANEL_ID)
            : selection.optString("panelId", null);
        String sessionId = selection == null
            ? call.getString(AssistantVoiceConfig.EXTRA_SELECTED_SESSION_ID)
            : selection.optString("sessionId", null);

        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withSelection(panelId, sessionId);
        applyConfig(updated);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "panelId", safe(panelId));
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.record(getContext(), "plugin_set_selected_session", details);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setSessionTitles(PluginCall call) {
        JSONObject sessionTitles = call.getData().optJSONObject(AssistantVoiceConfig.EXTRA_SESSION_TITLES);
        if (sessionTitles == null) {
            call.reject("sessionTitles is required");
            return;
        }
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withSessionTitles(sessionTitles);
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setInputContext(PluginCall call) {
        JSONObject inputContext = call.getData().optJSONObject("inputContext");
        if (inputContext == null) {
            call.reject("inputContext is required");
            return;
        }
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withInputContext(
            inputContext.optBoolean("enabled", current.inputContextEnabled),
            inputContext.optString("contextLine", current.inputContextLine)
        );
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setAssistantBaseUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            url = call.getString(AssistantVoiceConfig.EXTRA_ASSISTANT_BASE_URL);
        }
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = current.withAssistantBaseUrl(url);
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void stopCurrentInteraction(PluginCall call) {
        AssistantVoiceEventLog.record(getContext(), "plugin_stop_current_interaction");
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.stopCurrentInteractionIntent(getContext())
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void startManualListen(PluginCall call) {
        String sessionId = call.getString("sessionId");
        Log.d(TAG, "startManualListen invoked sessionId=" + safe(sessionId));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.record(getContext(), "plugin_start_manual_listen", details);
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingPermissionAction = PENDING_ACTION_START_LISTEN;
            saveCall(call);
            Log.d(TAG, "startManualListen awaiting microphone permission sessionId=" + safe(sessionId));
            AssistantVoiceEventLog.record(
                getContext(),
                "plugin_start_manual_listen_permission_pending",
                details
            );
            requestPermissionForAlias("microphone", call, "handleMicrophonePermissionResult");
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.startManualListenIntent(getContext(), sessionId)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void retargetActiveRecognition(PluginCall call) {
        String sessionId = call.getString("sessionId");
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "sessionId", safe(sessionId));
        AssistantVoiceEventLog.record(getContext(), "plugin_retarget_active_recognition", details);
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.retargetActiveRecognitionIntent(getContext(), sessionId)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void performNotificationSpeaker(PluginCall call) {
        AssistantVoiceNotificationRecord notification = extractNotification(call);
        if (notification == null) {
            Log.w(TAG, "performNotificationSpeaker missing notification payload");
            call.reject("notification is required");
            return;
        }
        Log.d(TAG, "performNotificationSpeaker invoked " + describeNotification(notification));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "notification", describeNotification(notification));
        AssistantVoiceEventLog.record(getContext(), "plugin_notification_play", details);
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.notificationSpeakerIntent(getContext(), notification)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void performNotificationMic(PluginCall call) {
        AssistantVoiceNotificationRecord notification = extractNotification(call);
        if (notification == null) {
            Log.w(TAG, "performNotificationMic missing notification payload");
            call.reject("notification is required");
            return;
        }
        Log.d(TAG, "performNotificationMic invoked " + describeNotification(notification));
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "notification", describeNotification(notification));
        AssistantVoiceEventLog.record(getContext(), "plugin_notification_speak", details);
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingPermissionAction = PENDING_ACTION_NOTIFICATION_MIC;
            saveCall(call);
            Log.d(TAG, "performNotificationMic awaiting microphone permission " + describeNotification(notification));
            AssistantVoiceEventLog.record(
                getContext(),
                "plugin_notification_speak_permission_pending",
                details
            );
            requestPermissionForAlias("microphone", call, "handleMicrophonePermissionResult");
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.notificationMicIntent(getContext(), notification)
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void listInputDevices(PluginCall call) {
        Log.d(TAG, "listInputDevices invoked");
        JSArray devices = new JSArray();
        for (AssistantVoiceAudioDeviceUtils.InputDeviceOption option : AssistantVoiceAudioDeviceUtils.listInputDevices(getContext())) {
            JSObject entry = new JSObject();
            entry.put("id", option.id);
            entry.put("label", option.label);
            devices.put(entry);
        }
        Log.d(TAG, "listInputDevices resolved count=" + devices.length() + " payload=" + devices);
        JSObject payload = new JSObject();
        payload.put("devices", devices);
        call.resolve(payload);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(buildStatePayload());
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void handleVoiceModePermissionResult(PluginCall call) {
        PluginCall savedCall = getSavedCall();
        if (savedCall == null) {
            if (call != null) {
                call.reject("Permission callback lost");
            }
            return;
        }
        if (!hasVoiceModePermissions()) {
            pendingPermissionAction = "";
            pendingVoiceSettings = null;
            AssistantVoiceEventLog.record(
                getContext(),
                "plugin_voice_mode_permission_denied"
            );
            savedCall.reject("Microphone and notification permissions are required");
            bridge.releaseCall(savedCall);
            return;
        }

        if (PENDING_ACTION_SET_VOICE_SETTINGS.equals(pendingPermissionAction) && pendingVoiceSettings != null) {
            applyConfig(pendingVoiceSettings);
        }

        pendingPermissionAction = "";
        pendingVoiceSettings = null;
        AssistantVoiceEventLog.record(getContext(), "plugin_voice_mode_permission_granted");
        savedCall.resolve(buildStatePayload());
        bridge.releaseCall(savedCall);
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void handleMicrophonePermissionResult(PluginCall call) {
        PluginCall savedCall = getSavedCall();
        if (savedCall == null) {
            if (call != null) {
                call.reject("Permission callback lost");
            }
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            Log.w(TAG, "handleMicrophonePermissionResult denied pendingAction=" + pendingPermissionAction);
            JSONObject details = AssistantVoiceEventLog.details();
            AssistantVoiceEventLog.put(details, "pendingAction", pendingPermissionAction);
            AssistantVoiceEventLog.record(getContext(), "plugin_microphone_permission_denied", details);
            pendingPermissionAction = "";
            pendingVoiceSettings = null;
            savedCall.reject("Microphone permission is required");
            bridge.releaseCall(savedCall);
            return;
        }

        Log.d(TAG, "handleMicrophonePermissionResult granted pendingAction=" + pendingPermissionAction);
        JSONObject details = AssistantVoiceEventLog.details();
        AssistantVoiceEventLog.put(details, "pendingAction", pendingPermissionAction);
        AssistantVoiceEventLog.record(getContext(), "plugin_microphone_permission_granted", details);
        if (PENDING_ACTION_SET_VOICE_SETTINGS.equals(pendingPermissionAction) && pendingVoiceSettings != null) {
            applyConfig(pendingVoiceSettings);
        } else if (PENDING_ACTION_START_LISTEN.equals(pendingPermissionAction)) {
            String sessionId = savedCall.getString("sessionId");
            Log.d(TAG, "resuming startManualListen after permission sessionId=" + safe(sessionId));
            ContextCompat.startForegroundService(
                getContext(),
                AssistantVoiceRuntimeService.startManualListenIntent(getContext(), sessionId)
            );
        } else if (PENDING_ACTION_NOTIFICATION_MIC.equals(pendingPermissionAction)) {
            AssistantVoiceNotificationRecord notification = extractNotification(savedCall);
            if (notification != null) {
                Log.d(TAG, "resuming performNotificationMic after permission " + describeNotification(notification));
                ContextCompat.startForegroundService(
                    getContext(),
                    AssistantVoiceRuntimeService.notificationMicIntent(getContext(), notification)
                );
            } else {
                Log.w(TAG, "notification mic permission resumed without notification payload");
            }
        }

        pendingPermissionAction = "";
        pendingVoiceSettings = null;
        savedCall.resolve(buildStatePayload());
        bridge.releaseCall(savedCall);
    }

    private void applyConfig(AssistantVoiceConfig config) {
        AssistantVoiceConfig.save(getContext(), config);
        if (!config.isEnabled()) {
            getContext().stopService(AssistantVoiceRuntimeService.stopServiceIntent(getContext()));
            AssistantVoiceConfig.saveRuntimeSnapshot(
                getContext(),
                AssistantVoiceRuntimeService.STATE_DISABLED,
                null,
                null,
                null
            );
            notifyListeners("stateChanged", buildStatePayload(), true);
            return;
        }

        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.applyConfigIntent(getContext(), config)
        );
    }

    private JSObject buildStatePayload() {
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        JSObject selection = new JSObject();
        if (!current.selectedPanelId.isEmpty()) {
            selection.put("panelId", current.selectedPanelId);
        }
        if (!current.selectedSessionId.isEmpty()) {
            selection.put("sessionId", current.selectedSessionId);
        }
        JSObject inputContext = new JSObject();
        inputContext.put("enabled", current.inputContextEnabled);
        inputContext.put("contextLine", current.inputContextLine);

        JSObject voiceSettings = new JSObject();
        voiceSettings.put("audioMode", current.audioMode);
        voiceSettings.put("autoListenEnabled", current.autoListenEnabled);
        voiceSettings.put("voiceAdapterBaseUrl", current.voiceAdapterBaseUrl);
        voiceSettings.put("preferredVoiceSessionId", current.preferredVoiceSessionId);
        voiceSettings.put("selectedMicDeviceId", current.selectedMicDeviceId);
        voiceSettings.put("recognitionStartTimeoutMs", current.recognitionStartTimeoutMs);
        voiceSettings.put("recognitionCompletionTimeoutMs", current.recognitionCompletionTimeoutMs);
        voiceSettings.put("recognitionEndSilenceMs", current.recognitionEndSilenceMs);
        JSObject sessionTitles = new JSObject();
        for (java.util.Map.Entry<String, String> entry : current.sessionTitles.entrySet()) {
            sessionTitles.put(entry.getKey(), entry.getValue());
        }
        voiceSettings.put("ttsGain", (double) current.ttsGain);
        voiceSettings.put("recognitionCueEnabled", current.recognitionCueEnabled);
        voiceSettings.put("recognitionCueGain", (double) current.recognitionCueGain);
        voiceSettings.put("recognizeStopCommandEnabled", current.recognizeStopCommandEnabled);
        voiceSettings.put("startupPreRollMs", current.startupPreRollMs);
        voiceSettings.put(
            "standaloneNotificationPlaybackEnabled",
            current.standaloneNotificationPlaybackEnabled
        );
        voiceSettings.put(
            "notificationTitlePlaybackEnabled",
            current.notificationTitlePlaybackEnabled
        );
        String activeSessionId = AssistantVoiceConfig.loadRuntimeActiveSessionId(getContext());
        String activeDisplayTitle = AssistantVoiceConfig.loadRuntimeActiveDisplayTitle(getContext());

        JSObject payload = new JSObject();
        payload.put("state", AssistantVoiceConfig.loadRuntimeState(getContext()));
        payload.put("activeSessionId", activeSessionId.isEmpty() ? null : activeSessionId);
        payload.put("activeDisplayTitle", activeDisplayTitle.isEmpty() ? null : activeDisplayTitle);
        payload.put("voiceSettings", voiceSettings);
        payload.put("assistantBaseUrl", current.assistantBaseUrl);
        payload.put("selectedSession", selection.length() == 0 ? null : selection);
        payload.put("sessionTitles", sessionTitles);
        payload.put("inputContext", inputContext);
        payload.put("effectiveTtsGain", (double) current.ttsGain);
        payload.put("effectiveRecognitionCueGain", (double) current.recognitionCueGain);

        String error = AssistantVoiceConfig.loadRuntimeError(getContext());
        if (!error.isEmpty()) {
            payload.put("lastError", error);
        }
        return payload;
    }

    private AssistantVoiceConfig extractVoiceSettingsConfig(
        PluginCall call,
        AssistantVoiceConfig current
    ) {
        JSONObject settings = call.getData().optJSONObject("settings");
        return settings == null ? null : current.withVoiceSettings(settings);
    }

    private AssistantVoiceNotificationRecord extractNotification(PluginCall call) {
        JSONObject notification = call.getData().optJSONObject("notification");
        if (notification == null) {
            return null;
        }
        Integer sessionActivitySeq =
            notification.has("sessionActivitySeq") && !notification.isNull("sessionActivitySeq")
                ? Integer.valueOf(notification.optInt("sessionActivitySeq"))
                : null;
        return new AssistantVoiceNotificationRecord(
            optTrimmedString(notification, "id", null),
            optTrimmedString(notification, "kind", null),
            optTrimmedString(notification, "source", null),
            optTrimmedString(notification, "title", null),
            optTrimmedString(notification, "body", null),
            optTrimmedString(notification, "readAt", null),
            optTrimmedString(notification, "sessionId", null),
            optTrimmedString(notification, "sessionTitle", null),
            optTrimmedString(notification, "voiceMode", null),
            optTrimmedString(notification, "ttsText", null),
            optTrimmedString(notification, "sourceEventId", null),
            sessionActivitySeq
        );
    }

    private static String optTrimmedString(JSONObject object, String key, String fallback) {
        if (object == null || key == null || key.isEmpty() || object.isNull(key)) {
            return fallback;
        }
        String value = object.optString(key, fallback);
        return value == null ? null : value.trim();
    }

    private boolean hasVoiceModePermissions() {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            return false;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getPermissionState("notifications") == PermissionState.GRANTED;
        }
        return true;
    }

    private void requestVoiceModePermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissionForAliases(
                new String[] { "microphone", "notifications" },
                call,
                "handleVoiceModePermissionResult"
            );
            return;
        }
        requestPermissionForAlias("microphone", call, "handleVoiceModePermissionResult");
    }

    private static String describeNotification(AssistantVoiceNotificationRecord notification) {
        if (notification == null) {
            return "notification=<null>";
        }
        return "notificationId=" + safe(notification.id)
            + " sessionId=" + safe(notification.sessionId)
            + " kind=" + safe(notification.kind)
            + " voiceMode=" + safe(notification.voiceMode)
            + " hasSpeech=" + (!notification.resolveSpokenText(false).isEmpty());
    }

    private void checkLaunchIntentForOpenSession() {
        if (getActivity() == null) {
            return;
        }
        checkIntentForOpenSession(getActivity().getIntent());
    }

    private void checkIntentForOpenSession(Intent intent) {
        if (intent == null) {
            return;
        }
        String sessionId = intent.getStringExtra(AssistantVoiceRuntimeService.EXTRA_OPEN_SESSION_ID);
        if (sessionId == null || sessionId.trim().isEmpty()) {
            return;
        }
        intent.removeExtra(AssistantVoiceRuntimeService.EXTRA_OPEN_SESSION_ID);
        Log.d(TAG, "openSession from intent sessionId=" + safe(sessionId));
        JSObject payload = new JSObject();
        payload.put("sessionId", sessionId.trim());
        notifyListeners("openSession", payload, true);
    }

    private static String safe(String value) {
        String trimmed = value == null ? "" : value.trim();
        return trimmed.isEmpty() ? "<empty>" : trimmed;
    }
}
