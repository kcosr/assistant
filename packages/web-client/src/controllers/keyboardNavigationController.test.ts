// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { KeyboardNavigationController } from './keyboardNavigationController';
import type { KeyboardNavigationControllerOptions } from './keyboardNavigationController';
import type { PanelWorkspaceController } from './panelWorkspaceController';
import type { DialogManager } from './dialogManager';

function buildPanelWorkspace(
  panelFrame: HTMLElement,
  headerPanels: string[] = [],
  openHeaderPanelId: string | null = null,
  panelType: string | null = null,
): PanelWorkspaceController {
  const layoutRoot = { kind: 'panel', panelId: 'panel-1' };
  return {
    focusNextPanel: vi.fn(),
    getActivePanelId: vi.fn(() => 'panel-1'),
    getPanelFrameElement: vi.fn((panelId: string) =>
      panelId === 'panel-1' ? panelFrame : null,
    ),
    getLayoutRoot: vi.fn(() => layoutRoot),
    cycleTabForPanel: vi.fn(() => null),
    toggleSplitViewModeForPanelId: vi.fn(),
    activatePanel: vi.fn(),
    closePanelToPlaceholder: vi.fn(),
    closePanel: vi.fn(),
    togglePanel: vi.fn(),
    isPanelTypeOpen: vi.fn(() => false),
    openPanel: vi.fn(() => null),
    focusLastPanelOfType: vi.fn(() => false),
    listHeaderPanelIds: vi.fn(() => headerPanels),
    toggleHeaderPanelById: vi.fn(),
    openHeaderPanel: vi.fn(),
    getHeaderDockButton: vi.fn(() => null),
    getHeaderDockRoot: vi.fn(() => null),
    getOpenHeaderPanelId: vi.fn(() => openHeaderPanelId),
    getHeaderPopoverElement: vi.fn(() => null),
    getPanelType: vi.fn((panelId: string) => (panelId === 'panel-1' ? panelType : null)),
  } as unknown as PanelWorkspaceController;
}

function buildOptions(
  panelFrame: HTMLElement,
  headerPanels: string[] = [],
  openHeaderPanelId: string | null = null,
  panelType: string | null = null,
): KeyboardNavigationControllerOptions {
  const panelWorkspace = buildPanelWorkspace(
    panelFrame,
    headerPanels,
    openHeaderPanelId,
    panelType,
  );
  return {
    getAgentSidebar: () => null,
    getAgentSidebarSections: () => null,
    panelWorkspace,
    dialogManager: {
      hasOpenDialog: false,
      showConfirmDialog: vi.fn(),
      showTextInputDialog: vi.fn(),
    } as unknown as DialogManager,
    isKeyboardShortcutsEnabled: () => true,
    getSpeechAudioController: () => null,
    cancelAllActiveOperations: () => false,
    startPushToTalk: async () => {},
    stopPushToTalk: () => {},
    focusInput: () => {},
    getInputEl: () => null,
    getActiveChatRuntime: () => null,
    openCommandPalette: () => {},
    openChatSessionPicker: () => false,
    openChatModelPicker: () => false,
    openChatThinkingPicker: () => false,
    openPanelInstancePicker: () => false,
    getFocusedSessionId: () => null,
    setFocusedSessionId: () => {},
    isSidebarFocused: () => false,
    isMobileViewport: () => false,
    selectSession: () => {},
    showDeleteConfirmation: () => {},
    touchSession: async () => {},
    showClearHistoryConfirmation: () => {},
  };
}

function attachShortcutRegistry(
  controller: KeyboardNavigationController,
  options?: { panelNavigation?: boolean },
): { detach: () => void } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (controller as any).registerShortcuts();
  if (options?.panelNavigation) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).attachPanelNavigation();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registry = (controller as any).shortcutRegistry;
  registry.attach();
  return {
    detach: () => registry.detach(),
  };
}

