package com.assistant.mobile.voice;

import android.net.Uri;

final class AssistantVoiceUrlUtils {
    private AssistantVoiceUrlUtils() {}

    static String normalizeBaseUrl(String raw, String fallback) {
        String candidate = normalizeCandidate(raw, fallback);
        Uri parsed = Uri.parse(candidate);
        String scheme = parsed.getScheme();
        String authority = parsed.getEncodedAuthority();
        if (scheme == null || authority == null || authority.trim().isEmpty()) {
            return fallback;
        }

        String path = parsed.getEncodedPath();
        if (path == null || path.isEmpty()) {
            path = "";
        }
        while (path.endsWith("/") && path.length() > 1) {
            path = path.substring(0, path.length() - 1);
        }
        if ("/".equals(path)) {
            path = "";
        }

        Uri.Builder builder = new Uri.Builder()
            .scheme(scheme)
            .encodedAuthority(authority)
            .encodedPath(path);
        return builder.build().toString();
    }

    static String adapterWebSocketUrl(String baseUrl) {
        Uri base = Uri.parse(normalizeBaseUrl(baseUrl, AssistantVoiceConfig.DEFAULT_VOICE_ADAPTER_BASE_URL));
        String scheme = base.getScheme();
        String wsScheme = "https".equalsIgnoreCase(scheme) ? "wss" : "ws";
        return base.buildUpon()
            .scheme(wsScheme)
            .encodedPath(joinPath(base.getEncodedPath(), "ws"))
            .build()
            .toString();
    }

    static String adapterTtsUrl(String baseUrl) {
        return joinApiPath(baseUrl, "api/media/tts");
    }

    static String adapterTtsStopUrl(String baseUrl) {
        return joinApiPath(baseUrl, "api/media/tts/stop");
    }

    static String assistantWebSocketUrl(String baseUrl) {
        Uri base = Uri.parse(normalizeBaseUrl(baseUrl, AssistantVoiceConfig.DEFAULT_ASSISTANT_BASE_URL));
        String scheme = base.getScheme();
        String wsScheme = "https".equalsIgnoreCase(scheme) ? "wss" : "ws";
        return base.buildUpon()
            .scheme(wsScheme)
            .encodedPath(joinPath(base.getEncodedPath(), "ws"))
            .build()
            .toString();
    }

    static String assistantSessionEventsUrl(String baseUrl) {
        return joinApiPath(baseUrl, "api/plugins/sessions/operations/events");
    }

    static String assistantSessionListUrl(String baseUrl) {
        return joinApiPath(baseUrl, "api/plugins/sessions/operations/list");
    }

    static String assistantSessionMessageUrl(String baseUrl) {
        return joinApiPath(baseUrl, "api/plugins/sessions/operations/message");
    }

    static String assistantNotificationListUrl(String baseUrl) {
        return joinApiPath(baseUrl, "api/plugins/notifications/operations/list");
    }

    static String assistantNotificationClearUrl(String baseUrl) {
        return joinApiPath(baseUrl, "api/plugins/notifications/operations/clear");
    }

    private static String joinApiPath(String baseUrl, String suffix) {
        Uri base = Uri.parse(normalizeBaseUrl(baseUrl, AssistantVoiceConfig.DEFAULT_ASSISTANT_BASE_URL));
        return base.buildUpon()
            .encodedPath(joinPath(base.getEncodedPath(), suffix))
            .build()
            .toString();
    }

    private static String normalizeCandidate(String raw, String fallback) {
        String normalized = raw == null ? "" : raw.trim();
        return normalized.isEmpty() ? fallback : normalized;
    }

    private static String joinPath(String existingPath, String suffix) {
        String left = existingPath == null ? "" : existingPath.trim();
        String right = suffix == null ? "" : suffix.trim();
        if (left.isEmpty() || "/".equals(left)) {
            return "/" + right;
        }
        if (left.endsWith("/")) {
            return left + right;
        }
        return left + "/" + right;
    }
}
