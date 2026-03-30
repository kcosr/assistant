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
    public void autoListenControlsRecognitionAfterPlaybackAndManualStop() {
        assertFalse(
            AssistantVoiceInteractionRules.shouldStartRecognitionAfterPlayback("voice_ask", false)
        );
        assertTrue(
            AssistantVoiceInteractionRules.shouldStartRecognitionAfterPlayback("voice_ask", true)
        );
        assertTrue(
            AssistantVoiceInteractionRules.shouldStartRecognitionAfterPlayback(
                "assistant_response",
                true
            )
        );
        assertFalse(
            AssistantVoiceInteractionRules.shouldStartRecognitionAfterPlayback("voice_speak", true)
        );
        assertFalse(
            AssistantVoiceInteractionRules.shouldStartRecognitionAfterManualStop(
                "voice_ask",
                false,
                false
            )
        );
        assertTrue(
            AssistantVoiceInteractionRules.shouldStartRecognitionAfterManualStop(
                "voice_ask",
                false,
                true
            )
        );
        assertTrue(
            AssistantVoiceInteractionRules.shouldStartRecognitionAfterManualStop(
                "voice_speak",
                true,
                false
            )
        );
    }

    @Test
    public void onlySignalsSttEndForTheStillActiveRequest() {
        assertTrue(AssistantVoiceInteractionRules.shouldSendSttEndAfterMicStops("request-1", "request-1"));
        assertFalse(AssistantVoiceInteractionRules.shouldSendSttEndAfterMicStops("request-1", "request-2"));
        assertFalse(AssistantVoiceInteractionRules.shouldSendSttEndAfterMicStops("", "request-1"));
    }

    @Test
    public void showsNotificationStopActionDuringPlaybackOrListening() {
        assertTrue(AssistantVoiceInteractionRules.shouldShowNotificationStopAction(true, false));
        assertTrue(AssistantVoiceInteractionRules.shouldShowNotificationStopAction(false, true));
        assertTrue(AssistantVoiceInteractionRules.shouldShowNotificationStopAction(true, true));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationStopAction(false, false));
    }

    @Test
    public void showsNotificationSpeakActionOnlyWhenManualListenIsAvailable() {
        assertTrue(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            true,
            "session-1",
            false,
            false,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            false,
            "session-1",
            false,
            false,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            true,
            "",
            false,
            false,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            true,
            "session-1",
            true,
            false,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            true,
            "session-1",
            false,
            true,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            true,
            "session-1",
            false,
            false,
            false
        ));
    }
}
