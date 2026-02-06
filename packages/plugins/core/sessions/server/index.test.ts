import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CombinedPluginManifest } from '@assistant/shared';
import { AgentRegistry } from '../../../../agent-server/src/agents';
import type { ChatCompletionMessage } from '../../../../agent-server/src/chatCompletionTypes';
import type { SessionSummary } from '../../../../agent-server/src/sessionIndex';
import { PiSessionWriter } from '../../../../agent-server/src/history/piSessionWriter';
import { SessionHub } from '../../../../agent-server/src/sessionHub';
import { SessionIndex } from '../../../../agent-server/src/sessionIndex';
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
      { agentId: 'general', attributes: { core: { workingDir } } },
      ctx,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sessionId: expect.any(String),
        attributes: { core: { workingDir } },
      }),
    );
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
      { agentId: 'pi-agent', attributes: { core: { workingDir } } },
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
      { agentId: 'pi-cli-agent', attributes: { core: { workingDir } } },
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
      messages: [{ role: 'system', content: 'system' }, { role: 'assistant', content: 'Hello' }],
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
});
