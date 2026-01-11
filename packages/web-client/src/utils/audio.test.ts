import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIO_FLAG_TTS,
  AUDIO_FRAME_MAGIC,
  encodeAudioFrame,
  type AudioFrame,
} from '@assistant/shared';
import { TtsAudioPlayer, convertPcm16ToFloat32 } from './audio';

describe('convertPcm16ToFloat32', () => {
  it('converts signed 16-bit PCM to float32', () => {
    const pcm = new Int16Array([-32768, 0, 32767]);
    const bytes = new Uint8Array(pcm.buffer);

    const floats = convertPcm16ToFloat32(bytes);

    expect(floats.length).toBe(3);
    expect(floats[1]).toBeCloseTo(0);
    expect(floats[2]).toBeCloseTo(1, 3);
    expect(floats[0]).toBeLessThan(0);
  });
});

describe('TtsAudioPlayer', () => {
  class FakeAudioBuffer {
    readonly length: number;
    readonly duration: number;
    readonly sampleRate: number;

    constructor(length: number, sampleRate: number) {
      this.length = length;
      this.sampleRate = sampleRate;
      this.duration = length / sampleRate;
    }

    copyToChannel(_data: Float32Array, _channel: number): void {
      // No-op for tests.
    }
  }

  class FakeSource {
    buffer: FakeAudioBuffer | null = null;
    onended: (() => void) | null = null;

    connect(_destination: unknown): void {
      // No-op for tests.
    }

    start(when: number): void {
      scheduledStartTimes.push(when);
    }

    stop(): void {
      if (this.onended) {
        this.onended();
      }
    }
  }

  class FakeGain {
    gain = { value: 1 };

    connect(_destination: unknown): void {
      // No-op for tests.
    }

    disconnect(): void {
      // No-op for tests.
    }
  }

  class FakeAudioContext {
    currentTime = 0;
    readonly destination: unknown = {};
    state: 'running' | 'suspended' = 'running';

    createGain(): GainNode {
      return new FakeGain() as unknown as GainNode;
    }

    createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
      if (channels !== 1) {
        throw new Error('Only mono buffers are supported in tests');
      }
      return new FakeAudioBuffer(length, sampleRate) as unknown as AudioBuffer;
    }

    createBufferSource(): AudioBufferSourceNode {
      return new FakeSource() as unknown as AudioBufferSourceNode;
    }

    async close(): Promise<void> {
      this.state = 'suspended';
    }

    async resume(): Promise<void> {
      this.state = 'running';
    }
  }

  let scheduledStartTimes: number[] = [];
  let createdContext: FakeAudioContext | null = null;

  beforeEach(() => {
    scheduledStartTimes = [];
    createdContext = null;

    class AudioCtx extends FakeAudioContext {
      constructor() {
        super();
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- needed for test tracking
        createdContext = this;
      }
    }

    (globalThis as Record<string, unknown>)['window'] = {
      AudioContext: AudioCtx,
    };
  });

  it('schedules playback for TTS frames', () => {
    const player = new TtsAudioPlayer({ jitterBufferMs: 100 });
    player.setEnabled(true);

    const pcm = new Int16Array([0, 32767, -32768]);
    const pcmBytes = new Uint8Array(pcm.buffer);
    const frame: AudioFrame = {
      magic: AUDIO_FRAME_MAGIC,
      flags: AUDIO_FLAG_TTS,
      seq: 1,
      timestampMs: 0,
      sampleRate: 24000,
      channels: 1,
      sampleFormat: 1,
      data: pcmBytes,
    };

    const encoded = encodeAudioFrame(frame);

    player.handleIncomingFrame(encoded);

    expect(scheduledStartTimes.length).toBeGreaterThan(0);
    expect(scheduledStartTimes[0]).toBeGreaterThan(0);
  });

  it('reports approximate played duration on barge-in', () => {
    const player = new TtsAudioPlayer({ jitterBufferMs: 0 });
    player.setEnabled(true);

    const pcm = new Int16Array([0, 32767, -32768, 0, 0, 0]);
    const pcmBytes = new Uint8Array(pcm.buffer);
    const frame: AudioFrame = {
      magic: AUDIO_FRAME_MAGIC,
      flags: AUDIO_FLAG_TTS,
      seq: 1,
      timestampMs: 0,
      sampleRate: 24000,
      channels: 1,
      sampleFormat: 1,
      data: pcmBytes,
    };

    const encoded = encodeAudioFrame(frame);
    player.handleIncomingFrame(encoded);

    if (createdContext) {
      createdContext.currentTime = 0.05;
    }

    const playedMs = player.stopForBargeIn();
    expect(playedMs).toBeGreaterThanOrEqual(0);
  });
});
