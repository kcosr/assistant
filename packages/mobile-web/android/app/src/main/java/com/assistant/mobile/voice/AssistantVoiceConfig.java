package com.assistant.mobile.voice;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.util.Objects;

final class AssistantVoiceConfig {
    static final String DEFAULT_VOICE_ADAPTER_BASE_URL = "https://assistant/agent-voice-adapter";
    static final String DEFAULT_ASSISTANT_BASE_URL = "https://assistant";
    static final String AUDIO_MODE_OFF = "off";
    static final String AUDIO_MODE_TOOL = "tool";
    static final String AUDIO_MODE_RESPONSE = "response";
    static final String DEFAULT_AUDIO_MODE = AUDIO_MODE_TOOL;

    private static final String PREFS_NAME = "assistant_voice_runtime";
    private static final String KEY_AUDIO_MODE = "audio_mode";
    private static final String KEY_AUTO_LISTEN_ENABLED = "auto_listen_enabled";
    private static final String KEY_SELECTED_PANEL_ID = "selected_panel_id";
    private static final String KEY_SELECTED_SESSION_ID = "selected_session_id";
    private static final String KEY_VOICE_ADAPTER_BASE_URL = "voice_adapter_base_url";
    private static final String KEY_ASSISTANT_BASE_URL = "assistant_base_url";
    private static final String KEY_RUNTIME_STATE = "runtime_state";
    private static final String KEY_RUNTIME_ERROR = "runtime_error";

    static final String EXTRA_AUDIO_MODE = "audioMode";
    static final String EXTRA_AUTO_LISTEN_ENABLED = "autoListenEnabled";
    static final String EXTRA_SELECTED_PANEL_ID = "selectedPanelId";
    static final String EXTRA_SELECTED_SESSION_ID = "selectedSessionId";
    static final String EXTRA_VOICE_ADAPTER_BASE_URL = "voiceAdapterBaseUrl";
    static final String EXTRA_ASSISTANT_BASE_URL = "assistantBaseUrl";

    final String audioMode;
    final boolean autoListenEnabled;
    final String selectedPanelId;
    final String selectedSessionId;
    final String voiceAdapterBaseUrl;
    final String assistantBaseUrl;

    AssistantVoiceConfig(
        String audioMode,
        boolean autoListenEnabled,
        String selectedPanelId,
        String selectedSessionId,
        String voiceAdapterBaseUrl,
        String assistantBaseUrl
    ) {
        this.audioMode = normalizeAudioMode(audioMode);
        this.autoListenEnabled = autoListenEnabled;
        this.selectedPanelId = normalizeOptional(selectedPanelId);
        this.selectedSessionId = normalizeOptional(selectedSessionId);
        this.voiceAdapterBaseUrl = AssistantVoiceUrlUtils.normalizeBaseUrl(
            voiceAdapterBaseUrl,
            DEFAULT_VOICE_ADAPTER_BASE_URL
        );
        this.assistantBaseUrl = AssistantVoiceUrlUtils.normalizeBaseUrl(
            assistantBaseUrl,
            DEFAULT_ASSISTANT_BASE_URL
        );
    }

    static AssistantVoiceConfig load(Context context) {
        SharedPreferences prefs = prefs(context);
        return new AssistantVoiceConfig(
            prefs.getString(KEY_AUDIO_MODE, DEFAULT_AUDIO_MODE),
            prefs.getBoolean(KEY_AUTO_LISTEN_ENABLED, true),
            prefs.getString(KEY_SELECTED_PANEL_ID, null),
            prefs.getString(KEY_SELECTED_SESSION_ID, null),
            prefs.getString(KEY_VOICE_ADAPTER_BASE_URL, DEFAULT_VOICE_ADAPTER_BASE_URL),
            prefs.getString(KEY_ASSISTANT_BASE_URL, DEFAULT_ASSISTANT_BASE_URL)
        );
    }

    static void save(Context context, AssistantVoiceConfig config) {
        prefs(context)
            .edit()
            .putString(KEY_AUDIO_MODE, config.audioMode)
            .putBoolean(KEY_AUTO_LISTEN_ENABLED, config.autoListenEnabled)
            .putString(KEY_SELECTED_PANEL_ID, emptyToNull(config.selectedPanelId))
            .putString(KEY_SELECTED_SESSION_ID, emptyToNull(config.selectedSessionId))
            .putString(KEY_VOICE_ADAPTER_BASE_URL, config.voiceAdapterBaseUrl)
            .putString(KEY_ASSISTANT_BASE_URL, config.assistantBaseUrl)
            .apply();
    }

