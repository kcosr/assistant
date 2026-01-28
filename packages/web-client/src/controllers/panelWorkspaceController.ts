import type {
  LayoutNode,
  LayoutPersistence,
  PanelBinding,
  PanelInstance,
  PanelPlacement,
  PanelInventoryPayload,
  PanelTypeManifest,
} from '@assistant/shared';
import { PanelRegistry, type PanelInitOptions, type PanelOpenOptions } from './panelRegistry';
import type { PanelHostController } from './panelHostController';
import type { SessionPickerOpenOptions } from './panelSessionPicker';
import {
  collectPanelIds,
  collectVisiblePanelIds,
  containsPanelId,
  findFirstPanelId,
  type PanelContainerSize,
  insertPanel,
  movePanel,
  normalizeSplitSizes,
  removePanel,
} from '../utils/layoutTree';
import { loadPanelLayout, savePanelLayout } from '../utils/panelLayoutStore';
import { createDefaultPanelLayout } from '../utils/panelDefaultLayout';
import { resolvePanelAvailability } from '../utils/panelAvailability';
import { ICONS } from '../utils/icons';
import { formatSessionLabel, type AgentLabelSummary } from '../utils/sessionLabel';
import { getPanelContextKey } from '../utils/panelContext';
import { buildPanelLayoutPreset, type PanelLayoutPreset } from '../utils/layoutPresets';

type PanelSessionScope = 'required' | 'optional' | 'global';
type PanelFocusSource = 'content' | 'chrome' | 'program';

const SESSION_BOUND_PANEL_TYPES = new Set(['chat', 'session-info', 'terminal']);

function isSessionBoundPanelType(panelType: string): boolean {
  return SESSION_BOUND_PANEL_TYPES.has(panelType);
}

const isPanelDebugEnabled = (): boolean => {
  const globalAny = globalThis as { __ASSISTANT_DEBUG_PANELS__?: boolean };
  return globalAny.__ASSISTANT_DEBUG_PANELS__ === true;
};

const resolveIconSvg = (iconName: string | null | undefined): string | null => {
  const raw = typeof iconName === 'string' ? iconName.trim() : '';
  if (!raw) {
    return null;
  }
  const candidates = new Set<string>();
  candidates.add(raw);
  candidates.add(raw.replace(/-([a-z0-9])/g, (_, value: string) => value.toUpperCase()));
  const trimmedSuffix = raw.replace(/-\d+$/, '');
  if (trimmedSuffix !== raw) {
    candidates.add(trimmedSuffix);
    candidates.add(
      trimmedSuffix.replace(/-([a-z0-9])/g, (_, value: string) => value.toUpperCase()),
    );
  }
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(ICONS, candidate)) {
      return ICONS[candidate as keyof typeof ICONS];
    }
  }
  return null;
};

const FOCUS_HISTORY_STORAGE_KEY = 'aiAssistantPanelFocusHistory';

export interface PanelWorkspaceControllerOptions {
  root: HTMLElement;
  registry: PanelRegistry;
  host: PanelHostController;
  initialPanelElements?: Map<string, HTMLElement>;
  loadLayout?: () => LayoutPersistence | null;
  saveLayout?: (layout: LayoutPersistence) => void;
  defaultLayout?: () => LayoutPersistence;
  onLayoutChange?: (layout: LayoutPersistence) => void;
  getAvailableCapabilities?: () => Set<string> | null;
  getAvailablePanelTypes?: () => Set<string> | null;
  openPanelLauncher?: (options?: {
    targetPanelId?: string | null;
    defaultPlacement?: PanelPlacement | null;
    pinToHeader?: boolean;
    replacePanelId?: string | null;
  }) => void;
  openSessionPicker?: (options: SessionPickerOpenOptions) => void;
  headerDockRoot?: HTMLElement | null;
  hasChatPanelActiveOutput?: (panelId: string) => boolean;
}

export class PanelWorkspaceController {
  private static readonly FOCUS_HISTORY_LIMIT = 50;
  private layout: LayoutPersistence;
  private readonly panelElements = new Map<string, HTMLElement>();
  private readonly mountedPanelIds = new Set<string>();
  private readonly panelVisibility = new Map<string, boolean>();
  private readonly resizeObserver: ResizeObserver | null;
  private activePanelId: string | null = null;
  private readonly focusHistory: string[] = [];
  private activeChatPanelId: string | null = null;
  private activeChatPanelFrame: HTMLElement | null = null;
  private activeChatPanelContent: HTMLElement | null = null;
  private activeNonChatPanelId: string | null = null;
  private activeNonChatPanelFrame: HTMLElement | null = null;
  private readonly chromeSelector = '.panel-chrome-row, .chat-header';
  private activeMenu: HTMLElement | null = null;
  private activeSubMenu: HTMLElement | null = null;
  private menuCleanup: (() => void) | null = null;
  private dragState: PanelDragState | null = null;
  private reorderState: PanelReorderState | null = null;
  private usesDefaultLayout = false;
  private defaultPinsApplied = false;
  private readonly headerDockRoot: HTMLElement | null;
  private headerPopover: HTMLElement | null = null;
  private headerPopoverCleanup: (() => void) | null = null;
  private headerPopoverAnchor: HTMLElement | null = null;
  private openHeaderPanelId: string | null = null;
  private readonly panelContextSubscriptions = new Map<string, () => void>();
  private readonly modalPanelIds = new Set<string>();
  private modalOverlay: HTMLElement | null = null;
  private modalOverlayCleanup: (() => void) | null = null;

  constructor(private readonly options: PanelWorkspaceControllerOptions) {
    this.headerDockRoot = options.headerDockRoot ?? null;
    if (options.initialPanelElements) {
      for (const [panelId, element] of options.initialPanelElements.entries()) {
        this.panelElements.set(panelId, element);
      }
    }
    this.layout = this.loadInitialLayout();
    this.loadFocusHistoryFromStorage();
    this.resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver((entries) => {
            for (const entry of entries) {
              const target = entry.target as HTMLElement;
              const panelId = target.dataset['panelId'];
              if (!panelId) {
                continue;
              }
              const { width, height } = entry.contentRect;
              this.options.host.setPanelSize(panelId, { width, height });
            }
          });
  }

  attach(): void {
    this.render();
  }

  getLayout(): LayoutPersistence {
    return this.layout;
  }

  getLayoutRoot(): LayoutNode {
    return this.layout.layout;
  }

  resetLayout(): void {
    const fallback = this.options.defaultLayout
      ? this.options.defaultLayout()
      : createDefaultPanelLayout(this.options.registry.listManifests());
    const normalized = this.normalizeLayout(fallback);
    this.layout = normalized ?? this.createFallbackLayout();
    this.usesDefaultLayout = true;
    this.defaultPinsApplied = false;
    this.persistLayout();
    this.render();
    this.applyDefaultPinnedPanels();
  }

  resetPanelStates(): void {
    let hadState = false;
    for (const panel of Object.values(this.layout.panels)) {
      if (panel?.state !== undefined) {
        delete panel.state;
        hadState = true;
      }
    }
    if (hadState) {
      this.persistLayout();
    }
    this.render({ forceRemount: true });
  }

  focusLastPanelOfType(panelType: string): boolean {
    this.pruneFocusHistory();
    for (const panelId of this.focusHistory) {
      if (this.modalPanelIds.has(panelId)) {
        continue;
      }
      const panel = this.layout.panels[panelId];
      if (!panel || panel.panelType !== panelType) {
        continue;
      }
      if (this.isPanelPinned(panelId)) {
        this.openHeaderPanel(panelId);
        this.focusPanel(panelId);
      } else {
        this.activatePanel(panelId);
      }
      return true;
    }
    const existing = this.findPanelIdsByType(panelType).filter(
      (panelId) => !this.modalPanelIds.has(panelId),
    );
    if (existing.length === 0) {
      return false;
    }
    const visible = new Set(this.getVisiblePanelIds());
    const candidate = existing.find((panelId) => visible.has(panelId)) ?? existing[0];
    if (!candidate) {
      return false;
    }
    if (this.isPanelPinned(candidate)) {
      this.openHeaderPanel(candidate);
      this.focusPanel(candidate);
    } else {
      this.activatePanel(candidate);
    }
    return true;
  }

  applyLayoutPreset(preset: PanelLayoutPreset): void {
    const nextRoot = buildPanelLayoutPreset(this.layout.layout, preset);
    const normalized = this.normalizeLayout({ ...this.layout, layout: nextRoot });
    this.layout = normalized ?? this.createFallbackLayout();
    this.persistLayout();
    this.render();
  }

  refreshAvailability(): void {
    const normalized = this.normalizeLayout(this.layout);
    this.layout = normalized ?? this.createFallbackLayout();
    this.persistLayout();
    this.render({ forceRemount: true });
  }

  getActivePanelId(): string | null {
    return this.activePanelId;
  }

  getSplitElement(splitId: string): HTMLElement | null {
    return (
      this.options.root.querySelector<HTMLElement>(
        `.panel-split[data-split-id="${splitId}"], .panel-tabs[data-split-id="${splitId}"]`,
      ) ?? null
    );
  }

  getPanelFrameElement(panelId: string): HTMLElement | null {
    return this.findPanelFrame(panelId);
  }

  listHeaderPanelIds(): string[] {
    return [...this.getHeaderPanelIds()];
  }