describe('KeyboardNavigationController panel shortcuts', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('toggles layout navigation on ctrl+p when panel is focused', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const controller = new KeyboardNavigationController(buildOptions(panelFrame));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).registerShortcuts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (controller as any).shortcutRegistry;
    registry.attach();

    panelFrame.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );

    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(true);

    registry.detach();
  });

  it('toggles layout navigation on ctrl+p when body is focused and panel is active', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const controller = new KeyboardNavigationController(buildOptions(panelFrame));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).registerShortcuts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (controller as any).shortcutRegistry;
    registry.attach();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );

    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(true);

    registry.detach();
  });

  it('toggles layout navigation on ctrl+p when no panel is active', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame);
    options.panelWorkspace.getActivePanelId = vi.fn(() => null);

    const controller = new KeyboardNavigationController(options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).registerShortcuts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (controller as any).shortcutRegistry;
    registry.attach();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );

    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(true);

    registry.detach();
  });

  it('does not toggle layout navigation when target is editable', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    const input = document.createElement('input');
    panelFrame.appendChild(input);
    document.body.appendChild(panelFrame);

    const controller = new KeyboardNavigationController(buildOptions(panelFrame));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).registerShortcuts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (controller as any).shortcutRegistry;
    registry.attach();

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );

    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(false);

    registry.detach();
  });

  it('toggles header navigation on ctrl+h when panel is focused', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const controller = new KeyboardNavigationController(buildOptions(panelFrame));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).registerShortcuts();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (controller as any).shortcutRegistry;
    registry.attach();

    panelFrame.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }),
    );

    expect(document.body.classList.contains('panel-nav-header-active')).toBe(true);

    registry.detach();
  });

  it('does not cancel active operations when pinned chat panel is open', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame, [], 'panel-1', 'chat');
    const cancelAllActiveOperations = vi.fn(() => true);
    options.cancelAllActiveOperations = cancelAllActiveOperations;

    const controller = new KeyboardNavigationController(options);
    const registry = attachShortcutRegistry(controller);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(cancelAllActiveOperations).not.toHaveBeenCalled();

    registry.detach();
  });

  it('does not cancel active operations when modal chat panel is open', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame panel-frame-modal is-active';
    panelFrame.dataset['panelId'] = 'panel-1';

    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'panel-modal-overlay open';
    modalOverlay.appendChild(panelFrame);
    document.body.appendChild(modalOverlay);

    const options = buildOptions(panelFrame, [], null, 'chat');
    const cancelAllActiveOperations = vi.fn(() => true);
    options.cancelAllActiveOperations = cancelAllActiveOperations;

    const controller = new KeyboardNavigationController(options);
    const registry = attachShortcutRegistry(controller);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(cancelAllActiveOperations).not.toHaveBeenCalled();

    registry.detach();
  });

  it('cancels active operations for standard chat panels', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame, [], null, 'chat');
    const cancelAllActiveOperations = vi.fn(() => true);
    options.cancelAllActiveOperations = cancelAllActiveOperations;

    const controller = new KeyboardNavigationController(options);
    const registry = attachShortcutRegistry(controller);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(cancelAllActiveOperations).toHaveBeenCalledTimes(1);

    registry.detach();
  });

  it('starts split placement on ctrl+s and inserts an empty panel on enter', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame);
    const controller = new KeyboardNavigationController(options);
    const registry = attachShortcutRegistry(controller, { panelNavigation: true });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
    );

    expect(document.body.classList.contains('panel-split-placement-active')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(options.panelWorkspace.openPanel).toHaveBeenCalledWith('empty', {
      focus: true,
      placement: { region: 'bottom' },
      targetPanelId: 'panel-1',
    });
    expect(document.body.classList.contains('panel-split-placement-active')).toBe(false);
    registry.detach();
  });

  it('changes split placement region with arrow keys', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame);
    const controller = new KeyboardNavigationController(options);
    const registry = attachShortcutRegistry(controller, { panelNavigation: true });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
    );

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(options.panelWorkspace.openPanel).toHaveBeenCalledWith('empty', {
      focus: true,
      placement: { region: 'left' },
      targetPanelId: 'panel-1',
    });
    registry.detach();
  });

  it('does not start split placement without an active panel', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame);
    options.panelWorkspace.getActivePanelId = vi.fn(() => null);

    const controller = new KeyboardNavigationController(options);
    const registry = attachShortcutRegistry(controller, { panelNavigation: true });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }),
    );

    expect(document.body.classList.contains('panel-split-placement-active')).toBe(false);
    expect(options.panelWorkspace.openPanel).not.toHaveBeenCalled();
    registry.detach();
  });

  it('exits layout navigation on ctrl+p while active', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const controller = new KeyboardNavigationController(buildOptions(panelFrame));
    const registry = attachShortcutRegistry(controller);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(false);
    registry.detach();
  });

  it('switches layout navigation to header navigation on ctrl+h', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const controller = new KeyboardNavigationController(
      buildOptions(panelFrame, ['header-1', 'header-2'], null),
    );
    const registry = attachShortcutRegistry(controller);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(true);

    panelFrame.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(false);
    expect(document.body.classList.contains('panel-nav-header-active')).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-header-active')).toBe(false);
    registry.detach();
  });

  it('switches header navigation to layout navigation on ctrl+p', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const controller = new KeyboardNavigationController(
      buildOptions(panelFrame, ['header-1', 'header-2'], null),
    );
    const registry = attachShortcutRegistry(controller);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-header-active')).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-header-active')).toBe(false);
    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(true);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true }),
    );
    expect(document.body.classList.contains('panel-nav-layout-active')).toBe(false);
    registry.detach();
  });

  it('cycles header panels with left/right and a/d', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame, ['header-1', 'header-2', 'header-3'], 'header-1');
    const controller = new KeyboardNavigationController(options);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).startHeaderNavigation();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).handleHeaderNavigationKey(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    expect(options.panelWorkspace.toggleHeaderPanelById).toHaveBeenLastCalledWith('header-1');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).handleHeaderNavigationKey(new KeyboardEvent('keydown', { key: 'a' }));
    expect(options.panelWorkspace.toggleHeaderPanelById).toHaveBeenLastCalledWith('header-3');
  });

  it('confirms header selection on Enter', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame, ['header-1', 'header-2'], null);
    const controller = new KeyboardNavigationController(options);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).startHeaderNavigation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).handleHeaderNavigationKey(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).handleHeaderNavigationKey(
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );

    expect(options.panelWorkspace.activatePanel).toHaveBeenLastCalledWith('header-1');
    expect(document.body.classList.contains('panel-nav-header-active')).toBe(false);
  });

  it('confirms header selection on ArrowDown', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame, ['header-1', 'header-2'], null);
    const controller = new KeyboardNavigationController(options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).startHeaderNavigation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).handleHeaderNavigationKey(
      new KeyboardEvent('keydown', { key: 'ArrowRight' }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).handleHeaderNavigationKey(
      new KeyboardEvent('keydown', { key: 'ArrowDown' }),
    );

    expect(options.panelWorkspace.activatePanel).toHaveBeenLastCalledWith('header-1');
    expect(document.body.classList.contains('panel-nav-header-active')).toBe(false);
  });

  it('closes modal before confirming header selection', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const overlay = document.createElement('div');
    overlay.className = 'panel-modal-overlay open';
    document.body.appendChild(overlay);

    const options = buildOptions(panelFrame, ['header-1'], null);
    const controller = new KeyboardNavigationController(options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).startHeaderNavigation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (controller as any).handleHeaderNavigationKey(
      new KeyboardEvent('keydown', { key: 'Enter' }),
    );

    expect(options.panelWorkspace.closePanel).toHaveBeenCalled();
    expect(options.panelWorkspace.activatePanel).toHaveBeenLastCalledWith('header-1');
  });
});

