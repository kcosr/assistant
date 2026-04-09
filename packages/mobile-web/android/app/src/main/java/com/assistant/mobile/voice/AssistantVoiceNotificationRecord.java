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

    String resolveSpokenText(boolean includeTitle) {
        return resolveSpokenText(includeTitle, null);
    }

    String resolveSpokenText(boolean includeTitle, String titleOverride) {
        String speech = "";
        if (!ttsText.isEmpty()) {
            speech = ttsText;
        } else if (!body.isEmpty()) {
            speech = body;
        } else if (!title.isEmpty()) {
            speech = title;
        }
        String spokenTitle = resolveSpokenTitle(titleOverride);
        if (!includeTitle || spokenTitle.isEmpty() || speech.isEmpty() || spokenTitle.equals(speech)) {
            return speech;
        }
        return spokenTitle + ": " + speech;
    }

    AssistantVoiceQueueItem toAutomaticQueueItem(
        boolean autoListenEnabled,
        boolean includeTitle,
        String titleOverride
    ) {
        String spokenText = resolveSpokenText(includeTitle, titleOverride);
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
            resolveSpokenTitle(titleOverride),
            spokenText,
            executionMode,
            sessionActivitySeq,
            false,
            false
        );
    }

    AssistantVoiceQueueItem toManualSpeakerQueueItem(boolean includeTitle, String titleOverride) {
        String spokenText = resolveSpokenText(includeTitle, titleOverride);
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
            resolveSpokenTitle(titleOverride),
            spokenText,
            "speak",
            sessionActivitySeq,
            true,
            true
        );
    }

    AssistantVoiceQueueItem toManualMicQueueItem(boolean autoListenEnabled) {
        return new AssistantVoiceQueueItem(
            id,
            kind,
            source,
            sourceEventId,
            sessionId,
            sessionTitle,
            resolveSpokenTitle(null),
            "",
            "listen_only",
            sessionActivitySeq,
            true,
            true
        );
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private String resolveSpokenTitle(String titleOverride) {
        String normalizedOverride = trim(titleOverride);
        if (!normalizedOverride.isEmpty()) {
            return normalizedOverride;
        }
        if (isSessionLinked() && !sessionTitle.isEmpty()) {
            return sessionTitle;
        }
        return title;
    }
}
