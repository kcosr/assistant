import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../agents';
import type { EventStore } from './eventStore';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import {
  appendAndBroadcastChatEvents,
  emitInteractionPendingEvent,
  emitToolOutputChunkEvent,
  getBufferedLiveTranscriptEvents,
  resetLiveTranscriptSessionState,
  seedLiveTranscriptSessionState,
  syncLiveTranscriptSessionStateFromPiHistory,
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

  it('keeps Pi streaming chunks in the transient live overlay instead of persisting them', async () => {
    const { sessionHub, broadcastToSession, appendAssistantEvent } = createSessionHub(
      'pi',
      'pi-transient-overlay',
    );

    await appendAndBroadcastChatEvents(
      { sessionHub, sessionId: 'pi-transient-overlay' },
      [
        {
          id: 'evt-thinking',
          sessionId: 'pi-transient-overlay',
          turnId: 'req-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'thinking_chunk',
          payload: { text: 'thinking' },
        },
        {
          id: 'evt-assistant',
          sessionId: 'pi-transient-overlay',
          turnId: 'req-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'assistant_chunk',
          payload: { text: 'partial' },
        },
      ],
    );

    expect(appendAssistantEvent).not.toHaveBeenCalled();
    expect(broadcastToSession).toHaveBeenCalledTimes(2);
    expect(
      getBufferedLiveTranscriptEvents({
        sessionId: 'pi-transient-overlay',
        revision: 1,
      }),
    ).toEqual([
      expect.objectContaining({
        requestId: 'req-live',
        chatEventType: 'thinking_chunk',
        sequence: 0,
      }),
      expect.objectContaining({
        requestId: 'req-live',
        chatEventType: 'assistant_chunk',
        sequence: 1,
      }),
    ]);
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

  it('continues live transcript sequencing from a replay-seeded state', async () => {
    const eventStore = createEventStore();
    const { sessionHub, broadcastToSession, state, appendAssistantEvent } = createSessionHub(
      'pi',
      'seeded-live-state',
    );

    seedLiveTranscriptSessionState({
      sessionId: 'seeded-live-state',
      revision: 4,
      nextSequence: 9,
    });
    state.summary.revision = 5;

    await appendAndBroadcastChatEvents(
      { eventStore, sessionHub, sessionId: 'seeded-live-state' },
      [
        {
          id: 'evt-seeded',
          sessionId: 'seeded-live-state',
          turnId: 'req-seeded',
          responseId: 'resp-seeded',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'seeded append' },
        },
      ],
    );

    expect(broadcastToSession).toHaveBeenCalledWith(
      'seeded-live-state',
      expect.objectContaining({
        type: 'transcript_event',
        event: expect.objectContaining({
          revision: 4,
          sequence: 9,
        }),
      }),
    );
    expect(appendAssistantEvent).toHaveBeenCalledTimes(1);
  });

  it('realigns stale Pi live transcript revision and sequence from canonical history', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-live-sync-'));
    const cwd = '/home/kevin';
    const sessionId = 'pi-live-sync';
    const piSessionId = 'pi-live-sync-file';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, `2026-04-02T00-00-00-000Z_${piSessionId}.jsonl`);
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'session',
          version: 3,
          id: piSessionId,
          timestamp: '2026-04-02T00:00:00.000Z',
          cwd,
        }),
        JSON.stringify({
          type: 'custom',
          id: 'req-start',
          parentId: null,
          timestamp: '2026-04-02T00:00:01.000Z',
          customType: 'assistant.request_start',
          data: { v: 1, requestId: 'request-1', trigger: 'user' },
        }),
        JSON.stringify({
          type: 'message',
          id: 'msg-user',
          parentId: 'req-start',
          timestamp: '2026-04-02T00:00:02.000Z',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello there' }],
            timestamp: 1,
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'msg-assistant',
          parentId: 'msg-user',
          timestamp: '2026-04-02T00:00:03.000Z',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi back' }],
            provider: 'openai-codex',
            model: 'gpt-5.4',
            api: 'openai-responses',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'stop',
            timestamp: 2,
          },
        }),
        JSON.stringify({
          type: 'custom',
          id: 'req-end',
          parentId: 'msg-assistant',
          timestamp: '2026-04-02T00:00:04.000Z',
          customType: 'assistant.request_end',
          data: { v: 1, requestId: 'request-1', status: 'completed' },
        }),
      ].join('\n'),
      'utf8',
    );

    const broadcastToSession = vi.fn();
    const appendAssistantEvent = vi.fn(async () => undefined);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi',
        displayName: 'pi',
        description: 'pi',
        chat: {
          provider: 'pi',
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
        revision: 3,
        deleted: false,
        agentId: 'pi',
        attributes: {
          providers: {
            pi: {
              sessionId: piSessionId,
              cwd,
            },
          },
        },
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;
    const latestSummary = {
      ...state.summary,
      revision: 7,
    };
    const sessionHub: SessionHub = {
      getSessionState: vi.fn(() => state),
      getSessionIndex: vi.fn(() => ({
        getSession: vi.fn(async () => latestSummary),
      })),
      getAgentRegistry: vi.fn(() => agentRegistry),
      getPiSessionWriter: vi.fn(() => ({
        appendAssistantEvent,
        getBaseDir: () => baseDir,
      })),
      broadcastToSession,
    } as unknown as SessionHub;

    seedLiveTranscriptSessionState({
      sessionId,
      revision: 3,
      nextSequence: 36,
    });

    try {
      const synced = await syncLiveTranscriptSessionStateFromPiHistory({
        sessionHub,
        sessionId,
        summary: state.summary,
      });

      expect(synced).toMatchObject({ revision: 7 });

      await appendAndBroadcastChatEvents(
        { sessionHub, sessionId },
        [
          {
            id: 'evt-start',
            sessionId,
            turnId: 'request-2',
            timestamp: Date.now(),
            type: 'turn_start',
            payload: { trigger: 'user' },
          },
          {
            id: 'evt-user',
            sessionId,
            turnId: 'request-2',
            timestamp: Date.now(),
            type: 'user_message',
            payload: { text: 'second turn' },
          },
        ],
      );

      expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
        type: 'transcript_event',
        event: {
          revision: 7,
          sequence: 4,
          requestId: 'request-2',
          kind: 'request_start',
        },
      });
      expect(broadcastToSession.mock.calls[1]?.[1]).toMatchObject({
        type: 'transcript_event',
        event: {
          revision: 7,
          sequence: 5,
          requestId: 'request-2',
          kind: 'user_message',
          payload: { text: 'second turn' },
        },
      });
    } finally {
      resetLiveTranscriptSessionState(sessionId);
    }
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
