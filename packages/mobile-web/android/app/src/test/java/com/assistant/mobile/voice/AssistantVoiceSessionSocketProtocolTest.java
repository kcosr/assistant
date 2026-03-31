package com.assistant.mobile.voice;

import org.junit.Test;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

public final class AssistantVoiceSessionSocketProtocolTest {
    @Test
    public void buildHelloMessageIncludesSelectedSessionSubscription() {
        String payload = AssistantVoiceSessionSocketProtocol.buildHelloMessage(
            java.util.Collections.singletonList("session-123"),
            AssistantVoiceConfig.AUDIO_MODE_TOOL
        );

        assertTrue(payload.contains("\"type\":\"hello\""));
        assertTrue(payload.contains("\"protocolVersion\":3"));
        assertTrue(payload.contains("\"subscriptions\":[{\"sessionId\":\"session-123\""));
        assertTrue(payload.contains("\"serverMessageTypes\":[\"chat_event\"]"));
        assertTrue(payload.contains("\"chatEventTypes\":[\"tool_call\"]"));
        assertTrue(payload.contains("\"toolNames\":[\"voice_speak\",\"voice_ask\"]"));
    }

    @Test
    public void buildSubscribeMessageIncludesVoiceMask() {
        String payload = AssistantVoiceSessionSocketProtocol.buildSubscribeMessage(
            "session-123",
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE
        );

        assertTrue(payload.contains("\"type\":\"subscribe\""));
        assertTrue(payload.contains("\"sessionId\":\"session-123\""));
        assertTrue(payload.contains("\"serverMessageTypes\":[\"chat_event\"]"));
        assertTrue(payload.contains("\"chatEventTypes\":[\"assistant_done\"]"));
        assertTrue(payload.contains("\"messagePhases\":[\"final_answer\"]"));
    }

    @Test
    public void buildUnsubscribeMessageIncludesSessionId() {
        String payload = AssistantVoiceSessionSocketProtocol.buildUnsubscribeMessage("session-123");

        assertTrue(payload.contains("\"type\":\"unsubscribe\""));
        assertTrue(payload.contains("\"sessionId\":\"session-123\""));
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
            message
        );

        assertNotNull(prompt);
        assertTrue("event-1".equals(prompt.eventId));
        assertTrue("session-123".equals(prompt.sessionId));
        assertTrue("call-1".equals(prompt.toolCallId));
        assertTrue("voice_speak".equals(prompt.toolName));
        assertTrue("Hello from realtime".equals(prompt.text));
    }

    @Test
    public void parsePlaybackMessageReturnsPromptForAnySession() {
        String message = "{"
            + "\"type\":\"chat_event\","
            + "\"sessionId\":\"session-other\","
            + "\"event\":{"
            + "\"id\":\"event-3\","
            + "\"sessionId\":\"session-other\","
            + "\"type\":\"tool_call\","
            + "\"payload\":{"
            + "\"toolName\":\"voice_speak\","
            + "\"toolCallId\":\"call-3\","
            + "\"args\":{\"text\":\"Other session\"}"
            + "}"
            + "}"
            + "}";
        AssistantVoicePromptEvent prompt = AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(
            message
        );

        assertNotNull(prompt);
        assertTrue("session-other".equals(prompt.sessionId));
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
            message
        );

        assertNotNull(prompt);
        assertTrue("assistant_response".equals(prompt.toolName));
        assertTrue("Final response text".equals(prompt.text));
    }
}
