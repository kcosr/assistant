package com.assistant.mobile.voice;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.json.JSONArray;
import org.json.JSONObject;

final class AssistantVoiceConfig {
    static final String DEFAULT_VOICE_ADAPTER_BASE_URL = "https://assistant/agent-voice-adapter";
    static final String DEFAULT_ASSISTANT_BASE_URL = "https://assistant";
    static final String AUDIO_MODE_OFF = "off";
    static final String AUDIO_MODE_TOOL = "tool";
    static final String AUDIO_MODE_RESPONSE = "response";
    static final String DEFAULT_AUDIO_MODE = AUDIO_MODE_TOOL;
    static final int DEFAULT_RECOGNITION_START_TIMEOUT_MS = 30000;
    static final int DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS = 60000;
    static final int DEFAULT_RECOGNITION_END_SILENCE_MS = 1200;
    static final float MIN_TTS_GAIN = 0.25f;
    static final float MAX_TTS_GAIN = 5.0f;
    static final float DEFAULT_TTS_GAIN = 1.0f;
    static final boolean DEFAULT_RECOGNITION_CUE_ENABLED = true;
    static final float MIN_RECOGNITION_CUE_GAIN = 0.25f;
    static final float MAX_RECOGNITION_CUE_GAIN = 5.0f;
    static final float DEFAULT_RECOGNITION_CUE_GAIN = 1.0f;
    static final boolean DEFAULT_RECOGNIZE_STOP_COMMAND_ENABLED = true;
    static final int MIN_STARTUP_PRE_ROLL_MS = 0;
    static final int MAX_STARTUP_PRE_ROLL_MS = 4096;
    static final int DEFAULT_STARTUP_PRE_ROLL_MS = 512;
    static final boolean DEFAULT_MEDIA_BUTTONS_ENABLED = false;
    static final boolean DEFAULT_TTS_PREFERRED_SESSION_ONLY = false;

    private static final String PREFS_NAME = "assistant_voice_runtime";
    private static final String KEY_AUDIO_MODE = "audio_mode";
    private static final String KEY_AUTO_LISTEN_ENABLED = "auto_listen_enabled";
    private static final String KEY_RECOGNITION_START_TIMEOUT_MS = "recognition_start_timeout_ms";
    private static final String KEY_RECOGNITION_COMPLETION_TIMEOUT_MS = "recognition_completion_timeout_ms";
    private static final String KEY_RECOGNITION_END_SILENCE_MS = "recognition_end_silence_ms";
    private static final String KEY_SELECTED_MIC_DEVICE_ID = "selected_mic_device_id";
    private static final String KEY_SELECTED_PANEL_ID = "selected_panel_id";
    private static final String KEY_SELECTED_SESSION_ID = "selected_session_id";
    private static final String KEY_PREFERRED_VOICE_SESSION_ID = "preferred_voice_session_id";
    private static final String KEY_SESSION_TITLES = "session_titles";
    private static final String KEY_WATCHED_SESSION_IDS = "watched_session_ids";
    private static final String KEY_INPUT_CONTEXT_ENABLED = "input_context_enabled";
    private static final String KEY_INPUT_CONTEXT_LINE = "input_context_line";
    private static final String KEY_VOICE_ADAPTER_BASE_URL = "voice_adapter_base_url";
    private static final String KEY_ASSISTANT_BASE_URL = "assistant_base_url";
    private static final String KEY_TTS_GAIN = "tts_gain";
    private static final String KEY_RECOGNITION_CUE_ENABLED = "recognition_cue_enabled";
    private static final String KEY_RECOGNITION_CUE_GAIN = "recognition_cue_gain";
    private static final String KEY_RECOGNIZE_STOP_COMMAND_ENABLED = "recognize_stop_command_enabled";
    private static final String KEY_STARTUP_PRE_ROLL_MS = "startup_pre_roll_ms";
    private static final String KEY_MEDIA_BUTTONS_ENABLED = "media_buttons_enabled";
    private static final String KEY_TTS_PREFERRED_SESSION_ONLY = "tts_preferred_session_only";
    private static final String KEY_RUNTIME_STATE = "runtime_state";
    private static final String KEY_RUNTIME_ERROR = "runtime_error";

