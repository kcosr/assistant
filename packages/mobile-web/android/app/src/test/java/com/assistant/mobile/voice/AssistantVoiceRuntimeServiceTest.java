package com.assistant.mobile.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import com.assistant.mobile.R;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

@RunWith(RobolectricTestRunner.class)
public final class AssistantVoiceRuntimeServiceTest {
    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void buildNotificationUsesPublicVisibilityDefaultPriorityAndServiceCategory() {
        Context context = RuntimeEnvironment.getApplication();

        Notification notification = AssistantVoiceRuntimeService.buildNotification(
            context,
            AssistantVoiceRuntimeService.STATE_IDLE,
            "Daily Assistant",
            createActivityPendingIntent(context, "launch"),
            createServicePendingIntent(context, "listen"),
            createServicePendingIntent(context, "stop"),
            true,
            true
        );
        Bundle extras = notification.extras;

        assertEquals(AssistantVoiceRuntimeService.NOTIFICATION_PRIORITY, notification.priority);
        assertEquals(AssistantVoiceRuntimeService.NOTIFICATION_VISIBILITY, notification.visibility);
        assertEquals(AssistantVoiceRuntimeService.NOTIFICATION_CATEGORY, notification.category);
        assertEquals("Voice (Idle)", String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE)));
        assertEquals(
            "Daily Assistant",
            String.valueOf(extras.getCharSequence(Notification.EXTRA_TEXT))
        );
        assertNotNull(notification.actions);
        assertEquals(2, notification.actions.length);
        assertEquals(
            context.getString(R.string.assistant_voice_notification_action_speak),
            notification.actions[0].title
        );
        assertEquals(
            context.getString(R.string.assistant_voice_notification_action_stop),
            notification.actions[1].title
        );
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.O)
    public void ensureNotificationChannelMigratesLegacyChannelAndUsesPublicDefaults() {
        Context context = RuntimeEnvironment.getApplication();
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertNotNull(manager);

        manager.createNotificationChannel(
            new NotificationChannel(
                AssistantVoiceRuntimeService.LEGACY_NOTIFICATION_CHANNEL_ID,
                "Legacy voice mode",
                NotificationManager.IMPORTANCE_LOW
            )
        );

        AssistantVoiceRuntimeService.ensureNotificationChannel(context, manager);

        assertNull(manager.getNotificationChannel(AssistantVoiceRuntimeService.LEGACY_NOTIFICATION_CHANNEL_ID));
        NotificationChannel channel =
            manager.getNotificationChannel(AssistantVoiceRuntimeService.NOTIFICATION_CHANNEL_ID);
        assertNotNull(channel);
        assertEquals(AssistantVoiceRuntimeService.NOTIFICATION_CHANNEL_IMPORTANCE, channel.getImportance());
        assertEquals(
            AssistantVoiceRuntimeService.NOTIFICATION_LOCKSCREEN_VISIBILITY,
            channel.getLockscreenVisibility()
        );
        assertEquals(
            context.getString(R.string.assistant_voice_notification_channel_name),
            channel.getName()
        );
        assertEquals(
            context.getString(R.string.assistant_voice_notification_channel_description),
            channel.getDescription()
        );
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void buildNotificationOmitsBodyWhenThereIsNoSessionTitle() {
        Context context = RuntimeEnvironment.getApplication();

        Notification notification = AssistantVoiceRuntimeService.buildNotification(
            context,
            AssistantVoiceRuntimeService.STATE_LISTENING,
            "",
            createActivityPendingIntent(context, "launch"),
            createServicePendingIntent(context, "listen"),
            createServicePendingIntent(context, "stop"),
            true,
            false
        );

        assertEquals(
            "Voice (Listening)",
            String.valueOf(notification.extras.getCharSequence(Notification.EXTRA_TITLE))
        );
        assertNull(notification.extras.getCharSequence(Notification.EXTRA_TEXT));
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void shouldUsePositiveRecognitionCueRequiresSuccessfulNonEmptySpeech() {
        assertEquals(true, AssistantVoiceRuntimeService.shouldUsePositiveRecognitionCue(true, "hello"));
        assertEquals(false, AssistantVoiceRuntimeService.shouldUsePositiveRecognitionCue(true, "  "));
        assertEquals(false, AssistantVoiceRuntimeService.shouldUsePositiveRecognitionCue(false, "hello"));
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void shouldPlayQueuedRecognitionCompletionCueMatchesStoppedRequest() {
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldPlayQueuedRecognitionCompletionCue(
                "request-1",
                " request-1 "
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldPlayQueuedRecognitionCompletionCue(
                "request-1",
                "request-2"
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldPlayQueuedRecognitionCompletionCue(
                "",
                "request-1"
            )
        );
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void recognitionArmingCueRequestIdRoundTripsThroughPlaybackMarker() {
        String playbackRequestId =
            AssistantVoiceRuntimeService.buildRecognitionArmingCueRequestId(" request-1 ");

        assertEquals(
            "request-1",
            AssistantVoiceRuntimeService.extractRecognitionArmingCueRequestId(playbackRequestId)
        );
        assertEquals("", AssistantVoiceRuntimeService.extractRecognitionArmingCueRequestId("tts-1"));
    }

    private static PendingIntent createActivityPendingIntent(Context context, String action) {
        return PendingIntent.getActivity(
            context,
            action.hashCode(),
            new Intent(action),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }

    private static PendingIntent createServicePendingIntent(Context context, String action) {
        return PendingIntent.getService(
            context,
            action.hashCode(),
            new Intent(action),
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
    }
}
