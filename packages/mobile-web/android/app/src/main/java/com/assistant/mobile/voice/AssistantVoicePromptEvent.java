package com.assistant.mobile.voice;

final class AssistantVoicePromptEvent {
    final String eventId;
    final String sessionId;
    final String requestId;
    final String toolCallId;
    final String toolName;
    final String text;
    final String turnOriginId;

    AssistantVoicePromptEvent(
        String eventId,
        String sessionId,
        String toolCallId,
        String toolName,
        String text,
        String turnOriginId
    ) {
        this(eventId, sessionId, "", toolCallId, toolName, text, turnOriginId);
    }

    AssistantVoicePromptEvent(
        String eventId,
        String sessionId,
        String requestId,
        String toolCallId,
        String toolName,
        String text,
        String turnOriginId
    ) {
        this.eventId = eventId;
        this.sessionId = sessionId;
        this.requestId = requestId;
        this.toolCallId = toolCallId;
        this.toolName = toolName;
        this.text = text;
        this.turnOriginId = trim(turnOriginId);
    }

    boolean isToolPrompt() {
        return AssistantVoiceInteractionRules.isVoicePromptTool(toolName);
    }

    boolean isAssistantResponse() {
        return "assistant_response".equals(toolName);
    }

    boolean isInteractionEnd() {
        return "interaction_end".equals(toolName);
    }

    boolean startsListeningAfterPlayback() {
        return "voice_ask".equals(toolName);
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
