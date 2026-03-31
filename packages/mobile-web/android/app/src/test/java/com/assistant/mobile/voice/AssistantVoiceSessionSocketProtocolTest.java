package com.assistant.mobile.voice;

import org.junit.Test;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public final class AssistantVoiceSessionSocketProtocolTest {
    @Test
    public void buildHelloMessageIncludesSelectedSessionSubscription() {
        String payload = AssistantVoiceSessionSocketProtocol.buildHelloMessage("session-123");

        assertTrue(payload.contains("\"type\":\"hello\""));
        assertTrue(payload.contains("\"protocolVersion\":2"));
        assertTrue(payload.contains("\"subscriptions\":[\"session-123\"]"));
    }

    @Test
    public void parsePlaybackMessageReturnsVoicePromptForMatchingSession() {
        String message = "{"
            + "\"type\":\"chat_event\","
            + "\"sessionId\":\"session-123\","
            + "\"event\":{"
            + "\"id\":\"event-1\","
            + "\"sessionId\":\"session-123\","
            + "\"type\":\"tool_call\","
            + "\"payload\":{"
            + "\"toolName\":\"voice_speak\","
            + "\"toolCallId\":\"call-1\","
            + "\"args\":{\"text\":\"Hello from realtime\"}"
            + "}"
            + "}"
            + "}";
        AssistantVoicePromptEvent prompt = AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(
            message,
            "session-123"
        );

        assertNotNull(prompt);
        assertTrue("event-1".equals(prompt.eventId));
        assertTrue("session-123".equals(prompt.sessionId));
        assertTrue("call-1".equals(prompt.toolCallId));
        assertTrue("voice_speak".equals(prompt.toolName));
        assertTrue("Hello from realtime".equals(prompt.text));
    }

    @Test
    public void parsePlaybackMessageIgnoresMessagesForOtherSessions() {
        String message = "{"
            + "\"type\":\"chat_event\","
            + "\"sessionId\":\"session-other\","
            + "\"event\":{}"
            + "}";
        AssistantVoicePromptEvent prompt = AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(
            message,
            "session-123"
        );

        assertNull(prompt);
    }

    @Test
    public void parsePlaybackMessageReturnsAssistantResponseForMatchingSession() {
        String message = "{"
            + "\"type\":\"chat_event\","
            + "\"sessionId\":\"session-123\","
            + "\"event\":{"
            + "\"id\":\"event-2\","
            + "\"sessionId\":\"session-123\","
            + "\"type\":\"assistant_done\","
            + "\"payload\":{"
            + "\"phase\":\"final_answer\","
            + "\"text\":\"Final response text\""
            + "}"
            + "}"
            + "}";

        AssistantVoicePromptEvent prompt = AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(
            message,
            "session-123"
        );

        assertNotNull(prompt);
        assertTrue("assistant_response".equals(prompt.toolName));
        assertTrue("Final response text".equals(prompt.text));
    }
}
