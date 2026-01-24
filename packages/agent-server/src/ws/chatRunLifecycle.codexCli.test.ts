import { beforeEach, describe, expect, it, vi } from 'vitest';

import type OpenAI from 'openai';

import type { ServerMessage } from '@assistant/shared';

import { AgentRegistry } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { EventStore } from '../events';

vi.mock('./codexCliChat', () => {
  return {
    runCodexCliChat: vi.fn(),
  };
});

import { runCodexCliChat } from './codexCliChat';
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

describe('handleTextInputWithChatCompletions (codex-cli)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('broadcasts tool_call_start and tool_result messages from Codex CLI tool callbacks', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'codex',
        displayName: 'Codex',
        description: 'Codex CLI',
        chat: { provider: 'codex-cli' },
      },
    ]);

    const broadcast: ServerMessage[] = [];

    const sessionHub: SessionHub = {
      getAgentRegistry: () => agentRegistry,
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
      broadcastToSessionExcluding: () => undefined,
      recordCliToolCall: () => undefined,
      recordSessionActivity: () => undefined,
      updateSessionAttributes: async () => state.summary,
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
    (state.summary as unknown as { agentId?: string }).agentId = 'codex';

    const sendError = vi.fn();

    vi.mocked(runCodexCliChat).mockImplementationOnce(async (options) => {
      await options.onThinkingStart?.();
      await options.onThinkingDelta?.('Reasoning…', 'Reasoning…');
      await options.onThinkingDone?.('Reasoning…');
      await options.onToolCallStart?.('call-2', 'shell', { command: 'echo hi' });
      await options.onToolResult?.('call-2', 'shell', false, { output: 'hi\n', exitCode: 1 });
      return { text: '', aborted: false, codexSessionId: 'thread-1' };
    });

    const eventStore = createTestEventStore();

    await handleTextInputWithChatCompletions({
      ready: true,
      message: { type: 'text_input', text: 'run cmd', sessionId: 's1' },
      state,
      sessionId: 's1',
      connection: {} as never,
      sessionHub,
      openaiClient: {} as OpenAI,
      config: { chatModel: 'gpt-4o-mini', dataDir: '/tmp/assistant-tests' } as EnvConfig,
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

    const thinkingStart = broadcast.filter((message) => message.type === 'thinking_start');
    const thinkingDelta = broadcast.filter((message) => message.type === 'thinking_delta');
    const thinkingDone = broadcast.filter((message) => message.type === 'thinking_done');

    expect(thinkingStart).toHaveLength(1);
    expect(thinkingDelta).toHaveLength(1);
    expect(thinkingDone).toHaveLength(1);
    expect(toolStarts).toHaveLength(1);
    expect(toolResults).toHaveLength(1);

    const start = toolStarts[0]!;
    const result = toolResults[0]!;

    expect(start.callId).toBe('call-2');
    expect(start.toolName).toBe('shell');
    expect(start.arguments).toBe(JSON.stringify({ command: 'echo hi' }));

    expect(result.callId).toBe('call-2');
    expect(result.toolName).toBe('shell');
    expect(result.ok).toBe(false);
    expect(result.result).toMatchObject({ output: 'hi\n', exitCode: 1 });
    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('code 1');
  });
});
