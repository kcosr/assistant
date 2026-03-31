package com.assistant.mobile.backend;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

final class AssistantBackendEntry {
    static final String DEFAULT_ID = "assistant";
    static final String DEFAULT_LABEL = "Assistant";
    static final String DEFAULT_URL = "https://assistant";

    final String id;
    final String label;
    final String url;

    AssistantBackendEntry(String id, String label, String url) {
        this.id = normalizeId(id);
        this.url = AssistantBackendUrlUtils.normalizeUrl(url);
        this.label = normalizeLabel(label, this.url);
    }

    static AssistantBackendEntry createDefault() {
        return new AssistantBackendEntry(DEFAULT_ID, DEFAULT_LABEL, DEFAULT_URL);
    }

    static AssistantBackendEntry create(String label, String url) {
        String normalizedUrl = AssistantBackendUrlUtils.normalizeUrl(url);
        if (normalizedUrl.isEmpty()) {
            return null;
        }
        return new AssistantBackendEntry(
            UUID.randomUUID().toString(),
            normalizeLabel(label, normalizedUrl),
            normalizedUrl
        );
    }

    static AssistantBackendEntry fromJson(JSONObject jsonObject) {
        if (jsonObject == null) {
            return null;
        }
        AssistantBackendEntry entry = new AssistantBackendEntry(
            jsonObject.optString("id", ""),
            jsonObject.optString("label", ""),
            jsonObject.optString("url", "")
        );
        if (entry.id.isEmpty() || entry.url.isEmpty()) {
            return null;
        }
        return entry;
    }

    JSONObject toJson() throws JSONException {
        JSONObject jsonObject = new JSONObject();
        jsonObject.put("id", id);
        jsonObject.put("label", label);
        jsonObject.put("url", url);
        return jsonObject;
    }

    private static String normalizeId(String value) {
        if (value == null) {
            return "";
        }
        return value.trim();
    }

    private static String normalizeLabel(String value, String normalizedUrl) {
        String trimmed = value == null ? "" : value.trim();
        if (!trimmed.isEmpty()) {
            return trimmed;
        }
        return AssistantBackendUrlUtils.defaultLabel(normalizedUrl);
    }
}
