import { describe, expect, it } from 'vitest';
import {
  AUDIO_FLAG_MIC,
  AUDIO_FRAME_MAGIC,
  encodeAudioFrame,
  type AudioFrame,
} from '../../shared/src/audio';
import { type MicAudioValidationConfig, validateAndDecodeMicAudioFrame } from './audio';

const DEFAULT_CONFIG: MicAudioValidationConfig = {
  expectedSampleRate: 24000,
  expectedChannels: 1,
};

function createValidFrame(): AudioFrame {
  const data = new Uint8Array([1, 2, 3, 4, 5, 6]);
  return {
    magic: AUDIO_FRAME_MAGIC,
    flags: AUDIO_FLAG_MIC,
    seq: 1,
    timestampMs: 123,
    sampleRate: DEFAULT_CONFIG.expectedSampleRate,
    channels: DEFAULT_CONFIG.expectedChannels,
    sampleFormat: 1,
    data,
  };
}

describe('validateAndDecodeMicAudioFrame', () => {
  it('accepts a valid mic audio frame', () => {
    const frame = createValidFrame();
    const encoded = encodeAudioFrame(frame);

    const result = validateAndDecodeMicAudioFrame(encoded, DEFAULT_CONFIG);

    expect(result.frame.magic).toBe(AUDIO_FRAME_MAGIC);
    expect(result.frame.flags & AUDIO_FLAG_MIC).toBe(AUDIO_FLAG_MIC);
    expect(result.frame.sampleRate).toBe(DEFAULT_CONFIG.expectedSampleRate);
    expect(result.frame.channels).toBe(DEFAULT_CONFIG.expectedChannels);
    expect(Array.from(result.pcmBytes)).toEqual(Array.from(frame.data));
  });

  it('rejects frames without the MIC flag', () => {
    const frame = createValidFrame();
    frame.flags = 0;
    const encoded = encodeAudioFrame(frame);

    expect(() => validateAndDecodeMicAudioFrame(encoded, DEFAULT_CONFIG)).toThrow(/MIC flag/i);
  });

  it('rejects frames with unsupported sample rate', () => {
    const frame = createValidFrame();
    frame.sampleRate = 16000;
    const encoded = encodeAudioFrame(frame);

    expect(() => validateAndDecodeMicAudioFrame(encoded, DEFAULT_CONFIG)).toThrow(/sample rate/i);
  });

  it('rejects frames with unsupported channel count', () => {
    const frame = createValidFrame();
    frame.channels = 2;
    const encoded = encodeAudioFrame(frame);

    expect(() => validateAndDecodeMicAudioFrame(encoded, DEFAULT_CONFIG)).toThrow(/channel count/i);
  });
});
