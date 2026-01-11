import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';

import { loadConfig, type AssistantCliConfig } from './config';

const CWD = process.cwd();

function withTempConfigFile(filename: string, contents: string, fn: () => void): void {
  const filePath = path.join(CWD, filename);
  fs.writeFileSync(filePath, contents, 'utf8');
  try {
    fn();
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
  }
}

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('includes ASSISTANT_AGENT_ID from environment when URL is set', () => {
    process.env['ASSISTANT_URL'] = 'https://env.example';
    process.env['ASSISTANT_TOKEN'] = 'env-token';
    process.env['ASSISTANT_AGENT_ID'] = 'general';

    const config = loadConfig() as AssistantCliConfig;
    expect(config.baseUrl).toBe('https://env.example');
    expect(config.token).toBe('env-token');
    expect(config.agentId).toBe('general');
  });

  it('prefers environment variables over config file', () => {
    process.env['ASSISTANT_URL'] = 'https://env.example';
    process.env['ASSISTANT_TOKEN'] = 'env-token';

    withTempConfigFile(
      'assistant.config.json',
      JSON.stringify({
        baseUrl: 'https://file.example',
        token: 'file-token',
      }),
      () => {
        const config = loadConfig() as AssistantCliConfig;
        expect(config.baseUrl).toBe('https://env.example');
        expect(config.token).toBe('env-token');
      },
    );
  });

  it('loads JSON config when env is not set', () => {
    delete process.env['ASSISTANT_URL'];
    delete process.env['ASSISTANT_TOKEN'];

    withTempConfigFile(
      'assistant.config.json',
      JSON.stringify({
        baseUrl: 'https://file.example',
        token: 'file-token',
      }),
      () => {
        const config = loadConfig() as AssistantCliConfig;
        expect(config.baseUrl).toBe('https://file.example');
        expect(config.token).toBe('file-token');
      },
    );
  });

  it('includes ASSISTANT_AGENT_ID from environment when using config file', () => {
    delete process.env['ASSISTANT_URL'];
    delete process.env['ASSISTANT_TOKEN'];
    process.env['ASSISTANT_AGENT_ID'] = 'file-agent';

    withTempConfigFile(
      'assistant.config.json',
      JSON.stringify({
        baseUrl: 'https://file.example',
      }),
      () => {
        const config = loadConfig() as AssistantCliConfig;
        expect(config.baseUrl).toBe('https://file.example');
        expect(config.agentId).toBe('file-agent');
      },
    );
  });
});
