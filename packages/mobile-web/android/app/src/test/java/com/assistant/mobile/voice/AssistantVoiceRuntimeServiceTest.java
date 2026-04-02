package com.assistant.mobile.voice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;

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
            createServicePendingIntent(context, "toggle"),
            true,
            true,
            false
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
        assertEquals(3, notification.actions.length);
        assertEquals(
            context.getString(R.string.assistant_voice_notification_action_speak),
            notification.actions[0].title
        );
        assertEquals(
            context.getString(R.string.assistant_voice_notification_action_stop),
            notification.actions[1].title
        );
        assertEquals("", String.valueOf(notification.actions[2].title));
        assertEquals(
            R.drawable.ic_notification_media_buttons_disabled,
            notification.actions[2].icon
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
            createServicePendingIntent(context, "toggle"),
            true,
            false,
            true
        );

        assertEquals(
            "Voice (Listening)",
            String.valueOf(notification.extras.getCharSequence(Notification.EXTRA_TITLE))
        );
        assertNull(notification.extras.getCharSequence(Notification.EXTRA_TEXT));
        assertEquals("", String.valueOf(notification.actions[1].title));
        assertEquals(
            R.drawable.ic_notification_media_buttons_enabled,
            notification.actions[1].icon
        );
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void resolveMediaSessionPlaybackStateTreatsListeningAndSpeakingAsPlaying() {
        assertEquals(
            android.media.session.PlaybackState.STATE_PLAYING,
            AssistantVoiceRuntimeService.resolveMediaSessionPlaybackState(
                AssistantVoiceRuntimeService.STATE_LISTENING
            )
        );
        assertEquals(
            android.media.session.PlaybackState.STATE_PLAYING,
            AssistantVoiceRuntimeService.resolveMediaSessionPlaybackState(
                AssistantVoiceRuntimeService.STATE_SPEAKING
            )
        );
        assertEquals(
            android.media.session.PlaybackState.STATE_PAUSED,
            AssistantVoiceRuntimeService.resolveMediaSessionPlaybackState(
                AssistantVoiceRuntimeService.STATE_IDLE
            )
        );
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void shouldHandleMediaButtonKeyEventRequiresInitialActionDown() {
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldHandleMediaButtonKeyEvent(
                new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldHandleMediaButtonKeyEvent(
                new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            )
        );
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void shouldStopForMediaButtonToggleWhenInteractionIsActive() {
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldStopForMediaButtonToggle(
                AssistantVoiceRuntimeService.STATE_IDLE,
                true
            )
        );
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldStopForMediaButtonToggle(
                AssistantVoiceRuntimeService.STATE_LISTENING,
                false
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldStopForMediaButtonToggle(
                AssistantVoiceRuntimeService.STATE_IDLE,
                false
            )
        );
    }

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void shouldStopForMediaButtonKeyCodeTreatsPlayAsToggleWhenInteractionIsActive() {
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldStopForMediaButtonKeyCode(
                KeyEvent.KEYCODE_MEDIA_PLAY,
                AssistantVoiceRuntimeService.STATE_IDLE,
                true
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldStopForMediaButtonKeyCode(
                KeyEvent.KEYCODE_MEDIA_PLAY,
                AssistantVoiceRuntimeService.STATE_IDLE,
                false
            )
        );
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldStopForMediaButtonKeyCode(
                KeyEvent.KEYCODE_MEDIA_PAUSE,
                AssistantVoiceRuntimeService.STATE_IDLE,
                false
            )
        );
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
    public void shouldScheduleQueuedRecognitionCompletionCueAfterResultMatchesEarlierStop() {
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldScheduleQueuedRecognitionCompletionCueAfterResult(
                " request-1 ",
                "request-1"
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldScheduleQueuedRecognitionCompletionCueAfterResult(
                "",
                "request-1"
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldScheduleQueuedRecognitionCompletionCueAfterResult(
                "request-2",
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

    @Test
    @Config(sdk = Build.VERSION_CODES.N)
    public void shouldStartRecognitionAfterArmingCueMatchesPendingRecognitionRequest() {
        assertEquals(
            true,
            AssistantVoiceRuntimeService.shouldStartRecognitionAfterArmingCue(
                "request-1",
                AssistantVoiceRuntimeService.buildRecognitionArmingCueRequestId("request-1")
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldStartRecognitionAfterArmingCue(
                "request-1",
                AssistantVoiceRuntimeService.buildRecognitionArmingCueRequestId("request-2")
            )
        );
        assertEquals(
            false,
            AssistantVoiceRuntimeService.shouldStartRecognitionAfterArmingCue(
                "",
                AssistantVoiceRuntimeService.buildRecognitionArmingCueRequestId("request-1")
            )
        );
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
