import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../agents';
import type { EventStore } from './eventStore';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { ProjectedTranscriptEvent } from '@assistant/shared';

import {
  appendAndBroadcastChatEvents,
  emitInteractionPendingEvent,
  emitToolResultEvent,
  emitToolOutputChunkEvent,
  getBufferedLiveTranscriptEvents,
  getLiveTranscriptSequenceWatermark,
  mergeBufferedLiveTranscriptEvents,
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
      attributes:
        provider === 'pi' || provider === 'pi-cli'
          ? {
              providers: {
                [provider]: {
                  transcriptRevision: 1,
                },
              },
            }
          : {},
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

  it('reports the live transcript sequence high-water mark for the active revision', () => {
    seedLiveTranscriptSessionState({
      sessionId: 's-watermark',
      revision: 3,
      nextSequence: 7,
    });

    expect(
      getLiveTranscriptSequenceWatermark({
        sessionId: 's-watermark',
        revision: 3,
      }),
    ).toBe(6);
    expect(
      getLiveTranscriptSequenceWatermark({
        sessionId: 's-watermark',
        revision: 2,
      }),
    ).toBeUndefined();

    resetLiveTranscriptSessionState('s-watermark');
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

  it('broadcasts tool_result payloads with toolName for Pi sessions', async () => {
    const eventStore = createEventStore();
    const { sessionHub, broadcastToSession, appendAssistantEvent } = createSessionHub('pi');

    await emitToolResultEvent({
      eventStore,
      sessionHub,
      sessionId: 's1',
      turnId: 'req-1',
      responseId: 'resp-1',
      toolCallId: 'tool-1',
      toolName: 'agents_message',
      result: { response: '/home/kevin' },
    });

    expect(eventStore.append).not.toHaveBeenCalled();
    expect(appendAssistantEvent).toHaveBeenCalledTimes(1);
    expect(broadcastToSession).toHaveBeenCalledTimes(1);
    expect(broadcastToSession.mock.calls[0]?.[1]).toMatchObject({
      type: 'transcript_event',
      event: {
        sessionId: 's1',
        requestId: 'req-1',
        kind: 'tool_result',
        payload: {
          toolCallId: 'tool-1',
          toolName: 'agents_message',
          result: { response: '/home/kevin' },
        },
      },
    });
  });

  it('merges buffered non-transient live events into Pi replay until canonical history catches up', async () => {
    const { sessionHub } = createSessionHub('pi', 'pi-overlay-catchup');

    await appendAndBroadcastChatEvents(
      { sessionHub, sessionId: 'pi-overlay-catchup' },
      [
        {
          id: 'evt-start',
          sessionId: 'pi-overlay-catchup',
          turnId: 'req-live',
          timestamp: Date.now(),
          type: 'turn_start',
          payload: { trigger: 'user' },
        },
        {
          id: 'evt-user',
          sessionId: 'pi-overlay-catchup',
          turnId: 'req-live',
          timestamp: Date.now(),
          type: 'user_message',
          payload: { text: 'hello' },
        },
        {
          id: 'evt-done',
          sessionId: 'pi-overlay-catchup',
          turnId: 'req-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'hi back' },
        },
        {
          id: 'evt-end',
          sessionId: 'pi-overlay-catchup',
          turnId: 'req-live',
          timestamp: Date.now(),
          type: 'turn_end',
          payload: { status: 'completed' },
        },
      ],
    );

    const canonicalEvents: ProjectedTranscriptEvent[] = [
      {
        sessionId: 'pi-overlay-catchup',
        revision: 1,
        sequence: 0,
        eventId: 'canonical-start',
        kind: 'request_start',
        requestId: 'req-live',
        timestamp: new Date().toISOString(),
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        sessionId: 'pi-overlay-catchup',
        revision: 1,
        sequence: 1,
        eventId: 'canonical-user',
        kind: 'user_message',
        requestId: 'req-live',
        timestamp: new Date().toISOString(),
        chatEventType: 'user_message',
        payload: { text: 'hello' },
      },
    ];

    expect(
      mergeBufferedLiveTranscriptEvents({
        sessionId: 'pi-overlay-catchup',
        revision: 1,
        events: canonicalEvents,
      }).map((event) => `${event.sequence}:${event.kind}:${event.chatEventType}`),
    ).toEqual([
      '0:request_start:turn_start',
      '1:user_message:user_message',
      '2:assistant_message:assistant_done',
      '3:request_end:turn_end',
    ]);
  });

  it('drops buffered Pi overlay events once canonical replay already contains the completed turn', async () => {
    const { sessionHub } = createSessionHub('pi', 'pi-overlay-prune');

    await appendAndBroadcastChatEvents(
      { sessionHub, sessionId: 'pi-overlay-prune' },
      [
        {
          id: 'evt-thinking',
          sessionId: 'pi-overlay-prune',
          turnId: 'req-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'thinking_chunk',
          payload: { text: 'thinking' },
        },
        {
          id: 'evt-assistant',
          sessionId: 'pi-overlay-prune',
          turnId: 'req-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'assistant_chunk',
          payload: { text: 'partial' },
        },
        {
          id: 'evt-done',
          sessionId: 'pi-overlay-prune',
          turnId: 'req-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'assistant_done',
          payload: { text: 'done' },
        },
        {
          id: 'evt-end',
          sessionId: 'pi-overlay-prune',
          turnId: 'req-live',
          timestamp: Date.now(),
          type: 'turn_end',
          payload: { status: 'completed' },
        },
      ],
    );

    const canonicalEvents: ProjectedTranscriptEvent[] = [
      {
        sessionId: 'pi-overlay-prune',
        revision: 1,
        sequence: 2,
        eventId: 'canonical-done',
        kind: 'assistant_message',
        requestId: 'req-live',
        responseId: 'resp-live',
        timestamp: new Date().toISOString(),
        chatEventType: 'assistant_done',
        payload: { text: 'done' },
      },
      {
        sessionId: 'pi-overlay-prune',
        revision: 1,
        sequence: 3,
        eventId: 'canonical-end',
        kind: 'request_end',
        requestId: 'req-live',
        timestamp: new Date().toISOString(),
        chatEventType: 'turn_end',
        payload: { status: 'completed' },
      },
    ];

    expect(
      mergeBufferedLiveTranscriptEvents({
        sessionId: 'pi-overlay-prune',
        revision: 1,
        events: canonicalEvents,
      }),
    ).toEqual(canonicalEvents);
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

  it('does not allow same-revision reseeding to move nextSequence backward', async () => {
    seedLiveTranscriptSessionState({
      sessionId: 'seed-monotonic-same-revision',
      revision: 3,
      nextSequence: 9,
    });

    seedLiveTranscriptSessionState({
      sessionId: 'seed-monotonic-same-revision',
      revision: 3,
      nextSequence: 4,
    });

    expect(
      getBufferedLiveTranscriptEvents({
        sessionId: 'seed-monotonic-same-revision',
        revision: 3,
      }),
    ).toEqual([]);

    const { sessionHub, broadcastToSession } = createSessionHub('pi', 'seed-monotonic-same-revision');
    const state = sessionHub.getSessionState('seed-monotonic-same-revision');
    if (!state) {
      throw new Error('expected seeded session state');
    }
    state.summary.sessionId = 'seed-monotonic-same-revision';
    state.summary.agentId = 'pi';

    try {
      await appendAndBroadcastChatEvents(
        { sessionHub, sessionId: 'seed-monotonic-same-revision' },
        [
          {
            id: 'evt-seed-guard',
            sessionId: 'seed-monotonic-same-revision',
            turnId: 'req-seed-guard',
            timestamp: Date.now(),
            type: 'turn_start',
            payload: { trigger: 'user' },
          },
        ],
      );

      expect(broadcastToSession).toHaveBeenCalledWith(
        'seed-monotonic-same-revision',
        expect.objectContaining({
          type: 'transcript_event',
          event: expect.objectContaining({
            revision: 3,
            sequence: 9,
          }),
        }),
      );
    } finally {
      resetLiveTranscriptSessionState('seed-monotonic-same-revision');
    }
  });

  it('does not reseed live Pi transcript revision on ordinary summary revision bumps', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-live-stable-revision-'));
    const cwd = '/home/kevin';
    const sessionId = 'pi-live-stable-revision';
    const piSessionId = 'pi-live-stable-revision-file';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, `2026-04-02T00-00-00-000Z_${piSessionId}.jsonl`);
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({
          type: 'custom',
          id: 'req-start',
          timestamp: '2026-04-02T00:00:00.000Z',
          customType: 'assistant.request_start',
          data: { v: 1, requestId: 'request-1', trigger: 'user' },
        }),
        JSON.stringify({
          type: 'message',
          id: 'msg-user',
          timestamp: '2026-04-02T00:00:01.000Z',
          message: {
            role: 'user',
            content: [{ type: 'text', text: 'hello' }],
          },
        }),
        JSON.stringify({
          type: 'message',
          id: 'msg-assistant',
          timestamp: '2026-04-02T00:00:02.000Z',
          message: {
            role: 'assistant',
            id: 'response-1',
            content: [{ type: 'text', text: 'reply' }],
          },
        }),
        JSON.stringify({
          type: 'custom',
          id: 'req-end',
          timestamp: '2026-04-02T00:00:03.000Z',
          customType: 'assistant.request_end',
          data: { v: 1, requestId: 'request-1', status: 'completed' },
        }),
      ].join('\n'),
      'utf8',
    );

    const appendAssistantEvent = vi.fn(async (options: { updateAttributes?: (patch: unknown) => Promise<unknown> }) => {
      await options.updateAttributes?.({
        piSessionFile: sessionPath,
        piSessionId,
      });
    });
    const broadcastToSession = vi.fn();
    const agentRegistry = {
      getAgent: vi.fn(() => ({ id: 'agent-pi', chat: { provider: 'pi' } })),
    } as unknown as AgentRegistry;
    const state = {
      summary: {
        sessionId,
        agentId: 'agent-pi',
        revision: 7,
        attributes: {
          providers: {
            pi: { sessionId: piSessionId, cwd, transcriptRevision: 7 },
          },
        },
      },
      chatMessages: [],
    } as unknown as LogicalSessionState;
    const latestSummary = {
      ...state.summary,
      revision: 8,
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
      updateSessionAttributes: vi.fn(async () => latestSummary),
      broadcastToSession,
    } as unknown as SessionHub;

    seedLiveTranscriptSessionState({
      sessionId,
      revision: 7,
      nextSequence: 4,
    });

    try {
      const synced = await syncLiveTranscriptSessionStateFromPiHistory({
        sessionHub,
        sessionId,
        summary: state.summary,
      });

      expect(synced).toMatchObject({ revision: 8 });

      await appendAndBroadcastChatEvents(
        { sessionHub, sessionId },
        [
          {
            id: 'evt-next',
            sessionId,
            turnId: 'request-2',
            responseId: 'response-2',
            timestamp: Date.now(),
            type: 'assistant_done',
            payload: { text: 'next reply' },
          },
        ],
      );

      expect(broadcastToSession).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          type: 'transcript_event',
          event: expect.objectContaining({
            revision: 7,
            sequence: 4,
          }),
        }),
      );
    } finally {
      resetLiveTranscriptSessionState(sessionId);
      await fs.rm(baseDir, { recursive: true, force: true });
    }
  });

  it('does not rewind live Pi sequence when canonical history is shorter than the live high-water mark', async () => {
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-pi-live-no-rewind-'));
    const cwd = '/home/kevin';
    const sessionId = 'pi-live-no-rewind';
    const piSessionId = 'pi-live-no-rewind-file';
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
            content: [{ type: 'text', text: '@mock[interleaved-reasoning-tools]' }],
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
            content: [{ type: 'text', text: 'done' }],
            provider: 'mock-scenarios',
            model: 'scenarios',
            api: 'openai-responses',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
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

    const appendAssistantEvent = vi.fn(async () => undefined);
    const broadcastToSession = vi.fn();
    const agentRegistry = {
      getAgent: vi.fn(() => ({ id: 'agent-pi', chat: { provider: 'pi' } })),
    } as unknown as AgentRegistry;
    const summary = {
      sessionId,
      agentId: 'agent-pi',
      revision: 1,
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd, transcriptRevision: 1 },
        },
      },
    };
    const state = {
      summary,
      chatMessages: [],
    } as unknown as LogicalSessionState;
    const sessionHub: SessionHub = {
      getSessionState: vi.fn(() => state),
      getSessionIndex: vi.fn(() => ({
        getSession: vi.fn(async () => summary),
      })),
      getAgentRegistry: vi.fn(() => agentRegistry),
      getPiSessionWriter: vi.fn(() => ({
        appendAssistantEvent,
        getBaseDir: () => baseDir,
      })),
      updateSessionAttributes: vi.fn(async () => summary),
      broadcastToSession,
    } as unknown as SessionHub;

    seedLiveTranscriptSessionState({
      sessionId,
      revision: 1,
      nextSequence: 5,
    });

    try {
      await syncLiveTranscriptSessionStateFromPiHistory({
        sessionHub,
        sessionId,
        summary,
      });

      await appendAndBroadcastChatEvents(
        { sessionHub, sessionId },
        [
          {
            id: 'evt-next-turn',
            sessionId,
            turnId: 'request-2',
            timestamp: Date.now(),
            type: 'turn_start',
            payload: { trigger: 'user' },
          },
          {
            id: 'evt-next-user',
            sessionId,
            turnId: 'request-2',
            timestamp: Date.now(),
            type: 'user_message',
            payload: { text: 'next question' },
          },
        ],
      );

      expect(broadcastToSession).toHaveBeenNthCalledWith(
        1,
        sessionId,
        expect.objectContaining({
          type: 'transcript_event',
          event: expect.objectContaining({
            revision: 1,
            sequence: 5,
            kind: 'request_start',
          }),
        }),
      );
      expect(broadcastToSession).toHaveBeenNthCalledWith(
        2,
        sessionId,
        expect.objectContaining({
          type: 'transcript_event',
          event: expect.objectContaining({
            revision: 1,
            sequence: 6,
            kind: 'user_message',
          }),
        }),
      );
    } finally {
      resetLiveTranscriptSessionState(sessionId);
      await fs.rm(baseDir, { recursive: true, force: true });
    }
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
              transcriptRevision: 7,
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
      revision: 7,
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
          sequence: 36,
          requestId: 'request-2',
          kind: 'request_start',
        },
      });
      expect(broadcastToSession.mock.calls[1]?.[1]).toMatchObject({
        type: 'transcript_event',
        event: {
          revision: 7,
          sequence: 37,
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
    const providers =
      ((state.summary.attributes as Record<string, unknown> | undefined)?.['providers'] as
        | Record<string, unknown>
        | undefined) ?? {};
    const piProvider = (providers['pi'] as Record<string, unknown> | undefined) ?? {};
    state.summary.attributes = {
      ...(state.summary.attributes ?? {}),
      ['providers']: {
        ...providers,
        ['pi']: {
          ...piProvider,
          transcriptRevision: 2,
        },
      },
    };
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
