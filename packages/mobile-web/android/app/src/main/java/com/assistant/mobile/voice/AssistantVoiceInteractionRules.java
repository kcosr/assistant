package com.assistant.mobile.voice;

final class AssistantVoiceInteractionRules {
    private AssistantVoiceInteractionRules() {}

    static boolean isVoicePromptTool(String toolName) {
        return "voice_speak".equals(toolName) || "voice_ask".equals(toolName);
    }

    static boolean shouldAutoplayEvent(
        String audioMode,
        String selectedSessionId,
        AssistantVoicePromptEvent prompt,
        boolean idle
    ) {
        if (prompt == null || !idle) {
            return false;
        }
        String selected = selectedSessionId == null ? "" : selectedSessionId.trim();
        String promptSessionId = prompt.sessionId == null ? "" : prompt.sessionId.trim();
        if (selected.isEmpty() || !selected.equals(promptSessionId)) {
            return false;
        }
        if (AssistantVoiceConfig.AUDIO_MODE_TOOL.equals(audioMode)) {
            return prompt.isToolPrompt();
        }
        if (AssistantVoiceConfig.AUDIO_MODE_RESPONSE.equals(audioMode)) {
            return prompt.isAssistantResponse();
        }
        return false;
    }

    static boolean shouldStartRecognitionAfterManualStop(String toolName, boolean manualListenRequested) {
        return shouldStartRecognitionAfterManualStop(toolName, manualListenRequested, false);
    }

    static boolean shouldStartRecognitionAfterManualStop(
        String toolName,
        boolean manualListenRequested,
        boolean autoListenEnabled
    ) {
        return manualListenRequested || shouldStartRecognitionAfterPlayback(toolName, autoListenEnabled);
    }

    static boolean shouldStartRecognitionAfterPlayback(String toolName, boolean autoListenEnabled) {
        if (!autoListenEnabled) {
            return false;
        }
        return "voice_ask".equals(toolName) || "assistant_response".equals(toolName);
    }

    static boolean shouldSendSttEndAfterMicStops(String activeRequestId, String stoppedRequestId) {
        String active = activeRequestId == null ? "" : activeRequestId.trim();
        String stopped = stoppedRequestId == null ? "" : stoppedRequestId.trim();
        return !active.isEmpty() && active.equals(stopped);
    }
}
