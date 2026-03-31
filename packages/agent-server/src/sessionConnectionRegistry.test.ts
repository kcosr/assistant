import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '@assistant/shared';

import { SessionConnectionRegistry } from './sessionConnectionRegistry';
import type { SessionConnection } from './ws/sessionConnection';

function createTestConnection(): {
  connection: SessionConnection;
  sendServerMessageFromHub: ReturnType<typeof vi.fn>;
} {
  const sendServerMessageFromHub = vi.fn();
  const sendErrorFromHub = vi.fn();

  const connection: SessionConnection = {
    sendServerMessageFromHub,
    sendErrorFromHub,
  };

  return { connection, sendServerMessageFromHub };
}

describe('SessionConnectionRegistry', () => {
  it('tracks subscriptions and unsubscriptions in both directions', () => {
    const registry = new SessionConnectionRegistry();
    const { connection: connection1, sendServerMessageFromHub: send1 } = createTestConnection();
    const { connection: connection2, sendServerMessageFromHub: send2 } = createTestConnection();

    registry.subscribe('session-a', connection1);
    registry.subscribe('session-a', connection2);
    registry.subscribe('session-b', connection1);

    expect(Array.from(registry.getSubscriptions(connection1)).sort()).toEqual([
      'session-a',
      'session-b',
    ]);
    expect(Array.from(registry.getSubscriptions(connection2))).toEqual(['session-a']);

    const message: ServerMessage = { type: 'session_cleared', sessionId: 'session-a' };
    registry.broadcastToSession('session-a', message);

    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);

    registry.unsubscribe('session-a', connection1);

    expect(Array.from(registry.getSubscriptions(connection1))).toEqual(['session-b']);
    expect(Array.from(registry.getSubscriptions(connection2))).toEqual(['session-a']);
  });

  it('unsubscribeAll removes connection from all sessions', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection);
    registry.subscribe('session-b', connection);

    expect(Array.from(registry.getSubscriptions(connection)).sort()).toEqual([
      'session-a',
      'session-b',
    ]);

    registry.unsubscribeAll(connection);

    expect(Array.from(registry.getSubscriptions(connection))).toEqual([]);

    const message: ServerMessage = { type: 'session_cleared', sessionId: 'session-a' };
    registry.broadcastToSession('session-a', message);

    expect(sendServerMessageFromHub).not.toHaveBeenCalled();
  });

  it('broadcastToAll delivers each message once per connection', () => {
    const registry = new SessionConnectionRegistry();
    const { connection: connection1, sendServerMessageFromHub: send1 } = createTestConnection();
    const { connection: connection2, sendServerMessageFromHub: send2 } = createTestConnection();

    registry.subscribe('session-a', connection1);
    registry.subscribe('session-b', connection1);
    registry.subscribe('session-b', connection2);

    const message: ServerMessage = { type: 'session_deleted', sessionId: 'session-a' };
    registry.broadcastToAll(message);

    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);
    expect(send1).toHaveBeenCalledWith(message);
    expect(send2).toHaveBeenCalledWith(message);
  });

  it('broadcastToAll reaches registered connections without subscriptions', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.registerConnection(connection);

    const message: ServerMessage = { type: 'session_deleted', sessionId: 'session-a' };
    registry.broadcastToAll(message);

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith(message);
  });

  it('filters session broadcasts by masked chat event type and tool name', () => {
    const registry = new SessionConnectionRegistry();
    const { connection: filteredConnection, sendServerMessageFromHub: sendFiltered } =
      createTestConnection();
    const { connection: unfilteredConnection, sendServerMessageFromHub: sendUnfiltered } =
      createTestConnection();

    registry.subscribe('session-a', filteredConnection, {
      serverMessageTypes: ['chat_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak', 'voice_ask'],
    });
    registry.subscribe('session-a', unfilteredConnection);

    registry.broadcastToSession('session-a', {
      type: 'chat_event',
      sessionId: 'session-a',
      event: {
        id: 'evt-1',
        timestamp: 1,
        sessionId: 'session-a',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-1',
          toolName: 'voice_speak',
          args: { text: 'hello' },
        },
      },
    });

    registry.broadcastToSession('session-a', {
      type: 'chat_event',
      sessionId: 'session-a',
      event: {
        id: 'evt-2',
        timestamp: 2,
        sessionId: 'session-a',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-2',
          toolName: 'sleep',
          args: { seconds: 1 },
        },
      },
    });

    expect(sendFiltered).toHaveBeenCalledTimes(1);
    expect(sendUnfiltered).toHaveBeenCalledTimes(2);
  });

  it('filters assistant chat events by final-answer phase', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['chat_event'],
      chatEventTypes: ['assistant_done'],
      messagePhases: ['final_answer'],
    });

    registry.broadcastToSession('session-a', {
      type: 'chat_event',
      sessionId: 'session-a',
      event: {
        id: 'evt-1',
        timestamp: 1,
        sessionId: 'session-a',
        type: 'assistant_done',
        payload: { text: 'Commentary', phase: 'commentary' },
      },
    });

    registry.broadcastToSession('session-a', {
      type: 'chat_event',
      sessionId: 'session-a',
      event: {
        id: 'evt-2',
        timestamp: 2,
        sessionId: 'session-a',
        type: 'assistant_done',
        payload: { text: 'Final', phase: 'final_answer' },
      },
    });

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith({
      type: 'chat_event',
      sessionId: 'session-a',
      event: {
        id: 'evt-2',
        timestamp: 2,
        sessionId: 'session-a',
        type: 'assistant_done',
        payload: { text: 'Final', phase: 'final_answer' },
      },
    });
  });

  it('drops non-chat-event messages when chatEventTypes filtering is present', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      chatEventTypes: ['tool_call'],
    });

    registry.broadcastToSession('session-a', {
      type: 'session_history_changed',
      sessionId: 'session-a',
      updatedAt: '2026-03-31T00:00:00.000Z',
    });

    expect(sendServerMessageFromHub).not.toHaveBeenCalled();
  });

  it('filters top-level assistant text messages by phase', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['text_done'],
      messagePhases: ['final_answer'],
    });

    registry.broadcastToSession('session-a', {
      type: 'text_done',
      sessionId: 'session-a',
      responseId: 'resp-1',
      text: 'Commentary',
      phase: 'commentary',
    });

    registry.broadcastToSession('session-a', {
      type: 'text_done',
      sessionId: 'session-a',
      responseId: 'resp-2',
      text: 'Final answer',
      phase: 'final_answer',
    });

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith({
      type: 'text_done',
      sessionId: 'session-a',
      responseId: 'resp-2',
      text: 'Final answer',
      phase: 'final_answer',
    });
  });

  it('applies mask filtering in broadcastToSessionExcluding', () => {
    const registry = new SessionConnectionRegistry();
    const { connection: excludedConnection, sendServerMessageFromHub: sendExcluded } =
      createTestConnection();
    const { connection: filteredConnection, sendServerMessageFromHub: sendFiltered } =
      createTestConnection();

    registry.subscribe('session-a', excludedConnection);
    registry.subscribe('session-a', filteredConnection, {
      serverMessageTypes: ['chat_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak'],
    });

    registry.broadcastToSessionExcluding(
      'session-a',
      {
        type: 'chat_event',
        sessionId: 'session-a',
        event: {
          id: 'evt-1',
          timestamp: 1,
          sessionId: 'session-a',
          type: 'tool_call',
          payload: {
            toolCallId: 'call-1',
            toolName: 'voice_speak',
            args: { text: 'hello' },
          },
        },
      },
      excludedConnection,
    );

    expect(sendExcluded).not.toHaveBeenCalled();
    expect(sendFiltered).toHaveBeenCalledTimes(1);
  });
});
