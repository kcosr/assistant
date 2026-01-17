import os from 'node:os';
import path from 'node:path';
import { stat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { AgentRegistry } from './agents';
import { SessionHub } from './sessionHub';
import { SessionIndex } from './sessionIndex';
import type { EventStore } from './events';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
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

describe('SessionHub workingDir defaults', () => {
  it('sets core.workingDir from the resolver when missing', async () => {
    const sessionsFile = createTempFile('session-hub-workingdir');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const workingDir = path.join(os.tmpdir(), 'coding-workspace');

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      resolveSessionWorkingDir: () => workingDir,
    });

    await sessionIndex.createSession({ sessionId: 'session-1', agentId: 'general' });
    const state = await sessionHub.ensureSessionState('session-1');

    expect(state.summary.attributes?.core?.workingDir).toBe(workingDir);
    const summary = await sessionIndex.getSession('session-1');
    expect(summary?.attributes?.core?.workingDir).toBe(workingDir);
  });

  it('creates the resolved working directory when missing', async () => {
    const sessionsFile = createTempFile('session-hub-workingdir-create');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const workingDir = createTempDir('session-hub-workspace');

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      resolveSessionWorkingDir: () => workingDir,
    });

    await sessionIndex.createSession({ sessionId: 'session-3', agentId: 'general' });
    await sessionHub.ensureSessionState('session-3');

    const stats = await stat(workingDir);
    expect(stats.isDirectory()).toBe(true);
  });

  it('does not override an existing core.workingDir', async () => {
    const sessionsFile = createTempFile('session-hub-workingdir-existing');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const existingWorkingDir = path.join(os.tmpdir(), 'existing-workspace');

    const session = await sessionIndex.createSession({
      sessionId: 'session-2',
      agentId: 'general',
    });
    await sessionIndex.updateSessionAttributes(session.sessionId, {
      core: { workingDir: existingWorkingDir },
    });

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      resolveSessionWorkingDir: () => path.join(os.tmpdir(), 'new-workspace'),
    });

    const state = await sessionHub.ensureSessionState('session-2');

    expect(state.summary.attributes?.core?.workingDir).toBe(existingWorkingDir);
  });

  it('ensures an existing core.workingDir directory exists', async () => {
    const sessionsFile = createTempFile('session-hub-workingdir-existing-create');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const existingWorkingDir = createTempDir('session-hub-existing-workspace');

    const session = await sessionIndex.createSession({
      sessionId: 'session-4',
      agentId: 'general',
    });
    await sessionIndex.updateSessionAttributes(session.sessionId, {
      core: { workingDir: existingWorkingDir },
    });

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      resolveSessionWorkingDir: () => path.join(os.tmpdir(), 'new-workspace'),
    });

    await sessionHub.ensureSessionState('session-4');

    const stats = await stat(existingWorkingDir);
    expect(stats.isDirectory()).toBe(true);
  });
});
