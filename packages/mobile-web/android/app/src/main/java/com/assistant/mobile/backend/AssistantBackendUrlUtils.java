package com.assistant.mobile.backend;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

final class AssistantBackendUrlUtils {
    private AssistantBackendUrlUtils() {}

    static String normalizeUrl(String raw) {
        if (raw == null) {
            return "";
        }
        String trimmed = raw.trim();
        if (trimmed.isEmpty()) {
            return "";
        }

        URI parsed;
        try {
            parsed = new URI(trimmed);
        } catch (URISyntaxException ignored) {
            return "";
        }
        String scheme = parsed.getScheme();
        String authority = parsed.getRawAuthority();
        if (scheme == null || authority == null || authority.trim().isEmpty()) {
            return "";
        }

        String normalizedScheme = scheme.toLowerCase(Locale.US);
        if (!"http".equals(normalizedScheme) && !"https".equals(normalizedScheme)) {
            return "";
        }

        String path = parsed.getRawPath();
        if (path == null || path.isEmpty()) {
            path = "";
        }
        while (path.endsWith("/") && path.length() > 1) {
            path = path.substring(0, path.length() - 1);
        }
        if ("/".equals(path)) {
            path = "";
        }

        try {
            return new URI(normalizedScheme, authority, path, null, null).toString();
        } catch (URISyntaxException ignored) {
            return "";
        }
    }

    static String defaultLabel(String normalizedUrl) {
        if (normalizedUrl == null || normalizedUrl.trim().isEmpty()) {
            return "";
        }
        URI parsed;
        try {
            parsed = new URI(normalizedUrl);
        } catch (URISyntaxException ignored) {
            return normalizedUrl;
        }
        String authority = parsed.getRawAuthority();
        String path = parsed.getRawPath();
        String label = authority == null ? "" : authority.trim();
        if (path != null && !path.isEmpty() && !"/".equals(path)) {
            label = label.isEmpty() ? path : label + path;
        }
        return label.isEmpty() ? normalizedUrl : label;
    }
}
