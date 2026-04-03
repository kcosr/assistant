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

function createTranscriptMessage(options: {
  sessionId: string;
  eventId: string;
  sequence?: number;
  requestId?: string;
  chatEventType: 'turn_start' | 'turn_end' | 'tool_call' | 'assistant_done';
  kind: 'request_start' | 'request_end' | 'tool_call' | 'assistant_message';
  payload: Record<string, unknown>;
  toolCallId?: string;
  responseId?: string;
}): ServerMessage {
  const {
    sessionId,
    eventId,
    sequence = 0,
    requestId = 'request-1',
    chatEventType,
    kind,
    payload,
    toolCallId,
    responseId,
  } = options;

  return {
    type: 'transcript_event',
    event: {
      sessionId,
      revision: 1,
      sequence,
      requestId,
      eventId,
      kind,
      chatEventType,
      timestamp: `2026-04-02T00:00:0${sequence}.000Z`,
      ...(toolCallId ? { toolCallId } : {}),
      ...(responseId ? { responseId } : {}),
      payload,
    },
  };
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
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak', 'voice_ask'],
    });
    registry.subscribe('session-a', unfilteredConnection);

    registry.broadcastToSession(
      'session-a',
      createTranscriptMessage({
        sessionId: 'session-a',
        eventId: 'evt-1',
        chatEventType: 'tool_call',
        kind: 'tool_call',
        toolCallId: 'call-1',
        payload: {
          toolName: 'voice_speak',
          args: { text: 'hello' },
        },
      }),
    );

    registry.broadcastToSession(
      'session-a',
      createTranscriptMessage({
        sessionId: 'session-a',
        eventId: 'evt-2',
        sequence: 1,
        chatEventType: 'tool_call',
        kind: 'tool_call',
        toolCallId: 'call-2',
        payload: {
          toolName: 'sleep',
          args: { seconds: 1 },
        },
      }),
    );

    expect(sendFiltered).toHaveBeenCalledTimes(1);
    expect(sendUnfiltered).toHaveBeenCalledTimes(2);
  });

  it('filters assistant chat events by final-answer phase', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['assistant_done'],
      messagePhases: ['final_answer'],
    });

    registry.broadcastToSession(
      'session-a',
      createTranscriptMessage({
        sessionId: 'session-a',
        eventId: 'evt-1',
        chatEventType: 'assistant_done',
        kind: 'assistant_message',
        responseId: 'resp-1',
        payload: { text: 'Commentary', phase: 'commentary' },
      }),
    );

    registry.broadcastToSession(
      'session-a',
      createTranscriptMessage({
        sessionId: 'session-a',
        eventId: 'evt-2',
        sequence: 1,
        chatEventType: 'assistant_done',
        kind: 'assistant_message',
        responseId: 'resp-2',
        payload: { text: 'Final', phase: 'final_answer' },
      }),
    );

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcript_event',
        event: expect.objectContaining({
          eventId: 'evt-2',
          chatEventType: 'assistant_done',
        }),
      }),
    );
  });

  it('filters transcript events by projected chat event type and tool name', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak'],
    });

    registry.broadcastToSession('session-a', {
      type: 'transcript_event',
      event: {
        sessionId: 'session-a',
        revision: 1,
        sequence: 0,
        requestId: 'request-1',
        eventId: 'evt-1',
        kind: 'tool_call',
        chatEventType: 'tool_call',
        timestamp: '2026-04-02T00:00:00.000Z',
        toolCallId: 'call-1',
        payload: {
          toolName: 'voice_speak',
          args: { text: 'hello' },
        },
      },
    });

    registry.broadcastToSession('session-a', {
      type: 'transcript_event',
      event: {
        sessionId: 'session-a',
        revision: 1,
        sequence: 1,
        requestId: 'request-1',
        eventId: 'evt-2',
        kind: 'tool_call',
        chatEventType: 'tool_call',
        timestamp: '2026-04-02T00:00:01.000Z',
        toolCallId: 'call-2',
        payload: {
          toolName: 'sleep',
          args: { seconds: 1 },
        },
      },
    });

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcript_event',
        event: expect.objectContaining({
          eventId: 'evt-1',
        }),
      }),
    );
  });

  it('filters transcript assistant messages by phase', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['assistant_done'],
      messagePhases: ['final_answer'],
    });

    registry.broadcastToSession('session-a', {
      type: 'transcript_event',
      event: {
        sessionId: 'session-a',
        revision: 1,
        sequence: 0,
        requestId: 'request-1',
        eventId: 'evt-1',
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        timestamp: '2026-04-02T00:00:00.000Z',
        responseId: 'resp-1',
        payload: {
          text: 'Commentary',
          phase: 'commentary',
        },
      },
    });

    registry.broadcastToSession('session-a', {
      type: 'transcript_event',
      event: {
        sessionId: 'session-a',
        revision: 1,
        sequence: 1,
        requestId: 'request-1',
        eventId: 'evt-2',
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        timestamp: '2026-04-02T00:00:01.000Z',
        responseId: 'resp-2',
        payload: {
          text: 'Final',
          phase: 'final_answer',
        },
      },
    });

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcript_event',
        event: expect.objectContaining({
          eventId: 'evt-2',
        }),
      }),
    );
  });

  it('drops non-chat-event messages when top-level filtering excludes them', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['tool_call'],
    });

    registry.broadcastToSession('session-a', {
      type: 'session_history_changed',
      sessionId: 'session-a',
      updatedAt: '2026-03-31T00:00:00.000Z',
    });

    expect(sendServerMessageFromHub).not.toHaveBeenCalled();
  });

  it('allows explicitly selected non-chat-event messages alongside chatEventTypes filtering', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event', 'output_cancelled'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak'],
    });

    registry.broadcastToSession('session-a', {
      type: 'output_cancelled',
      sessionId: 'session-a',
      responseId: 'resp-1',
    });

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith({
      type: 'output_cancelled',
      sessionId: 'session-a',
      responseId: 'resp-1',
    });
  });

  it('lets non-tool messages pass through when only toolNames filtering is present', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      toolNames: ['voice_speak'],
    });

    registry.broadcastToSession('session-a', {
      type: 'session_history_changed',
      sessionId: 'session-a',
      updatedAt: '2026-03-31T00:00:00.000Z',
    });

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith({
      type: 'session_history_changed',
      sessionId: 'session-a',
      updatedAt: '2026-03-31T00:00:00.000Z',
    });
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
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak'],
    });

    registry.broadcastToSessionExcluding(
      'session-a',
      createTranscriptMessage({
        sessionId: 'session-a',
        eventId: 'evt-1',
        chatEventType: 'tool_call',
        kind: 'tool_call',
        toolCallId: 'call-1',
        payload: {
          toolName: 'voice_speak',
          args: { text: 'hello' },
        },
      }),
      excludedConnection,
    );

    expect(sendExcluded).not.toHaveBeenCalled();
    expect(sendFiltered).toHaveBeenCalledTimes(1);
  });

  it('replaces the previous mask when subscribing to the same session again', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak'],
    });
    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_ask'],
    });

    registry.broadcastToSession(
      'session-a',
      createTranscriptMessage({
        sessionId: 'session-a',
        eventId: 'evt-1',
        chatEventType: 'tool_call',
        kind: 'tool_call',
        toolCallId: 'call-1',
        payload: {
          toolName: 'voice_speak',
          args: { text: 'hello' },
        },
      }),
    );

    registry.broadcastToSession(
      'session-a',
      createTranscriptMessage({
        sessionId: 'session-a',
        eventId: 'evt-2',
        sequence: 1,
        chatEventType: 'tool_call',
        kind: 'tool_call',
        toolCallId: 'call-2',
        payload: {
          toolName: 'voice_ask',
          args: { text: 'question' },
        },
      }),
    );

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'transcript_event',
        event: expect.objectContaining({
          eventId: 'evt-2',
          toolCallId: 'call-2',
        }),
      }),
    );
  });

  it('broadcastToAll bypasses per-session masks', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection, {
      serverMessageTypes: ['transcript_event'],
      chatEventTypes: ['tool_call'],
      toolNames: ['voice_speak'],
    });

    registry.broadcastToAll({
      type: 'session_created',
      sessionId: 'session-b',
      createdAt: '2026-03-31T00:00:00.000Z',
    });

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith({
      type: 'session_created',
      sessionId: 'session-b',
      createdAt: '2026-03-31T00:00:00.000Z',
    });
  });
});
