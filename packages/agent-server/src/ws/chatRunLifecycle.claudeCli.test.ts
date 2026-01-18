import { beforeEach, describe, expect, it, vi } from 'vitest';

import type OpenAI from 'openai';

import type { ServerMessage } from '@assistant/shared';

import { AgentRegistry } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { EventStore } from '../events';

vi.mock('./claudeCliChat', () => {
  return {
    runClaudeCliChat: vi.fn(),
  };
});

import { runClaudeCliChat } from './claudeCliChat';
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

describe('handleTextInputWithChatCompletions (claude-cli)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams claude deltas as text_delta and finishes with text_done', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'claude',
        displayName: 'Claude',
        description: 'Claude CLI',
        chat: { provider: 'claude-cli' },
      },
    ]);

    const broadcast: ServerMessage[] = [];

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      // Queue-related methods are not exercised in these tests.
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
    (state.summary as unknown as { agentId?: string }).agentId = 'claude';

    const sendError = vi.fn();

    vi.mocked(runClaudeCliChat).mockImplementationOnce(async (options) => {
      expect(options.resumeSession).toBe(false);
      await options.onThinkingStart?.();
      await options.onThinkingDelta?.('Thinking about this…', 'Thinking about this…');
      await options.onThinkingDone?.('Thinking about this…');
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
    expect((textDone[0] as unknown as { text: string }).text).toBe('Hello world');
    expect((thinkingDone[0] as unknown as { responseId: string }).responseId).toBe(responseId);
    expect(sendError).not.toHaveBeenCalled();
  });

  it('uses --resume semantics after the first user message', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'claude',
        displayName: 'Claude',
        description: 'Claude CLI',
        chat: { provider: 'claude-cli' },
      },
    ]);

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: () => undefined,
      broadcastToSessionExcluding: () => undefined,
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
    (state.summary as unknown as { agentId?: string }).agentId = 'claude';

    vi.mocked(runClaudeCliChat)
      .mockResolvedValueOnce({ text: 'ok', aborted: false })
      .mockResolvedValueOnce({ text: 'ok2', aborted: false });

    const eventStore = createTestEventStore();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'one', sessionId: 's1' },
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
      sendError: () => undefined,
      log: () => undefined,
      eventStore,
    });

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'two', sessionId: 's1' },
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
      sendError: () => undefined,
      log: () => undefined,
      eventStore,
    });

    expect(vi.mocked(runClaudeCliChat)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(runClaudeCliChat).mock.calls[0]?.[0].resumeSession).toBe(false);
    expect(vi.mocked(runClaudeCliChat).mock.calls[1]?.[0].resumeSession).toBe(true);
  });

  it('broadcasts tool_call_start and tool_result messages from Claude CLI tool callbacks', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'claude',
        displayName: 'Claude',
        description: 'Claude CLI',
        chat: { provider: 'claude-cli' },
      },
    ]);

    const broadcast: ServerMessage[] = [];

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
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
    (state.summary as unknown as { agentId?: string }).agentId = 'claude';

    const sendError = vi.fn();

    vi.mocked(runClaudeCliChat).mockImplementationOnce(async (options) => {
      // Simulate a tool call + result emitted via callbacks
      await options.onToolCallStart?.('call-1', 'bash', { command: 'echo hi' });
      await options.onToolResult?.('call-1', 'bash', true, { output: 'hi\n', exitCode: 0 });
      // And a small amount of assistant text
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

    expect(start.callId).toBe('call-1');
    expect(start.toolName).toBe('bash');
    expect(start.arguments).toBe(JSON.stringify({ command: 'echo hi' }));

    expect(result.callId).toBe('call-1');
    expect(result.toolName).toBe('bash');
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({ output: 'hi\n', exitCode: 0 });
  });

  it('queues input while a run is active without logging or broadcasting', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'claude',
        displayName: 'Claude',
        description: 'Claude CLI',
        chat: { provider: 'claude-cli' },
      },
    ]);

    const broadcastToSession = vi.fn();
    const broadcastToSessionExcluding = vi.fn();
    const recordSessionActivity = vi.fn();

    const queueMessage = vi.fn(async () => ({
      id: 'queued-1',
      text: 'hi',
      queuedAt: new Date().toISOString(),
      source: 'user',
    }));

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession,
      broadcastToSessionExcluding,
      recordSessionActivity,
      queueMessage,
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

    const state: LogicalSessionState = {
      summary: { sessionId: 's1', title: 't', createdAt: '', updatedAt: '', deleted: false },
      chatMessages: [],
      messageQueue: [],
      activeChatRun: {
        responseId: 'r1',
        abortController: new AbortController(),
        accumulatedText: '',
      },
    } as unknown as LogicalSessionState;
    (state.summary as unknown as { agentId?: string }).agentId = 'claude';

    const sendError = vi.fn();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'hi', sessionId: 's1', clientMessageId: 'client-1' },
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
      eventStore: createTestEventStore(),
    });

    expect(sendError).not.toHaveBeenCalled();
    expect(queueMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's1',
        text: 'hi',
        source: 'user',
        clientMessageId: 'client-1',
        execute: expect.any(Function),
      }),
    );
    expect(broadcastToSession).not.toHaveBeenCalled();
    expect(broadcastToSessionExcluding).not.toHaveBeenCalled();
    expect(recordSessionActivity).not.toHaveBeenCalled();
    expect(state.chatMessages).toHaveLength(0);
    expect(runClaudeCliChat).not.toHaveBeenCalled();
  });

  it('clears active runs on reloaded session state copies', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'claude',
        displayName: 'Claude',
        description: 'Claude CLI',
        chat: { provider: 'claude-cli' },
      },
    ]);

    const broadcast: ServerMessage[] = [];

    const state: LogicalSessionState = {
      summary: { sessionId: 's1', title: 't', createdAt: '', updatedAt: '', deleted: false },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;
    (state.summary as unknown as { agentId?: string }).agentId = 'claude';

    const reloadedState: LogicalSessionState = {
      summary: state.summary,
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      getSessionState: () => reloadedState,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      recordSessionActivity: () => undefined,
      queueMessage: async () => {
        throw new Error('queueMessage should not be called in this test');
      },
      dequeueMessageById: async () => undefined,
      processNextQueuedMessage: async () => false,
    } as unknown as SessionHub;

    vi.mocked(runClaudeCliChat).mockImplementationOnce(async (options) => {
      reloadedState.activeChatRun = state.activeChatRun;
      await options.onTextDelta('Hi', 'Hi');
      return { text: 'Hi', aborted: false };
    });

    const eventStore = createTestEventStore();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'hello', sessionId: 's1' },
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
      sendError: () => undefined,
      log: () => undefined,
      eventStore,
    });

    expect(reloadedState.activeChatRun).toBeUndefined();
    expect(broadcast.some((message) => message.type === 'text_done')).toBe(true);
  });
});
