import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvConfig } from './envConfig';

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env['OPENAI_API_KEY'] = 'test-key';
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe('loadEnvConfig', () => {
  it('defaults TTS frame duration when not set', () => {
    delete process.env['TTS_FRAME_DURATION_MS'];
    const config = loadEnvConfig();
    expect(config.ttsFrameDurationMs).toBe(250);
  });

  it('uses TTS frame duration from env when set', () => {
    process.env['TTS_FRAME_DURATION_MS'] = '500';
    const config = loadEnvConfig();
    expect(config.ttsFrameDurationMs).toBe(500);
  });

  it('falls back to default on invalid TTS frame duration', () => {
    process.env['TTS_FRAME_DURATION_MS'] = '0';
    const config = loadEnvConfig();
    expect(config.ttsFrameDurationMs).toBe(250);
  });
});
