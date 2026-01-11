import { describe, expect, it } from 'vitest';
import {
  AUDIO_FLAG_MIC,
  AUDIO_FLAG_TTS,
  AUDIO_FRAME_HEADER_SIZE,
  AUDIO_FRAME_MAGIC,
  decodeAudioFrame,
  encodeAudioFrame,
  type AudioFrame,
} from './audio';

describe('audio frame encoding', () => {
  it('encodes and decodes header and data', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const frame: AudioFrame = {
      magic: AUDIO_FRAME_MAGIC,
      flags: AUDIO_FLAG_MIC | AUDIO_FLAG_TTS,
      seq: 42,
      timestampMs: 123456,
      sampleRate: 24000,
      channels: 1,
      sampleFormat: 1,
      data,
    };
    const encoded = encodeAudioFrame(frame);
    expect(encoded.byteLength).toBe(AUDIO_FRAME_HEADER_SIZE + data.byteLength);
    const decoded = decodeAudioFrame(encoded);
    expect(decoded.magic).toBe(frame.magic);
    expect(decoded.flags).toBe(frame.flags);
    expect(decoded.seq).toBe(frame.seq);
    expect(decoded.timestampMs).toBe(frame.timestampMs);
    expect(decoded.sampleRate).toBe(frame.sampleRate);
    expect(decoded.channels).toBe(frame.channels);
    expect(decoded.sampleFormat).toBe(frame.sampleFormat);
    expect(Array.from(decoded.data)).toEqual(Array.from(data));
  });

  it('rejects frames with invalid magic', () => {
    const bytes = new Uint8Array(AUDIO_FRAME_HEADER_SIZE + 1);
    bytes[0] = 0;
    expect(() => decodeAudioFrame(bytes)).toThrow();
  });

  it('rejects frames with unsupported sample format', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const frame: AudioFrame = {
      magic: AUDIO_FRAME_MAGIC,
      flags: 0,
      seq: 1,
      timestampMs: 1,
      sampleRate: 24000,
      channels: 1,
      sampleFormat: 1,
      data,
    };
    const encoded = encodeAudioFrame(frame);
    const mutated = new Uint8Array(encoded);
    mutated[13] = 2;
    expect(() => decodeAudioFrame(mutated)).toThrow();
  });

  it('rejects frames with invalid channel count or sample rate', () => {
    const data = new Uint8Array([0]);
    const frame: AudioFrame = {
      magic: AUDIO_FRAME_MAGIC,
      flags: 0,
      seq: 1,
      timestampMs: 1,
      sampleRate: 24000,
      channels: 1,
      sampleFormat: 1,
      data,
    };
    const encoded = encodeAudioFrame(frame);
    const badChannels = new Uint8Array(encoded);
    badChannels[12] = 0;
    expect(() => decodeAudioFrame(badChannels)).toThrow();

    const badRate = new Uint8Array(encoded);
    badRate[10] = 0;
    badRate[11] = 0;
    expect(() => decodeAudioFrame(badRate)).toThrow();
  });
});