    static final String EXTRA_AUDIO_MODE = "audioMode";
    static final String EXTRA_AUTO_LISTEN_ENABLED = "autoListenEnabled";
    static final String EXTRA_SELECTED_MIC_DEVICE_ID = "selectedMicDeviceId";
    static final String EXTRA_RECOGNITION_START_TIMEOUT_MS = "recognitionStartTimeoutMs";
    static final String EXTRA_RECOGNITION_COMPLETION_TIMEOUT_MS = "recognitionCompletionTimeoutMs";
    static final String EXTRA_RECOGNITION_END_SILENCE_MS = "recognitionEndSilenceMs";
    static final String EXTRA_SELECTED_PANEL_ID = "selectedPanelId";
    static final String EXTRA_SELECTED_SESSION_ID = "selectedSessionId";
    static final String EXTRA_PREFERRED_VOICE_SESSION_ID = "preferredVoiceSessionId";
    static final String EXTRA_SESSION_TITLES = "sessionTitles";
    static final String EXTRA_INPUT_CONTEXT_ENABLED = "inputContextEnabled";
    static final String EXTRA_INPUT_CONTEXT_LINE = "inputContextLine";
    static final String EXTRA_VOICE_ADAPTER_BASE_URL = "voiceAdapterBaseUrl";
    static final String EXTRA_ASSISTANT_BASE_URL = "assistantBaseUrl";
    static final String EXTRA_TTS_GAIN = "ttsGain";
    static final String EXTRA_RECOGNITION_CUE_ENABLED = "recognitionCueEnabled";
    static final String EXTRA_RECOGNITION_CUE_GAIN = "recognitionCueGain";
    static final String EXTRA_RECOGNIZE_STOP_COMMAND_ENABLED = "recognizeStopCommandEnabled";
    static final String EXTRA_STARTUP_PRE_ROLL_MS = "startupPreRollMs";
    static final String EXTRA_MEDIA_BUTTONS_ENABLED = "mediaButtonsEnabled";
    static final String EXTRA_TTS_PREFERRED_SESSION_ONLY = "ttsPreferredSessionOnly";

    final String audioMode;
    final boolean autoListenEnabled;
    final String selectedMicDeviceId;
    final int recognitionStartTimeoutMs;
    final int recognitionCompletionTimeoutMs;
    final int recognitionEndSilenceMs;
    final String selectedPanelId;
    final String selectedSessionId;
    final String preferredVoiceSessionId;
    final Map<String, String> sessionTitles;
    final List<String> watchedSessionIds;
    final boolean inputContextEnabled;
    final String inputContextLine;
    final String voiceAdapterBaseUrl;
    final String assistantBaseUrl;
    final float ttsGain;
    final boolean recognitionCueEnabled;
    final float recognitionCueGain;
    final boolean recognizeStopCommandEnabled;
    final int startupPreRollMs;
    final boolean mediaButtonsEnabled;
    final boolean ttsPreferredSessionOnly;

