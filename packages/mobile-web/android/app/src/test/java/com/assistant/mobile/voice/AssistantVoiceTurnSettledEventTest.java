package com.assistant.mobile.voice;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

public final class AssistantVoiceTurnSettledEventTest {
    @Test
    public void parsesCompletedToolOnlyTurn() {
        AssistantVoiceTurnSettledEvent event = AssistantVoiceTurnSettledEvent.parse(
            "{"
                + "\"type\":\"turn_settled\","
                + "\"sessionId\":\"session-1\","
                + "\"requestId\":\"request-1\","
                + "\"responseId\":\"response-1\","
                + "\"status\":\"completed\","
                + "\"hasSpeakableOutput\":false,"
                + "\"turnOriginId\":\"android-process-1\""
                + "}"
        );

        assertNotNull(event);
        assertTrue("session-1".equals(event.sessionId));
        assertTrue("request-1".equals(event.requestId));
        assertTrue("response-1".equals(event.responseId));
        assertTrue("completed".equals(event.status));
        assertFalse(event.hasSpeakableOutput);
        assertTrue("android-process-1".equals(event.turnOriginId));
    }

    @Test
    public void rejectsIncompleteSettlementMessage() {
        assertNull(AssistantVoiceTurnSettledEvent.parse(
            "{\"type\":\"turn_settled\",\"sessionId\":\"session-1\"}"
        ));
    }
}
