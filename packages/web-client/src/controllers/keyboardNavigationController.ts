import type { DialogManager } from './dialogManager';
import {
  KeyboardShortcutRegistry,
  type ModifierKey,
  cmdShiftShortcut,
  ctrlShortcut,
  isMacPlatform,
  plainShortcut,
} from '../utils/keyboardShortcuts';
import type { SpeechAudioController } from './speechAudioController';
import type { PanelWorkspaceController } from './panelWorkspaceController';
import type { ChatRuntime } from '../panels/chat/runtime';
import { collectVisiblePanelIdsInOrder } from '../utils/layoutTree';

export interface KeyboardNavigationControllerOptions {
  getAgentSidebar: () => HTMLElement | null;
  getAgentSidebarSections: () => HTMLElement | null;
  panelWorkspace: PanelWorkspaceController;
  dialogManager: DialogManager;
  shortcutRegistry?: KeyboardShortcutRegistry;
  isKeyboardShortcutsEnabled: () => boolean;
  getSpeechAudioController: () => SpeechAudioController | null;
  cancelAllActiveOperations: () => boolean;
  startPushToTalk: () => Promise<void>;
  stopPushToTalk: () => void;
  focusInput: () => void;
  getInputEl: () => HTMLInputElement | null;
  getActiveChatRuntime: () => ChatRuntime | null;
  openCommandPalette: () => void;
  openChatSessionPicker?: () => boolean;
  openChatModelPicker?: () => boolean;
  openChatThinkingPicker?: () => boolean;
  openPanelInstancePicker?: () => boolean;
  getFocusedSessionId: () => string | null;
  setFocusedSessionId: (id: string | null) => void;
  isSidebarFocused: () => boolean;
  isMobileViewport: () => boolean;
  selectSession: (sessionId: string) => void;
  showDeleteConfirmation: (sessionId: string, fromKeyboard?: boolean) => void;
  touchSession: (sessionId: string) => Promise<void>;
  showClearHistoryConfirmation: (sessionId: string) => void;
}

type FocusZone = 'sidebar' | 'input';
type ArrowDirection = 'left' | 'right' | 'up' | 'down';
type SplitPlacementRegion = 'left' | 'right' | 'top' | 'bottom';

interface LayoutNavState {
  mode: 'layout';
  panelId: string;
  page: number;
}

interface HeaderNavState {
  mode: 'header';
  page: number;
  index: number;
}

interface SplitPlacementState {
  mode: 'split';
  panelId: string;
  region: SplitPlacementRegion;
  overlay: HTMLElement;
  highlight: HTMLElement;
  cleanup: () => void;
}

export class KeyboardNavigationController {
  private readonly shortcutRegistry: KeyboardShortcutRegistry;
  private hasAttached = false;
  private layoutNavState: LayoutNavState | null = null;
  private headerNavState: HeaderNavState | null = null;
  private splitPlacementState: SplitPlacementState | null = null;
  private navOverlay: HTMLElement | null = null;
  private navHighlight: HTMLElement | null = null;
  private navBadges: HTMLElement[] = [];
  private headerNavBadges: HTMLElement[] = [];
  private navCleanup: (() => void) | null = null;

  constructor(private readonly options: KeyboardNavigationControllerOptions) {
    this.shortcutRegistry =
      this.options.shortcutRegistry ??
      new KeyboardShortcutRegistry({
        onConflict: (existing, incoming) => {
          console.warn(`[Keyboard] Shortcut conflict: "${incoming.id}" overwrites "${existing.id}"`);
        },
        isEnabled: () =>
          this.options.isKeyboardShortcutsEnabled() && !this.options.dialogManager.hasOpenDialog,
      });
  }

  attach(): void {
    if (this.hasAttached) {
      return;
    }
    this.hasAttached = true;

    this.registerShortcuts();
    this.attachTabNavigation();
    this.attachHeaderPanelSelection();
    this.attachPanelNavigation();
    this.attachMediaKeyLogging();
    this.shortcutRegistry.attach();
    this.attachSidebarNavigation();
  }

  setFocusedSessionItem(item: HTMLElement | null): void {
    const existing = this.getFocusedSessionItem();
    if (existing) {
      existing.classList.remove('focused');
    }
    if (item) {
      item.classList.add('focused');
      item.scrollIntoView({ block: 'nearest' });
      this.options.setFocusedSessionId(item.dataset['sessionId'] ?? null);
    } else {
      this.options.setFocusedSessionId(null);
    }
  }

  private getFocusedSessionItem(): HTMLElement | null {
    return (
      this.options
        .getAgentSidebarSections()
        ?.querySelector('.agent-sidebar-session-item.focused') ??
      null
    );
  }

  getAllSessionItems(): HTMLElement[] {
    const container = this.options.getAgentSidebarSections();
    if (!container) return [];
    return Array.from(container.querySelectorAll('.agent-sidebar-session-item'));
  }

  focusZone(zone: FocusZone): void {
    switch (zone) {
      case 'sidebar': {
        const sidebar = this.options.getAgentSidebar();
        if (sidebar) {
          sidebar.focus();
          const items = this.getAllSessionItems();
          const activeItem = items.find((el) => el.classList.contains('active'));
          this.setFocusedSessionItem(activeItem ?? items[0] ?? null);
        }
        break;
      }
      case 'input':
        this.options.focusInput();
        this.setFocusedSessionItem(null);
        break;
    }
  }

  private getCurrentFocusZone(): FocusZone {
    return this.options.isSidebarFocused() ? 'sidebar' : 'input';
  }

  private cycleFocusZone(reverse: boolean): void {
    const zones: FocusZone[] = ['sidebar', 'input'];
    const currentIndex = zones.indexOf(this.getCurrentFocusZone());
    const nextIndex = reverse
      ? (currentIndex - 1 + zones.length) % zones.length
      : (currentIndex + 1) % zones.length;
    const nextZone = zones[nextIndex];
    if (nextZone) {
      this.focusZone(nextZone);
    }
  }