    AssistantVoiceConfig(
        String audioMode,
        boolean autoListenEnabled,
        String selectedMicDeviceId,
        int recognitionStartTimeoutMs,
        int recognitionCompletionTimeoutMs,
        int recognitionEndSilenceMs,
        String selectedPanelId,
        String selectedSessionId,
        String preferredVoiceSessionId,
        Map<String, String> sessionTitles,
        List<String> watchedSessionIds,
        boolean inputContextEnabled,
        String inputContextLine,
        String voiceAdapterBaseUrl,
        String assistantBaseUrl,
        float ttsGain,
        boolean recognitionCueEnabled,
        float recognitionCueGain,
        boolean recognizeStopCommandEnabled,
        int startupPreRollMs,
        boolean mediaButtonsEnabled,
        boolean ttsPreferredSessionOnly
    ) {
        this.audioMode = normalizeAudioMode(audioMode);
        this.autoListenEnabled = autoListenEnabled;
        this.selectedMicDeviceId = normalizeOptional(selectedMicDeviceId);
        this.recognitionStartTimeoutMs = normalizePositiveInt(
            recognitionStartTimeoutMs,
            DEFAULT_RECOGNITION_START_TIMEOUT_MS
        );
        this.recognitionCompletionTimeoutMs = normalizePositiveInt(
            recognitionCompletionTimeoutMs,
            DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS
        );
        this.recognitionEndSilenceMs = normalizePositiveInt(
            recognitionEndSilenceMs,
            DEFAULT_RECOGNITION_END_SILENCE_MS
        );
        this.selectedPanelId = normalizeOptional(selectedPanelId);
        this.selectedSessionId = normalizeOptional(selectedSessionId);
        this.preferredVoiceSessionId = normalizeOptional(preferredVoiceSessionId);
        this.sessionTitles = normalizeSessionTitleMap(sessionTitles);
        this.watchedSessionIds = normalizeSessionIdList(watchedSessionIds);
        this.inputContextEnabled = inputContextEnabled;
        this.inputContextLine = normalizeOptional(inputContextLine);
        this.voiceAdapterBaseUrl = AssistantVoiceUrlUtils.normalizeBaseUrl(
            voiceAdapterBaseUrl,
            DEFAULT_VOICE_ADAPTER_BASE_URL
        );
        this.assistantBaseUrl = AssistantVoiceUrlUtils.normalizeBaseUrl(
            assistantBaseUrl,
            DEFAULT_ASSISTANT_BASE_URL
        );
        this.ttsGain = normalizeTtsGain(ttsGain, DEFAULT_TTS_GAIN);
        this.recognitionCueEnabled = recognitionCueEnabled;
        this.recognitionCueGain = normalizeRecognitionCueGain(
            recognitionCueGain,
            DEFAULT_RECOGNITION_CUE_GAIN
        );
        this.recognizeStopCommandEnabled = recognizeStopCommandEnabled;
        this.startupPreRollMs = normalizeStartupPreRollMs(
            startupPreRollMs,
            DEFAULT_STARTUP_PRE_ROLL_MS
        );
        this.mediaButtonsEnabled = mediaButtonsEnabled;
        this.ttsPreferredSessionOnly = ttsPreferredSessionOnly;
    }

    static AssistantVoiceConfig load(Context context) {
        SharedPreferences prefs = prefs(context);
        return new AssistantVoiceConfig(
            prefs.getString(KEY_AUDIO_MODE, DEFAULT_AUDIO_MODE),
            prefs.getBoolean(KEY_AUTO_LISTEN_ENABLED, true),
            prefs.getString(KEY_SELECTED_MIC_DEVICE_ID, null),
            prefs.getInt(KEY_RECOGNITION_START_TIMEOUT_MS, DEFAULT_RECOGNITION_START_TIMEOUT_MS),
            prefs.getInt(
                KEY_RECOGNITION_COMPLETION_TIMEOUT_MS,
                DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS
            ),
            prefs.getInt(KEY_RECOGNITION_END_SILENCE_MS, DEFAULT_RECOGNITION_END_SILENCE_MS),
            prefs.getString(KEY_SELECTED_PANEL_ID, null),
            prefs.getString(KEY_SELECTED_SESSION_ID, null),
            prefs.getString(KEY_PREFERRED_VOICE_SESSION_ID, null),
            parseSessionTitleMap(prefs.getString(KEY_SESSION_TITLES, null)),
            parseSessionIdList(prefs.getString(KEY_WATCHED_SESSION_IDS, null)),
            prefs.getBoolean(KEY_INPUT_CONTEXT_ENABLED, false),
            prefs.getString(KEY_INPUT_CONTEXT_LINE, null),
            prefs.getString(KEY_VOICE_ADAPTER_BASE_URL, DEFAULT_VOICE_ADAPTER_BASE_URL),
            prefs.getString(KEY_ASSISTANT_BASE_URL, DEFAULT_ASSISTANT_BASE_URL),
            prefs.getFloat(KEY_TTS_GAIN, DEFAULT_TTS_GAIN),
            prefs.getBoolean(KEY_RECOGNITION_CUE_ENABLED, DEFAULT_RECOGNITION_CUE_ENABLED),
            prefs.getFloat(KEY_RECOGNITION_CUE_GAIN, DEFAULT_RECOGNITION_CUE_GAIN),
            prefs.getBoolean(
                KEY_RECOGNIZE_STOP_COMMAND_ENABLED,
                DEFAULT_RECOGNIZE_STOP_COMMAND_ENABLED
            ),
            prefs.getInt(KEY_STARTUP_PRE_ROLL_MS, DEFAULT_STARTUP_PRE_ROLL_MS),
            prefs.getBoolean(KEY_MEDIA_BUTTONS_ENABLED, DEFAULT_MEDIA_BUTTONS_ENABLED),
            prefs.getBoolean(KEY_TTS_PREFERRED_SESSION_ONLY, DEFAULT_TTS_PREFERRED_SESSION_ONLY)
        );
    }