  applyDefaultPinnedPanels(): void {
    if (!this.usesDefaultLayout || this.defaultPinsApplied) {
      return;
    }
    const availablePanelTypes = this.options.getAvailablePanelTypes?.();
    if (availablePanelTypes === null) {
      return;
    }

    const manifests = this.options.registry
      .listManifests()
      .filter((manifest) => manifest.defaultPinned);
    if (manifests.length === 0) {
      this.defaultPinsApplied = true;
      return;
    }

    let nextLayout = this.layout.layout;
    const nextPanels = { ...this.layout.panels };
    const nextHeaderPanels = [...this.getHeaderPanelIds()];
    const headerSet = new Set(nextHeaderPanels);
    const existingIds = new Set(Object.keys(nextPanels));
    for (const panelId of nextHeaderPanels) {
      existingIds.add(panelId);
    }

    let changed = false;

    for (const manifest of manifests) {
      const existing = this.findPanelIdsByType(manifest.type);
      let panelId = existing[0];
      if (!panelId) {
        panelId = createPanelId(manifest.type, existingIds);
        nextPanels[panelId] = this.options.registry.createInstance(manifest.type, panelId);
        existingIds.add(panelId);
        changed = true;
      }
      if (headerSet.has(panelId)) {
        continue;
      }
      if (containsPanelId(nextLayout, panelId)) {
        const pruned = removePanel(nextLayout, panelId);
        if (!pruned) {
          continue;
        }
        nextLayout = pruned;
      }
      nextHeaderPanels.push(panelId);
      headerSet.add(panelId);
      changed = true;
    }

    this.defaultPinsApplied = true;
    if (!changed) {
      return;
    }

    this.layout = {
      layout: nextLayout,
      panels: nextPanels,
      headerPanels: nextHeaderPanels,
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    this.persistLayout();
    this.render();
  }

  getHeaderDockRoot(): HTMLElement | null {
    return this.headerDockRoot;
  }

  getOpenHeaderPanelId(): string | null {
    return this.openHeaderPanelId;
  }

  getHeaderPopoverElement(): HTMLElement | null {
    return this.headerPopover;
  }

  getHeaderDockButton(panelId: string): HTMLElement | null {
    return (
      this.headerDockRoot?.querySelector<HTMLElement>(
        `.panel-dock-button[data-panel-id="${panelId}"]`,
      ) ?? null
    );
  }

  toggleHeaderPanelById(panelId: string): void {
    this.toggleHeaderPanel(panelId);
  }

  openHeaderPanel(panelId: string): void {
    if (!this.isPanelPinned(panelId)) {
      return;
    }
    if (this.openHeaderPanelId === panelId) {
      return;
    }
    this.openHeaderPanelId = panelId;
    this.renderHeaderDock();
  }

  closeHeaderPanel(): void {
    if (!this.openHeaderPanelId) {
      return;
    }
    this.closeHeaderPopover();
    this.renderHeaderDock();
  }

  setActiveChatPanelId(panelId: string | null): void {
    if (panelId) {
      const panel = this.layout.panels[panelId];
      if (!panel || panel.panelType !== 'chat') {
        return;
      }
    }
    this.activeChatPanelId = panelId;
    this.refreshActivePanelFrames();
  }

  isPanelTypeOpen(panelType: string): boolean {
    const panelIds = this.getAllPanelIds();
    for (const panelId of panelIds) {
      const panel = this.layout.panels[panelId];
      if (panel?.panelType === panelType) {
        return true;
      }
    }
    return false;
  }

  isPanelTypeVisible(panelType: string): boolean {
    const visiblePanels = new Set(this.getVisiblePanelIds());
    for (const panelId of visiblePanels) {
      const panel = this.layout.panels[panelId];
      if (panel?.panelType === panelType) {
        return true;
      }
    }
    return false;
  }

  getPanelIdsByType(panelType: string): string[] {
    return this.findPanelIdsByType(panelType);
  }

  getPanelType(panelId: string): string | null {
    return this.layout.panels[panelId]?.panelType ?? null;
  }

  getChatPanelSessionIds(): Set<string> {
    return this.collectChatPanelSessionIds();
  }

  private getHeaderPanelIds(): string[] {
    return this.layout.headerPanels ?? [];
  }

  private setHeaderPanelIds(ids: string[]): void {
    this.layout.headerPanels = ids;
  }

  private getHeaderPanelSizes(): Record<string, { width: number; height: number }> {
    return this.layout.headerPanelSizes ?? {};
  }

  private setHeaderPanelSizes(sizes: Record<string, { width: number; height: number }>): void {
    this.layout.headerPanelSizes = sizes;
  }

  private setHeaderPanelSize(
    panelId: string,
    size: { width: number; height: number } | null,
  ): void {
    const next = { ...this.getHeaderPanelSizes() };
    if (size) {
      next[panelId] = size;
    } else {
      delete next[panelId];
    }
    this.setHeaderPanelSizes(next);
    this.persistLayout();
  }

  private getAllPanelIds(): string[] {
    const ids = new Set<string>(collectPanelIds(this.layout.layout));
    for (const panelId of this.getHeaderPanelIds()) {
      ids.add(panelId);
    }
    return Array.from(ids);
  }

  private isPanelPinned(panelId: string): boolean {
    return this.getHeaderPanelIds().includes(panelId);
  }

  reloadPanelsByType(panelType: string): void {
    const panelIds = this.getPanelIdsByType(panelType);
    if (panelIds.length === 0) {
      return;
    }
    for (const panelId of panelIds) {
      this.remountPanel(panelId);
    }
    this.updateVisibility();
    this.ensureActivePanel();
    if (this.activePanelId && panelIds.includes(this.activePanelId)) {
      this.options.host.setPanelFocus(this.activePanelId, true);
    }
    this.refreshActivePanelFrames();
    this.observePanels();
  }

  getVisiblePanelIds(): string[] {
    const visiblePanels = collectVisiblePanelIds(this.layout.layout);
    const visible = new Set(
      collectPanelIds(this.layout.layout).filter((panelId) => visiblePanels.has(panelId)),
    );
    if (this.openHeaderPanelId) {
      visible.add(this.openHeaderPanelId);
    }
    return Array.from(visible);
  }

  focusNextPanel(reverse = false): void {
    const visiblePanels = this.getVisiblePanelIds();
    if (visiblePanels.length === 0) {
      return;
    }

    const activeIndex = this.activePanelId ? visiblePanels.indexOf(this.activePanelId) : -1;
    const nextIndex = reverse
      ? activeIndex <= 0
        ? visiblePanels.length - 1
        : activeIndex - 1
      : activeIndex >= visiblePanels.length - 1
        ? 0
        : activeIndex + 1;
    const nextPanelId = visiblePanels[nextIndex] ?? visiblePanels[0];
    if (nextPanelId) {
      this.focusPanel(nextPanelId);
    }
  }

  openPanel(panelType: string, options: PanelOpenOptions = {}): string | null {
    const manifest = this.options.registry.getManifest(panelType);
    if (!manifest) {
      return null;
    }
    if (!this.isPanelAvailable(panelType, manifest)) {
      return null;
    }

    const supportsSessionBinding = isSessionBoundPanelType(panelType);
    const existing = this.findPanelIdsByType(panelType);
    const requestedBinding = supportsSessionBinding ? options.binding : null;
    if (panelType === 'chat' && requestedBinding?.mode === 'fixed') {
      const existingForSession = existing.find((panelId) => {
        const binding =
          this.options.host.getPanelBinding(panelId) ??
          this.layout.panels[panelId]?.binding ??
          null;
        return binding?.mode === 'fixed' && binding.sessionId === requestedBinding.sessionId;
      });
      if (existingForSession) {
        if (requestedBinding) {
          this.options.host.setPanelBinding(existingForSession, requestedBinding);
        }
        if (options.state !== undefined) {
          this.updatePanelState(existingForSession, options.state);
        }
        if (options.placement) {
          this.movePanel(existingForSession, options.placement, options.targetPanelId);
        } else {
          this.focusPanel(existingForSession);
          if (this.isPanelPinned(existingForSession)) {
            this.openHeaderPanelId = existingForSession;
            this.renderHeaderDock();
          }
        }
        return existingForSession;
      }
    }
    if (manifest.multiInstance === false && existing.length > 0) {
      const panelId = existing[0] ?? null;
      if (panelId) {
        if (requestedBinding) {
          this.options.host.setPanelBinding(panelId, requestedBinding);
        }
        if (options.state !== undefined) {
          this.updatePanelState(panelId, options.state);
        }
        this.focusPanel(panelId);
        if (this.isPanelPinned(panelId)) {
          this.openHeaderPanelId = panelId;
          this.renderHeaderDock();
        }
      }
      return panelId;
    }

    const panelId = createPanelId(panelType, new Set(Object.keys(this.layout.panels)));
    const initOptions: PanelInitOptions = {};
    if (requestedBinding) {
      initOptions.binding = requestedBinding;
    }
    if (options.state !== undefined) {
      initOptions.state = options.state;
    }

    const instance = this.options.registry.createInstance(panelType, panelId, initOptions);

    const placement = options.placement ?? manifest.defaultPlacement ?? { region: 'center' };
    const containerSize = this.getPlacementContainerSize(options.targetPanelId);
    this.layout = {
      layout: insertPanel(
        this.layout.layout,
        panelId,
        placement,
        options.targetPanelId,
        containerSize,
      ),
      panels: { ...this.layout.panels, [panelId]: instance },
      headerPanels: this.getHeaderPanelIds(),
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    this.recordPanelFocus(panelId);

    this.persistLayout();
    this.render();

    if (options.focus) {
      this.focusPanel(panelId);
    }

    return panelId;
  }

  openModalPanel(panelType: string, options: PanelOpenOptions = {}): string | null {
    const manifest = this.options.registry.getManifest(panelType);
    if (!manifest || !this.isPanelAvailable(panelType, manifest)) {
      return null;
    }

    for (const modalId of Array.from(this.modalPanelIds)) {
      this.closeModalPanel(modalId);
    }

    const panelId = createPanelId(panelType, new Set(Object.keys(this.layout.panels)));
    const initOptions: PanelInitOptions = {};
    if (options.binding) {
      initOptions.binding = options.binding;
    }
    if (options.state !== undefined) {
      initOptions.state = options.state;
    }

    const instance = this.options.registry.createInstance(panelType, panelId, initOptions);
    this.layout = {
      ...this.layout,
      panels: {
        ...this.layout.panels,
        [panelId]: instance,
      },
    };
    this.modalPanelIds.add(panelId);

    const overlay = this.ensureModalOverlay();
    overlay.replaceChildren();
    const modal = document.createElement('div');
    modal.className = 'panel-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', this.getPanelTitle(panelId));
    const frame = this.renderPanel(panelId);
    frame.classList.add('panel-frame-modal');
    modal.appendChild(frame);
    overlay.appendChild(modal);
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');

    this.mountPanels();
    this.updateVisibility();
    this.observePanels();
    this.syncPanelContextSubscriptions();
    this.focusPanel(panelId);
    this.updatePanelContextSummary();
    return panelId;
  }

  replacePanel(panelId: string, panelType: string, options: PanelInitOptions = {}): boolean {
    const existing = this.layout.panels[panelId];
    if (!existing) {
      return false;
    }
    const manifest = this.options.registry.getManifest(panelType);
    if (!manifest || !this.isPanelAvailable(panelType, manifest)) {
      return false;
    }

    // Respect multiInstance: false - don't create duplicates
    if (manifest.multiInstance === false) {
      const existingPanels = this.findPanelIdsByType(panelType);
      if (existingPanels.length > 0) {
        // Already have one, focus it instead
        const existingPanelId = existingPanels[0];
        if (existingPanelId) {
          this.focusPanel(existingPanelId);
          if (this.isPanelPinned(existingPanelId)) {
            this.openHeaderPanelId = existingPanelId;
            this.renderHeaderDock();
          }
        }
        return false;
      }
    }

    const instance = this.options.registry.createInstance(panelType, panelId, options);
    this.layout = {
      ...this.layout,
      panels: {
        ...this.layout.panels,
        [panelId]: instance,
      },
    };
    this.persistLayout();

    if (this.activeChatPanelId === panelId && panelType !== 'chat') {
      this.activeChatPanelId = null;
    }
    if (this.activeNonChatPanelId === panelId && panelType === 'chat') {
      this.activeNonChatPanelId = null;
    }
    if (this.activePanelId === panelId) {
      if (panelType === 'chat') {
        this.activeChatPanelId = panelId;
      } else {
        this.activeNonChatPanelId = panelId;
      }
    }

    this.remountPanel(panelId);
    this.updateVisibility();
    this.refreshActivePanelFrames();
    this.renderHeaderDock();
    this.updatePanelContextSummary();
    return true;
  }

  closePanel(panelId: string): void {
    if (this.isModalPanel(panelId)) {
      this.closeModalPanel(panelId);
      return;
    }
    if (!this.layout.panels[panelId]) {
      return;
    }

    let nextLayout = removePanel(this.layout.layout, panelId);
    if (!nextLayout) {
      // Last panel - create an empty panel first, then close this one
      const emptyId = this.openPanel('empty', { focus: false });
      if (!emptyId) {
        return;
      }
      nextLayout = removePanel(this.layout.layout, panelId);
      if (!nextLayout) {
        return;
      }
    }

    const { [panelId]: _, ...remainingPanels } = this.layout.panels;
    const nextHeaderPanels = this.getHeaderPanelIds().filter((id) => id !== panelId);
    const nextHeaderPanelSizes = { ...this.getHeaderPanelSizes() };
    delete nextHeaderPanelSizes[panelId];
    this.layout = {
      layout: nextLayout,
      panels: remainingPanels,
      headerPanels: nextHeaderPanels,
      headerPanelSizes: nextHeaderPanelSizes,
    };
    this.removeFromFocusHistory(panelId);

    if (this.openHeaderPanelId === panelId) {
      this.closeHeaderPopover();
    }

    this.persistLayout();
    this.render();

    if (this.activePanelId === panelId) {
      this.activePanelId = null;
      const fallback = findFirstPanelId(this.layout.layout);
      if (fallback) {
        this.focusPanel(fallback);
      }
    }

    this.options.host.setPanelVisibility(panelId, false);
    this.options.host.unmountPanel(panelId);
    this.mountedPanelIds.delete(panelId);
    this.panelVisibility.delete(panelId);
  }

  private isModalPanel(panelId: string): boolean {
    return this.modalPanelIds.has(panelId);
  }

  private closeModalPanel(panelId: string): void {
    if (!this.modalPanelIds.has(panelId)) {
      return;
    }
    this.modalPanelIds.delete(panelId);

    const { [panelId]: _, ...remainingPanels } = this.layout.panels;
    this.layout = { ...this.layout, panels: remainingPanels };
    this.removeFromFocusHistory(panelId);

    const unsubscribe = this.panelContextSubscriptions.get(panelId);
    if (unsubscribe) {
      unsubscribe();
      this.panelContextSubscriptions.delete(panelId);
    }

    if (this.activePanelId === panelId) {
      this.activePanelId = null;
      this.setActivePanelContext(null, 'program');
    }

    this.options.host.setPanelVisibility(panelId, false);
    this.options.host.unmountPanel(panelId);
    this.mountedPanelIds.delete(panelId);
    this.panelVisibility.delete(panelId);

    if (this.modalPanelIds.size === 0 && this.modalOverlay) {
      this.modalOverlay.classList.remove('open');
      this.modalOverlay.setAttribute('aria-hidden', 'true');
      this.modalOverlay.replaceChildren();
      this.modalOverlay.remove();
      if (this.modalOverlayCleanup) {
        this.modalOverlayCleanup();
        this.modalOverlayCleanup = null;
      }
      this.modalOverlay = null;
    }

    this.updateVisibility();
    this.ensureActivePanel();
    this.refreshActivePanelFrames();
    this.updatePanelContextSummary();
  }

  private ensureModalOverlay(): HTMLElement {
    if (this.modalOverlay) {
      return this.modalOverlay;
    }
    const overlay = document.createElement('div');
    overlay.className = 'panel-modal-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    document.body.appendChild(overlay);

    const handlePointerDown = (event: MouseEvent) => {
      if (event.target !== overlay) {
        return;
      }
      const modalId = this.modalPanelIds.values().next().value as string | undefined;
      if (modalId) {
        this.closePanel(modalId);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      if (this.isModalEscapeBlocked()) {
        return;
      }
      const modalId = this.modalPanelIds.values().next().value as string | undefined;
      if (modalId) {
        event.preventDefault();
        this.closePanel(modalId);
      }
    };

    overlay.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    this.modalOverlayCleanup = () => {
      overlay.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };

    this.modalOverlay = overlay;
    return overlay;
  }

  private isModalEscapeBlocked(): boolean {
    const selectors = [
      '.confirm-dialog-overlay',
      '.workspace-switcher-overlay.open',
      '#share-target-modal.visible',
      '.command-palette-overlay.open',
      '.panel-launcher-overlay.open',
      '.session-picker-popover',
      '.context-menu',
      '.panel-dock-popover.open',
    ];
    return selectors.some((selector) => Boolean(document.querySelector(selector)));
  }

  closePanelToPlaceholder(panelId: string): void {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return;
    }
    if (this.isPanelPinned(panelId)) {
      // Just close the popover, don't remove the pinned panel
      this.closeHeaderPopover();
      return;
    }
    if (panel.panelType === 'empty') {
      this.closePanel(panelId);
      return;
    }
    const replaced = this.replacePanel(panelId, 'empty');
    if (!replaced) {
      this.closePanel(panelId);
    }
  }

  movePanel(panelId: string, placement: PanelPlacement, targetPanelId?: string): void {
    if (!this.layout.panels[panelId]) {
      return;
    }

    if (this.isPanelPinned(panelId)) {
      this.removeHeaderPanel(panelId);
    }

    const containerSize = this.getPlacementContainerSize(targetPanelId);
    const nextLayout = movePanel(
      this.layout.layout,
      panelId,
      placement,
      targetPanelId,
      containerSize,
    );
    this.layout = {
      layout: nextLayout,
      panels: this.layout.panels,
      headerPanels: this.getHeaderPanelIds(),
      headerPanelSizes: this.getHeaderPanelSizes(),
    };

    this.persistLayout();
    this.render();
    this.focusPanel(panelId);
  }

  openPanelLauncher(options?: {
    targetPanelId?: string | null;
    defaultPlacement?: PanelPlacement | null;
    pinToHeader?: boolean;
    replacePanelId?: string | null;
  }): void {
    this.options.openPanelLauncher?.(options);
  }

  toggleSplitViewMode(splitId: string): void {
    const result = this.updateSplitById(this.layout.layout, splitId, (split) => {
      const currentMode = split.viewMode ?? 'split';
      const nextMode = currentMode === 'tabs' ? 'split' : 'tabs';
      const { activeId: _activeId, ...rest } = split;
      if (nextMode === 'tabs') {
        const firstChild = split.children[0] ?? null;
        const resolvedActive =
          (this.activePanelId && containsPanelId(split, this.activePanelId)
            ? this.activePanelId
            : null) ??
          split.activeId ??
          (firstChild ? findFirstPanelId(firstChild) : null);
        return {
          ...rest,
          viewMode: 'tabs',
          ...(resolvedActive ? { activeId: resolvedActive } : {}),
        };
      }
      return { ...rest, viewMode: 'split' };
    });

    if (!result.updated) {
      return;
    }

    this.layout = {
      layout: result.node,
      panels: this.layout.panels,
      headerPanels: this.getHeaderPanelIds(),
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    this.persistLayout();
    this.render();
  }

  closeSplit(splitId: string): void {
    const target = this.findSplitById(this.layout.layout, splitId);
    if (!target) {
      return;
    }

    const keepChild =
      target.viewMode === 'tabs'
        ? this.resolveActiveTabNode(target.children, target.activeId)
        : target.children[0];
    if (!keepChild) {
      return;
    }
    const keepIds = new Set(collectPanelIds(keepChild));
    const removeIds = collectPanelIds(target).filter((panelId) => !keepIds.has(panelId));
    if (removeIds.length === 0) {
      return;
    }

    let nextLayout: LayoutNode | null = this.layout.layout;
    const nextPanels: Record<string, PanelInstance> = { ...this.layout.panels };
    const nextHeaderPanelSizes = { ...this.getHeaderPanelSizes() };
    for (const panelId of removeIds) {
      delete nextPanels[panelId];
      delete nextHeaderPanelSizes[panelId];
      nextLayout = nextLayout ? removePanel(nextLayout, panelId) : null;
    }

    if (!nextLayout) {
      this.layout = this.createFallbackLayoutWithPanels(
        nextPanels,
        this.getHeaderPanelIds(),
        nextHeaderPanelSizes,
      );
    } else {
      this.layout = {
        layout: nextLayout,
        panels: nextPanels,
        headerPanels: this.getHeaderPanelIds(),
        headerPanelSizes: nextHeaderPanelSizes,
      };
    }
    this.persistLayout();
    this.render();
  }

  togglePanel(panelType: string): void {
    const existing = this.findPanelIdsByType(panelType);
    const pinnedPanelId = existing.find((panelId) => this.isPanelPinned(panelId)) ?? null;
    if (pinnedPanelId) {
      if (this.openHeaderPanelId === pinnedPanelId) {
        this.closeHeaderPopover();
      } else {
        this.openHeaderPanelId = pinnedPanelId;
      }
      this.renderHeaderDock();
      return;
    }
    if (existing.length > 0) {
      this.closePanel(existing[0] ?? '');
      return;
    }

    this.openPanel(panelType, { focus: true });
  }

  setPanelOpen(panelType: string, open: boolean): void {
    const existing = this.findPanelIdsByType(panelType);
    const pinnedPanelId = existing.find((panelId) => this.isPanelPinned(panelId)) ?? null;
    if (pinnedPanelId) {
      if (open) {
        if (this.openHeaderPanelId !== pinnedPanelId) {
          this.openHeaderPanelId = pinnedPanelId;
          this.renderHeaderDock();
        }
      } else if (this.openHeaderPanelId === pinnedPanelId) {
        this.closeHeaderPopover();
        this.renderHeaderDock();
      }
      return;
    }

    const isOpen = this.isPanelTypeOpen(panelType);
    if (open && !isOpen) {
      this.openPanel(panelType, { focus: true });
      return;
    }
    if (!open && isOpen) {
      this.togglePanel(panelType);
    }
  }

  updatePanelBinding(panelId: string, binding: PanelBinding | null): void {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return;
    }
    if (!isSessionBoundPanelType(panel.panelType)) {
      if (panel.binding) {
        delete panel.binding;
        this.persistLayout();
        this.render();
      }
      return;
    }
    if (binding) {
      panel.binding = binding;
    } else {
      delete panel.binding;
    }
    this.persistLayout();
    this.render();
  }

  updatePanelMetadata(panelId: string, meta: PanelInstance['meta']): void {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return;
    }
    const previousMeta = panel.meta ?? null;
    if (meta) {
      panel.meta = meta;
    } else {
      delete panel.meta;
    }
    this.persistLayout();
    if (this.shouldRenderForMetadataChange(previousMeta, panel.meta ?? null)) {
      this.render();
      return;
    }
    this.updatePanelContextSummary();
  }

