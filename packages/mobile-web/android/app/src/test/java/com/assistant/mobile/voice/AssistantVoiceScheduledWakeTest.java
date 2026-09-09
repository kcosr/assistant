package com.assistant.mobile.voice;

import android.content.Intent;
import android.os.Build;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import java.lang.reflect.Method;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
public final class AssistantVoiceScheduledWakeTest {
    private AssistantVoicePromptEvent wakePrompt() {
        return AssistantVoiceSessionSocketProtocol.parsePlaybackMessage(
            "{\"type\":\"transcript_event\",\"event\":{"
                + "\"eventId\":\"event-1\",\"sessionId\":\"session-1\","
                + "\"requestId\":\"request-1\",\"responseId\":\"response-1\","
                + "\"chatEventType\":\"assistant_done\",\"payload\":{"
                + "\"phase\":\"final_answer\",\"text\":\"Time to check in\","
                + "\"turnSource\":\"scheduled_wakeup\"}}}"
        );
    }

    private AssistantVoiceNotificationRecord wakeNotification() {
        return AssistantVoiceNotificationEventParser.parseListResponse(
            "{\"result\":{\"notifications\":[{"
                + "\"id\":\"notification-1\",\"sessionId\":\"session-1\","
                + "\"kind\":\"session_attention\",\"source\":\"system\","
                + "\"title\":\"Wake\",\"body\":\"Time to check in\","
                + "\"voiceMode\":\"speak_then_listen\","
                + "\"turnSource\":\"scheduled_wakeup\"}]}}"
        ).get(0);
    }

    @Test
    public void wakeResponseUsesExistingResponseAndManualAutoListenSettings() {
        AssistantVoicePromptEvent prompt = wakePrompt();
        assertNotNull(prompt);
        assertEquals("scheduled_wakeup", prompt.turnSource);
        assertEquals("", prompt.turnOriginId);
        AssistantVoiceRuntimeService.AssistantResponseAdmission admission =
            AssistantVoiceRuntimeService.evaluateAssistantResponseAdmission(
                prompt, new AssistantVoiceRequestTracker(4), new AssistantVoiceRequestTracker(4),
                true, "this-device"
            );
        assertTrue(admission.admitted);
        assertFalse(admission.suppressAutoListen);
        for (boolean enabled : new boolean[] {false, true}) {
            boolean autoListen = enabled && !admission.suppressAutoListen;
            assertTrue(AssistantVoiceInteractionRules.shouldAutoplayEvent(
                AssistantVoiceConfig.AUDIO_MODE_RESPONSE, prompt, true
            ));
            assertEquals(enabled, AssistantVoiceQueueItem.fromPrompt(
                prompt, autoListen, false, ""
            ).startsListeningAfterPlayback());
            assertFalse(AssistantVoiceInteractionRules.shouldAutoplayEvent(
                AssistantVoiceConfig.AUDIO_MODE_MANUAL, prompt, true
            ));
            assertEquals(enabled, AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantMessage(
                AssistantVoiceConfig.AUDIO_MODE_MANUAL, autoListen, prompt, true
            ));
        }
    }

    @Test
    public void wakeResponseStillHonorsInteractionEndAndVoiceAsk() {
        for (boolean interactionEnded : new boolean[] {false, true}) {
            AssistantVoiceRequestTracker interactionEnd = new AssistantVoiceRequestTracker(4);
            AssistantVoiceRequestTracker voiceAsk = new AssistantVoiceRequestTracker(4);
            (interactionEnded ? interactionEnd : voiceAsk).remember("session-1", "request-1");
            assertTrue(AssistantVoiceRuntimeService.evaluateAssistantResponseAdmission(
                wakePrompt(), interactionEnd, voiceAsk, true, "this-device"
            ).suppressAutoListen);
        }
        assertTrue(AssistantVoiceInteractionRules.shouldSuppressAutoListenForAutomaticResponse("", ""));
        assertTrue(AssistantVoiceInteractionRules.shouldSuppressAutoListenForAutomaticResponse("", "other"));
    }

    @Test
    public void durableWakeNotificationUsesExistingAutoListenSettings() {
        AssistantVoiceNotificationRecord notification = wakeNotification();
        assertEquals("scheduled_wakeup", notification.turnSource);
        assertEquals("", notification.turnOriginId);
        assertTrue(AssistantVoiceInteractionRules.shouldAdmitAutomaticNotification(
            true, "this-device", notification
        ));
        boolean suppressed = AssistantVoiceInteractionRules.shouldSuppressAutoListenForAutomaticResponse(
            notification.turnOriginId, notification.turnSource
        );
        assertFalse(suppressed);
        for (boolean enabled : new boolean[] {false, true}) {
            assertTrue(AssistantVoiceInteractionRules.shouldAutoplayNotification(
                AssistantVoiceConfig.AUDIO_MODE_RESPONSE, false, notification
            ));
            assertEquals(enabled, notification.toAutomaticQueueItem(
                enabled && !suppressed, false, ""
            ).startsListeningAfterPlayback());
            assertFalse(AssistantVoiceInteractionRules.shouldAutoplayNotification(
                AssistantVoiceConfig.AUDIO_MODE_MANUAL, false, notification
            ));
            assertEquals(enabled, AssistantVoiceInteractionRules.shouldAutoListenAfterManualAssistantNotification(
                AssistantVoiceConfig.AUDIO_MODE_MANUAL, enabled && !suppressed, notification
            ));
        }
    }

    @Test
    public void notificationActionPreservesWakeSource() throws Exception {
        Intent intent = AssistantVoiceRuntimeService.notificationDismissIntent(
            RuntimeEnvironment.getApplication(), wakeNotification()
        );
        Method method = AssistantVoiceRuntimeService.class.getDeclaredMethod(
            "notificationFromIntent", Intent.class
        );
        method.setAccessible(true);
        AssistantVoiceNotificationRecord restored = (AssistantVoiceNotificationRecord) method.invoke(
            new AssistantVoiceRuntimeService(), intent
        );
        assertEquals("scheduled_wakeup", restored.turnSource);
    }

    @Test
    public void silentWakeSettlementAutoListensOnlyWhenEnabledAndNotEnded() {
        AssistantVoiceTurnSettledEvent event = AssistantVoiceTurnSettledEvent.parse(
            "{\"type\":\"turn_settled\",\"sessionId\":\"session-1\","
                + "\"requestId\":\"request-1\",\"responseId\":\"response-1\","
                + "\"status\":\"completed\",\"hasSpeakableOutput\":false,"
                + "\"turnSource\":\"scheduled_wakeup\"}"
        );
        assertNotNull(event);
        assertEquals("scheduled_wakeup", event.turnSource);
        assertEquals("", event.turnOriginId);
        assertTrue(AssistantVoiceInteractionRules.shouldAutoListenForSettledTurn(
            true, true, "this-device", event, false, false
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenForSettledTurn(
            false, true, "this-device", event, false, false
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenForSettledTurn(
            true, true, "this-device", event, true, false
        ));
        assertFalse(AssistantVoiceInteractionRules.shouldAutoListenForSettledTurn(
            true, true, "this-device", event, false, true
        ));
    }
}
