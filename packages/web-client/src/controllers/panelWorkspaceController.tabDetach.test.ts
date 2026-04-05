// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelHostController } from './panelHostController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { PanelWorkspaceController } from './panelWorkspaceController';
import { CHAT_PANEL_MANIFEST } from '../panels/chat/manifest';
import { INPUT_PANEL_MANIFEST } from '../panels/input/manifest';
import { EMPTY_PANEL_MANIFEST } from '../panels/empty/manifest';
import type { LayoutNode } from '@assistant/shared';

const createStubPanel: PanelFactory = () => ({
  mount: () => ({
    unmount: () => undefined,
  }),
});

const pane = (paneId: string, panelIds: string[], activePanelId = panelIds[0] ?? ''): LayoutNode => ({
  kind: 'pane' as const,
  paneId,
  tabs: panelIds.map((panelId) => ({ panelId })),
  activePanelId,
});

class MockDataTransfer {
  private readonly values = new Map<string, string>();

  get types(): string[] {
    return [...this.values.keys()];
  }

  setData(type: string, value: string): void {
    this.values.set(type, value);
  }

  getData(type: string): string {
    return this.values.get(type) ?? '';
  }

  setDragImage(): void {
    // jsdom does not render drag previews.
  }
}

describe('PanelWorkspaceController tab detach', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    delete ((document as unknown) as Record<string, unknown>)['elementFromPoint'];
    vi.restoreAllMocks();
  });

  it('splits a tab out of its current pane when dropped on a pane edge', () => {
    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);
    registry.register(EMPTY_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      defaultLayout: () => ({
        layout: pane('pane-1', ['chat-1', 'input-1'], 'chat-1'),
        panels: {
          'chat-1': { panelId: 'chat-1', panelType: 'chat' },
          'input-1': { panelId: 'input-1', panelType: 'input' },
        },
        headerPanels: [],
        headerPanelSizes: {},
      }),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));

    const paneElement = root.querySelector<HTMLElement>('.panel-tabs-pane[data-pane-id="pane-1"]');
    const activeFrame = root.querySelector<HTMLElement>('.panel-frame[data-panel-id="chat-1"]');
    expect(paneElement).not.toBeNull();
    expect(activeFrame).not.toBeNull();
    if (!paneElement || !activeFrame) {
      throw new Error('Missing pane or panel frame');
    }

    vi.spyOn(paneElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => activeFrame),
    });

    (workspace as any).startTabDetachDrag('input-1', 'pane-1');
    (workspace as any).updateTabDetachDrag(
      (workspace as any).tabDragState,
      new MouseEvent('dragover', { clientX: 790, clientY: 300 }),
    );
    (workspace as any).finishTabDetachDrag(
      (workspace as any).tabDragState,
      new MouseEvent('drop', { clientX: 790, clientY: 300 }),
    );

    expect(workspace.getLayoutRoot()).toEqual({
      kind: 'split',
      splitId: expect.any(String),
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [pane('pane-1', ['chat-1'], 'chat-1'), pane('pane-2', ['input-1'], 'input-1')],
    });
  });

  it('moves a tab into another pane when dropped on that pane tab strip', () => {
    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);
    registry.register(EMPTY_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      defaultLayout: () => ({
        layout: {
          kind: 'split',
          splitId: 'split-1',
          direction: 'horizontal',
          sizes: [0.5, 0.5],
          children: [pane('pane-1', ['chat-1'], 'chat-1'), pane('pane-2', ['input-1', 'input-2'], 'input-1')],
        },
        panels: {
          'chat-1': { panelId: 'chat-1', panelType: 'chat' },
          'input-1': { panelId: 'input-1', panelType: 'input' },
          'input-2': { panelId: 'input-2', panelType: 'input' },
        },
        headerPanels: [],
        headerPanelSizes: {},
      }),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const targetTab = root.querySelector<HTMLElement>('.panel-tab-button[data-panel-id="input-2"]');
    expect(targetTab).not.toBeNull();
    if (!targetTab) {
      throw new Error('Missing target tab');
    }

    const dataTransfer = new MockDataTransfer();
    dataTransfer.setData('application/x-assistant-tab-panel-id', 'chat-1');
    dataTransfer.setData('application/x-assistant-tab-source-pane-id', 'pane-1');
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer });
    targetTab.dispatchEvent(dropEvent);

    expect(workspace.getLayoutRoot()).toEqual({
      kind: 'split',
      splitId: 'split-1',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          kind: 'pane',
          paneId: 'pane-1',
          tabs: [{ panelId: 'empty-1' }],
          activePanelId: 'empty-1',
        },
        {
          kind: 'pane',
          paneId: 'pane-2',
          tabs: [{ panelId: 'input-1' }, { panelId: 'input-2' }, { panelId: 'chat-1' }],
          activePanelId: 'chat-1',
        },
      ],
    });
  });

  it('allows dragging the only tab out of a pane and leaves an empty placeholder pane behind', () => {
    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);
    registry.register(EMPTY_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      defaultLayout: () => ({
        layout: {
          kind: 'split',
          splitId: 'split-1',
          direction: 'horizontal',
          sizes: [0.5, 0.5],
          children: [pane('pane-1', ['chat-1'], 'chat-1'), pane('pane-2', ['input-1'], 'input-1')],
        },
        panels: {
          'chat-1': { panelId: 'chat-1', panelType: 'chat' },
          'input-1': { panelId: 'input-1', panelType: 'input' },
        },
        headerPanels: [],
        headerPanelSizes: {},
      }),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const sourceTab = root.querySelector<HTMLElement>('.panel-tab-button[data-panel-id="chat-1"]');
    const targetTab = root.querySelector<HTMLElement>('.panel-tab-button[data-panel-id="input-1"]');
    expect(sourceTab?.draggable).toBe(true);
    expect(targetTab).not.toBeNull();
    if (!sourceTab || !targetTab) {
      throw new Error('Missing tab buttons');
    }

    const dataTransfer = new MockDataTransfer();
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    sourceTab.dispatchEvent(dragStart);

    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dropEvent, 'dataTransfer', { value: dataTransfer });
    targetTab.dispatchEvent(dropEvent);

    expect(workspace.getLayoutRoot()).toEqual({
      kind: 'split',
      splitId: 'split-1',
      direction: 'horizontal',
      sizes: [0.5, 0.5],
      children: [
        {
          kind: 'pane',
          paneId: 'pane-1',
          tabs: [{ panelId: 'empty-1' }],
          activePanelId: 'empty-1',
        },
        {
          kind: 'pane',
          paneId: 'pane-2',
          tabs: [{ panelId: 'input-1' }, { panelId: 'chat-1' }],
          activePanelId: 'chat-1',
        },
      ],
    });
  });

  it('renders pane tabs inside a dedicated scrollable tab list with the add button outside it', () => {
    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);
    registry.register(EMPTY_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      defaultLayout: () => ({
        layout: pane('pane-1', ['chat-1', 'input-1', 'empty-1'], 'chat-1'),
        panels: {
          'chat-1': { panelId: 'chat-1', panelType: 'chat' },
          'input-1': { panelId: 'input-1', panelType: 'input' },
          'empty-1': { panelId: 'empty-1', panelType: 'empty' },
        },
        headerPanels: [],
        headerPanelSizes: {},
      }),
      openPanelLauncher: () => undefined,
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const header = root.querySelector<HTMLElement>('.panel-tabs-header');
    const tabList = root.querySelector<HTMLElement>('.panel-tabs-list');
    const addButton = root.querySelector<HTMLElement>('.panel-tab-add');
    const tabButtons = [...root.querySelectorAll<HTMLElement>('.panel-tab-button')];

    expect(header).not.toBeNull();
    expect(tabList).not.toBeNull();
    expect(addButton).not.toBeNull();
    if (!header || !tabList || !addButton) {
      throw new Error('Missing tab strip elements');
    }

    expect(tabButtons.length).toBe(3);
    expect(tabButtons.every((button) => button.parentElement === tabList)).toBe(true);
    expect(addButton.parentElement).toBe(header);
    expect(addButton.parentElement).not.toBe(tabList);
  });
});