describe('KeyboardNavigationController chat shortcuts', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('toggles input focus on ctrl+i', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const input = document.createElement('input');
    document.body.appendChild(input);

    const options = buildOptions(panelFrame);
    options.getInputEl = () => input;
    options.focusInput = () => input.focus();

    const controller = new KeyboardNavigationController(options);
    const { detach } = attachShortcutRegistry(controller);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(input);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true }),
    );
    expect(document.activeElement).not.toBe(input);

    detach();
  });

  it('focuses the last time tracker panel on ctrl+t', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const options = buildOptions(panelFrame);
    const panelWorkspace = options.panelWorkspace as unknown as {
      focusLastPanelOfType: ReturnType<typeof vi.fn>;
    };
    panelWorkspace.focusLastPanelOfType = vi.fn(() => true);

    const controller = new KeyboardNavigationController(options);
    const { detach } = attachShortcutRegistry(controller);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true }),
    );
    expect(panelWorkspace.focusLastPanelOfType).toHaveBeenCalledWith('time-tracker');

    detach();
  });

  it('opens chat session picker on "s" when chat panel is active and input is not focused', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const input = document.createElement('input');
    document.body.appendChild(input);

    let opened = false;
    const options = buildOptions(panelFrame, [], null, 'chat');
    options.getInputEl = () => input;
    options.openChatSessionPicker = () => {
      opened = true;
      return true;
    };

    const controller = new KeyboardNavigationController(options);
    const { detach } = attachShortcutRegistry(controller);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(opened).toBe(true);

    detach();
  });

  it('does not open chat session picker when input is focused', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    let opened = false;
    const options = buildOptions(panelFrame, [], null, 'chat');
    options.getInputEl = () => input;
    options.openChatSessionPicker = () => {
      opened = true;
      return true;
    };

    const controller = new KeyboardNavigationController(options);
    const { detach } = attachShortcutRegistry(controller);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }));
    expect(opened).toBe(false);

    detach();
  });
});

describe('KeyboardNavigationController panel header shortcuts', () => {
  beforeEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('opens the active panel instance picker on "i"', () => {
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.dataset['panelId'] = 'panel-1';
    document.body.appendChild(panelFrame);

    let opened = false;
    const options = buildOptions(panelFrame);
    options.openPanelInstancePicker = () => {
      opened = true;
      return true;
    };

    const controller = new KeyboardNavigationController(options);
    const { detach } = attachShortcutRegistry(controller);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
    expect(opened).toBe(true);

    detach();
  });
});
