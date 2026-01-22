// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelChromeController } from './panelChromeController';
import type { PanelHost } from './panelRegistry';

const createHost = (): PanelHost =>
  ({
    panelId: () => 'panel-1',
    closePanel: vi.fn(),
  }) as unknown as PanelHost;

const createRoot = (includeInstance = false): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="panel-header panel-chrome-row" data-role="chrome-row">
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Test</span>
        ${includeInstance ? '<div class="panel-chrome-instance" data-role="instance-actions"><div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container"><button data-role="instance-trigger"><span data-role="instance-trigger-text"></span></button><div class="panel-chrome-instance-menu" data-role="instance-menu"><input data-role="instance-search" /><div data-role="instance-list"></div></div></div></div>' : ''}
      </div>
      <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
      <div class="panel-chrome-frame-controls" data-role="chrome-controls"></div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
};

describe('PanelChromeController', () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    document.body.innerHTML = '';
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    globalThis.cancelAnimationFrame = () => undefined;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    document.body.innerHTML = '';
  });

  it('marks the row as compact when content overflows', () => {
    const root = createRoot();
    const row = root.querySelector<HTMLElement>('[data-role="chrome-row"]');
    const main = root.querySelector<HTMLElement>('.panel-header-main');
    const plugin = root.querySelector<HTMLElement>('[data-role="chrome-plugin-controls"]');
    const frame = root.querySelector<HTMLElement>('[data-role="chrome-controls"]');
    if (!row || !main || !plugin || !frame) {
      throw new Error('Missing chrome row elements');
    }

    Object.defineProperty(row, 'clientWidth', { value: 120, configurable: true });
    Object.defineProperty(main, 'scrollWidth', { value: 80, configurable: true });
    Object.defineProperty(plugin, 'scrollWidth', { value: 80, configurable: true });
    Object.defineProperty(frame, 'scrollWidth', { value: 80, configurable: true });

    const controller = new PanelChromeController({ root, host: createHost(), title: 'Test' });
    controller.checkLayout();

    expect(row.classList.contains('chrome-row-compact')).toBe(true);

    controller.destroy();
  });

  it('expands from compact to stage-1 before default', () => {
    const root = createRoot();
    const row = root.querySelector<HTMLElement>('[data-role="chrome-row"]');
    const main = root.querySelector<HTMLElement>('.panel-header-main');
    const plugin = root.querySelector<HTMLElement>('[data-role="chrome-plugin-controls"]');
    const frame = root.querySelector<HTMLElement>('[data-role="chrome-controls"]');
    if (!row || !main || !plugin || !frame) {
      throw new Error('Missing chrome row elements');
    }

    Object.defineProperty(row, 'clientWidth', { value: 100, configurable: true });
    Object.defineProperty(main, 'scrollWidth', {
      get: () => (row.classList.contains('chrome-row-stage-1') ? 20 : 60),
      configurable: true,
    });
    Object.defineProperty(plugin, 'scrollWidth', { value: 40, configurable: true });
    Object.defineProperty(frame, 'scrollWidth', { value: 20, configurable: true });

    const controller = new PanelChromeController({ root, host: createHost(), title: 'Test' });
    controller.checkLayout();

    expect(row.classList.contains('chrome-row-compact')).toBe(true);

    Object.defineProperty(row, 'clientWidth', { value: 200, configurable: true });
    controller.checkLayout();

    expect(row.classList.contains('chrome-row-stage-1')).toBe(true);
    expect(row.classList.contains('chrome-row-compact')).toBe(false);

    controller.destroy();
  });

  it('hides instance actions when only one instance is available', () => {
    const root = createRoot(true);
    const instanceDropdownRoot = root.querySelector<HTMLElement>(
      '[data-role="instance-dropdown-container"]',
    );
    if (!instanceDropdownRoot) {
      throw new Error('Missing instance dropdown');
    }

    const controller = new PanelChromeController({
      root,
      host: createHost(),
      title: 'Test',
      onInstanceChange: () => undefined,
    });
    controller.setInstances([{ id: 'default', label: 'Default' }], ['default']);

    expect(instanceDropdownRoot.style.display).toBe('none');

    controller.destroy();
  });
});
