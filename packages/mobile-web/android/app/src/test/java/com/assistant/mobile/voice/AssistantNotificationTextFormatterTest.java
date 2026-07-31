package com.assistant.mobile.voice;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class AssistantNotificationTextFormatterTest {
    @Test
    public void stripsPairedBoldMarkers() {
        CharSequence result = AssistantNotificationTextFormatter.format(
            "This is **important** and **urgent**."
        );

        assertEquals("This is important and urgent.", result.toString());
    }

    @Test
    public void leavesUnmatchedAndEmptyBoldMarkersUntouched() {
        assertEquals(
            "Keep **this marker",
            AssistantNotificationTextFormatter.format("Keep **this marker").toString()
        );
        assertEquals(
            "Keep **** markers",
            AssistantNotificationTextFormatter.format("Keep **** markers").toString()
        );
    }
}
