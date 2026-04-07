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
    public void autoplaysOnlyMatchingEventKindsWhileIdle() {
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
            toolPrompt,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            assistantResponse,
            true
        ));
        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            assistantResponse,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
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
    public void autoplaysOnlyUnreadNotificationsThatMatchTheCurrentAudioMode() {
        AssistantVoiceNotificationRecord responseNotification = new AssistantVoiceNotificationRecord(
            "notif-response",
            "session_attention",
            "system",
            "Latest reply",
            "Answer",
            "",
            "session-1",
            "Session 1",
            "speak_then_listen",
            "",
            "event-1",
            4
        );
        AssistantVoiceNotificationRecord toolNotification = new AssistantVoiceNotificationRecord(
            "notif-tool",
            "notification",
            "tool",
            "Prompt",
            "What next?",
            "",
            "session-1",
            "Session 1",
            "speak_then_listen",
            "",
            "event-2",
            5
        );
        AssistantVoiceNotificationRecord readToolNotification = new AssistantVoiceNotificationRecord(
            "notif-read",
            "notification",
            "tool",
            "Read prompt",
            "Already handled",
            "2026-04-06T12:00:00.000Z",
            "session-1",
            "Session 1",
            "speak",
            "",
            "event-3",
            6
        );

        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            responseNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            responseNotification
        ));
        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            toolNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            toolNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            readToolNotification
        ));
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
