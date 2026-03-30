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
    public void autoplaysOnlyForSelectedSessionWhileIdle() {
        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayPrompt(
            true,
            "session-1",
            "session-1",
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayPrompt(
            true,
            "session-1",
            "session-2",
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayPrompt(
            true,
            "session-1",
            "session-1",
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
