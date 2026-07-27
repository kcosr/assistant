package com.assistant.mobile.voice;

final class AssistantVoicePromptEvent {
    final String eventId;
    final String sessionId;
    final String requestId;
    final String toolCallId;
    final String toolName;
    final String text;

    AssistantVoicePromptEvent(
        String eventId,
        String sessionId,
        String toolCallId,
        String toolName,
        String text
    ) {
        this(eventId, sessionId, "", toolCallId, toolName, text);
    }

    AssistantVoicePromptEvent(
        String eventId,
        String sessionId,
        String requestId,
        String toolCallId,
        String toolName,
        String text
    ) {
        this.eventId = eventId;
        this.sessionId = sessionId;
        this.requestId = requestId;
        this.toolCallId = toolCallId;
        this.toolName = toolName;
        this.text = text;
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
}
