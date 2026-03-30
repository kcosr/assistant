package com.assistant.mobile.voice;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;

import androidx.core.content.ContextCompat;

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
    private static final String PENDING_ACTION_SET_AUDIO_MODE = "set_audio_mode";
    private static final String PENDING_ACTION_START_LISTEN = "start_manual_listen";

    private BroadcastReceiver receiver;
    private String pendingPermissionAction = "";
    private String pendingAudioMode = AssistantVoiceConfig.AUDIO_MODE_OFF;

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
    public void setAudioMode(PluginCall call) {
        String mode = call.getString(AssistantVoiceConfig.EXTRA_AUDIO_MODE);
        if (mode == null) {
            mode = call.getString("mode");
        }
        if (
            mode == null
                || (
                    !AssistantVoiceConfig.AUDIO_MODE_OFF.equals(mode)
                        && !AssistantVoiceConfig.AUDIO_MODE_TOOL.equals(mode)
                        && !AssistantVoiceConfig.AUDIO_MODE_RESPONSE.equals(mode)
                )
        ) {
            call.reject("mode must be one of off, tool, or response");
            return;
        }

        if (!AssistantVoiceConfig.AUDIO_MODE_OFF.equals(mode) && !hasVoiceModePermissions()) {
            pendingPermissionAction = PENDING_ACTION_SET_AUDIO_MODE;
            pendingAudioMode = mode;
            saveCall(call);
            requestVoiceModePermissions(call);
            return;
        }

        applyAudioMode(mode);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setAutoListenEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean(AssistantVoiceConfig.EXTRA_AUTO_LISTEN_ENABLED, null);
        if (enabled == null) {
            enabled = call.getBoolean("enabled", null);
        }
        if (enabled == null) {
            call.reject("enabled is required");
            return;
        }

        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = new AssistantVoiceConfig(
            current.audioMode,
            enabled,
            current.selectedPanelId,
            current.selectedSessionId,
            current.voiceAdapterBaseUrl,
            current.assistantBaseUrl
        );
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
            panelId,
            sessionId,
            current.voiceAdapterBaseUrl,
            current.assistantBaseUrl
        );
        applyConfig(updated);
        call.resolve(buildStatePayload());
    }

    @PluginMethod
    public void setVoiceAdapterBaseUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) {
            url = call.getString(AssistantVoiceConfig.EXTRA_VOICE_ADAPTER_BASE_URL);
        }
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = new AssistantVoiceConfig(
            current.audioMode,
            current.autoListenEnabled,
            current.selectedPanelId,
            current.selectedSessionId,
            url,
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
            pendingAudioMode = AssistantVoiceConfig.AUDIO_MODE_OFF;
            savedCall.reject("Microphone and notification permissions are required");
            bridge.releaseCall(savedCall);
            return;
        }

        if (PENDING_ACTION_SET_AUDIO_MODE.equals(pendingPermissionAction)) {
            applyAudioMode(pendingAudioMode);
        }

        pendingPermissionAction = "";
        pendingAudioMode = AssistantVoiceConfig.AUDIO_MODE_OFF;
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
            pendingAudioMode = AssistantVoiceConfig.AUDIO_MODE_OFF;
            savedCall.reject("Microphone permission is required");
            bridge.releaseCall(savedCall);
            return;
        }

        if (PENDING_ACTION_SET_AUDIO_MODE.equals(pendingPermissionAction)) {
            applyAudioMode(pendingAudioMode);
        } else if (PENDING_ACTION_START_LISTEN.equals(pendingPermissionAction)) {
            ContextCompat.startForegroundService(
                getContext(),
                AssistantVoiceRuntimeService.startManualListenIntent(getContext())
            );
        }

        pendingPermissionAction = "";
        pendingAudioMode = AssistantVoiceConfig.AUDIO_MODE_OFF;
        savedCall.resolve(buildStatePayload());
        bridge.releaseCall(savedCall);
    }

    private void applyAudioMode(String mode) {
        AssistantVoiceConfig current = AssistantVoiceConfig.load(getContext());
        AssistantVoiceConfig updated = new AssistantVoiceConfig(
            mode,
            current.autoListenEnabled,
            current.selectedPanelId,
            current.selectedSessionId,
            current.voiceAdapterBaseUrl,
            current.assistantBaseUrl
        );
        applyConfig(updated);
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

        JSObject payload = new JSObject();
        payload.put("state", AssistantVoiceConfig.loadRuntimeState(getContext()));
        payload.put("audioMode", current.audioMode);
        payload.put("autoListenEnabled", current.autoListenEnabled);
        payload.put("voiceAdapterBaseUrl", current.voiceAdapterBaseUrl);
        payload.put("assistantBaseUrl", current.assistantBaseUrl);
        payload.put("selectedSession", selection.length() == 0 ? null : selection);

        String error = AssistantVoiceConfig.loadRuntimeError(getContext());
        if (!error.isEmpty()) {
            payload.put("lastError", error);
        }
        return payload;
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
