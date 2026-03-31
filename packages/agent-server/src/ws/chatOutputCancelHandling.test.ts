// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ClientControlMessage, ServerMessage } from '@assistant/shared';

import { handleChatOutputCancel } from './chatOutputCancelHandling';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { EventStore } from '../events';
import type { PiSessionWriter } from '../history/piSessionWriter';

describe('handleChatOutputCancel', () => {
  it('persists interrupted partial assistant text alongside interrupted tool results', async () => {
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

    const assistantEvent = events.find((event) => event.type === 'assistant_done') as
      | Extract<ChatEvent, { type: 'assistant_done' }>
      | undefined;
    expect(assistantEvent?.payload).toMatchObject({
      text: 'Partial answer',
      interrupted: true,
    });
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
    expect(recordSessionActivity).not.toHaveBeenCalled();

    const interruptEvent = events.find((event) => event.type === 'interrupt');
    expect(interruptEvent).toBeDefined();
  });

  it('persists interrupted partial assistant text even when no tools are running', async () => {
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
    const assistantEvent = events.find((event) => event.type === 'assistant_done') as
      | Extract<ChatEvent, { type: 'assistant_done' }>
      | undefined;
    expect(assistantEvent?.payload).toMatchObject({
      text: 'Partial answer',
      interrupted: true,
    });
    expect(recordSessionActivity).not.toHaveBeenCalled();
    expect(broadcastMessages.find((m) => m.type === 'tool_result')).toBeUndefined();
    const interruptEvent = events.find((event) => event.type === 'interrupt');
    expect(interruptEvent).toBeDefined();
  });

  it('still records an interrupt when cancelling before output has started', async () => {
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
    expect(events.some((event) => event.type === 'interrupt')).toBe(true);
    expect(events.some((event) => event.type === 'assistant_done')).toBe(false);
    expect(recordSessionActivity).not.toHaveBeenCalled();
  });

  it('closes the Pi turn as interrupted when cancelling a Pi-backed run', async () => {
    const sessionId = 'session-4';
    const appendTurnEnd = vi.fn(async () => undefined);
    const appendAssistantEvent = vi.fn(async () => undefined);
    const piSessionWriter = {
      appendAssistantEvent,
      appendTurnEnd,
    } as unknown as PiSessionWriter;

    const sessionHub = {
      broadcastToSession: vi.fn(),
      recordSessionActivity: vi.fn(async () => undefined),
      getPiSessionWriter: () => piSessionWriter,
      getAgentRegistry: () => ({
        getAgent: () => ({ chat: { provider: 'pi' } }),
      }),
      updateSessionAttributes: vi.fn(async () => undefined),
    } as unknown as SessionHub;

    const abortController = new AbortController();
    const state: LogicalSessionState = {
      summary: {
        sessionId,
        agentId: 'pi',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as LogicalSessionState['summary'],
      chatMessages: [],
      activeChatRun: {
        responseId: 'resp-4',
        turnId: 'turn-4',
        abortController,
        accumulatedText: '',
      },
      messageQueue: [],
    };

    handleChatOutputCancel({
      message: {
        type: 'control',
        action: 'cancel',
        target: 'output',
      },
      activeRunState: { sessionId, state },
      sessionHub,
      broadcastOutputCancelled: vi.fn(),
      log: vi.fn(),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(appendAssistantEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: state.summary,
        eventType: 'interrupt',
        payload: { reason: 'user_cancel' },
        turnId: 'turn-4',
        responseId: 'resp-4',
      }),
    );
    expect(appendTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: state.summary,
        turnId: 'turn-4',
        status: 'interrupted',
      }),
    );
  });

  it('does not double-write Pi interrupt events when eventStore mirroring is active', async () => {
    const sessionId = 'session-5';
    const appendTurnEnd = vi.fn(async () => undefined);
    const appendAssistantEvent = vi.fn(async () => undefined);
    const appendBatch = vi.fn(async () => undefined);
    const piSessionWriter = {
      appendAssistantEvent,
      appendTurnEnd,
    } as unknown as PiSessionWriter;

    const sessionHub = {
      broadcastToSession: vi.fn(),
      recordSessionActivity: vi.fn(async () => undefined),
      getPiSessionWriter: () => piSessionWriter,
      getAgentRegistry: () => ({
        getAgent: () => ({ chat: { provider: 'pi' } }),
      }),
      updateSessionAttributes: vi.fn(async () => undefined),
    } as unknown as SessionHub;

    const abortController = new AbortController();
    const state: LogicalSessionState = {
      summary: {
        sessionId,
        agentId: 'pi',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as LogicalSessionState['summary'],
      chatMessages: [],
      activeChatRun: {
        responseId: 'resp-5',
        turnId: 'turn-5',
        abortController,
        accumulatedText: 'Partial answer',
      },
      messageQueue: [],
    };

    const eventStore: EventStore = {
      append: async () => undefined,
      appendBatch,
      getEvents: async () => [],
      getEventsSince: async () => [],
      subscribe: () => () => {},
      clearSession: async () => {},
      deleteSession: async () => {},
    };

    handleChatOutputCancel({
      message: {
        type: 'control',
        action: 'cancel',
        target: 'output',
      },
      activeRunState: { sessionId, state },
      sessionHub,
      broadcastOutputCancelled: vi.fn(),
      log: vi.fn(),
      eventStore,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(appendBatch).toHaveBeenCalledTimes(1);
    expect(appendAssistantEvent).not.toHaveBeenCalled();
    expect(appendTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: state.summary,
        turnId: 'turn-5',
        status: 'interrupted',
      }),
    );
  });
});
