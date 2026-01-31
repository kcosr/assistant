import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { CombinedPluginManifest, PanelInventoryPayload } from '@assistant/shared';
import { SessionHub, SessionIndex } from '../../../../agent-server/src/index';
import { AgentRegistry } from '../../../../agent-server/src/agents';
import {
  resetPanelInventoryForTests,
  updatePanelInventory,
} from '../../../../agent-server/src/panels/panelInventoryStore';
import type { ToolContext } from '../../../../agent-server/src/tools';
import type { EventStore } from '../../../../agent-server/src/events';
import manifestJson from '../manifest.json';
import { createPlugin } from './index';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

async function createTestEnvironment() {
  const sessionsFile = createTempFile('panels-plugin-sessions');

  const sessionIndex = new SessionIndex(sessionsFile);
  const eventStore: EventStore = {
    append: async () => {},
    appendBatch: async () => {},
    getEvents: async () => [],
    getEventsSince: async () => [],
    subscribe: () => () => {},
    clearSession: async () => {},
    deleteSession: async () => {},
  };
  const agentRegistry = new AgentRegistry([]);
  const sessionHub = new SessionHub({ sessionIndex, agentRegistry, eventStore });

  const initialSession = await sessionIndex.createSession({ agentId: 'general' });

  const ctx: ToolContext = {
    sessionId: initialSession.sessionId,
    signal: new AbortController().signal,
    sessionHub,
    sessionIndex,
  };

  return { ctx, sessionHub };
}

function createTestPlugin() {
  return createPlugin({ manifest: manifestJson as CombinedPluginManifest });
}

