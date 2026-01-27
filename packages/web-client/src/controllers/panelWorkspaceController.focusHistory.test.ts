// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { PanelHostController } from './panelHostController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { PanelWorkspaceController } from './panelWorkspaceController';
import type { LayoutPersistence } from '@assistant/shared';

const createStubPanel: PanelFactory = () => ({
  mount: () => ({
    unmount: vi.fn(),
  }),
});

const buildLayout = (): LayoutPersistence => ({
  layout: {
    kind: 'split',
    splitId: 'root',
    direction: 'horizontal',
    sizes: [1, 1],
    children: [
      { kind: 'panel', panelId: 'time-1' },
      {
        kind: 'split',
        splitId: 'right',
        direction: 'vertical',
        sizes: [1, 1],
        children: [
          { kind: 'panel', panelId: 'notes-1' },
          { kind: 'panel', panelId: 'time-2' },
        ],
      },
    ],
  },
  panels: {
    'time-1': { panelId: 'time-1', panelType: 'time-tracker' },
    'notes-1': { panelId: 'notes-1', panelType: 'notes' },
    'time-2': { panelId: 'time-2', panelType: 'time-tracker' },
  },
  headerPanels: [],
  headerPanelSizes: {},
});

describe('PanelWorkspaceController focus history', () => {
  it('falls back to the most recent existing panel of the requested type', () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'time-tracker', title: 'Time Tracker' }, createStubPanel);
    registry.register({ type: 'notes', title: 'Notes' }, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      loadLayout: () => buildLayout(),
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    workspace.focusPanel('time-1');
    workspace.focusPanel('time-2');
    workspace.focusPanel('notes-1');

    workspace.closePanel('time-2');

    expect(workspace.focusLastPanelOfType('time-tracker')).toBe(true);
    expect(workspace.getActivePanelId()).toBe('time-1');
  });

  it('returns false when no panels of the type exist in history', () => {
    const registry = new PanelRegistry();
    registry.register({ type: 'time-tracker', title: 'Time Tracker' }, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const layout: LayoutPersistence = {
      layout: { kind: 'panel', panelId: 'time-1' },
      panels: { 'time-1': { panelId: 'time-1', panelType: 'time-tracker' } },
      headerPanels: [],
      headerPanelSizes: {},
    };
    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      loadLayout: () => layout,
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    expect(workspace.focusLastPanelOfType('diff')).toBe(false);
  });
});
