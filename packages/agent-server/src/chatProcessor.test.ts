import { beforeEach, describe, expect, it, vi } from 'vitest';

import type OpenAI from 'openai';

import type { ChatEvent, ServerMessage } from '@assistant/shared';

import type { EnvConfig } from './envConfig';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { EventStore } from './events';

vi.mock('./ws/chatCompletionStreaming', () => {
  return {
    runChatCompletionIteration: vi.fn(),
  };
});

import { runChatCompletionIteration } from './ws/chatCompletionStreaming';
import { processUserMessage } from './chatProcessor';

describe('processUserMessage stream event emission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits assistant_chunk and assistant_done events for openai runs', async () => {
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
        chatModel: 'gpt-4o-mini',
        debugChatCompletions: false,
        debugHttpRequests: false,
      } as EnvConfig,
      openaiClient: {} as OpenAI,
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
});
