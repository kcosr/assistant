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

        AssistantVoiceQueueItem item = AssistantVoiceQueueItem.fromPrompt(
            prompt,
            true,
            false,
            ""
        );

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

        AssistantVoiceQueueItem item = AssistantVoiceQueueItem.fromPrompt(
            prompt,
            false,
            false,
            ""
        );

        assertNotNull(item);
        assertEquals("speak", item.executionMode);
        assertEquals("response-2", item.dedupKey());
    }

    @Test
    public void fromPromptReturnsNullWithoutSessionOrSpeech() {
        assertNull(
            AssistantVoiceQueueItem.fromPrompt(
                new AssistantVoicePromptEvent("event-3", "", "", "voice_speak", "Hello"),
                true,
                false,
                ""
            )
        );
        assertNull(
            AssistantVoiceQueueItem.fromPrompt(
                new AssistantVoicePromptEvent("event-4", "session-4", "", "voice_speak", " "),
                true,
                false,
                ""
            )
        );
    }

    @Test
    public void fromPromptPrefixesAssistantResponseWithSessionTitleWhenEnabled() {
        AssistantVoicePromptEvent prompt = new AssistantVoicePromptEvent(
            "event-5",
            "session-5",
            "response-5",
            "assistant_response",
            "Answer"
        );

        AssistantVoiceQueueItem item = AssistantVoiceQueueItem.fromPrompt(
            prompt,
            false,
            true,
            "Project Alpha"
        );

        assertNotNull(item);
        assertEquals("Project Alpha", item.sessionTitle);
        assertEquals("Project Alpha: Answer", item.spokenText);
    }

    @Test
    public void fromPromptLeavesNonAssistantPromptUnprefixedWhenTitlePlaybackEnabled() {
        AssistantVoicePromptEvent prompt = new AssistantVoicePromptEvent(
            "event-6",
            "session-6",
            "call-6",
            "voice_ask",
            "Question?"
        );

        AssistantVoiceQueueItem item = AssistantVoiceQueueItem.fromPrompt(
            prompt,
            true,
            true,
            "Project Beta"
        );

        assertNotNull(item);
        assertEquals("Question?", item.spokenText);
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

        AssistantVoiceQueueItem automaticItem = notification.toAutomaticQueueItem(true, false, null);
        AssistantVoiceQueueItem manualItem = notification.toManualSpeakerQueueItem(false, null);

        assertNotNull(automaticItem);
        assertNotNull(manualItem);
        assertEquals("", automaticItem.sessionId);
        assertEquals("", manualItem.sessionId);
        assertTrue(!automaticItem.requiresSession());
        assertTrue(!manualItem.requiresSession());
        assertEquals("Alternate speech", automaticItem.spokenText);
    }

    @Test
    public void sessionLinkedNotificationUsesSessionTitleForSpokenPrefix() {
        AssistantVoiceNotificationRecord notification = new AssistantVoiceNotificationRecord(
            "notif-2",
            "session_attention",
            "system",
            "Latest assistant reply",
            "Reply body",
            "",
            "session-2",
            "Project Alpha",
            "speak",
            "Speak me",
            "event-2",
            Integer.valueOf(3)
        );

        AssistantVoiceQueueItem item = notification.toAutomaticQueueItem(
            true,
            true,
            null
        );

        assertNotNull(item);
        assertEquals("Project Alpha: Speak me", item.spokenText);
    }
}
