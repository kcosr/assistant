package com.assistant.mobile.backend;

import android.content.Context;
import android.content.SharedPreferences;

final class AssistantBackendStore {
    private static final String PREFS_NAME = "assistant_backend_config";
    private static final String KEY_CONFIG_JSON = "config_json";

    private AssistantBackendStore() {}

    static AssistantBackendConfig load(Context context) {
        SharedPreferences preferences = preferences(context);
        String rawJson = preferences.getString(KEY_CONFIG_JSON, "");
        AssistantBackendConfig config = AssistantBackendConfig.fromJson(rawJson);
        String normalizedJson = config.toJsonString();
        if (!normalizedJson.equals(rawJson == null ? "" : rawJson)) {
            preferences.edit().putString(KEY_CONFIG_JSON, normalizedJson).apply();
        }
        return config;
    }

    static AssistantBackendConfig save(Context context, AssistantBackendConfig config) {
        preferences(context)
            .edit()
            .putString(KEY_CONFIG_JSON, config.toJsonString())
            .apply();
        return config;
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
