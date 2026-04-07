package com.assistant.mobile.voice;

final class AssistantVoiceQueueItem {
    final String notificationId;
    final String notificationKind;
    final String source;
    final String sourceEventId;
    final String sessionId;
    final String sessionTitle;
    final String spokenText;
    final String executionMode;
    final Integer sessionActivitySeq;
    final boolean manual;
    final boolean allowListenWithoutValidation;

    AssistantVoiceQueueItem(
        String notificationId,
        String notificationKind,
        String source,
        String sourceEventId,
        String sessionId,
        String sessionTitle,
        String spokenText,
        String executionMode,
        Integer sessionActivitySeq,
        boolean manual,
        boolean allowListenWithoutValidation
    ) {
        this.notificationId = trim(notificationId);
        this.notificationKind = trim(notificationKind);
        this.source = trim(source);
        this.sourceEventId = trim(sourceEventId);
        this.sessionId = trim(sessionId);
        this.sessionTitle = trim(sessionTitle);
        this.spokenText = trim(spokenText);
        this.executionMode = trim(executionMode);
        this.sessionActivitySeq = sessionActivitySeq;
        this.manual = manual;
        this.allowListenWithoutValidation = allowListenWithoutValidation;
    }

    boolean hasSpeech() {
        return !spokenText.isEmpty();
    }

    boolean isListenOnly() {
        return "listen_only".equals(executionMode);
    }

    boolean startsListeningAfterPlayback() {
        return "speak_then_listen".equals(executionMode);
    }

    boolean requiresListenValidation() {
        return startsListeningAfterPlayback() && !allowListenWithoutValidation && sessionActivitySeq != null;
    }

    boolean isSessionAttention() {
        return "session_attention".equals(notificationKind);
    }

    String dedupKey() {
        if (!sourceEventId.isEmpty()) {
            return sourceEventId;
        }
        return notificationId;
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
