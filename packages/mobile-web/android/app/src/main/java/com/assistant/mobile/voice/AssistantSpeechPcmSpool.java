package com.assistant.mobile.voice;

import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;

/** Bounded disk spool: HTTP consumes at network speed while playback reads independently. */
final class AssistantSpeechPcmSpool implements AutoCloseable {
    private final RandomAccessFile storage;
    private final long maximumBytes;
    private long written, read;
    private boolean complete, closed;

    AssistantSpeechPcmSpool(File cacheDirectory, long maximumBytes) throws IOException {
        this.maximumBytes = maximumBytes;
        File file = File.createTempFile("assistant-speech-", ".pcm", cacheDirectory);
        RandomAccessFile opened = null;
        try {
            opened = new RandomAccessFile(file, "rw");
            // Android/Linux keeps the open inode usable. No audio file survives process death.
            if (!file.delete()) throw new IOException("Could not unlink speech spool");
            storage = opened;
        } catch (IOException error) {
            if (opened != null) opened.close();
            file.delete();
            throw error;
        }
    }

    synchronized void append(byte[] bytes, int length) throws IOException {
        if (closed || complete) throw new IOException("Speech spool closed");
        if (length < 0 || length > bytes.length || (length & 1) != 0 || written + length > maximumBytes)
            throw new IOException("Speech spool limit exceeded");
        storage.seek(written);
        storage.write(bytes, 0, length);
        written += length;
        notifyAll();
    }

    synchronized byte[] read() throws IOException, InterruptedException {
        while (!closed && read == written && !complete) wait();
        if (closed || read == written) return null;
        byte[] bytes = new byte[(int) Math.min(8192, written - read)];
        storage.seek(read);
        storage.readFully(bytes);
        read += bytes.length;
        return bytes;
    }

    synchronized void complete() {
        complete = true;
        notifyAll();
    }

    @Override public synchronized void close() {
        if (closed) return;
        closed = true;
        notifyAll();
        try { storage.close(); } catch (IOException ignored) { }
    }
}
