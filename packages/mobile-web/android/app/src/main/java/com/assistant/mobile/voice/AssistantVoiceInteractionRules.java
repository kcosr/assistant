package com.assistant.mobile.voice;

final class AssistantVoiceInteractionRules {
    private AssistantVoiceInteractionRules() {}

    static boolean isVoicePromptTool(String toolName) {
        return "voice_speak".equals(toolName) || "voice_ask".equals(toolName);
    }

    static boolean shouldAutoplayPrompt(
        boolean voiceModeEnabled,
        String selectedSessionId,
        String promptSessionId,
        boolean idle
    ) {
        if (!voiceModeEnabled || !idle) {
            return false;
        }
        String selected = selectedSessionId == null ? "" : selectedSessionId.trim();
        String prompt = promptSessionId == null ? "" : promptSessionId.trim();
        return !selected.isEmpty() && selected.equals(prompt);
    }

    static boolean shouldStartRecognitionAfterManualStop(String toolName, boolean manualListenRequested) {
        return manualListenRequested || "voice_ask".equals(toolName);
    }

    static boolean shouldSendSttEndAfterMicStops(String activeRequestId, String stoppedRequestId) {
        String active = activeRequestId == null ? "" : activeRequestId.trim();
        String stopped = stoppedRequestId == null ? "" : stoppedRequestId.trim();
        return !active.isEmpty() && active.equals(stopped);
    }
}
