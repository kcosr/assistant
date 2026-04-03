import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatEvent, ServerMessage } from '@assistant/shared';

import { AgentRegistry } from './agents';
import type { EnvConfig } from './envConfig';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { EventStore } from './events';

type MockAgentListener = ((event: unknown) => Promise<void> | void) | undefined;

const mockPiAgentPrompt = vi.fn<
  (options: {
    agent: {
      model: { id: string; provider: string; api: string };
      tools: unknown[];
      listener: MockAgentListener;
    };
    prompt: unknown;
    emit: (event: unknown) => Promise<void>;
  }) => Promise<void>
>();

vi.mock('@mariozechner/pi-agent-core', async () => {
  const actual = await vi.importActual<typeof import('@mariozechner/pi-agent-core')>(
    '@mariozechner/pi-agent-core',
  );
  class MockAgent {
    model = { id: 'mock-model', provider: 'openai', api: 'openai-responses' };
    tools: unknown[] = [];
    messages: unknown[] = [];
    listener: MockAgentListener = undefined;
    setModel(model: { id: string; provider: string; api: string }) {
      this.model = model;
    }
    setSystemPrompt(_value: string) {}
    setThinkingLevel(_value: unknown) {}
    setTools(tools: unknown[]) {
      this.tools = tools;
    }
    replaceMessages(messages: unknown[]) {
      this.messages = [...messages];
    }
    subscribe(fn: (event: unknown) => Promise<void> | void) {
      this.listener = fn;
      return () => {
        if (this.listener === fn) {
          this.listener = undefined;
        }
      };
    }
    abort() {}
    async prompt(prompt: unknown) {
      this.messages.push(prompt);
      await mockPiAgentPrompt({
        agent: this,
        prompt,
        emit: async (event) => {
          await this.listener?.(event);
        },
      });
    }
  }
  return { ...actual, Agent: MockAgent };
});

vi.mock('./llm/piSdkProvider', async () => {
  const actual = await vi.importActual<typeof import('./llm/piSdkProvider')>('./llm/piSdkProvider');
  return {
    ...actual,
    runPiSdkChatCompletionIteration: vi.fn(),
    resolvePiSdkModel: vi.fn(),
    extractAssistantTextBlocksFromPiMessage: vi.fn(
      (message: { content?: Array<Record<string, unknown>> } | undefined) => {
        const content = Array.isArray(message?.content) ? message.content : [];
        return content
          .filter(
            (block): block is Record<string, unknown> =>
              Boolean(block) &&
              typeof block === 'object' &&
              block['type'] === 'text' &&
              typeof block['text'] === 'string',
          )
          .map((block) => {
            const textSignature =
              typeof block['textSignature'] === 'string' ? block['textSignature'] : undefined;
            let phase: 'commentary' | 'final_answer' | undefined;
            if (textSignature?.startsWith('{')) {
              try {
                const parsed = JSON.parse(textSignature) as { phase?: unknown };
                if (parsed.phase === 'commentary' || parsed.phase === 'final_answer') {
                  phase = parsed.phase;
                }
              } catch {
                // ignore malformed signatures in tests
              }
            }
            return {
              text: String(block['text']),
              ...(phase ? { phase } : {}),
              ...(textSignature ? { textSignature } : {}),
            };
          });
      },
    ),
  };
});

import { runPiSdkChatCompletionIteration, resolvePiSdkModel } from './llm/piSdkProvider';
import { processUserMessage } from './chatProcessor';

function createAssistantMessage(options: {
  text?: string;
  provider?: string;
  model?: string;
  api?: string;
  stopReason?: 'stop' | 'toolUse' | 'aborted' | 'error';
  content?: Array<Record<string, unknown>>;
}) {
  const {
    text = '',
    provider = 'openai',
    model = 'gpt-4o-mini',
    api = 'openai-responses',
    stopReason = 'stop',
    content,
  } = options;
  return {
    role: 'assistant' as const,
    content: content ?? [{ type: 'text', text }],
    api,
    provider,
    model,
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
    stopReason,
    timestamp: Date.now(),
  };
}

