import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvConfig } from '../envConfig';
import type { ToolContext, ToolHost } from '../tools';
import { VoiceService } from './service';

const tempDirs: string[] = [];

function makeEnv(partial: Partial<EnvConfig> = {}): EnvConfig {
  return {
    port: 3000,
    toolsEnabled: true,
    dataDir: partial.dataDir ?? path.join(os.tmpdir(), 'voice-test'),
    audioInputMode: 'manual',
    audioSampleRate: 24000,
    audioTranscriptionEnabled: false,
    audioOutputVoice: undefined,
    audioOutputSpeed: undefined,
    ttsModel: 'gpt-4o-mini-tts',
    ttsVoice: 'alloy',
    ttsFrameDurationMs: 250,
    ttsBackend: 'openai',
    elevenLabsApiKey: undefined,
    elevenLabsVoiceId: undefined,
    elevenLabsModelId: undefined,
    elevenLabsBaseUrl: undefined,
    maxMessagesPerMinute: 0,
    maxAudioBytesPerMinute: 0,
    maxToolCallsPerMinute: 0,
    debugChatCompletions: false,
    debugHttpRequests: false,
    ...partial,
  };
}

function makeToolHost(callTool = vi.fn(async () => ({ ok: true }))): ToolHost {
  return {
    listTools: async () => [],
    callTool,
  };
}

function makeToolContext(sessionId: string): ToolContext {
  return {
    sessionId,
    signal: new AbortController().signal,
    eventStore: {} as ToolContext['eventStore'],
    sessionHub: {} as ToolContext['sessionHub'],
    sessionIndex: {} as ToolContext['sessionIndex'],
    agentRegistry: {} as ToolContext['agentRegistry'],
    envConfig: makeEnv(),
    baseToolHost: makeToolHost(),
  };
}

describe('VoiceService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it('reports not-configured without OPENAI_API_KEY', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-svc-'));
    tempDirs.push(dataDir);
    const service = new VoiceService(
      {
        envConfig: makeEnv({ dataDir, apiKey: undefined }),
        toolHost: makeToolHost(),
        createToolContext: makeToolContext,
      },
      dataDir,
    );
    await service.init();
    expect(service.capabilities().agentRealtime.status).toBe('not-configured');
  });

  it('creates a conversation and session', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-svc-'));
    tempDirs.push(dataDir);
    const service = new VoiceService(
      {
        envConfig: makeEnv({ dataDir, apiKey: 'test-key' }),
        toolHost: makeToolHost(),
        createToolContext: makeToolContext,
      },
      dataDir,
    );
    await service.init();
    expect(service.capabilities().agentRealtime.status).toBe('ready');

    const created = await service.createSession({ listsInstanceId: 'default' });
    expect(created.conversationId).toBeTruthy();
    expect(created.session.state).toBe('created');

    const loaded = await service.getSession(created.session.id);
    expect(loaded?.conversationId).toBe(created.conversationId);
  });
});
