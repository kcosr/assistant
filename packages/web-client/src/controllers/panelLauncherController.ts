import type { PanelBinding, PanelPlacement, PanelTypeManifest } from '@assistant/shared';
import type { PanelWorkspaceController } from './panelWorkspaceController';
import { PanelRegistry } from './panelRegistry';
import { resolvePanelAvailability } from '../utils/panelAvailability';
import type { SessionPickerOpenOptions } from './panelSessionPicker';

export interface PanelLauncherControllerOptions {
  launcherButton: HTMLButtonElement | null;
  launcher: HTMLElement | null;
  launcherList: HTMLElement | null;
  launcherSearch: HTMLInputElement | null;
  launcherCloseButton: HTMLButtonElement | null;
  panelRegistry: PanelRegistry;
  panelWorkspace: PanelWorkspaceController;
  openSessionPicker?: (options: SessionPickerOpenOptions) => void;
  getChatPanelSessionIds?: () => Set<string>;
  getAvailableCapabilities?: () => Set<string> | null;
  getAvailablePanelTypes?: () => Set<string> | null;
  onOpen?: () => void;
}

type PanelToggle = {
  isOpen: () => boolean;
  toggle: () => void;
};

const PANEL_TYPE_ORDER = ['sessions', 'navigator', 'empty', 'chat', 'lists', 'notes'];
const SESSION_BOUND_PANEL_TYPES = new Set(['chat', 'session-info', 'terminal']);

function isSessionBoundPanelType(panelType: string): boolean {
  return SESSION_BOUND_PANEL_TYPES.has(panelType);
}

export class PanelLauncherController {
  private isOpen = false;
  private query = '';
  private placementMenu: HTMLElement | null = null;
  private placementMenuCleanup: (() => void) | null = null;
  private placementTargetPanelId: string | null = null;
  private defaultPlacement: PanelPlacement | null = null;
  private pinToHeader = false;
  private replacePanelId: string | null = null;
  private launcherCleanup: (() => void) | null = null;
  private items: Array<{ element: HTMLElement; onAction: () => void }> = [];
  private focusedIndex = -1;

  constructor(private readonly options: PanelLauncherControllerOptions) {}

