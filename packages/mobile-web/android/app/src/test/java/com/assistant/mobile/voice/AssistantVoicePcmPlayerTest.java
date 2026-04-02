package com.assistant.mobile.voice;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;

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

    @Test
    public void normalizeRecognitionCueGainClampsToSupportedRange() {
        assertEquals(0.25f, AssistantVoiceConfig.clampRecognitionCueGain(0.1f), 0.0001f);
        assertEquals(5.0f, AssistantVoiceConfig.clampRecognitionCueGain(8.0f), 0.0001f);
        assertEquals(
            1.0f,
            AssistantVoiceConfig.clampRecognitionCueGain(Float.NaN),
            0.0001f
        );
    }

    @Test
    public void resolveRecognitionCueGainUsesAudibleSafeCurve() {
        assertEquals(0.1585f, AssistantVoicePcmPlayer.resolveRecognitionCueGain(0.25f), 0.0001f);
        assertTrue(AssistantVoicePcmPlayer.resolveRecognitionCueGain(1.0f) > 0.15f);
        assertEquals(3.9811f, AssistantVoicePcmPlayer.resolveRecognitionCueGain(5.0f), 0.0001f);
    }

    @Test
    public void resolveCueOutputSampleRateClampsToSupportedDeviceRange() {
        assertEquals(48000, AssistantVoicePcmPlayer.resolveCueOutputSampleRate(null));
        assertEquals(48000, AssistantVoicePcmPlayer.resolveCueOutputSampleRate("96000"));
        assertEquals(16000, AssistantVoicePcmPlayer.resolveCueOutputSampleRate("8000"));
        assertEquals(44100, AssistantVoicePcmPlayer.resolveCueOutputSampleRate("44100"));
        assertEquals(48000, AssistantVoicePcmPlayer.resolveCueOutputSampleRate("abc"));
    }

    @Test
    public void buildRecognitionCuePrerollPcmUsesConfiguredSilenceWindow() {
        assertEquals(
            49152,
            AssistantVoicePcmPlayer.buildRecognitionCuePrerollPcm(48000, 512).length
        );
        assertEquals(0, AssistantVoicePcmPlayer.buildRecognitionCuePrerollPcm(0, 512).length);
        assertEquals(0, AssistantVoicePcmPlayer.buildRecognitionCuePrerollPcm(48000, 0).length);
    }

    @Test
    public void generateRecognitionCuePcmDataBuildsDistinctArmingSuccessAndFailureCues() {
        byte[] armingCue = AssistantVoicePcmPlayer.generateRecognitionCuePcmData(
            48000,
            AssistantVoicePcmPlayer.RecognitionCueType.ARMING
        );
        byte[] successCue = AssistantVoicePcmPlayer.generateRecognitionCuePcmData(
            48000,
            AssistantVoicePcmPlayer.RecognitionCueType.SUCCESS_COMPLETION
        );
        byte[] failureCue = AssistantVoicePcmPlayer.generateRecognitionCuePcmData(
            48000,
            AssistantVoicePcmPlayer.RecognitionCueType.FAILURE_COMPLETION
        );

        assertEquals(27840, armingCue.length);
        assertEquals(13440, successCue.length);
        assertEquals(28800, failureCue.length);
        assertFalse(Arrays.equals(armingCue, successCue));
        assertFalse(Arrays.equals(armingCue, failureCue));
        assertFalse(Arrays.equals(successCue, failureCue));
        assertFalse(Arrays.equals(successCue, synthesizeSingleTonePcm(48000, 523.25d, 140, 0.16f)));
        assertFalse(Arrays.equals(successCue, synthesizeSingleTonePcm(48000, 1046.50d, 140, 0.16f)));
    }

    private static byte[] synthesizeSingleTonePcm(
        int sampleRate,
        double frequencyHz,
        int durationMs,
        float amplitude
    ) {
        int totalSamples = (sampleRate * durationMs) / 1000;
        int fadeWindow = Math.max(sampleRate / 80, 12);
        byte[] pcm = new byte[totalSamples * 2];
        for (int index = 0; index < totalSamples; index += 1) {
            float fadeIn = Math.min(1.0f, index / (float) fadeWindow);
            float fadeOut = Math.min(1.0f, (totalSamples - index) / (float) fadeWindow);
            float envelope = Math.min(fadeIn, fadeOut);
            double value =
                Math.sin((2.0d * Math.PI * frequencyHz * index) / sampleRate) *
                (Short.MAX_VALUE * amplitude * envelope);
            int sample = Math.max(
                Short.MIN_VALUE,
                Math.min(Short.MAX_VALUE, (int) value)
            );
            int byteIndex = index * 2;
            pcm[byteIndex] = (byte) (sample & 0xFF);
            pcm[byteIndex + 1] = (byte) ((sample >> 8) & 0xFF);
        }
        return pcm;
    }
}
