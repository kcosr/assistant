package com.assistant.mobile.voice;

import java.util.LinkedHashSet;
import java.util.Set;

final class AssistantVoiceRequestTracker {
    private final int capacity;
    private final Set<String> requestKeys = new LinkedHashSet<>();

    AssistantVoiceRequestTracker(int capacity) {
        this.capacity = Math.max(1, capacity);
    }

    void remember(String sessionId, String requestId) {
        String key = requestKey(sessionId, requestId);
        if (key.isEmpty()) {
            return;
        }
        requestKeys.remove(key);
        requestKeys.add(key);
        while (requestKeys.size() > capacity) {
            requestKeys.remove(requestKeys.iterator().next());
        }
    }

    boolean consume(String sessionId, String requestId) {
        String key = requestKey(sessionId, requestId);
        return !key.isEmpty() && requestKeys.remove(key);
    }

    private static String requestKey(String sessionId, String requestId) {
        String normalizedSessionId = trim(sessionId);
        String normalizedRequestId = trim(requestId);
        if (normalizedSessionId.isEmpty() || normalizedRequestId.isEmpty()) {
            return "";
        }
        return normalizedSessionId + "\n" + normalizedRequestId;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
