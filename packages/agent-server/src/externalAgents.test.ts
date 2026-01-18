import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';

import { AgentRegistry } from './agents';
import { SessionHub } from './sessionHub';
import { SessionIndex } from './sessionIndex';
import { buildExternalCallbackUrl } from './externalAgents';
import { handleTextInputWithChatCompletions } from './ws/chatRunLifecycle';
import type { EventStore } from './events';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTestEventStore(): EventStore {
  return {
    append: async () => {},
    appendBatch: async () => {},
    getEvents: async () => [],
    getEventsSince: async () => [],
    subscribe: () => () => {},
    clearSession: async () => {},
    deleteSession: async () => {},
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('externalAgents helpers', () => {
  it('joins callbackBaseUrl with external callback path without double slashes', () => {
    expect(
      buildExternalCallbackUrl({ callbackBaseUrl: 'http://example.test', sessionId: 'EXTERNAL-1' }),
    ).toBe('http://example.test/external/sessions/EXTERNAL-1/messages');

    expect(
      buildExternalCallbackUrl({
        callbackBaseUrl: 'http://example.test/prefix',
        sessionId: 'EXTERNAL-1',
      }),
    ).toBe('http://example.test/prefix/external/sessions/EXTERNAL-1/messages');

    expect(
      buildExternalCallbackUrl({
        callbackBaseUrl: 'http://example.test/prefix/',
        sessionId: 'EXTERNAL-1',
      }),
    ).toBe('http://example.test/prefix/external/sessions/EXTERNAL-1/messages');
  });
});

describe('ws external forwarding', () => {
  it('forwards user text to external inputUrl with callbackUrl', async () => {
    const response = new Response('ok', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'external-a',
        displayName: 'External A',
        description: 'External agent',
        type: 'external',
        external: {
          inputUrl: 'http://external.test/input',
          callbackBaseUrl: 'http://agent-server.test/prefix',
        },
      },
    ]);

    const sessionIndex = new SessionIndex(createTempFile('external-forward-sessions'));
    const eventStore = createTestEventStore();
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, eventStore });

    const summary = await sessionIndex.createSession({
      sessionId: 'EXTERNAL-123',
      agentId: 'external-a',
    });
    const state = await sessionHub.ensureSessionState(summary.sessionId, summary);

    const sendError = vi.fn();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'hello', sessionId: summary.sessionId },
      state,
      sessionId: summary.sessionId,
      connection: {
        sendServerMessageFromHub: () => undefined,
        sendErrorFromHub: () => undefined,
      },
      sessionHub,
      openaiClient: {} as unknown as OpenAI,
      config: {
        port: 0,
        apiKey: 'test-api-key',
        chatModel: 'test-model',
        toolsEnabled: false,
        dataDir: os.tmpdir(),
        audioInputMode: 'manual',
        audioSampleRate: 24000,
        audioTranscriptionEnabled: false,
        audioOutputVoice: undefined,
        audioOutputSpeed: undefined,
        ttsModel: 'test-tts-model',
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
      },
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError,
      log: () => undefined,
      eventStore,
    });

    expect(sendError).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://external.test/input');
    expect(init.method).toBe('POST');

    const body = JSON.parse(String(init.body ?? '{}')) as {
      sessionId?: string;
      agentId?: string;
      callbackUrl?: string;
      message?: { type?: string; text?: string; createdAt?: string };
    };

    expect(body.sessionId).toBe('EXTERNAL-123');
    expect(body.agentId).toBe('external-a');
    expect(body.callbackUrl).toBe(
      'http://agent-server.test/prefix/external/sessions/EXTERNAL-123/messages',
    );
    expect(body.message?.type).toBe('user');
    expect(body.message?.text).toBe('hello');
    expect(typeof body.message?.createdAt).toBe('string');
  });

  it('sends a client error when external inputUrl returns non-2xx', async () => {
    const response = new Response('nope', { status: 502 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'external-a',
        displayName: 'External A',
        description: 'External agent',
        type: 'external',
        external: {
          inputUrl: 'http://external.test/input',
          callbackBaseUrl: 'http://agent-server.test',
        },
      },
    ]);

    const sessionIndex = new SessionIndex(createTempFile('external-forward-error-sessions'));
    const eventStore = createTestEventStore();
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, eventStore });

    const summary = await sessionIndex.createSession({
      sessionId: 'EXTERNAL-124',
      agentId: 'external-a',
    });
    const state = await sessionHub.ensureSessionState(summary.sessionId, summary);

    const sendError = vi.fn();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'hello', sessionId: summary.sessionId },
      state,
      sessionId: summary.sessionId,
      connection: {
        sendServerMessageFromHub: () => undefined,
        sendErrorFromHub: () => undefined,
      },
      sessionHub,
      openaiClient: {} as unknown as OpenAI,
      config: {
        port: 0,
        apiKey: 'test-api-key',
        chatModel: 'test-model',
        toolsEnabled: false,
        dataDir: os.tmpdir(),
        audioInputMode: 'manual',
        audioSampleRate: 24000,
        audioTranscriptionEnabled: false,
        audioOutputVoice: undefined,
        audioOutputSpeed: undefined,
        ttsModel: 'test-tts-model',
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
      },
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError,
      log: () => undefined,
      eventStore,
    });

    expect(sendError).toHaveBeenCalled();
    expect(sendError.mock.calls[0]?.[0]).toBe('external_agent_error');
  });
});