  private registerShortcuts(): void {
    const { panelWorkspace } = this.options;
    const layoutNavModifiers: ModifierKey[] = isMacPlatform()
      ? ['ctrl', 'meta', 'shift']
      : ['ctrl', 'shift', 'alt'];

    this.shortcutRegistry.register({
      id: 'open-command-palette',
      key: 'k',
      modifiers: ['ctrl'],
      cmdOrCtrl: true,
      description: 'Open command palette',
      handler: () => {
        this.options.openCommandPalette();
      },
    });
    if (isMacPlatform()) {
      this.shortcutRegistry.register(
        ctrlShortcut('open-command-palette-ctrl', 'k', 'Open command palette', () => {
          this.options.openCommandPalette();
        }),
      );
    }

    this.shortcutRegistry.register(
      ctrlShortcut('toggle-layout-navigation', 'p', 'Toggle layout navigation mode', (event) => {
        if (!this.preparePanelNavigationShortcut({ closeModal: true })) {
          return false;
        }
        if (!this.canHandlePanelNavigationShortcut(event)) {
          return false;
        }
        this.toggleLayoutNavigation();
      }),
    );

    this.shortcutRegistry.register(
      ctrlShortcut(
        'toggle-header-navigation',
        'h',
        'Toggle header panel navigation mode',
        (event) => {
          if (!this.preparePanelNavigationShortcut({ closeModal: false })) {
            return false;
          }
          if (!this.canHandlePanelNavigationShortcut(event)) {
            return false;
          }
          this.toggleHeaderNavigation();
        },
      ),
    );

    this.shortcutRegistry.register({
      id: 'cycle-panel-forward',
      key: ']',
      modifiers: ['ctrl'],
      cmdOrCtrl: true,
      description: 'Cycle panel focus forward',
      handler: () => {
        panelWorkspace.focusNextPanel(false);
      },
    });

    this.shortcutRegistry.register({
      id: 'cycle-panel-backward',
      key: '[',
      modifiers: ['ctrl'],
      cmdOrCtrl: true,
      description: 'Cycle panel focus backward',
      handler: () => {
        panelWorkspace.focusNextPanel(true);
      },
    });

    this.shortcutRegistry.register({
      id: 'close-active-panel',
      key: 'w',
      modifiers: layoutNavModifiers,
      cmdOrCtrl: false,
      description: 'Close active panel',
      handler: () => {
        const activePanelId = panelWorkspace.getActivePanelId();
        if (!activePanelId) {
          return false;
        }
        panelWorkspace.closePanelToPlaceholder(activePanelId);
      },
    });

    this.shortcutRegistry.register({
      id: 'remove-active-panel',
      key: 'x',
      modifiers: layoutNavModifiers,
      cmdOrCtrl: false,
      description: 'Remove active panel',
      handler: () => {
        const activePanelId = panelWorkspace.getActivePanelId();
        if (!activePanelId) {
          return false;
        }
        panelWorkspace.closePanel(activePanelId);
      },
    });

    this.shortcutRegistry.register(
      cmdShiftShortcut('toggle-sidebar', 's', 'Toggle sidebar', () => {
        panelWorkspace.togglePanel('sessions');
      }),
    );

    this.shortcutRegistry.register(
      cmdShiftShortcut('toggle-chat', 'c', 'Toggle chat panel', () => {
        panelWorkspace.togglePanel('chat');
      }),
    );

    this.shortcutRegistry.register(
      cmdShiftShortcut('chat-top', 'arrowup', 'Jump to top of chat', () => {
        const runtime = this.options.getActiveChatRuntime();
        if (panelWorkspace.isPanelTypeOpen('chat') && runtime) {
          runtime.chatScrollManager.scrollToTop();
        }
      }),
    );

    this.shortcutRegistry.register(
      cmdShiftShortcut('chat-bottom', 'arrowdown', 'Jump to bottom of chat', () => {
        const runtime = this.options.getActiveChatRuntime();
        if (panelWorkspace.isPanelTypeOpen('chat') && runtime) {
          runtime.chatScrollManager.scrollToBottom();
        }
      }),
    );

    this.shortcutRegistry.register(
      ctrlShortcut('split-panel', 's', 'Split active panel', (event) => {
        if (!this.preparePanelNavigationShortcut({ closeModal: true })) {
          return false;
        }
        if (!this.canHandlePanelNavigationShortcut(event)) {
          return false;
        }
        if (this.isTerminalKeyTarget(event)) {
          return false;
        }
        const activePanelId = panelWorkspace.getActivePanelId();
        if (!activePanelId) {
          return false;
        }
        if (this.splitPlacementState) {
          this.stopSplitPlacement();
          return true;
        }
        this.startSplitPlacement(activePanelId);
      }),
    );

    this.shortcutRegistry.register(
      ctrlShortcut(
        'toggle-input-focus',
        'i',
        'Toggle text input focus',
        () => {
          const inputEl = this.options.getInputEl();
          if (!inputEl) {
            return false;
          }
          if (document.activeElement === inputEl) {
            inputEl.blur();
            return true;
          }
          this.focusZone('input');
        },
        { bindingId: 'chat.toggle-input' },
      ),
    );

    this.shortcutRegistry.register(
      plainShortcut(
        'chat-open-session-picker',
        's',
        'Open chat session picker',
        () => {
          if (!this.canHandleChatPanelShortcut()) {
            return false;
          }
          return this.options.openChatSessionPicker?.() ?? false;
        },
        { bindingId: 'chat.open-session-picker' },
      ),
    );

    this.shortcutRegistry.register(
      plainShortcut(
        'chat-open-model-picker',
        'm',
        'Open chat model picker',
        () => {
          if (!this.canHandleChatPanelShortcut()) {
            return false;
          }
          return this.options.openChatModelPicker?.() ?? false;
        },
        { bindingId: 'chat.open-model-picker' },
      ),
    );

    this.shortcutRegistry.register(
      plainShortcut(
        'chat-open-thinking-picker',
        't',
        'Open chat thinking picker',
        () => {
          if (!this.canHandleChatPanelShortcut()) {
            return false;
          }
          return this.options.openChatThinkingPicker?.() ?? false;
        },
        { bindingId: 'chat.open-thinking-picker' },
      ),
    );

    this.shortcutRegistry.register(
      plainShortcut(
        'open-panel-instance-picker',
        'i',
        'Open panel instance picker',
        (event) => {
          if (!this.canHandlePanelHeaderShortcut(event)) {
            return false;
          }
          return this.options.openPanelInstancePicker?.() ?? false;
        },
        { bindingId: 'panel.header.instance' },
      ),
    );

    const toggleSpeechInput = (): boolean | void => {
      const controller = this.options.getSpeechAudioController();
      if (!controller?.hasSpeechInput) {
        return false;
      }
      if (controller.isSpeechActive) {
        this.options.stopPushToTalk();
        return;
      }
      if (this.options.cancelAllActiveOperations()) {
        return;
      }
      controller.setContinuousListeningMode(false);
      void this.options.startPushToTalk();
    };

    this.shortcutRegistry.register(
      ctrlShortcut('toggle-recording', 'r', 'Toggle speech recording', toggleSpeechInput),
    );

    this.shortcutRegistry.register(
      plainShortcut('toggle-recording-media', 'mediatracknext', 'Toggle speech recording', () =>
        toggleSpeechInput(),
      ),
    );

    this.shortcutRegistry.register(
      plainShortcut('cancel-all', 'escape', 'Cancel active operations', () => {
        if (this.shouldSkipCancelForChatPanelEscape()) {
          return false;
        }
        const cancelled = this.options.cancelAllActiveOperations();

        if (this.options.isMobileViewport()) {
          if (panelWorkspace.isPanelTypeOpen('sessions')) {
            panelWorkspace.togglePanel('sessions');
            return;
          }
        }

        if (!cancelled) {
          return false;
        }
      }),
    );
  }