    static void save(Context context, AssistantVoiceConfig config) {
        prefs(context)
            .edit()
            .putString(KEY_AUDIO_MODE, config.audioMode)
            .putBoolean(KEY_AUTO_LISTEN_ENABLED, config.autoListenEnabled)
            .putString(KEY_SELECTED_MIC_DEVICE_ID, emptyToNull(config.selectedMicDeviceId))
            .putInt(KEY_RECOGNITION_START_TIMEOUT_MS, config.recognitionStartTimeoutMs)
            .putInt(KEY_RECOGNITION_COMPLETION_TIMEOUT_MS, config.recognitionCompletionTimeoutMs)
            .putInt(KEY_RECOGNITION_END_SILENCE_MS, config.recognitionEndSilenceMs)
            .putString(KEY_SELECTED_PANEL_ID, emptyToNull(config.selectedPanelId))
            .putString(KEY_SELECTED_SESSION_ID, emptyToNull(config.selectedSessionId))
            .putString(KEY_PREFERRED_VOICE_SESSION_ID, emptyToNull(config.preferredVoiceSessionId))
            .putString(KEY_SESSION_TITLES, serializeSessionTitleMap(config.sessionTitles))
            .putString(KEY_WATCHED_SESSION_IDS, serializeSessionIdList(config.watchedSessionIds))
            .putBoolean(KEY_INPUT_CONTEXT_ENABLED, config.inputContextEnabled)
            .putString(KEY_INPUT_CONTEXT_LINE, emptyToNull(config.inputContextLine))
            .putString(KEY_VOICE_ADAPTER_BASE_URL, config.voiceAdapterBaseUrl)
            .putString(KEY_ASSISTANT_BASE_URL, config.assistantBaseUrl)
            .putFloat(KEY_TTS_GAIN, config.ttsGain)
            .putBoolean(KEY_RECOGNITION_CUE_ENABLED, config.recognitionCueEnabled)
            .putFloat(KEY_RECOGNITION_CUE_GAIN, config.recognitionCueGain)
            .putBoolean(
                KEY_RECOGNIZE_STOP_COMMAND_ENABLED,
                config.recognizeStopCommandEnabled
            )
            .putInt(KEY_STARTUP_PRE_ROLL_MS, config.startupPreRollMs)
            .putBoolean(KEY_MEDIA_BUTTONS_ENABLED, config.mediaButtonsEnabled)
            .putBoolean(KEY_TTS_PREFERRED_SESSION_ONLY, config.ttsPreferredSessionOnly)
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
            intent.hasExtra(EXTRA_SELECTED_MIC_DEVICE_ID)
                ? intent.getStringExtra(EXTRA_SELECTED_MIC_DEVICE_ID)
                : fallback.selectedMicDeviceId,
            intent.getIntExtra(
                EXTRA_RECOGNITION_START_TIMEOUT_MS,
                fallback.recognitionStartTimeoutMs
            ),
            intent.getIntExtra(
                EXTRA_RECOGNITION_COMPLETION_TIMEOUT_MS,
                fallback.recognitionCompletionTimeoutMs
            ),
            intent.getIntExtra(
                EXTRA_RECOGNITION_END_SILENCE_MS,
                fallback.recognitionEndSilenceMs
            ),
            intent.hasExtra(EXTRA_SELECTED_PANEL_ID)
                ? intent.getStringExtra(EXTRA_SELECTED_PANEL_ID)
                : fallback.selectedPanelId,
            intent.hasExtra(EXTRA_SELECTED_SESSION_ID)
                ? intent.getStringExtra(EXTRA_SELECTED_SESSION_ID)
                : fallback.selectedSessionId,
            intent.hasExtra(EXTRA_PREFERRED_VOICE_SESSION_ID)
                ? intent.getStringExtra(EXTRA_PREFERRED_VOICE_SESSION_ID)
                : fallback.preferredVoiceSessionId,
            intent.hasExtra(EXTRA_SESSION_TITLES)
                ? parseSessionTitleMap(intent.getStringExtra(EXTRA_SESSION_TITLES))
                : fallback.sessionTitles,
            fallback.watchedSessionIds,
            intent.getBooleanExtra(EXTRA_INPUT_CONTEXT_ENABLED, fallback.inputContextEnabled),
            intent.hasExtra(EXTRA_INPUT_CONTEXT_LINE)
                ? intent.getStringExtra(EXTRA_INPUT_CONTEXT_LINE)
                : fallback.inputContextLine,
            intent.hasExtra(EXTRA_VOICE_ADAPTER_BASE_URL)
                ? intent.getStringExtra(EXTRA_VOICE_ADAPTER_BASE_URL)
                : fallback.voiceAdapterBaseUrl,
            intent.hasExtra(EXTRA_ASSISTANT_BASE_URL)
                ? intent.getStringExtra(EXTRA_ASSISTANT_BASE_URL)
                : fallback.assistantBaseUrl,
            intent.getFloatExtra(EXTRA_TTS_GAIN, fallback.ttsGain),
            intent.getBooleanExtra(
                EXTRA_RECOGNITION_CUE_ENABLED,
                fallback.recognitionCueEnabled
            ),
            intent.getFloatExtra(
                EXTRA_RECOGNITION_CUE_GAIN,
                fallback.recognitionCueGain
            ),
            intent.getBooleanExtra(
                EXTRA_RECOGNIZE_STOP_COMMAND_ENABLED,
                fallback.recognizeStopCommandEnabled
            ),
            intent.getIntExtra(EXTRA_STARTUP_PRE_ROLL_MS, fallback.startupPreRollMs),
            intent.getBooleanExtra(EXTRA_MEDIA_BUTTONS_ENABLED, fallback.mediaButtonsEnabled),
            intent.getBooleanExtra(
                EXTRA_TTS_PREFERRED_SESSION_ONLY,
                fallback.ttsPreferredSessionOnly
            )
        );
    }

    Intent applyToIntent(Intent intent) {
        intent.putExtra(EXTRA_AUDIO_MODE, audioMode);
        intent.putExtra(EXTRA_AUTO_LISTEN_ENABLED, autoListenEnabled);
        intent.putExtra(EXTRA_SELECTED_MIC_DEVICE_ID, emptyToNull(selectedMicDeviceId));
        intent.putExtra(EXTRA_RECOGNITION_START_TIMEOUT_MS, recognitionStartTimeoutMs);
        intent.putExtra(EXTRA_RECOGNITION_COMPLETION_TIMEOUT_MS, recognitionCompletionTimeoutMs);
        intent.putExtra(EXTRA_RECOGNITION_END_SILENCE_MS, recognitionEndSilenceMs);
        intent.putExtra(EXTRA_SELECTED_PANEL_ID, emptyToNull(selectedPanelId));
        intent.putExtra(EXTRA_SELECTED_SESSION_ID, emptyToNull(selectedSessionId));
        intent.putExtra(EXTRA_PREFERRED_VOICE_SESSION_ID, emptyToNull(preferredVoiceSessionId));
        intent.putExtra(EXTRA_SESSION_TITLES, serializeSessionTitleMap(sessionTitles));
        intent.putExtra(EXTRA_INPUT_CONTEXT_ENABLED, inputContextEnabled);
        intent.putExtra(EXTRA_INPUT_CONTEXT_LINE, emptyToNull(inputContextLine));
        intent.putExtra(EXTRA_VOICE_ADAPTER_BASE_URL, voiceAdapterBaseUrl);
        intent.putExtra(EXTRA_ASSISTANT_BASE_URL, assistantBaseUrl);
        intent.putExtra(EXTRA_TTS_GAIN, ttsGain);
        intent.putExtra(EXTRA_RECOGNITION_CUE_ENABLED, recognitionCueEnabled);
        intent.putExtra(EXTRA_RECOGNITION_CUE_GAIN, recognitionCueGain);
        intent.putExtra(EXTRA_RECOGNIZE_STOP_COMMAND_ENABLED, recognizeStopCommandEnabled);
        intent.putExtra(EXTRA_STARTUP_PRE_ROLL_MS, startupPreRollMs);
        intent.putExtra(EXTRA_MEDIA_BUTTONS_ENABLED, mediaButtonsEnabled);
        intent.putExtra(EXTRA_TTS_PREFERRED_SESSION_ONLY, ttsPreferredSessionOnly);
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

    private static int normalizePositiveInt(int value, int fallback) {
        return value > 0 ? value : fallback;
    }

    private static float normalizeTtsGain(float value, float fallback) {
        float normalizedFallback =
            Float.isFinite(fallback) && fallback > 0f ? fallback : DEFAULT_TTS_GAIN;
        float candidate = Float.isFinite(value) && value > 0f ? value : normalizedFallback;
        if (candidate < MIN_TTS_GAIN) {
            return MIN_TTS_GAIN;
        }
        if (candidate > MAX_TTS_GAIN) {
            return MAX_TTS_GAIN;
        }
        return candidate;
    }

    static float clampRecognitionCueGain(float value) {
        return normalizeRecognitionCueGain(value, DEFAULT_RECOGNITION_CUE_GAIN);
    }

    private static float normalizeRecognitionCueGain(float value, float fallback) {
        float normalizedFallback =
            Float.isFinite(fallback) && fallback > 0f
                ? fallback
                : DEFAULT_RECOGNITION_CUE_GAIN;
        float candidate = Float.isFinite(value) && value > 0f ? value : normalizedFallback;
        if (candidate < MIN_RECOGNITION_CUE_GAIN) {
            return MIN_RECOGNITION_CUE_GAIN;
        }
        if (candidate > MAX_RECOGNITION_CUE_GAIN) {
            return MAX_RECOGNITION_CUE_GAIN;
        }
        return candidate;
    }

    private static int normalizeStartupPreRollMs(int value, int fallback) {
        int candidate = value;
        if (candidate == Integer.MIN_VALUE) {
            candidate = fallback;
        }
        if (candidate < MIN_STARTUP_PRE_ROLL_MS) {
            return MIN_STARTUP_PRE_ROLL_MS;
        }
        if (candidate > MAX_STARTUP_PRE_ROLL_MS) {
            return MAX_STARTUP_PRE_ROLL_MS;
        }
        return candidate;
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

    AssistantVoiceConfig withSelection(String panelId, String sessionId) {
        return new AssistantVoiceConfig(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            panelId,
            sessionId,
            preferredVoiceSessionId,
            sessionTitles,
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
    }

    AssistantVoiceConfig withAssistantBaseUrl(String url) {
        return new AssistantVoiceConfig(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            preferredVoiceSessionId,
            sessionTitles,
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            url,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
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
            && Objects.equals(selectedMicDeviceId, config.selectedMicDeviceId)
            && recognitionStartTimeoutMs == config.recognitionStartTimeoutMs
            && recognitionCompletionTimeoutMs == config.recognitionCompletionTimeoutMs
            && recognitionEndSilenceMs == config.recognitionEndSilenceMs
            && Objects.equals(selectedPanelId, config.selectedPanelId)
            && Objects.equals(selectedSessionId, config.selectedSessionId)
            && Objects.equals(preferredVoiceSessionId, config.preferredVoiceSessionId)
            && Objects.equals(sessionTitles, config.sessionTitles)
            && Objects.equals(watchedSessionIds, config.watchedSessionIds)
            && inputContextEnabled == config.inputContextEnabled
            && Objects.equals(inputContextLine, config.inputContextLine)
            && Objects.equals(voiceAdapterBaseUrl, config.voiceAdapterBaseUrl)
            && Objects.equals(assistantBaseUrl, config.assistantBaseUrl)
            && ttsGain == config.ttsGain
            && recognitionCueEnabled == config.recognitionCueEnabled
            && recognitionCueGain == config.recognitionCueGain
            && recognizeStopCommandEnabled == config.recognizeStopCommandEnabled
            && startupPreRollMs == config.startupPreRollMs
            && mediaButtonsEnabled == config.mediaButtonsEnabled
            && ttsPreferredSessionOnly == config.ttsPreferredSessionOnly;
    }

    @Override
    public int hashCode() {
        return Objects.hash(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            preferredVoiceSessionId,
            sessionTitles,
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
    }

    AssistantVoiceConfig withVoiceSettings(JSONObject settings) {
        if (settings == null) {
            return this;
        }
        return new AssistantVoiceConfig(
            settings.optString("audioMode", audioMode),
            settings.optBoolean("autoListenEnabled", autoListenEnabled),
            settings.optString("selectedMicDeviceId", selectedMicDeviceId),
            settings.optInt("recognitionStartTimeoutMs", recognitionStartTimeoutMs),
            settings.optInt("recognitionCompletionTimeoutMs", recognitionCompletionTimeoutMs),
            settings.optInt("recognitionEndSilenceMs", recognitionEndSilenceMs),
            selectedPanelId,
            selectedSessionId,
            settings.optString("preferredVoiceSessionId", preferredVoiceSessionId),
            sessionTitles,
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            settings.optString("voiceAdapterBaseUrl", voiceAdapterBaseUrl),
            assistantBaseUrl,
            (float) settings.optDouble("ttsGain", ttsGain),
            settings.optBoolean("recognitionCueEnabled", recognitionCueEnabled),
            (float) settings.optDouble("recognitionCueGain", recognitionCueGain),
            settings.optBoolean(
                "recognizeStopCommandEnabled",
                recognizeStopCommandEnabled
            ),
            settings.optInt("startupPreRollMs", startupPreRollMs),
            mediaButtonsEnabled,
            settings.optBoolean("ttsPreferredSessionOnly", ttsPreferredSessionOnly)
        );
    }

    AssistantVoiceConfig withInputContext(boolean enabled, String contextLine) {
        return new AssistantVoiceConfig(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            preferredVoiceSessionId,
            sessionTitles,
            watchedSessionIds,
            enabled,
            contextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
    }

    AssistantVoiceConfig withWatchedSessionIds(List<String> sessionIds) {
        return new AssistantVoiceConfig(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            preferredVoiceSessionId,
            sessionTitles,
            sessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
    }

    AssistantVoiceConfig withPreferredVoiceSessionId(String sessionId) {
        return new AssistantVoiceConfig(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            sessionId,
            sessionTitles,
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
    }

    AssistantVoiceConfig withSessionTitles(JSONObject titles) {
        return new AssistantVoiceConfig(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            preferredVoiceSessionId,
            sessionTitleMapFromJson(titles),
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
    }

    AssistantVoiceConfig withMediaButtonsEnabled(boolean enabled) {
        return new AssistantVoiceConfig(
            audioMode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            preferredVoiceSessionId,
            sessionTitles,
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            enabled,
            ttsPreferredSessionOnly
        );
    }

    AssistantVoiceConfig withAudioMode(String mode) {
        return new AssistantVoiceConfig(
            mode,
            autoListenEnabled,
            selectedMicDeviceId,
            recognitionStartTimeoutMs,
            recognitionCompletionTimeoutMs,
            recognitionEndSilenceMs,
            selectedPanelId,
            selectedSessionId,
            preferredVoiceSessionId,
            sessionTitles,
            watchedSessionIds,
            inputContextEnabled,
            inputContextLine,
            voiceAdapterBaseUrl,
            assistantBaseUrl,
            ttsGain,
            recognitionCueEnabled,
            recognitionCueGain,
            recognizeStopCommandEnabled,
            startupPreRollMs,
            mediaButtonsEnabled,
            ttsPreferredSessionOnly
        );
    }

    String getSessionTitle(String sessionId) {
        String normalized = normalizeOptional(sessionId);
        if (normalized.isEmpty()) {
            return "";
        }
        String title = sessionTitles.get(normalized);
        return title == null ? "" : title;
    }

    private static List<String> normalizeSessionIdList(List<String> values) {
        if (values == null || values.isEmpty()) {
            return Collections.emptyList();
        }
        java.util.LinkedHashSet<String> normalized = new java.util.LinkedHashSet<>();
        for (String value : values) {
            String sessionId = normalizeOptional(value);
            if (!sessionId.isEmpty()) {
                normalized.add(sessionId);
            }
        }
        if (normalized.isEmpty()) {
            return Collections.emptyList();
        }
        return Collections.unmodifiableList(new ArrayList<>(normalized));
    }

    private static Map<String, String> normalizeSessionTitleMap(Map<String, String> values) {
        if (values == null || values.isEmpty()) {
            return Collections.emptyMap();
        }
        LinkedHashMap<String, String> normalized = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry == null) {
                continue;
            }
            String sessionId = normalizeOptional(entry.getKey());
            String title = normalizeOptional(entry.getValue());
            if (!sessionId.isEmpty() && !title.isEmpty()) {
                normalized.put(sessionId, title);
            }
        }
        if (normalized.isEmpty()) {
            return Collections.emptyMap();
        }
        return Collections.unmodifiableMap(normalized);
    }

    private static List<String> parseSessionIdList(String raw) {
        String normalized = normalizeOptional(raw);
        if (normalized.isEmpty()) {
            return Collections.emptyList();
        }
        try {
            JSONArray entries = new JSONArray(normalized);
            java.util.LinkedHashSet<String> sessionIds = new java.util.LinkedHashSet<>();
            for (int index = 0; index < entries.length(); index += 1) {
                String sessionId = normalizeOptional(entries.optString(index, ""));
                if (!sessionId.isEmpty()) {
                    sessionIds.add(sessionId);
                }
            }
            if (sessionIds.isEmpty()) {
                return Collections.emptyList();
            }
            return Collections.unmodifiableList(new ArrayList<>(sessionIds));
        } catch (Exception ignored) {
            return Collections.emptyList();
        }
    }

    private static String serializeSessionIdList(List<String> values) {
        if (values == null || values.isEmpty()) {
            return null;
        }
        JSONArray entries = new JSONArray();
        for (String value : values) {
            entries.put(value);
        }
        return entries.length() == 0 ? null : entries.toString();
    }

    private static Map<String, String> sessionTitleMapFromJson(JSONObject object) {
        if (object == null) {
            return Collections.emptyMap();
        }
        LinkedHashMap<String, String> titles = new LinkedHashMap<>();
        JSONArray names = object.names();
        if (names == null) {
            return Collections.emptyMap();
        }
        for (int index = 0; index < names.length(); index += 1) {
            String key = normalizeOptional(names.optString(index));
            if (key.isEmpty()) {
                continue;
            }
            String value = normalizeOptional(object.optString(key));
            if (!value.isEmpty()) {
                titles.put(key, value);
            }
        }
        return normalizeSessionTitleMap(titles);
    }

    private static Map<String, String> parseSessionTitleMap(String raw) {
        String normalized = normalizeOptional(raw);
        if (normalized.isEmpty()) {
            return Collections.emptyMap();
        }
        try {
            return sessionTitleMapFromJson(new JSONObject(normalized));
        } catch (Exception ignored) {
            return Collections.emptyMap();
        }
    }

    private static String serializeSessionTitleMap(Map<String, String> titles) {
        Map<String, String> normalized = normalizeSessionTitleMap(titles);
        if (normalized.isEmpty()) {
            return null;
        }
        JSONObject object = new JSONObject();
        for (Map.Entry<String, String> entry : normalized.entrySet()) {
            try {
                object.put(entry.getKey(), entry.getValue());
            } catch (Exception ignored) {
            }
        }
        return object.toString();
    }
}
