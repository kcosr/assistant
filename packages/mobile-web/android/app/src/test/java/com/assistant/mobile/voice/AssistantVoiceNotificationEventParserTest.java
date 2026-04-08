package com.assistant.mobile.voice;

import org.junit.Test;

import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public final class AssistantVoiceNotificationEventParserTest {
    @Test
    public void parsesNotificationPanelEvents() {
        String message = "{"
            + "\"type\":\"panel_event\","
            + "\"panelType\":\"notifications\","
            + "\"payload\":{"
            + "\"type\":\"notification_update\","
            + "\"event\":\"upserted\","
            + "\"notification\":{"
            + "\"id\":\"notif-1\","
            + "\"kind\":\"session_attention\","
            + "\"source\":\"system\","
            + "\"title\":\"Latest assistant reply\","
            + "\"body\":\"Final answer\","
            + "\"voiceMode\":\"speak_then_listen\","
            + "\"ttsText\":\"Speak me\","
            + "\"sessionId\":\"session-1\","
            + "\"sessionTitle\":\"My Session\","
            + "\"sourceEventId\":\"response-1\","
            + "\"sessionActivitySeq\":4"
            + "}"
            + "}"
            + "}";

        AssistantVoiceNotificationEventParser.NotificationUpdate update =
            AssistantVoiceNotificationEventParser.parsePanelEvent(message);

        assertNotNull(update);
        assertEquals("upserted", update.eventType);
        assertNotNull(update.notification);
        assertEquals("notif-1", update.notification.id);
        assertEquals("session_attention", update.notification.kind);
        assertEquals("Speak me", update.notification.resolveSpokenText(false));
        assertEquals("Latest assistant reply: Speak me", update.notification.resolveSpokenText(true));
        assertEquals(Integer.valueOf(4), update.notification.sessionActivitySeq);
    }

    @Test
    public void ignoresNonNotificationPanelEvents() {
        assertNull(
            AssistantVoiceNotificationEventParser.parsePanelEvent(
                "{\"type\":\"panel_event\",\"panelType\":\"terminal\"}"
            )
        );
    }

    @Test
    public void parsesNotificationListResponses() {
        String response = "{"
            + "\"result\":{"
            + "\"notifications\":[{"
            + "\"id\":\"notif-1\","
            + "\"kind\":\"notification\","
            + "\"source\":\"tool\","
            + "\"title\":\"Prompt\","
            + "\"body\":\"What next?\","
            + "\"voiceMode\":\"speak_then_listen\","
            + "\"sessionId\":\"session-1\","
            + "\"sessionTitle\":\"My Session\""
            + "}]"
            + "}"
            + "}";

        List<AssistantVoiceNotificationRecord> notifications =
            AssistantVoiceNotificationEventParser.parseListResponse(response);

        assertEquals(1, notifications.size());
        assertEquals("notif-1", notifications.get(0).id);
        assertTrue(
            notifications.get(0).toAutomaticQueueItem(true, false).startsListeningAfterPlayback()
        );
    }

    @Test
    public void fallsBackToBodyWhenTtsTextIsJsonNull() {
        String response = "{"
            + "\"result\":{"
            + "\"notifications\":[{"
            + "\"id\":\"notif-1\","
            + "\"kind\":\"notification\","
            + "\"source\":\"tool\","
            + "\"title\":\"TEST\","
            + "\"body\":\"This is a test\","
            + "\"voiceMode\":\"speak\","
            + "\"ttsText\":null"
            + "}]"
            + "}"
            + "}";

        List<AssistantVoiceNotificationRecord> notifications =
            AssistantVoiceNotificationEventParser.parseListResponse(response);

        assertEquals(1, notifications.size());
        assertEquals("", notifications.get(0).ttsText);
        assertEquals("This is a test", notifications.get(0).resolveSpokenText(false));
        assertEquals("TEST: This is a test", notifications.get(0).resolveSpokenText(true));
    }
}