  updatePanelState(panelId: string, state: PanelInstance['state']): void {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return;
    }
    if (state !== undefined) {
      panel.state = state;
    } else {
      delete panel.state;
    }
    this.persistLayout();
  }

  getPanelState(panelId: string): PanelInstance['state'] | null {
    const panel = this.layout.panels[panelId];
    return panel?.state ?? null;
  }

  private recordPanelFocus(panelId: string): void {
    if (!this.layout.panels[panelId]) {
      return;
    }
    if (this.modalPanelIds.has(panelId)) {
      return;
    }
    const existingIndex = this.focusHistory.indexOf(panelId);
    if (existingIndex === 0) {
      return;
    }
    if (existingIndex > 0) {
      this.focusHistory.splice(existingIndex, 1);
    }
    this.focusHistory.unshift(panelId);
    if (this.focusHistory.length > PanelWorkspaceController.FOCUS_HISTORY_LIMIT) {
      this.focusHistory.length = PanelWorkspaceController.FOCUS_HISTORY_LIMIT;
    }
    this.persistFocusHistory();
  }

  private removeFromFocusHistory(panelId: string): void {
    let index = this.focusHistory.indexOf(panelId);
    let removed = false;
    while (index >= 0) {
      this.focusHistory.splice(index, 1);
      removed = true;
      index = this.focusHistory.indexOf(panelId);
    }
    if (removed) {
      this.persistFocusHistory();
    }
  }

  private pruneFocusHistory(): void {
    const validIds = new Set(Object.keys(this.layout.panels));
    let removed = false;
    for (let index = this.focusHistory.length - 1; index >= 0; index -= 1) {
      const panelId = this.focusHistory[index];
      if (panelId && !validIds.has(panelId)) {
        this.focusHistory.splice(index, 1);
        removed = true;
      }
    }
    if (removed) {
      this.persistFocusHistory();
    }
  }

  private loadFocusHistoryFromStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      const raw = window.localStorage.getItem(FOCUS_HISTORY_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed && Array.isArray((parsed as { history?: unknown })
              .history)
          ? (parsed as { history: unknown[] }).history
          : null;
      if (!list) {
        return;
      }
      const seen = new Set<string>();
      for (const entry of list) {
        if (typeof entry !== 'string') {
          continue;
        }
        const trimmed = entry.trim();
        if (!trimmed || seen.has(trimmed)) {
          continue;
        }
        seen.add(trimmed);
        this.focusHistory.push(trimmed);
      }
      this.pruneFocusHistory();
    } catch {
      // Ignore localStorage parse errors.
    }
  }

  private persistFocusHistory(): void {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    try {
      window.localStorage.setItem(
        FOCUS_HISTORY_STORAGE_KEY,
        JSON.stringify(this.focusHistory),
      );
    } catch {
      // Ignore localStorage serialization errors.
    }
  }

  focusPanel(panelId: string, source: PanelFocusSource = 'program'): void {
    if (this.activePanelId && this.activePanelId !== panelId) {
      this.options.host.setPanelFocus(this.activePanelId, false);
    }
    this.activePanelId = panelId;
    this.recordPanelFocus(panelId);
    if (isPanelDebugEnabled()) {
      const panel = this.layout.panels[panelId];
      console.log('[panelWorkspace] focusPanel', {
        panelId,
        panelType: panel?.panelType ?? null,
        source,
      });
    }
    this.options.host.setPanelFocus(panelId, true);
    this.setActivePanelFrames(panelId);
    this.setActivePanelContext(panelId, source);
  }

  activatePanel(panelId: string): void {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return;
    }
    const didChange = this.activateTabsForPanel(this.layout.layout, panelId);
    if (didChange) {
      this.persistLayout();
      this.render();
    }
    this.focusPanel(panelId);
  }

  revealPanel(panelId: string): void {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return;
    }
    const didChange = this.activateTabsForPanel(this.layout.layout, panelId);
    if (didChange) {
      this.persistLayout();
      this.render();
    }
  }

  cycleTabForPanel(panelId: string, reverse = false): string | null {
    let nextPanelId: string | null = null;
    let didChange = false;
    const result = this.updateNearestSplitForPanel(this.layout.layout, panelId, (split) => {
      if (split.viewMode !== 'tabs' || split.children.length < 2) {
        return split;
      }
      const activeNode = this.resolveActiveTabNode(split.children, split.activeId ?? panelId);
      const activeIndex = split.children.indexOf(activeNode);
      if (activeIndex < 0) {
        return split;
      }
      const delta = reverse ? -1 : 1;
      const nextIndex = (activeIndex + delta + split.children.length) % split.children.length;
      const nextNode = split.children[nextIndex];
      const nextId = nextNode ? findFirstPanelId(nextNode) : null;
      if (!nextId || split.activeId === nextId) {
        return split;
      }
      nextPanelId = nextId;
      didChange = true;
      return { ...split, activeId: nextId };
    });

    if (!didChange || !nextPanelId) {
      return null;
    }

    this.layout = {
      layout: result.node,
      panels: this.layout.panels,
      headerPanels: this.getHeaderPanelIds(),
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    this.persistLayout();
    this.render();
    return nextPanelId;
  }

  private activateTabsForPanel(node: LayoutNode, panelId: string): boolean {
    if (node.kind === 'panel') {
      return false;
    }
    let changed = false;
    if (node.viewMode === 'tabs' && containsPanelId(node, panelId) && node.activeId !== panelId) {
      node.activeId = panelId;
      changed = true;
    }
    for (const child of node.children) {
      if (containsPanelId(child, panelId)) {
        changed = this.activateTabsForPanel(child, panelId) || changed;
      }
    }
    return changed;
  }

  private findPanelIdsByType(panelType: string): string[] {
    const ids = this.getAllPanelIds();
    return ids.filter((panelId) => this.layout.panels[panelId]?.panelType === panelType);
  }

  private loadInitialLayout(): LayoutPersistence {
    const fromStore = this.options.loadLayout ? this.options.loadLayout() : loadPanelLayout();
    if (fromStore) {
      const normalized = this.normalizeLayout(fromStore);
      if (normalized) {
        this.usesDefaultLayout = false;
        this.defaultPinsApplied = true;
        return normalized;
      }
    }

    const fallback = this.options.defaultLayout
      ? this.options.defaultLayout()
      : createDefaultPanelLayout(this.options.registry.listManifests());

    const normalizedFallback = this.normalizeLayout(fallback);
    if (normalizedFallback) {
      this.usesDefaultLayout = true;
      this.defaultPinsApplied = false;
      return normalizedFallback;
    }

    this.usesDefaultLayout = true;
    this.defaultPinsApplied = false;
    return this.createFallbackLayout();
  }

  private normalizeLayout(layout: LayoutPersistence): LayoutPersistence | null {
    let nextLayout: LayoutNode | null = layout.layout;
    const panels = { ...layout.panels };
    const panelIds = collectPanelIds(layout.layout);

    for (const panelId of panelIds) {
      const panel = panels[panelId];
      if (!panel) {
        nextLayout = nextLayout ? removePanel(nextLayout, panelId) : null;
        continue;
      }
      if (!isSessionBoundPanelType(panel.panelType) && panel.binding) {
        delete panel.binding;
      }
      if (!this.options.registry.getManifest(panel.panelType)) {
        continue;
      }
    }

    if (!nextLayout) {
      return null;
    }

    const nextHeaderPanels = (layout.headerPanels ?? []).filter((panelId) =>
      Boolean(panels[panelId]),
    );

    const nextPanelIds = new Set([...collectPanelIds(nextLayout), ...nextHeaderPanels]);
    const nextPanels: Record<string, PanelInstance> = {};
    for (const panelId of nextPanelIds) {
      const panel = panels[panelId];
      if (panel) {
        nextPanels[panelId] = panel;
      }
    }

    const rawHeaderPanelSizes = layout.headerPanelSizes ?? {};
    const nextHeaderPanelSizes: Record<string, { width: number; height: number }> = {};
    for (const [panelId, size] of Object.entries(rawHeaderPanelSizes)) {
      if (nextPanels[panelId]) {
        nextHeaderPanelSizes[panelId] = size;
      }
    }

    return {
      layout: nextLayout,
      panels: nextPanels,
      headerPanels: nextHeaderPanels,
      headerPanelSizes: nextHeaderPanelSizes,
    };
  }

  private createFallbackLayout(): LayoutPersistence {
    const manifests = this.options.registry.listManifests();
    if (manifests.length === 0) {
      throw new Error('No panels registered.');
    }

    const manifest =
      manifests.find((entry) => this.isPanelAvailable(entry.type, entry)) ?? manifests[0];
    if (!manifest) {
      throw new Error('No panels registered.');
    }
    const panelId = createPanelId(manifest.type, new Set());
    const panel = this.options.registry.createInstance(manifest.type, panelId);

    return {
      layout: { kind: 'panel', panelId },
      panels: { [panelId]: panel },
      headerPanels: [],
      headerPanelSizes: {},
    };
  }

  private createFallbackLayoutWithPanels(
    existingPanels: Record<string, PanelInstance>,
    headerPanels: string[],
    headerPanelSizes: Record<string, { width: number; height: number }> = {},
  ): LayoutPersistence {
    const manifests = this.options.registry.listManifests();
    if (manifests.length === 0) {
      throw new Error('No panels registered.');
    }

    const manifest =
      manifests.find((entry) => this.isPanelAvailable(entry.type, entry)) ?? manifests[0];
    if (!manifest) {
      throw new Error('No panels registered.');
    }

    const existingIds = new Set(Object.keys(existingPanels));
    for (const panelId of headerPanels) {
      existingIds.add(panelId);
    }
    const panelId = createPanelId(manifest.type, existingIds);
    const panel = this.options.registry.createInstance(manifest.type, panelId);

    return {
      layout: { kind: 'panel', panelId },
      panels: { ...existingPanels, [panelId]: panel },
      headerPanels,
      headerPanelSizes,
    };
  }

  private persistLayout(): void {
    const layout = this.stripModalPanels(this.layout);
    if (this.options.saveLayout) {
      this.options.saveLayout(layout);
      return;
    }

    try {
      savePanelLayout(layout);
    } catch {
      // Ignore localStorage serialization errors.
    }
  }

  private stripModalPanels(layout: LayoutPersistence): LayoutPersistence {
    if (this.modalPanelIds.size === 0) {
      return layout;
    }
    const panels = { ...layout.panels };
    for (const panelId of this.modalPanelIds) {
      delete panels[panelId];
    }
    const headerPanels = layout.headerPanels.filter((id) => !this.modalPanelIds.has(id));
    const headerPanelSizes = { ...layout.headerPanelSizes };
    for (const panelId of this.modalPanelIds) {
      delete headerPanelSizes[panelId];
    }
    return {
      ...layout,
      panels,
      headerPanels,
      headerPanelSizes,
    };
  }

  private captureScrollPositions(): Map<HTMLElement, number> {
    const positions = new Map<HTMLElement, number>();
    for (const container of this.panelElements.values()) {
      const scrollables = container.querySelectorAll<HTMLElement>(
        '.chat-log, .terminal-panel-body',
      );
      for (const element of scrollables) {
        positions.set(element, element.scrollTop);
      }
    }
    return positions;
  }

  private restoreScrollPositions(positions: Map<HTMLElement, number>): void {
    for (const [element, scrollTop] of positions) {
      if (element.isConnected) {
        element.scrollTop = scrollTop;
      }
    }
  }

  private render(options: { forceRemount?: boolean } = {}): void {
    this.closePanelMenu();
    this.stopPanelDrag();
    this.stopPanelReorder();
    this.pruneFocusHistory();
    this.unmountRemovedPanels(new Set(Object.keys(this.layout.panels)));
    const scrollPositions = this.captureScrollPositions();
    const rootNode = this.renderNode(this.layout.layout);
    this.options.root.replaceChildren(rootNode);
    this.mountPanels();
    this.restoreScrollPositions(scrollPositions);
    if (options.forceRemount) {
      for (const panelId of Object.keys(this.layout.panels)) {
        this.remountPanel(panelId);
      }
    }
    this.updateVisibility();
    this.ensureActivePanel();
    this.refreshActivePanelFrames();
    this.observePanels();
    this.renderHeaderDock();
    this.syncPanelContextSubscriptions();
    this.updatePanelContextSummary();
    this.options.onLayoutChange?.(this.layout);
  }

  private syncPanelContextSubscriptions(): void {
    const panelIds = new Set(Object.keys(this.layout.panels));
    for (const [panelId, unsubscribe] of this.panelContextSubscriptions.entries()) {
      if (!panelIds.has(panelId)) {
        unsubscribe();
        this.panelContextSubscriptions.delete(panelId);
      }
    }
    for (const panelId of panelIds) {
      if (this.panelContextSubscriptions.has(panelId)) {
        continue;
      }
      const key = getPanelContextKey(panelId);
      const unsubscribe = this.options.host.subscribeContext(key, () => {
        this.sendPanelInventory();
      });
      this.panelContextSubscriptions.set(panelId, unsubscribe);
    }
  }

  private resolveAvailability(
    panelType: string,
    manifest: PanelTypeManifest | null,
  ): ReturnType<typeof resolvePanelAvailability> {
    return resolvePanelAvailability(panelType, manifest, {
      allowedPanelTypes: this.options.getAvailablePanelTypes?.() ?? null,
      availableCapabilities: this.options.getAvailableCapabilities?.() ?? null,
    });
  }

  private isPanelAvailable(panelType: string, manifest: PanelTypeManifest | null): boolean {
    return this.resolveAvailability(panelType, manifest).state !== 'unavailable';
  }

  private observePanels(): void {
    if (!this.resizeObserver) {
      return;
    }
    this.resizeObserver.disconnect();
    for (const panelId of Object.keys(this.layout.panels)) {
      const element = this.panelElements.get(panelId);
      if (element) {
        this.resizeObserver.observe(element);
      }
    }
  }

  private renderNode(node: LayoutNode): HTMLElement {
    if (node.kind === 'panel') {
      return this.renderPanel(node.panelId);
    }
    if (node.viewMode === 'tabs') {
      return this.renderSplitTabs(node);
    }

    const container = document.createElement('div');
    container.className = `panel-split panel-split-${node.direction}`;
    container.dataset['splitId'] = node.splitId;

    const count = node.children.length;
    const sizes = normalizeSplitSizes(node.sizes, count);
    node.sizes = sizes;
    const wrappers: HTMLDivElement[] = [];

    node.children.forEach((child, index) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'panel-split-child';
      const ratio = sizes[index] ?? 1 / count;
      wrapper.style.flex = `${ratio} 1 0%`;
      wrapper.appendChild(this.renderNode(child));
      wrappers.push(wrapper);
    });

    if (count >= 2) {
      wrappers.forEach((wrapper, index) => {
        container.appendChild(wrapper);
        if (index < wrappers.length - 1) {
          const next = wrappers[index + 1];
          if (next) {
            container.appendChild(this.createSplitHandle(node, container, wrapper, next, index));
          }
        }
      });
    } else {
      for (const wrapper of wrappers) {
        container.appendChild(wrapper);
      }
    }

    return container;
  }

  private createSplitHandle(
    node: LayoutNode & { kind: 'split' },
    container: HTMLElement,
    first: HTMLElement,
    second: HTMLElement,
    index: number,
  ): HTMLElement {
    const handle = document.createElement('div');
    handle.className = `panel-split-handle panel-split-handle-${node.direction}`;
    handle.setAttribute('role', 'separator');
    handle.setAttribute(
      'aria-orientation',
      node.direction === 'horizontal' ? 'vertical' : 'horizontal',
    );

    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      const pointerId = event.pointerId;
      handle.setPointerCapture(pointerId);
      handle.classList.add('dragging');
      let didStop = false;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const firstRect = first.getBoundingClientRect();
        const secondRect = second.getBoundingClientRect();
        const combinedRect = mergeRects(firstRect, secondRect);
        const size = node.direction === 'horizontal' ? combinedRect.width : combinedRect.height;
        if (!size) {
          return;
        }
        const position =
          node.direction === 'horizontal'
            ? moveEvent.clientX - combinedRect.left
            : moveEvent.clientY - combinedRect.top;
        const rawRatio = position / size;
        const sizes = normalizeSplitSizes(node.sizes, node.children.length);
        const total = (sizes[index] ?? 0) + (sizes[index + 1] ?? 0);
        if (total <= 0) {
          return;
        }
        const minSize = 0.05;
        const minRatio = total < minSize * 2 ? 0.5 : minSize / total;
        const ratio = clamp(rawRatio, minRatio, 1 - minRatio);
        const nextFirst = total * ratio;
        const nextSecond = total - nextFirst;
        sizes[index] = nextFirst;
        sizes[index + 1] = nextSecond;
        node.sizes = sizes;
        applySplitSizes(first, second, nextFirst, nextSecond);
      };

      const stopResize = () => {
        if (didStop) {
          return;
        }
        didStop = true;
        if (handle.hasPointerCapture(pointerId)) {
          handle.releasePointerCapture(pointerId);
        }
        handle.classList.remove('dragging');
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerCancel);
        handle.removeEventListener('lostpointercapture', onLostPointerCapture);
        this.persistLayout();
        this.options.onLayoutChange?.(this.layout);
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        stopResize();
      };

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return;
        }
        stopResize();
      };

      const onLostPointerCapture = (lostEvent: PointerEvent) => {
        if (lostEvent.pointerId !== pointerId) {
          return;
        }
        stopResize();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerCancel);
      handle.addEventListener('lostpointercapture', onLostPointerCapture);
    });

    return handle;
  }

  private renderSplitTabs(node: LayoutNode & { kind: 'split' }): HTMLElement {
    const container = document.createElement('div');
    container.className = 'panel-tabs panel-tabs-split';
    container.dataset['splitId'] = node.splitId;

    const header = document.createElement('div');
    header.className = 'panel-tabs-header';
    container.appendChild(header);

    const content = document.createElement('div');
    content.className = 'panel-tabs-content';
    container.appendChild(content);

    const activeTab = this.resolveActiveTabNode(node.children, node.activeId);

    node.children.forEach((tab, index) => {
      const tabPanelId = findFirstPanelId(tab);
      const tabTitle = tabPanelId ? this.getPanelTitle(tabPanelId) : `Panel ${index + 1}`;
      const isActive = activeTab === tab;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'panel-tab-button';
      button.classList.toggle('active', isActive);
      button.textContent = tabTitle;
      if (tabPanelId) {
        button.setAttribute('data-panel-id', tabPanelId);
      }
      button.addEventListener('click', () => {
        if (!tabPanelId || node.activeId === tabPanelId) {
          return;
        }
        node.activeId = tabPanelId;
        this.persistLayout();
        this.render();
        this.focusPanel(tabPanelId);
      });
      if (node.children.length > 1) {
        button.draggable = true;
        button.addEventListener('dragstart', (event) => {
          if (event.dataTransfer) {
            event.dataTransfer.setData('text/tab-index', String(index));
            event.dataTransfer.setData('text/plain', String(index));
            event.dataTransfer.setDragImage(button, 4, 4);
          }
          button.classList.add('dragging');
        });
        button.addEventListener('dragend', () => {
          button.classList.remove('dragging');
        });
        button.addEventListener('dragover', (event) => {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'move';
          }
        });
        button.addEventListener('drop', (event) => {
          event.preventDefault();
          const rawIndex =
            event.dataTransfer?.getData('text/tab-index') ??
            event.dataTransfer?.getData('text/plain') ??
            '';
          const sourceIndex = Number.parseInt(rawIndex, 10);
          if (!Number.isFinite(sourceIndex) || sourceIndex === index) {
            return;
          }
          const moved = node.children.splice(sourceIndex, 1)[0];
          if (!moved) {
            return;
          }
          const targetIndex = sourceIndex < index ? index - 1 : index;
          node.children.splice(targetIndex, 0, moved);
          this.persistLayout();
          this.render();
        });
      }
      header.appendChild(button);

      const tabWrapper = document.createElement('div');
      tabWrapper.className = 'panel-tab-panel';
      tabWrapper.classList.toggle('active', isActive);
      if (!isActive) {
        tabWrapper.setAttribute('aria-hidden', 'true');
      }
      tabWrapper.appendChild(this.renderNode(tab));
      content.appendChild(tabWrapper);
    });

    if (this.options.openPanelLauncher) {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'panel-tab-add';
      addButton.textContent = '+';
      addButton.setAttribute('aria-label', 'Add panel tab');
      addButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.closePanelMenu();
        this.closeHeaderPopover();
        const targetPanelId = node.activeId ?? findFirstPanelId(activeTab);
        this.options.openPanelLauncher?.({
          targetPanelId,
          defaultPlacement: { region: 'center' },
        });
      });
      header.appendChild(addButton);
    }

    return container;
  }

  private renderPanel(panelId: string): HTMLElement {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      const empty = document.createElement('div');
      empty.className = 'panel-frame panel-frame-missing';
      empty.textContent = `Missing panel ${panelId}`;
      return empty;
    }

    const container = this.ensurePanelContainer(panelId, panel.panelType);

    const frame = document.createElement('div');
    frame.className = 'panel-frame';
    frame.dataset['panelId'] = panelId;
    frame.dataset['panelType'] = panel.panelType;
    frame.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.shouldFocusPanel(panelId, event.target, event.shiftKey)) {
          return;
        }
        if (!this.shouldFocusPanelOnPointer(panelId, event)) {
          return;
        }
        this.focusPanel(panelId, this.resolveFocusSource(event.target));
      },
      { capture: true },
    );
    // For chat panels, also handle click to focus input (after potential text selection)
    if (panel.panelType === 'chat') {
      frame.addEventListener('click', (event) => {
        // Skip if user made a text selection (drag-to-select)
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          return;
        }
        // Skip if clicking on interactive elements
        const target = event.target as Element;
        if (target.closest('button, a, input, textarea, [role="button"], .tool-output-block')) {
          return;
        }
        this.focusPanel(panelId, this.resolveFocusSource(event.target));
      });
    }
    frame.addEventListener('focusin', (event) => {
      if (!this.shouldFocusPanel(panelId, event.target)) {
        return;
      }
      if (!this.shouldFocusPanelOnFocus(panelId)) {
        return;
      }
      this.focusPanel(panelId, this.resolveFocusSource(event.target));
    });
    frame.appendChild(container);

    return frame;
  }

  private updateHeaderDockActiveState(): void {
    const dockRoot = this.headerDockRoot;
    if (!dockRoot) {
      return;
    }
    const activePanelId = this.activePanelId;
    const hasPinnedActive =
      !!activePanelId && this.isPanelPinned(activePanelId) && !!this.layout.panels[activePanelId];
    const buttons = dockRoot.querySelectorAll<HTMLButtonElement>(
      '.panel-dock-button[data-panel-id]',
    );
    for (const button of buttons) {
      const panelId = button.dataset['panelId'];
      const isActive = hasPinnedActive && panelId === activePanelId;
      button.classList.toggle('panel-active', isActive);
    }
  }

  private renderHeaderDock(): void {
    const dockRoot = this.headerDockRoot;
    if (!dockRoot) {
      if (this.openHeaderPanelId) {
        this.closeHeaderPopover();
      }
      return;
    }

    const storedHeaderPanels = this.getHeaderPanelIds();
    const nextHeaderPanels = storedHeaderPanels.filter((panelId) =>
      Boolean(this.layout.panels[panelId]),
    );
    if (nextHeaderPanels.length !== storedHeaderPanels.length) {
      this.setHeaderPanelIds(nextHeaderPanels);
      this.persistLayout();
    }

    const nextHeaderPanelSizes = { ...this.getHeaderPanelSizes() };
    let sizesChanged = false;
    for (const panelId of Object.keys(nextHeaderPanelSizes)) {
      if (!this.layout.panels[panelId]) {
        delete nextHeaderPanelSizes[panelId];
        sizesChanged = true;
      }
    }
    if (sizesChanged) {
      this.setHeaderPanelSizes(nextHeaderPanelSizes);
      this.persistLayout();
    }

    dockRoot.replaceChildren();

    let openAnchor: HTMLButtonElement | null = null;
    for (const panelId of nextHeaderPanels) {
      const panel = this.layout.panels[panelId] ?? null;
      const manifest = panel ? this.options.registry.getManifest(panel.panelType) : null;
      const title = this.getPanelTitle(panelId);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toolbar-button panel-dock-button';
      button.dataset['panelId'] = panelId;
      const iconSvg = resolveIconSvg(panel?.meta?.icon ?? manifest?.icon) ?? ICONS.panelGrid;
      button.innerHTML = iconSvg;
      button.title = this.getHeaderDockTooltip(panelId, manifest);
      button.setAttribute('aria-label', `Open ${title}`);
      button.setAttribute('aria-expanded', this.openHeaderPanelId === panelId ? 'true' : 'false');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.toggleHeaderPanel(panelId);
      });
      if (this.openHeaderPanelId === panelId) {
        button.classList.add('active');
        openAnchor = button;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'panel-dock-item';
      wrapper.appendChild(button);
      dockRoot.appendChild(wrapper);
    }

    if (this.options.openPanelLauncher) {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'toolbar-button panel-dock-button panel-dock-add';
      addButton.innerHTML = ICONS.plus;
      addButton.title = 'Pin panel to header';
      addButton.setAttribute('aria-label', 'Pin panel to header');
      addButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openPanelLauncher({ pinToHeader: true });
      });
      const addWrapper = document.createElement('div');
      addWrapper.className = 'panel-dock-item';
      addWrapper.appendChild(addButton);
      dockRoot.appendChild(addWrapper);
    }

    this.updateHeaderDockActiveState();

    if (nextHeaderPanels.length === 0 && this.openHeaderPanelId) {
      this.closeHeaderPopover();
    }

    if (this.openHeaderPanelId) {
      if (openAnchor) {
        this.openHeaderPopover(this.openHeaderPanelId, openAnchor);
      } else {
        this.closeHeaderPopover();
      }
    }
  }

  private toggleHeaderPanel(panelId: string): void {
    if (this.openHeaderPanelId === panelId) {
      this.closeHeaderPopover();
      this.renderHeaderDock();
      return;
    }
    this.openHeaderPanelId = panelId;
    this.renderHeaderDock();
  }

  private openHeaderPopover(panelId: string, anchor: HTMLElement): void {
    if (!this.isPanelPinned(panelId)) {
      this.closeHeaderPopover();
      return;
    }
    const popover = this.ensureHeaderPopover();
    popover.replaceChildren(this.renderHeaderPanel(panelId));
    popover.appendChild(this.createHeaderPopoverResizeHandle(popover, panelId));
    this.applyHeaderPopoverSize(popover, panelId);
    popover.classList.add('open');
    popover.setAttribute('aria-hidden', 'false');
    this.headerPopoverAnchor = anchor;
    this.positionHeaderPopover(anchor);
    this.attachHeaderPopoverListeners();
    this.updateVisibility();
    this.refreshActivePanelFrames();
  }

  private renderHeaderPanel(panelId: string): HTMLElement {
    const frame = this.renderPanel(panelId);
    frame.classList.add('panel-frame-dock');
    return frame;
  }

  closeHeaderPopover(): void {
    if (this.headerPopoverCleanup) {
      this.headerPopoverCleanup();
      this.headerPopoverCleanup = null;
    }
    if (this.headerPopover) {
      this.headerPopover.classList.remove('open');
      this.headerPopover.setAttribute('aria-hidden', 'true');
      this.headerPopover.replaceChildren();
    }
    this.headerPopoverAnchor = null;
    this.openHeaderPanelId = null;
    this.updateVisibility();
    this.refreshActivePanelFrames();
  }

  private ensureHeaderPopover(): HTMLElement {
    if (this.headerPopover) {
      return this.headerPopover;
    }
    const popover = document.createElement('div');
    popover.className = 'panel-dock-popover';
    popover.setAttribute('aria-hidden', 'true');
    document.body.appendChild(popover);
    this.headerPopover = popover;
    return popover;
  }

  private applyHeaderPopoverSize(popover: HTMLElement, panelId: string): void {
    const size = this.getHeaderPanelSizes()[panelId] ?? null;
    if (!size) {
      popover.style.width = '';
      popover.style.height = '';
      return;
    }
    popover.style.width = `${size.width}px`;
    popover.style.height = `${size.height}px`;
  }

  private createHeaderPopoverResizeHandle(popover: HTMLElement, panelId: string): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'panel-dock-resize-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', (event) => {
      this.startHeaderPopoverResize(popover, panelId, event);
    });
    return handle;
  }

  private startHeaderPopoverResize(
    popover: HTMLElement,
    panelId: string,
    event: PointerEvent,
  ): void {
    event.preventDefault();
    event.stopPropagation();
    const startRect = popover.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const minWidth = 320;
    const minHeight = 240;
    const padding = 16;
    const maxWidth = Math.max(minWidth, window.innerWidth - padding * 2);
    const maxHeight = Math.max(minHeight, window.innerHeight - padding * 2);

    let nextSize = { width: startRect.width, height: startRect.height };

    const handleMove = (moveEvent: PointerEvent) => {
      const nextWidth = clamp(startRect.width + (moveEvent.clientX - startX), minWidth, maxWidth);
      const nextHeight = clamp(
        startRect.height + (moveEvent.clientY - startY),
        minHeight,
        maxHeight,
      );
      nextSize = { width: nextWidth, height: nextHeight };
      popover.style.width = `${nextWidth}px`;
      popover.style.height = `${nextHeight}px`;
      if (this.headerPopoverAnchor) {
        this.positionHeaderPopover(this.headerPopoverAnchor);
      }
    };

    const stopResize = () => {
      this.setHeaderPanelSize(panelId, nextSize);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
  }

  private positionHeaderPopover(anchor: HTMLElement): void {
    if (!this.headerPopover) {
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = this.headerPopover.getBoundingClientRect();
    const padding = 8;

    let left = anchorRect.left;
    let top = anchorRect.bottom + 8;

    if (left + popoverRect.width > window.innerWidth - padding) {
      left = window.innerWidth - popoverRect.width - padding;
    }
    if (left < padding) {
      left = padding;
    }
    if (top + popoverRect.height > window.innerHeight - padding) {
      top = anchorRect.top - popoverRect.height - 8;
    }
    if (top < padding) {
      top = padding;
    }

    this.headerPopover.style.left = `${left}px`;
    this.headerPopover.style.top = `${top}px`;
  }

  private attachHeaderPopoverListeners(): void {
    if (this.headerPopoverCleanup) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (target instanceof HTMLElement && target.closest('.session-picker-popover')) {
        return;
      }
      // Don't close popover when interacting with dialogs/modals
      if (
        target instanceof HTMLElement &&
        target.closest(
          '.confirm-dialog-overlay, .workspace-switcher-overlay, #share-target-modal',
        )
      ) {
        return;
      }
      if (this.headerPopover?.contains(target)) {
        return;
      }
      if (this.headerDockRoot?.contains(target)) {
        return;
      }
      this.closeHeaderPopover();
      this.renderHeaderDock();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      this.closeHeaderPopover();
      this.renderHeaderDock();
    };

    const handleResize = () => {
      if (this.headerPopoverAnchor) {
        this.positionHeaderPopover(this.headerPopoverAnchor);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleResize);

    this.headerPopoverCleanup = () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleResize);
    };
  }

  private canPinPanel(panelId: string): boolean {
    if (this.isPanelPinned(panelId)) {
      return true;
    }
    return Boolean(this.layout.panels[panelId]);
  }

  pinPanelById(panelId: string): void {
    this.pinPanel(panelId);
  }

  private pinPanel(panelId: string): void {
    if (!this.layout.panels[panelId]) {
      return;
    }
    if (this.isPanelPinned(panelId)) {
      this.openHeaderPanelId = panelId;
      this.renderHeaderDock();
      return;
    }
    if (!this.canPinPanel(panelId)) {
      return;
    }

    let nextLayout = removePanel(this.layout.layout, panelId);
    if (!nextLayout) {
      // Last panel - create an empty panel first, then pin this one
      const emptyId = this.openPanel('empty', { focus: false });
      if (!emptyId) {
        return;
      }
      nextLayout = removePanel(this.layout.layout, panelId);
      if (!nextLayout) {
        return;
      }
    }

    this.layout = {
      layout: nextLayout,
      panels: this.layout.panels,
      headerPanels: [...this.getHeaderPanelIds(), panelId],
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    this.openHeaderPanelId = panelId;
    this.persistLayout();
    this.render();
  }

  private unpinPanel(panelId: string): void {
    if (!this.isPanelPinned(panelId)) {
      return;
    }

    const nextHeaderPanels = this.getHeaderPanelIds().filter((id) => id !== panelId);
    const targetPanelId = this.resolveUnpinTargetPanelId();
    const placement: PanelPlacement = { region: 'center' };
    const containerSize = this.getPlacementContainerSize(targetPanelId ?? undefined);
    const nextLayout = insertPanel(
      this.layout.layout,
      panelId,
      placement,
      targetPanelId ?? undefined,
      containerSize,
    );

    this.layout = {
      layout: nextLayout,
      panels: this.layout.panels,
      headerPanels: nextHeaderPanels,
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    if (this.openHeaderPanelId === panelId) {
      this.closeHeaderPopover();
    }
    this.persistLayout();
    this.render();
    this.focusPanel(panelId);
  }

  private removeHeaderPanel(panelId: string): void {
    if (!this.isPanelPinned(panelId)) {
      return;
    }
    this.setHeaderPanelIds(this.getHeaderPanelIds().filter((id) => id !== panelId));
    if (this.openHeaderPanelId === panelId) {
      this.closeHeaderPopover();
    }
  }

  private resolveUnpinTargetPanelId(): string | null {
    if (this.activePanelId && containsPanelId(this.layout.layout, this.activePanelId)) {
      return this.activePanelId;
    }
    return findFirstPanelId(this.layout.layout);
  }

  private resolveSessionScope(
    manifest: PanelTypeManifest | null,
    panelType: string,
  ): PanelSessionScope {
    if (!manifest || !isSessionBoundPanelType(panelType)) {
      return 'global';
    }
    if (manifest?.sessionScope) {
      return manifest.sessionScope;
    }
    if (manifest?.defaultSessionBinding === 'global') {
      return 'global';
    }
    return 'optional';
  }

  private formatBindingLabel(binding: PanelBinding | null, scope: PanelSessionScope): string {
    if (scope === 'global') {
      return 'Global';
    }
    if (binding?.mode === 'fixed') {
      return this.getSessionLabel(binding.sessionId);
    }
    if (scope === 'required') {
      return 'Select session';
    }
    return 'Unbound';
  }

  private getHeaderDockTooltip(panelId: string, manifest: PanelTypeManifest | null): string {
    const lines = [`Panel: ${this.getPanelTitle(panelId)}`];
    const bindingLabel = this.getHeaderDockBindingLabel(panelId, manifest);
    if (bindingLabel) {
      lines.push(`Session: ${bindingLabel}`);
    }
    return lines.join('\n');
  }

  private getHeaderDockBindingLabel(
    panelId: string,
    manifest: PanelTypeManifest | null,
  ): string | null {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return null;
    }
    if (!isSessionBoundPanelType(panel.panelType)) {
      return null;
    }
    const scope = this.resolveSessionScope(manifest, panel.panelType);
    const binding = this.resolvePanelBinding(panelId, panel, manifest);
    if (scope === 'global' || binding?.mode === 'global') {
      return null;
    }
    if (binding?.mode === 'fixed') {
      return this.getSessionLabel(binding.sessionId);
    }
    if (scope === 'required') {
      return 'Select session';
    }
    return 'Unbound';
  }

  private openPanelSessionPicker(
    panelId: string,
    anchor: HTMLElement,
    scope: PanelSessionScope,
  ): void {
    const panel = this.layout.panels[panelId];
    if (!panel || !isSessionBoundPanelType(panel.panelType) || !this.options.openSessionPicker) {
      return;
    }

    const allowUnbound = scope === 'optional';
    const disabledSessionIds =
      panel.panelType === 'chat' ? this.collectChatPanelSessionIds(panelId) : undefined;

    const pickerOptions: SessionPickerOpenOptions = {
      anchor,
      title: 'Select session',
      allowUnbound,
      createSessionOptions: { openChatPanel: false, selectSession: false },
      onSelectSession: (sessionId) => {
        this.options.host.setPanelBinding(panelId, { mode: 'fixed', sessionId });
      },
    };

    if (disabledSessionIds) {
      pickerOptions.disabledSessionIds = disabledSessionIds;
    }
    if (allowUnbound) {
      pickerOptions.onSelectUnbound = () => {
        this.options.host.setPanelBinding(panelId, null);
      };
    }

    this.options.openSessionPicker(pickerOptions);
  }

  private getSessionLabel(sessionId: string): string {
    const summaries = this.getSessionSummaries();
    const summary = summaries.find((candidate) => candidate.sessionId === sessionId);
    return formatSessionLabel(summary ?? { sessionId }, {
      agentSummaries: this.getAgentSummaries(),
    });
  }

  private getSessionSummaries(): Array<{ sessionId: string; name?: string; agentId?: string }> {
    const raw = this.options.host.getContext('session.summaries');
    if (!Array.isArray(raw)) {
      return [];
    }
    const summaries: Array<{ sessionId: string; name?: string; agentId?: string }> = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const typed = entry as { sessionId?: unknown; name?: unknown; agentId?: unknown };
      const sessionId = typeof typed.sessionId === 'string' ? typed.sessionId.trim() : '';
      if (!sessionId) {
        continue;
      }
      const name = typeof typed.name === 'string' ? typed.name : undefined;
      const agentId = typeof typed.agentId === 'string' ? typed.agentId : undefined;
      summaries.push({
        sessionId,
        ...(name ? { name } : {}),
        ...(agentId ? { agentId } : {}),
      });
    }
    return summaries;
  }

  private getAgentSummaries(): AgentLabelSummary[] {
    const raw = this.options.host.getContext('agent.summaries');
    if (!Array.isArray(raw)) {
      return [];
    }
    const summaries: AgentLabelSummary[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const typed = entry as { agentId?: unknown; displayName?: unknown };
      const agentId = typeof typed.agentId === 'string' ? typed.agentId.trim() : '';
      if (!agentId) {
        continue;
      }
      const displayName = typeof typed.displayName === 'string' ? typed.displayName.trim() : '';
      summaries.push({ agentId, displayName: displayName || agentId });
    }
    return summaries;
  }

  private collectChatPanelSessionIds(excludePanelId?: string): Set<string> {
    const ids = new Set<string>();
    for (const panelId of Object.keys(this.layout.panels)) {
      if (excludePanelId && panelId === excludePanelId) {
        continue;
      }
      const panel = this.layout.panels[panelId];
      if (!panel || panel.panelType !== 'chat') {
        continue;
      }
      const binding = panel.binding;
      if (binding?.mode === 'fixed') {
        ids.add(binding.sessionId);
      }
    }
    return ids;
  }

  private openSplitSessionPicker(panelId: string, anchor: HTMLElement): void {
    const split = this.findNearestSplitForPanel(this.layout.layout, panelId);
    if (!split || !this.options.openSessionPicker) {
      return;
    }

    const panelIds = collectPanelIds(split).filter((candidate) =>
      this.isPanelSessionBindable(candidate),
    );
    if (panelIds.length === 0) {
      return;
    }

    this.options.openSessionPicker({
      anchor,
      title: 'Bind split to session',
      createSessionOptions: { openChatPanel: false, selectSession: false },
      onSelectSession: (sessionId) => {
        for (const targetPanelId of panelIds) {
          this.options.host.setPanelBinding(targetPanelId, { mode: 'fixed', sessionId });
        }
      },
    });
  }

  private isPanelSessionBindable(panelId: string): boolean {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return false;
    }
    return isSessionBoundPanelType(panel.panelType);
  }

  private resolvePanelBinding(
    panelId: string,
    panel: PanelInstance,
    manifest: PanelTypeManifest | null,
  ): PanelBinding | null {
    if (!isSessionBoundPanelType(panel.panelType)) {
      return null;
    }
    const hostBinding = this.options.host.getPanelBinding(panelId);
    if (hostBinding) {
      return hostBinding;
    }
    if (panel.binding) {
      if (
        panel.binding.mode === 'global' &&
        this.resolveSessionScope(manifest, panel.panelType) !== 'global'
      ) {
        return null;
      }
      return panel.binding;
    }
    const scope = this.resolveSessionScope(manifest, panel.panelType);
    if (scope === 'global') {
      return { mode: 'global' };
    }
    if (manifest?.defaultSessionBinding === 'global') {
      return { mode: 'global' };
    }
    return null;
  }

  private resolveActiveTabNode(tabs: LayoutNode[], activeId?: string | null): LayoutNode {
    const selected = activeId ? tabs.find((tab) => containsPanelId(tab, activeId)) : null;
    return selected ?? tabs[0]!;
  }

  private updateNearestSplitForPanel(
    node: LayoutNode,
    panelId: string,
    updateSplit: (
      split: LayoutNode & { kind: 'split' },
      childIndex: number,
    ) => LayoutNode & { kind: 'split' },
  ): { node: LayoutNode; found: boolean; updated: boolean } {
    if (node.kind === 'panel') {
      return { node, found: node.panelId === panelId, updated: false };
    }

    let found = false;
    let updated = false;
    let updatedBelow = false;
    let targetChildIndex = -1;
    const nextChildren = node.children.map((child, index) => {
      const result = this.updateNearestSplitForPanel(child, panelId, updateSplit);
      if (result.found) {
        found = true;
        if (!result.updated) {
          targetChildIndex = index;
        }
      }
      if (result.updated) {
        updatedBelow = true;
      }
      updated = updated || result.updated;
      return result.node;
    });

    if (found && !updatedBelow && targetChildIndex >= 0) {
      const nextSplit = updateSplit(node, targetChildIndex);
      return { node: nextSplit, found: true, updated: true };
    }

    if (!updated) {
      return { node, found, updated: false };
    }

    return {
      node: {
        ...node,
        children: nextChildren,
      },
      found,
      updated: true,
    };
  }

  private toggleSplitViewModeForPanel(panelId: string): void {
    const result = this.updateNearestSplitForPanel(this.layout.layout, panelId, (split) => {
      const currentMode = split.viewMode ?? 'split';
      const nextMode = currentMode === 'tabs' ? 'split' : 'tabs';
      const { activeId: _activeId, ...rest } = split;
      if (nextMode === 'tabs') {
        const firstChild = split.children[0] ?? null;
        const resolvedActive =
          (panelId && containsPanelId(split, panelId) ? panelId : null) ??
          split.activeId ??
          (firstChild ? findFirstPanelId(firstChild) : null) ??
          panelId;
        return { ...rest, viewMode: 'tabs', activeId: resolvedActive };
      }
      return { ...rest, viewMode: 'split' };
    });

    if (!result.updated) {
      return;
    }

    this.layout = {
      layout: result.node,
      panels: this.layout.panels,
      headerPanels: this.getHeaderPanelIds(),
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    this.persistLayout();
    this.render();
  }

  toggleSplitViewModeForPanelId(panelId: string): void {
    this.toggleSplitViewModeForPanel(panelId);
  }

  private updateSplitById(
    node: LayoutNode,
    splitId: string,
    updateSplit: (split: LayoutNode & { kind: 'split' }) => LayoutNode,
  ): { node: LayoutNode; updated: boolean } {
    if (node.kind === 'panel') {
      return { node, updated: false };
    }
    if (node.splitId === splitId) {
      return { node: updateSplit(node), updated: true };
    }

    let updated = false;
    const nextChildren = node.children.map((child) => {
      const result = this.updateSplitById(child, splitId, updateSplit);
      if (result.updated) {
        updated = true;
      }
      return result.node;
    });
    if (!updated) {
      return { node, updated: false };
    }

    return {
      node: {
        ...node,
        children: nextChildren,
      },
      updated: true,
    };
  }

  private findSplitById(
    node: LayoutNode,
    splitId: string,
  ): (LayoutNode & { kind: 'split' }) | null {
    if (node.kind === 'panel') {
      return null;
    }
    if (node.splitId === splitId) {
      return node;
    }
    for (const child of node.children) {
      const found = this.findSplitById(child, splitId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private findNearestSplitForPanel(
    node: LayoutNode,
    panelId: string,
    nearestSplit: (LayoutNode & { kind: 'split' }) | null = null,
  ): (LayoutNode & { kind: 'split' }) | null {
    if (node.kind === 'panel') {
      return node.panelId === panelId ? nearestSplit : null;
    }

    for (const child of node.children) {
      const found = this.findNearestSplitForPanel(child, panelId, node);
      if (found) {
        return found;
      }
    }
    return null;
  }

  private ensurePanelContainer(panelId: string, panelType: string): HTMLElement {
    const existing = this.panelElements.get(panelId);
    if (existing) {
      existing.classList.remove('hidden');
      existing.dataset['panelId'] = panelId;
      existing.dataset['panelType'] = panelType;
      existing.setAttribute('aria-label', this.getPanelTitle(panelId));
      return existing;
    }

    const container = document.createElement('section');
    container.className = 'panel panel-instance';
    container.dataset['panelId'] = panelId;
    container.dataset['panelType'] = panelType;
    container.setAttribute('aria-label', this.getPanelTitle(panelId));

    this.panelElements.set(panelId, container);
    return container;
  }

  private shouldRenderForMetadataChange(
    previous: PanelInstance['meta'] | null,
    next: PanelInstance['meta'] | null,
  ): boolean {
    const prevTitle = previous?.title ?? null;
    const nextTitle = next?.title ?? null;
    if (prevTitle !== nextTitle) {
      return true;
    }
    const prevIcon = previous?.icon ?? null;
    const nextIcon = next?.icon ?? null;
    if (prevIcon !== nextIcon) {
      return true;
    }
    return false;
  }

  private getPanelTitle(panelId: string): string {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return 'Panel';
    }
    const override = panel.meta?.title;
    if (override) {
      return override;
    }
    const manifest = this.options.registry.getManifest(panel.panelType);
    return manifest?.title ?? panel.panelType;
  }

  private mountPanels(): void {
    for (const panelId of Object.keys(this.layout.panels)) {
      if (this.mountedPanelIds.has(panelId)) {
        continue;
      }
      const panel = this.layout.panels[panelId];
      if (!panel) {
        continue;
      }
      this.mountedPanelIds.add(panelId);
      const container = this.ensurePanelContainer(panelId, panel.panelType);
      const mountOptions: {
        panelId: string;
        panelType: string;
        container: HTMLElement;
        binding?: PanelBinding;
        state?: PanelInstance['state'];
      } = {
        panelId,
        panelType: panel.panelType,
        container,
      };
      if (panel.binding) {
        mountOptions.binding = panel.binding;
      }
      if (panel.state !== undefined) {
        mountOptions.state = panel.state;
      }
      try {
        this.options.host.mountPanel(mountOptions);
      } catch (err) {
        this.mountedPanelIds.delete(panelId);
        console.error('Failed to mount panel', panelId, err);
      }
    }
  }

  private remountPanel(panelId: string): void {
    if (!this.mountedPanelIds.has(panelId)) {
      return;
    }
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return;
    }
    this.options.host.unmountPanel(panelId);
    this.mountedPanelIds.delete(panelId);
    this.panelVisibility.delete(panelId);

    const container = this.ensurePanelContainer(panelId, panel.panelType);
    const mountOptions: {
      panelId: string;
      panelType: string;
      container: HTMLElement;
      binding?: PanelBinding;
      state?: PanelInstance['state'];
    } = {
      panelId,
      panelType: panel.panelType,
      container,
    };
    if (panel.binding) {
      mountOptions.binding = panel.binding;
    }
    if (panel.state !== undefined) {
      mountOptions.state = panel.state;
    }
    try {
      this.options.host.mountPanel(mountOptions);
      this.mountedPanelIds.add(panelId);
    } catch (err) {
      console.error('Failed to remount panel', panelId, err);
    }
  }

  private updateVisibility(): void {
    const visiblePanels = collectVisiblePanelIds(this.layout.layout);
    if (this.openHeaderPanelId) {
      visiblePanels.add(this.openHeaderPanelId);
    }
    for (const panelId of this.modalPanelIds) {
      visiblePanels.add(panelId);
    }
    const openPanelIds = new Set(Object.keys(this.layout.panels));

    let didChange = false;
    for (const panelId of openPanelIds) {
      const visible = visiblePanels.has(panelId);
      const previous = this.panelVisibility.get(panelId);
      if (previous !== visible) {
        this.panelVisibility.set(panelId, visible);
        this.options.host.setPanelVisibility(panelId, visible);
        didChange = true;
      }
    }

    for (const panelId of Array.from(this.panelVisibility.keys())) {
      if (!openPanelIds.has(panelId)) {
        this.panelVisibility.delete(panelId);
        didChange = true;
      }
    }
    if (didChange) {
      this.updatePanelContextSummary();
    }
  }

  private getPlacementContainerSize(targetPanelId?: string): PanelContainerSize | undefined {
    const targetElement = targetPanelId ? this.panelElements.get(targetPanelId) : null;
    const reference = targetElement ?? this.options.root;
    if (!reference) {
      return undefined;
    }
    const rect = reference.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return undefined;
    }
    return { width: rect.width, height: rect.height };
  }

  private unmountRemovedPanels(nextPanelIds: Set<string>): void {
    for (const panelId of Array.from(this.mountedPanelIds)) {
      if (nextPanelIds.has(panelId)) {
        continue;
      }
      this.removeFromFocusHistory(panelId);
      if (this.activePanelId === panelId) {
        this.activePanelId = null;
        this.setActivePanelContext(null, 'program');
      }
      if (this.activeChatPanelId === panelId) {
        this.activeChatPanelId = null;
      }
      if (this.activeNonChatPanelId === panelId) {
        this.activeNonChatPanelId = null;
      }
      this.options.host.setPanelVisibility(panelId, false);
      this.options.host.unmountPanel(panelId);
      this.mountedPanelIds.delete(panelId);
      this.panelVisibility.delete(panelId);
    }
  }

  private ensureActivePanel(): void {
    const visiblePanels = collectVisiblePanelIds(this.layout.layout);
    for (const panelId of this.modalPanelIds) {
      visiblePanels.add(panelId);
    }
    if (visiblePanels.size === 0) {
      return;
    }
    if (this.activePanelId && visiblePanels.has(this.activePanelId)) {
      return;
    }

    const orderedPanels = collectPanelIds(this.layout.layout);
    const nextActive = orderedPanels.find((panelId) => visiblePanels.has(panelId));
    if (nextActive) {
      this.focusPanel(nextActive);
    }
  }

  private setActivePanelFrames(panelId: string | null): void {
    if (panelId) {
      const panel = this.layout.panels[panelId];
      if (panel?.panelType === 'chat') {
        this.activeChatPanelId = panelId;
      } else if (panel?.panelType) {
        this.activeNonChatPanelId = panelId;
      }
    }
    this.refreshActivePanelFrames();
  }

  private refreshActivePanelFrames(): void {
    if (this.activeChatPanelId && !this.layout.panels[this.activeChatPanelId]) {
      this.activeChatPanelId = null;
    }
    if (this.activeNonChatPanelId && !this.layout.panels[this.activeNonChatPanelId]) {
      this.activeNonChatPanelId = null;
    }
    if (this.activeChatPanelFrame) {
      this.activeChatPanelFrame.classList.remove('is-chat-active');
      this.activeChatPanelFrame = null;
    }
    if (this.activeChatPanelContent) {
      this.activeChatPanelContent.classList.remove('chat-active');
      this.activeChatPanelContent = null;
    }
    if (this.activeNonChatPanelFrame) {
      this.activeNonChatPanelFrame.classList.remove('is-active');
      this.activeNonChatPanelFrame = null;
    }
    if (this.activeChatPanelId) {
      const frame = this.findPanelFrame(this.activeChatPanelId);
      if (frame) {
        frame.classList.add('is-chat-active');
        this.activeChatPanelFrame = frame;
      }
      let content = this.panelElements.get(this.activeChatPanelId) ?? null;
      if (!content || !content.isConnected) {
        const fallback = frame?.querySelector<HTMLElement>(
          `.panel-instance[data-panel-id="${this.activeChatPanelId}"]`,
        );
        if (fallback) {
          content = fallback;
          this.panelElements.set(this.activeChatPanelId, fallback);
        }
      }
      if (content) {
        content.classList.add('chat-active');
        this.activeChatPanelContent = content;
      }
    }
    if (this.activeNonChatPanelId) {
      const frame = this.findPanelFrame(this.activeNonChatPanelId);
      if (frame) {
        frame.classList.add('is-active');
        this.activeNonChatPanelFrame = frame;
      }
    }
    this.updateHeaderDockActiveState();
    if (isPanelDebugEnabled()) {
      console.log('[panelWorkspace] refreshActivePanelFrames', {
        activePanelId: this.activePanelId,
        activeChatPanelId: this.activeChatPanelId,
        activeNonChatPanelId: this.activeNonChatPanelId,
        chatFrameFound: Boolean(this.activeChatPanelFrame),
        chatContentFound: Boolean(this.activeChatPanelContent),
        nonChatFrameFound: Boolean(this.activeNonChatPanelFrame),
      });
    }
  }

  private findPanelFrame(panelId: string): HTMLElement | null {
    return (
      this.options.root.querySelector<HTMLElement>(`.panel-frame[data-panel-id="${panelId}"]`) ??
      this.headerPopover?.querySelector<HTMLElement>(`.panel-frame[data-panel-id="${panelId}"]`) ??
      this.modalOverlay?.querySelector<HTMLElement>(`.panel-frame[data-panel-id="${panelId}"]`) ??
      null
    );
  }

  private setActivePanelContext(panelId: string | null, source: PanelFocusSource): void {
    if (!panelId) {
      this.options.host.setContext('panel.active', null);
      this.updatePanelContextSummary();
      return;
    }
    const panel = this.layout.panels[panelId];
    if (!panel) {
      this.options.host.setContext('panel.active', null);
      this.updatePanelContextSummary();
      return;
    }
    const panelTitle = this.getPanelTitle(panelId);
    this.options.host.setContext('panel.active', {
      panelId,
      panelType: panel.panelType,
      panelTitle,
      source,
    });
    this.updatePanelContextSummary();
  }

  private buildPanelSummary(panelId: string): {
    panelId: string;
    panelType: string;
    panelTitle: string;
  } | null {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return null;
    }
    return {
      panelId,
      panelType: panel.panelType,
      panelTitle: this.getPanelTitle(panelId),
    };
  }

  private normalizePanelContext(panelId: string): Record<string, unknown> | null {
    const raw = this.options.host.getContext(getPanelContextKey(panelId));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    return raw as Record<string, unknown>;
  }

  private buildPanelInventoryEntry(
    panelId: string,
  ): PanelInventoryPayload['panels'][number] | null {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return null;
    }
    const binding = panel.binding ?? null;
    const visible = this.panelVisibility.get(panelId) ?? false;
    const context = this.normalizePanelContext(panelId);
    return {
      panelId,
      panelType: panel.panelType,
      panelTitle: this.getPanelTitle(panelId),
      visible,
      binding,
      ...(context ? { context } : {}),
    };
  }

  private sendPanelInventory(): void {
    const panels = Object.keys(this.layout.panels)
      .map((panelId) => this.buildPanelInventoryEntry(panelId))
      .filter((panel): panel is PanelInventoryPayload['panels'][number] => panel !== null);
    const selectedPanelId =
      this.activeNonChatPanelId && this.layout.panels[this.activeNonChatPanelId]
        ? this.activeNonChatPanelId
        : null;
    const selectedChatPanelId =
      this.activeChatPanelId && this.layout.panels[this.activeChatPanelId]
        ? this.activeChatPanelId
        : null;
    const payload: PanelInventoryPayload = {
      type: 'panel_inventory',
      panels,
      selectedPanelId,
      selectedChatPanelId,
      layout: this.layout.layout,
      headerPanels: this.getHeaderPanelIds(),
    };
    this.options.host.sendPanelEvent({
      type: 'panel_event',
      panelId: 'workspace',
      panelType: 'workspace',
      payload,
    });
  }

  publishPanelInventory(): void {
    this.sendPanelInventory();
  }

  private updatePanelContextSummary(): void {
    const panels = Object.keys(this.layout.panels)
      .map((panelId) => this.buildPanelSummary(panelId))
      .filter(
        (panel): panel is { panelId: string; panelType: string; panelTitle: string } =>
          panel !== null,
      );
    const active = this.activeNonChatPanelId
      ? this.buildPanelSummary(this.activeNonChatPanelId)
      : null;
    this.options.host.setContext('panel.context', {
      active,
      panels,
    });
    this.sendPanelInventory();
  }

  private resolveFocusSource(target: EventTarget | null): PanelFocusSource {
    if (!(target instanceof Element)) {
      return 'program';
    }
    return target.closest(this.chromeSelector) ? 'chrome' : 'content';
  }

  private shouldFocusPanelOnPointer(panelId: string, event: PointerEvent): boolean {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return false;
    }
    if (panel.panelType === 'chat') {
      // Skip re-focusing if already active (allows text selection)
      if (this.activePanelId === panelId) {
        return false;
      }
      return true;
    }
    // Use Command (Meta) key on Mac, Ctrl key on other platforms to focus non-chat panels
    return event.metaKey || event.ctrlKey;
  }

  private shouldFocusPanelOnFocus(panelId: string): boolean {
    const panel = this.layout.panels[panelId];
    if (!panel) {
      return false;
    }
    return panel.panelType === 'chat';
  }

  private shouldFocusPanel(
    panelId: string,
    target: EventTarget | null,
    allowNavigatorOverride = false,
  ): boolean {
    const panel = this.layout.panels[panelId];
    if (!panel || panel.panelType !== 'navigator') {
      return true;
    }
    if (allowNavigatorOverride) {
      return true;
    }
    if (!(target instanceof Element)) {
      return true;
    }
    return !target.closest(
      '.workspace-navigator-row, .workspace-navigator-actions, .workspace-navigator-action',
    );
  }

  openPanelMenu(panelId: string, anchor: HTMLElement): void {
    this.closePanelMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu panel-context-menu';

    const panel = this.layout.panels[panelId] ?? null;
    const manifest = panel ? this.options.registry.getManifest(panel.panelType) : null;

    const addItem = (
      label: string,
      onClick: () => void,
      extraClass?: string,
      options?: { closeOnClick?: boolean },
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = extraClass ? `context-menu-item ${extraClass}` : 'context-menu-item';
      button.textContent = label;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        if (options?.closeOnClick !== false) {
          this.closePanelMenu();
        }
        onClick();
      });
      menu.appendChild(button);
      return button;
    };

    if (this.isPanelPinned(panelId)) {
      addItem('Unpin from header', () => this.unpinPanel(panelId));
    } else {
      const pinButton = addItem('Pin to header', () => this.pinPanel(panelId));
      if (!this.canPinPanel(panelId)) {
        pinButton.disabled = true;
        pinButton.title = 'Open another panel before pinning';
      }
    }

    if (panel && panel.panelType !== 'chat') {
      addItem('Select panel', () => this.focusPanel(panelId));
    }

    if (
      panel &&
      isSessionBoundPanelType(panel.panelType) &&
      this.options.openSessionPicker &&
      this.resolveSessionScope(manifest, panel.panelType) !== 'global'
    ) {
      const binding = this.resolvePanelBinding(panelId, panel, manifest);
      const label = binding?.mode === 'fixed' ? 'Change session...' : 'Bind panel to session...';
      addItem(label, () => {
        this.openPanelSessionPicker(
          panelId,
          anchor,
          this.resolveSessionScope(manifest, panel.panelType),
        );
      });
    }

    if (this.options.openPanelLauncher) {
      addItem('Replace panel with...', () => {
        this.options.openPanelLauncher?.({ replacePanelId: panelId });
      });
      const splitButton = addItem(
        'Split with new panel... >',
        () => {
          this.openPanelMenuSplitOptions(panelId, splitButton);
        },
        undefined,
        { closeOnClick: false },
      );
      const openSplitMenu = () => {
        this.openPanelMenuSplitOptions(panelId, splitButton);
      };
      splitButton.addEventListener('mouseenter', openSplitMenu);
      splitButton.addEventListener('focus', openSplitMenu);
    }

    addItem('Dock left', () => this.movePanel(panelId, { region: 'left' }));
    addItem('Dock right', () => this.movePanel(panelId, { region: 'right' }));
    addItem('Dock top', () => this.movePanel(panelId, { region: 'top' }));
    addItem('Dock bottom', () => this.movePanel(panelId, { region: 'bottom' }));
    addItem('Tab with workspace', () => this.movePanel(panelId, { region: 'center' }));
    if (this.options.openPanelLauncher) {
      addItem('Add panel tab...', () => {
        this.options.openPanelLauncher?.({
          targetPanelId: panelId,
          defaultPlacement: { region: 'center' },
        });
      });
    }

    const nearestSplit = this.findNearestSplitForPanel(this.layout.layout, panelId);
    if (nearestSplit) {
      const currentMode = nearestSplit.viewMode ?? 'split';
      const label = currentMode === 'tabs' ? 'View as split' : 'View as tabs';
      addItem(label, () => this.toggleSplitViewModeForPanel(panelId));

      if (this.options.openSessionPicker) {
        const hasBindablePanels = collectPanelIds(nearestSplit).some((candidate) =>
          this.isPanelSessionBindable(candidate),
        );
        if (hasBindablePanels) {
          const bindButton = addItem('Bind split to session...', () => {
            this.openSplitSessionPicker(panelId, bindButton);
          });
        }
      }
    }
    addItem('Remove panel', () => this.closePanel(panelId), 'danger');

    document.body.appendChild(menu);
    this.activeMenu = menu;

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let left = anchorRect.right - menuRect.width;
    let top = anchorRect.bottom + 6;
    const padding = 8;

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
      const target = event.target as Node;
      const insideSubmenu = this.activeSubMenu?.contains(target) ?? false;
      if (!menu.contains(target) && !insideSubmenu && target !== anchor) {
        this.closePanelMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closePanelMenu();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    this.menuCleanup = () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }

  private openPanelMenuSplitOptions(panelId: string, anchor: HTMLElement): void {
    if (!this.options.openPanelLauncher) {
      return;
    }
    if (this.activeSubMenu) {
      this.activeSubMenu.remove();
      this.activeSubMenu = null;
    }

    const menu = document.createElement('div');
    menu.className = 'context-menu panel-context-menu-submenu';

    const addItem = (label: string, placement: PanelPlacement): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'context-menu-item';
      button.textContent = label;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        this.closePanelMenu();
        this.options.openPanelLauncher?.({
          targetPanelId: panelId,
          defaultPlacement: placement,
        });
      });
      menu.appendChild(button);
    };

    addItem('Split right', { region: 'right' });
    addItem('Split left', { region: 'left' });
    addItem('Split bottom', { region: 'bottom' });
    addItem('Split top', { region: 'top' });

    document.body.appendChild(menu);
    this.activeSubMenu = menu;

    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;
    const offset = 4;

    let left = anchorRect.right + offset;
    let top = anchorRect.top;

    if (left + menuRect.width > window.innerWidth - padding) {
      left = anchorRect.left - menuRect.width - offset;
    }
    if (left < padding) {
      left = padding;
    }
    if (top + menuRect.height > window.innerHeight - padding) {
      top = window.innerHeight - menuRect.height - padding;
    }
    if (top < padding) {
      top = padding;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  private closePanelMenu(): void {
    if (this.menuCleanup) {
      this.menuCleanup();
      this.menuCleanup = null;
    }
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
    if (this.activeSubMenu) {
      this.activeSubMenu.remove();
      this.activeSubMenu = null;
    }
  }

  startPanelDrag(panelId: string, event: PointerEvent): void {
    this.closePanelMenu();
    this.stopPanelDrag();
    this.stopPanelReorder();

    const overlay = document.createElement('div');
    overlay.className = 'panel-dock-overlay';

    const highlight = document.createElement('div');
    highlight.className = 'panel-dock-highlight';
    overlay.appendChild(highlight);

    document.body.appendChild(overlay);
    document.body.classList.add('panel-dragging');

    const state: PanelDragState = {
      panelId,
      overlay,
      highlight,
      placement: null,
      targetPanelId: null,
      dropTarget: null,
      cleanup: () => undefined,
    };
    this.dragState = state;

    const handleMove = (moveEvent: PointerEvent) => {
      this.updatePanelDrag(state, moveEvent);
    };
    const handleUp = (upEvent: PointerEvent) => {
      this.finishPanelDrag(state, upEvent);
    };
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        this.stopPanelDrag();
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('keydown', handleKeyDown);

    state.cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('keydown', handleKeyDown);
    };

    this.updatePanelDrag(state, event);
  }

  private getHeaderDockRect(): DOMRect | null {
    if (!this.headerDockRoot) {
      return null;
    }
    const rect = this.headerDockRoot.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return rect;
  }

  private applyDragHighlight(state: PanelDragState, rect: HighlightRect): void {
    const { highlight } = state;
    highlight.style.display = 'block';
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  private updatePanelDrag(state: PanelDragState, event: PointerEvent): void {
    const { clientX, clientY } = event;
    const workspaceRect = this.options.root.getBoundingClientRect();
    const headerDockRect = this.getHeaderDockRect();

    if (headerDockRect && pointInRect(clientX, clientY, headerDockRect)) {
      state.dropTarget = 'header';
      state.placement = null;
      state.targetPanelId = null;
      this.applyDragHighlight(state, headerDockRect);
      return;
    }

    if (!pointInRect(clientX, clientY, workspaceRect)) {
      state.placement = null;
      state.targetPanelId = null;
      state.dropTarget = null;
      state.highlight.style.display = 'none';
      return;
    }

    const hoveredPanel = getPanelFrameAtPoint(clientX, clientY);
    const hoveredPanelId = hoveredPanel?.dataset['panelId'] ?? null;
    const targetPanelId =
      hoveredPanelId && hoveredPanelId !== state.panelId ? hoveredPanelId : null;
    const targetRect =
      targetPanelId && hoveredPanel ? hoveredPanel.getBoundingClientRect() : workspaceRect;
    const region = resolveDropRegion(clientX, clientY, targetRect);

    state.dropTarget = 'layout';
    state.placement = { region };
    state.targetPanelId = targetPanelId;

    const highlightRect = computeHighlightRect(region, targetRect);
    this.applyDragHighlight(state, highlightRect);
  }

  private finishPanelDrag(state: PanelDragState, event: PointerEvent): void {
    event.preventDefault();
    const placement = state.placement;
    const targetPanelId = state.targetPanelId ?? undefined;
    const panelId = state.panelId;
    const dropTarget = state.dropTarget;

    this.stopPanelDrag();

    if (dropTarget === 'header') {
      this.pinPanel(panelId);
      return;
    }

    if (!placement) {
      return;
    }

    this.movePanel(panelId, placement, targetPanelId);
  }

  private stopPanelDrag(): void {
    if (!this.dragState) {
      return;
    }

    this.dragState.cleanup();
    this.dragState.overlay.remove();
    this.dragState = null;
    document.body.classList.remove('panel-dragging');
  }

  startPanelReorder(panelId: string, event: PointerEvent): void {
    this.closePanelMenu();
    this.stopPanelReorder();
    this.stopPanelDrag();

    const splitTarget = this.getSplitContainerForPanel(panelId);
    if (!splitTarget) {
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'panel-reorder-overlay';

    const highlight = document.createElement('div');
    highlight.className = 'panel-reorder-highlight';
    overlay.appendChild(highlight);

    document.body.appendChild(overlay);
    document.body.classList.add('panel-reordering');

    const state: PanelReorderState = {
      panelId,
      overlay,
      highlight,
      splitContainer: splitTarget.container,
      direction: splitTarget.direction,
      sourceIndex: splitTarget.sourceIndex,
      targetIndex: null,
      cleanup: () => undefined,
    };
    this.reorderState = state;

    const handleMove = (moveEvent: PointerEvent) => {
      this.updatePanelReorder(state, moveEvent);
    };
    const handleUp = (upEvent: PointerEvent) => {
      this.finishPanelReorder(state, upEvent);
    };
    const handleKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault();
        this.stopPanelReorder();
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('keydown', handleKeyDown);

    state.cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('keydown', handleKeyDown);
    };

    this.updatePanelReorder(state, event);
  }

  private updatePanelReorder(state: PanelReorderState, event: PointerEvent): void {
    const { clientX, clientY } = event;
    const rect = state.splitContainer.getBoundingClientRect();

    if (!pointInRect(clientX, clientY, rect)) {
      state.targetIndex = null;
      state.highlight.style.display = 'none';
      return;
    }

    const children = this.getSplitChildren(state.splitContainer);
    if (children.length < 2) {
      state.targetIndex = null;
      state.highlight.style.display = 'none';
      return;
    }

    const targetIndex = this.resolveSplitChildIndex(children, clientX, clientY, state.direction);
    state.targetIndex = targetIndex;

    if (targetIndex === state.sourceIndex) {
      state.highlight.style.display = 'none';
      return;
    }

    const targetRect = children[targetIndex]?.getBoundingClientRect();
    if (!targetRect) {
      state.highlight.style.display = 'none';
      return;
    }

    state.highlight.style.display = 'block';
    state.highlight.style.left = `${targetRect.left}px`;
    state.highlight.style.top = `${targetRect.top}px`;
    state.highlight.style.width = `${targetRect.width}px`;
    state.highlight.style.height = `${targetRect.height}px`;
  }

  private finishPanelReorder(state: PanelReorderState, event: PointerEvent): void {
    event.preventDefault();
    const { panelId, sourceIndex, targetIndex } = state;
    this.stopPanelReorder();

    if (targetIndex === null || targetIndex === sourceIndex) {
      return;
    }

    const result = this.updateNearestSplitForPanel(
      this.layout.layout,
      panelId,
      (split, childIndex) => {
        if (split.children.length < 2) {
          return split;
        }
        if (childIndex === targetIndex) {
          return split;
        }

        const nextChildren = split.children.slice();
        const moved = nextChildren.splice(childIndex, 1)[0];
        if (!moved) {
          return split;
        }
        nextChildren.splice(targetIndex, 0, moved);
        const baseSizes = normalizeSplitSizes(split.sizes, split.children.length);
        const nextSizes = baseSizes.slice();
        const movedSize = nextSizes.splice(childIndex, 1)[0];
        if (movedSize !== undefined) {
          nextSizes.splice(targetIndex, 0, movedSize);
        }

        return {
          ...split,
          children: nextChildren,
          sizes: normalizeSplitSizes(nextSizes, nextChildren.length),
        };
      },
    );

    if (!result.updated) {
      return;
    }

    this.layout = {
      layout: result.node,
      panels: this.layout.panels,
      headerPanels: this.getHeaderPanelIds(),
      headerPanelSizes: this.getHeaderPanelSizes(),
    };
    this.persistLayout();
    this.render();
    this.focusPanel(panelId);
  }

  private stopPanelReorder(): void {
    if (!this.reorderState) {
      return;
    }

    this.reorderState.cleanup();
    this.reorderState.overlay.remove();
    this.reorderState = null;
    document.body.classList.remove('panel-reordering');
  }

  private getSplitContainerForPanel(panelId: string): {
    container: HTMLElement;
    sourceIndex: number;
    direction: 'horizontal' | 'vertical';
  } | null {
    const frame = this.options.root.querySelector<HTMLElement>(
      `.panel-frame[data-panel-id="${panelId}"]`,
    );
    if (!frame) {
      return null;
    }
    const splitContainer = frame.closest<HTMLElement>('.panel-split');
    if (!splitContainer) {
      return null;
    }
    const children = this.getSplitChildren(splitContainer);
    if (children.length < 2) {
      return null;
    }
    const sourceIndex = children.findIndex((child) => child.contains(frame));
    if (sourceIndex < 0) {
      return null;
    }
    const direction = splitContainer.classList.contains('panel-split-vertical')
      ? 'vertical'
      : 'horizontal';
    return { container: splitContainer, sourceIndex, direction };
  }

  private getSplitChildren(container: HTMLElement): HTMLElement[] {
    return Array.from(container.children).filter((child) =>
      (child as HTMLElement).classList.contains('panel-split-child'),
    ) as HTMLElement[];
  }

  private resolveSplitChildIndex(
    children: HTMLElement[],
    x: number,
    y: number,
    direction: 'horizontal' | 'vertical',
  ): number {
    for (let index = 0; index < children.length; index += 1) {
      const rect = children[index]?.getBoundingClientRect();
      if (rect && pointInRect(x, y, rect)) {
        return index;
      }
    }

    const rect = children[0]?.getBoundingClientRect();
    const containerRect = children[0]?.parentElement?.getBoundingClientRect() ?? null;
    if (!rect || !containerRect) {
      return 0;
    }
    const midpoint =
      direction === 'horizontal'
        ? containerRect.left + containerRect.width / 2
        : containerRect.top + containerRect.height / 2;
    if (direction === 'horizontal') {
      return x < midpoint ? 0 : 1;
    }
    return y < midpoint ? 0 : 1;
  }
}

