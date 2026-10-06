package com.assistant.mobile.voice;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.os.Build;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.After;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowAudioRecord;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = Build.VERSION_CODES.N)
public final class AssistantVoiceMicStreamerTest {
    private AssistantVoiceMicStreamer streamer;

    @After
    public void cleanup() {
        if (streamer != null) {
            streamer.release();
        }
        ShadowAudioRecord.clearSource();
    }

    @Test
    public void partialReadsPreserveEveryByteAndProduceAligned100MsFrames() throws Exception {
        byte[] input = new byte[9600];
        for (int index = 0; index < input.length; index++) {
            input[index] = (byte) index;
        }
        ShadowAudioRecord.setSource(new ShadowAudioRecord.AudioRecordSource() {
            private int offset;

            @Override
            public int readInByteArray(byte[] target, int targetOffset, int size, boolean blocking) {
                if (offset == input.length) {
                    return -3;
                }
                int count = Math.min(Math.min(701, size), input.length - offset);
                System.arraycopy(input, offset, target, targetOffset, count);
                offset += count;
                return count;
            }
        });
        List<byte[]> chunks = new ArrayList<>();
        CountDownLatch stopped = new CountDownLatch(1);
        AtomicInteger sampleRate = new AtomicInteger();
        AtomicInteger channels = new AtomicInteger();
        List<String> encodings = new ArrayList<>();
        createStreamer();
        assertTrue(streamer.start("fragmented", new AssistantVoiceMicStreamer.Listener() {
            @Override public void onStarted(int rate, int channelCount, String encoding) {
                sampleRate.set(rate);
                channels.set(channelCount);
                encodings.add(encoding);
            }
            @Override public void onChunk(byte[] chunk) { chunks.add(chunk); }
            @Override public void onStopped() { stopped.countDown(); }
        }));
        assertTrue("capture must finish", stopped.await(5, TimeUnit.SECONDS));
        assertEquals(24000, sampleRate.get());
        assertEquals(1, channels.get());
        assertEquals("pcm_s16le", encodings.get(0));
        assertEquals(2, chunks.size());
        byte[] actual = new byte[9600];
        for (int index = 0; index < chunks.size(); index++) {
            assertEquals(4800, chunks.get(index).length);
            System.arraycopy(chunks.get(index), 0, actual, index * 4800, 4800);
        }
        assertArrayEquals(input, actual);
    }

    @Test
    public void endpointStopInsideChunkCallbackPreventsAnyFurtherReads() throws Exception {
        AtomicInteger reads = new AtomicInteger();
        AtomicInteger chunks = new AtomicInteger();
        AtomicInteger stops = new AtomicInteger();
        AtomicInteger errors = new AtomicInteger();
        CountDownLatch stopped = new CountDownLatch(1);
        ShadowAudioRecord.setSource(new ShadowAudioRecord.AudioRecordSource() {
            @Override
            public int readInByteArray(byte[] target, int offset, int size, boolean blocking) {
                reads.incrementAndGet();
                return size;
            }
        });
        createStreamer();
        assertTrue(streamer.start("endpoint", new AssistantVoiceMicStreamer.Listener() {
            @Override public void onStarted(int rate, int channels, String encoding) {}
            @Override public void onChunk(byte[] chunk) {
                chunks.incrementAndGet();
                streamer.stop("endpoint");
            }
            @Override public void onError(String safeCode) { errors.incrementAndGet(); }
            @Override public void onStopped() {
                stops.incrementAndGet();
                stopped.countDown();
            }
        }));
        assertTrue("capture must stop", stopped.await(5, TimeUnit.SECONDS));
        assertEquals(1, reads.get());
        assertEquals(1, chunks.get());
        assertEquals(1, stops.get());
        assertEquals(0, errors.get());
    }

    @Test
    public void stopDuringReadDoesNotForwardTheReturnedAudioOrReportFailure() throws Exception {
        AtomicInteger chunks = new AtomicInteger();
        AtomicInteger errors = new AtomicInteger();
        CountDownLatch stopped = new CountDownLatch(1);
        ShadowAudioRecord.setSource(new ShadowAudioRecord.AudioRecordSource() {
            @Override
            public int readInByteArray(byte[] target, int offset, int size, boolean blocking) {
                streamer.stop("during-read");
                return size;
            }
        });
        createStreamer();
        assertTrue(streamer.start("during-read", new AssistantVoiceMicStreamer.Listener() {
            @Override public void onStarted(int rate, int channels, String encoding) {}
            @Override public void onChunk(byte[] chunk) { chunks.incrementAndGet(); }
            @Override public void onError(String safeCode) { errors.incrementAndGet(); }
            @Override public void onStopped() { stopped.countDown(); }
        }));
        assertTrue("capture must stop", stopped.await(5, TimeUnit.SECONDS));
        assertEquals(0, chunks.get());
        assertEquals(0, errors.get());
    }

    @Test
    public void readFailureNotifiesStoppedWithoutForwardingIncompleteSamples() throws Exception {
        AtomicInteger chunks = new AtomicInteger();
        List<String> callbacks = new ArrayList<>();
        CountDownLatch stopped = new CountDownLatch(1);
        ShadowAudioRecord.setSource(new ShadowAudioRecord.AudioRecordSource() {
            private boolean first = true;

            @Override
            public int readInByteArray(byte[] target, int offset, int size, boolean blocking) {
                if (first) {
                    first = false;
                    return 3;
                }
                return -3;
            }
        });
        createStreamer();
        assertTrue(streamer.start("read-failure", new AssistantVoiceMicStreamer.Listener() {
            @Override public void onStarted(int rate, int channels, String encoding) {}
            @Override public void onChunk(byte[] chunk) { chunks.incrementAndGet(); }
            @Override public void onError(String safeCode) { callbacks.add(safeCode); }
            @Override public void onStopped() {
                callbacks.add("stopped");
                stopped.countDown();
            }
        }));
        assertTrue("failed capture must finish", stopped.await(5, TimeUnit.SECONDS));
        assertEquals(0, chunks.get());
        assertEquals("microphone_read_failed", callbacks.get(0));
        assertEquals("stopped", callbacks.get(1));
        assertEquals(2, callbacks.size());
    }

    private void createStreamer() {
        Shadows.shadowOf(RuntimeEnvironment.getApplication()).grantPermissions(Manifest.permission.RECORD_AUDIO);
        streamer = new AssistantVoiceMicStreamer(RuntimeEnvironment.getApplication());
    }
}
