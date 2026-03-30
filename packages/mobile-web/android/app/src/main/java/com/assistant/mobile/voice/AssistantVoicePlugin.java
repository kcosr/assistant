package com.assistant.mobile.voice;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

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
    private static final String PENDING_ACTION_SET_VOICE_SETTINGS = "set_voice_settings";
    private static final String PENDING_ACTION_START_LISTEN = "start_manual_listen";

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
                    JSObject state = new JSObject();
                    state.put("state", intent.getStringExtra(AssistantVoiceRuntimeService.EXTRA_STATE));
                    notifyListeners("stateChanged", state, true);
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
        AssistantVoiceConfig updated = new AssistantVoiceConfig(
            current.audioMode,
            current.autoListenEnabled,
            current.selectedMicDeviceId,
            current.recognitionStartTimeoutMs,
            current.recognitionCompletionTimeoutMs,
            current.recognitionEndSilenceMs,
            panelId,
            sessionId,
            current.voiceAdapterBaseUrl,
            current.assistantBaseUrl
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
        AssistantVoiceConfig updated = new AssistantVoiceConfig(
            current.audioMode,
            current.autoListenEnabled,
            current.selectedMicDeviceId,
            current.recognitionStartTimeoutMs,
            current.recognitionCompletionTimeoutMs,
            current.recognitionEndSilenceMs,
            current.selectedPanelId,
            current.selectedSessionId,
            current.voiceAdapterBaseUrl,
            url
        );
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void stopCurrentInteraction(PluginCall call) {
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.stopCurrentInteractionIntent(getContext())
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void startManualListen(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            pendingPermissionAction = PENDING_ACTION_START_LISTEN;
            saveCall(call);
            requestPermissionForAlias("microphone", call, "handleMicrophonePermissionResult");
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            AssistantVoiceRuntimeService.startManualListenIntent(getContext())
        );
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void listInputDevices(PluginCall call) {
        JSArray devices = new JSArray();
        for (AssistantVoiceAudioDeviceUtils.InputDeviceOption option : AssistantVoiceAudioDeviceUtils.listInputDevices(getContext())) {
            JSObject entry = new JSObject();
            entry.put("id", option.id);
            entry.put("label", option.label);
            devices.put(entry);
        }
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
            savedCall.reject("Microphone and notification permissions are required");
            bridge.releaseCall(savedCall);
            return;
        }

        if (PENDING_ACTION_SET_VOICE_SETTINGS.equals(pendingPermissionAction) && pendingVoiceSettings != null) {
            applyConfig(pendingVoiceSettings);
        }

        pendingPermissionAction = "";
        pendingVoiceSettings = null;
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
            pendingPermissionAction = "";
            pendingVoiceSettings = null;
            savedCall.reject("Microphone permission is required");
            bridge.releaseCall(savedCall);
            return;
        }

        if (PENDING_ACTION_SET_VOICE_SETTINGS.equals(pendingPermissionAction) && pendingVoiceSettings != null) {
            applyConfig(pendingVoiceSettings);
        } else if (PENDING_ACTION_START_LISTEN.equals(pendingPermissionAction)) {
            ContextCompat.startForegroundService(
                getContext(),
                AssistantVoiceRuntimeService.startManualListenIntent(getContext())
            );
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

        JSObject voiceSettings = new JSObject();
        voiceSettings.put("audioMode", current.audioMode);
        voiceSettings.put("autoListenEnabled", current.autoListenEnabled);
        voiceSettings.put("voiceAdapterBaseUrl", current.voiceAdapterBaseUrl);
        voiceSettings.put("selectedMicDeviceId", current.selectedMicDeviceId);
        voiceSettings.put("recognitionStartTimeoutMs", current.recognitionStartTimeoutMs);
        voiceSettings.put("recognitionCompletionTimeoutMs", current.recognitionCompletionTimeoutMs);
        voiceSettings.put("recognitionEndSilenceMs", current.recognitionEndSilenceMs);

        JSObject payload = new JSObject();
        payload.put("state", AssistantVoiceConfig.loadRuntimeState(getContext()));
        payload.put("voiceSettings", voiceSettings);
        payload.put("assistantBaseUrl", current.assistantBaseUrl);
        payload.put("selectedSession", selection.length() == 0 ? null : selection);

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
        if (settings == null) {
            return null;
        }
        return new AssistantVoiceConfig(
            settings.optString("audioMode", current.audioMode),
            settings.optBoolean("autoListenEnabled", current.autoListenEnabled),
            settings.optString("selectedMicDeviceId", current.selectedMicDeviceId),
            settings.optInt(
                "recognitionStartTimeoutMs",
                current.recognitionStartTimeoutMs
            ),
            settings.optInt(
                "recognitionCompletionTimeoutMs",
                current.recognitionCompletionTimeoutMs
            ),
            settings.optInt("recognitionEndSilenceMs", current.recognitionEndSilenceMs),
            current.selectedPanelId,
            current.selectedSessionId,
            settings.optString("voiceAdapterBaseUrl", current.voiceAdapterBaseUrl),
            current.assistantBaseUrl
        );
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
}