describe('processUserMessage stream event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPiAgentPrompt.mockImplementation(async ({ agent, emit }) => {
      try {
        const result = await vi.mocked(runPiSdkChatCompletionIteration)({
          model: agent.model as never,
          messages: (agent as { messages?: unknown[] }).messages ?? [],
          tools: agent.tools as never,
          abortSignal: new AbortController().signal,
          onDeltaText: async (delta: string, textSoFar: string, phase?: string) => {
            const partial = createAssistantMessage({
              text: textSoFar,
              provider: agent.model.provider,
              model: agent.model.id,
              api: agent.model.api,
              content: [
                {
                  type: 'text',
                  text: textSoFar,
                  ...(phase
                    ? {
                        textSignature: JSON.stringify({
                          v: 1,
                          id: `sig-${phase}`,
                          phase,
                        }),
                      }
                    : {}),
                },
              ],
            });
            await emit({
              type: 'message_update',
              message: partial,
              assistantMessageEvent: {
                type: 'text_delta',
                contentIndex: 0,
                delta,
                partial,
              },
            });
          },
          onThinkingStart: async () => {
            const partial = createAssistantMessage({
              provider: agent.model.provider,
              model: agent.model.id,
              api: agent.model.api,
              content: [{ type: 'thinking', thinking: '' }],
            });
            await emit({
              type: 'message_update',
              message: partial,
              assistantMessageEvent: {
                type: 'thinking_start',
                contentIndex: 0,
                partial,
              },
            });
          },
          onThinkingDelta: async (delta: string) => {
            const partial = createAssistantMessage({
              provider: agent.model.provider,
              model: agent.model.id,
              api: agent.model.api,
              content: [{ type: 'thinking', thinking: delta }],
            });
            await emit({
              type: 'message_update',
              message: partial,
              assistantMessageEvent: {
                type: 'thinking_delta',
                contentIndex: 0,
                delta,
                partial,
              },
            });
          },
          onThinkingDone: async (thinking: string) => {
            const partial = createAssistantMessage({
              provider: agent.model.provider,
              model: agent.model.id,
              api: agent.model.api,
              content: [{ type: 'thinking', thinking }],
            });
            await emit({
              type: 'message_update',
              message: partial,
              assistantMessageEvent: {
                type: 'thinking_end',
                contentIndex: 0,
                partial,
              },
            });
          },
        } as never);
        const assistantMessage = {
          ...result.assistantMessage,
          ...(result.abortReason === 'timeout' ? { errorMessage: 'timeout' } : {}),
          content:
            result.toolCalls?.length &&
            !result.assistantMessage.content.some((block) => block.type === 'toolCall')
              ? [
                  ...result.assistantMessage.content,
                  ...result.toolCalls.map((call) => ({
                    type: 'toolCall',
                    id: call.id,
                    name: call.name,
                    arguments: {},
                  })),
                ]
              : result.assistantMessage.content,
        };
        await emit({ type: 'message_end', message: assistantMessage });
        if (result.toolCalls?.length) {
          await emit({
            type: 'turn_end',
            message: assistantMessage,
            toolResults: result.toolCalls.map((call) => ({
              role: 'toolResult',
              toolCallId: call.id,
              toolName: call.name,
              content: [],
              isError: false,
              timestamp: Date.now(),
            })),
          });
        }
      } catch (error) {
        console.error('mockPiAgentPrompt error', error);
        throw error;
      }
    });
  });

  it('emits assistant_chunk and assistant_done events for pi runs', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
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

  it('emits user_audio events for spoken submits while keeping user text in model state', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async () => {
      return {
        text: 'Heard you',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Heard you' }],
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

    const sessionHub: SessionHub = {
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

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
      text: '  spoken transcript  ',
      userInput: {
        type: 'audio',
        durationMs: 4200,
      },
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

    expect(events.some((event) => event.type === 'user_message')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'user_audio',
          payload: {
            transcription: 'spoken transcript',
            durationMs: 4200,
          },
        }),
      ]),
    );
    expect(broadcast).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'transcript_event',
          event: expect.objectContaining({
            sessionId: 's1',
            kind: 'user_message',
            chatEventType: 'user_audio',
            payload: {
              transcription: 'spoken transcript',
              durationMs: 4200,
            },
          }),
        }),
      ]),
    );
    expect(broadcast.some((message) => message.type === 'user_message')).toBe(false);
    expect(state.chatMessages[0]).toMatchObject({
      role: 'user',
      content: 'spoken transcript',
    });
  });

  it('throws when the pi tool iteration limit is reached', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
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

  it('emits commentary and final assistant_done events from Pi assistant text blocks', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai-responses' } as never,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async (options) => {
      await options.onDeltaText?.('Final answer', 'Final answer', 'final_answer');
      return {
        text: 'Final answer',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Internal note',
              textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
            },
            {
              type: 'text',
              text: 'Final answer',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
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

    const sessionHub: SessionHub = {
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

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

    const assistantDoneEvents = events.filter((event) => event.type === 'assistant_done') as Array<
      Extract<ChatEvent, { type: 'assistant_done' }>
    >;
    expect(
      assistantDoneEvents.map((event) => ({
        text: event.payload.text,
        phase: event.payload.phase,
      })),
    ).toEqual([
      { text: 'Internal note', phase: 'commentary' },
      { text: 'Final answer', phase: 'final_answer' },
    ]);
  });

  it('persists timeout failure events and closes the turn', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async () => {
      return {
        text: '',
        toolCalls: [],
        aborted: true,
        abortReason: 'timeout',
        assistantMessage: {
          role: 'assistant',
          content: [],
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
          stopReason: 'aborted',
          timestamp: Date.now(),
        },
      };
    });

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

    const sessionHub: SessionHub = {
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

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
        eventStore,
      }),
    ).rejects.toMatchObject({
      code: 'upstream_timeout',
      message: 'Chat backend request timed out',
    });

    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['error', 'interrupt', 'turn_end']),
    );
    expect(events.find((event) => event.type === 'error')).toMatchObject({
      payload: {
        code: 'upstream_timeout',
        message: 'Chat backend request timed out',
      },
    });
    expect(events.find((event) => event.type === 'interrupt')).toMatchObject({
      payload: { reason: 'timeout' },
    });
    expect(state.chatMessages).toMatchObject([
      {
        role: 'user',
        content: 'hi',
      },
    ]);
  });

  it('syncs the aborted Pi assistant message before closing an interrupted turn', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      providerId: 'openai',
      modelId: 'gpt-4o-mini',
    });

    const abortedMessageTimestamp = Date.now();
    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async (options) => {
      await options.onDeltaText?.('Partial answer', 'Partial answer');
      return {
        text: 'Partial answer',
        toolCalls: [],
        aborted: true,
        abortReason: 'aborted',
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Partial answer' }],
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
          stopReason: 'aborted',
          timestamp: abortedMessageTimestamp,
        },
      };
    });

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

    const sync = vi.fn(async () => undefined);
    const sessionHub: SessionHub = {
      getAgentRegistry: () =>
        new AgentRegistry([
          {
            agentId: 'pi',
            displayName: 'Pi',
            description: 'Pi',
            chat: { provider: 'pi', models: ['openai/gpt-4o-mini'] },
          },
        ]),
      getPiSessionWriter: () =>
        ({
          sync,
          appendTurnStart: vi.fn(async () => undefined),
          appendTurnEnd: vi.fn(async () => undefined),
        }) as never,
      updateSessionAttributes: vi.fn(async () => undefined),
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        agentId: 'pi',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
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
        eventStore,
      }),
    ).rejects.toMatchObject({
      code: 'upstream_error',
      message: 'Chat backend error',
    });

    expect(sync).toHaveBeenCalledTimes(1);
    const syncPayload = ((sync.mock.calls as unknown) as Array<[unknown]>)[0]?.[0];
    expect(syncPayload).toBeDefined();
    expect(syncPayload).toMatchObject({
      summary: state.summary,
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'Partial answer',
          historyTimestampMs: abortedMessageTimestamp,
          piSdkMessage: expect.objectContaining({
            stopReason: 'aborted',
            content: [{ type: 'text', text: 'Partial answer' }],
          }),
        },
      ],
    });
  });
});
