import os from 'node:os';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { AgentRegistry } from './agents';
import { AttachmentStore } from './attachments/store';
import { SessionHub } from './sessionHub';
import { SessionIndex } from './sessionIndex';
import type { EventStore } from './events';
import { PiSessionWriter } from './history/piSessionWriter';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

function encodePiCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
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

  it('passes session summary to the resolver so agent-specific fixed directories can be applied', async () => {
    const sessionsFile = createTempFile('session-hub-workingdir-agent-aware');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const assistantDir = path.join(os.tmpdir(), 'assistant-workspace');

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      resolveSessionWorkingDir: (summary) =>
        summary.agentId === 'assistant' ? assistantDir : null,
    });

    await sessionIndex.createSession({ sessionId: 'session-fixed-1', agentId: 'assistant' });
    const state = await sessionHub.ensureSessionState('session-fixed-1');

    expect(state.summary.attributes?.core?.workingDir).toBe(assistantDir);
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

describe('SessionHub clearSession', () => {
  it('clears provider history metadata and Pi session file', async () => {
    const sessionsFile = createTempFile('session-hub-clear');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const baseDir = createTempDir('pi-sessions');
    const piSessionWriter = new PiSessionWriter({ baseDir });

    const session = await sessionIndex.createSession({
      sessionId: 'session-clear-1',
      agentId: 'general',
    });
    await sessionIndex.updateSessionAttributes(session.sessionId, {
      providers: {
        pi: {
          sessionId: 'pi-session-1',
          cwd: '/home/kevin',
        },
      },
    });

    const encoded = encodePiCwd('/home/kevin');
    const sessionDir = path.join(baseDir, encoded);
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(
      sessionDir,
      `2026-02-04T00-00-00-000Z_pi-session-1.jsonl`,
    );
    await fs.writeFile(sessionFile, '{"type":"session"}\n', 'utf8');

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      piSessionWriter,
    });

    await sessionHub.clearSession(session.sessionId);

    await expect(fs.stat(sessionFile)).rejects.toThrow();
    const updated = await sessionIndex.getSession(session.sessionId);
    expect(updated?.attributes?.['providers']).toBeUndefined();
  });

  it('deletes Pi session file when deleting a session', async () => {
    const sessionsFile = createTempFile('session-hub-delete');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const baseDir = createTempDir('pi-sessions-delete');
    const piSessionWriter = new PiSessionWriter({ baseDir });

    const session = await sessionIndex.createSession({
      sessionId: 'session-delete-1',
      agentId: 'general',
    });
    await sessionIndex.updateSessionAttributes(session.sessionId, {
      providers: {
        pi: {
          sessionId: 'pi-session-delete-1',
          cwd: '/home/kevin',
        },
      },
    });

    const encoded = encodePiCwd('/home/kevin');
    const sessionDir = path.join(baseDir, encoded);
    await fs.mkdir(sessionDir, { recursive: true });
    const sessionFile = path.join(
      sessionDir,
      '2026-02-04T00-00-00-000Z_pi-session-delete-1.jsonl',
    );
    await fs.writeFile(sessionFile, '{"type":"session"}\n', 'utf8');

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      piSessionWriter,
    });

    await sessionHub.deleteSession(session.sessionId);

    await expect(fs.stat(sessionFile)).rejects.toThrow();
  });

  it('rewrites Pi history for turn edits and clears stale context usage', async () => {
    const sessionsFile = createTempFile('session-hub-edit-history');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-agent',
        displayName: 'Pi Agent',
        description: 'Pi-backed agent',
        chat: { provider: 'pi' },
      },
    ]);
    const baseDir = createTempDir('pi-sessions-edit');
    const piSessionWriter = new PiSessionWriter({ baseDir, log: () => undefined });

    const session = await sessionIndex.createSession({
      sessionId: 'session-edit-history',
      agentId: 'pi-agent',
    });
    const summaryWithDir =
      (await sessionIndex.updateSessionAttributes(session.sessionId, {
        core: { workingDir: '/tmp/project' },
      })) ?? session;
    await sessionIndex.setSessionContextUsage(session.sessionId, {
      availablePercent: 50,
      contextWindow: 200000,
      usage: {
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 150,
      },
    });

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      piSessionWriter,
    });

    let summary =
      (await sessionIndex.getSession(session.sessionId)) ?? summaryWithDir;

    await piSessionWriter.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
      ],
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'turn-1',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });

    summary = (await sessionIndex.getSession(session.sessionId)) ?? summary;
    await piSessionWriter.appendTurnStart({
      summary,
      turnId: 'turn-2',
      trigger: 'user',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
        { role: 'user', content: 'second turn' },
        { role: 'assistant', content: 'Second reply' },
      ],
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'turn-2',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });

    const result = await sessionHub.editSessionHistory({
      sessionId: session.sessionId,
      action: 'trim_before',
      requestId: 'turn-2',
    });

    expect(result.changed).toBe(true);
    const updated = await sessionIndex.getSession(session.sessionId);
    expect(updated?.contextUsage).toBeUndefined();

    const encoded = encodePiCwd('/tmp/project');
    const sessionDir = path.join(baseDir, encoded);
    const files = await fs.readdir(sessionDir);
    const sessionFile = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(sessionFile, 'utf8');
    expect(content).not.toContain('first turn');
    expect(content).toContain('second turn');
  });

  it('rejects request history edits for non-Pi sessions', async () => {
    const sessionsFile = createTempFile('session-hub-edit-history-non-pi');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
      },
    ]);

    const session = await sessionIndex.createSession({
      sessionId: 'session-edit-history-non-pi',
      agentId: 'general',
    });

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    await expect(
      sessionHub.editSessionHistory({
        sessionId: session.sessionId,
        action: 'delete_request',
        requestId: 'turn-1',
      }),
    ).rejects.toThrow('Request history edits are only supported for Pi-backed sessions');
  });

  it('deletes session attachments on clearSession', async () => {
    const sessionsFile = createTempFile('session-hub-clear-attachments');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const attachmentDir = createTempDir('session-hub-attachments');
    const attachmentStore = new AttachmentStore(attachmentDir);

    const session = await sessionIndex.createSession({
      sessionId: 'session-clear-attachments',
      agentId: 'general',
    });
    await attachmentStore.createAttachment({
      sessionId: session.sessionId,
      requestId: 'turn-1',
      toolCallId: 'tool-1',
      fileName: 'note.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('hello', 'utf8'),
    });

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      attachmentStore,
    });

    await sessionHub.clearSession(session.sessionId);

    await expect(stat(path.join(attachmentDir, session.sessionId))).rejects.toThrow();
  });

  it('deletes dropped-request attachments during history edits', async () => {
    const sessionsFile = createTempFile('session-hub-edit-history-attachments');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-agent',
        displayName: 'Pi Agent',
        description: 'Pi-backed agent',
        chat: { provider: 'pi' },
      },
    ]);
    const baseDir = createTempDir('pi-sessions-edit-attachments');
    const attachmentDir = createTempDir('session-hub-history-attachments');
    const piSessionWriter = new PiSessionWriter({ baseDir, log: () => undefined });
    const attachmentStore = new AttachmentStore(attachmentDir);

    const session = await sessionIndex.createSession({
      sessionId: 'session-edit-history-attachments',
      agentId: 'pi-agent',
    });
    const summaryWithDir =
      (await sessionIndex.updateSessionAttributes(session.sessionId, {
        core: { workingDir: '/tmp/project' },
      })) ?? session;

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      piSessionWriter,
      attachmentStore,
    });

    let summary = (await sessionIndex.getSession(session.sessionId)) ?? summaryWithDir;
    await piSessionWriter.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
      ],
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'turn-1',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await attachmentStore.createAttachment({
      sessionId: session.sessionId,
      requestId: 'turn-1',
      toolCallId: 'tool-1',
      fileName: 'first.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('first', 'utf8'),
    });

    summary = (await sessionIndex.getSession(session.sessionId)) ?? summary;
    await piSessionWriter.appendTurnStart({
      summary,
      turnId: 'turn-2',
      trigger: 'user',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
        { role: 'user', content: 'second turn' },
        { role: 'assistant', content: 'Second reply' },
      ],
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'turn-2',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(session.sessionId, patch),
    });
    const kept = await attachmentStore.createAttachment({
      sessionId: session.sessionId,
      requestId: 'turn-2',
      toolCallId: 'tool-2',
      fileName: 'second.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('second', 'utf8'),
    });

    const result = await sessionHub.editSessionHistory({
      sessionId: session.sessionId,
      action: 'trim_before',
      requestId: 'turn-2',
    });

    expect(result.droppedRequestIds).toEqual(['turn-1']);
    expect(await attachmentStore.getAttachment(session.sessionId, kept.attachmentId)).not.toBeNull();
    const metadataPath = path.join(attachmentDir, session.sessionId, 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8')) as {
      attachments: Array<{ requestId: string }>;
    };
    expect(metadata.attachments).toHaveLength(1);
    expect(metadata.attachments[0]?.requestId).toBe('turn-2');
  });
});

