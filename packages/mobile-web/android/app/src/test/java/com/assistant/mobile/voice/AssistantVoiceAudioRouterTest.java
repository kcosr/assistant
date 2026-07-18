package com.assistant.mobile.voice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.os.Build;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
public final class AssistantVoiceAudioRouterTest {
    @Test
    public void requestAndReleaseFocusTracksOwnerGeneration() {
        AssistantVoiceAudioRouter router =
            new AssistantVoiceAudioRouter(RuntimeEnvironment.getApplication());

        assertTrue(router.requestPlaybackFocus(7L));
        assertEquals(7L, router.activeOwnerGeneration());
        assertEquals(AssistantVoiceAudioRouter.FocusKind.PLAYBACK, router.focusKind());

        router.abandonFocus(7L);
        assertEquals(0L, router.activeOwnerGeneration());
        assertEquals(AssistantVoiceAudioRouter.FocusKind.NONE, router.focusKind());
    }

    @Test
    public void staleGenerationCannotLeaveCommunicationMode() {
        AssistantVoiceAudioRouter router =
            new AssistantVoiceAudioRouter(RuntimeEnvironment.getApplication());

        router.enterCommunicationMode(3L);
        assertTrue(router.isCommunicationModeActive());

        router.leaveCommunicationMode(2L);
        assertTrue(router.isCommunicationModeActive());

        router.leaveCommunicationMode(3L);
        assertFalse(router.isCommunicationModeActive());
    }

    @Test
    public void releaseAllClearsModeAndFocus() {
        AssistantVoiceAudioRouter router =
            new AssistantVoiceAudioRouter(RuntimeEnvironment.getApplication());

        assertTrue(router.requestCaptureFocus(9L));
        router.enterCommunicationMode(9L);
        router.releaseAll(9L);

        assertEquals(AssistantVoiceAudioRouter.FocusKind.NONE, router.focusKind());
        assertFalse(router.isCommunicationModeActive());
        assertEquals(0L, router.activeOwnerGeneration());
    }
}
