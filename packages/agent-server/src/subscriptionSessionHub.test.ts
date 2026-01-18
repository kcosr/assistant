import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '@assistant/shared';

import { SessionHub } from './sessionHub';
import { SessionIndex } from './sessionIndex';
import { AgentRegistry } from './agents';
import type { SessionConnection } from './ws/sessionConnection';
import type { EventStore } from './events';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

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

function createTestEventStore(): EventStore {
  return {
    append: async () => {},
    appendBatch: async () => {},
    getEvents: async () => [],
    getEventsSince: async () => [],
    subscribe: () => () => {},
    clearSession: async () => {},
    deleteSession: async () => {},
  };
}

describe('SessionHub subscription helpers', () => {
  it('subscribeConnection ensures session state and tracks subscriptions', async () => {
    const sessionsFile = createTempFile('session-hub-subscribe-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    const summary = await sessionIndex.createSession({ agentId: 'general' });
    const { connection } = createTestConnection();

    const state = await sessionHub.subscribeConnection(connection, summary.sessionId);

    expect(state.summary.sessionId).toBe(summary.sessionId);

    const subscriptions = sessionHub.getConnectionSubscriptions(connection);
    expect(Array.from(subscriptions)).toEqual([summary.sessionId]);
  });

  it('unsubscribeConnection removes a single subscription', async () => {
    const sessionsFile = createTempFile('session-hub-unsubscribe-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });
    const { connection } = createTestConnection();

    await sessionHub.subscribeConnection(connection, sessionA.sessionId);
    await sessionHub.subscribeConnection(connection, sessionB.sessionId);

    sessionHub.unsubscribeConnection(connection, sessionA.sessionId);

    const subscriptions = Array.from(sessionHub.getConnectionSubscriptions(connection));
    expect(subscriptions).toEqual([sessionB.sessionId]);
  });

  it('detachConnectionFromAllSessions clears all subscriptions', async () => {
    const sessionsFile = createTempFile('session-hub-detach-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });
    const { connection, sendServerMessageFromHub } = createTestConnection();

    await sessionHub.subscribeConnection(connection, sessionA.sessionId);
    await sessionHub.subscribeConnection(connection, sessionB.sessionId);

    sessionHub.detachConnectionFromAllSessions(connection);

    expect(Array.from(sessionHub.getConnectionSubscriptions(connection))).toEqual([]);

    const message: ServerMessage = { type: 'session_deleted', sessionId: sessionA.sessionId };
    sessionHub.broadcastToSession(sessionA.sessionId, message);
    expect(sendServerMessageFromHub).not.toHaveBeenCalled();
  });

  it('evicts least recently used sessions without active runs or connections', async () => {
    const sessionsFile = createTempFile('session-hub-evict-lru-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      maxCachedSessions: 2,
    });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });
    const sessionC = await sessionIndex.createSession({ agentId: 'general' });

    await sessionHub.ensureSessionState(sessionA.sessionId);
    await sessionHub.ensureSessionState(sessionB.sessionId);
    await sessionHub.ensureSessionState(sessionC.sessionId);

    expect(sessionHub.getSessionState(sessionA.sessionId)).toBeUndefined();
    expect(sessionHub.getSessionState(sessionB.sessionId)).toBeDefined();
    expect(sessionHub.getSessionState(sessionC.sessionId)).toBeDefined();

    // Evicted sessions are reloaded on access.
    const reloaded = await sessionHub.ensureSessionState(sessionA.sessionId);
    expect(reloaded.summary.sessionId).toBe(sessionA.sessionId);
    expect(sessionHub.getSessionState(sessionA.sessionId)).toBeDefined();
  });

  it('does not evict sessions with active chat runs', async () => {
    const sessionsFile = createTempFile('session-hub-evict-active-run-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      maxCachedSessions: 1,
    });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });

    const stateA = await sessionHub.ensureSessionState(sessionA.sessionId);
    stateA.activeChatRun = {
      responseId: 'r1',
      abortController: new AbortController(),
      accumulatedText: '',
    };

    await sessionHub.ensureSessionState(sessionB.sessionId);

    const stateAfter = sessionHub.getSessionState(sessionA.sessionId);
    expect(stateAfter).toBeDefined();
    expect(stateAfter?.activeChatRun).toBeDefined();
  });

  it('does not evict sessions with active connections', async () => {
    const sessionsFile = createTempFile('session-hub-evict-connected-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      maxCachedSessions: 1,
    });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });
    const { connection } = createTestConnection();

    await sessionHub.subscribeConnection(connection, sessionA.sessionId);
    await sessionHub.ensureSessionState(sessionB.sessionId);

    expect(sessionHub.getSessionState(sessionA.sessionId)).toBeDefined();
  });
});
