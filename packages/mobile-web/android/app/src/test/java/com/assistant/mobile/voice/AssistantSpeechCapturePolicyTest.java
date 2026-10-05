package com.assistant.mobile.voice;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import org.junit.Test;

public final class AssistantSpeechCapturePolicyTest {
    @Test
    public void quietAudioCountsTowardNoSpeechTimeout() {
        AssistantSpeechCapturePolicy policy = policy(300, 1000, 200);
        assertEquals(AssistantSpeechCapturePolicy.End.CONTINUE, policy.accept(pcm(200, 0)));
        assertEquals(200, policy.durationMs());
        assertEquals(AssistantSpeechCapturePolicy.End.NO_SPEECH, policy.accept(pcm(200, 0)));
        assertEquals(4800, policy.acceptedBytes());
        assertEquals(300, policy.durationMs());
        assertFalse(policy.sawSpeech());
    }

    @Test
    public void rmsRequiresSpeechAboveBackgroundNoise() {
        AssistantSpeechCapturePolicy policy = policy(300, 1000, 200);
        policy.accept(pcm(100, 300)); // 0.009 RMS, below the 0.012 threshold.
        assertFalse(policy.sawSpeech());
        policy.accept(pcm(100, 400)); // 0.0122 RMS.
        assertTrue(policy.sawSpeech());
        assertEquals(AssistantSpeechCapturePolicy.End.CONTINUE, policy.accept(pcm(100, 0)));
        assertEquals(AssistantSpeechCapturePolicy.End.SILENCE, policy.accept(pcm(100, 0)));
        assertEquals(400, policy.durationMs());
    }

    @Test
    public void negativePcmSamplesRetainSpeechEnergy() {
        AssistantSpeechCapturePolicy policy = policy(300, 1000, 200);
        policy.accept(pcm(100, -1000));
        assertTrue(policy.sawSpeech());
        assertEquals(AssistantSpeechCapturePolicy.End.SILENCE, policy.accept(pcm(200, 0)));
    }

    @Test
    public void fragmentedInputProducesTheSameEndpointsAsFullFrames() {
        AssistantSpeechCapturePolicy whole = policy(300, 1000, 200);
        AssistantSpeechCapturePolicy fragmented = policy(300, 1000, 200);
        byte[] speech = pcm(100, 1000);
        byte[] silence = pcm(200, 0);
        whole.accept(speech);
        assertEquals(AssistantSpeechCapturePolicy.End.SILENCE, whole.accept(silence));
        for (int offset = 0; offset < speech.length; offset += 48) {
            fragmented.accept(Arrays.copyOfRange(speech, offset, offset + 48));
        }
        AssistantSpeechCapturePolicy.End end = AssistantSpeechCapturePolicy.End.CONTINUE;
        for (int offset = 0; offset < silence.length; offset += 48) {
            end = fragmented.accept(Arrays.copyOfRange(silence, offset, offset + 48));
        }
        assertEquals(AssistantSpeechCapturePolicy.End.SILENCE, end);
        assertEquals(whole.durationMs(), fragmented.durationMs());
        assertTrue(fragmented.sawSpeech());
    }

    @Test
    public void renewedSpeechRestartsTheSilenceDeadline() {
        AssistantSpeechCapturePolicy policy = policy(300, 1000, 200);
        policy.accept(pcm(100, 1000));
        policy.accept(pcm(100, 0));
        policy.accept(pcm(100, 1000));
        assertEquals(AssistantSpeechCapturePolicy.End.CONTINUE, policy.accept(pcm(100, 0)));
        assertEquals(AssistantSpeechCapturePolicy.End.SILENCE, policy.accept(pcm(100, 0)));
        assertEquals(500, policy.durationMs());
    }

    @Test
    public void completionTimeoutStartsAtFirstSpeech() {
        AssistantSpeechCapturePolicy policy = policy(1000, 300, 200);
        policy.accept(pcm(200, 0));
        assertEquals(AssistantSpeechCapturePolicy.End.CONTINUE, policy.accept(pcm(300, 1000)));
        assertEquals(AssistantSpeechCapturePolicy.End.MAX_DURATION, policy.accept(pcm(100, 1000)));
        assertEquals(600, policy.durationMs());
    }

    @Test
    public void byteCapStopsAtWholeSampleAndReportsTheAcceptedPrefix() {
        AssistantSpeechCapturePolicy policy = new AssistantSpeechCapturePolicy(1000, 1000, 200, 7201);
        assertEquals(AssistantSpeechCapturePolicy.End.MAX_DURATION, policy.accept(pcm(300, 1000)));
        assertEquals(7200, policy.acceptedBytes());
        assertEquals(150, policy.durationMs());
        assertTrue(policy.sawSpeech());
    }

    @Test
    public void shortByteCapAnalyzesPartialFrameForSpeech() {
        AssistantSpeechCapturePolicy policy = new AssistantSpeechCapturePolicy(1000, 1000, 200, 960);
        assertEquals(AssistantSpeechCapturePolicy.End.MAX_DURATION, policy.accept(pcm(100, 1000)));
        assertEquals(960, policy.acceptedBytes());
        assertEquals(20, policy.durationMs());
        assertTrue(policy.sawSpeech());
    }

    @Test
    public void endedCaptureDoesNotConsumeFurtherAudio() {
        AssistantSpeechCapturePolicy policy = policy(100, 1000, 200);
        policy.accept(pcm(100, 0));
        assertEquals(AssistantSpeechCapturePolicy.End.NO_SPEECH, policy.accept(pcm(100, 1000)));
        assertEquals(0, policy.acceptedBytes());
        assertEquals(100, policy.durationMs());
        assertFalse(policy.sawSpeech());
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsPartialPcmSamples() {
        policy(100, 1000, 200).accept(new byte[3]);
    }

    @Test(expected = IllegalArgumentException.class)
    public void rejectsInvalidCaptureTiming() {
        new AssistantSpeechCapturePolicy(0, 1000, 200, 48000);
    }

    @Test(expected = IllegalArgumentException.class)
    public void requiresCapacityForOneCompleteSample() {
        new AssistantSpeechCapturePolicy(100, 1000, 200, 1);
    }

    private static AssistantSpeechCapturePolicy policy(int startMs, int completionMs, int silenceMs) {
        return new AssistantSpeechCapturePolicy(startMs, completionMs, silenceMs, 48000 * 60L);
    }

    private static byte[] pcm(int durationMs, int sample) {
        byte[] result = new byte[durationMs * 48];
        for (int index = 0; index < result.length; index += 2) {
            result[index] = (byte) sample;
            result[index + 1] = (byte) (sample >> 8);
        }
        return result;
    }
}
