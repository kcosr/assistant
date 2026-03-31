package com.assistant.mobile.voice;

final class AssistantVoiceInteractionRules {
    private AssistantVoiceInteractionRules() {}

    static boolean isVoicePromptTool(String toolName) {
        return "voice_speak".equals(toolName) || "voice_ask".equals(toolName);
    }

    static boolean shouldAutoplayEvent(
        String audioMode,
        AssistantVoicePromptEvent prompt,
        boolean idle
    ) {
        if (prompt == null || !idle) {
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

    static boolean shouldShowNotificationStopAction(
        boolean promptPlaybackActive,
        boolean listeningActive
    ) {
        return promptPlaybackActive || listeningActive;
    }

    static boolean shouldShowNotificationSpeakAction(
        boolean voiceEnabled,
        String preferredVoiceSessionId,
        boolean promptPlaybackActive,
        boolean listeningActive,
        boolean runtimeConnected
    ) {
        String sessionId = preferredVoiceSessionId == null ? "" : preferredVoiceSessionId.trim();
        return voiceEnabled
            && !sessionId.isEmpty()
            && !promptPlaybackActive
            && !listeningActive
            && runtimeConnected;
    }
}