  attach(): void {
    const { launcherButton, launcher, launcherCloseButton, launcherSearch } = this.options;
    if (!launcherButton || !launcher) {
      return;
    }

    launcherButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.isOpen) {
        this.close();
        return;
      }
      this.open();
    });

    launcherCloseButton?.addEventListener('click', () => {
      this.close();
    });

    launcherSearch?.addEventListener('input', () => {
      this.query = launcherSearch.value.trim().toLowerCase();
      this.render();
      this.positionLauncher();
    });

    document.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveFocus(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveFocus(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      this.activateFocusedItem();
      return;
    }
  };

  private setFocusedIndex(index: number): void {
    if (this.items.length === 0) {
      this.focusedIndex = -1;
      return;
    }
    const clamped = Math.max(0, Math.min(index, this.items.length - 1));
    if (this.focusedIndex === clamped) {
      return;
    }
    const previous = this.items[this.focusedIndex];
    if (previous) {
      previous.element.classList.remove('focused');
    }
    const next = this.items[clamped];
    if (next) {
      next.element.classList.add('focused');
      next.element.scrollIntoView({ block: 'nearest' });
    }
    this.focusedIndex = clamped;
  }

  private moveFocus(delta: number): void {
    if (this.items.length === 0) {
      return;
    }
    const startIndex = this.focusedIndex;
    const nextIndex = startIndex < 0 ? (delta > 0 ? 0 : this.items.length - 1) : startIndex + delta;
    this.setFocusedIndex(nextIndex);
  }

  private activateFocusedItem(): void {
    if (this.focusedIndex < 0 || this.focusedIndex >= this.items.length) {
      return;
    }
    const item = this.items[this.focusedIndex];
    item?.onAction();
  }

  open(): void {
    this.openWithContext();
  }

  openWithPlacement(options: {
    targetPanelId?: string | null;
    defaultPlacement?: PanelPlacement | null;
    pinToHeader?: boolean;
    replacePanelId?: string | null;
  }): void {
    this.openWithContext(options);
  }

  private openWithContext(options?: {
    targetPanelId?: string | null;
    defaultPlacement?: PanelPlacement | null;
    pinToHeader?: boolean;
    replacePanelId?: string | null;
  }): void {
    this.placementTargetPanelId = options?.targetPanelId ?? null;
    this.defaultPlacement = options?.defaultPlacement ?? null;
    this.pinToHeader = options?.pinToHeader ?? false;
    this.replacePanelId = options?.replacePanelId ?? null;

    const { launcher, launcherSearch } = this.options;
    if (!launcher) {
      return;
    }
    this.closePlacementMenu();
    this.options.onOpen?.();
    this.isOpen = true;
    launcher.classList.add('open');
    launcher.setAttribute('aria-hidden', 'false');
    this.attachLauncherListeners();
    if (launcherSearch) {
      launcherSearch.value = '';
      this.query = '';
      launcherSearch.focus();
    }
    this.render();
    this.positionLauncher();
    requestAnimationFrame(() => {
      this.positionLauncher();
    });
  }

  close(): void {
    const { launcher } = this.options;
    if (!launcher) {
      return;
    }
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && launcher.contains(activeElement)) {
      activeElement.blur();
    }
    this.isOpen = false;
    launcher.classList.remove('open');
    launcher.setAttribute('aria-hidden', 'true');
    this.detachLauncherListeners();
    this.closePlacementMenu();
    this.replacePanelId = null;
    this.restoreFocus();
  }

  refresh(): void {
    this.render();
    this.positionLauncher();
  }

  private render(): void {
    const { launcherList } = this.options;
    if (!launcherList) {
      return;
    }
    this.closePlacementMenu();
    this.items = [];
    this.focusedIndex = -1;

    launcherList.innerHTML = '';

    const manifests = this.getOrderedManifests();
    if (manifests.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'panel-launcher-empty';
      empty.textContent = 'No panels found.';
      launcherList.appendChild(empty);
      return;
    }
    const isReplacing = Boolean(this.replacePanelId);
    for (const manifest of manifests) {
      const isAvailable = this.isManifestAvailable(manifest);
      const toggle = this.getPanelToggle(manifest.type);
      const openPanels = this.options.panelWorkspace.getPanelIdsByType(manifest.type);
      const openCount = openPanels.length;
      // For pinned panels, "open" means the popover is showing, not just that the panel exists
      const headerPanelIds = this.options.panelWorkspace.listHeaderPanelIds();
      const pinnedPanelId = openPanels.find((id) => headerPanelIds.includes(id));
      const isOpen = pinnedPanelId
        ? this.options.panelWorkspace.getOpenHeaderPanelId() === pinnedPanelId
        : (toggle?.isOpen() ?? openCount > 0);
      const supportsMultiInstance = manifest.multiInstance !== false;
      const supportsSessionBinding = isSessionBoundPanelType(manifest.type);
      const requiresSession = supportsSessionBinding && manifest.sessionScope === 'required';
      const isPinning = this.pinToHeader;

      const row = document.createElement('div');
      row.className = 'panel-launcher-item';

      const info = document.createElement('div');
      info.className = 'panel-launcher-info';

      const title = document.createElement('div');
      title.className = 'panel-launcher-title';
      title.textContent = manifest.title;
      info.appendChild(title);

      const status = document.createElement('div');
      status.className = 'panel-launcher-status';
      status.textContent = openCount > 0 ? `${openCount} open` : 'Closed';
      info.appendChild(status);

      if (manifest.description) {
        const description = document.createElement('div');
        description.className = 'panel-launcher-description';
        description.textContent = manifest.description;
        info.appendChild(description);
      }

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'panel-launcher-toggle';

      const actions = document.createElement('div');
      actions.className = 'panel-launcher-actions';

      let onAction: (() => void) | null = null;

      if (!isAvailable) {
        action.textContent = 'Unavailable';
        action.disabled = true;
        actions.appendChild(action);
      } else if (isReplacing) {
        const replacePanelId = this.replacePanelId;
        action.textContent = 'Replace';
        onAction = () => {
          if (!replacePanelId) {
            return;
          }
          this.openPanelWithPlacement(manifest.type, null, null, action, { replacePanelId });
        };
        action.addEventListener('click', onAction);
        actions.appendChild(action);
      } else if (isPinning) {
        // Pin mode: simple "Pin" button
        action.textContent = requiresSession ? 'Pin...' : 'Pin';
        onAction = () => {
          const targetPanelId = this.getPlacementTargetPanelId();
          const placement = targetPanelId ? this.defaultPlacement : null;
          this.openPanelWithPlacement(manifest.type, placement, targetPanelId, action);
        };
        action.addEventListener('click', onAction);
        actions.appendChild(action);
      } else if (!supportsMultiInstance && toggle) {
        // Single-instance panels: Show/Hide toggle
        action.classList.toggle('active', isOpen);
        action.setAttribute('aria-pressed', isOpen ? 'true' : 'false');
        action.textContent = isOpen ? 'Hide' : 'Show';
        onAction = () => {
          toggle.toggle();
          this.close();
        };
        action.addEventListener('click', onAction);
        actions.appendChild(action);
      } else {
        // Normal mode: "Add ▾" button with dropdown
        action.className = 'panel-launcher-toggle panel-launcher-add-dropdown';
        action.innerHTML = `Add <span class="panel-launcher-caret">▾</span>`;
        // For keyboard nav, "Add" triggers default placement
        onAction = () => {
          this.openPanelWithPlacement(manifest.type, null, undefined, action);
        };
        action.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openAddMenu(manifest.type, action);
        });
        actions.appendChild(action);
      }

      // Track item for keyboard navigation
      if (onAction) {
        const itemIndex = this.items.length;
        this.items.push({ element: row, onAction });
        row.addEventListener('mouseenter', () => {
          this.setFocusedIndex(itemIndex);
        });
      }

      row.appendChild(info);
      row.appendChild(actions);
      launcherList.appendChild(row);
    }

    // Set initial focus to first item
    if (this.items.length > 0) {
      this.setFocusedIndex(0);
    }
  }

  private attachLauncherListeners(): void {
    this.detachLauncherListeners();
    const handlePointerDown = (event: MouseEvent) => {
      if (!this.isOpen) {
        return;
      }
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      const launcherPanel = this.getLauncherPanel();
      if (launcherPanel?.contains(target)) {
        return;
      }
      if (this.options.launcherButton?.contains(target)) {
        return;
      }
      if (this.placementMenu?.contains(target)) {
        return;
      }
      this.close();
    };
    const handleResize = () => {
      this.positionLauncher();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleResize);
    this.launcherCleanup = () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleResize);
    };
  }

  private detachLauncherListeners(): void {
    if (this.launcherCleanup) {
      this.launcherCleanup();
      this.launcherCleanup = null;
    }
  }

  private restoreFocus(): void {
    const activePanelId = this.options.panelWorkspace.getActivePanelId();
    if (activePanelId) {
      requestAnimationFrame(() => {
        this.options.panelWorkspace.focusPanel(activePanelId);
      });
      return;
    }
    this.options.launcherButton?.focus();
  }

  private getLauncherPanel(): HTMLElement | null {
    const { launcher } = this.options;
    if (!launcher) {
      return null;
    }
    return launcher.querySelector<HTMLElement>('.panel-launcher');
  }

  private positionLauncher(): void {
    if (!this.isOpen) {
      return;
    }
    const launcherPanel = this.getLauncherPanel();
    const anchor = this.options.launcherButton;
    if (!launcherPanel || !anchor) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = launcherPanel.getBoundingClientRect();
    const padding = 8;

    let left = anchorRect.left;
    if (left + panelRect.width > window.innerWidth - padding) {
      left = window.innerWidth - panelRect.width - padding;
    }
    if (left < padding) {
      left = padding;
    }

    let top = anchorRect.bottom + 8;
    if (top + panelRect.height > window.innerHeight - padding) {
      top = anchorRect.top - panelRect.height - 8;
    }
    if (top < padding) {
      top = padding;
    }

    launcherPanel.style.left = `${Math.round(left)}px`;
    launcherPanel.style.top = `${Math.round(top)}px`;
  }

  private getOrderedManifests(): PanelTypeManifest[] {
    const manifests = this.options.panelRegistry.listManifests();
    const order = new Map<string, number>(PANEL_TYPE_ORDER.map((type, index) => [type, index]));

    const filtered = this.query
      ? manifests.filter((manifest) => this.matchesQuery(manifest, this.query))
      : manifests;

    return filtered.slice().sort((a, b) => {
      const orderA = order.get(a.type) ?? Number.POSITIVE_INFINITY;
      const orderB = order.get(b.type) ?? Number.POSITIVE_INFINITY;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.title.localeCompare(b.title);
    });
  }

  private matchesQuery(manifest: PanelTypeManifest, query: string): boolean {
    const haystack = [manifest.title, manifest.type, manifest.description ?? '']
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  }

  private getPanelToggle(panelType: string): PanelToggle | null {
    const { panelWorkspace } = this.options;
    return {
      isOpen: () => panelWorkspace.isPanelTypeOpen(panelType),
      toggle: () => {
        panelWorkspace.togglePanel(panelType);
      },
    };
  }

  private isManifestAvailable(manifest: PanelTypeManifest): boolean {
    const availability = resolvePanelAvailability(manifest.type, manifest, {
      allowedPanelTypes: this.options.getAvailablePanelTypes?.() ?? null,
      availableCapabilities: this.options.getAvailableCapabilities?.() ?? null,
    });
    return availability.state !== 'unavailable';
  }

  private openAddMenu(panelType: string, anchor: HTMLElement): void {
    this.closePlacementMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu panel-placement-menu';

    const targetPanelId = this.getPlacementTargetPanelId();
    const hasTarget = Boolean(targetPanelId);

    const addItem = (
      label: string,
      onClick: (button: HTMLButtonElement) => void,
      disabled = false,
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'context-menu-item';
      button.textContent = label;
      if (disabled) {
        button.disabled = true;
      } else {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          this.closePlacementMenu();
          onClick(button);
        });
      }
      menu.appendChild(button);
      return button;
    };

    const addDivider = (): void => {
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      menu.appendChild(divider);
    };

    addItem('Add', (button) => this.openPanelWithPlacement(panelType, null, undefined, button));
    addItem(
      'Tab with active',
      (button) =>
        this.openPanelWithPlacement(panelType, { region: 'center' }, targetPanelId, button),
      !hasTarget,
    );
    addItem(
      'Split right',
      (button) =>
        this.openPanelWithPlacement(panelType, { region: 'right' }, targetPanelId, button),
      !hasTarget,
    );
    addItem(
      'Split left',
      (button) => this.openPanelWithPlacement(panelType, { region: 'left' }, targetPanelId, button),
      !hasTarget,
    );
    addItem(
      'Split bottom',
      (button) =>
        this.openPanelWithPlacement(panelType, { region: 'bottom' }, targetPanelId, button),
      !hasTarget,
    );
    addItem(
      'Split top',
      (button) => this.openPanelWithPlacement(panelType, { region: 'top' }, targetPanelId, button),
      !hasTarget,
    );

    addDivider();
    addItem('Pin to header', (button) => {
      this.openPanelWithPlacement(panelType, null, undefined, button, { pinToHeader: true });
    });

    document.body.appendChild(menu);
    this.placementMenu = menu;

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;

    let left = anchorRect.right - menuRect.width;
    let top = anchorRect.bottom + 6;

    if (left < padding) {
      left = padding;
    }
    if (left + menuRect.width > window.innerWidth - padding) {
      left = window.innerWidth - menuRect.width - padding;
    }
    if (top + menuRect.height > window.innerHeight - padding) {
      top = anchorRect.top - menuRect.height - 6;
    }
    if (top < padding) {
      top = padding;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node) && event.target !== anchor) {
        this.closePlacementMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closePlacementMenu();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    this.placementMenuCleanup = () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }

  private closePlacementMenu(): void {
    if (this.placementMenuCleanup) {
      this.placementMenuCleanup();
      this.placementMenuCleanup = null;
    }
    if (this.placementMenu) {
      this.placementMenu.remove();
      this.placementMenu = null;
    }
  }

  private openPanelWithPlacement(
    panelType: string,
    placement: PanelPlacement | null,
    targetPanelId?: string | null,
    anchor?: HTMLElement,
    options?: { replacePanelId?: string | null; pinToHeader?: boolean },
  ): void {
    const manifest = this.options.panelRegistry.getManifest(panelType);
    const supportsSessionBinding = manifest?.type ? isSessionBoundPanelType(manifest.type) : false;
    const sessionScope = (() => {
      if (!supportsSessionBinding) {
        return 'global';
      }
      if (manifest?.sessionScope) {
        return manifest.sessionScope;
      }
      if (manifest?.defaultSessionBinding === 'global') {
        return 'global';
      }
      return 'optional';
    })();
    const allowUnbound = sessionScope === 'optional';
    const shouldPromptSession =
      Boolean(this.options.openSessionPicker) && sessionScope === 'required';
    const shouldPin = options?.pinToHeader ?? this.pinToHeader;
    const replacePanelId = options?.replacePanelId ?? null;

    const openPanel = (binding?: PanelBinding) => {
      if (replacePanelId) {
        const replaced = this.options.panelWorkspace.replacePanel(replacePanelId, panelType, {
          ...(binding ? { binding } : {}),
        });
        if (replaced) {
          this.close();
        } else {
          this.render();
        }
        return;
      }
      const openOptions =
        placement && targetPanelId
          ? {
              focus: !shouldPin,
              placement,
              targetPanelId,
              ...(binding ? { binding } : {}),
            }
          : { focus: !shouldPin, ...(binding ? { binding } : {}) };
      const panelId = this.options.panelWorkspace.openPanel(panelType, openOptions);
      if (panelId && shouldPin) {
        this.options.panelWorkspace.pinPanelById(panelId);
        this.options.panelWorkspace.focusPanel(panelId);
      }
      if (panelId) {
        this.close();
      } else {
        this.render();
      }
    };

    if (shouldPromptSession && this.options.openSessionPicker) {
      const pickerAnchor =
        this.options.launcherButton ?? anchor ?? this.options.launcher ?? document.body;
      const disabledSessionIds =
        panelType === 'chat' ? this.options.getChatPanelSessionIds?.() : undefined;
      const pickerOptions: SessionPickerOpenOptions = {
        anchor: pickerAnchor,
        title: 'Select session',
        createSessionOptions: { openChatPanel: false, selectSession: false },
        allowUnbound,
        onSelectSession: (sessionId) => {
          const binding: PanelBinding = { mode: 'fixed', sessionId };
          openPanel(binding);
        },
      };
      if (disabledSessionIds) {
        pickerOptions.disabledSessionIds = disabledSessionIds;
      }
      if (allowUnbound) {
        pickerOptions.onSelectUnbound = () => {
          openPanel();
        };
      }
      this.close();
      this.options.openSessionPicker(pickerOptions);
      return;
    }

    openPanel();
  }

  private getPlacementTargetPanelId(): string | null {
    return this.placementTargetPanelId ?? this.options.panelWorkspace.getActivePanelId();
  }
}
