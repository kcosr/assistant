package com.assistant.mobile.voice;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public final class AssistantVoiceRequestTrackerTest {
    @Test
    public void consumesOnlyTheMatchingSessionRequestOnce() {
        AssistantVoiceRequestTracker tracker = new AssistantVoiceRequestTracker(4);

        tracker.remember("session-1", "request-1");

        assertFalse(tracker.consume("session-2", "request-1"));
        assertFalse(tracker.consume("session-1", "request-2"));
        assertTrue(tracker.consume("session-1", "request-1"));
        assertFalse(tracker.consume("session-1", "request-1"));
    }

    @Test
    public void ignoresIncompleteKeysAndEvictsTheOldestRequest() {
        AssistantVoiceRequestTracker tracker = new AssistantVoiceRequestTracker(2);

        tracker.remember("", "request-0");
        tracker.remember("session-1", "");
        tracker.remember("session-1", "request-1");
        tracker.remember("session-1", "request-2");
        tracker.remember("session-1", "request-3");

        assertFalse(tracker.consume("session-1", "request-1"));
        assertTrue(tracker.consume("session-1", "request-2"));
        assertTrue(tracker.consume("session-1", "request-3"));
    }
}
