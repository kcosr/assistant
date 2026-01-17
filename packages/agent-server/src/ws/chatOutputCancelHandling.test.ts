// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ClientControlMessage, ServerMessage } from '@assistant/shared';

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
    const events: Array<{ type: string; payload?: { text?: string; toolCallId?: string } }> = [];
    const eventStore: EventStore = {
      append: async (_sessionId, event) => {
        events.push(event);
      },
      appendBatch: async (_sessionId, batch) => {
        events.push(...batch);
      },
      getEvents: async () => events as never[],
      getEventsSince: async () => events as never[],
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

    const interruptEvent = events.find((event) => event.type === 'interrupt');
    expect(interruptEvent).toBeDefined();
  });
});
