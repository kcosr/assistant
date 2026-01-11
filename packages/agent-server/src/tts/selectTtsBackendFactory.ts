import type OpenAI from 'openai';

import type { EnvConfig } from '../envConfig';

import { ElevenLabsTtsBackendFactory, OpenAiTtsBackendFactory } from './backends';
import type { TtsBackendFactory } from './types';

export function selectTtsBackendFactory(options: {
  config: EnvConfig;
  openaiClient: OpenAI | null;
  sendAudioFrame: (bytes: Uint8Array) => void;
  getNextSeq: () => number;
  log: (...args: unknown[]) => void;
  sendTtsError: (details: unknown) => void;
}): TtsBackendFactory | null {
  const { config, openaiClient } = options;

  const commonTtsOptions = {
    config,
    sendAudioFrame: options.sendAudioFrame,
    getNextSeq: options.getNextSeq,
    log: options.log,
    sendTtsError: options.sendTtsError,
  };

  if (config.ttsBackend === 'elevenlabs') {
    const elevenLabsFactory = new ElevenLabsTtsBackendFactory(commonTtsOptions);
    if (elevenLabsFactory.isEnabled()) {
      return elevenLabsFactory;
    }

    if (!openaiClient) {
      options.log(
        '[tts] ElevenLabs backend disabled and OpenAI client not available; TTS will be disabled.',
      );
      return null;
    }

    const openaiFactory = new OpenAiTtsBackendFactory({
      ...commonTtsOptions,
      openaiClient,
    });
    return openaiFactory.isEnabled() ? openaiFactory : null;
  }

  if (config.ttsBackend === 'openai') {
    if (!openaiClient) {
      options.log(
        '[tts] OpenAI TTS backend selected but OpenAI client is not available; TTS will be disabled.',
      );
      return null;
    }

    const openaiFactory = new OpenAiTtsBackendFactory({
      ...commonTtsOptions,
      openaiClient,
    });
    return openaiFactory.isEnabled() ? openaiFactory : null;
  }

  return null;
}
