import { WebSocket, type RawData } from 'ws';
import { AUDIO_FLAG_TTS, AUDIO_FRAME_MAGIC, type AudioFrame } from '@assistant/shared';

export interface ElevenLabsStreamingClientOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
  baseUrl: string;
  /**
   * ElevenLabs output format, for example "pcm_24000".
   */
  outputFormat: string;
  abortSignal: AbortSignal;
  log: (...args: unknown[]) => void;
  onAudioChunk: (pcmBytes: Uint8Array) => void;
  onError: (error: unknown) => void;
}

/**
 * Maps the desired sample rate to the closest ElevenLabs PCM output format.
 */
export function getPcmOutputFormat(desiredSampleRate: number): {
  outputFormat: string;
  outputSampleRate: number;
} {
  const supportedSampleRates = [8000, 16000, 22050, 24000, 44100, 48000];

  let outputSampleRate: number = 24000;

  if (Number.isFinite(desiredSampleRate) && desiredSampleRate > 0) {
    const exactMatch = supportedSampleRates.find((rate) => rate === desiredSampleRate);
    if (exactMatch !== undefined) {
      outputSampleRate = exactMatch;
    } else {
      // Choose the closest supported rate.
      let bestRate = supportedSampleRates[0] ?? outputSampleRate;
      let bestDelta = Math.abs(desiredSampleRate - bestRate);
      for (const rate of supportedSampleRates) {
        const delta = Math.abs(desiredSampleRate - rate);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestRate = rate;
        }
      }
      outputSampleRate = bestRate;
    }
  }

  return {
    outputFormat: `pcm_${outputSampleRate}`,
    outputSampleRate,
  };
}

export function createAudioFramesFromPcm(options: {
  pcmBytes: Uint8Array;
  sampleRate: number;
  initialTimestampMs: number;
  frameDurationMs: number;
  getNextSeq: () => number;
}): { frames: AudioFrame[]; nextTimestampMs: number } {
  const { pcmBytes, sampleRate, initialTimestampMs, frameDurationMs, getNextSeq } = options;

  if (pcmBytes.byteLength === 0) {
    return { frames: [], nextTimestampMs: initialTimestampMs };
  }

  const channels = 1;
  const sampleFormat: AudioFrame['sampleFormat'] = 1;

  const samplesPerFrame = Math.max(1, Math.round((sampleRate * frameDurationMs) / 1000));
  const bytesPerFrame = samplesPerFrame * 2;

  const frames: AudioFrame[] = [];

  let offset = 0;
  let timestampMs = initialTimestampMs;

  while (offset < pcmBytes.byteLength) {
    const end = Math.min(offset + bytesPerFrame, pcmBytes.byteLength);
    const data = pcmBytes.subarray(offset, end);

    const frame: AudioFrame = {
      magic: AUDIO_FRAME_MAGIC,
      flags: AUDIO_FLAG_TTS,
      seq: getNextSeq(),
      timestampMs,
      sampleRate,
      channels,
      sampleFormat,
      data,
    };

    frames.push(frame);

    offset = end;
    timestampMs += frameDurationMs;
  }

  return {
    frames,
    nextTimestampMs: timestampMs,
  };
}

export class ElevenLabsStreamingClient {
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly modelId: string;
  private readonly baseUrl: string;
  private readonly outputFormat: string;
  private readonly abortSignal: AbortSignal;
  private readonly log: (...args: unknown[]) => void;
  private readonly onAudioChunk: (pcmBytes: Uint8Array) => void;
  private readonly onError: (error: unknown) => void;

  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private closed = false;
  private initialConfigSent = false;

  constructor(options: ElevenLabsStreamingClientOptions) {
    this.apiKey = options.apiKey;
    this.voiceId = options.voiceId;
    this.modelId = options.modelId;
    this.baseUrl = options.baseUrl;
    this.outputFormat = options.outputFormat;
    this.abortSignal = options.abortSignal;
    this.log = options.log;
    this.onAudioChunk = options.onAudioChunk;
    this.onError = options.onError;

    if (this.abortSignal.aborted) {
      void this.cancel();
    } else {
      this.abortSignal.addEventListener('abort', () => {
        void this.cancel();
      });
    }
  }

