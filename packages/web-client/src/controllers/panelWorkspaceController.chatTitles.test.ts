// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import type { LayoutPersistence } from '@assistant/shared';

import { PanelHostController } from './panelHostController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { PanelWorkspaceController } from './panelWorkspaceController';

const createStubPanel: PanelFactory = () => ({
  mount: () => ({
    unmount: () => undefined,
  }),
});

const pane = (
  paneId: string,
  panelIds: string[],
  activePanelId = panelIds[0] ?? '',
): LayoutPersistence['layout'] => ({
  kind: 'pane',
  paneId,
  tabs: panelIds.map((panelId) => ({ panelId })),
  activePanelId,
});

function getTabLabel(root: HTMLElement, panelId: string): string | null {
  return (
    root.querySelector<HTMLButtonElement>(`.panel-tab-button[data-panel-id="${panelId}"]`)
      ?.textContent ?? null
  );
}

describe('PanelWorkspaceController chat tab titles', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('updates the chat tab title immediately when a fixed session binding is selected', () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'chat', title: 'Chat' }, createStubPanel);

    let workspace: PanelWorkspaceController;
    const host = new PanelHostController({
      registry,
      onPanelBindingChange: (panelId, binding) => {
        workspace.updatePanelBinding(panelId, binding);
      },
    });
    const root = document.createElement('div');
    document.body.appendChild(root);
    host.setContext('session.summaries', [{ sessionId: 'ba3b97f0-example', name: 'Assistant' }]);
    host.setContext('agent.summaries', []);

    workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      getSynthesizedPanelTitlesEnabled: () => true,
      loadLayout: () => ({
        layout: pane('pane-1', ['chat-1']),
        panels: {
          'chat-1': {
            panelId: 'chat-1',
            panelType: 'chat',
          },
        },
        headerPanels: [],
        headerPanelSizes: {},
      }),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    expect(getTabLabel(root, 'chat-1')).toBe('Chat');

    host.setPanelBinding('chat-1', { mode: 'fixed', sessionId: 'ba3b97f0-example' });

    expect(getTabLabel(root, 'chat-1')).toBe('Assistant (ba3b97f0)');
  });

  it('refreshes existing bound chat tab titles when session summaries change', () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'chat', title: 'Chat' }, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);
    host.setContext('session.summaries', [{ sessionId: 'ba3b97f0-example' }]);
    host.setContext('agent.summaries', []);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      getSynthesizedPanelTitlesEnabled: () => true,
      loadLayout: () => ({
        layout: pane('pane-1', ['chat-1']),
        panels: {
          'chat-1': {
            panelId: 'chat-1',
            panelType: 'chat',
            binding: { mode: 'fixed', sessionId: 'ba3b97f0-example' },
          },
        },
        headerPanels: [],
        headerPanelSizes: {},
      }),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    expect(getTabLabel(root, 'chat-1')).toBe('ba3b97f0');

    host.setContext('session.summaries', [{ sessionId: 'ba3b97f0-example', name: 'Assistant' }]);
    workspace.refreshPanelTitles();

    expect(getTabLabel(root, 'chat-1')).toBe('Assistant (ba3b97f0)');
  });
});
