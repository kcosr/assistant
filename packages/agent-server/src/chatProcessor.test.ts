import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatEvent, ServerMessage } from '@assistant/shared';

import type { EnvConfig } from './envConfig';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { EventStore } from './events';

vi.mock('./llm/piSdkProvider', () => {
  return {
    runPiSdkChatCompletionIteration: vi.fn(),
    resolvePiSdkModel: vi.fn(),
  };
});

import { runPiSdkChatCompletionIteration, resolvePiSdkModel } from './llm/piSdkProvider';
import { processUserMessage } from './chatProcessor';

describe('processUserMessage stream event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits assistant_chunk and assistant_done events for pi runs', async () => {
    vi.mocked(resolvePiSdkModel).mockReturnValue({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async (options) => {
      await options.onDeltaText?.('Hello', 'Hello');
      await options.onDeltaText?.(' world', 'Hello world');
      return {
        text: 'Hello world',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
          api: 'openai-responses',
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        },
      };
    });

    const broadcast: ServerMessage[] = [];

    const sessionHub: SessionHub = {
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

    const events: ChatEvent[] = [];
    const eventStore: EventStore = {
      append: async (_sessionId, event) => {
        events.push(event);
      },
      appendBatch: async (_sessionId, batch) => {
        events.push(...batch);
      },
      getEvents: async () => events,
      getEventsSince: async () => events,
      subscribe: () => () => {},
      clearSession: async () => {},
      deleteSession: async () => {},
    };

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: 'openai/gpt-4o-mini',
      },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    await processUserMessage({
      sessionId: 's1',
      state,
      text: 'hi',
      sessionHub,
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
      chatCompletionTools: [],
      handleChatToolCalls: async () => undefined,
      outputMode: 'text',
      ttsBackendFactory: null,
      eventStore,
    });

    const chunkTexts = events
      .filter((event) => event.type === 'assistant_chunk')
      .map((event) => event.payload?.text);
    expect(chunkTexts).toEqual(['Hello', ' world']);
    const doneEvent = events.find((event) => event.type === 'assistant_done');
    expect(doneEvent?.payload?.text).toBe('Hello world');

    expect(broadcast.some((message) => message.type === 'text_done')).toBe(true);
  });

  it('throws when the pi tool iteration limit is reached', async () => {
    vi.mocked(resolvePiSdkModel).mockReturnValue({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async () => {
      return {
        text: '',
        toolCalls: [{ id: 'call-1', name: 'ls', argumentsJson: '{}' }],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          api: 'openai-responses',
          provider: 'openai',
          model: 'gpt-4o-mini',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: 'toolUse',
          timestamp: Date.now(),
        },
      };
    });

    const agent = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi SDK agent.',
      chat: {
        provider: 'pi',
        models: ['openai/gpt-4o-mini'],
        config: {
          maxToolIterations: 1,
        },
      },
    };

    const sessionHub: SessionHub = {
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      processNextQueuedMessage: async () => false,
      getAgentRegistry: () =>
        ({
          getAgent: (agentId: string) => (agentId === 'pi' ? agent : undefined),
        }) as never,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        agentId: 'pi',
        model: 'openai/gpt-4o-mini',
      },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    await expect(
      processUserMessage({
        sessionId: 's1',
        state,
        text: 'hi',
        sessionHub,
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
        chatCompletionTools: [],
        handleChatToolCalls: async () => undefined,
        outputMode: 'text',
        ttsBackendFactory: null,
      }),
    ).rejects.toMatchObject({ code: 'tool_iteration_limit' });
  });
});