  async sendText(text: string): Promise<void> {
    if (!text || this.closed) {
      return;
    }

    try {
      await this.ensureConnected();
    } catch {
      // ensureConnected has already reported the error.
      return;
    }

    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = {
      text,
      try_trigger_generation: true,
    };

    try {
      socket.send(JSON.stringify(payload));
    } catch (err) {
      this.handleError(err);
    }
  }

  async finish(): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      await this.ensureConnected();
    } catch {
      // Connection failed; nothing more to do here.
      return;
    }

    const socket = this.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        const payload = {
          text: '',
        };
        socket.send(JSON.stringify(payload));
      } catch (err) {
        this.handleError(err);
      }
    }

    if (this.closePromise) {
      await Promise.race([
        this.closePromise,
        new Promise<void>((resolve) => {
          if (this.abortSignal.aborted) {
            resolve();
            return;
          }
          const onAbort = (): void => {
            this.abortSignal.removeEventListener('abort', onAbort);
            resolve();
          };
          this.abortSignal.addEventListener('abort', onAbort);
        }),
      ]);
    }
  }

  async cancel(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      try {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000, 'cancelled');
        }
      } catch {
        // Ignore errors during close.
      }
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) {
      throw new Error('ElevenLabs streaming client already closed');
    }

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const url = this.buildWebSocketUrl();

      const socket = new WebSocket(url, {
        headers: {
          'xi-api-key': this.apiKey,
        },
      });

      this.socket = socket;

      const handleOpen = (): void => {
        socket.removeListener('error', handleError);
        this.attachEventHandlers(socket);
        this.log('ElevenLabs TTS WebSocket connection opened', { url });
        this.sendInitialConfig();
        resolve();
      };

      const handleError = (err: Error): void => {
        socket.removeListener('open', handleOpen);
        this.handleError(err);
        reject(err);
      };

      socket.once('open', handleOpen);
      socket.once('error', handleError);
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private buildWebSocketUrl(): string {
    let url: URL;
    try {
      url = new URL(this.baseUrl);
    } catch {
      url = new URL('https://api.elevenlabs.io');
    }

    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    } else if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    }

    const path = `v1/text-to-speech/${encodeURIComponent(this.voiceId)}/stream-input`;

    const wsUrl = new URL(path, url);
    wsUrl.searchParams.set('model_id', this.modelId);
    wsUrl.searchParams.set('output_format', this.outputFormat);

    return wsUrl.toString();
  }

  private attachEventHandlers(socket: WebSocket): void {
    if (this.closePromise) {
      return;
    }

    this.closePromise = new Promise<void>((resolve) => {
      socket.on('message', (data: RawData) => {
        this.handleMessage(data);
      });

      socket.on('error', (err: Error) => {
        this.handleError(err);
      });

      socket.on('close', (code: number, reason: Buffer) => {
        this.closed = true;
        this.log('ElevenLabs TTS WebSocket connection closed', {
          code,
          reason: reason.toString('utf8'),
        });
        resolve();
      });
    });
  }

  private sendInitialConfig(): void {
    if (this.initialConfigSent || !this.socket) {
      return;
    }

    if (this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = {
      text: ' ',
      try_trigger_generation: true,
      voice_settings: null as unknown,
      generation_config: {
        chunk_length_schedule: [50],
      },
    };

    try {
      this.socket.send(JSON.stringify(payload));
      this.initialConfigSent = true;
    } catch (err) {
      this.handleError(err);
    }
  }

  private handleMessage(data: RawData): void {
    if (this.closed) {
      return;
    }

    let parsed: unknown;
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    const payload = parsed as {
      audio?: unknown;
      audio_base64?: unknown;
      message_type?: unknown;
      error?: unknown;
    };

    const audioField = payload.audio ?? payload.audio_base64;
    if (typeof audioField === 'string' && audioField.length > 0) {
      try {
        const buffer = Buffer.from(audioField, 'base64');
        if (buffer.byteLength > 0) {
          this.onAudioChunk(new Uint8Array(buffer));
        }
      } catch (err) {
        this.handleError(err);
      }
      return;
    }

    const messageType = payload.message_type;
    if (messageType === 'error' || messageType === 'auth_error') {
      this.handleError(payload);
    }
  }

  private handleError(err: unknown): void {
    if (this.closed) {
      return;
    }

    this.onError(err);
  }
}
