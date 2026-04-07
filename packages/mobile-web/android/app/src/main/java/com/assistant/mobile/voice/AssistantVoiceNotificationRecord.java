package com.assistant.mobile.voice;

final class AssistantVoiceNotificationRecord {
    final String id;
    final String kind;
    final String source;
    final String title;
    final String body;
    final String readAt;
    final String sessionId;
    final String sessionTitle;
    final String voiceMode;
    final String ttsText;
    final String sourceEventId;
    final Integer sessionActivitySeq;

    AssistantVoiceNotificationRecord(
        String id,
        String kind,
        String source,
        String title,
        String body,
        String readAt,
        String sessionId,
        String sessionTitle,
        String voiceMode,
        String ttsText,
        String sourceEventId,
        Integer sessionActivitySeq
    ) {
        this.id = trim(id);
        this.kind = trim(kind);
        this.source = trim(source);
        this.title = trim(title);
        this.body = trim(body);
        this.readAt = trim(readAt);
        this.sessionId = trim(sessionId);
        this.sessionTitle = trim(sessionTitle);
        this.voiceMode = trim(voiceMode);
        this.ttsText = trim(ttsText);
        this.sourceEventId = trim(sourceEventId);
        this.sessionActivitySeq = sessionActivitySeq;
    }

    boolean isUnread() {
        return readAt.isEmpty();
    }

    boolean isSessionLinked() {
        return !sessionId.isEmpty();
    }

    boolean isSessionAttention() {
        return "session_attention".equals(kind);
    }

    String resolveSpokenText() {
        if (!ttsText.isEmpty()) {
            return ttsText;
        }
        if (!body.isEmpty()) {
            return body;
        }
        if (!title.isEmpty()) {
            return title;
        }
        return "";
    }

    AssistantVoiceQueueItem toAutomaticQueueItem(boolean autoListenEnabled) {
        String spokenText = resolveSpokenText();
        if (spokenText.isEmpty()) {
            return null;
        }
        String executionMode = "speak";
        if ("speak_then_listen".equals(voiceMode) && autoListenEnabled) {
            executionMode = "speak_then_listen";
        }
        return new AssistantVoiceQueueItem(
            id,
            kind,
            source,
            sourceEventId,
            sessionId,
            sessionTitle,
            spokenText,
            executionMode,
            sessionActivitySeq,
            false,
            false
        );
    }

    AssistantVoiceQueueItem toManualSpeakerQueueItem() {
        String spokenText = resolveSpokenText();
        if (spokenText.isEmpty()) {
            return null;
        }
        return new AssistantVoiceQueueItem(
            id,
            kind,
            source,
            sourceEventId,
            sessionId,
            sessionTitle,
            spokenText,
            "speak",
            sessionActivitySeq,
            true,
            true
        );
    }

    AssistantVoiceQueueItem toManualMicQueueItem(boolean autoListenEnabled) {
        String spokenText = resolveSpokenText();
        String executionMode = spokenText.isEmpty() ? "listen_only" : "speak_then_listen";
        return new AssistantVoiceQueueItem(
            id,
            kind,
            source,
            sourceEventId,
            sessionId,
            sessionTitle,
            spokenText,
            executionMode,
            sessionActivitySeq,
            true,
            true
        );
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
