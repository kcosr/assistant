import { beforeEach, describe, expect, it, vi } from 'vitest';

import type OpenAI from 'openai';

import type { ServerMessage } from '@assistant/shared';

import { AgentRegistry } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { EventStore } from '../events';

vi.mock('./piCliChat', () => {
  return {
    runPiCliChat: vi.fn(),
  };
});

import { runPiCliChat } from './piCliChat';
import { handleTextInputWithChatCompletions } from './chatRunLifecycle';

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

describe('handleTextInputWithChatCompletions (pi-cli)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams Pi CLI deltas as text_delta and finishes with text_done', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi CLI',
        chat: { provider: 'pi-cli' },
      },
    ]);

    const broadcast: ServerMessage[] = [];
    const updateSessionAttributes = vi.fn(async () => undefined);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes,
      recordSessionActivity: () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: { sessionId: 's1', title: 't', createdAt: '', updatedAt: '', deleted: false },
      chatMessages: [],
    } as unknown as LogicalSessionState;
    (state.summary as unknown as { agentId?: string }).agentId = 'pi';

    const sendError = vi.fn();

    vi.mocked(runPiCliChat).mockImplementationOnce(async (options) => {
      await options.onThinkingStart?.();
      await options.onThinkingDelta?.('Thinking…', 'Thinking…');
      await options.onThinkingDone?.('Thinking…');
      await options.onTextDelta('Hello', 'Hello');
      await options.onTextDelta(' world', 'Hello world');
      return { text: 'Hello world', aborted: false };
    });

    const eventStore = createTestEventStore();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'hi', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      openaiClient: {} as OpenAI,
      config: { chatModel: 'gpt-4o-mini' } as EnvConfig,
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

    const textDelta = broadcast.filter((message) => message.type === 'text_delta');
    const textDone = broadcast.filter((message) => message.type === 'text_done');
    const thinkingStart = broadcast.filter((message) => message.type === 'thinking_start');
    const thinkingDelta = broadcast.filter((message) => message.type === 'thinking_delta');
    const thinkingDone = broadcast.filter((message) => message.type === 'thinking_done');

    expect(thinkingStart).toHaveLength(1);
    expect(thinkingDelta).toHaveLength(1);
    expect(thinkingDone).toHaveLength(1);
    expect(textDelta).toHaveLength(2);
    expect(textDone).toHaveLength(1);

    const responseId = (textDelta[0] as unknown as { responseId: string }).responseId;
    expect((textDelta[1] as unknown as { responseId: string }).responseId).toBe(responseId);
    expect((textDone[0] as unknown as { responseId: string }).responseId).toBe(responseId);
    expect((thinkingDone[0] as unknown as { responseId: string }).responseId).toBe(responseId);
    expect((textDone[0] as unknown as { text: string }).text).toBe('Hello world');
    expect(sendError).not.toHaveBeenCalled();
  });

  it('stores Pi session mapping when session info is reported', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi CLI',
        chat: { provider: 'pi-cli' },
      },
    ]);

    const updateSessionAttributes = vi.fn(async () => undefined);
    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes,
      recordSessionActivity: () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: { sessionId: 's1', title: 't', createdAt: '', updatedAt: '', deleted: false },
      chatMessages: [],
    } as unknown as LogicalSessionState;
    (state.summary as unknown as { agentId?: string }).agentId = 'pi';

    vi.mocked(runPiCliChat).mockImplementationOnce(async (options) => {
      await options.onSessionInfo?.({ sessionId: 'pi-session-123', cwd: '/home/kevin' });
      await options.onTextDelta('Hi', 'Hi');
      return { text: 'Hi', aborted: false };
    });

    const eventStore = createTestEventStore();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'hi', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      openaiClient: {} as OpenAI,
      config: { chatModel: 'gpt-4o-mini' } as EnvConfig,
      chatCompletionTools: [],
      outputMode: 'text',
      clientAudioCapabilities: undefined,
      ttsBackendFactory: null,
      handleChatToolCalls: async () => undefined,
      setActiveRunState: () => undefined,
      clearActiveRunState: () => undefined,
      sendError: vi.fn(),
      log: () => undefined,
      eventStore,
    });

    expect(updateSessionAttributes).toHaveBeenCalledWith('s1', {
      providers: {
        'pi-cli': {
          sessionId: 'pi-session-123',
          cwd: '/home/kevin',
        },
      },
    });
  });

  it('broadcasts tool_call_start and tool_result messages from Pi CLI tool callbacks', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'Pi',
        description: 'Pi CLI',
        chat: { provider: 'pi-cli' },
      },
    ]);

    const broadcast: ServerMessage[] = [];
    const updateSessionAttributes = vi.fn(async () => undefined);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      updateSessionAttributes,
      recordSessionActivity: () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: { sessionId: 's1', title: 't', createdAt: '', updatedAt: '', deleted: false },
      chatMessages: [],
    } as unknown as LogicalSessionState;
    (state.summary as unknown as { agentId?: string }).agentId = 'pi';

    const sendError = vi.fn();

    vi.mocked(runPiCliChat).mockImplementationOnce(async (options) => {
      await options.onToolCallStart?.('toolu_1', 'bash', { command: 'ls' });
      await options.onToolResult?.('toolu_1', 'bash', true, 'file1\nfile2\n');
      await options.onTextDelta('Done', 'Done');
      return { text: 'Done', aborted: false };
    });

    const eventStore = createTestEventStore();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'run tool', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      openaiClient: {} as OpenAI,
      config: { chatModel: 'gpt-4o-mini' } as EnvConfig,
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

    const toolStarts = broadcast.filter((message) => message.type === 'tool_call_start') as Array<
      Extract<ServerMessage, { type: 'tool_call_start' }>
    >;
    const toolResults = broadcast.filter((message) => message.type === 'tool_result') as Array<
      Extract<ServerMessage, { type: 'tool_result' }>
    >;

    expect(toolStarts).toHaveLength(1);
    expect(toolResults).toHaveLength(1);

    const start = toolStarts[0]!;
    const result = toolResults[0]!;

    expect(start.callId).toBe('toolu_1');
    expect(start.toolName).toBe('bash');
    expect(start.arguments).toBe(JSON.stringify({ command: 'ls' }));

    expect(result.callId).toBe('toolu_1');
    expect(result.toolName).toBe('bash');
    expect(result.ok).toBe(true);
    expect(result.result).toBe('file1\nfile2\n');
  });
});