    static AssistantVoiceConfig fromIntent(Intent intent, AssistantVoiceConfig fallback) {
        if (intent == null) {
            return fallback;
        }
        return new AssistantVoiceConfig(
            intent.hasExtra(EXTRA_AUDIO_MODE)
                ? intent.getStringExtra(EXTRA_AUDIO_MODE)
                : fallback.audioMode,
            intent.getBooleanExtra(EXTRA_AUTO_LISTEN_ENABLED, fallback.autoListenEnabled),
            intent.hasExtra(EXTRA_SELECTED_PANEL_ID)
                ? intent.getStringExtra(EXTRA_SELECTED_PANEL_ID)
                : fallback.selectedPanelId,
            intent.hasExtra(EXTRA_SELECTED_SESSION_ID)
                ? intent.getStringExtra(EXTRA_SELECTED_SESSION_ID)
                : fallback.selectedSessionId,
            intent.hasExtra(EXTRA_VOICE_ADAPTER_BASE_URL)
                ? intent.getStringExtra(EXTRA_VOICE_ADAPTER_BASE_URL)
                : fallback.voiceAdapterBaseUrl,
            intent.hasExtra(EXTRA_ASSISTANT_BASE_URL)
                ? intent.getStringExtra(EXTRA_ASSISTANT_BASE_URL)
                : fallback.assistantBaseUrl
        );
    }

    Intent applyToIntent(Intent intent) {
        intent.putExtra(EXTRA_AUDIO_MODE, audioMode);
        intent.putExtra(EXTRA_AUTO_LISTEN_ENABLED, autoListenEnabled);
        intent.putExtra(EXTRA_SELECTED_PANEL_ID, emptyToNull(selectedPanelId));
        intent.putExtra(EXTRA_SELECTED_SESSION_ID, emptyToNull(selectedSessionId));
        intent.putExtra(EXTRA_VOICE_ADAPTER_BASE_URL, voiceAdapterBaseUrl);
        intent.putExtra(EXTRA_ASSISTANT_BASE_URL, assistantBaseUrl);
        return intent;
    }

    static void saveRuntimeSnapshot(Context context, String state, String errorMessage) {
        prefs(context)
            .edit()
            .putString(KEY_RUNTIME_STATE, normalizeOptional(state))
            .putString(KEY_RUNTIME_ERROR, emptyToNull(errorMessage))
            .apply();
    }

    static String loadRuntimeState(Context context) {
        return normalizeOptional(prefs(context).getString(KEY_RUNTIME_STATE, AssistantVoiceRuntimeService.STATE_DISABLED));
    }

    static String loadRuntimeError(Context context) {
        return normalizeOptional(prefs(context).getString(KEY_RUNTIME_ERROR, null));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static String normalizeOptional(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? "" : trimmed;
    }

    private static String emptyToNull(String value) {
        String normalized = normalizeOptional(value);
        return normalized.isEmpty() ? null : normalized;
    }

    private static String normalizeAudioMode(String value) {
        String normalized = normalizeOptional(value);
        switch (normalized) {
            case AUDIO_MODE_OFF:
            case AUDIO_MODE_TOOL:
            case AUDIO_MODE_RESPONSE:
                return normalized;
            default:
                return DEFAULT_AUDIO_MODE;
        }
    }

    boolean isEnabled() {
        return !AUDIO_MODE_OFF.equals(audioMode);
    }

    boolean isToolMode() {
        return AUDIO_MODE_TOOL.equals(audioMode);
    }

    boolean isResponseMode() {
        return AUDIO_MODE_RESPONSE.equals(audioMode);
    }

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof AssistantVoiceConfig)) {
            return false;
        }
        AssistantVoiceConfig config = (AssistantVoiceConfig) other;
        return Objects.equals(audioMode, config.audioMode)
            && autoListenEnabled == config.autoListenEnabled
            && Objects.equals(selectedPanelId, config.selectedPanelId)
            && Objects.equals(selectedSessionId, config.selectedSessionId)
            && Objects.equals(voiceAdapterBaseUrl, config.voiceAdapterBaseUrl)
            && Objects.equals(assistantBaseUrl, config.assistantBaseUrl);
    }

    @Override
    public int hashCode() {
        return Objects.hash(
            audioMode,
            autoListenEnabled,
            selectedPanelId,
            selectedSessionId,
            voiceAdapterBaseUrl,
            assistantBaseUrl
        );
    }
}
