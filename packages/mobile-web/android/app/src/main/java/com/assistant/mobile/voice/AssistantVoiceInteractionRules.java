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

    static boolean shouldAdmitAutomaticResponse(
        boolean localResponseVoiceOnlyEnabled,
        String localTurnOriginId,
        String responseTurnOriginId
    ) {
        if (!localResponseVoiceOnlyEnabled) {
            return true;
        }
        String local = trim(localTurnOriginId);
        String response = trim(responseTurnOriginId);
        return response.isEmpty() || (!local.isEmpty() && local.equals(response));
    }

    static boolean shouldSuppressAutoListenForAutomaticResponse(String responseTurnOriginId) {
        return trim(responseTurnOriginId).isEmpty();
    }

    static boolean shouldAutoListenForSettledTurn(
        boolean autoListenEnabled,
        boolean localResponseVoiceOnlyEnabled,
        String localTurnOriginId,
        AssistantVoiceTurnSettledEvent event,
        boolean interactionEnded,
        boolean voiceAskStarted
    ) {
        return autoListenEnabled
            && event != null
            && "completed".equals(event.status)
            && !event.hasSpeakableOutput
            && !interactionEnded
            && !voiceAskStarted
            && !shouldSuppressAutoListenForAutomaticResponse(event.turnOriginId)
            && shouldAdmitAutomaticResponse(
                localResponseVoiceOnlyEnabled,
                localTurnOriginId,
                event.turnOriginId
            );
    }

    static boolean shouldAdmitAutomaticNotification(
        boolean localResponseVoiceOnlyEnabled,
        String localTurnOriginId,
        AssistantVoiceNotificationRecord notification
    ) {
        return notification == null
            || !notification.isAssistantResponseNotification()
            || shouldAdmitAutomaticResponse(
                localResponseVoiceOnlyEnabled,
                localTurnOriginId,
                notification.turnOriginId
            );
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

    static boolean shouldAutoListenAfterAutomaticNotification(
        String audioMode,
        boolean autoListenEnabled
    ) {
        return autoListenEnabled && !AssistantVoiceConfig.AUDIO_MODE_MANUAL.equals(audioMode);
    }

    static boolean shouldAutoListenAfterManualAssistantMessage(
        String audioMode,
        boolean autoListenEnabled,
        AssistantVoicePromptEvent prompt,
        boolean idle
    ) {
        return AssistantVoiceConfig.AUDIO_MODE_MANUAL.equals(audioMode)
            && autoListenEnabled
            && prompt != null
            && prompt.isAssistantResponse()
            && idle;
    }

    static boolean shouldAutoListenAfterManualAssistantNotification(
        String audioMode,
        boolean autoListenEnabled,
        AssistantVoiceNotificationRecord notification
    ) {
        return AssistantVoiceConfig.AUDIO_MODE_MANUAL.equals(audioMode)
            && autoListenEnabled
            && notification != null
            && notification.isUnread()
            && notification.isSessionAttention()
            && notification.isSessionLinked();
    }

    static boolean shouldAutoplayNotification(
        String audioMode,
        boolean standaloneNotificationPlaybackEnabled,
        AssistantVoiceNotificationRecord notification
    ) {
        if (notification == null || !notification.isUnread()) {
            return false;
        }
        if (notification.isSessionAttention()) {
            return AssistantVoiceConfig.AUDIO_MODE_RESPONSE.equals(audioMode);
        }
        if ("none".equals(notification.voiceMode)) {
            return false;
        }
        return standaloneNotificationPlaybackEnabled;
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
        return shouldShowNotificationStopAction(promptPlaybackActive, listeningActive, false);
    }

    static boolean shouldShowNotificationStopAction(
        boolean promptPlaybackActive,
        boolean listeningActive,
        boolean realtimeActive
    ) {
        return promptPlaybackActive || listeningActive || realtimeActive;
    }

    static boolean shouldShowNotificationSpeakAction(
        boolean voiceEnabled,
        String preferredVoiceSessionId,
        boolean promptPlaybackActive,
        boolean listeningActive,
        boolean runtimeConnected
    ) {
        return shouldShowNotificationSpeakAction(
            voiceEnabled,
            preferredVoiceSessionId,
            promptPlaybackActive,
            listeningActive,
            runtimeConnected,
            false,
            false
        );
    }

    static boolean shouldShowNotificationSpeakAction(
        boolean voiceEnabled,
        String preferredVoiceSessionId,
        boolean promptPlaybackActive,
        boolean listeningActive,
        boolean runtimeConnected,
        boolean realtimeMode,
        boolean realtimeActive
    ) {
        if (!voiceEnabled || promptPlaybackActive || listeningActive || realtimeActive) {
            return false;
        }
        if (realtimeMode) {
            // Realtime does not require a preferred Thread session id.
            return true;
        }
        String sessionId = preferredVoiceSessionId == null ? "" : preferredVoiceSessionId.trim();
        return !sessionId.isEmpty() && runtimeConnected;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