  cancelNavigationModes(): boolean {
    const hadLayout = Boolean(this.layoutNavState);
    const hadHeader = Boolean(this.headerNavState);
    const hadSplit = Boolean(this.splitPlacementState);
    this.stopLayoutNavigation();
    this.stopHeaderNavigation();
    this.stopSplitPlacement();
    return hadLayout || hadHeader || hadSplit;
  }

  private attachPanelNavigation(): void {
    document.addEventListener(
      'pointerdown',
      (event: PointerEvent) => {
        if (!this.layoutNavState && !this.headerNavState && !this.splitPlacementState) {
          return;
        }
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }
        const frame = target.closest<HTMLElement>('.panel-frame');
        if (!frame) {
          return;
        }
        const panelId = frame.dataset['panelId'];
        if (!panelId) {
          return;
        }
        this.options.panelWorkspace.activatePanel(panelId);
        this.stopLayoutNavigation();
        this.stopHeaderNavigation();
        this.stopSplitPlacement();
      },
      true,
    );

    document.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (!this.options.isKeyboardShortcutsEnabled()) {
          return;
        }
        if (this.options.dialogManager.hasOpenDialog) {
          return;
        }
        if (!this.layoutNavState && !this.headerNavState && !this.splitPlacementState) {
          return;
        }
        const handled = this.handlePanelNavigationKey(event);
        if (handled) {
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        // Block keyboard events from reaching panels while navigation mode is active.
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }

