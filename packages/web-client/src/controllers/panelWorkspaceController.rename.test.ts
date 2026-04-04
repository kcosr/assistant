// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { LayoutPersistence } from '@assistant/shared';

import { DialogManager } from './dialogManager';
import { PanelChromeController } from './panelChromeController';
import { PanelHostController } from './panelHostController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { PanelWorkspaceController } from './panelWorkspaceController';
import { getPanelContextKey } from '../utils/panelContext';
import {
  WorkspaceNavigatorController,
  type WorkspaceNavigatorHost,
} from './workspaceNavigatorController';

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function createChromePanel(initialTitle: string): PanelFactory {
  return () => ({
    mount: (container, host) => {
      container.innerHTML = `
        <div class="panel-header panel-chrome-row" data-role="chrome-row">
          <div class="panel-header-main">
            <span class="panel-header-label" data-role="chrome-title">${initialTitle}</span>
          </div>
          <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
          <div class="panel-chrome-frame-controls" data-role="chrome-controls"></div>
        </div>
        <div class="panel-body"></div>
      `;

      const chromeController = new PanelChromeController({
        root: container,
        host,
        title: initialTitle,
      });

      return {
        unmount: () => {
          chromeController.destroy();
        },
      };
    },
  });
}

function pane(
  paneId: string,
  panelIds: string[],
  activePanelId = panelIds[0] ?? '',
): LayoutPersistence['layout'] {
  return {
    kind: 'pane',
    paneId,
    tabs: panelIds.map((panelId) => ({ panelId })),
    activePanelId,
  };
}

function createTabbedLayout(): LayoutPersistence {
  return {
    layout: pane('pane-1', ['lists-1', 'notes-1'], 'lists-1'),
    panels: {
      'lists-1': {
        panelId: 'lists-1',
        panelType: 'lists',
      },
      'notes-1': {
        panelId: 'notes-1',
        panelType: 'notes',
      },
    },
    headerPanels: [],
    headerPanelSizes: {},
  };
}

