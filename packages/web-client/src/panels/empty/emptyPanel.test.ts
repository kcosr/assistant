// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

import { createEmptyPanel } from './emptyPanel';
import type { PanelHost } from '../../controllers/panelRegistry';

function buildHost(): PanelHost {
  return {
    panelId: () => 'empty-1',
    getBinding: () => null,
    setBinding: () => undefined,
    onBindingChange: () => () => undefined,
    setContext: () => undefined,
    getContext: () => null,
    subscribeContext: () => () => undefined,
    sendEvent: () => undefined,
    getSessionContext: () => null,
    subscribeSessionContext: () => () => undefined,
    updateSessionAttributes: async () => undefined,
    setPanelMetadata: () => undefined,
    persistPanelState: () => undefined,
    loadPanelState: () => null,
    openPanel: () => null,
    openModalPanel: () => null,
    closePanel: () => undefined,
    activatePanel: () => undefined,
    movePanel: () => undefined,
    openPanelMenu: () => undefined,
    startPanelDrag: () => undefined,
    startPanelReorder: () => undefined,
    openPanelLauncher: vi.fn(),
    closeSplit: () => undefined,
  };
}

describe('empty panel', () => {
  it('opens the compact replace picker from the replace button', () => {
    const module = createEmptyPanel()();
    const container = document.createElement('div');
    const host = buildHost();

    module.mount(container, host, {});

    const button = container.querySelector<HTMLButtonElement>('.panel-empty-button');
    expect(button?.textContent).toBe('Replace panel');
    expect(button?.getAttribute('aria-label')).toBe('Replace empty panel');
    if (!button) {
      throw new Error('Missing replace button');
    }

    button.click();

    expect(host.openPanelLauncher).toHaveBeenCalledWith({
      replacePanelId: 'empty-1',
      compact: true,
      anchor: button,
    });
  });
});
