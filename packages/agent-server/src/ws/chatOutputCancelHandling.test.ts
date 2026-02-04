// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ClientControlMessage, ServerMessage } from '@assistant/shared';

import { handleChatOutputCancel } from './chatOutputCancelHandling';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { EventStore } from '../events';

describe('handleChatOutputCancel', () => {
  it('emits interrupted assistant message and tool results for active tool calls', async () => {
    const sessionId = 'session-1';
    const responseId = 'resp-1';

    const broadcastMessages: ServerMessage[] = [];
    const recordSessionActivity = vi.fn(async () => undefined);

    const sessionHub = {
      broadcastToSession: (_id: string, message: ServerMessage) => {
        broadcastMessages.push(message);
      },
      recordSessionActivity,
    } as unknown as SessionHub;

    const abortController = new AbortController();
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
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as LogicalSessionState['summary'],
      chatMessages: [],
      activeChatRun: {
        responseId,
        turnId: 'turn-1',
        abortController,
        accumulatedText: 'Partial answer',
        activeToolCalls: new Map([
          [
            'call-1',
            {
              callId: 'call-1',
              toolName: 'bash',
              argsJson: '{"command":"ls"}',
            },
          ],
          [
            'call-2',
            {
              callId: 'call-2',
              toolName: 'read',
              argsJson: '{"path":"foo.txt"}',
            },
          ],
        ]),
      },
      messageQueue: [],
    };

    const message: ClientControlMessage = {
      type: 'control',
      action: 'cancel',
      target: 'output',
      audioEndMs: 1234,
    };

    handleChatOutputCancel({
      message,
      activeRunState: { sessionId, state },
      sessionHub,
      broadcastOutputCancelled: vi.fn(),
      log: vi.fn(),
      eventStore,
    });

    expect(abortController.signal.aborted).toBe(true);

    const assistantEvent = events.find((event) => event.type === 'assistant_done');
    expect(assistantEvent?.payload?.text).toBe('Partial answer');
    const toolEvents = events.filter((event) => event.type === 'tool_result');
    const toolEventIds = toolEvents.map((event) => event.payload?.toolCallId).sort();
    expect(toolEventIds).toEqual(['call-1', 'call-2']);

    const toolResultMessages = broadcastMessages.filter((m) => m.type === 'tool_result') as Array<
      Extract<ServerMessage, { type: 'tool_result' }>
    >;
    expect(toolResultMessages).toHaveLength(2);
    const messageCallIds = toolResultMessages.map((m) => m.callId).sort();
    expect(messageCallIds).toEqual(['call-1', 'call-2']);
    for (const m of toolResultMessages) {
      expect(m.ok).toBe(false);
      expect(m.error).toEqual({
        code: 'tool_interrupted',
        message: 'Tool call was interrupted by the user',
      });
    }

    expect(state.activeChatRun?.activeToolCalls?.size).toBe(0);
    expect(state.chatMessages).toHaveLength(2);
    expect(state.chatMessages.every((msg) => msg.role === 'tool')).toBe(true);

    const interruptEvent = events.find((event) => event.type === 'interrupt');
    expect(interruptEvent).toBeDefined();
  });

  it('persists the partial assistant message when no tools are running', async () => {
    const sessionId = 'session-2';
    const responseId = 'resp-2';

    const broadcastMessages: ServerMessage[] = [];
    const recordSessionActivity = vi.fn(async () => undefined);

    const sessionHub = {
      broadcastToSession: (_id: string, message: ServerMessage) => {
        broadcastMessages.push(message);
      },
      recordSessionActivity,
    } as unknown as SessionHub;

    const abortController = new AbortController();
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
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as LogicalSessionState['summary'],
      chatMessages: [],
      activeChatRun: {
        responseId,
        turnId: 'turn-2',
        abortController,
        accumulatedText: 'Partial answer',
      },
      messageQueue: [],
    };

    const message: ClientControlMessage = {
      type: 'control',
      action: 'cancel',
      target: 'output',
    };

    handleChatOutputCancel({
      message,
      activeRunState: { sessionId, state },
      sessionHub,
      broadcastOutputCancelled: vi.fn(),
      log: vi.fn(),
      eventStore,
    });

    expect(state.chatMessages).toHaveLength(0);
    expect(recordSessionActivity).toHaveBeenCalledWith(sessionId, 'Partial answer');
    expect(broadcastMessages.find((m) => m.type === 'tool_result')).toBeUndefined();
  });

  it('skips interrupt logging when no output has started', async () => {
    const sessionId = 'session-3';
    const responseId = 'resp-3';

    const recordSessionActivity = vi.fn(async () => undefined);
    const sessionHub = {
      broadcastToSession: vi.fn(),
      recordSessionActivity,
      getPiSessionWriter: () => undefined,
      getAgentRegistry: () => undefined,
      updateSessionAttributes: vi.fn(),
    } as unknown as SessionHub;

    const abortController = new AbortController();
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
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as LogicalSessionState['summary'],
      chatMessages: [],
      activeChatRun: {
        responseId,
        turnId: 'turn-3',
        abortController,
        accumulatedText: '',
      },
      messageQueue: [],
    };

    const message: ClientControlMessage = {
      type: 'control',
      action: 'cancel',
      target: 'output',
    };

    handleChatOutputCancel({
      message,
      activeRunState: { sessionId, state },
      sessionHub,
      broadcastOutputCancelled: vi.fn(),
      log: vi.fn(),
      eventStore,
    });

    expect(abortController.signal.aborted).toBe(true);
    expect(events.some((event) => event.type === 'interrupt')).toBe(false);
    expect(events.some((event) => event.type === 'assistant_done')).toBe(false);
    expect(recordSessionActivity).not.toHaveBeenCalled();
  });
});
