package com.assistant.mobile.voice;

import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public final class AssistantVoiceQueueItemTest {
    @Test
    public void fromPromptBuildsSpeakThenListenForVoiceAskWhenAutoListenEnabled() {
        AssistantVoicePromptEvent prompt = new AssistantVoicePromptEvent(
            "event-1",
            "session-1",
            "call-1",
            "voice_ask",
            "Question?"
        );

        AssistantVoiceQueueItem item = AssistantVoiceQueueItem.fromPrompt(prompt, true);

        assertNotNull(item);
        assertEquals("session-1", item.sessionId);
        assertEquals("Question?", item.spokenText);
        assertEquals("speak_then_listen", item.executionMode);
        assertEquals("call-1", item.dedupKey());
    }

    @Test
    public void fromPromptBuildsSpeakForAssistantResponseWithoutAutoListen() {
        AssistantVoicePromptEvent prompt = new AssistantVoicePromptEvent(
            "event-2",
            "session-2",
            "response-2",
            "assistant_response",
            "Answer"
        );

        AssistantVoiceQueueItem item = AssistantVoiceQueueItem.fromPrompt(prompt, false);

        assertNotNull(item);
        assertEquals("speak", item.executionMode);
        assertEquals("response-2", item.dedupKey());
    }

    @Test
    public void fromPromptReturnsNullWithoutSessionOrSpeech() {
        assertNull(
            AssistantVoiceQueueItem.fromPrompt(
                new AssistantVoicePromptEvent("event-3", "", "", "voice_speak", "Hello"),
                true
            )
        );
        assertNull(
            AssistantVoiceQueueItem.fromPrompt(
                new AssistantVoicePromptEvent("event-4", "session-4", "", "voice_speak", " "),
                true
            )
        );
    }

    @Test
    public void manualNotificationMicSkipsPlaybackAndStartsListeningImmediately() {
        AssistantVoiceNotificationRecord notification = new AssistantVoiceNotificationRecord(
            "notif-1",
            "session_attention",
            "system",
            "Latest assistant reply",
            "Reply body",
            "",
            "session-1",
            "Session 1",
            "speak_then_listen",
            "Reply body",
            "event-1",
            Integer.valueOf(7)
        );

        AssistantVoiceQueueItem item = notification.toManualMicQueueItem(true);

        assertNotNull(item);
        assertEquals("listen_only", item.executionMode);
        assertEquals("", item.spokenText);
        assertTrue(item.isListenOnly());
    }

    @Test
    public void toolNotificationSpeakerPlaybackDoesNotRequireASession() {
        AssistantVoiceNotificationRecord notification = new AssistantVoiceNotificationRecord(
            "notif-tool",
            "notification",
            "tool",
            "TEST",
            "This is a test",
            "",
            "",
            "",
            "speak",
            "Alternate speech",
            "event-tool",
            null
        );

        AssistantVoiceQueueItem automaticItem = notification.toAutomaticQueueItem(true, false);
        AssistantVoiceQueueItem manualItem = notification.toManualSpeakerQueueItem(false);

        assertNotNull(automaticItem);
        assertNotNull(manualItem);
        assertEquals("", automaticItem.sessionId);
        assertEquals("", manualItem.sessionId);
        assertTrue(!automaticItem.requiresSession());
        assertTrue(!manualItem.requiresSession());
        assertEquals("Alternate speech", automaticItem.spokenText);
    }
}
