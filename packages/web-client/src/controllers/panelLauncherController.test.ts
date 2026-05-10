// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PanelLauncherController } from './panelLauncherController';
import { PanelRegistry, type PanelFactory } from './panelRegistry';
import { CHAT_PANEL_MANIFEST } from '../panels/chat/manifest';
import { INPUT_PANEL_MANIFEST } from '../panels/input/manifest';
import type { PanelWorkspaceController } from './panelWorkspaceController';

const createStubPanel: PanelFactory = () => ({
  mount: () => ({
    unmount: () => undefined,
  }),
});

const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
const waitForAnimationFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('PanelLauncherController compact picker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    document.body.innerHTML = '';
  });

  it('focuses the compact launcher and supports arrow/enter selection', () => {
    const launcherButton = document.createElement('button');
    const launcher = document.createElement('div');
    launcher.className = 'panel-launcher-overlay';
    launcher.innerHTML = `
      <div class="panel-launcher" role="dialog">
        <div class="panel-launcher-header"><h2 class="panel-launcher-title-text">Panels</h2></div>
        <div class="panel-launcher-search"><input id="search" /></div>
        <div class="panel-launcher-list"></div>
      </div>
    `;
    document.body.append(launcherButton, launcher);

    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);

    const panelWorkspace = {
      getPanelIdsByType: vi.fn(() => []),
      isPanelTypeOpen: vi.fn(() => false),
      getActivePanelId: vi.fn(() => 'panel-1'),
      focusPanel: vi.fn(),
      openPanel: vi.fn(() => 'input-1'),
      openSessionPickerForPanel: vi.fn(),
      openModalPanel: vi.fn(() => null),
      replacePanel: vi.fn(() => false),
      listHeaderPanelIds: vi.fn(() => []),
      getOpenHeaderPanelId: vi.fn(() => null),
      pinPanelById: vi.fn(),
      togglePanel: vi.fn(),
    } as unknown as PanelWorkspaceController;

    const controller = new PanelLauncherController({
      launcherButton,
      launcher,
      launcherList: launcher.querySelector('.panel-launcher-list'),
      launcherSearch: launcher.querySelector('#search'),
      launcherCloseButton: null,
      panelRegistry: registry,
      panelWorkspace,
    });
    controller.attach();

    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 240, 160));
    const launcherPanel = launcher.querySelector<HTMLElement>('.panel-launcher');
    expect(launcherPanel).not.toBeNull();
    if (!launcherPanel) {
      throw new Error('Missing launcher panel');
    }
    vi.spyOn(launcherPanel, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(100, 100, 280, 220),
    );

    controller.openWithPlacement({
      targetPanelId: 'panel-1',
      defaultPlacement: { region: 'center' },
      compact: true,
      anchor,
    });

    const searchInput = launcher.querySelector<HTMLInputElement>('#search');
    expect(launcher.querySelector('.panel-launcher-title-text')?.textContent).toBe('Add Tab');
    expect(launcherPanel.style.top).toBe(`${Math.round(window.innerHeight * 0.25)}px`);
    expect(document.activeElement).toBe(searchInput);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(panelWorkspace.openPanel).toHaveBeenCalledWith('input', {
      focus: true,
      placement: { region: 'center' },
      targetPanelId: 'panel-1',
    });
  });

  it('filters compact picker results from the search input', () => {
    const launcherButton = document.createElement('button');
    const launcher = document.createElement('div');
    launcher.className = 'panel-launcher-overlay';
    launcher.innerHTML = `
      <div class="panel-launcher" role="dialog">
        <div class="panel-launcher-header"><h2 class="panel-launcher-title-text">Panels</h2></div>
        <div class="panel-launcher-search"><input id="search" /></div>
        <div class="panel-launcher-list"></div>
      </div>
    `;
    document.body.append(launcherButton, launcher);

    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);

    const panelWorkspace = {
      getPanelIdsByType: vi.fn(() => []),
      isPanelTypeOpen: vi.fn(() => false),
      getActivePanelId: vi.fn(() => 'panel-1'),
      focusPanel: vi.fn(),
      openPanel: vi.fn(() => 'input-1'),
      openSessionPickerForPanel: vi.fn(),
      openModalPanel: vi.fn(() => null),
      replacePanel: vi.fn(() => false),
      listHeaderPanelIds: vi.fn(() => []),
      getOpenHeaderPanelId: vi.fn(() => null),
      pinPanelById: vi.fn(),
      togglePanel: vi.fn(),
    } as unknown as PanelWorkspaceController;

    const controller = new PanelLauncherController({
      launcherButton,
      launcher,
      launcherList: launcher.querySelector('.panel-launcher-list'),
      launcherSearch: launcher.querySelector('#search'),
      launcherCloseButton: null,
      panelRegistry: registry,
      panelWorkspace,
    });
    controller.attach();

    controller.openWithPlacement({
      targetPanelId: 'panel-1',
      defaultPlacement: { region: 'center' },
      compact: true,
      anchor: launcherButton,
    });

    const searchInput = launcher.querySelector<HTMLInputElement>('#search');
    if (!searchInput) {
      throw new Error('Missing search input');
    }
    searchInput.value = 'input';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(panelWorkspace.openPanel).toHaveBeenCalledWith('input', {
      focus: true,
      placement: { region: 'center' },
      targetPanelId: 'panel-1',
    });
  });

  it('uses the compact picker title and row submission for replace', async () => {
    const launcherButton = document.createElement('button');
    const launcher = document.createElement('div');
    launcher.className = 'panel-launcher-overlay';
    launcher.innerHTML = `
      <div class="panel-launcher" role="dialog">
        <div class="panel-launcher-header"><h2 class="panel-launcher-title-text">Panels</h2></div>
        <div class="panel-launcher-search"><input id="search" /></div>
        <div class="panel-launcher-list"></div>
      </div>
    `;
    document.body.append(launcherButton, launcher);

    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);

    const panelWorkspace = {
      getPanelIdsByType: vi.fn(() => []),
      isPanelTypeOpen: vi.fn(() => false),
      getActivePanelId: vi.fn(() => 'panel-1'),
      focusPanel: vi.fn(),
      openPanel: vi.fn(() => 'input-1'),
      openSessionPickerForPanel: vi.fn(),
      openModalPanel: vi.fn(() => null),
      replacePanel: vi.fn(() => true),
      listHeaderPanelIds: vi.fn(() => []),
      getOpenHeaderPanelId: vi.fn(() => null),
      pinPanelById: vi.fn(),
      togglePanel: vi.fn(),
    } as unknown as PanelWorkspaceController;

    const controller = new PanelLauncherController({
      launcherButton,
      launcher,
      launcherList: launcher.querySelector('.panel-launcher-list'),
      launcherSearch: launcher.querySelector('#search'),
      launcherCloseButton: null,
      panelRegistry: registry,
      panelWorkspace,
    });
    controller.attach();

    controller.openWithPlacement({
      replacePanelId: 'panel-1',
      compact: true,
      anchor: launcherButton,
    });

    expect(launcher.querySelector('.panel-launcher-title-text')?.textContent).toBe('Replace Panel');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitForAnimationFrame();

    expect(panelWorkspace.replacePanel).toHaveBeenCalledWith('panel-1', 'chat', {});
    expect(panelWorkspace.openSessionPickerForPanel).toHaveBeenCalledWith('panel-1');
  });

  it('passes chat auto-open session-picker intent when opening a new chat pane', async () => {
    const launcherButton = document.createElement('button');
    const launcher = document.createElement('div');
    launcher.className = 'panel-launcher-overlay';
    launcher.innerHTML = `
      <div class="panel-launcher" role="dialog">
        <div class="panel-launcher-header"><h2 class="panel-launcher-title-text">Panels</h2></div>
        <div class="panel-launcher-search"><input id="search" /></div>
        <div class="panel-launcher-list"></div>
      </div>
    `;
    document.body.append(launcherButton, launcher);

    const registry = new PanelRegistry();
    registry.register(CHAT_PANEL_MANIFEST, createStubPanel);
    registry.register(INPUT_PANEL_MANIFEST, createStubPanel);

    const panelWorkspace = {
      getPanelIdsByType: vi.fn(() => []),
      isPanelTypeOpen: vi.fn(() => false),
      getActivePanelId: vi.fn(() => 'panel-1'),
      focusPanel: vi.fn(),
      openPanel: vi.fn(() => 'chat-1'),
      openSessionPickerForPanel: vi.fn(),
      openModalPanel: vi.fn(() => null),
      replacePanel: vi.fn(() => false),
      listHeaderPanelIds: vi.fn(() => []),
      getOpenHeaderPanelId: vi.fn(() => null),
      pinPanelById: vi.fn(),
      togglePanel: vi.fn(),
    } as unknown as PanelWorkspaceController;

    const controller = new PanelLauncherController({
      launcherButton,
      launcher,
      launcherList: launcher.querySelector('.panel-launcher-list'),
      launcherSearch: launcher.querySelector('#search'),
      launcherCloseButton: null,
      panelRegistry: registry,
      panelWorkspace,
    });
    controller.attach();

    controller.openWithPlacement({
      targetPanelId: 'panel-1',
      defaultPlacement: { region: 'center' },
      compact: true,
      anchor: launcherButton,
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await waitForAnimationFrame();

    expect(panelWorkspace.openPanel).toHaveBeenCalledWith('chat', {
      focus: true,
      placement: { region: 'center' },
      targetPanelId: 'panel-1',
    });
    expect(panelWorkspace.openSessionPickerForPanel).toHaveBeenCalledWith('chat-1');
  });
});
