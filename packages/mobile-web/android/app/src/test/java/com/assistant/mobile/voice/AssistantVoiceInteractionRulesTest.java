package com.assistant.mobile.voice;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class AssistantVoiceInteractionRulesTest {
    @Test
    public void recognizesOnlyVoicePromptTools() {
        assertTrue(AssistantVoiceInteractionRules.isVoicePromptTool("voice_speak"));
        assertTrue(AssistantVoiceInteractionRules.isVoicePromptTool("voice_ask"));
        assertFalse(AssistantVoiceInteractionRules.isVoicePromptTool("shell"));
    }

    @Test
    public void autoplaysOnlyMatchingEventKindsForSelectedSessionWhileIdle() {
        AssistantVoicePromptEvent toolPrompt = new AssistantVoicePromptEvent(
            "event-1",
            "session-1",
            "call-1",
            "voice_ask",
            "Question?"
        );
        AssistantVoicePromptEvent assistantResponse = new AssistantVoicePromptEvent(
            "event-2",
            "session-1",
            "",
            "assistant_response",
            "Answer"
        );

        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            "session-1",
            toolPrompt,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            "session-1",
            assistantResponse,
            true
        ));
        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            "session-1",
            assistantResponse,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            "session-2",
            assistantResponse,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            "session-1",
            assistantResponse,
            false
        ));
    }

    @Test
    public void onlyVoiceAskTransitionsToRecognitionAfterStopUnlessManualListenWasRequested() {
        assertTrue(AssistantVoiceInteractionRules.shouldStartRecognitionAfterManualStop("voice_ask", false));
        assertFalse(AssistantVoiceInteractionRules.shouldStartRecognitionAfterManualStop("voice_speak", false));
        assertTrue(AssistantVoiceInteractionRules.shouldStartRecognitionAfterManualStop("voice_speak", true));
    }

    @Test
    public void onlySignalsSttEndForTheStillActiveRequest() {
        assertTrue(AssistantVoiceInteractionRules.shouldSendSttEndAfterMicStops("request-1", "request-1"));
        assertFalse(AssistantVoiceInteractionRules.shouldSendSttEndAfterMicStops("request-1", "request-2"));
        assertFalse(AssistantVoiceInteractionRules.shouldSendSttEndAfterMicStops("", "request-1"));
    }
}
