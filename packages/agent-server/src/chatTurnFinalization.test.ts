import { describe, expect, it, vi } from 'vitest';

import { finalizeChatTurn } from './chatTurnFinalization';
import type { EventStore } from './events';
import type { LogicalSessionState, SessionHub } from './sessionHub';

describe('finalizeChatTurn', () => {
  it('clears the Pi transient overlay buffer after durable turn close', async () => {
    const clearTransientSession = vi.fn(async () => undefined);
    const appendTurnEnd = vi.fn(async () => undefined);
    const state: LogicalSessionState = {
      summary: {
        sessionId: 'session-1',
        createdAt: '',
        updatedAt: '',
        deleted: false,
        attributes: {},
      },
      chatMessages: [],
      messageQueue: [],
    };
    const sessionHub = {
      getPiSessionWriter: () =>
        ({
          appendTurnEnd,
        }) as unknown as SessionHub['getPiSessionWriter'] extends () => infer T ? T : never,
      updateSessionAttributes: vi.fn(async () => undefined),
      broadcastToSession: vi.fn(),
    } as unknown as SessionHub;
    const eventStore: EventStore = {
      append: vi.fn(async () => undefined),
      appendBatch: vi.fn(async () => undefined),
      getEvents: vi.fn(async () => []),
      getEventsSince: vi.fn(async () => []),
      subscribe: vi.fn(() => () => undefined),
      clearSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
      clearTransientSession,
    };

    const finalized = await finalizeChatTurn({
      sessionId: 'session-1',
      state,
      sessionHub,
      run: {
        turnId: 'turn-1',
        responseId: 'response-1',
        abortController: new AbortController(),
        accumulatedText: '',
      },
      log: vi.fn(),
      eventStore,
      piTurnEndStatus: 'completed',
    });

    expect(finalized).toBe(true);
    expect(appendTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: state.summary,
        turnId: 'turn-1',
        status: 'completed',
      }),
    );
    expect(clearTransientSession).toHaveBeenCalledWith('session-1');
  });
});
