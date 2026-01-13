import type OpenAI from 'openai';
import {
  AUDIO_FLAG_TTS,
  AUDIO_FRAME_MAGIC,
  encodeAudioFrame,
  type AudioFrame,
} from '@assistant/shared';

import type { EnvConfig } from '../envConfig';
import { sanitizeTtsText } from './sanitizeTtsText';
import type { TtsBackendFactory, TtsStreamingSession } from './types';

class OpenAiTtsStreamingSession implements TtsStreamingSession {
  private readonly sessionId: string;
  private readonly responseId: string;
  private readonly abortSignal: AbortSignal;
  private readonly config: EnvConfig;
  private readonly openaiClient: OpenAI;
  private readonly sendAudioFrame: (bytes: Uint8Array) => void;
  private readonly getNextSeq: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly sendTtsError: (details: unknown) => void;

  private buffer = '';
  private hasAnyOutput = false;
  private cancelled = false;
  private totalTextChars = 0;

  constructor(options: {
    sessionId: string;
    responseId: string;
    abortSignal: AbortSignal;
    config: EnvConfig;
    openaiClient: OpenAI;
    sendAudioFrame: (bytes: Uint8Array) => void;
    getNextSeq: () => number;
    log: (...args: unknown[]) => void;
    sendTtsError: (details: unknown) => void;
  }) {
    this.sessionId = options.sessionId;
    this.responseId = options.responseId;
    this.abortSignal = options.abortSignal;
    this.config = options.config;
    this.openaiClient = options.openaiClient;
    this.sendAudioFrame = options.sendAudioFrame;
    this.getNextSeq = options.getNextSeq;
    this.log = options.log;
    this.sendTtsError = options.sendTtsError;

    this.log('OpenAI TTS session created', {
      backend: 'openai',
      sessionId: this.sessionId,
      responseId: this.responseId,
      model: this.config.ttsModel,
      voice: this.config.ttsVoice,
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
    this.buffer += filteredChunk;
    this.totalTextChars += filteredChunk.length;
    this.log('OpenAI TTS appendText', {
      responseId: this.responseId,
      chunkChars: filteredChunk.length,
      totalChars: this.totalTextChars,
    });
  }

  async finish(): Promise<void> {
    if (this.cancelled) {
      return;
    }

    const text = this.buffer.trim();
    if (!text) {
      return;
    }

    const startedAt = Date.now();
    this.log('OpenAI TTS finish: starting generation', {
      responseId: this.responseId,
      model: this.config.ttsModel,
      textChars: text.length,
    });

    try {
      const response = await this.openaiClient.audio.speech.create(
        {
          model: this.config.ttsModel,
          voice: this.config.ttsVoice ?? 'alloy',
          input: text,
          response_format: 'pcm',
          ...(this.config.audioOutputSpeed ? { speed: this.config.audioOutputSpeed } : {}),
        },
        { signal: this.abortSignal },
      );

      if (this.abortSignal.aborted || this.cancelled) {
        return;
      }

      const arrayBuffer = await response.arrayBuffer();

      if (this.abortSignal.aborted || this.cancelled) {
        return;
      }

      const pcmBytes = new Uint8Array(arrayBuffer);
      if (pcmBytes.byteLength === 0) {
        return;
      }

      const sampleRate = this.config.audioSampleRate;
      const channels = 1;
      const sampleFormat: AudioFrame['sampleFormat'] = 1;
      const frameDurationMs = this.config.ttsFrameDurationMs;
      const samplesPerFrame = Math.max(1, Math.round((sampleRate * frameDurationMs) / 1000));
      const bytesPerFrame = samplesPerFrame * 2;

      let offset = 0;
      let framesSent = 0;
      let timestampMs = 0;

      while (offset < pcmBytes.byteLength) {
        if (this.abortSignal.aborted || this.cancelled) {
          break;
        }

        const end = Math.min(offset + bytesPerFrame, pcmBytes.byteLength);
        const data = pcmBytes.subarray(offset, end);

        const frame: AudioFrame = {
          magic: AUDIO_FRAME_MAGIC,
          flags: AUDIO_FLAG_TTS,
          seq: this.getNextSeq(),
          timestampMs,
          sampleRate,
          channels,
          sampleFormat,
          data,
        };

        const encoded = encodeAudioFrame(frame);
        this.sendAudioFrame(encoded);
        framesSent += 1;
        offset = end;
        timestampMs += frameDurationMs;
      }

      if (this.abortSignal.aborted || this.cancelled) {
        this.hasAnyOutput = this.hasAnyOutput || framesSent > 0;
        return;
      }

      this.log('sent TTS audio for response', {
        responseId: this.responseId,
        framesSent,
        totalBytes: pcmBytes.byteLength,
        elapsedMs: Date.now() - startedAt,
      });

      this.hasAnyOutput = this.hasAnyOutput || framesSent > 0;
    } catch (err) {
      if (this.abortSignal.aborted || this.cancelled) {
        return;
      }
      this.log('tts generation error', err);
      this.sendTtsError({ error: String(err) });
    }
  }

  hasOutput(): boolean {
    return this.hasAnyOutput;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.log('OpenAI TTS cancel requested', {
      responseId: this.responseId,
    });
  }
}

export class OpenAiTtsBackendFactory implements TtsBackendFactory {
  private readonly config: EnvConfig;
  private readonly openaiClient: OpenAI;
  private readonly sendAudioFrame: (bytes: Uint8Array) => void;
  private readonly getNextSeq: () => number;
  private readonly log: (...args: unknown[]) => void;
  private readonly sendTtsError: (details: unknown) => void;

  constructor(options: {
    config: EnvConfig;
    openaiClient: OpenAI;
    sendAudioFrame: (bytes: Uint8Array) => void;
    getNextSeq: () => number;
    log: (...args: unknown[]) => void;
    sendTtsError: (details: unknown) => void;
  }) {
    this.config = options.config;
    this.openaiClient = options.openaiClient;
    this.sendAudioFrame = options.sendAudioFrame;
    this.getNextSeq = options.getNextSeq;
    this.log = options.log;
    this.sendTtsError = options.sendTtsError;
  }

  isEnabled(): boolean {
    return Boolean(this.config.ttsModel);
  }

  createSession(options: {
    sessionId: string;
    responseId: string;
    abortSignal: AbortSignal;
  }): TtsStreamingSession | null {
    if (!this.isEnabled()) {
      return null;
    }

    return new OpenAiTtsStreamingSession({
      sessionId: options.sessionId,
      responseId: options.responseId,
      abortSignal: options.abortSignal,
      config: this.config,
      openaiClient: this.openaiClient,
      sendAudioFrame: this.sendAudioFrame,
      getNextSeq: this.getNextSeq,
      log: this.log,
      sendTtsError: this.sendTtsError,
    });
  }
}
