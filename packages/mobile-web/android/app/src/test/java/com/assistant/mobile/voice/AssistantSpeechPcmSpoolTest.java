package com.assistant.mobile.voice;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class AssistantSpeechPcmSpoolTest {
    @Test public void spoolIsBoundedOrderedAndUnlinkedBeforePlayback() throws Exception {
        File cache = Files.createTempDirectory("speech-spool-test").toFile();
        try (AssistantSpeechPcmSpool spool = new AssistantSpeechPcmSpool(cache, 6)) {
            assertEquals(0, cache.list().length);
            spool.append(new byte[]{1,2,3,4}, 4);
            assertArrayEquals(new byte[]{1,2,3,4}, spool.read());
            spool.append(new byte[]{5,6}, 2);
            assertThrows(IOException.class, () -> spool.append(new byte[]{7,8}, 2));
            spool.complete();
            assertArrayEquals(new byte[]{5,6}, spool.read());
            assertNull(spool.read());
        } finally { assertTrue(cache.delete()); }
    }

    @Test public void cancellationUnblocksWaitingReader() throws Exception {
        File cache = Files.createTempDirectory("speech-spool-test").toFile();
        try (AssistantSpeechPcmSpool spool = new AssistantSpeechPcmSpool(cache, 6)) {
            FutureTask<byte[]> waiting = new FutureTask<>(spool::read);
            Thread reader = new Thread(waiting); reader.start();
            spool.close();
            assertNull(waiting.get(1, TimeUnit.SECONDS));
            assertThrows(IOException.class, () -> spool.append(new byte[]{1,2}, 2));
        } finally { assertTrue(cache.delete()); }
    }
}
