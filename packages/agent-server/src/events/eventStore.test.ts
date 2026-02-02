import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { ChatEvent } from '@assistant/shared';
import { FileEventStore, SessionScopedEventStore, type EventStore } from './eventStore';
import type { SessionSummary } from '../sessionIndex';
import type { SessionHub } from '../sessionHub';
import { AgentRegistry } from '../agents';

function createTempDataDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

type ChatEventOverrides = Partial<
  Pick<ChatEvent, 'id' | 'timestamp' | 'sessionId' | 'turnId' | 'responseId'>
>;

function createEvent(overrides: ChatEventOverrides = {}): ChatEvent {
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2)}`,
    timestamp: overrides.timestamp ?? Date.now(),
    sessionId: overrides.sessionId ?? 'session-1',
    type: 'user_message',
    payload: {
      text: 'hello',
    },
    ...(overrides.turnId !== undefined ? { turnId: overrides.turnId } : {}),
    ...(overrides.responseId !== undefined ? { responseId: overrides.responseId } : {}),
  };
}

describe('FileEventStore', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = createTempDataDir('event-store');
    await fs.mkdir(dataDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('appends and reads events for a session', async () => {
    const store = new FileEventStore(dataDir);
    const sessionId = 'session-1';

    const event1 = createEvent({ id: 'e1', sessionId });
    const event2 = createEvent({ id: 'e2', sessionId });

    await store.append(sessionId, event1);
    await store.append(sessionId, event2);

    const events = await store.getEvents(sessionId);
    expect(events).toHaveLength(2);
    expect(events[0]?.id).toBe('e1');
    expect(events[1]?.id).toBe('e2');
  });

  it('writes batch events atomically and preserves order', async () => {
    const store = new FileEventStore(dataDir);
    const sessionId = 'session-batch';

    const events: ChatEvent[] = [
      createEvent({ id: 'e1', sessionId }),
      createEvent({ id: 'e2', sessionId }),
      createEvent({ id: 'e3', sessionId }),
    ];

    await store.appendBatch(sessionId, events);

    const filePath = path.join(dataDir, 'sessions', sessionId, 'events.jsonl');
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.trim().split('\n');

    expect(lines).toHaveLength(3);

    const parsedIds = lines.map((line) => JSON.parse(line).id);
    expect(parsedIds).toEqual(['e1', 'e2', 'e3']);

    const loaded = await store.getEvents(sessionId);
    expect(loaded.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('returns empty array when events file does not exist', async () => {
    const store = new FileEventStore(dataDir);
    const events = await store.getEvents('missing-session');
    expect(events).toEqual([]);
  });

  it('returns events after a given cursor id', async () => {
    const store = new FileEventStore(dataDir);
    const sessionId = 'session-pagination';

    const e1 = createEvent({ id: 'e1', sessionId });
    const e2 = createEvent({ id: 'e2', sessionId });
    const e3 = createEvent({ id: 'e3', sessionId });

    await store.appendBatch(sessionId, [e1, e2, e3]);

    const afterE1 = await store.getEventsSince(sessionId, 'e1');
    expect(afterE1.map((e) => e.id)).toEqual(['e2', 'e3']);

    const afterMissing = await store.getEventsSince(sessionId, 'missing-id');
    expect(afterMissing.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);

    const fromStart = await store.getEventsSince(sessionId, '');
    expect(fromStart.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('subscribes to new events for a session', async () => {
    const store = new FileEventStore(dataDir);
    const sessionId = 'session-subscribe';

    const received: ChatEvent[] = [];
    const unsubscribe = store.subscribe(sessionId, (event) => {
      received.push(event);
    });

    const e1 = createEvent({ id: 'e1', sessionId });
    const e2 = createEvent({ id: 'e2', sessionId });

    await store.append(sessionId, e1);
    await store.append(sessionId, e2);

    expect(received.map((e) => e.id)).toEqual(['e1', 'e2']);

    unsubscribe();

    const e3 = createEvent({ id: 'e3', sessionId });
    await store.append(sessionId, e3);

    expect(received.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('validates events against schema on append', async () => {
    const store = new FileEventStore(dataDir);
    const sessionId = 'session-validate';

    const invalidEvent = {
      id: 'e1',
      timestamp: Date.now(),
      sessionId,
      type: 'user_message',
      payload: {},
    } as unknown as ChatEvent;

    await expect(store.append(sessionId, invalidEvent)).rejects.toThrow();
  });

  it('rejects events whose sessionId does not match target session', async () => {
    const store = new FileEventStore(dataDir);
    const sessionId = 'session-1';

    const event = createEvent({ id: 'e1', sessionId: 'other-session' });

    await expect(store.append(sessionId, event)).rejects.toThrow(/does not match target session/i);

    const events = await store.getEvents(sessionId);
    expect(events).toEqual([]);
  });

  it('skips malformed or invalid lines when reading events', async () => {
    const store = new FileEventStore(dataDir);
    const sessionId = 'session-parse';

    const filePath = path.join(dataDir, 'sessions', sessionId, 'events.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const validEvent = createEvent({ id: 'e1', sessionId });
    const malformedLine = '{not-json';
    const invalidEvent = {
      id: 'e2',
      timestamp: Date.now(),
      sessionId,
      type: 'user_message',
      payload: {},
    };

    const lines = [JSON.stringify(validEvent), malformedLine, JSON.stringify(invalidEvent)];
    await fs.writeFile(filePath, lines.join('\n') + '\n', 'utf8');

    const events = await store.getEvents(sessionId);
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe('e1');
  });
});

describe('SessionScopedEventStore', () => {
  it('skips persistence for pi-cli sessions', async () => {
    const summaries = new Map<string, SessionSummary>([
      [
        'pi-session',
        {
          sessionId: 'pi-session',
          agentId: 'pi',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          attributes: {
            providers: {
              'pi-cli': {
                sessionId: 'pi-session-id',
                cwd: '/home/pi',
              },
            },
          },
        },
      ],
      [
        'codex-session',
        {
          sessionId: 'codex-session',
          agentId: 'codex',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    ]);

    const sessionHub = {
      getSessionState: () => undefined,
      getSessionIndex: () => ({
        getSession: async (sessionId: string) => summaries.get(sessionId),
      }),
      getAgentRegistry: () =>
        new AgentRegistry([
          {
            agentId: 'pi',
            displayName: 'Pi',
            description: 'Pi CLI',
            chat: { provider: 'pi-cli' },
          },
          {
            agentId: 'codex',
            displayName: 'Codex',
            description: 'Codex CLI',
            chat: { provider: 'codex-cli' },
          },
        ]),
      shouldPersistSessionEvents: (summary: SessionSummary) => {
        const attributes = summary.attributes as Record<string, unknown> | undefined;
        const providers = attributes?.['providers'] as Record<string, unknown> | undefined;
        const providerEntry = providers?.['pi-cli'] ?? providers?.['pi'];
        const hasExternalInfo =
          providerEntry && typeof providerEntry === 'object' && !Array.isArray(providerEntry);
        return summary.agentId !== 'pi' || !hasExternalInfo;
      },
    } as unknown as SessionHub;

    const baseStore: EventStore = {
      append: vi.fn(async () => undefined),
      appendBatch: vi.fn(async () => undefined),
      getEvents: vi.fn(async () => []),
      getEventsSince: vi.fn(async () => []),
      subscribe: vi.fn(() => () => undefined),
      clearSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(async () => undefined),
    };

    const store = new SessionScopedEventStore(baseStore, sessionHub);

    const piEvent = createEvent({ id: 'e-pi', sessionId: 'pi-session' });
    await store.append('pi-session', piEvent);
    expect(baseStore.append).not.toHaveBeenCalled();

    const piInteraction: ChatEvent = {
      id: 'i-1',
      timestamp: Date.now(),
      sessionId: 'pi-session',
      type: 'interaction_request',
      payload: {
        toolCallId: 'call-1',
        toolName: 'questions_ask',
        interactionId: 'interaction-1',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'Quick question',
          fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
        },
      },
    };
    await store.append('pi-session', piInteraction);
    expect(baseStore.append).toHaveBeenCalledWith('pi-session', piInteraction);

    const piPending: ChatEvent = {
      id: 'i-2',
      timestamp: Date.now(),
      sessionId: 'pi-session',
      type: 'interaction_pending',
      payload: {
        toolCallId: 'call-1',
        toolName: 'questions_ask',
        pending: true,
        presentation: 'questionnaire',
      },
    };
    await store.append('pi-session', piPending);
    expect(baseStore.append).toHaveBeenCalledWith('pi-session', piPending);

    const codexEvent = createEvent({ id: 'e-codex', sessionId: 'codex-session' });
    await store.append('codex-session', codexEvent);
    expect(baseStore.append).toHaveBeenCalledWith('codex-session', codexEvent);
  });
});
