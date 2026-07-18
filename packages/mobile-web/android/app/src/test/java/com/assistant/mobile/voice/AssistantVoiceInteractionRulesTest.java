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
    public void manualModeNeverAutoplaysEvents() {
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

        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            toolPrompt,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            assistantResponse,
            true
        ));
    }

    @Test
    public void manualModeAutoplaysStandaloneNotificationsButNotSessionAttention() {
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

        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            responseNotification
        ));
        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            toolNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            false,
            toolNotification
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
    public void manualModeSuppressesAutomaticNotificationListenRearm() {
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterAutomaticNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true
        ));
        assertTrue(AssistantVoiceInteractionRules.shouldAutoListenAfterAutomaticNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterAutomaticNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            false
        ));
    }

    @Test
    public void manualModeAutoListensOnlyAfterAssistantResponsesWhenEnabledAndIdle() {
        AssistantVoicePromptEvent assistantResponse = new AssistantVoicePromptEvent(
            "event-1",
            "session-1",
            "response-1",
            "assistant_response",
            "Answer"
        );
        AssistantVoicePromptEvent toolPrompt = new AssistantVoicePromptEvent(
            "event-2",
            "session-1",
            "call-1",
            "voice_ask",
            "Question?"
        );

        assertTrue(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantMessage(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            assistantResponse,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantMessage(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            false,
            assistantResponse,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantMessage(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            assistantResponse,
            false
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantMessage(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            true,
            assistantResponse,
            true
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantMessage(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            toolPrompt,
            true
        ));
    }

    @Test
    public void manualModeAutoListensForUnreadSessionAttentionNotificationsWhenEnabled() {
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
        AssistantVoiceNotificationRecord readResponseNotification = new AssistantVoiceNotificationRecord(
            "notif-read",
            "session_attention",
            "system",
            "Latest reply",
            "Answer",
            "2026-04-06T12:00:00.000Z",
            "session-1",
            "Session 1",
            "speak_then_listen",
            "",
            "event-2",
            5
        );
        AssistantVoiceNotificationRecord sessionlessNotification = new AssistantVoiceNotificationRecord(
            "notif-sessionless",
            "session_attention",
            "system",
            "Latest reply",
            "Answer",
            "",
            "",
            "",
            "speak_then_listen",
            "",
            "event-3",
            null
        );

        assertTrue(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            responseNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            false,
            responseNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            true,
            responseNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            readResponseNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantNotification(
            AssistantVoiceConfig.AUDIO_MODE_MANUAL,
            true,
            sessionlessNotification
        ));
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
            false,
            responseNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            true,
            responseNotification
        ));
        assertTrue(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            true,
            toolNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_RESPONSE,
            false,
            toolNotification
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
            AssistantVoiceConfig.AUDIO_MODE_TOOL,
            true,
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
        assertTrue(AssistantVoiceInteractionRules.shouldShowNotificationStopAction(false, false, true));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationStopAction(false, false, false));
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

    @Test
    public void showsNotificationSpeakActionInRealtimeModeWithoutThreadSession() {
        assertTrue(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            true,
            "",
            false,
            false,
            false,
            true,
            false
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldShowNotificationSpeakAction(
            true,
            "",
            false,
            false,
            false,
            true,
            true
        ));
    }
}