describe('PanelWorkspaceController rename flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('renames a panel from the menu and updates tabs, navigator, context, and inventory while keeping chrome titles static', async () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'lists', title: 'Lists' }, createChromePanel('Lists'));
    registry.register({ type: 'notes', title: 'Notes' }, createChromePanel('Notes'));

    const panelEvents: unknown[] = [];
    const host = new PanelHostController({
      registry,
      sendPanelEvent: (event) => {
        panelEvents.push(event);
      },
    });

    const root = document.createElement('div');
    const navigatorRoot = document.createElement('div');
    document.body.append(root, navigatorRoot);

    const dialogManager = new DialogManager();
    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      dialogManager,
      loadLayout: () => createTabbedLayout(),
      onLayoutChange: (layout) => {
        host.setContext('panel.layout', layout);
      },
    });
    host.setPanelWorkspace(workspace);
    host.setContext('panel.manifests', registry.listManifests());
    workspace.attach();
    workspace.focusPanel('lists-1');

    const navigator = new WorkspaceNavigatorController({
      container: navigatorRoot,
      host: host as unknown as WorkspaceNavigatorHost,
    });
    navigator.attach();

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    workspace.openPanelMenu('lists-1', anchor);

    const renameButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.panel-context-menu .context-menu-item'),
    ).find((button) => button.textContent === 'Rename panel...');
    expect(renameButton).toBeTruthy();
    renameButton?.click();

    const input = document.querySelector<HTMLInputElement>('.confirm-dialog-overlay input');
    const confirm = document.querySelector<HTMLButtonElement>('.confirm-dialog-button.primary');
    expect(input).not.toBeNull();
    expect(confirm).not.toBeNull();

    if (!input || !confirm) {
      throw new Error('Expected rename dialog');
    }

    input.value = '  Work Tasks  ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    confirm.click();
    await Promise.resolve();
    await nextFrame();

    expect(workspace.getLayout().panels['lists-1']?.customTitle).toBe('Work Tasks');
    expect(
      root.querySelector<HTMLButtonElement>('.panel-tab-button[data-panel-id="lists-1"]')?.textContent,
    ).toBe('Work Tasks');
    expect(
      root.querySelector<HTMLElement>(
        '.panel-frame[data-panel-id="lists-1"] [data-role="chrome-title"]',
      )?.textContent,
    ).toBe('Lists');

    const navigatorLabels = Array.from(
      navigatorRoot.querySelectorAll<HTMLElement>('.workspace-navigator-label'),
    ).map((element) => element.textContent);
    expect(navigatorLabels).toContain('Work Tasks');

    expect(
      (
        host.getContext('panel.context') as {
          panels: Array<{ panelId: string; panelTitle: string }>;
        } | null
      )?.panels.find((panel) => panel.panelId === 'lists-1')?.panelTitle,
    ).toBe('Work Tasks');

    const inventoryPayload = panelEvents
      .map((event) => (event as { payload?: unknown }).payload)
      .filter(
        (payload): payload is { type: string; panels: Array<{ panelId: string; panelTitle?: string }> } =>
          !!payload &&
          typeof payload === 'object' &&
          (payload as { type?: string }).type === 'panel_inventory',
      )
      .at(-1);
    expect(inventoryPayload?.panels.find((panel) => panel.panelId === 'lists-1')?.panelTitle).toBe(
      'Work Tasks',
    );

    navigator.detach();
  });

  it('clears a custom title on empty submission and keeps the chrome title on the panel default', async () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'lists', title: 'Lists' }, createChromePanel('Lists'));

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const dialogManager = new DialogManager();
    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      dialogManager,
      loadLayout: () => ({
        layout: pane('pane-1', ['lists-1']),
        panels: {
          'lists-1': {
            panelId: 'lists-1',
            panelType: 'lists',
            customTitle: 'Work Tasks',
            meta: {
              title: 'Lists (Team)',
            },
          },
        },
        headerPanels: [],
        headerPanelSizes: {},
      }),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    workspace.openPanelMenu('lists-1', anchor);

    const renameButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.panel-context-menu .context-menu-item'),
    ).find((button) => button.textContent === 'Rename panel...');
    renameButton?.click();

    const input = document.querySelector<HTMLInputElement>('.confirm-dialog-overlay input');
    const confirm = document.querySelector<HTMLButtonElement>('.confirm-dialog-button.primary');
    if (!input || !confirm) {
      throw new Error('Expected rename dialog');
    }

    input.value = '   ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    confirm.click();
    await Promise.resolve();

    expect(workspace.getLayout().panels['lists-1']?.customTitle).toBeUndefined();
    expect(
      root.querySelector<HTMLElement>(
        '.panel-frame[data-panel-id="lists-1"] [data-role="chrome-title"]',
      )?.textContent,
    ).toBe('Lists');
  });

  it('uses the resolved title for pinned header labels and clears customTitle on replace', () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'lists', title: 'Lists' }, createChromePanel('Lists'));
    registry.register({ type: 'notes', title: 'Notes' }, createChromePanel('Notes'));

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    const headerDockRoot = document.createElement('div');
    document.body.append(root, headerDockRoot);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      headerDockRoot,
      loadLayout: () => ({
        layout: pane('pane-1', ['lists-1']),
        panels: {
          'lists-1': {
            panelId: 'lists-1',
            panelType: 'lists',
          },
          'notes-1': {
            panelId: 'notes-1',
            panelType: 'notes',
          },
        },
        headerPanels: ['notes-1'],
        headerPanelSizes: {},
      }),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    expect(workspace.setPanelCustomTitle('notes-1', 'Pinned Notes')).toBe(true);

    const dockButton = headerDockRoot.querySelector<HTMLButtonElement>(
      '.panel-dock-button[data-panel-id="notes-1"]',
    );
    expect(dockButton?.getAttribute('aria-label')).toBe('Open Pinned Notes');
    expect(dockButton?.title).toContain('Panel: Pinned Notes');

    workspace.openHeaderPanel('notes-1');
    expect(
      document.querySelector<HTMLElement>(
        '.panel-frame[data-panel-id="notes-1"] [data-role="chrome-title"]',
      )?.textContent,
    ).toBe('Notes');

    expect(workspace.setPanelCustomTitle('lists-1', 'Work Tasks')).toBe(true);
    expect(workspace.replacePanel('lists-1', 'notes')).toBe(true);
    expect(workspace.getLayout().panels['lists-1']?.customTitle).toBeUndefined();
    expect(
      root.querySelector<HTMLElement>(
        '.panel-frame[data-panel-id="lists-1"] [data-role="chrome-title"]',
      )?.textContent,
    ).toBe('Notes');
  });

  it('uses synthesized list titles across non-chrome surfaces when the preference is enabled', async () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'lists', title: 'Lists' }, createChromePanel('Lists'));
    registry.register({ type: 'notes', title: 'Notes' }, createChromePanel('Notes'));

    const panelEvents: unknown[] = [];
    const host = new PanelHostController({
      registry,
      sendPanelEvent: (event) => {
        panelEvents.push(event);
      },
    });
    const root = document.createElement('div');
    const navigatorRoot = document.createElement('div');
    document.body.append(root, navigatorRoot);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      getSynthesizedPanelTitlesEnabled: () => true,
      loadLayout: () => ({
        ...createTabbedLayout(),
        panels: {
          'lists-1': {
            panelId: 'lists-1',
            panelType: 'lists',
            meta: {
              title: 'Lists (Scratch)',
            },
          },
          'notes-1': {
            panelId: 'notes-1',
            panelType: 'notes',
          },
        },
      }),
      onLayoutChange: (layout) => {
        host.setContext('panel.layout', layout);
      },
    });
    host.setPanelWorkspace(workspace);
    host.setContext('panel.manifests', registry.listManifests());
    workspace.attach();

    const navigator = new WorkspaceNavigatorController({
      container: navigatorRoot,
      host: host as unknown as WorkspaceNavigatorHost,
    });
    navigator.attach();

    host.setContext(getPanelContextKey('lists-1'), {
      type: 'list',
      id: 'list-1',
      name: 'Test',
      instance_id: 'scratch',
      instance_label: 'Scratch',
      instance_ids: ['scratch'],
      contextAttributes: {
        'instance-id': 'scratch',
        'instance-ids': 'scratch',
      },
    });
    await nextFrame();

    expect(
      root.querySelector<HTMLElement>(
        '.panel-frame[data-panel-id="lists-1"] [data-role="chrome-title"]',
      )?.textContent,
    ).toBe('Lists');
    expect(
      root.querySelector<HTMLButtonElement>('.panel-tab-button[data-panel-id="lists-1"]')
        ?.textContent,
    ).toBe('Test (Scratch)');

    const navigatorLabels = Array.from(
      navigatorRoot.querySelectorAll<HTMLElement>('.workspace-navigator-label'),
    ).map((element) => element.textContent);
    expect(navigatorLabels).toContain('Test (Scratch)');

    expect(
      (
        host.getContext('panel.context') as {
          panels: Array<{ panelId: string; panelTitle: string }>;
        } | null
      )?.panels.find((panel) => panel.panelId === 'lists-1')?.panelTitle,
    ).toBe('Test (Scratch)');

    const inventoryPayload = panelEvents
      .map((event) => (event as { payload?: unknown }).payload)
      .filter(
        (payload): payload is { type: string; panels: Array<{ panelId: string; panelTitle?: string }> } =>
          !!payload &&
          typeof payload === 'object' &&
          (payload as { type?: string }).type === 'panel_inventory',
      )
      .at(-1);
    expect(inventoryPayload?.panels.find((panel) => panel.panelId === 'lists-1')?.panelTitle).toBe(
      'Test (Scratch)',
    );

    navigator.detach();
  });
});