describe('SessionHub loadSessionEvents', () => {
  it('loads Pi session history directly from the canonical Pi session file', async () => {
    const sessionsFile = createTempFile('session-hub-load-events');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-agent',
        displayName: 'Pi Agent',
        description: 'Pi-backed agent',
        chat: { provider: 'pi' },
      },
    ]);
    const baseDir = createTempDir('pi-sessions-load-events');
    const piSessionWriter = new PiSessionWriter({ baseDir, log: () => undefined });

    const session = await sessionIndex.createSession({
      sessionId: 'session-load-events',
      agentId: 'pi-agent',
    });
    let summary =
      (await sessionIndex.updateSessionAttributes(session.sessionId, {
        core: { workingDir: '/tmp/project-load-events' },
      })) ?? session;

    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
      piSessionWriter,
    });

    summary =
      (await piSessionWriter.appendTurnStart({
        summary,
        turnId: 'request-1',
        trigger: 'user',
        updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
      })) ?? summary;
    summary =
      (await piSessionWriter.sync({
        summary,
        messages: [
          { role: 'system', content: 'system' },
          { role: 'user', content: 'First request' },
          { role: 'assistant', content: 'First reply' },
        ],
        updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
      })) ?? summary;
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'request-1',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
    });

    const reloadedSummary = await sessionIndex.getSession(session.sessionId);
    if (!reloadedSummary) {
      throw new Error('Expected session summary to exist');
    }

    const events = await sessionHub.loadSessionEvents(reloadedSummary, true);

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn_start',
          turnId: 'request-1',
        }),
        expect.objectContaining({
          type: 'user_message',
          payload: expect.objectContaining({ text: 'First request' }),
        }),
        expect.objectContaining({
          type: 'assistant_done',
          payload: expect.objectContaining({ text: 'First reply' }),
        }),
        expect.objectContaining({
          type: 'turn_end',
          turnId: 'request-1',
        }),
      ]),
    );
  });
});
