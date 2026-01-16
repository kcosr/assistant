// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { PanelHostController } from './panelHostController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { PanelWorkspaceController } from './panelWorkspaceController';
import { CHAT_PANEL_MANIFEST } from '../panels/chat/manifest';
import { INPUT_PANEL_MANIFEST } from '../panels/input/manifest';

describe('PanelWorkspaceController modal panels', () => {
  it('opens and closes modal panels', () => {
    const unmount = vi.fn();
    const createStubPanel: PanelFactory = () => ({
      mount: () => ({
        unmount,
      }),
    });

    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({ root, registry, host });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const panelId = workspace.openModalPanel('chat');
    expect(panelId).not.toBeNull();
    if (!panelId) {
      throw new Error('Expected modal panel id');
    }

    const overlay = document.querySelector<HTMLElement>('.panel-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains('open')).toBe(true);
    expect(overlay?.querySelector(`.panel-frame[data-panel-id="${panelId}"]`)).not.toBeNull();

    workspace.closePanel(panelId);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(document.body.contains(overlay as HTMLElement)).toBe(false);
  });

  it('does not close modal panels when another dialog is open', () => {
    const unmount = vi.fn();
    const createStubPanel: PanelFactory = () => ({
      mount: () => ({
        unmount,
      }),
    });

    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);

    const host = new PanelHostController({ registry });
    const root = document.createElement('div');
    document.body.appendChild(root);

    const workspace = new PanelWorkspaceController({ root, registry, host });
    host.setPanelWorkspace(workspace);
    workspace.attach();

    const panelId = workspace.openModalPanel('chat');
    expect(panelId).not.toBeNull();
    if (!panelId) {
      throw new Error('Expected modal panel id');
    }

    const dialogOverlay = document.createElement('div');
    dialogOverlay.className = 'confirm-dialog-overlay';
    document.body.appendChild(dialogOverlay);

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    document.dispatchEvent(escapeEvent);

    const overlay = document.querySelector<HTMLElement>('.panel-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.classList.contains('open')).toBe(true);
    expect(unmount).toHaveBeenCalledTimes(0);

    dialogOverlay.remove();
    workspace.closePanel(panelId);
    expect(unmount).toHaveBeenCalledTimes(1);
  });
});
