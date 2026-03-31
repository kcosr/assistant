import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvConfig } from './envConfig';
import type { SessionHub } from './sessionHub';
import type { SessionIndex, SessionSummary } from './sessionIndex';
import type { ToolHost } from './tools';

vi.mock('./chatProcessor', () => ({
  processUserMessage: vi.fn(),
  isSessionBusy: vi.fn(() => false),
}));

vi.mock('./toolExposure', () => ({
  resolveAgentToolExposureForHost: vi.fn(async () => ({
    chatTools: [],
    availableTools: undefined,
    availableSkills: undefined,
  })),
}));

import { processUserMessage } from './chatProcessor';
import { startSessionMessage } from './sessionMessages';

describe('startSessionMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aborts the underlying run when sync timeout expires', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(processUserMessage).mockImplementationOnce(async (options) => {
      capturedSignal = options.externalAbortSignal;
      return new Promise((_resolve, reject) => {
        options.externalAbortSignal?.addEventListener(
          'abort',
          () => reject(new Error('aborted after timeout')),
          { once: true },
        );
      });
    });

    const summary: SessionSummary = {
      sessionId: 'session-1',
      name: 'Session 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deleted: false,
      agentId: 'pi',
      attributes: {},
    };

    const state = {
      summary,
      chatMessages: [],
      messageQueue: [],
    };

    const sessionIndex: SessionIndex = {
      getSession: async (sessionId: string) => (sessionId === summary.sessionId ? summary : null),
    } as unknown as SessionIndex;

    const sessionHub: SessionHub = {
      ensureSessionState: async () => state as never,
      getAgentRegistry: () =>
        ({
          getAgent: () => undefined,
        }) as never,
    } as unknown as SessionHub;

    const result = await startSessionMessage({
      input: {
        sessionId: summary.sessionId,
        content: 'hello',
        mode: 'sync',
        timeoutSeconds: 0.01,
      },
      sessionIndex,
      sessionHub,
      toolHost: {} as ToolHost,
      envConfig: {
        apiKey: 'test-api-key',
        port: 0,
        toolsEnabled: false,
        dataDir: '/tmp/assistant-tests',
        audioInputMode: 'manual',
        audioSampleRate: 24000,
        audioTranscriptionEnabled: false,
        audioOutputVoice: undefined,
        audioOutputSpeed: undefined,
        ttsModel: 'gpt-4o-mini-tts',
        ttsVoice: undefined,
        ttsFrameDurationMs: 250,
        ttsBackend: 'openai',
        elevenLabsApiKey: undefined,
        elevenLabsVoiceId: undefined,
        elevenLabsModelId: undefined,
        elevenLabsBaseUrl: undefined,
        maxMessagesPerMinute: 60,
        maxAudioBytesPerMinute: 2_000_000,
        maxToolCallsPerMinute: 30,
        debugChatCompletions: false,
        debugHttpRequests: false,
      } as EnvConfig,
    });

    expect(result.response).toMatchObject({
      status: 'timeout',
      timeoutSeconds: 0.01,
    });
    expect(capturedSignal?.aborted).toBe(true);
    expect(capturedSignal?.reason).toBe('timeout');
  });
});