function createPanelId(panelType: string, existingIds: Set<string>): string {
  let index = 1;
  let candidate = `${panelType}-${index}`;
  while (existingIds.has(candidate)) {
    index += 1;
    candidate = `${panelType}-${index}`;
  }
  return candidate;
}

function applySplitSizes(
  first: HTMLElement,
  second: HTMLElement,
  firstSize: number,
  secondSize: number,
): void {
  first.style.flex = `${firstSize} 1 0%`;
  second.style.flex = `${secondSize} 1 0%`;
}

function mergeRects(first: DOMRect, second: DOMRect): DOMRect {
  const left = Math.min(first.left, second.left);
  const top = Math.min(first.top, second.top);
  const right = Math.max(first.right, second.right);
  const bottom = Math.max(first.bottom, second.bottom);
  return new DOMRect(left, top, right - left, bottom - top);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface PanelDragState {
  panelId: string;
  overlay: HTMLElement;
  highlight: HTMLElement;
  placement: PanelPlacement | null;
  targetPanelId: string | null;
  dropTarget: 'layout' | 'header' | null;
  cleanup: () => void;
}

type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

interface PanelReorderState {
  panelId: string;
  overlay: HTMLElement;
  highlight: HTMLElement;
  splitContainer: HTMLElement;
  direction: 'horizontal' | 'vertical';
  sourceIndex: number;
  targetIndex: number | null;
  cleanup: () => void;
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function getPanelFrameAtPoint(x: number, y: number): HTMLElement | null {
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!element) {
    return null;
  }
  return element.closest('.panel-frame');
}

function resolveDropRegion(x: number, y: number, rect: DOMRect): PanelPlacement['region'] {
  const edgeThreshold = 0.25;
  const leftEdge = rect.left + rect.width * edgeThreshold;
  const rightEdge = rect.right - rect.width * edgeThreshold;
  const topEdge = rect.top + rect.height * edgeThreshold;
  const bottomEdge = rect.bottom - rect.height * edgeThreshold;

  if (x <= leftEdge) {
    return 'left';
  }
  if (x >= rightEdge) {
    return 'right';
  }
  if (y <= topEdge) {
    return 'top';
  }
  if (y >= bottomEdge) {
    return 'bottom';
  }
  return 'center';
}

function computeHighlightRect(
  region: PanelPlacement['region'],
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