  private attachHeaderPanelSelection(): void {
    document.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (!this.options.isKeyboardShortcutsEnabled()) {
          return;
        }
        if (this.options.dialogManager.hasOpenDialog) {
          return;
        }
        if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        const openPanelId = this.options.panelWorkspace.getOpenHeaderPanelId();
        if (!openPanelId) {
          return;
        }
        const popover = this.options.panelWorkspace.getHeaderPopoverElement();
        const target = event.target;
        if (!popover || !popover.classList.contains('open')) {
          return;
        }
        if (!(target instanceof Node)) {
          return;
        }
        if (!popover.contains(target)) {
          return;
        }
        if (target instanceof HTMLElement) {
          const tag = target.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea' || target.isContentEditable) {
            return;
          }
        }
        const activePanelId = this.options.panelWorkspace.getActivePanelId();
        if (activePanelId !== openPanelId) {
          this.options.panelWorkspace.activatePanel(openPanelId);
        }
        this.stopLayoutNavigation();
        this.stopHeaderNavigation();
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }

  private attachMediaKeyLogging(): void {
    const logEvent = (event: KeyboardEvent, eventType: 'keydown' | 'keyup') => {
      console.log(`[client] Media ${eventType}`, {
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        location: event.location,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
      });
    };

    document.addEventListener(
      'keydown',
      (event: KeyboardEvent) => {
        if (!this.isMediaKeyEvent(event)) {
          return;
        }
        logEvent(event, 'keydown');
      },
      true,
    );

    document.addEventListener(
      'keyup',
      (event: KeyboardEvent) => {
        if (!this.isMediaKeyEvent(event)) {
          return;
        }
        logEvent(event, 'keyup');
      },
      true,
    );
  }

  private handlePanelNavigationKey(event: KeyboardEvent): boolean {
    if (this.splitPlacementState) {
      return this.handleSplitPlacementKey(event);
    }
    if (this.handlePanelNavigationToggle(event)) {
      return true;
    }
    if (this.layoutNavState) {
      return this.handleLayoutNavigationKey(event);
    }
    if (this.headerNavState) {
      return this.handleHeaderNavigationKey(event);
    }
    return false;
  }

  private handlePanelNavigationToggle(event: KeyboardEvent): boolean {
    if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return false;
    }
    const key = event.key.toLowerCase();
    if (key !== 'p' && key !== 'h') {
      return false;
    }
    if (key === 'p') {
      if (this.layoutNavState) {
        this.stopLayoutNavigation();
        return true;
      }
      if (!this.preparePanelNavigationShortcut({ closeModal: true })) {
        return true;
      }
      this.startLayoutNavigation();
      return true;
    }
    if (this.headerNavState) {
      this.stopHeaderNavigation();
      return true;
    }
    if (!this.preparePanelNavigationShortcut({ closeModal: false })) {
      return true;
    }
    this.startHeaderNavigation();
    return true;
  }

  private isTerminalKeyTarget(event: KeyboardEvent): boolean {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('.terminal-panel')) {
      return true;
    }
    const active = document.activeElement;
    return active instanceof HTMLElement && Boolean(active.closest('.terminal-panel'));
  }

  private isMediaKeyEvent(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    const code = event.code.toLowerCase();
    return (
      key.startsWith('media') ||
      code.startsWith('media') ||
      key.startsWith('audio') ||
      code.startsWith('audio')
    );
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }
    if ((target as HTMLElement).isContentEditable) {
      return true;
    }
    return Boolean(
      target.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]',
      ),
    );
  }

  private isChatPanelActive(): boolean {
    const activePanelId = this.options.panelWorkspace.getActivePanelId();
    if (!activePanelId) {
      return false;
    }
    const panelType = this.options.panelWorkspace.getPanelType(activePanelId);
    return panelType === 'chat';
  }

  private isChatInputFocused(): boolean {
    const inputEl = this.options.getInputEl();
    return Boolean(inputEl && document.activeElement === inputEl);
  }

  private canHandleChatPanelShortcut(): boolean {
    if (!this.isChatPanelActive()) {
      return false;
    }
    if (this.isChatInputFocused()) {
      return false;
    }
    if (this.isEditableTarget(document.activeElement)) {
      return false;
    }
    return true;
  }

  private canHandlePanelHeaderShortcut(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) {
      return false;
    }
    const activePanelId = this.options.panelWorkspace.getActivePanelId();
    if (!activePanelId) {
      return false;
    }
    if (this.isEditableTarget(event.target) || this.isEditableTarget(document.activeElement)) {
      return false;
    }
    return true;
  }

  private preparePanelNavigationShortcut(options?: { closeModal?: boolean }): boolean {
    const blockingSelectors = [
      '.command-palette-overlay.open',
      '.workspace-switcher-overlay.open',
      '.session-picker-popover',
      '.panel-launcher-overlay.open',
      '.confirm-dialog-overlay',
      '#share-target-modal.visible',
    ];
    if (blockingSelectors.some((selector) => Boolean(document.querySelector(selector)))) {
      return false;
    }

    const openHeaderPanelId = this.options.panelWorkspace.getOpenHeaderPanelId();
    if (openHeaderPanelId) {
      this.options.panelWorkspace.toggleHeaderPanelById(openHeaderPanelId);
    }

    if (options?.closeModal !== false) {
      const modalOverlay = document.querySelector('.panel-modal-overlay.open');
      if (modalOverlay) {
        const activePanelId = this.options.panelWorkspace.getActivePanelId();
        if (activePanelId) {
          this.options.panelWorkspace.closePanel(activePanelId);
        }
      }
    }

    return true;
  }

  private canHandlePanelNavigationShortcut(event: KeyboardEvent): boolean {
    if (event.defaultPrevented) {
      return false;
    }
    if (this.isEditableTarget(event.target) || this.isEditableTarget(document.activeElement)) {
      return false;
    }
    const targetNode = event.target instanceof Node ? event.target : null;
    const activeNode = document.activeElement instanceof Node ? document.activeElement : null;
    const modalRoot = document.querySelector('.panel-modal');
    if (
      modalRoot &&
      ((targetNode && modalRoot.contains(targetNode)) ||
        (activeNode && modalRoot.contains(activeNode)))
    ) {
      return true;
    }
    const headerPopover = this.options.panelWorkspace.getHeaderPopoverElement();
    if (headerPopover) {
      if (
        (targetNode && headerPopover.contains(targetNode)) ||
        (activeNode && headerPopover.contains(activeNode))
      ) {
        return true;
      }
    }
    const activePanelId = this.options.panelWorkspace.getActivePanelId();
    if (activePanelId) {
      const frame = this.options.panelWorkspace.getPanelFrameElement(activePanelId);
      if (frame) {
        if (
          (targetNode && frame.contains(targetNode)) ||
          (activeNode && frame.contains(activeNode))
        ) {
          return true;
        }
      }
    }
    const isBodyTarget = targetNode === document.body || targetNode === document.documentElement;
    const isBodyActive = activeNode === document.body || activeNode === document.documentElement;
    if (isBodyTarget || isBodyActive) {
      return true;
    }
    const headerDockRoot = this.options.panelWorkspace.getHeaderDockRoot?.() ?? null;
    if (headerDockRoot) {
      if (
        (targetNode && headerDockRoot.contains(targetNode)) ||
        (activeNode && headerDockRoot.contains(activeNode))
      ) {
        return true;
      }
    }
    return true;
  }

  private toggleLayoutNavigation(): void {
    if (this.layoutNavState) {
      this.stopLayoutNavigation();
      return;
    }
    this.startLayoutNavigation();
  }

  private toggleHeaderNavigation(): void {
    if (this.headerNavState) {
      this.stopHeaderNavigation();
      return;
    }
    this.startHeaderNavigation();
  }

  private shouldSkipCancelForChatPanelEscape(): boolean {
    const { panelWorkspace } = this.options;
    const openHeaderPanelId = panelWorkspace.getOpenHeaderPanelId();
    if (openHeaderPanelId && panelWorkspace.getPanelType(openHeaderPanelId) === 'chat') {
      return true;
    }

    const modalFrame = document.querySelector<HTMLElement>(
      '.panel-modal-overlay.open .panel-frame[data-panel-id]',
    );
    const modalPanelId = modalFrame?.dataset['panelId'] ?? null;
    if (modalPanelId && panelWorkspace.getPanelType(modalPanelId) === 'chat') {
      return true;
    }

    const activePanelId = panelWorkspace.getActivePanelId();
    if (!activePanelId || panelWorkspace.getPanelType(activePanelId) !== 'chat') {
      return false;
    }
    const frame = panelWorkspace.getPanelFrameElement(activePanelId);
    return Boolean(frame?.classList.contains('panel-frame-modal'));
  }

  private startLayoutNavigation(): void {
    this.stopHeaderNavigation();
    this.stopSplitPlacement();
    const panelId = this.resolveInitialLayoutPanelId();
    if (!panelId) {
      return;
    }
    this.layoutNavState = { mode: 'layout', panelId, page: 0 };
    document.body.classList.add('panel-nav-layout-active');
    this.ensureNavOverlay();
    this.updateLayoutNavigationOverlay();
    this.startNavTracking();
  }

  private stopLayoutNavigation(): void {
    if (!this.layoutNavState) {
      return;
    }
    this.layoutNavState = null;
    document.body.classList.remove('panel-nav-layout-active');
    this.clearNavBadges();
    this.hideNavHighlight();
    this.stopNavTracking();
  }

  private startHeaderNavigation(): void {
    this.stopLayoutNavigation();
    this.stopSplitPlacement();
    const page = 0;
    const index = -1;
    this.headerNavState = { mode: 'header', page, index };
    document.body.classList.add('panel-nav-header-active');
    this.renderHeaderNavBadges();
  }

  private startSplitPlacement(panelId: string): void {
    this.stopLayoutNavigation();
    this.stopHeaderNavigation();
    this.stopSplitPlacement();

    const frame = this.options.panelWorkspace.getPanelFrameElement(panelId);
    if (!frame) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'panel-dock-overlay panel-split-overlay';

    const highlight = document.createElement('div');
    highlight.className = 'panel-dock-highlight';
    overlay.appendChild(highlight);

    document.body.appendChild(overlay);
    document.body.classList.add('panel-split-placement-active');

    const state: SplitPlacementState = {
      mode: 'split',
      panelId,
      region: 'bottom',
      overlay,
      highlight,
      cleanup: () => undefined,
    };
    this.splitPlacementState = state;

    const handle = () => {
      this.updateSplitPlacementOverlay();
    };
    window.addEventListener('resize', handle);
    document.addEventListener('scroll', handle, true);

    state.cleanup = () => {
      window.removeEventListener('resize', handle);
      document.removeEventListener('scroll', handle, true);
    };

    this.updateSplitPlacementOverlay();
  }

  private stopSplitPlacement(): void {
    if (!this.splitPlacementState) {
      return;
    }
    this.splitPlacementState.cleanup();
    this.splitPlacementState.overlay.remove();
    this.splitPlacementState = null;
    document.body.classList.remove('panel-split-placement-active');
  }

  private updateSplitPlacementOverlay(): void {
    const state = this.splitPlacementState;
    if (!state) {
      return;
    }
    const frame = this.options.panelWorkspace.getPanelFrameElement(state.panelId);
    if (!frame) {
      this.stopSplitPlacement();
      return;
    }
    const rect = frame.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      state.highlight.style.display = 'none';
      return;
    }
    const highlightRect = computeSplitPlacementHighlightRect(state.region, rect);
    this.applySplitPlacementHighlight(state.highlight, highlightRect);
  }

  private applySplitPlacementHighlight(
    highlight: HTMLElement,
    rect: { left: number; top: number; width: number; height: number },
  ): void {
    highlight.style.display = 'block';
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  private handleSplitPlacementKey(event: KeyboardEvent): boolean {
    const state = this.splitPlacementState;
    if (!state) {
      return false;
    }

    if (event.key === 'Escape') {
      this.stopSplitPlacement();
      return true;
    }

    if (event.key === 'Enter') {
      const panelId = state.panelId;
      if (panelId && this.options.panelWorkspace.getPanelFrameElement(panelId)) {
        this.options.panelWorkspace.openPanel('empty', {
          focus: true,
          placement: { region: state.region },
          targetPanelId: panelId,
        });
      }
      this.stopSplitPlacement();
      return true;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    const region = this.resolveSplitPlacementRegion(event.key);
    if (!region) {
      return false;
    }

    if (region !== state.region) {
      state.region = region;
      this.updateSplitPlacementOverlay();
    }

    return true;
  }

  private resolveSplitPlacementRegion(key: string): SplitPlacementRegion | null {
    const normalized = key.length === 1 ? key.toLowerCase() : key;
    switch (normalized) {
      case 'ArrowLeft':
      case 'a':
        return 'left';
      case 'ArrowRight':
      case 'd':
        return 'right';
      case 'ArrowUp':
      case 'w':
        return 'top';
      case 'ArrowDown':
      case 's':
        return 'bottom';
      default:
        return null;
    }
  }

  private stopHeaderNavigation(): void {
    if (!this.headerNavState) {
      return;
    }
    this.headerNavState = null;
    document.body.classList.remove('panel-nav-header-active');
    this.clearHeaderNavBadges();
  }

  private startNavTracking(): void {
    if (this.navCleanup) {
      return;
    }
    const handle = () => {
      if (this.layoutNavState) {
        this.updateLayoutNavigationOverlay();
      }
    };
    window.addEventListener('resize', handle);
    document.addEventListener('scroll', handle, true);
    this.navCleanup = () => {
      window.removeEventListener('resize', handle);
      document.removeEventListener('scroll', handle, true);
    };
  }

  private stopNavTracking(): void {
    if (!this.navCleanup) {
      return;
    }
    this.navCleanup();
    this.navCleanup = null;
  }

  private getVisiblePanelOrder(): string[] {
    return collectVisiblePanelIdsInOrder(this.options.panelWorkspace.getLayoutRoot());
  }

  private resolveInitialLayoutPanelId(): string | null {
    const panels = this.getVisiblePanelOrder();
    if (panels.length === 0) {
      return null;
    }
    const activePanelId = this.options.panelWorkspace.getActivePanelId();
    if (activePanelId && panels.includes(activePanelId)) {
      return activePanelId;
    }
    return panels[0] ?? null;
  }

  private setLayoutSelection(panelId: string): void {
    if (!this.layoutNavState) {
      return;
    }
    const panels = this.getVisiblePanelOrder();
    if (panels.length === 0) {
      return;
    }
    const normalized = panels.includes(panelId) ? panelId : panels[0];
    this.layoutNavState.panelId = normalized ?? panelId;
    const index = panels.indexOf(this.layoutNavState.panelId);
    const pageSize = 9;
    const nextPage = index >= 0 ? Math.floor(index / pageSize) : 0;
    this.layoutNavState.page = nextPage;
    this.updateLayoutNavigationOverlay();
  }

  private handleLayoutNavigationKey(event: KeyboardEvent): boolean {
    const state = this.layoutNavState;
    if (!state) {
      return false;
    }

    if (event.key === 'Escape') {
      this.stopLayoutNavigation();
      return true;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }

    if (event.key === 'Tab') {
      const nextPanelId = this.options.panelWorkspace.cycleTabForPanel(
        state.panelId,
        event.shiftKey,
      );
      if (nextPanelId) {
        this.setLayoutSelection(nextPanelId);
      }
      return true;
    }

    if (event.key === 'm') {
      this.options.panelWorkspace.toggleSplitViewModeForPanelId(state.panelId);
      this.setLayoutSelection(state.panelId);
      return true;
    }

    if (event.key === 'Enter') {
      return this.confirmLayoutSelection();
    }

    const lowerKey = event.key.toLowerCase();
    if (lowerKey === 'a' || lowerKey === 's' || lowerKey === 'd') {
      return this.moveLayoutSelection(lowerKey);
    }

    if (event.key.startsWith('Arrow')) {
      return this.moveLayoutSelection(event.key);
    }

    if (event.key === '0') {
      return this.advanceLayoutPage();
    }

    if (event.key >= '1' && event.key <= '9') {
      const index = Number.parseInt(event.key, 10) - 1;
      return this.selectLayoutChild(index);
    }

    return false;
  }

  private confirmLayoutSelection(): boolean {
    const state = this.layoutNavState;
    if (!state) {
      return false;
    }
    this.options.panelWorkspace.activatePanel(state.panelId);
    this.stopLayoutNavigation();
    return true;
  }

  private moveLayoutSelection(key: string): boolean {
    const state = this.layoutNavState;
    if (!state) {
      return false;
    }
    const panels = this.getVisiblePanelOrder();
    if (panels.length === 0) {
      return true;
    }
    const currentId = panels.includes(state.panelId) ? state.panelId : panels[0];
    if (!currentId) {
      return true;
    }
    const direction = this.resolveArrowDirection(key);
    if (!direction) {
      return true;
    }
    const nextPanelId = this.findSpatialNeighbor(currentId, panels, direction);
    if (nextPanelId) {
      this.setLayoutSelection(nextPanelId);
      return true;
    }
    return true;
  }

  private selectLayoutChild(relativeIndex: number): boolean {
    const state = this.layoutNavState;
    if (!state) {
      return false;
    }
    const panels = this.getVisiblePanelOrder();
    const pageSize = 9;
    const startIndex = state.page * pageSize;
    const targetIndex = startIndex + relativeIndex;
    if (targetIndex < 0 || targetIndex >= panels.length) {
      return true;
    }
    const panelId = panels[targetIndex];
    if (!panelId) {
      return true;
    }
    this.options.panelWorkspace.activatePanel(panelId);
    this.stopLayoutNavigation();
    return true;
  }

  private advanceLayoutPage(): boolean {
    const state = this.layoutNavState;
    if (!state) {
      return false;
    }
    const panels = this.getVisiblePanelOrder();
    const pageSize = 9;
    const totalPages = Math.max(1, Math.ceil(panels.length / pageSize));
    if (totalPages <= 1) {
      return true;
    }
    state.page = (state.page + 1) % totalPages;
    const nextIndex = state.page * pageSize;
    state.panelId = panels[nextIndex] ?? state.panelId;
    this.updateLayoutNavigationOverlay();
    return true;
  }

  private updateLayoutNavigationOverlay(): void {
    const state = this.layoutNavState;
    if (!state) {
      return;
    }
    const panels = this.getVisiblePanelOrder();
    if (panels.length === 0) {
      this.hideNavHighlight();
      this.clearNavBadges();
      return;
    }
    if (!panels.includes(state.panelId)) {
      state.panelId = panels[0] ?? state.panelId;
    }
    const selectedIndex = panels.indexOf(state.panelId);
    const anchor = this.options.panelWorkspace.getPanelFrameElement(state.panelId);
    if (anchor) {
      this.showNavHighlight(anchor.getBoundingClientRect());
    } else {
      this.hideNavHighlight();
    }

    this.clearNavBadges();
    const pageSize = 9;
    const totalPages = Math.max(1, Math.ceil(panels.length / pageSize));
    const nextPage = selectedIndex >= 0 ? Math.floor(selectedIndex / pageSize) : 0;
    state.page = Math.min(nextPage, Math.max(totalPages - 1, 0));
    if (state.page >= totalPages) {
      state.page = 0;
    }
    const startIndex = state.page * pageSize;
    const endIndex = Math.min(panels.length, startIndex + pageSize);

    for (let index = startIndex; index < endIndex; index += 1) {
      const panelId = panels[index];
      if (!panelId) {
        continue;
      }
      const anchorEl = this.options.panelWorkspace.getPanelFrameElement(panelId);
      if (!anchorEl) {
        continue;
      }
      const rect = anchorEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const badge = this.createNavBadge(String(index - startIndex + 1), rect);
      this.navBadges.push(badge);
    }
  }

  private resolveArrowDirection(key: string): ArrowDirection | null {
    switch (key) {
      case 'ArrowLeft':
      case 'a':
      case 's':
        return 'left';
      case 'ArrowRight':
      case 'd':
        return 'right';
      case 'ArrowUp':
        return 'up';
      case 'ArrowDown':
        return 'down';
      default:
        return null;
    }
  }

  private findSpatialNeighbor(
    currentId: string,
    panelIds: string[],
    direction: ArrowDirection,
  ): string | null {
    const currentEl = this.options.panelWorkspace.getPanelFrameElement(currentId);
    if (!currentEl) {
      return null;
    }
    const currentRect = currentEl.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const currentCenterY = currentRect.top + currentRect.height / 2;
    if (direction === 'right') {
      let bestId: string | null = null;
      let bestTopOffset = Number.POSITIVE_INFINITY;
      let bestDx = Number.POSITIVE_INFINITY;
      let bestDy = Number.POSITIVE_INFINITY;
      let overlapBestId: string | null = null;
      let overlapBestTop = Number.POSITIVE_INFINITY;
      let overlapBestGap = Number.POSITIVE_INFINITY;

      for (const panelId of panelIds) {
        if (panelId === currentId) {
          continue;
        }
        const el = this.options.panelWorkspace.getPanelFrameElement(panelId);
        if (!el) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        if (rect.left < currentRect.right - 1) {
          continue;
        }
        const centerX = rect.left + rect.width / 2;
        const dx = centerX - currentCenterX;
        const overlapsVertically = rect.bottom > currentRect.top && rect.top < currentRect.bottom;
        if (overlapsVertically) {
          const gap = Math.max(0, rect.left - currentRect.right);
          const top = rect.top;
          if (gap < overlapBestGap || (gap === overlapBestGap && top < overlapBestTop)) {
            overlapBestGap = gap;
            overlapBestTop = top;
            overlapBestId = panelId;
          }
          continue;
        }
        const topOffset = Math.abs(rect.top - currentRect.top);
        const absDx = Math.abs(dx);
        const absDy = Math.abs(rect.top + rect.height / 2 - currentCenterY);
        if (
          topOffset < bestTopOffset ||
          (topOffset === bestTopOffset && absDx < bestDx) ||
          (topOffset === bestTopOffset && absDx === bestDx && absDy < bestDy)
        ) {
          bestTopOffset = topOffset;
          bestDx = absDx;
          bestDy = absDy;
          bestId = panelId;
        }
      }

      return overlapBestId ?? bestId;
    }

    if (direction === 'left') {
      let bestId: string | null = null;
      let bestBottom = Number.NEGATIVE_INFINITY;
      let bestDx = Number.POSITIVE_INFINITY;
      let bestDy = Number.POSITIVE_INFINITY;
      let overlapBestId: string | null = null;
      let overlapBestGap = Number.POSITIVE_INFINITY;
      let overlapBestDy = Number.POSITIVE_INFINITY;

      for (const panelId of panelIds) {
        if (panelId === currentId) {
          continue;
        }
        const el = this.options.panelWorkspace.getPanelFrameElement(panelId);
        if (!el) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }
        if (rect.right > currentRect.left + 1) {
          continue;
        }
        const centerX = rect.left + rect.width / 2;
        const dx = centerX - currentCenterX;
        const overlapsVertically = rect.bottom > currentRect.top && rect.top < currentRect.bottom;
        if (overlapsVertically) {
          const gap = Math.max(0, currentRect.left - rect.right);
          const absDy = Math.abs(rect.top + rect.height / 2 - currentCenterY);
          if (gap < overlapBestGap || (gap === overlapBestGap && absDy < overlapBestDy)) {
            overlapBestGap = gap;
            overlapBestDy = absDy;
            overlapBestId = panelId;
          }
          continue;
        }
        const bottom = rect.bottom;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(rect.top + rect.height / 2 - currentCenterY);
        if (
          bottom > bestBottom ||
          (bottom === bestBottom && absDx < bestDx) ||
          (bottom === bestBottom && absDx === bestDx && absDy < bestDy)
        ) {
          bestBottom = bottom;
          bestDx = absDx;
          bestDy = absDy;
          bestId = panelId;
        }
      }

      return overlapBestId ?? bestId;
    }
    let bestId: string | null = null;
    let bestGap = Number.POSITIVE_INFINITY;
    let bestLeft = Number.POSITIVE_INFINITY;
    let bestDx = Number.POSITIVE_INFINITY;

    for (const panelId of panelIds) {
      if (panelId === currentId) {
        continue;
      }
      const el = this.options.panelWorkspace.getPanelFrameElement(panelId);
      if (!el) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      const overlapsHorizontally = rect.right > currentRect.left && rect.left < currentRect.right;
      if (!overlapsHorizontally) {
        continue;
      }
      if (direction === 'up') {
        if (rect.bottom > currentRect.top) {
          continue;
        }
      } else if (rect.top < currentRect.bottom) {
        continue;
      }
      const gap =
        direction === 'up' ? currentRect.top - rect.bottom : rect.top - currentRect.bottom;
      const absLeft = Math.abs(rect.left - currentRect.left);
      const absDx = Math.abs(rect.left + rect.width / 2 - currentCenterX);
      if (
        gap < bestGap ||
        (gap === bestGap && absLeft < bestLeft) ||
        (gap === bestGap && absLeft === bestLeft && absDx < bestDx)
      ) {
        bestGap = gap;
        bestLeft = absLeft;
        bestDx = absDx;
        bestId = panelId;
      }
    }

    return bestId;
  }

  private handleHeaderNavigationKey(event: KeyboardEvent): boolean {
    const state = this.headerNavState;
    if (!state) {
      return false;
    }
    if (event.key === 'Escape') {
      this.stopHeaderNavigation();
      return true;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return false;
    }
    const lowerKey = event.key.toLowerCase();
    if (event.key === 'ArrowLeft' || lowerKey === 'a') {
      return this.moveHeaderSelection(-1);
    }
    if (event.key === 'ArrowRight' || lowerKey === 'd') {
      return this.moveHeaderSelection(1);
    }
    if (event.key === 'ArrowDown') {
      return this.confirmHeaderSelection();
    }
    if (event.key === 'Enter') {
      return this.confirmHeaderSelection();
    }
    if (event.key === '0') {
      return this.advanceHeaderPage();
    }
    if (event.key >= '1' && event.key <= '9') {
      const index = Number.parseInt(event.key, 10) - 1;
      return this.activateHeaderPanel(index);
    }
    return false;
  }

  private confirmHeaderSelection(): boolean {
    const state = this.headerNavState;
    if (!state) {
      return false;
    }
    const headerPanels = this.options.panelWorkspace.listHeaderPanelIds();
    if (headerPanels.length === 0) {
      return true;
    }
    let panelId: string | null = null;
    if (state.index >= 0 && state.index < headerPanels.length) {
      panelId = headerPanels[state.index] ?? null;
    }
    if (!panelId) {
      panelId = this.options.panelWorkspace.getOpenHeaderPanelId();
    }
    if (!panelId) {
      panelId = headerPanels[0] ?? null;
    }
    if (!panelId) {
      return true;
    }
    const modalOverlay = document.querySelector('.panel-modal-overlay.open');
    if (modalOverlay) {
      const activePanelId = this.options.panelWorkspace.getActivePanelId();
      if (activePanelId) {
        this.options.panelWorkspace.closePanel(activePanelId);
      }
    }
    this.options.panelWorkspace.openHeaderPanel(panelId);
    this.options.panelWorkspace.activatePanel(panelId);
    this.stopHeaderNavigation();
    return true;
  }

  private advanceHeaderPage(): boolean {
    const state = this.headerNavState;
    if (!state) {
      return false;
    }
    const headerPanels = this.options.panelWorkspace.listHeaderPanelIds();
    if (headerPanels.length === 0) {
      return true;
    }
    const pageSize = 9;
    const totalPages = Math.max(1, Math.ceil(headerPanels.length / pageSize));
    if (totalPages <= 1) {
      return true;
    }
    state.page = (state.page + 1) % totalPages;
    const nextIndex = Math.min(state.page * pageSize, headerPanels.length - 1);
    state.index = nextIndex;
    this.renderHeaderNavBadges();
    return true;
  }

  private moveHeaderSelection(offset: -1 | 1): boolean {
    const state = this.headerNavState;
    if (!state) {
      return false;
    }
    const headerPanels = this.options.panelWorkspace.listHeaderPanelIds();
    if (headerPanels.length === 0) {
      return true;
    }
    const total = headerPanels.length;
    let nextIndex: number;
    if (state.index < 0) {
      nextIndex = offset > 0 ? 0 : total - 1;
    } else {
      nextIndex = (state.index + offset + total) % total;
    }
    const panelId = headerPanels[nextIndex];
    if (!panelId) {
      return true;
    }
    this.options.panelWorkspace.toggleHeaderPanelById(panelId);
    state.index = nextIndex;
    state.page = Math.floor(nextIndex / 9);
    this.renderHeaderNavBadges();
    return true;
  }

  private activateHeaderPanel(relativeIndex: number): boolean {
    const state = this.headerNavState;
    if (!state) {
      return false;
    }
    const headerPanels = this.options.panelWorkspace.listHeaderPanelIds();
    const pageSize = 9;
    const index = state.page * pageSize + relativeIndex;
    const panelId = headerPanels[index];
    if (!panelId) {
      return true;
    }
    this.options.panelWorkspace.toggleHeaderPanelById(panelId);
    state.index = index;
    state.page = Math.floor(index / pageSize);
    this.renderHeaderNavBadges();
    return true;
  }

  private renderHeaderNavBadges(): void {
    if (!this.headerNavState) {
      return;
    }
    this.clearHeaderNavBadges();
    const headerPanels = this.options.panelWorkspace.listHeaderPanelIds();
    const pageSize = 9;
    const totalPages = Math.max(1, Math.ceil(headerPanels.length / pageSize));
    if (this.headerNavState.page >= totalPages) {
      this.headerNavState.page = 0;
      this.headerNavState.index = 0;
    }
    const startIndex = this.headerNavState.page * pageSize;
    const endIndex = Math.min(headerPanels.length, startIndex + pageSize);
    for (let index = startIndex; index < endIndex; index += 1) {
      const panelId = headerPanels[index];
      if (!panelId) {
        continue;
      }
      const button = this.options.panelWorkspace.getHeaderDockButton(panelId);
      if (!button) {
        continue;
      }
      const badge = document.createElement('span');
      badge.className = 'panel-dock-badge';
      badge.textContent = String(index - startIndex + 1);
      button.appendChild(badge);
      this.headerNavBadges.push(badge);
    }
  }

  private clearHeaderNavBadges(): void {
    if (this.headerNavBadges.length === 0) {
      return;
    }
    for (const badge of this.headerNavBadges) {
      badge.remove();
    }
    this.headerNavBadges = [];
  }

  private ensureNavOverlay(): void {
    if (this.navOverlay) {
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'panel-nav-overlay';
    const highlight = document.createElement('div');
    highlight.className = 'panel-nav-highlight';
    overlay.appendChild(highlight);
    document.body.appendChild(overlay);
    this.navOverlay = overlay;
    this.navHighlight = highlight;
  }

  private showNavHighlight(rect: DOMRect): void {
    if (!this.navHighlight) {
      return;
    }
    this.navHighlight.style.display = 'block';
    this.navHighlight.style.left = `${rect.left}px`;
    this.navHighlight.style.top = `${rect.top}px`;
    this.navHighlight.style.width = `${rect.width}px`;
    this.navHighlight.style.height = `${rect.height}px`;
  }

  private hideNavHighlight(): void {
    if (this.navHighlight) {
      this.navHighlight.style.display = 'none';
    }
  }

  private clearNavBadges(): void {
    if (this.navBadges.length === 0) {
      return;
    }
    for (const badge of this.navBadges) {
      badge.remove();
    }
    this.navBadges = [];
  }

  private createNavBadge(label: string, rect: DOMRect): HTMLElement {
    this.ensureNavOverlay();
    const badge = document.createElement('div');
    badge.className = 'panel-nav-badge';
    badge.textContent = label;
    const offset = 6;
    badge.style.left = `${rect.left + offset}px`;
    badge.style.top = `${rect.top + offset}px`;
    this.navOverlay?.appendChild(badge);
    return badge;
  }

  private attachTabNavigation(): void {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!this.options.isKeyboardShortcutsEnabled()) {
        return;
      }

      if (this.options.dialogManager.hasOpenDialog) {
        return;
      }

      if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const target = event.target as Element | null;
        if (target?.closest('.interaction-questionnaire')) {
          return;
        }
        const inputEl = this.options.getInputEl();
        if (!inputEl || document.activeElement !== inputEl || inputEl.value === '') {
          event.preventDefault();
          this.cycleFocusZone(event.shiftKey);
          return;
        }
      }
    });
  }

  private attachSidebarNavigation(): void {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!this.options.isSidebarFocused()) {
        return;
      }
      const sidebar = this.options.getAgentSidebar();
      if (!sidebar) {
        return;
      }
      console.log('[client] sidebar keydown', {
        key: event.key,
        isSidebarFocused: this.options.isSidebarFocused(),
        focusedSessionId: this.options.getFocusedSessionId(),
      });
      const items = this.getAllSessionItems();
      if (items.length === 0) return;

      const focused = this.getFocusedSessionItem();
      const focusedIndex = focused ? items.indexOf(focused) : -1;
      console.log('[client] sidebar keydown focused item', {
        focused: focused?.dataset['sessionId'],
        focusedIndex,
      });

      switch (event.key) {
        case 'ArrowDown': {
          event.preventDefault();
          const nextIndex = focusedIndex < items.length - 1 ? focusedIndex + 1 : 0;
          const nextItem = items[nextIndex];
          if (nextItem) {
            this.setFocusedSessionItem(nextItem);
            const sessionId = nextItem.dataset['sessionId'];
            if (sessionId) {
              this.options.selectSession(sessionId);
            }
          }
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          const prevIndex = focusedIndex > 0 ? focusedIndex - 1 : items.length - 1;
          const prevItem = items[prevIndex];
          if (prevItem) {
            this.setFocusedSessionItem(prevItem);
            const sessionId = prevItem.dataset['sessionId'];
            if (sessionId) {
              this.options.selectSession(sessionId);
            }
          }
          break;
        }
        case 'Enter': {
          event.preventDefault();
          this.focusZone('input');
          break;
        }
        case 'Delete':
        case 'Backspace': {
          event.preventDefault();
          if (focused) {
            const sessionId = focused.dataset['sessionId'];
            if (sessionId) {
              this.options.showDeleteConfirmation(sessionId, true);
            }
          }
          break;
        }
        case 't':
        case 'T': {
          event.preventDefault();
          if (focused) {
            const sessionId = focused.dataset['sessionId'];
            if (sessionId) {
              void this.options.touchSession(sessionId);
            }
          }
          break;
        }
        case 'd':
        case 'D': {
          event.preventDefault();
          if (focused) {
            const sessionId = focused.dataset['sessionId'];
            if (sessionId) {
              this.options.showDeleteConfirmation(sessionId, true);
            }
          }
          break;
        }
        case 'c':
        case 'C': {
          event.preventDefault();
          if (focused) {
            const sessionId = focused.dataset['sessionId'];
            if (sessionId) {
              this.options.showClearHistoryConfirmation(sessionId);
            }
          }
          break;
        }
      }
    });
  }
}

function computeSplitPlacementHighlightRect(
  region: SplitPlacementRegion,
  rect: DOMRect,
): { left: number; top: number; width: number; height: number } {
  const edgeRatio = 0.5;
  if (region === 'left') {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width * edgeRatio,
      height: rect.height,
    };
  }
  if (region === 'right') {
    return {
      left: rect.right - rect.width * edgeRatio,
      top: rect.top,
      width: rect.width * edgeRatio,
      height: rect.height,
    };
  }
  if (region === 'top') {
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height * edgeRatio,
    };
  }
  if (region === 'bottom') {
    return {
      left: rect.left,
      top: rect.bottom - rect.height * edgeRatio,
      width: rect.width,
      height: rect.height * edgeRatio,
    };
  }

  const inset = 0.15;
  return {
    left: rect.left + rect.width * inset,
    top: rect.top + rect.height * inset,
    width: rect.width * (1 - inset * 2),
    height: rect.height * (1 - inset * 2),
  };
}
