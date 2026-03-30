package com.assistant.mobile.voice;

import org.json.JSONObject;

final class AssistantVoiceEventParser {
    private AssistantVoiceEventParser() {}

    static AssistantVoicePromptEvent parsePromptEvent(JSONObject event) {
        if (event == null) {
            return null;
        }
        if (!"tool_call".equals(event.optString("type"))) {
            return null;
        }

        JSONObject payload = event.optJSONObject("payload");
        if (payload == null) {
            return null;
        }

        String toolName = trim(payload.optString("toolName"));
        if (!AssistantVoiceInteractionRules.isVoicePromptTool(toolName)) {
            return null;
        }

        JSONObject args = payload.optJSONObject("args");
        String text = trim(args == null ? null : args.optString("text"));
        if (text.isEmpty()) {
            return null;
        }

        String eventId = trim(event.optString("id"));
        String sessionId = trim(event.optString("sessionId"));
        String toolCallId = trim(payload.optString("toolCallId"));
        if (eventId.isEmpty() || sessionId.isEmpty() || toolCallId.isEmpty()) {
            return null;
        }

        return new AssistantVoicePromptEvent(eventId, sessionId, toolCallId, toolName, text);
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
