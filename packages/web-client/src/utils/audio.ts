import { AUDIO_FLAG_TTS, decodeAudioFrame, type AudioFrame } from '@assistant/shared';

const TTS_WORKLET_PROCESSOR_NAME = 'tts-ring-buffer-processor';
const DEFAULT_WORKLET_BUFFER_SEC = 10;
const WORKLET_IDLE_GRACE_MS = 300;

const TTS_WORKLET_SOURCE = `
class TtsRingBufferProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1);
    this.maxBufferSamples = 1;
    this.jitterBufferSamples = 0;
    this.writeIndex = 0;
    this.readIndex = 0;
    this.bufferedSamples = 0;
    this.playedSamples = 0;
    this.droppedSamples = 0;
    this.playing = false;
    this.statusIntervalSamples = Math.max(1, Math.floor(sampleRate * 0.25));
    this.samplesSinceStatus = 0;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'config') {
        const maxBufferSamples = Number(data.maxBufferSamples) || 1;
        const jitterBufferSamples = Number(data.jitterBufferSamples) || 0;
        this.configure(maxBufferSamples, jitterBufferSamples);
        this.postStatus();
        return;
      }
      if (data.type === 'chunk') {
        this.enqueue(data.samples);
        return;
      }
      if (data.type === 'reset') {
        this.reset();
        this.postStatus();
        return;
      }
      if (data.type === 'status') {
        this.postStatus();
      }
    };
  }

  configure(maxBufferSamples, jitterBufferSamples) {
    const safeMax = Math.max(1, Math.floor(maxBufferSamples));
    this.ensureBuffer(safeMax);
    this.maxBufferSamples = safeMax;
    this.jitterBufferSamples = Math.max(0, Math.floor(jitterBufferSamples));
  }

  ensureBuffer(size) {
    if (this.buffer.length === size) {
      return;
    }
    const next = new Float32Array(size);
    for (let i = 0; i < this.bufferedSamples; i += 1) {
      next[i] = this.buffer[(this.readIndex + i) % this.buffer.length];
    }
    this.buffer = next;
    this.readIndex = 0;
    this.writeIndex = this.bufferedSamples % this.buffer.length;
  }

  reset() {
    this.bufferedSamples = 0;
    this.playedSamples = 0;
    this.droppedSamples = 0;
    this.readIndex = 0;
    this.writeIndex = 0;
    this.playing = false;
  }

  postStatus() {
    this.port.postMessage({
      type: 'status',
      bufferedSamples: this.bufferedSamples,
      playedSamples: this.playedSamples,
      droppedSamples: this.droppedSamples,
    });
  }

  enqueue(samples) {
    if (!samples || this.maxBufferSamples <= 0) {
      return;
    }
    let input = samples instanceof Float32Array ? samples : new Float32Array(samples);
    if (input.length === 0) {
      return;
    }
    if (input.length > this.maxBufferSamples) {
      input = input.subarray(input.length - this.maxBufferSamples);
    }
    const space = this.maxBufferSamples - this.bufferedSamples;
    if (input.length > space) {
      const drop = input.length - space;
      this.readIndex = (this.readIndex + drop) % this.maxBufferSamples;
      this.bufferedSamples -= drop;
      this.droppedSamples += drop;
    }
    for (let i = 0; i < input.length; i += 1) {
      this.buffer[this.writeIndex] = input[i];
      this.writeIndex = (this.writeIndex + 1) % this.maxBufferSamples;
    }
    this.bufferedSamples += input.length;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) {
      return true;
    }
    const channel = output[0];
    if (!channel) {
      return true;
    }
    const frames = channel.length;
    channel.fill(0);

    if (!this.playing && this.bufferedSamples >= this.jitterBufferSamples) {
      this.playing = true;
    }

    if (this.playing && this.bufferedSamples > 0) {
      const framesToRead = Math.min(frames, this.bufferedSamples);
      for (let i = 0; i < framesToRead; i += 1) {
        channel[i] = this.buffer[this.readIndex];
        this.readIndex = (this.readIndex + 1) % this.maxBufferSamples;
      }
      this.bufferedSamples -= framesToRead;
      this.playedSamples += framesToRead;
      if (this.bufferedSamples === 0) {
        this.playing = false;
      }
    }

    this.samplesSinceStatus += frames;
    if (this.samplesSinceStatus >= this.statusIntervalSamples || this.bufferedSamples === 0) {
      this.postStatus();
      this.samplesSinceStatus = 0;
    }

    return true;
  }
}
registerProcessor('${TTS_WORKLET_PROCESSOR_NAME}', TtsRingBufferProcessor);
`;

