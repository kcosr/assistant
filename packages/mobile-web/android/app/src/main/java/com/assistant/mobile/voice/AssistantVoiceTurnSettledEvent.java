package com.assistant.mobile.voice;

import org.json.JSONObject;

final class AssistantVoiceTurnSettledEvent {
    final String sessionId;
    final String requestId;
    final String responseId;
    final String status;
    final boolean hasSpeakableOutput;
    final String turnOriginId;

    AssistantVoiceTurnSettledEvent(
        String sessionId,
        String requestId,
        String responseId,
        String status,
        boolean hasSpeakableOutput,
        String turnOriginId
    ) {
        this.sessionId = trim(sessionId);
        this.requestId = trim(requestId);
        this.responseId = trim(responseId);
        this.status = trim(status);
        this.hasSpeakableOutput = hasSpeakableOutput;
        this.turnOriginId = trim(turnOriginId);
    }

    static AssistantVoiceTurnSettledEvent parse(String rawMessage) {
        if (rawMessage == null || rawMessage.trim().isEmpty()) {
            return null;
        }
        try {
            JSONObject message = new JSONObject(rawMessage);
            if (!"turn_settled".equals(trim(message.optString("type")))) {
                return null;
            }
            AssistantVoiceTurnSettledEvent event = new AssistantVoiceTurnSettledEvent(
                message.optString("sessionId"),
                message.optString("requestId"),
                message.optString("responseId"),
                message.optString("status"),
                message.optBoolean("hasSpeakableOutput", false),
                message.optString("turnOriginId")
            );
            if (
                event.sessionId.isEmpty()
                    || event.requestId.isEmpty()
                    || event.responseId.isEmpty()
                    || event.status.isEmpty()
            ) {
                return null;
            }
            return event;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
