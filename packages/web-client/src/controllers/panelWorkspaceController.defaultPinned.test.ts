// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { PanelHostController } from './panelHostController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { CHAT_PANEL_MANIFEST } from '../panels/chat/manifest';
import { SESSIONS_PANEL_MANIFEST } from '../panels/sessions/manifest';
import { WORKSPACE_NAVIGATOR_PANEL_MANIFEST } from '../panels/workspaceNavigator/manifest';
import { collectPanelIds } from '../utils/layoutTree';
import { PanelWorkspaceController } from './panelWorkspaceController';

const createStubPanel: PanelFactory = () => ({
  mount: () => ({
    unmount: () => undefined,
  }),
});

describe('PanelWorkspaceController default pinned panels', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('pins default panels after availability is known', () => {
    const registry = new PanelRegistry();
    registry.register(SESSIONS_PANEL_MANIFEST, createStubPanel);
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(WORKSPACE_NAVIGATOR_PANEL_MANIFEST, createStubPanel);

    const availability = {
      types: null as Set<string> | null,
      capabilities: null as Set<string> | null,
    };

    const host = new PanelHostController({
      registry,
      getAvailablePanelTypes: () => availability.types,
      getAvailableCapabilities: () => availability.capabilities,
    });

    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
      getAvailablePanelTypes: () => availability.types,
      getAvailableCapabilities: () => availability.capabilities,
    });

    host.setPanelWorkspace(workspace);
    workspace.attach();

    expect(workspace.listHeaderPanelIds()).toEqual([]);

    availability.types = new Set(['chat', 'sessions', 'navigator']);
    availability.capabilities = new Set([
      'chat.read',
      'chat.write',
      'sessions.read',
      'sessions.write',
    ]);

    workspace.applyDefaultPinnedPanels();

    expect(workspace.listHeaderPanelIds()).toEqual(['sessions-1', 'navigator-1']);
    expect(collectPanelIds(workspace.getLayoutRoot())).toEqual(['chat-1']);
  });

  it('clears persisted panel state and remounts panels', () => {
    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    let mountCount = 0;
    let unmountCount = 0;
    registry.registerOrReplace(CHAT_PANEL_MANIFEST, () => ({
      mount: () => {
        mountCount += 1;
        return {
          unmount: () => {
            unmountCount += 1;
          },
        };
      },
    }));

    const workspace = new PanelWorkspaceController({
      root,
      registry,
      host,
    });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const panelId = 'chat-1';
    workspace.updatePanelState(panelId, { focused: true });
    expect(workspace.getLayout().panels[panelId]?.state).toEqual({ focused: true });

    workspace.resetPanelStates();

    expect(workspace.getLayout().panels[panelId]?.state).toBeUndefined();
    expect(mountCount).toBe(2);
    expect(unmountCount).toBe(1);
  });
});