describe('panels plugin operations', () => {
  it('broadcasts to the current session by default', async () => {
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const broadcastSpy = vi.spyOn(sessionHub, 'broadcastToSession');

    const result = (await plugin.operations?.event(
      {
        panelId: 'panel-1',
        panelType: 'chat',
        payload: { ok: true },
      },
      ctx,
    )) as { ok?: boolean };

    expect(result.ok).toBe(true);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const lastCall = broadcastSpy.mock.calls[0]!;
    expect(lastCall[0]).toBe(ctx.sessionId);
    expect(lastCall[1]).toEqual({
      type: 'panel_event',
      panelId: 'panel-1',
      panelType: 'chat',
      payload: { ok: true },
      sessionId: ctx.sessionId,
    });
  });

  it('broadcasts to all sessions when scope is all', async () => {
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const broadcastSpy = vi.spyOn(sessionHub, 'broadcastToAll');

    const result = (await plugin.operations?.event(
      {
        panelId: 'panel-2',
        panelType: 'notes',
        payload: { mode: 'refresh' },
        scope: 'all',
      },
      ctx,
    )) as { ok?: boolean };

    expect(result.ok).toBe(true);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const message = broadcastSpy.mock.calls[0]?.[0] as {
      type?: string;
      panelId?: string;
      panelType?: string;
      payload?: unknown;
      sessionId?: string;
    };
    expect(message).toEqual({
      type: 'panel_event',
      panelId: 'panel-2',
      panelType: 'notes',
      payload: { mode: 'refresh' },
      sessionId: '*',
    });
  });

  it('lists panels with or without context', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    const payload: PanelInventoryPayload = {
      type: 'panel_inventory',
      panels: [
        {
          panelId: 'p-1',
          panelType: 'notes',
          panelTitle: 'Notes',
          visible: true,
          context: { id: 'note-1', name: 'Scratchpad' },
        },
      ],
      selectedPanelId: 'p-1',
      selectedChatPanelId: null,
    };
    updatePanelInventory(payload, { windowId: 'window-a', connectionId: 'conn-a' });

    const withoutContext = (await plugin.operations?.list({ includeContext: false }, ctx)) as {
      panels: Array<{ context?: unknown }>;
    };
    expect(withoutContext.panels[0]?.context).toBeUndefined();

    const defaultContext = (await plugin.operations?.list({}, ctx)) as {
      panels: Array<{ context?: unknown }>;
    };
    expect(defaultContext.panels[0]?.context).toEqual({ id: 'note-1', name: 'Scratchpad' });

    const withContext = (await plugin.operations?.list({ includeContext: true }, ctx)) as {
      panels: Array<{ context?: unknown }>;
    };
    expect(withContext.panels[0]?.context).toEqual({ id: 'note-1', name: 'Scratchpad' });
  });

  it('returns selected panels', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    const payload: PanelInventoryPayload = {
      type: 'panel_inventory',
      panels: [
        {
          panelId: 'p-2',
          panelType: 'notes',
          panelTitle: 'Notes',
          visible: true,
        },
      ],
      selectedPanelId: 'p-2',
      selectedChatPanelId: null,
    };
    updatePanelInventory(payload, { windowId: 'window-a', connectionId: 'conn-a' });

    const selected = (await plugin.operations?.selected({ includeContext: true }, ctx)) as {
      selectedPanelId: string | null;
      panel: { panelId?: string } | null;
    };
    expect(selected.selectedPanelId).toBe('p-2');
    expect(selected.panel?.panelId).toBe('p-2');
  });

  it('returns tree output with layout details', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    const payload: PanelInventoryPayload = {
      type: 'panel_inventory',
      panels: [
        {
          panelId: 'p-1',
          panelType: 'notes',
          panelTitle: 'Notes',
          visible: true,
        },
        {
          panelId: 'p-2',
          panelType: 'sessions',
          panelTitle: 'Sessions',
          visible: true,
        },
      ],
      selectedPanelId: 'p-1',
      selectedChatPanelId: null,
      layout: { kind: 'panel', panelId: 'p-1' },
      headerPanels: ['p-2'],
    };
    updatePanelInventory(payload, { windowId: 'window-a', connectionId: 'conn-a' });

    const tree = (await plugin.operations?.tree({ format: 'both', includeChat: true }, ctx)) as {
      layout?: unknown;
      headerPanels?: string[];
      text?: string;
    };

    expect(tree.layout).toEqual(payload.layout);
    expect(tree.headerPanels).toEqual(['p-2']);
    expect(tree.text).toContain('Header panels:');
    expect(tree.text).toContain('Layout:');
  });

  it('opens panels by broadcasting a panel command', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const broadcastSpy = vi.spyOn(sessionHub, 'broadcastToSession');

    const result = (await plugin.operations?.open(
      { panelType: 'notes', targetPanelId: 'p-1' },
      ctx,
    )) as { ok?: boolean };

    expect(result.ok).toBe(true);
    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    const [targetSession, message] = broadcastSpy.mock.calls[0] ?? [];
    expect(targetSession).toBe(ctx.sessionId);
    expect(message).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      payload: {
        type: 'panel_command',
        command: 'open_panel',
        panelType: 'notes',
        targetPanelId: 'p-1',
      },
      sessionId: ctx.sessionId,
    });
  });

  it('normalizes placement aliases in panel commands', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const broadcastSpy = vi.spyOn(sessionHub, 'broadcastToSession');

    const result = (await plugin.operations?.open(
      {
        panelType: 'notes',
        targetPanelId: 'p-1',
        placement: { position: 'right' },
      },
      ctx,
    )) as { ok?: boolean };

    expect(result.ok).toBe(true);
    const [, message] = broadcastSpy.mock.calls[0] ?? [];
    expect(message).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      payload: {
        type: 'panel_command',
        command: 'open_panel',
        panelType: 'notes',
        targetPanelId: 'p-1',
        placement: { region: 'right' },
      },
      sessionId: ctx.sessionId,
    });
  });

  it('broadcasts panel commands to all sessions from http context', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    ctx.sessionId = 'http';
    const broadcastSpy = vi.spyOn(sessionHub, 'broadcastToAll');

    const result = (await plugin.operations?.replace(
      {
        panelId: 'p-1',
        panelType: 'notes',
      },
      ctx,
    )) as { ok?: boolean };

    expect(result.ok).toBe(true);
    const [message] = broadcastSpy.mock.calls[0] ?? [];
    expect(message).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      payload: {
        type: 'panel_command',
        command: 'replace_panel',
        panelId: 'p-1',
        panelType: 'notes',
      },
      sessionId: '*',
    });
  });

  it('requires windowId when multiple windows are active', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(
      {
        type: 'panel_inventory',
        panels: [],
        selectedPanelId: null,
        selectedChatPanelId: null,
      },
      { windowId: 'window-a', connectionId: 'conn-a' },
    );
    updatePanelInventory(
      {
        type: 'panel_inventory',
        panels: [],
        selectedPanelId: null,
        selectedChatPanelId: null,
      },
      { windowId: 'window-b', connectionId: 'conn-b' },
    );

    await expect(plugin.operations?.list({}, ctx)).rejects.toMatchObject({
      code: 'window_required',
    });
  });

  it('routes panel commands to a specific window', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const sendSpy = vi.spyOn(sessionHub, 'sendToConnection');

    updatePanelInventory(
      {
        type: 'panel_inventory',
        panels: [],
        selectedPanelId: null,
        selectedChatPanelId: null,
      },
      { windowId: 'window-a', connectionId: 'conn-a' },
    );

    const result = (await plugin.operations?.open(
      { panelType: 'notes', targetPanelId: 'p-1', windowId: 'window-a' },
      ctx,
    )) as { ok?: boolean };

    expect(result.ok).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const [connectionId, message] = sendSpy.mock.calls[0] ?? [];
    expect(connectionId).toBe('conn-a');
    expect(message).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      windowId: 'window-a',
      payload: {
        type: 'panel_command',
        command: 'open_panel',
        panelType: 'notes',
        targetPanelId: 'p-1',
      },
    });
  });
});
