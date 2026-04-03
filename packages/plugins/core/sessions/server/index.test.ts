import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CombinedPluginManifest, SessionReplayResponse } from '@assistant/shared';
import { AgentRegistry } from '../../../../agent-server/src/agents';
import type { ChatCompletionMessage } from '../../../../agent-server/src/chatCompletionTypes';
import {
  appendAndBroadcastChatEvents,
  resetLiveTranscriptSessionState,
  seedLiveTranscriptSessionState,
} from '../../../../agent-server/src/events/chatEventUtils';
import { getPiTranscriptRevision } from '../../../../agent-server/src/history/piTranscriptRevision';
import type { SessionSummary } from '../../../../agent-server/src/sessionIndex';
import { PiSessionWriter } from '../../../../agent-server/src/history/piSessionWriter';
import { SessionHub } from '../../../../agent-server/src/sessionHub';
import { SessionIndex } from '../../../../agent-server/src/sessionIndex';
import * as sessionMessagesModule from '../../../../agent-server/src/sessionMessages';
import type { ToolContext } from '../../../../agent-server/src/tools';
import manifestJson from '../manifest.json';
import { createPlugin } from './index';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('sessions plugin operations', () => {
  it('advertises audio submit fields in the message operation schema', () => {
    const operations = (manifestJson as CombinedPluginManifest).operations ?? [];
    const messageOperation = operations.find((operation) => operation.id === 'message') as
      | { inputSchema?: Record<string, unknown> }
      | undefined;
    const inputSchema = messageOperation?.inputSchema as
      | {
          properties?: Record<string, unknown>;
          allOf?: unknown[];
        }
      | undefined;
    const properties = inputSchema?.properties ?? {};

    expect(properties['inputType']).toEqual(
      expect.objectContaining({
        enum: ['text', 'audio'],
      }),
    );
    expect(properties['durationMs']).toEqual(
      expect.objectContaining({
        type: 'integer',
        minimum: 0,
      }),
    );
    expect(inputSchema?.allOf).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          then: expect.objectContaining({
            required: ['durationMs'],
          }),
        }),
      ]),
    );
  });

  it('broadcasts session_created when creating a new session', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const broadcastSpy = vi.spyOn(sessionHub, 'broadcastSessionCreated');

    const result = await plugin.operations?.create({ agentId: 'general' }, ctx);

    expect(result).toEqual(expect.objectContaining({ sessionId: expect.any(String) }));
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: (result as { sessionId: string }).sessionId }),
    );
  });

  it('sets core.workingDir when provided at create time', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const workingDir = path.join(os.tmpdir(), 'sessions-plugin-workdir');

    const result = await plugin.operations?.create(
      { agentId: 'general', sessionConfig: { workingDir } },
      ctx,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sessionId: expect.any(String),
        attributes: { core: { workingDir } },
      }),
    );
  });

  it('persists model, thinking, title, and working dir from sessionConfig', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-config'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
        chat: {
          models: ['gpt-5.4', 'gpt-5.4-mini'],
          thinking: ['low', 'medium'],
        },
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const result = (await plugin.operations?.create(
      {
        agentId: 'general',
        sessionConfig: {
          model: 'gpt-5.4-mini',
          thinking: 'medium',
          workingDir: '/tmp/project',
          sessionTitle: 'Project Session',
        },
      },
      ctx,
    )) as SessionSummary;

    expect(result).toEqual(
      expect.objectContaining({
        name: 'Project Session',
        model: 'gpt-5.4-mini',
        thinking: 'medium',
        attributes: { core: { workingDir: '/tmp/project' } },
      }),
    );
  });

  it('replaces editable session config fields on update', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-update-config'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
        chat: {
          models: ['gpt-5.4', 'gpt-5.4-mini'],
          thinking: ['low', 'medium'],
        },
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const created = (await plugin.operations?.create(
      {
        agentId: 'general',
        sessionConfig: {
          model: 'gpt-5.4-mini',
          thinking: 'medium',
          workingDir: '/tmp/project',
          sessionTitle: 'Project Session',
        },
      },
      ctx,
    )) as SessionSummary;

    const updated = (await plugin.operations?.update(
      {
        sessionId: created.sessionId,
        sessionConfig: {
          thinking: 'low',
        },
      },
      ctx,
    )) as SessionSummary;

    expect(updated).toEqual(
      expect.objectContaining({
        sessionId: created.sessionId,
        thinking: 'low',
      }),
    );
    expect(updated.name).toBeUndefined();
    expect(updated.model).toBeUndefined();
    expect(updated.attributes?.core?.workingDir).toBeUndefined();
  });

  it('mirrors session rename into Pi session JSONL via session_info entries (pi provider)', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-rename'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-agent',
        displayName: 'Pi Agent',
        description: 'Pi-backed agent',
        chat: { provider: 'pi' },
      },
    ]);

    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-plugin-pi-jsonl-'));
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const piSessionWriter = new PiSessionWriter({ baseDir, now, log: () => {} });
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, piSessionWriter });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const workingDir = '/tmp/project';
    const created = (await plugin.operations?.create(
      { agentId: 'pi-agent', sessionConfig: { workingDir } },
      ctx,
    )) as SessionSummary;

    const renamed = (await plugin.operations?.update(
      { sessionId: created.sessionId, name: 'My Session' },
      ctx,
    )) as SessionSummary;

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'assistant', content: 'Hello' },
    ];

    await piSessionWriter.sync({
      summary: renamed,
      messages,
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(renamed.sessionId, patch),
    });

    const encodedCwd = `--${workingDir.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);
    const filePath = path.join(sessionDir, files[0]!);

    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);
    expect(
      entries.some((entry) => entry['type'] === 'session_info' && entry['name'] === 'My Session'),
    ).toBe(true);
  });

  it('mirrors session rename into Pi session JSONL via session_info entries (pi-cli provider)', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-rename-pi-cli'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-cli-agent',
        displayName: 'Pi CLI Agent',
        description: 'Pi CLI-backed agent',
        chat: { provider: 'pi-cli' },
      },
    ]);

    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-plugin-pi-cli-jsonl-'));
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const piSessionWriter = new PiSessionWriter({ baseDir, now, log: () => {} });
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, piSessionWriter });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const workingDir = '/tmp/project';
    const created = (await plugin.operations?.create(
      { agentId: 'pi-cli-agent', sessionConfig: { workingDir } },
      ctx,
    )) as SessionSummary;

    // Seed a Pi session id mapping and create a flushed file so the writer can append immediately.
    const piCliSessionId = 'pi-cli-session-1';
    const seeded = await sessionHub.updateSessionAttributes(created.sessionId, {
      providers: {
        'pi-cli': {
          sessionId: piCliSessionId,
          cwd: workingDir,
        },
      },
    });
    expect(seeded).toBeTruthy();

    await piSessionWriter.sync({
      summary: seeded!,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'Hello' },
      ],
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(created.sessionId, patch),
    });

    await plugin.operations?.update({ sessionId: created.sessionId, name: 'CLI Session' }, ctx);

    const encodedCwd = `--${workingDir.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);
    const filePath = path.join(sessionDir, files[0]!);

    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);
    expect(
      entries.some((entry) => entry['type'] === 'session_info' && entry['name'] === 'CLI Session'),
    ).toBe(true);
  });

  it('edits Pi-backed session history at explicit request boundaries', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-history-edit'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-agent',
        displayName: 'Pi Agent',
        description: 'Pi-backed agent',
        chat: { provider: 'pi' },
      },
    ]);
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-plugin-history-edit-'));
    const piSessionWriter = new PiSessionWriter({ baseDir, log: () => undefined });
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, piSessionWriter });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    let summary = (await plugin.operations?.create(
      { agentId: 'pi-agent', sessionConfig: { workingDir: '/tmp/project' } },
      ctx,
    )) as SessionSummary;

    await piSessionWriter.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
    });
    await piSessionWriter.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
      ],
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
    });
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'turn-1',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
    });

    summary = (await sessionIndex.getSession(summary.sessionId)) ?? summary;
    await piSessionWriter.appendTurnStart({
      summary,
      turnId: 'turn-2',
      trigger: 'user',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
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
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
    });
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'turn-2',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
    });

    const result = await plugin.operations?.['history-edit'](
      {
        sessionId: summary.sessionId,
        action: 'trim_before',
        requestId: 'turn-2',
      },
      ctx,
    );

    expect(result).toEqual({
      sessionId: summary.sessionId,
      action: 'trim_before',
      requestId: 'turn-2',
      changed: true,
      updatedAt: expect.any(String),
      revision: expect.any(Number),
    });
  });

  it('projects session replay events with request-group metadata and cursors', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-events'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
      historyProvider: {
        getHistory: vi.fn(async () => [
          {
            id: 'turn-1',
            timestamp: 1000,
            sessionId: 'session-1',
            turnId: 'turn-1',
            type: 'turn_start',
            payload: { trigger: 'user' },
          },
          {
            id: 'assistant-1',
            timestamp: 1001,
            sessionId: 'session-1',
            turnId: 'turn-1',
            type: 'assistant_done',
            payload: { text: 'Hello' },
          },
        ]),
      },
    } as ToolContext;

    const created = (await plugin.operations?.create(
      { agentId: 'general', sessionConfig: { workingDir: '/tmp/project' } },
      ctx,
    )) as SessionSummary;

    const result = (await plugin.operations?.events(
      { sessionId: created.sessionId, force: true },
      ctx,
    )) as {
      sessionId: string;
      revision: number;
      reset: boolean;
      nextCursor?: string;
      events: Array<Record<string, unknown>>;
    };

    expect(result.sessionId).toBe(created.sessionId);
    expect(result.revision).toEqual(expect.any(Number));
    expect(result.reset).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toEqual(
      expect.objectContaining({
        sessionId: created.sessionId,
        requestId: 'turn-1',
        kind: 'request_start',
        chatEventType: 'turn_start',
        payload: expect.objectContaining({
          trigger: 'user',
        }),
      }),
    );
  });

  it('loads Pi replay events directly from canonical Pi session history', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-events-pi'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-agent',
        displayName: 'Pi Agent',
        description: 'Pi-backed agent',
        chat: { provider: 'pi' },
      },
    ]);
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-plugin-events-pi-'));
    const piSessionWriter = new PiSessionWriter({ baseDir, log: () => undefined });
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, piSessionWriter });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    } as ToolContext;

    const created = (await plugin.operations?.create(
      { agentId: 'pi-agent', sessionConfig: { workingDir: '/tmp/project' } },
      ctx,
    )) as SessionSummary;

    let summary = created;
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
          { role: 'user', content: 'Hello from Pi' },
          { role: 'assistant', content: 'Pi reply' },
        ],
        updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
      })) ?? summary;
    await piSessionWriter.appendTurnEnd({
      summary,
      turnId: 'request-1',
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
    });

    const bumpedSummary = await sessionHub.recordSessionActivity(created.sessionId, 'pi replay revision bump');
    const result = (await plugin.operations?.events(
      { sessionId: created.sessionId, force: true },
      ctx,
    )) as SessionReplayResponse;

    expect(result.sessionId).toBe(created.sessionId);
    expect(result.reset).toBe(true);
    expect(result.revision).toBe(getPiTranscriptRevision(bumpedSummary?.attributes));
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: 'request-1',
          kind: 'request_start',
        }),
        expect.objectContaining({
          requestId: 'request-1',
          kind: 'user_message',
          chatEventType: 'user_message',
          payload: expect.objectContaining({ text: 'Hello from Pi' }),
        }),
        expect.objectContaining({
          requestId: 'request-1',
          kind: 'assistant_message',
          chatEventType: 'assistant_done',
          payload: expect.objectContaining({ text: 'Pi reply' }),
        }),
      ]),
    );
  });

  it('merges transient live Pi chunks into replay without persisting them to the Pi log', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-events-pi-live'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'pi-agent',
        displayName: 'Pi Agent',
        description: 'Pi-backed agent',
        chat: { provider: 'pi' },
      },
    ]);
    const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sessions-plugin-events-pi-live-'));
    const piSessionWriter = new PiSessionWriter({ baseDir, log: () => undefined });
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry, piSessionWriter });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    } as ToolContext;

    const created = (await plugin.operations?.create(
      { agentId: 'pi-agent', sessionConfig: { workingDir: '/tmp/project' } },
      ctx,
    )) as SessionSummary;

    let summary = created;
    summary =
      (await piSessionWriter.appendTurnStart({
        summary,
        turnId: 'request-live',
        trigger: 'user',
        updateAttributes: (patch) => sessionHub.updateSessionAttributes(summary.sessionId, patch),
      })) ?? summary;
    const liveRevision = getPiTranscriptRevision(summary.attributes);
    seedLiveTranscriptSessionState({
      sessionId: created.sessionId,
      revision: liveRevision,
      nextSequence: 1,
      activeRequestId: 'request-live',
    });

    await appendAndBroadcastChatEvents(
      { sessionHub, sessionId: created.sessionId },
      [
        {
          id: 'user-live',
          sessionId: created.sessionId,
          turnId: 'request-live',
          timestamp: Date.now(),
          type: 'user_message',
          payload: { text: 'stream this reply' },
        },
        {
          id: 'thinking-live',
          sessionId: created.sessionId,
          turnId: 'request-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'thinking_chunk',
          payload: { text: 'Thinking…' },
        },
        {
          id: 'assistant-live',
          sessionId: created.sessionId,
          turnId: 'request-live',
          responseId: 'resp-live',
          timestamp: Date.now(),
          type: 'assistant_chunk',
          payload: { text: 'partial reply', phase: 'final_answer' },
        },
      ],
    );
    const bumpedSummary = await sessionHub.recordSessionActivity(created.sessionId, 'stream this reply');
    expect(Math.max(0, bumpedSummary?.revision ?? 0)).toBeGreaterThan(liveRevision);

    const result = (await plugin.operations?.events(
      { sessionId: created.sessionId, force: true },
      ctx,
    )) as SessionReplayResponse;

    try {
      expect(result.revision).toBe(liveRevision);
      expect(result.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            requestId: 'request-live',
            kind: 'request_start',
          }),
          expect.objectContaining({
            requestId: 'request-live',
            kind: 'user_message',
            chatEventType: 'user_message',
            payload: expect.objectContaining({ text: 'stream this reply' }),
          }),
          expect.objectContaining({
            requestId: 'request-live',
            kind: 'thinking',
            chatEventType: 'thinking_chunk',
            responseId: 'resp-live',
            payload: expect.objectContaining({ text: 'Thinking…' }),
          }),
          expect.objectContaining({
            requestId: 'request-live',
            kind: 'assistant_message',
            chatEventType: 'assistant_chunk',
            responseId: 'resp-live',
            payload: expect.objectContaining({ text: 'partial reply' }),
          }),
        ]),
      );
      const sessionRootEntries = await fs.readdir(baseDir, { recursive: true });
      const jsonlRelative = sessionRootEntries.find(
        (entry) => typeof entry === 'string' && entry.endsWith('.jsonl'),
      );
      expect(jsonlRelative).toBeDefined();
      const fileContent = await fs.readFile(path.join(baseDir, jsonlRelative as string), 'utf8');
      expect(fileContent).not.toContain('assistant.assistant_chunk');
      expect(fileContent).not.toContain('assistant.thinking_chunk');
    } finally {
      resetLiveTranscriptSessionState(created.sessionId);
    }
  });

  it('requires a history provider for non-Pi replay', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-events-generic'));
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'general',
        displayName: 'General',
        description: 'General agent',
      },
    ]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
    };

    const created = (await plugin.operations?.create({ agentId: 'general' }, ctx)) as SessionSummary;

    await expect(
      plugin.operations?.events({ sessionId: created.sessionId, force: true }, ctx),
    ).rejects.toThrow('Session replay history is not available for this provider');
  });

  it('passes spoken input metadata through the message route', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-message-audio'));
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });
    const startSessionMessageSpy = vi
      .spyOn(sessionMessagesModule, 'startSessionMessage')
      .mockResolvedValue({
        response: {
          sessionId: 'session-1',
          sessionName: 'Session 1',
          agentId: null,
          created: false,
          status: 'started',
          responseId: 'response-1',
        },
      });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
      envConfig: {} as never,
      baseToolHost: {} as never,
    };

    await plugin.operations?.message(
      {
        sessionId: 'session-1',
        content: 'recognized speech',
        mode: 'async',
        inputType: 'audio',
        durationMs: 4200,
      },
      ctx,
    );

    expect(startSessionMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          sessionId: 'session-1',
          content: 'recognized speech',
          mode: 'async',
          inputType: 'audio',
          durationMs: 4200,
        }),
      }),
    );
  });

  it('rejects audio submits without duration metadata', async () => {
    const sessionIndex = new SessionIndex(createTempFile('sessions-plugin-message-audio-error'));
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({ sessionIndex, agentRegistry });
    const plugin = createPlugin({ manifest: manifestJson as CombinedPluginManifest });

    const ctx: ToolContext = {
      sessionId: 'calling-session',
      signal: new AbortController().signal,
      sessionHub,
      sessionIndex,
      agentRegistry,
      envConfig: {} as never,
      baseToolHost: {} as never,
    };

    await expect(
      plugin.operations?.message(
        {
          sessionId: 'session-1',
          content: 'recognized speech',
          inputType: 'audio',
        },
        ctx,
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'durationMs is required when inputType is "audio"',
    });
  });
});
