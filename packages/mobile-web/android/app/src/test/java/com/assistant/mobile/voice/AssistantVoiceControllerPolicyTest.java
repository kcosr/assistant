package com.assistant.mobile.voice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class AssistantVoiceControllerPolicyTest {
    @Test
    public void normalizeRuntimeModeDefaultsToThread() {
        assertEquals("thread", AssistantVoiceControllerPolicy.normalizeRuntimeMode(null));
        assertEquals("thread", AssistantVoiceControllerPolicy.normalizeRuntimeMode(""));
        assertEquals("thread", AssistantVoiceControllerPolicy.normalizeRuntimeMode("THREAD"));
        assertEquals("realtime", AssistantVoiceControllerPolicy.normalizeRuntimeMode(" Realtime "));
    }

    @Test
    public void threadAdmissionPausedOnlyWhenRealtimeIsLiveOwner() {
        assertFalse(AssistantVoiceControllerPolicy.shouldPauseThreadAdmission("thread"));
        assertTrue(AssistantVoiceControllerPolicy.shouldPauseThreadAdmission("realtime"));
    }

    @Test
    public void generationFenceRequiresExactMatch() {
        assertTrue(AssistantVoiceControllerPolicy.isCurrentGeneration(4L, 4L));
        assertFalse(AssistantVoiceControllerPolicy.isCurrentGeneration(4L, 3L));
        assertFalse(AssistantVoiceControllerPolicy.isCurrentGeneration(4L, 0L));
    }

    @Test
    public void nextGenerationIsMonotonicAndSkipsZero() {
        assertEquals(2L, AssistantVoiceControllerPolicy.nextGeneration(1L));
        assertEquals(1L, AssistantVoiceControllerPolicy.nextGeneration(Long.MAX_VALUE));
    }

    @Test
    public void shouldStopRealtimeWhenLeavingRealtimeWhileLive() {
        assertTrue(
            AssistantVoiceControllerPolicy.shouldStopRealtimeForConfig(
                "realtime",
                "thread",
                "realtime"
            )
        );
        assertFalse(
            AssistantVoiceControllerPolicy.shouldStopRealtimeForConfig(
                "realtime",
                "thread",
                "thread"
            )
        );
        assertFalse(
            AssistantVoiceControllerPolicy.shouldStopRealtimeForConfig(
                "thread",
                "realtime",
                "thread"
            )
        );
    }
}
