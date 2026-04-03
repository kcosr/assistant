import { describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../agents';
import type { EventStore } from './eventStore';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import {
  appendAndBroadcastChatEvents,
  emitInteractionPendingEvent,
  emitToolOutputChunkEvent,
  resetLiveTranscriptSessionState,
} from './chatEventUtils';

function createEventStore(): EventStore {
  return {
    append: vi.fn(async () => undefined),
    appendBatch: vi.fn(async () => undefined),
    getEvents: vi.fn(async () => []),
    getEventsSince: vi.fn(async () => []),
    subscribe: vi.fn(() => () => undefined),
    clearSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(async () => undefined),
  };
}

function createSessionHub(provider: 'pi' | 'pi-cli' | 'claude-cli', sessionId = 's1') {
  const broadcastToSession = vi.fn();
  const appendAssistantEvent = vi.fn(async () => undefined);
  const agentId = provider === 'claude-cli' ? 'general' : provider;
  const agentRegistry = new AgentRegistry([
    {
      agentId,
      displayName: agentId,
      description: agentId,
      chat: {
        provider,
        models: ['openai-codex/gpt-5.4'],
      },
    },
  ]);
  const state: LogicalSessionState = {
    summary: {
      sessionId,
      title: 'Test',
      createdAt: '',
      updatedAt: '2026-04-02T00:00:00.000Z',
      revision: 1,
      deleted: false,
      agentId,
      attributes: {},
    },
    chatMessages: [],
  } as unknown as LogicalSessionState;
  const sessionHub: SessionHub = {
    getSessionState: vi.fn(() => state),
    getAgentRegistry: vi.fn(() => agentRegistry),
    getPiSessionWriter: vi.fn(() =>
      provider === 'pi' || provider === 'pi-cli'
        ? ({
            appendAssistantEvent,
          } as unknown)
        : undefined,
    ),
    broadcastToSession,
  } as unknown as SessionHub;
  return { sessionHub, broadcastToSession, state, appendAssistantEvent };
}

describe('chatEventUtils live broadcast behavior', () => {
  it('broadcasts transcript_event for persisted pi events', async () => {
    const eventStore = createEventStore();
    const { sessionHub, broadcastToSession, appendAssistantEvent } = createSessionHub('pi');

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 's1' },
      [
        {
          id: 'evt-1',
          sessionId: 's1',
          turnId: 'req-1',
          responseId: 'resp-1',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'hello' },
        },
      ],
    );

    expect(eventStore.append).not.toHaveBeenCalled();
    expect(appendAssistantEvent).toHaveBeenCalledTimes(1);
    expect(broadcastToSession).toHaveBeenCalledTimes(1);
    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: {
        sessionId: 's1',
        requestId: 'req-1',
        kind: 'assistant_message',
      },
    });
  });

  it('broadcasts live transcript events for Pi sessions without requiring EventStore', async () => {
    const { sessionHub, broadcastToSession, appendAssistantEvent } = createSessionHub(
      'pi',
      'pi-live-user',
    );

    await appendAndBroadcastChatEvents(
      { sessionHub, sessionId: 'pi-live-user' },
      [
        {
          id: 'evt-start',
          sessionId: 'pi-live-user',
          turnId: 'req-1',
          timestamp: Date.now(),
          type: 'turn_start',
          payload: { trigger: 'user' },
        },
        {
          id: 'evt-user',
          sessionId: 'pi-live-user',
          turnId: 'req-1',
          timestamp: Date.now(),
          type: 'user_message',
          payload: { text: 'hello' },
        },
      ],
    );

    expect(appendAssistantEvent).toHaveBeenCalledTimes(1);
    expect(appendAssistantEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'user_message',
        turnId: 'req-1',
        payload: { text: 'hello' },
      }),
    );
    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: { kind: 'request_start', requestId: 'req-1' },
    });
    expect(broadcastToSession.mock.calls[1]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: { kind: 'user_message', requestId: 'req-1', payload: { text: 'hello' } },
    });
  });

  it('broadcasts transcript_event for transient pi tool output', () => {
    const { sessionHub, broadcastToSession } = createSessionHub('pi');

    emitToolOutputChunkEvent({
      sessionHub,
      sessionId: 's1',
      turnId: 'req-1',
      responseId: 'resp-1',
      toolCallId: 'tool-1',
      toolName: 'bash',
      chunk: 'pwd',
      offset: 3,
    });

    expect(broadcastToSession).toHaveBeenCalledTimes(1);
    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: {
        sessionId: 's1',
        requestId: 'req-1',
        kind: 'tool_output',
        toolCallId: 'tool-1',
      },
    });
  });

  it('keeps live transcript sequence stable across ordinary session revision changes', async () => {
    const eventStore = createEventStore();
    const { sessionHub, broadcastToSession, state, appendAssistantEvent } = createSessionHub('pi', 'sequence-reset');

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 'sequence-reset' },
      [
        {
          id: 'evt-a',
          sessionId: 'sequence-reset',
          turnId: 'req-1',
          responseId: 'resp-1',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'before rewrite' },
        },
      ],
    );

    state.summary.revision = 2;

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 'sequence-reset' },
      [
        {
          id: 'evt-b',
          sessionId: 'sequence-reset',
          turnId: 'req-2',
          responseId: 'resp-2',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'after rewrite' },
        },
      ],
    );

    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: { revision: 1, sequence: 0 },
    });
    expect(broadcastToSession.mock.calls[1]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: { revision: 1, sequence: 1 },
    });
    expect(appendAssistantEvent).toHaveBeenCalledTimes(2);
  });

  it('resets live transcript sequence after explicit live transcript invalidation', async () => {
    const eventStore = createEventStore();
    const { sessionHub, broadcastToSession, state } = createSessionHub('pi', 'sequence-reset-explicit');

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 'sequence-reset-explicit' },
      [
        {
          id: 'evt-a',
          sessionId: 'sequence-reset-explicit',
          turnId: 'req-1',
          responseId: 'resp-1',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'before rewrite' },
        },
      ],
    );

    state.summary.revision = 2;
    resetLiveTranscriptSessionState('sequence-reset-explicit');

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 'sequence-reset-explicit' },
      [
        {
          id: 'evt-b',
          sessionId: 'sequence-reset-explicit',
          turnId: 'req-2',
          responseId: 'resp-2',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'after rewrite' },
        },
      ],
    );

    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: { revision: 1, sequence: 0 },
    });
    expect(broadcastToSession.mock.calls[1]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: { revision: 2, sequence: 0 },
    });
  });

  it('carries active request context across live transcript batches', async () => {
    const eventStore = createEventStore();
    const { sessionHub, broadcastToSession } = createSessionHub('pi', 'live-request-context');

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 'live-request-context' },
      [
        {
          id: 'evt-start',
          sessionId: 'live-request-context',
          turnId: 'req-ctx',
          timestamp: Date.now(),
          type: 'turn_start',
          payload: { trigger: 'user' },
        },
      ],
    );

    emitInteractionPendingEvent({
      sessionHub,
      sessionId: 'live-request-context',
      toolCallId: 'tool-ctx',
      toolName: 'questions',
      pending: true,
    });

    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: {
        requestId: 'req-ctx',
        kind: 'request_start',
      },
    });
    expect(broadcastToSession.mock.calls[1]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: {
        requestId: 'req-ctx',
        kind: 'interaction_update',
        toolCallId: 'tool-ctx',
      },
    });
  });

  it('broadcasts transcript_event for non-pi sessions too', async () => {
    const eventStore = createEventStore();
    const { sessionHub, broadcastToSession } = createSessionHub('claude-cli');

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 's1' },
      [
        {
          id: 'evt-1',
          sessionId: 's1',
          turnId: 'turn-1',
          responseId: 'resp-1',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'hello' },
        },
      ],
    );

    expect(broadcastToSession).toHaveBeenCalledTimes(1);
    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: {
        sessionId: 's1',
        eventId: 'evt-1',
        chatEventType: 'assistant_done',
      },
    });
  });
});
