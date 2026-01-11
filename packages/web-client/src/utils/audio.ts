import { AUDIO_FLAG_TTS, decodeAudioFrame, type AudioFrame } from '@assistant/shared';

export interface TtsAudioPlayerOptions {
  /**
   * Target jitter buffer in milliseconds. Audio playback will
   * maintain at least this much audio ahead of the current time.
   */
  jitterBufferMs?: number;
  /**
   * Optional callback invoked when playback becomes idle
   * (no active audio sources remain while the player is enabled).
   */
  onIdle?: () => void;
}

export function convertPcm16ToFloat32(pcmBytes: Uint8Array): Float32Array {
  const frameCount = Math.floor(pcmBytes.byteLength / 2);
  const result: Float32Array<ArrayBuffer> = new Float32Array(frameCount);
  const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);

  for (let i = 0; i < frameCount; i += 1) {
    const value = view.getInt16(i * 2, true);
    result[i] = value < 0 ? value / 0x8000 : value / 0x7fff;
  }

  return result;
}

export class TtsAudioPlayer {
  private readonly jitterBufferSec: number;
  private readonly onIdle: (() => void) | undefined;

  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private enabled = false;
  private muted = false;
  private playbackTime = 0;
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private readonly sourceMetadata = new Map<
    AudioBufferSourceNode,
    { startTimeSec: number; durationSec: number }
  >();
  private playedDurationSec = 0;

  constructor(options?: TtsAudioPlayerOptions) {
    const jitterMs = options?.jitterBufferMs ?? 200;
    this.jitterBufferSec = jitterMs > 0 ? jitterMs / 1000 : 0.1;
    this.onIdle = options?.onIdle;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) {
      return;
    }

    this.enabled = enabled;

    if (!enabled) {
      this.stopAll();
      return;
    }

    this.ensureAudioContext();
  }

  setMuted(muted: boolean): void {
    if (muted === this.muted) {
      return;
    }

    this.muted = muted;

    if (this.gainNode) {
      this.gainNode.gain.value = muted ? 0 : 1;
    }

    if (muted) {
      this.stopAll();
    }
  }

  stop(): void {
    this.enabled = false;
    this.stopAll();
  }

  dispose(): void {
    this.stopAll();

    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }

    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  handleIncomingFrame(input: ArrayBuffer | Uint8Array): void {
    if (!this.enabled || this.muted) {
      return;
    }

    const ctx = this.ensureAudioContext();
    if (!ctx) {
      return;
    }

    let frame: AudioFrame;
    try {
      frame = decodeAudioFrame(input);
    } catch {
      return;
    }

    if ((frame.flags & AUDIO_FLAG_TTS) === 0) {
      return;
    }

    if (frame.sampleFormat !== 1 || frame.channels !== 1) {
      return;
    }

    const pcm = convertPcm16ToFloat32(frame.data);
    if (pcm.length === 0) {
      return;
    }

    const buffer = ctx.createBuffer(1, pcm.length, frame.sampleRate);
    const pcmForChannel = pcm as unknown as Float32Array<ArrayBuffer>;
    buffer.copyToChannel(pcmForChannel, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode ?? ctx.destination);

    const now = ctx.currentTime;
    if (this.playbackTime < now + this.jitterBufferSec) {
      this.playbackTime = now + this.jitterBufferSec;
    }

    const startTime = this.playbackTime;

    try {
      source.start(startTime);
    } catch {
      return;
    }

    this.sourceMetadata.set(source, {
      startTimeSec: startTime,
      durationSec: buffer.duration,
    });

    this.activeSources.add(source);
    const scheduledEnd = this.playbackTime + buffer.duration;
    this.playbackTime = scheduledEnd;

    source.onended = () => {
      const meta = this.sourceMetadata.get(source);
      const ctxNow = this.audioContext?.currentTime ?? 0;
      if (meta) {
        const endTimeSec = Math.min(meta.startTimeSec + meta.durationSec, ctxNow);
        const playedSec = Math.max(0, endTimeSec - meta.startTimeSec);
        this.playedDurationSec += playedSec;
        this.sourceMetadata.delete(source);
      }
      this.activeSources.delete(source);
      if (!this.enabled || this.activeSources.size === 0) {
        this.playbackTime = 0;
        if (this.enabled && this.onIdle) {
          this.onIdle();
        }
      }
    };
  }

  /**
   * Returns an approximate total playback duration for the current
   * TTS response, in milliseconds.
   */
  getPlayedDurationMs(): number {
    const ctx = this.audioContext;
    let extra = 0;

    if (ctx) {
      const now = ctx.currentTime;
      for (const meta of this.sourceMetadata.values()) {
        const endTimeSec = Math.min(meta.startTimeSec + meta.durationSec, now);
        const playedSec = Math.max(0, endTimeSec - meta.startTimeSec);
        extra += playedSec;
      }
    }

    return Math.round((this.playedDurationSec + extra) * 1000);
  }

  /**
   * Stops all currently scheduled audio for a barge-in and returns
   * the estimated playback position in milliseconds.
   */
  stopForBargeIn(): number {
    const playedMs = this.getPlayedDurationMs();
    this.stopAll();
    return playedMs;
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioContext) {
      if (this.audioContext.state === 'suspended') {
        void this.audioContext.resume();
      }
      return this.audioContext;
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioCtx) {
      return null;
    }

    const ctx = new AudioCtx();
    const gain = ctx.createGain();
    gain.gain.value = this.muted ? 0 : 1;
    gain.connect(ctx.destination);

    this.audioContext = ctx;
    this.gainNode = gain;
    this.playbackTime = 0;

    return ctx;
  }

  private stopAll(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // Ignore errors from stopping an already-ended source.
      }
    }
    this.activeSources.clear();
    this.sourceMetadata.clear();
    this.playedDurationSec = 0;
    this.playbackTime = 0;
  }
}
