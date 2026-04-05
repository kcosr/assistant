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

function createPanelInventoryPayload(): PanelInventoryPayload {
  return {
    type: 'panel_inventory',
    panels: [
      {
        panelId: 'notes-1',
        panelType: 'notes',
        panelTitle: 'Notes',
        paneId: 'pane-1',
        tabIndex: 0,
        tabCount: 2,
        visible: true,
        context: { id: 'note-1', name: 'Scratchpad' },
      },
      {
        panelId: 'lists-1',
        panelType: 'lists',
        panelTitle: 'Lists',
        paneId: 'pane-1',
        tabIndex: 1,
        tabCount: 2,
        visible: false,
      },
      {
        panelId: 'sessions-1',
        panelType: 'sessions',
        panelTitle: 'Sessions',
        visible: true,
      },
    ],
    selectedPanelId: 'notes-1',
    selectedChatPanelId: null,
    selectedPaneId: 'pane-1',
    layout: {
      kind: 'pane',
      paneId: 'pane-1',
      tabs: [{ panelId: 'notes-1' }, { panelId: 'lists-1' }],
      activePanelId: 'notes-1',
    },
    headerPanels: ['sessions-1'],
  };
}

function createChatSelectedInventoryPayload(): PanelInventoryPayload {
  return {
    type: 'panel_inventory',
    panels: [
      {
        panelId: 'chat-1',
        panelType: 'chat',
        panelTitle: 'Assistant (bf5753d8)',
        paneId: 'pane-1',
        tabIndex: 0,
        tabCount: 2,
        visible: true,
      },
      {
        panelId: 'empty-1',
        panelType: 'empty',
        panelTitle: 'Empty',
        paneId: 'pane-1',
        tabIndex: 1,
        tabCount: 2,
        visible: false,
      },
    ],
    selectedPanelId: 'chat-1',
    selectedChatPanelId: 'chat-1',
    selectedPaneId: 'pane-1',
    layout: {
      kind: 'pane',
      paneId: 'pane-1',
      tabs: [{ panelId: 'chat-1' }, { panelId: 'empty-1' }],
      activePanelId: 'chat-1',
    },
    headerPanels: [],
  };
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
    expect(broadcastSpy.mock.calls[0]?.[1]).toEqual({
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
    expect(broadcastSpy.mock.calls[0]?.[0]).toEqual({
      type: 'panel_event',
      panelId: 'panel-2',
      panelType: 'notes',
      payload: { mode: 'refresh' },
      sessionId: '*',
    });
  });

  it('lists panels with pane metadata and optional context', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const withoutContext = (await plugin.operations?.list(
      { includeContext: false },
      ctx,
    )) as {
      selectedPaneId: string | null;
      panels: Array<{ paneId?: string; tabIndex?: number; tabCount?: number; context?: unknown }>;
    };
    expect(withoutContext.selectedPaneId).toBe('pane-1');
    expect(withoutContext.panels[0]?.paneId).toBe('pane-1');
    expect(withoutContext.panels[0]?.tabIndex).toBe(0);
    expect(withoutContext.panels[0]?.tabCount).toBe(2);
    expect(withoutContext.panels[0]?.context).toBeUndefined();

    const withContext = (await plugin.operations?.list(
      { includeContext: true },
      ctx,
    )) as {
      panels: Array<{ context?: unknown }>;
    };
    expect(withContext.panels[0]?.context).toEqual({ id: 'note-1', name: 'Scratchpad' });
  });

  it('suppresses selectedPanelId from list output when the active panel is chat and includeChat is false', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(createChatSelectedInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const listing = (await plugin.operations?.list({}, ctx)) as {
      selectedPanelId: string | null;
      selectedChatPanelId: string | null;
      panels: Array<{ panelId: string; panelType: string }>;
    };

    expect(listing.selectedPanelId).toBeNull();
    expect(listing.selectedChatPanelId).toBe('chat-1');
    expect(listing.panels.some((panel) => panel.panelId === 'chat-1')).toBe(false);
  });

  it('returns selected panel and pane information', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const selected = (await plugin.operations?.selected(
      { includeContext: true },
      ctx,
    )) as {
      selectedPanelId: string | null;
      selectedPaneId: string | null;
      panel: { panelId?: string; paneId?: string } | null;
    };
    expect(selected.selectedPanelId).toBe('notes-1');
    expect(selected.selectedPaneId).toBe('pane-1');
    expect(selected.panel?.panelId).toBe('notes-1');
    expect(selected.panel?.paneId).toBe('pane-1');
  });

  it('returns the active chat panel as the selected panel when includeChat is true', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(createChatSelectedInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const selected = (await plugin.operations?.selected(
      { includeChat: true, includeContext: true },
      ctx,
    )) as {
      selectedPanelId: string | null;
      selectedChatPanelId: string | null;
      panel: { panelId?: string; panelType?: string; panelTitle?: string } | null;
      chatPanel: { panelId?: string; panelType?: string; panelTitle?: string } | null;
    };

    expect(selected.selectedPanelId).toBe('chat-1');
    expect(selected.selectedChatPanelId).toBe('chat-1');
    expect(selected.panel).toMatchObject({
      panelId: 'chat-1',
      panelType: 'chat',
      panelTitle: 'Assistant (bf5753d8)',
    });
    expect(selected.chatPanel).toMatchObject({
      panelId: 'chat-1',
      panelType: 'chat',
      panelTitle: 'Assistant (bf5753d8)',
    });
  });

  it('hides selected chat panel details from the primary selection when includeChat is false', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(createChatSelectedInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const selected = (await plugin.operations?.selected({}, ctx)) as {
      selectedPanelId: string | null;
      selectedChatPanelId: string | null;
      panel: unknown;
      chatPanel?: unknown;
    };

    expect(selected.selectedPanelId).toBe('chat-1');
    expect(selected.selectedChatPanelId).toBe('chat-1');
    expect(selected.panel).toBeNull();
    expect(selected.chatPanel).toBeNull();
  });

  it('lists active windows with selection state', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });
    updatePanelInventory(
      {
        type: 'panel_inventory',
        panels: [],
        selectedPanelId: null,
        selectedChatPanelId: null,
        selectedPaneId: null,
      },
      { windowId: 'window-b', connectionId: 'conn-b' },
    );

    const result = (await plugin.operations?.windows({}, ctx)) as {
      windows: Array<{
        windowId: string;
        selectedPaneId: string | null;
        panelCount: number;
      }>;
    };

    expect(result.windows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          windowId: 'window-a',
          selectedPaneId: 'pane-1',
          panelCount: 3,
        }),
        expect.objectContaining({
          windowId: 'window-b',
          selectedPaneId: null,
          panelCount: 0,
        }),
      ]),
    );
  });

  it('returns tree output with pane-aware layout details', async () => {
    resetPanelInventoryForTests();
    const { ctx } = await createTestEnvironment();
    const plugin = createTestPlugin();

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const tree = (await plugin.operations?.tree(
      { format: 'both', includeChat: true },
      ctx,
    )) as {
      layout?: unknown;
      headerPanels?: string[];
      selectedPaneId?: string | null;
      text?: string;
    };

    expect(tree.layout).toEqual(createPanelInventoryPayload().layout);
    expect(tree.headerPanels).toEqual(['sessions-1']);
    expect(tree.selectedPaneId).toBe('pane-1');
    expect(tree.text).toContain('Window: window-a');
    expect(tree.text).toContain('Selected pane: pane-1');
    expect(tree.text).toContain('- pane pane-1:');
  });

  it('opens a panel as a tab in the selected pane by default', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const sendSpy = vi.spyOn(sessionHub, 'sendToConnection').mockReturnValue(true);

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const result = (await plugin.operations?.open({ panelType: 'notes' }, ctx)) as {
      ok?: boolean;
      mode?: string;
      paneId?: string;
      windowId?: string;
    };

    expect(result).toMatchObject({
      ok: true,
      mode: 'tab',
      paneId: 'pane-1',
      windowId: 'window-a',
    });
    expect(sendSpy.mock.calls[0]?.[0]).toBe('conn-a');
    expect(sendSpy.mock.calls[0]?.[1]).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      windowId: 'window-a',
      payload: {
        type: 'panel_command',
        command: 'open_panel',
        panelType: 'notes',
        mode: 'tab',
        targetPaneId: 'pane-1',
      },
    });
  });

  it('focuses an existing panel', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const sendSpy = vi.spyOn(sessionHub, 'sendToConnection').mockReturnValue(true);

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const result = (await plugin.operations?.focus(
      { panelId: 'lists-1', windowId: 'window-a' },
      ctx,
    )) as { ok?: boolean };

    expect(result.ok).toBe(true);
    expect(sendSpy.mock.calls[0]?.[0]).toBe('conn-a');
    expect(sendSpy.mock.calls[0]?.[1]).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      windowId: 'window-a',
      payload: {
        type: 'panel_command',
        command: 'focus_panel',
        panelId: 'lists-1',
      },
    });
  });

  it('opens a panel in a new split and returns the destination pane id', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const sendSpy = vi.spyOn(sessionHub, 'sendToConnection').mockReturnValue(true);

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const result = (await plugin.operations?.open(
      {
        panelType: 'chat',
        mode: 'split',
        targetPanelId: 'notes-1',
        direction: 'right',
        size: { width: 420 },
      },
      ctx,
    )) as {
      ok?: boolean;
      mode?: string;
      paneId?: string;
      parentPaneId?: string;
      windowId?: string;
    };

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('split');
    expect(result.parentPaneId).toBe('pane-1');
    expect(result.windowId).toBe('window-a');
    expect(result.paneId).toMatch(/^pane-\d+$/);
    expect(sendSpy.mock.calls[0]?.[0]).toBe('conn-a');
    expect(sendSpy.mock.calls[0]?.[1]).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      windowId: 'window-a',
      payload: {
        type: 'panel_command',
        command: 'open_panel',
        panelType: 'chat',
        mode: 'split',
        targetPaneId: 'pane-1',
        direction: 'right',
        size: { width: 420 },
        targetPanelId: 'notes-1',
        paneId: result.paneId,
      },
    });
  });

  it('moves a panel into another pane as a tab', async () => {
    resetPanelInventoryForTests();
    const { ctx, sessionHub } = await createTestEnvironment();
    const plugin = createTestPlugin();
    const sendSpy = vi.spyOn(sessionHub, 'sendToConnection').mockReturnValue(true);

    updatePanelInventory(
      {
        type: 'panel_inventory',
        panels: [
          {
            panelId: 'notes-1',
            panelType: 'notes',
            paneId: 'pane-1',
            tabIndex: 0,
            tabCount: 1,
            visible: true,
          },
          {
            panelId: 'lists-1',
            panelType: 'lists',
            paneId: 'pane-2',
            tabIndex: 0,
            tabCount: 1,
            visible: true,
          },
        ],
        selectedPanelId: 'notes-1',
        selectedChatPanelId: null,
        selectedPaneId: 'pane-1',
        layout: {
          kind: 'split',
          splitId: 'split-1',
          direction: 'horizontal',
          sizes: [1, 1],
          children: [
            { kind: 'pane', paneId: 'pane-1', tabs: [{ panelId: 'notes-1' }], activePanelId: 'notes-1' },
            { kind: 'pane', paneId: 'pane-2', tabs: [{ panelId: 'lists-1' }], activePanelId: 'lists-1' },
          ],
        },
      },
      { windowId: 'window-a', connectionId: 'conn-a' },
    );

    const result = (await plugin.operations?.move(
      {
        panelId: 'notes-1',
        mode: 'tab',
        targetPaneId: 'pane-2',
      },
      ctx,
    )) as {
      ok?: boolean;
      mode?: string;
      paneId?: string;
    };

    expect(result).toMatchObject({ ok: true, mode: 'tab', paneId: 'pane-2' });
    expect(sendSpy.mock.calls[0]?.[0]).toBe('conn-a');
    expect(sendSpy.mock.calls[0]?.[1]).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      windowId: 'window-a',
      payload: {
        type: 'panel_command',
        command: 'move_panel',
        panelId: 'notes-1',
        mode: 'tab',
        targetPaneId: 'pane-2',
      },
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
    expect(broadcastSpy.mock.calls[0]?.[0]).toEqual({
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
        selectedPaneId: null,
      },
      { windowId: 'window-a', connectionId: 'conn-a' },
    );
    updatePanelInventory(
      {
        type: 'panel_inventory',
        panels: [],
        selectedPanelId: null,
        selectedChatPanelId: null,
        selectedPaneId: null,
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
    const sendSpy = vi.spyOn(sessionHub, 'sendToConnection').mockReturnValue(true);

    updatePanelInventory(createPanelInventoryPayload(), {
      windowId: 'window-a',
      connectionId: 'conn-a',
    });

    const result = (await plugin.operations?.open(
      { panelType: 'notes', mode: 'tab', targetPaneId: 'pane-1', windowId: 'window-a' },
      ctx,
    )) as { ok?: boolean; windowId?: string };

    expect(result.ok).toBe(true);
    expect(result.windowId).toBe('window-a');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]).toBe('conn-a');
    expect(sendSpy.mock.calls[0]?.[1]).toEqual({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      windowId: 'window-a',
      payload: {
        type: 'panel_command',
        command: 'open_panel',
        panelType: 'notes',
        mode: 'tab',
        targetPaneId: 'pane-1',
      },
    });
  });
});
