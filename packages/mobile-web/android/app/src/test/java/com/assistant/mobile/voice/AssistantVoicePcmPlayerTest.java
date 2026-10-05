package com.assistant.mobile.voice;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

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
        assertArrayEquals(
            synthesizeSingleTonePcm(48000, 659.25d, 140, 0.16f),
            successCue
        );
    }

    @Test
    public void streamedPcmWaitsAtCapacityAndStopUnblocksProducer() throws Exception {
        assertProducerCancelledAtCapacity(AssistantVoicePcmPlayer::stop);
    }

    @Test
    public void completedPlaybackWriteMakesCapacityAvailableToProducer() throws Exception {
        HeldExecutor executor = new HeldExecutor();
        AssistantVoicePcmPlayer player = new AssistantVoicePcmPlayer(null, executor);
        CountDownLatch completed = new CountDownLatch(1);
        AtomicBoolean accepted = new AtomicBoolean();
        player.startStream("speech");
        assertTrue(player.writeStreamPcm(
            "speech", new byte[AssistantVoicePcmPlayer.MAX_QUEUED_STREAM_PCM_BYTES], 24000
        ));
        Thread producer = new Thread(() -> {
            try {
                accepted.set(player.writeStreamPcm("speech", new byte[2], 24000));
            } finally {
                completed.countDown();
            }
        });
        try {
            producer.start();
            awaitCapacityWait(producer);
            executor.runNext();
            assertTrue("A completed write should release queue space", completed.await(2, TimeUnit.SECONDS));
            assertTrue(accepted.get());
            assertEquals(2, executor.submittedCount);
        } finally {
            player.release();
            producer.interrupt();
            producer.join(2000);
        }
    }

    @Test
    public void replacementStreamUnblocksProducerEvenWhenRequestIdIsReused() throws Exception {
        assertProducerCancelledAtCapacity(player -> player.startStream("speech"));
    }

    @Test
    public void releaseUnblocksProducerAndRejectsFurtherAudio() throws Exception {
        assertProducerCancelledAtCapacity(AssistantVoicePcmPlayer::release);
    }

    @Test
    public void finishingStreamUnblocksProducerAndRejectsFurtherAudio() throws Exception {
        assertProducerCancelledAtCapacity(player -> player.finishStream("speech"));
    }

    @Test
    public void staleQueuedWriteCannotDrainReplacementStream() {
        HeldExecutor executor = new HeldExecutor();
        AssistantVoicePcmPlayer player = new AssistantVoicePcmPlayer(null, executor);
        AtomicBoolean drained = new AtomicBoolean();
        player.setListener(requestId -> drained.set(true));
        try {
            player.startStream("speech");
            assertTrue(player.writeStreamPcm("speech", new byte[2], 24000));
            player.startStream("speech");
            assertTrue(player.writeStreamPcm("speech", new byte[2], 24000));
            executor.runNext();
            player.finishStream("speech");
            assertFalse("A stale task must not decrement the current stream's pending writes", drained.get());
        } finally {
            player.release();
        }
    }

    @Test
    public void streamedPcmRejectsMisalignedOversizedAndInvalidRateAudio() {
        AssistantVoicePcmPlayer player = new AssistantVoicePcmPlayer(null, new HeldExecutor());
        try {
            player.startStream("speech");
            assertInvalidPcm(player, new byte[3], 24000);
            assertInvalidPcm(player, new byte[AssistantVoicePcmPlayer.MAX_QUEUED_STREAM_PCM_BYTES + 2], 24000);
            assertInvalidPcm(player, new byte[2], 0);
            assertInvalidPcm(player, new byte[0], 24000);
            assertInvalidPcm(player, null, 24000);
            assertFalse(player.writeStreamPcm("stale", new byte[2], 24000));
            assertTrue(player.writeStreamPcm("speech", new byte[2], 24000));
        } finally {
            player.release();
        }
    }

    private static void assertInvalidPcm(AssistantVoicePcmPlayer player, byte[] pcm, int sampleRate) {
        try {
            player.writeStreamPcm("speech", pcm, sampleRate);
            throw new AssertionError("Invalid PCM should be rejected");
        } catch (IllegalArgumentException expected) {
        }
    }

    private static void assertProducerCancelledAtCapacity(
        java.util.function.Consumer<AssistantVoicePcmPlayer> cancel
    ) throws Exception {
        HeldExecutor executor = new HeldExecutor();
        AssistantVoicePcmPlayer player = new AssistantVoicePcmPlayer(null, executor);
        CountDownLatch completed = new CountDownLatch(1);
        AtomicBoolean accepted = new AtomicBoolean(true);
        player.startStream("speech");
        assertTrue(player.writeStreamPcm(
            "speech", new byte[AssistantVoicePcmPlayer.MAX_QUEUED_STREAM_PCM_BYTES], 24000
        ));
        Thread producer = new Thread(() -> {
            try {
                accepted.set(player.writeStreamPcm("speech", new byte[2], 24000));
            } finally {
                completed.countDown();
            }
        });
        try {
            producer.start();
            awaitCapacityWait(producer);
            assertEquals(1L, completed.getCount());
            assertEquals(1, executor.size());
            cancel.accept(player);
            assertTrue("Cancellation must wake the blocked HTTP reader", completed.await(2, TimeUnit.SECONDS));
            assertFalse(accepted.get());
            assertEquals("Cancelled PCM must not be submitted", 1, executor.submittedCount);
        } finally {
            player.release();
            producer.interrupt();
            producer.join(2000);
        }
    }

    private static void awaitCapacityWait(Thread producer) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (producer.getState() != Thread.State.WAITING && System.nanoTime() < deadline) {
            Thread.sleep(1);
        }
        assertEquals("The PCM producer should be waiting for queue capacity", Thread.State.WAITING, producer.getState());
    }

    private static final class HeldExecutor extends AbstractExecutorService {
        private final Queue<Runnable> tasks = new ArrayDeque<>();
        private boolean shutdown;
        private int submittedCount;

        @Override
        public synchronized void execute(Runnable command) {
            if (shutdown) {
                throw new java.util.concurrent.RejectedExecutionException();
            }
            tasks.add(command);
            submittedCount += 1;
        }

        synchronized int size() {
            return tasks.size();
        }

        void runNext() {
            Runnable next;
            synchronized (this) {
                next = tasks.remove();
            }
            next.run();
        }

        @Override
        public synchronized void shutdown() {
            shutdown = true;
        }

        @Override
        public synchronized List<Runnable> shutdownNow() {
            shutdown = true;
            tasks.clear();
            return Collections.emptyList();
        }

        @Override
        public synchronized boolean isShutdown() {
            return shutdown;
        }

        @Override
        public synchronized boolean isTerminated() {
            return shutdown;
        }

        @Override
        public boolean awaitTermination(long timeout, TimeUnit unit) {
            return isShutdown();
        }
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
