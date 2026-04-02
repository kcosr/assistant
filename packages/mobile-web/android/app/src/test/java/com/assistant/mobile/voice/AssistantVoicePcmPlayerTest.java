package com.assistant.mobile.voice;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;

import org.junit.Test;

public final class AssistantVoicePcmPlayerTest {
    @Test
    public void normalizeTtsGainClampsToSupportedRange() {
        assertEquals(0.25f, AssistantVoicePcmPlayer.normalizeTtsGain(0.1f), 0.0001f);
        assertEquals(5.0f, AssistantVoicePcmPlayer.normalizeTtsGain(8.0f), 0.0001f);
        assertEquals(1.0f, AssistantVoicePcmPlayer.normalizeTtsGain(Float.NaN), 0.0001f);
    }

    @Test
    public void applySoftwareGainReturnsOriginalBufferWhenGainIsUnity() {
        byte[] pcm = new byte[] { 0x10, 0x00, (byte) 0xF0, (byte) 0xFF };
        assertSame(pcm, AssistantVoicePcmPlayer.applySoftwareGainPcm16(pcm, 1.0f));
    }

    @Test
    public void applySoftwareGainScalesAndClampsPcm16Samples() {
        byte[] pcm = new byte[] { 0x00, 0x40, 0x00, (byte) 0xC0 };
        byte[] scaled = AssistantVoicePcmPlayer.applySoftwareGainPcm16(pcm, 2.0f);

        assertArrayEquals(
            new byte[] { (byte) 0xFF, 0x7F, 0x00, (byte) 0x80 },
            scaled
        );
    }
}
