package com.assistant.mobile.voice;

/** Endpoints 24 kHz mono PCM16 capture using its sample clock, including quiet audio. */
final class AssistantSpeechCapturePolicy {
    static final int SAMPLE_RATE = 24000;
    static final int FRAME_SAMPLES = SAMPLE_RATE / 10;
    private static final double SPEECH_RMS = 0.012;

    enum End { CONTINUE, NO_SPEECH, SILENCE, MAX_DURATION }

    private final long startSamples;
    private final long completionSamples;
    private final long silenceSamples;
    private final long maxSamples;
    private long samples;
    private long firstSpeech = -1;
    private long lastSpeech;
    private int frameSamples;
    private double squares;
    private End end = End.CONTINUE;
    private int acceptedBytes;

    AssistantSpeechCapturePolicy(
        int startTimeoutMs,
        int completionTimeoutMs,
        int endSilenceMs,
        long maxBufferBytes
    ) {
        if (startTimeoutMs <= 0 || completionTimeoutMs <= 0 || endSilenceMs <= 0 || maxBufferBytes < 2) {
            throw new IllegalArgumentException("invalid_capture_limits");
        }
        startSamples = SAMPLE_RATE * (long) startTimeoutMs / 1000;
        completionSamples = SAMPLE_RATE * (long) completionTimeoutMs / 1000;
        silenceSamples = SAMPLE_RATE * (long) endSilenceMs / 1000;
        maxSamples = maxBufferBytes / 2;
    }

    End accept(byte[] pcm) {
        if (pcm == null || (pcm.length & 1) != 0) {
            throw new IllegalArgumentException("invalid_capture_pcm");
        }
        acceptedBytes = 0;
        for (int offset = 0; offset < pcm.length && end == End.CONTINUE; offset += 2) {
            short value = (short) ((pcm[offset] & 255) | (pcm[offset + 1] << 8));
            double normalized = value / 32768.0;
            squares += normalized * normalized;
            samples++;
            frameSamples++;
            acceptedBytes += 2;
            if (frameSamples == FRAME_SAMPLES || samples == maxSamples) {
                if (squares / frameSamples >= SPEECH_RMS * SPEECH_RMS) {
                    if (firstSpeech < 0) {
                        firstSpeech = samples;
                    }
                    lastSpeech = samples;
                }
                frameSamples = 0;
                squares = 0;
                if (samples == maxSamples) {
                    end = End.MAX_DURATION;
                } else if (firstSpeech < 0 && samples >= startSamples) {
                    end = End.NO_SPEECH;
                } else if (firstSpeech >= 0 && samples - firstSpeech >= completionSamples) {
                    end = End.MAX_DURATION;
                } else if (firstSpeech >= 0 && samples - lastSpeech >= silenceSamples) {
                    end = End.SILENCE;
                }
            }
        }
        return end;
    }

    /** Number of bytes analyzed from the last chunk; append only this prefix before ending capture. */
    int acceptedBytes() {
        return acceptedBytes;
    }

    boolean sawSpeech() {
        return firstSpeech >= 0;
    }

    int durationMs() {
        return (int) Math.min(Integer.MAX_VALUE, samples * 1000 / SAMPLE_RATE);
    }
}
