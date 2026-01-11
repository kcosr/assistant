import { encodeAudioFrame } from '@assistant/shared';

import {
  createAudioFramesFromPcm,
  ElevenLabsStreamingClient,
  getPcmOutputFormat,
} from '../elevenLabsTts';
import type { EnvConfig } from '../envConfig';
import { sanitizeTtsText } from './sanitizeTtsText';
import type { TtsBackendFactory, TtsStreamingSession } from './types';

class ElevenLabsTtsStreamingSession implements TtsStreamingSession {
  private readonly sessionId: string;
  private readonly responseId: string;
  private readonly abortSignal: AbortSignal;
  private readonly config: EnvConfig;
  private readonly sendAudioFrame: (bytes: Uint8Array) => void;
  private readonly getNextSeq: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly sendTtsError: (details: unknown) => void;
  private readonly elevenLabsClient: ElevenLabsStreamingClient;

  private hasAnyOutput = false;
  private cancelled = false;
  private timestampMs = 0;
  private readonly frameDurationMs = 40;
  private readonly outputSampleRate: number;
  private totalTextChars = 0;

  constructor(options: {
    sessionId: string;
    responseId: string;
    abortSignal: AbortSignal;
    config: EnvConfig;
    sendAudioFrame: (bytes: Uint8Array) => void;
    getNextSeq: () => number;
    log: (...args: unknown[]) => void;
    sendTtsError: (details: unknown) => void;
  }) {
    this.sessionId = options.sessionId;
    this.responseId = options.responseId;
    this.abortSignal = options.abortSignal;
    this.config = options.config;
    this.sendAudioFrame = options.sendAudioFrame;
    this.getNextSeq = options.getNextSeq;
    this.log = options.log;
    this.sendTtsError = options.sendTtsError;

    const { outputFormat, outputSampleRate } = getPcmOutputFormat(this.config.audioSampleRate);
    this.outputSampleRate = outputSampleRate;

    const modelId = this.config.elevenLabsModelId ?? 'eleven_multilingual_v2';
    const baseUrl = this.config.elevenLabsBaseUrl ?? 'https://api.elevenlabs.io';

    this.elevenLabsClient = new ElevenLabsStreamingClient({
      apiKey: this.config.elevenLabsApiKey ?? '',
      voiceId: this.config.elevenLabsVoiceId ?? '',
      modelId,
      baseUrl,
      outputFormat,
      abortSignal: this.abortSignal,
      log: (...args: unknown[]) => this.log(...args),
      onAudioChunk: (pcmBytes: Uint8Array) => this.handleAudioChunk(pcmBytes),
      onError: (err: unknown) => this.handleStreamingError(err),
    });

    if (this.abortSignal.aborted) {
      void this.cancel();
    } else {
      this.abortSignal.addEventListener('abort', () => {
        void this.cancel();
      });
    }

    this.log('ElevenLabs TTS session created', {
      backend: 'elevenlabs',
      sessionId: this.sessionId,
      responseId: this.responseId,
      modelId,
      voiceId: this.config.elevenLabsVoiceId,
      sampleRate: this.outputSampleRate,
    });
  }

  async appendText(chunk: string): Promise<void> {
    if (this.cancelled) {
      return;
    }
    if (!chunk) {
      return;
    }

    const filteredChunk = sanitizeTtsText(chunk);
    if (!filteredChunk) {
      return;
    }

    this.totalTextChars += filteredChunk.length;
    this.log('ElevenLabs TTS appendText', {
      responseId: this.responseId,
      chunkChars: filteredChunk.length,
      totalChars: this.totalTextChars,
    });

    try {
      await this.elevenLabsClient.sendText(filteredChunk);
    } catch (err) {
      if (this.abortSignal.aborted || this.cancelled) {
        return;
      }
      this.handleStreamingError(err);
    }
  }

  async finish(): Promise<void> {
    if (this.cancelled) {
      return;
    }

    this.log('ElevenLabs TTS finish called', {
      responseId: this.responseId,
      totalChars: this.totalTextChars,
    });

    try {
      await this.elevenLabsClient.finish();
    } catch (err) {
      if (this.abortSignal.aborted || this.cancelled) {
        return;
      }
      this.handleStreamingError(err);
    }
  }

  hasOutput(): boolean {
    return this.hasAnyOutput;
  }

  async cancel(): Promise<void> {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this.log('ElevenLabs TTS cancel requested', {
      responseId: this.responseId,
    });
    await this.elevenLabsClient.cancel();
  }

  private handleAudioChunk(pcmBytes: Uint8Array): void {
    if (this.abortSignal.aborted || this.cancelled) {
      return;
    }

    const { frames, nextTimestampMs } = createAudioFramesFromPcm({
      pcmBytes,
      sampleRate: this.outputSampleRate,
      initialTimestampMs: this.timestampMs,
      frameDurationMs: this.frameDurationMs,
      getNextSeq: () => this.getNextSeq(),
    });

    if (frames.length === 0) {
      return;
    }

    for (const frame of frames) {
      const encoded = encodeAudioFrame(frame);
      this.sendAudioFrame(encoded);
    }

    this.timestampMs = nextTimestampMs;
    this.hasAnyOutput = true;
  }

  private handleStreamingError(err: unknown): void {
    if (this.abortSignal.aborted || this.cancelled) {
      return;
    }
    this.log('tts generation error (elevenlabs)', err);
    this.sendTtsError({ error: String(err) });
  }
}

export class ElevenLabsTtsBackendFactory implements TtsBackendFactory {
  private readonly config: EnvConfig;
  private readonly sendAudioFrame: (bytes: Uint8Array) => void;
  private readonly getNextSeq: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly sendTtsError: (details: unknown) => void;

  constructor(options: {
    config: EnvConfig;
    sendAudioFrame: (bytes: Uint8Array) => void;
    getNextSeq: () => number;
    log: (...args: unknown[]) => void;
    sendTtsError: (details: unknown) => void;
  }) {
    this.config = options.config;
    this.sendAudioFrame = options.sendAudioFrame;
    this.getNextSeq = options.getNextSeq;
    this.log = options.log;
    this.sendTtsError = options.sendTtsError;
  }

  isEnabled(): boolean {
    if (this.config.ttsBackend !== 'elevenlabs') {
      return false;
    }

    if (!this.config.elevenLabsApiKey || !this.config.elevenLabsVoiceId) {
      this.log('ElevenLabs TTS backend disabled due to missing configuration', {
        hasApiKey: Boolean(this.config.elevenLabsApiKey),
        hasVoiceId: Boolean(this.config.elevenLabsVoiceId),
      });
      return false;
    }

    return true;
  }

  createSession(options: {
    sessionId: string;
    responseId: string;
    abortSignal: AbortSignal;
  }): TtsStreamingSession | null {
    if (!this.isEnabled()) {
      return null;
    }

    return new ElevenLabsTtsStreamingSession({
      sessionId: options.sessionId,
      responseId: options.responseId,
      abortSignal: options.abortSignal,
      config: this.config,
      sendAudioFrame: this.sendAudioFrame,
      getNextSeq: this.getNextSeq,
      log: this.log,
      sendTtsError: this.sendTtsError,
    });
  }
}
