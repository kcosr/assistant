import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChatEvent, ServerMessage } from '@assistant/shared';

import { AgentRegistry } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { LogicalSessionState, SessionHub } from '../sessionHub';

type MockAgentListener = ((event: unknown) => Promise<void> | void) | undefined;
type MockToolResult = {
  content: Array<{ type: string; text?: string }>;
  details: unknown;
};
type MockAgentTool = {
  name: string;
  execute?: (
    toolCallId: string,
    params: unknown,
    signal?: AbortSignal,
    onUpdate?: (partialResult: MockToolResult) => void,
  ) => Promise<MockToolResult>;
};

const mockPiAgentPrompt = vi.fn<
  (options: {
    agent: {
      model: { id: string; provider: string; api: string };
      tools: MockAgentTool[];
      messages: unknown[];
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
    tools: MockAgentTool[] = [];
    messages: unknown[] = [];
    listener: MockAgentListener = undefined;
    setModel(model: { id: string; provider: string; api: string }) {
      this.model = model;
    }
    setSystemPrompt(_value: string) {}
    setThinkingLevel(_value: unknown) {}
    setTools(tools: unknown[]) {
      this.tools = tools as MockAgentTool[];
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

vi.mock('../llm/piSdkProvider', async () => {
  const actual = await vi.importActual<typeof import('../llm/piSdkProvider')>('../llm/piSdkProvider');
  return {
    ...actual,
    resolvePiSdkModel: vi.fn(),
    runPiSdkChatCompletionIteration: vi.fn(),
  };
});

vi.mock('../llm/piAgentAuth', () => ({
  resolvePiAgentAuthApiKey: vi.fn(async () => undefined),
}));

import { handleTextInputWithChatCompletions } from './chatRunLifecycle';
import { resolvePiSdkModel, runPiSdkChatCompletionIteration } from '../llm/piSdkProvider';

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

function createEnvConfig(): EnvConfig {
  return {
    port: 0,
    apiKey: 'test-api-key',
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
  };
}

function encodePiCwd(cwd: string): string {
  const stripped = cwd.replace(/^[/\\]/, '');
  return `--${stripped.replace(/[\\/:]/g, '-')}--`;
}

describe('handleTextInputWithChatCompletions (pi)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPiAgentPrompt.mockImplementation(async ({ agent, emit }) => {
      const messages = agent.messages;
      while (true) {
        let sawTextDelta = false;
        const result = await vi.mocked(runPiSdkChatCompletionIteration)({
          model: agent.model as never,
          messages,
          tools: agent.tools as never,
          abortSignal: new AbortController().signal,
          onDeltaText: async (delta: string, textSoFar: string, phase?: string) => {
            sawTextDelta = true;
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
                    arguments:
                      call.argumentsJson.trim().length > 0
                        ? JSON.parse(call.argumentsJson)
                        : {},
                  })),
              ]
            : result.assistantMessage.content,
        };
        if (!sawTextDelta) {
          let textSoFar = '';
          for (const [index, block] of assistantMessage.content.entries()) {
            if (
              block.type !== 'text' ||
              !('text' in block) ||
              typeof block.text !== 'string' ||
              !block.text.length
            ) {
              continue;
            }
            textSoFar += block.text;
            await emit({
              type: 'message_update',
              message: assistantMessage,
              assistantMessageEvent: {
                type: 'text_delta',
                contentIndex: index,
                delta: block.text,
                partial: assistantMessage,
              },
            });
          }
        }
        messages.push(assistantMessage);
        await emit({ type: 'message_end', message: assistantMessage });

        const toolCalls = result.toolCalls ?? [];
        if (toolCalls.length === 0) {
          if (result.assistantMessage.stopReason === 'toolUse') {
            await emit({
              type: 'turn_end',
              message: assistantMessage,
              toolResults: [],
            });
          }
          return;
        }

        const toolResults = [];
        for (const call of toolCalls) {
          const args = call.argumentsJson.trim().length > 0 ? JSON.parse(call.argumentsJson) : {};
          await emit({
            type: 'tool_execution_start',
            toolCallId: call.id,
            toolName: call.name,
            args,
          });
          const tool = agent.tools.find((candidate) => candidate.name === call.name);
          const resultPayload = tool?.execute
            ? await tool.execute(call.id, args, undefined, async (partialResult) => {
                await emit({
                  type: 'tool_execution_update',
                  toolCallId: call.id,
                  toolName: call.name,
                  args,
                  partialResult,
                });
              })
            : { content: [], details: undefined };
          const toolResultMessage = {
            role: 'toolResult' as const,
            toolCallId: call.id,
            toolName: call.name,
            content: resultPayload.content,
            details: resultPayload.details,
            isError: false,
            timestamp: Date.now(),
          };
          messages.push(toolResultMessage);
          await emit({
            type: 'tool_execution_end',
            toolCallId: call.id,
            toolName: call.name,
            args,
            result: resultPayload,
            isError: false,
          });
          await emit({ type: 'message_end', message: toolResultMessage });
          toolResults.push(toolResultMessage);
        }

        await emit({
          type: 'turn_end',
          message: assistantMessage,
          toolResults,
        });
      }
    });
  });

  it('uses the canonical Pi transcript for replay and records only the final answer text', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-replay-'));
    const baseDir = path.join(os.homedir(), '.pi', 'agent', 'sessions', encodePiCwd(cwd));
    await fs.mkdir(baseDir, { recursive: true });
    const piSessionId = 'pi-session-1';
    const sessionPath = path.join(baseDir, `2026-03-26T00-00-00-000Z_${piSessionId}.jsonl`);
    const rawPiSession = [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: piSessionId,
        timestamp: '2026-03-26T00:00:00.000Z',
        cwd,
      }),
      JSON.stringify({
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-03-26T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Earlier request' }],
          timestamp: 1,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'a1',
        parentId: 'u1',
        timestamp: '2026-03-26T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Working on it',
              textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
            },
            {
              type: 'text',
              text: 'Stored final answer',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: 2,
        },
      }),
    ].join('\n');
    await fs.writeFile(sessionPath, rawPiSession, 'utf8');

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const broadcast: ServerMessage[] = [];
    const recordSessionActivity = vi.fn(async () => undefined);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {
          providers: {
            pi: {
              sessionId: piSessionId,
              cwd,
            },
          },
        },
      },
      chatMessages: [
        { role: 'system', content: 'System prompt' },
        { role: 'assistant', content: 'polluted to=lists_items_list ...' },
      ],
    } as unknown as LogicalSessionState;

    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    let replayMessagesAtCall:
      | Array<{
          role: string;
          content?: string;
          piSdkMessage?: unknown;
        }>
      | undefined;

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async (options) => {
      replayMessagesAtCall = options.messages.map((message) => structuredClone(message));
      return {
        text: 'Working on itStored final answer',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Working on it',
              textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
            },
            {
              type: 'text',
              text: 'Stored final answer',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as never,
      };
    });

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    expect(runPiSdkChatCompletionIteration).toHaveBeenCalledTimes(1);
    expect(replayMessagesAtCall).toMatchObject([
      { role: 'user', content: 'Earlier request' },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Working on it',
          },
          {
            type: 'text',
            text: 'Stored final answer',
          },
        ],
        provider: 'openai-codex',
      },
      { role: 'user', content: 'Current request' },
    ]);
    expect(
      replayMessagesAtCall?.some(
        (message) =>
          message.role === 'assistant' &&
          typeof message.content === 'string' &&
          message.content.includes('polluted'),
      ),
    ).toBe(false);

    const textDone = broadcast.find((message) => message.type === 'text_done') as
      | { text?: string; requestId?: string }
      | undefined;
    expect(textDone?.text).toBe('Stored final answer');
    expect(typeof textDone?.requestId).toBe('string');
    expect(recordSessionActivity).toHaveBeenCalledWith('s1', 'Stored final answer');
    expect(state.chatMessages).toMatchObject([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Earlier request' },
      { role: 'assistant', content: 'Stored final answer' },
      { role: 'user', content: 'Current request' },
      { role: 'assistant', content: 'Stored final answer' },
    ]);
    expect(
      state.chatMessages.some(
        (message) =>
          message.role === 'assistant' && message.content === 'polluted to=lists_items_list ...',
      ),
    ).toBe(false);
    expect(state.chatMessages[state.chatMessages.length - 1]).toMatchObject({
      role: 'assistant',
      content: 'Stored final answer',
    });
  });

  it('broadcasts live transcript events for Pi assistant output without an EventStore', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async () => ({
      text: 'hello there',
      toolCalls: [],
      aborted: false,
      assistantMessage: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'hello there',
            textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
          },
        ],
        api: 'openai-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      } as never,
    }));

    const broadcast: ServerMessage[] = [];
    const sessionHub: SessionHub = {
      getAgentRegistry: () =>
        new AgentRegistry([
          {
            agentId: 'pi',
            displayName: 'Pi',
            description: 'Pi',
            chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
          },
        ]),
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: async () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'hello', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    const transcriptEvents = broadcast.filter(
      (message): message is Extract<ServerMessage, { type: 'transcript_event' }> =>
        message.type === 'transcript_event',
    );

    expect(transcriptEvents.some((message) => message.event.kind === 'request_start')).toBe(true);
    expect(
      transcriptEvents.some(
        (message) =>
          message.event.kind === 'user_message' &&
          (message.event.payload as { text?: string }).text === 'hello',
      ),
    ).toBe(true);
    expect(
      transcriptEvents.some(
        (message) =>
          message.event.kind === 'assistant_message' &&
          message.event.chatEventType === 'assistant_done' &&
          (message.event.payload as { text?: string }).text === 'hello there',
      ),
    ).toBe(true);
    expect(transcriptEvents.some((message) => message.event.kind === 'request_end')).toBe(true);
  });

  it('does not dedupe a new Pi user turn solely because the text matches the last replayed user message', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-replay-repeat-'));
    const baseDir = path.join(os.homedir(), '.pi', 'agent', 'sessions', encodePiCwd(cwd));
    await fs.mkdir(baseDir, { recursive: true });
    const piSessionId = 'pi-session-repeat';
    const sessionPath = path.join(baseDir, `2026-03-26T00-00-00-000Z_${piSessionId}.jsonl`);
    const rawPiSession = [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: piSessionId,
        timestamp: '2026-03-26T00:00:00.000Z',
        cwd,
      }),
      JSON.stringify({
        type: 'message',
        id: 'u1',
        parentId: null,
        timestamp: '2026-03-26T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'repeat request' }],
          timestamp: 1,
        },
      }),
    ].join('\n');
    await fs.writeFile(sessionPath, rawPiSession, 'utf8');

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: vi.fn(async () => undefined),
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {
          providers: {
            pi: {
              sessionId: piSessionId,
              cwd,
            },
          },
        },
      },
      chatMessages: [{ role: 'system', content: 'System prompt' }],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    let replayMessagesAtCall:
      | Array<{
          role: string;
          content?: string;
          historyTimestampMs?: number;
        }>
      | undefined;

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async (options) => {
      replayMessagesAtCall = options.messages.map((message) => structuredClone(message));
      return {
        text: 'ack',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: 'ack' }],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as never,
      };
    });

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'repeat request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    expect(replayMessagesAtCall).toMatchObject([
      { role: 'user', content: 'repeat request' },
      { role: 'user', content: 'repeat request' },
    ]);
  });

  it('does not duplicate the final assistant in Pi sync when replay messages alias state', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const syncedMessages: Array<{
      role: string;
      content?: string;
      piSdkMessage?: unknown;
    }> = [];

    const piSessionWriter = {
      sync: vi.fn(async (options: { messages: Array<{ role: string; content?: string; piSdkMessage?: unknown }> }) => {
        syncedMessages.push(...options.messages);
        return undefined;
      }),
    };

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: vi.fn(async () => undefined),
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => piSessionWriter as never,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;

    let capturedFirstIterationMessages: Array<{ role: string; content?: string | undefined }> | undefined;

    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    vi.mocked(runPiSdkChatCompletionIteration)
      .mockImplementationOnce(async (options) => {
        capturedFirstIterationMessages = options.messages.map((message) => ({
          role: message.role,
          content: typeof message.content === 'string' ? message.content : undefined,
        }));
        return {
          text: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'bash',
              argumentsJson: '{"command":"pwd"}',
            },
          ],
          aborted: false,
          assistantMessage: {
            role: 'assistant',
            content: [
              { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'pwd' } },
            ],
            api: 'openai-responses',
            provider: 'openai-codex',
            model: 'gpt-5.4',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'toolUse',
            timestamp: Date.now(),
          } as never,
        };
      })
      .mockImplementationOnce(async () => ({
        text: 'done',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'done',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as never,
      }));

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      agentTools: [
        {
          name: 'bash',
          label: 'bash',
          description: 'bash',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execute: async () => ({
            content: [{ type: 'text', text: '{"ok":true}' }],
            details: { ok: true },
          }),
        },
      ],
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    expect(capturedFirstIterationMessages).toEqual([{ role: 'user', content: 'Current request' }]);
    expect(piSessionWriter.sync).toHaveBeenCalledTimes(1);
    const assistantMessages = syncedMessages.filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]).toMatchObject({ content: '' });
    expect(assistantMessages[1]).toMatchObject({ content: 'done' });
  });

  it('surfaces PI timeouts as backend errors and closes the turn durably', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async () => ({
      text: '',
      toolCalls: [],
      aborted: true,
      abortReason: 'timeout',
      assistantMessage: {
        role: 'assistant',
        content: [],
        api: 'openai-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'aborted',
        timestamp: Date.now(),
      } as never,
    }));

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

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: vi.fn(async () => undefined),
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    const sendError = vi.fn();

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
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

    expect(sendError).toHaveBeenCalledWith(
      'upstream_timeout',
      'Chat backend request timed out',
      undefined,
      { retryable: true },
    );
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['error', 'interrupt', 'turn_end']),
    );
    expect(events.find((event) => event.type === 'interrupt')).toMatchObject({
      payload: { reason: 'timeout' },
    });
    expect(state.chatMessages).toMatchObject([
      {
        role: 'user',
        content: 'Current request',
      },
    ]);
  });

  it('surfaces Pi subscription callback failures through sendError', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    vi.mocked(runPiSdkChatCompletionIteration).mockResolvedValueOnce({
      text: 'This chunk will fail to broadcast',
      toolCalls: [],
      aborted: false,
      assistantMessage: createAssistantMessage({
        text: 'This chunk will fail to broadcast',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        api: 'openai-responses',
      }) as never,
    });

    const eventStore = createTestEventStore();
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        if (message.type === 'text_delta') {
          throw new Error('broadcast failed');
        }
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: vi.fn(async () => undefined),
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    const sendError = vi.fn();

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
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

    expect(sendError).toHaveBeenCalledWith(
      'upstream_error',
      'Chat backend error',
      expect.objectContaining({
        error: expect.stringContaining('broadcast failed'),
      }),
      { retryable: true },
    );
  });

  it('emits incremental tool output deltas for cumulative Pi partial tool updates', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    vi.mocked(runPiSdkChatCompletionIteration)
      .mockImplementationOnce(async () => ({
        text: '',
        toolCalls: [
          {
            id: 'call-1',
            name: 'bash',
            argumentsJson: '{"command":"printf hi"}',
          },
        ],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'printf hi' } }],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: Date.now(),
        } as never,
      }))
      .mockImplementationOnce(async () => ({
        text: 'done',
        toolCalls: [],
        aborted: false,
        assistantMessage: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'done',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        } as never,
      }));

    const broadcast: ServerMessage[] = [];
    const sessionHub: SessionHub = {
      getAgentRegistry: () =>
        new AgentRegistry([
          {
            agentId: 'pi',
            displayName: 'Pi',
            description: 'Pi',
            chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
          },
        ]),
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: async () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Run the tool', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      agentTools: [
        {
          name: 'bash',
          label: 'bash',
          description: 'bash',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
          execute: async (_toolCallId, _params, _signal, onUpdate) => {
            await onUpdate?.({
              content: [{ type: 'text', text: 'alpha' }],
              details: { stream: 'stdout' },
            });
            await onUpdate?.({
              content: [{ type: 'text', text: 'alpha beta' }],
              details: { stream: 'stdout' },
            });
            return {
              content: [{ type: 'text', text: 'alpha beta' }],
              details: { ok: true },
            };
          },
        },
      ],
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    const toolOutputEvents = broadcast.filter(
      (message): message is Extract<ServerMessage, { type: 'transcript_event' }> =>
        message.type === 'transcript_event' && message.event.kind === 'tool_output',
    );

    expect(toolOutputEvents).toHaveLength(2);
    expect(toolOutputEvents[0]?.event.payload).toMatchObject({
      toolCallId: 'call-1',
      chunk: 'alpha',
      offset: 5,
      stream: 'stdout',
    });
    expect(toolOutputEvents[1]?.event.payload).toMatchObject({
      toolCallId: 'call-1',
      chunk: ' beta',
      offset: 10,
      stream: 'stdout',
    });
  });

  it('emits tool input chunk offsets as end positions', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    mockPiAgentPrompt.mockImplementationOnce(async ({ emit }) => {
      const partialToolCall = {
        role: 'assistant' as const,
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'printf hi' },
          },
        ],
        api: 'openai-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        stopReason: 'toolUse' as const,
        timestamp: Date.now(),
      };

      await emit({
        type: 'message_update',
        message: partialToolCall,
        assistantMessageEvent: {
          type: 'toolcall_start',
          contentIndex: 0,
          partial: partialToolCall,
        },
      });
      await emit({
        type: 'message_update',
        message: partialToolCall,
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '{"command":',
          partial: partialToolCall,
        },
      });
      await emit({
        type: 'message_update',
        message: partialToolCall,
        assistantMessageEvent: {
          type: 'toolcall_delta',
          contentIndex: 0,
          delta: '"printf hi"}',
          partial: partialToolCall,
        },
      });

      const assistantMessage = {
        ...partialToolCall,
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'bash',
            arguments: { command: 'printf hi' },
          },
        ],
      };
      await emit({ type: 'message_end', message: assistantMessage });
      await emit({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'printf hi' },
      });
      await emit({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'bash',
        args: { command: 'printf hi' },
        result: { content: [{ type: 'text', text: 'hi' }], details: { ok: true } },
        isError: false,
      });
      await emit({
        type: 'message_end',
        message: {
          role: 'toolResult' as const,
          toolCallId: 'call-1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'hi' }],
          details: { ok: true },
          isError: false,
          timestamp: Date.now(),
        },
      });
      await emit({
        type: 'turn_end',
        message: assistantMessage,
        toolResults: [],
      });
    });

    const broadcast: ServerMessage[] = [];
    const sessionHub: SessionHub = {
      getAgentRegistry: () =>
        new AgentRegistry([
          {
            agentId: 'pi',
            displayName: 'Pi',
            description: 'Pi',
            chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
          },
        ]),
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: async () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Run the tool', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      agentTools: [],
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    const toolInputEvents = broadcast.filter(
      (message): message is Extract<ServerMessage, { type: 'transcript_event' }> =>
        message.type === 'transcript_event' && message.event.kind === 'tool_input',
    );

    expect(toolInputEvents).toHaveLength(2);
    expect(toolInputEvents[0]?.event.payload).toMatchObject({
      toolCallId: 'call-1',
      chunk: '{"command":',
      offset: 11,
    });
    expect(toolInputEvents[1]?.event.payload).toMatchObject({
      toolCallId: 'call-1',
      chunk: '"printf hi"}',
      offset: 23,
    });
  });

  it('emits multiple thinking blocks within one Pi run when reasoning resumes after tools', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    mockPiAgentPrompt.mockImplementationOnce(async ({ emit }) => {
      const toolUseMessage = createAssistantMessage({
        provider: 'openai-codex',
        model: 'gpt-5.4',
        api: 'openai-responses',
        stopReason: 'toolUse',
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'read',
            arguments: { path: 'README.md' },
          },
        ],
      });

      const thinkingOne = 'First reasoning block.';
      const thinkingTwo = 'Second reasoning block.';

      await emit({
        type: 'message_update',
        message: createAssistantMessage({
          provider: 'openai-codex',
          model: 'gpt-5.4',
          api: 'openai-responses',
          content: [{ type: 'thinking', thinking: '' }],
        }),
        assistantMessageEvent: {
          type: 'thinking_start',
          contentIndex: 0,
          partial: createAssistantMessage({
            provider: 'openai-codex',
            model: 'gpt-5.4',
            api: 'openai-responses',
            content: [{ type: 'thinking', thinking: '' }],
          }),
        },
      });
      await emit({
        type: 'message_update',
        message: createAssistantMessage({
          provider: 'openai-codex',
          model: 'gpt-5.4',
          api: 'openai-responses',
          content: [{ type: 'thinking', thinking: thinkingOne }],
        }),
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: thinkingOne,
          partial: createAssistantMessage({
            provider: 'openai-codex',
            model: 'gpt-5.4',
            api: 'openai-responses',
            content: [{ type: 'thinking', thinking: thinkingOne }],
          }),
        },
      });
      await emit({
        type: 'message_update',
        message: createAssistantMessage({
          provider: 'openai-codex',
          model: 'gpt-5.4',
          api: 'openai-responses',
          content: [{ type: 'thinking', thinking: thinkingOne }],
        }),
        assistantMessageEvent: {
          type: 'thinking_end',
          contentIndex: 0,
          partial: createAssistantMessage({
            provider: 'openai-codex',
            model: 'gpt-5.4',
            api: 'openai-responses',
            content: [{ type: 'thinking', thinking: thinkingOne }],
          }),
        },
      });

      await emit({ type: 'message_end', message: toolUseMessage });
      await emit({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'read',
        args: { path: 'README.md' },
      });
      await emit({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'read',
        args: { path: 'README.md' },
        result: { content: [{ type: 'text', text: 'done' }], details: { ok: true } },
        isError: false,
      });
      await emit({
        type: 'message_end',
        message: {
          role: 'toolResult' as const,
          toolCallId: 'call-1',
          toolName: 'read',
          content: [{ type: 'text', text: 'done' }],
          details: { ok: true },
          isError: false,
          timestamp: Date.now(),
        },
      });

      await emit({
        type: 'message_update',
        message: createAssistantMessage({
          provider: 'openai-codex',
          model: 'gpt-5.4',
          api: 'openai-responses',
          content: [{ type: 'thinking', thinking: '' }],
        }),
        assistantMessageEvent: {
          type: 'thinking_start',
          contentIndex: 0,
          partial: createAssistantMessage({
            provider: 'openai-codex',
            model: 'gpt-5.4',
            api: 'openai-responses',
            content: [{ type: 'thinking', thinking: '' }],
          }),
        },
      });
      await emit({
        type: 'message_update',
        message: createAssistantMessage({
          provider: 'openai-codex',
          model: 'gpt-5.4',
          api: 'openai-responses',
          content: [{ type: 'thinking', thinking: thinkingTwo }],
        }),
        assistantMessageEvent: {
          type: 'thinking_delta',
          contentIndex: 0,
          delta: thinkingTwo,
          partial: createAssistantMessage({
            provider: 'openai-codex',
            model: 'gpt-5.4',
            api: 'openai-responses',
            content: [{ type: 'thinking', thinking: thinkingTwo }],
          }),
        },
      });
      await emit({
        type: 'message_update',
        message: createAssistantMessage({
          provider: 'openai-codex',
          model: 'gpt-5.4',
          api: 'openai-responses',
          content: [{ type: 'thinking', thinking: thinkingTwo }],
        }),
        assistantMessageEvent: {
          type: 'thinking_end',
          contentIndex: 0,
          partial: createAssistantMessage({
            provider: 'openai-codex',
            model: 'gpt-5.4',
            api: 'openai-responses',
            content: [{ type: 'thinking', thinking: thinkingTwo }],
          }),
        },
      });

      const finalAssistantMessage = createAssistantMessage({
        text: 'Final answer.',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        api: 'openai-responses',
      });
      await emit({ type: 'message_end', message: finalAssistantMessage });
      await emit({
        type: 'turn_end',
        message: finalAssistantMessage,
        toolResults: [],
      });
    });

    const broadcast: ServerMessage[] = [];
    const sessionHub: SessionHub = {
      getAgentRegistry: () =>
        new AgentRegistry([
          {
            agentId: 'pi',
            displayName: 'Pi',
            description: 'Pi',
            chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
          },
        ]),
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: async () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => undefined,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's-thinking',
        title: 'Thinking Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Investigate', sessionId: 's-thinking' },
      state,
      sessionId: 's-thinking',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      agentTools: [],
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    const thinkingDoneEvents = broadcast.filter(
      (message): message is Extract<ServerMessage, { type: 'transcript_event' }> =>
        message.type === 'transcript_event' &&
        message.event.kind === 'thinking' &&
        message.event.chatEventType === 'thinking_done',
    );

    expect(thinkingDoneEvents).toHaveLength(2);
    expect(thinkingDoneEvents.map((message) => message.event.payload)).toEqual([
      { text: 'First reasoning block.' },
      { text: 'Second reasoning block.' },
    ]);
  });

  it('emits live Pi tool_call before tool_result even when tool persistence is delayed', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    mockPiAgentPrompt.mockImplementationOnce(async ({ emit }) => {
      const assistantMessage = {
        role: 'assistant' as const,
        content: [
          {
            type: 'toolCall',
            id: 'call-order',
            name: 'agents_message',
            arguments: {
              agentId: 'coding',
              content: 'Run ls',
              mode: 'async',
            },
          },
        ],
        api: 'openai-responses',
        provider: 'openai-codex',
        model: 'gpt-5.4',
        stopReason: 'toolUse' as const,
        timestamp: Date.now(),
      };

      await emit({ type: 'message_end', message: assistantMessage });
      await emit({
        type: 'tool_execution_start',
        toolCallId: 'call-order',
        toolName: 'agents_message',
        args: {
          agentId: 'coding',
          content: 'Run ls',
          mode: 'async',
        },
      });
      await emit({
        type: 'tool_execution_end',
        toolCallId: 'call-order',
        toolName: 'agents_message',
        args: {
          agentId: 'coding',
          content: 'Run ls',
          mode: 'async',
        },
        result: {
          content: [{ type: 'text', text: 'Waiting for response' }],
          details: {
            mode: 'async',
            status: 'started',
            messageId: 'msg-1',
            exchangeId: 'ex-1',
          },
        },
        isError: false,
      });
      await emit({
        type: 'message_end',
        message: {
          role: 'toolResult' as const,
          toolCallId: 'call-order',
          toolName: 'agents_message',
          content: [{ type: 'text', text: 'Waiting for response' }],
          details: {
            mode: 'async',
            status: 'started',
            messageId: 'msg-1',
            exchangeId: 'ex-1',
          },
          isError: false,
          timestamp: Date.now(),
        },
      });
      await emit({
        type: 'turn_end',
        message: assistantMessage,
        toolResults: [],
      });
    });

    const broadcast: ServerMessage[] = [];
    const summary = {
      sessionId: 's-order',
      title: 'Order Test',
      createdAt: '',
      updatedAt: '',
      deleted: false,
      agentId: 'pi',
      attributes: {},
    };
    const state: LogicalSessionState = {
      summary,
      chatMessages: [],
    } as unknown as LogicalSessionState;
    const writer = {
      appendAssistantEvent: vi.fn(async (options: { eventType: string }) => {
        if (options.eventType === 'tool_call') {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return summary;
      }),
    };
    const sessionHub: SessionHub = {
      getAgentRegistry: () =>
        new AgentRegistry([
          {
            agentId: 'pi',
            displayName: 'Pi',
            description: 'Pi',
            chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
          },
        ]),
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: async () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => writer as never,
      getSessionState: (sessionId: string) => (sessionId === 's-order' ? state : undefined),
    } as unknown as SessionHub;

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Run the agent tool', sessionId: 's-order' },
      state,
      sessionId: 's-order',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      agentTools: [],
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    const toolEventTypes = broadcast
      .filter(
        (message): message is Extract<ServerMessage, { type: 'transcript_event' }> =>
          message.type === 'transcript_event' &&
          (message.event.chatEventType === 'tool_call' || message.event.chatEventType === 'tool_result'),
      )
      .map((message) => message.event.chatEventType);

    expect(toolEventTypes).toEqual(['tool_call', 'tool_result']);
  });

  it('syncs the aborted Pi assistant message before closing an interrupted turn', async () => {
    vi.mocked(resolvePiSdkModel).mockResolvedValue({
      model: { id: 'gpt-5.4', provider: 'openai-codex', api: 'openai-responses' } as never,
      providerId: 'openai-codex',
      modelId: 'gpt-5.4',
    });

    const abortedMessageTimestamp = Date.now();
    vi.mocked(runPiSdkChatCompletionIteration).mockImplementationOnce(async (options) => {
      await options.onDeltaText?.('Interrupted answer', 'Interrupted answer');
      return {
        text: 'Interrupted answer',
        toolCalls: [],
        aborted: true,
        abortReason: 'aborted',
        assistantMessage: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Interrupted answer' }],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'aborted',
          timestamp: abortedMessageTimestamp,
        } as never,
      };
    });

    const sync = vi.fn(async () => undefined);
    const piSessionWriter = {
      appendTurnStart: vi.fn(async () => undefined),
      appendTurnEnd: vi.fn(async () => undefined),
      sync,
    };

    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi',
        chat: { provider: 'pi', models: ['openai-codex/gpt-5.4'] },
      },
    ]);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes: async () => undefined,
      recordSessionActivity: vi.fn(async () => undefined),
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
      getPiSessionWriter: () => piSessionWriter as never,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        title: 'Test',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        agentId: 'pi',
        attributes: {},
      },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    await handleTextInputWithChatCompletions({
      message: { type: 'text_input', text: 'Current request', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      config: createEnvConfig(),
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: () => undefined,
      log: () => undefined,
      eventStore: createTestEventStore(),
    });

    expect(sync).toHaveBeenCalledTimes(1);
    const syncPayload = ((sync.mock.calls as unknown) as Array<[unknown]>)[0]?.[0];
    expect(syncPayload).toBeDefined();
    expect(syncPayload).toMatchObject({
      summary: state.summary,
      messages: [
        { role: 'user', content: 'Current request' },
        {
          role: 'assistant',
          content: 'Interrupted answer',
          historyTimestampMs: abortedMessageTimestamp,
          piSdkMessage: expect.objectContaining({
            stopReason: 'aborted',
            content: [{ type: 'text', text: 'Interrupted answer' }],
          }),
        },
      ],
    });
    expect(piSessionWriter.appendTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: state.summary,
        status: 'interrupted',
      }),
    );
  });
});
