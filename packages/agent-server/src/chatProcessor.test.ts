import { beforeEach, describe, expect, it, vi } from 'vitest';

import type OpenAI from 'openai';

import type { ServerMessage } from '@assistant/shared';

import type { ConversationStore } from './conversationStore';
import type { EnvConfig } from './envConfig';
import type { LogicalSessionState, SessionHub } from './sessionHub';

vi.mock('./ws/chatCompletionStreaming', () => {
  return {
    runChatCompletionIteration: vi.fn(),
  };
});

import { runChatCompletionIteration } from './ws/chatCompletionStreaming';
import { processUserMessage } from './chatProcessor';

describe('processUserMessage stream event logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs text_delta and text_done records for openai runs', async () => {
    vi.mocked(runChatCompletionIteration).mockImplementationOnce(async (options) => {
      await options.onDeltaText?.('Hello', 'Hello');
      await options.onDeltaText?.(' world', 'Hello world');
      return { text: 'Hello world', toolCalls: [] };
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

    const conversationStore: ConversationStore = {
      logUserMessage: vi.fn(),
      logAgentMessage: vi.fn(),
      logAssistantMessage: vi.fn(),
      logTextDelta: vi.fn(),
      logTextDone: vi.fn(),
      logThinkingStart: vi.fn(),
      logThinkingDelta: vi.fn(),
      logThinkingDone: vi.fn(),
      logToolCall: vi.fn(),
      logToolCallStart: vi.fn(),
      logToolOutputDelta: vi.fn(),
      logToolResult: vi.fn(),
      logOutputCancelled: vi.fn(),
    } as unknown as ConversationStore;

    const state: LogicalSessionState = {
      summary: {
        sessionId: 's1',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      chatMessages: [],
      messageQueue: [],
    } as unknown as LogicalSessionState;

    await processUserMessage({
      sessionId: 's1',
      state,
      text: 'hi',
      conversationStore,
      sessionHub,
      envConfig: {
        apiKey: 'test-api-key',
        chatModel: 'gpt-4o-mini',
        debugChatCompletions: false,
        debugHttpRequests: false,
      } as EnvConfig,
      openaiClient: {} as OpenAI,
      chatCompletionTools: [],
      handleChatToolCalls: async () => undefined,
      outputMode: 'text',
      ttsBackendFactory: null,
    });

    expect(conversationStore.logTextDelta).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', delta: 'Hello' }),
    );
    expect(conversationStore.logTextDelta).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', delta: ' world' }),
    );
    expect(conversationStore.logTextDone).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', text: 'Hello world' }),
    );

    expect(broadcast.some((message) => message.type === 'text_done')).toBe(true);
  });
});
