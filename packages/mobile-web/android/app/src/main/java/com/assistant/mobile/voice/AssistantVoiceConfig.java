package com.assistant.mobile.voice;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.util.Objects;

final class AssistantVoiceConfig {
    static final String DEFAULT_VOICE_ADAPTER_BASE_URL = "https://assistant/agent-voice-adapter";
    static final String DEFAULT_ASSISTANT_BASE_URL = "https://assistant";

    private static final String PREFS_NAME = "assistant_voice_runtime";
    private static final String KEY_VOICE_MODE_ENABLED = "voice_mode_enabled";
    private static final String KEY_SELECTED_PANEL_ID = "selected_panel_id";
    private static final String KEY_SELECTED_SESSION_ID = "selected_session_id";
    private static final String KEY_VOICE_ADAPTER_BASE_URL = "voice_adapter_base_url";
    private static final String KEY_ASSISTANT_BASE_URL = "assistant_base_url";
    private static final String KEY_RUNTIME_STATE = "runtime_state";
    private static final String KEY_RUNTIME_ERROR = "runtime_error";

    static final String EXTRA_VOICE_MODE_ENABLED = "voiceModeEnabled";
    static final String EXTRA_SELECTED_PANEL_ID = "selectedPanelId";
    static final String EXTRA_SELECTED_SESSION_ID = "selectedSessionId";
    static final String EXTRA_VOICE_ADAPTER_BASE_URL = "voiceAdapterBaseUrl";
    static final String EXTRA_ASSISTANT_BASE_URL = "assistantBaseUrl";

    final boolean voiceModeEnabled;
    final String selectedPanelId;
    final String selectedSessionId;
    final String voiceAdapterBaseUrl;
    final String assistantBaseUrl;

    AssistantVoiceConfig(
        boolean voiceModeEnabled,
        String selectedPanelId,
        String selectedSessionId,
        String voiceAdapterBaseUrl,
        String assistantBaseUrl
    ) {
        this.voiceModeEnabled = voiceModeEnabled;
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
            prefs.getBoolean(KEY_VOICE_MODE_ENABLED, false),
            prefs.getString(KEY_SELECTED_PANEL_ID, null),
            prefs.getString(KEY_SELECTED_SESSION_ID, null),
            prefs.getString(KEY_VOICE_ADAPTER_BASE_URL, DEFAULT_VOICE_ADAPTER_BASE_URL),
            prefs.getString(KEY_ASSISTANT_BASE_URL, DEFAULT_ASSISTANT_BASE_URL)
        );
    }

    static void save(Context context, AssistantVoiceConfig config) {
        prefs(context)
            .edit()
            .putBoolean(KEY_VOICE_MODE_ENABLED, config.voiceModeEnabled)
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
            intent.getBooleanExtra(EXTRA_VOICE_MODE_ENABLED, fallback.voiceModeEnabled),
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
        intent.putExtra(EXTRA_VOICE_MODE_ENABLED, voiceModeEnabled);
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

    @Override
    public boolean equals(Object other) {
        if (this == other) {
            return true;
        }
        if (!(other instanceof AssistantVoiceConfig)) {
            return false;
        }
        AssistantVoiceConfig config = (AssistantVoiceConfig) other;
        return voiceModeEnabled == config.voiceModeEnabled
            && Objects.equals(selectedPanelId, config.selectedPanelId)
            && Objects.equals(selectedSessionId, config.selectedSessionId)
            && Objects.equals(voiceAdapterBaseUrl, config.voiceAdapterBaseUrl)
            && Objects.equals(assistantBaseUrl, config.assistantBaseUrl);
    }

    @Override
    public int hashCode() {
        return Objects.hash(
            voiceModeEnabled,
            selectedPanelId,
            selectedSessionId,
            voiceAdapterBaseUrl,
            assistantBaseUrl
        );
    }
}