let ttsWorkletUrl: string | null = null;

function getTtsWorkletUrl(): string {
  if (!ttsWorkletUrl) {
    const blob = new Blob([TTS_WORKLET_SOURCE], { type: 'application/javascript' });
    ttsWorkletUrl = URL.createObjectURL(blob);
  }
  return ttsWorkletUrl;
}

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

export function resampleFloat32(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (!Number.isFinite(sourceRate) || !Number.isFinite(targetRate)) {
    return samples;
  }
  if (sourceRate <= 0 || targetRate <= 0 || sourceRate === targetRate) {
    return samples;
  }
  if (samples.length === 0) {
    return samples;
  }

  const ratio = targetRate / sourceRate;
  const outputLength = Math.max(1, Math.round(samples.length * ratio));
  const output = new Float32Array(outputLength);
  const lastIndex = samples.length - 1;

  for (let i = 0; i < outputLength; i += 1) {
    const srcIndex = i / ratio;
    const index0 = Math.floor(srcIndex);
    const index1 = Math.min(index0 + 1, lastIndex);
    const frac = srcIndex - index0;
    const start = samples[index0] ?? 0;
    const end = samples[index1] ?? start;
    output[i] = start + (end - start) * frac;
  }

  return output;
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
  private workletState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
  private workletNode: AudioWorkletNode | null = null;
  private workletBufferedSamples = 0;
  private workletPlayedSamples = 0;
  private workletSampleRate = 0;
  private workletMaxBufferSamples = 0;
  private workletQueue: Float32Array[] = [];
  private workletQueuedSamples = 0;
  private workletIdleNotified = false;
  private workletIdleTimer: ReturnType<typeof setTimeout> | null = null;
  private workletLoadPromise: Promise<void> | null = null;

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

    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    this.workletState = 'idle';
    this.workletLoadPromise = null;

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

    if (this.ensureWorklet(ctx)) {
      const targetSampleRate = Number.isFinite(ctx.sampleRate) ? ctx.sampleRate : frame.sampleRate;
      const prepared =
        frame.sampleRate === targetSampleRate
          ? pcm
          : resampleFloat32(pcm, frame.sampleRate, targetSampleRate);
      this.enqueueWorkletSamples(prepared);
      return;
    }

    this.scheduleBufferSource(ctx, pcm, frame.sampleRate);
  }

  /**
   * Returns an approximate total playback duration for the current
   * TTS response, in milliseconds.
   */
  getPlayedDurationMs(): number {
    if (this.workletState === 'ready' || this.workletState === 'loading') {
      const sampleRate =
        this.workletSampleRate > 0 ? this.workletSampleRate : (this.audioContext?.sampleRate ?? 0);
      if (Number.isFinite(sampleRate) && sampleRate > 0) {
        return Math.round((this.workletPlayedSamples / sampleRate) * 1000);
      }
    }

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

  getRemainingPlaybackMs(): number {
    const ctx = this.audioContext;
    if (!ctx) {
      return 0;
    }
    if (this.workletState === 'ready' || this.workletState === 'loading') {
      const sampleRate =
        this.workletSampleRate > 0 ? this.workletSampleRate : (ctx.sampleRate || 0);
      if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
        return 0;
      }
      const remainingSamples = this.workletBufferedSamples + this.workletQueuedSamples;
      return Math.round((remainingSamples / sampleRate) * 1000);
    }

    const remainingSec = Math.max(0, this.playbackTime - ctx.currentTime);
    return Math.round(remainingSec * 1000);
  }

  private scheduleBufferSource(
    ctx: AudioContext,
    pcm: Float32Array,
    sampleRate: number,
  ): void {
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
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

  private enqueueWorkletSamples(samples: Float32Array): void {
    if (samples.length === 0) {
      return;
    }
    this.clearWorkletIdleTimer();
    this.workletIdleNotified = false;
    this.workletQueue.push(samples);
    this.workletQueuedSamples += samples.length;
    this.flushWorkletQueue();
  }

  private ensureWorklet(ctx: AudioContext): boolean {
    if (this.workletState === 'failed') {
      return false;
    }
    if (this.workletState === 'ready' || this.workletState === 'loading') {
      return true;
    }
    if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') {
      this.workletState = 'failed';
      return false;
    }

    this.workletState = 'loading';
    const moduleUrl = getTtsWorkletUrl();
    this.workletLoadPromise = ctx.audioWorklet
      .addModule(moduleUrl)
      .then(() => {
        if (this.audioContext !== ctx) {
          return;
        }
        const node = new AudioWorkletNode(ctx, TTS_WORKLET_PROCESSOR_NAME, {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = (event) => {
          this.handleWorkletMessage(event.data);
        };
        node.connect(this.gainNode ?? ctx.destination);
        this.workletNode = node;
        this.workletSampleRate = ctx.sampleRate;
        this.workletMaxBufferSamples = Math.max(
          1,
          Math.round(this.workletSampleRate * this.getWorkletBufferSec()),
        );
        const jitterBufferSamples = Math.round(this.jitterBufferSec * this.workletSampleRate);
        node.port.postMessage({
          type: 'config',
          maxBufferSamples: this.workletMaxBufferSamples,
          jitterBufferSamples,
        });
        this.workletState = 'ready';
        this.flushWorkletQueue();
      })
      .catch(() => {
        this.workletState = 'failed';
      })
      .finally(() => {
        this.workletLoadPromise = null;
      });

    return true;
  }

  private handleWorkletMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }
    const payload = message as {
      type?: unknown;
      bufferedSamples?: unknown;
      playedSamples?: unknown;
    };
    if (payload.type !== 'status') {
      return;
    }
    if (typeof payload.bufferedSamples === 'number') {
      this.workletBufferedSamples = payload.bufferedSamples;
    }
    if (typeof payload.playedSamples === 'number') {
      this.workletPlayedSamples = payload.playedSamples;
    }
    this.flushWorkletQueue();
  }

  private flushWorkletQueue(): void {
    if (this.workletState !== 'ready' || !this.workletNode) {
      return;
    }
    while (this.workletQueue.length > 0) {
      const next = this.workletQueue[0];
      if (!next) {
        this.workletQueue.shift();
        continue;
      }
      if (this.workletBufferedSamples + next.length > this.workletMaxBufferSamples) {
        break;
      }
      this.workletQueue.shift();
      this.workletQueuedSamples -= next.length;
      this.workletBufferedSamples += next.length;
      try {
        this.workletNode.port.postMessage({ type: 'chunk', samples: next }, [next.buffer]);
      } catch {
        this.workletState = 'failed';
        this.workletQueue = [];
        this.workletQueuedSamples = 0;
        break;
      }
    }
    this.maybeNotifyIdle();
  }

  private maybeNotifyIdle(): void {
    if (!this.enabled || !this.onIdle || this.workletState !== 'ready') {
      return;
    }
    const isIdle = this.workletBufferedSamples === 0 && this.workletQueuedSamples === 0;
    if (isIdle) {
      this.scheduleWorkletIdle();
      return;
    }
    this.workletIdleNotified = false;
    this.clearWorkletIdleTimer();
  }

  private resetWorklet(): void {
    this.workletQueue = [];
    this.workletQueuedSamples = 0;
    this.workletBufferedSamples = 0;
    this.workletPlayedSamples = 0;
    this.workletIdleNotified = false;
    this.clearWorkletIdleTimer();
    if (this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: 'reset' });
      } catch {
        // Ignore failed postMessage while tearing down.
      }
    }
  }

  private getWorkletBufferSec(): number {
    return Math.max(DEFAULT_WORKLET_BUFFER_SEC, this.jitterBufferSec * 4);
  }

  private scheduleWorkletIdle(): void {
    if (this.workletIdleNotified || this.workletIdleTimer !== null) {
      return;
    }
    this.workletIdleTimer = setTimeout(() => {
      this.workletIdleTimer = null;
      if (!this.enabled || !this.onIdle || this.workletState !== 'ready') {
        return;
      }
      const isIdle = this.workletBufferedSamples === 0 && this.workletQueuedSamples === 0;
      if (!isIdle || this.workletIdleNotified) {
        return;
      }
      this.workletIdleNotified = true;
      this.onIdle();
    }, WORKLET_IDLE_GRACE_MS);
  }

  private clearWorkletIdleTimer(): void {
    if (this.workletIdleTimer === null) {
      return;
    }
    clearTimeout(this.workletIdleTimer);
    this.workletIdleTimer = null;
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
    this.resetWorklet();
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
