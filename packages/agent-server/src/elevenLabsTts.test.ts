import { describe, expect, it } from 'vitest';
import { createAudioFramesFromPcm, getPcmOutputFormat } from './elevenLabsTts';

describe('getPcmOutputFormat', () => {
  it('returns exact match when supported', () => {
    const { outputFormat, outputSampleRate } = getPcmOutputFormat(24000);
    expect(outputFormat).toBe('pcm_24000');
    expect(outputSampleRate).toBe(24000);
  });

  it('returns closest supported rate when not exact', () => {
    const { outputFormat, outputSampleRate } = getPcmOutputFormat(23000);
    expect(outputSampleRate).toBe(22050);
    expect(outputFormat).toBe('pcm_22050');
  });
});

describe('createAudioFramesFromPcm', () => {
  it('splits PCM bytes into frames with monotonically increasing timestamps', () => {
    const sampleRate = 24000;
    const frameDurationMs = 40;
    const samplesPerFrame = Math.round((sampleRate * frameDurationMs) / 1000);
    const bytesPerFrame = samplesPerFrame * 2;

    const totalFrames = 3;
    const pcmBytes = new Uint8Array(totalFrames * bytesPerFrame);

    let seq = 0;

    const { frames, nextTimestampMs } = createAudioFramesFromPcm({
      pcmBytes,
      sampleRate,
      initialTimestampMs: 0,
      frameDurationMs,
      getNextSeq: () => seq++,
    });

    expect(frames.length).toBe(totalFrames);
    expect(nextTimestampMs).toBe(totalFrames * frameDurationMs);

    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i]!;
      expect(frame.seq).toBe(i);
      expect(frame.timestampMs).toBe(i * frameDurationMs);
      expect(frame.sampleRate).toBe(sampleRate);
      expect(frame.channels).toBe(1);
      expect(frame.data.byteLength).toBe(bytesPerFrame);
    }
  });
});
