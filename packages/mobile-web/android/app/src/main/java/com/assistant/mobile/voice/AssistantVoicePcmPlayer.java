package com.assistant.mobile.voice;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Base64;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class AssistantVoicePcmPlayer {
    interface Listener {
        void onPlaybackDrained(String requestId);
    }

    private final Object lock = new Object();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private AudioTrack audioTrack;
    private Listener listener;
    private String activeRequestId = "";
    private int activeSampleRate = 0;
    private boolean streamEnded = false;
    private int pendingWrites = 0;
    private int framesWritten = 0;
    private long generation = 0L;

    AssistantVoicePcmPlayer() {}

    void setListener(Listener listener) {
        synchronized (lock) {
            this.listener = listener;
        }
    }

    void startStream(String requestId) {
        synchronized (lock) {
            generation += 1L;
            activeRequestId = requestId == null ? "" : requestId.trim();
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
        }
    }

    void enqueueChunk(String requestId, String chunkBase64, int sampleRate) {
        final byte[] chunk;
        try {
            chunk = Base64.decode(chunkBase64, Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            return;
        }
        if (chunk.length == 0) {
            return;
        }

        final long taskGeneration;
        synchronized (lock) {
            if (!matchesActiveRequestLocked(requestId)) {
                return;
            }
            pendingWrites += 1;
            taskGeneration = generation;
        }

        executor.execute(() -> writeChunk(taskGeneration, requestId, chunk, sampleRate));
    }

    void finishStream(String requestId) {
        synchronized (lock) {
            if (!matchesActiveRequestLocked(requestId)) {
                return;
            }
            streamEnded = true;
            maybeCompletePlaybackLocked();
        }
    }

    void stop() {
        synchronized (lock) {
            generation += 1L;
            activeRequestId = "";
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
        }
    }

    void release() {
        stop();
        executor.shutdownNow();
    }

    private void writeChunk(long taskGeneration, String requestId, byte[] chunk, int sampleRate) {
        AudioTrack track;
        synchronized (lock) {
            if (taskGeneration != generation || !matchesActiveRequestLocked(requestId)) {
                pendingWrites = Math.max(0, pendingWrites - 1);
                return;
            }
            track = ensureTrackLocked(sampleRate);
            if (track == null) {
                pendingWrites = Math.max(0, pendingWrites - 1);
                maybeCompletePlaybackLocked();
                return;
            }
        }

        int offset = 0;
        while (offset < chunk.length) {
            int written;
            try {
                written = track.write(chunk, offset, chunk.length - offset);
            } catch (Exception error) {
                break;
            }
            if (written <= 0) {
                break;
            }
            offset += written;
        }

        synchronized (lock) {
            if (taskGeneration == generation && matchesActiveRequestLocked(requestId)) {
                framesWritten += chunk.length / 2;
            }
            pendingWrites = Math.max(0, pendingWrites - 1);
            maybeCompletePlaybackLocked();
        }
    }

    private AudioTrack ensureTrackLocked(int sampleRate) {
        int normalizedRate = sampleRate > 0 ? sampleRate : 24000;
        if (audioTrack != null && activeSampleRate == normalizedRate) {
            return audioTrack;
        }

        releaseTrackLocked();
        int minBuffer = AudioTrack.getMinBufferSize(
            normalizedRate,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );
        if (minBuffer <= 0) {
            return null;
        }

        AudioTrack track = new AudioTrack.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                new AudioFormat.Builder()
                    .setSampleRate(normalizedRate)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setTransferMode(AudioTrack.MODE_STREAM)
            .setBufferSizeInBytes(Math.max(minBuffer, normalizedRate / 2))
            .build();
        track.setPlaybackPositionUpdateListener(new AudioTrack.OnPlaybackPositionUpdateListener() {
            @Override
            public void onMarkerReached(AudioTrack track) {
                Listener currentListener;
                String requestIdForCallback;
                synchronized (lock) {
                    if (audioTrack != track || activeRequestId.isEmpty()) {
                        return;
                    }
                    currentListener = listener;
                    requestIdForCallback = activeRequestId;
                    generation += 1L;
                    activeRequestId = "";
                    activeSampleRate = 0;
                    streamEnded = false;
                    pendingWrites = 0;
                    framesWritten = 0;
                    releaseTrackLocked();
                }
                if (currentListener != null) {
                    currentListener.onPlaybackDrained(requestIdForCallback);
                }
            }

            @Override
            public void onPeriodicNotification(AudioTrack track) {
            }
        });
        track.play();
        audioTrack = track;
        activeSampleRate = normalizedRate;
        return audioTrack;
    }

    private void maybeCompletePlaybackLocked() {
        if (!streamEnded || pendingWrites > 0) {
            return;
        }
        if (activeRequestId.isEmpty()) {
            return;
        }
        if (framesWritten <= 0 || audioTrack == null) {
            Listener currentListener = listener;
            String requestIdForCallback = activeRequestId;
            generation += 1L;
            activeRequestId = "";
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
            if (currentListener != null) {
                currentListener.onPlaybackDrained(requestIdForCallback);
            }
            return;
        }

        try {
            audioTrack.setNotificationMarkerPosition(framesWritten);
        } catch (IllegalStateException ignored) {
            Listener currentListener = listener;
            String requestIdForCallback = activeRequestId;
            generation += 1L;
            activeRequestId = "";
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
            if (currentListener != null) {
                currentListener.onPlaybackDrained(requestIdForCallback);
            }
        }
    }

    private boolean matchesActiveRequestLocked(String requestId) {
        return requestId != null && requestId.trim().equals(activeRequestId);
    }

    private void releaseTrackLocked() {
        if (audioTrack == null) {
            return;
        }
        try {
            audioTrack.pause();
        } catch (Exception ignored) {
        }
        try {
            audioTrack.flush();
        } catch (Exception ignored) {
        }
        try {
            audioTrack.release();
        } catch (Exception ignored) {
        }
        audioTrack = null;
    }
}
