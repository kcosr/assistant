package com.assistant.mobile.voice;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.util.Base64;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class AssistantVoicePcmPlayer {
    private static final int RECOGNITION_CUE_SAMPLE_RATE = 48000;
    private static final int RECOGNITION_CUE_FADE_WINDOW_DIVISOR = 80;
    private static final int RECOGNITION_CUE_MIN_FADE_SAMPLES = 12;

    interface Listener {
        void onPlaybackDrained(String requestId);
    }

    private final Object lock = new Object();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private AudioTrack audioTrack;
    private Listener listener;
    private String activeRequestId = "";
    private int activeSampleRate = 0;
    private float ttsGain = AssistantVoiceConfig.DEFAULT_TTS_GAIN;
    private float recognitionCueGain = AssistantVoiceConfig.DEFAULT_RECOGNITION_CUE_GAIN;
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

    void setTtsGain(float gain) {
        synchronized (lock) {
            ttsGain = normalizeTtsGain(gain);
        }
    }

    void setRecognitionCueGain(float gain) {
        synchronized (lock) {
            recognitionCueGain = normalizeRecognitionCueGain(gain);
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

    boolean playRecognitionCue(boolean success) {
        byte[] cuePcm = generateRecognitionCuePcmData(RECOGNITION_CUE_SAMPLE_RATE, success);
        if (cuePcm.length == 0) {
            return false;
        }

        AudioTrack track;
        byte[] adjustedCue;
        synchronized (lock) {
            generation += 1L;
            activeRequestId = "";
            activeSampleRate = 0;
            streamEnded = false;
            pendingWrites = 0;
            framesWritten = 0;
            releaseTrackLocked();
            track = ensureTrackLocked(RECOGNITION_CUE_SAMPLE_RATE);
            if (track == null) {
                return false;
            }
            adjustedCue = applySoftwareGainPcm16(
                cuePcm,
                resolveRecognitionCueGain(recognitionCueGain)
            );
        }

        int offset = 0;
        while (offset < adjustedCue.length) {
            int written;
            try {
                written = track.write(adjustedCue, offset, adjustedCue.length - offset);
            } catch (Exception error) {
                break;
            }
            if (written <= 0) {
                break;
            }
            offset += written;
        }
        return offset > 0;
    }

    private void writeChunk(long taskGeneration, String requestId, byte[] chunk, int sampleRate) {
        AudioTrack track;
        float chunkGain;
        synchronized (lock) {
            if (taskGeneration != generation || !matchesActiveRequestLocked(requestId)) {
                pendingWrites = Math.max(0, pendingWrites - 1);
                return;
            }
            track = ensureTrackLocked(sampleRate);
            chunkGain = ttsGain;
            if (track == null) {
                pendingWrites = Math.max(0, pendingWrites - 1);
                maybeCompletePlaybackLocked();
                return;
            }
        }

        byte[] adjustedChunk = applySoftwareGainPcm16(chunk, chunkGain);
        int offset = 0;
        while (offset < adjustedChunk.length) {
            int written;
            try {
                written = track.write(adjustedChunk, offset, adjustedChunk.length - offset);
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
                framesWritten += adjustedChunk.length / 2;
            }
            pendingWrites = Math.max(0, pendingWrites - 1);
            maybeCompletePlaybackLocked();
        }
    }

    static float normalizeTtsGain(float gain) {
        if (!Float.isFinite(gain) || gain <= 0f) {
            return AssistantVoiceConfig.DEFAULT_TTS_GAIN;
        }
        if (gain < AssistantVoiceConfig.MIN_TTS_GAIN) {
            return AssistantVoiceConfig.MIN_TTS_GAIN;
        }
        if (gain > AssistantVoiceConfig.MAX_TTS_GAIN) {
            return AssistantVoiceConfig.MAX_TTS_GAIN;
        }
        return gain;
    }

    static float normalizeRecognitionCueGain(float gain) {
        if (!Float.isFinite(gain) || gain <= 0f) {
            return AssistantVoiceConfig.DEFAULT_RECOGNITION_CUE_GAIN;
        }
        if (gain < AssistantVoiceConfig.MIN_RECOGNITION_CUE_GAIN) {
            return AssistantVoiceConfig.MIN_RECOGNITION_CUE_GAIN;
        }
        if (gain > AssistantVoiceConfig.MAX_RECOGNITION_CUE_GAIN) {
            return AssistantVoiceConfig.MAX_RECOGNITION_CUE_GAIN;
        }
        return gain;
    }

    static float resolveRecognitionCueGain(float gain) {
        float normalized = (
            normalizeRecognitionCueGain(gain) - AssistantVoiceConfig.MIN_RECOGNITION_CUE_GAIN
        ) / (
            AssistantVoiceConfig.MAX_RECOGNITION_CUE_GAIN
                - AssistantVoiceConfig.MIN_RECOGNITION_CUE_GAIN
        );
        double cueGainDb = -16.0d + (normalized * 28.0d);
        return (float) Math.max(
            0.15d,
            Math.min(4.0d, Math.pow(10.0d, cueGainDb / 20.0d))
        );
    }

    static byte[] applySoftwareGainPcm16(byte[] input, float gain) {
        if (input == null || input.length == 0) {
            return new byte[0];
        }

        float normalizedGain = normalizeTtsGain(gain);
        if (Math.abs(normalizedGain - 1f) < 0.001f) {
            return input;
        }

        byte[] output = input.clone();
        int index = 0;
        while (index + 1 < output.length) {
            int low = output[index] & 0xFF;
            int high = output[index + 1];
            int sample = (high << 8) | low;
            int scaled = Math.max(
                Short.MIN_VALUE,
                Math.min(Short.MAX_VALUE, (int) (sample * normalizedGain))
            );
            output[index] = (byte) (scaled & 0xFF);
            output[index + 1] = (byte) ((scaled >> 8) & 0xFF);
            index += 2;
        }
        return output;
    }

    static byte[] generateRecognitionCuePcmData(int sampleRate, boolean success) {
        if (sampleRate <= 0) {
            return new byte[0];
        }

        CueSegment[] segments = success
            ? new CueSegment[] {
                new CueSegment(523.25d, 95, 0.14f),
                new CueSegment(0.0d, 55, 0.0f),
                new CueSegment(659.25d, 140, 0.16f),
            }
            : new CueSegment[] {
                new CueSegment(659.25d, 105, 0.14f),
                new CueSegment(0.0d, 55, 0.0f),
                new CueSegment(493.88d, 140, 0.16f),
            };

        int totalSamples = 0;
        for (CueSegment segment : segments) {
            totalSamples += (sampleRate * segment.durationMs) / 1000;
        }

        byte[] pcm = new byte[totalSamples * 2];
        int sampleOffset = 0;
        for (CueSegment segment : segments) {
            int segmentSamples = (sampleRate * segment.durationMs) / 1000;
            int fadeWindow = Math.max(
                sampleRate / RECOGNITION_CUE_FADE_WINDOW_DIVISOR,
                RECOGNITION_CUE_MIN_FADE_SAMPLES
            );
            for (int index = 0; index < segmentSamples; index += 1) {
                float fadeIn = clamp01(index / (float) fadeWindow);
                float fadeOut = clamp01((segmentSamples - index) / (float) fadeWindow);
                float envelope = Math.min(fadeIn, fadeOut);
                double value = 0.0d;
                if (segment.frequencyHz > 0.0d && segment.amplitude > 0f) {
                    value =
                        Math.sin(
                            (2.0d * Math.PI * segment.frequencyHz * index) / sampleRate
                        ) * (Short.MAX_VALUE * segment.amplitude * envelope);
                }
                int sample = Math.max(
                    Short.MIN_VALUE,
                    Math.min(Short.MAX_VALUE, (int) value)
                );
                int byteIndex = (sampleOffset + index) * 2;
                pcm[byteIndex] = (byte) (sample & 0xFF);
                pcm[byteIndex + 1] = (byte) ((sample >> 8) & 0xFF);
            }
            sampleOffset += segmentSamples;
        }
        return pcm;
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

    private static float clamp01(float value) {
        if (value < 0f) {
            return 0f;
        }
        if (value > 1f) {
            return 1f;
        }
        return value;
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

    private static final class CueSegment {
        final double frequencyHz;
        final int durationMs;
        final float amplitude;

        CueSegment(double frequencyHz, int durationMs, float amplitude) {
            this.frequencyHz = frequencyHz;
            this.durationMs = durationMs;
            this.amplitude = amplitude;
        }
    }
}
