import type {
  PanelBinding,
  PanelEventEnvelope,
  PanelMetadata,
  PanelPlacement,
  PanelTypeManifest,
  SessionAttributes,
  SessionAttributesPatch,
  SessionContext,
} from '@assistant/shared';
import type {
  PanelHandle,
  PanelHost,
  PanelInitOptions,
  PanelModule,
  PanelOpenOptions,
} from './panelRegistry';
import { PanelRegistry } from './panelRegistry';
import { createPlaceholderPanel } from '../panels/placeholderPanel';
import { resolvePanelAvailability } from '../utils/panelAvailability';

export interface PanelWorkspaceHandle {
  openPanel(panelType: string, options?: PanelOpenOptions): string | null;
  closePanel(panelId: string): void;
  activatePanel(panelId: string): void;
  movePanel(panelId: string, placement: PanelPlacement, targetPanelId?: string): void;
  openPanelMenu?(panelId: string, anchor: HTMLElement): void;
  startPanelDrag?(panelId: string, event: PointerEvent): void;
  startPanelReorder?(panelId: string, event: PointerEvent): void;
  openPanelLauncher?(options?: {
    targetPanelId?: string | null;
    defaultPlacement?: PanelPlacement | null;
    pinToHeader?: boolean;
    replacePanelId?: string | null;
  }): void;
  toggleSplitViewMode?(splitId: string): void;
  closeSplit?(splitId: string): void;
}

interface PanelHostControllerOptions {
  registry: PanelRegistry;
  getAvailableCapabilities?: () => Set<string> | null;
  getAvailablePanelTypes?: () => Set<string> | null;
  onPanelBindingChange?: (panelId: string, binding: PanelBinding | null) => void;
  onPanelMetadataChange?: (panelId: string, metadata: PanelMetadata) => void;
  onPanelStateChange?: (panelId: string, state: unknown) => void;
  getPanelState?: (panelId: string) => unknown | null;
  sendPanelEvent?: (event: PanelEventEnvelope) => void;
  updateSessionAttributes?: (sessionId: string, patch: SessionAttributesPatch) => Promise<void>;
}

interface PanelMountOptions {
  panelId: string;
  panelType: string;
  container: HTMLElement;
  binding?: PanelBinding;
  state?: unknown;
  focus?: boolean;
}

interface PanelEntry {
  panelId: string;
  panelType: string;
  container: HTMLElement;
  handle: PanelHandle;
  binding: PanelBinding | null;
  metadata: PanelMetadata;
  bindingListeners: Set<(binding: PanelBinding | null) => void>;
  sessionContextListeners: Set<(context: SessionContext | null) => void>;
  lastSessionId: string | null;
}

const EMPTY_HANDLE: PanelHandle = { unmount: () => undefined };
const SESSION_BOUND_PANEL_TYPES = new Set(['chat', 'session-info', 'terminal']);
const PANEL_EVENT_DEBUG_KEYS = ['aiAssistantPanelEventDebug', 'aiAssistantWsDebug'];

const isDiffDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const stored = window.localStorage?.getItem('diff.debug');
    return stored === '1' || stored === 'true';
  } catch {
    return false;
  }
};

const diffDebugLog = (...args: unknown[]) => {
  if (isDiffDebugEnabled()) {
    console.log('[diff]', ...args);
  }
};

const diffDebugWarn = (...args: unknown[]) => {
  if (isDiffDebugEnabled()) {
    console.warn('[diff]', ...args);
  }
};

const isPanelEventDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    for (const key of PANEL_EVENT_DEBUG_KEYS) {
      const stored = window.localStorage?.getItem(key);
      if (stored === '1' || stored === 'true') {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
};

function isSessionBoundPanelType(panelType: string): boolean {
  return SESSION_BOUND_PANEL_TYPES.has(panelType);
}

export class PanelHostController {
  private readonly entries = new Map<string, PanelEntry>();
  private workspace: PanelWorkspaceHandle | null = null;
  private readonly contextValues = new Map<string, unknown>();
  private readonly contextListeners = new Map<string, Set<(value: unknown) => void>>();

  constructor(private readonly options: PanelHostControllerOptions) {}

  setPanelWorkspace(workspace: PanelWorkspaceHandle | null): void {
    this.workspace = workspace;
  }

  mountPanel(options: PanelMountOptions): void {
    if (this.entries.has(options.panelId)) {
      throw new Error(`Panel already mounted: ${options.panelId}`);
    }

    const manifest = this.options.registry.getManifest(options.panelType);
    const panelTitle = manifest?.title ?? options.panelType;
    const placeholderManifest: PanelTypeManifest = manifest ?? {
      type: options.panelType,
      title: panelTitle,
    };
    const binding = isSessionBoundPanelType(options.panelType)
      ? (options.binding ?? resolveDefaultBinding(manifest))
      : null;
    const bindingListeners = new Set<(binding: PanelBinding | null) => void>();
    const sessionContextListeners = new Set<(context: SessionContext | null) => void>();

    const entry: PanelEntry = {
      panelId: options.panelId,
      panelType: options.panelType,
      container: options.container,
      handle: EMPTY_HANDLE,
      binding,
      metadata: {},
      bindingListeners,
      sessionContextListeners,
      lastSessionId: null,
    };

    const host = this.createHost(entry);
    const init: PanelInitOptions = {
      ...(binding ? { binding } : {}),
      ...(options.state !== undefined ? { state: options.state } : {}),
      ...(typeof options.focus === 'boolean' ? { focus: options.focus } : {}),
    };

    const availability = resolvePanelAvailability(options.panelType, manifest, {
      allowedPanelTypes: this.options.getAvailablePanelTypes?.() ?? null,
      availableCapabilities: this.options.getAvailableCapabilities?.() ?? null,
    });
    let module: PanelModule;
    if (availability.state === 'unavailable') {
      const detailsParts = [availability.reason];
      if (availability.missingCapabilities && availability.missingCapabilities.length > 0) {
        detailsParts.push(`Missing capabilities: ${availability.missingCapabilities.join(', ')}`);
      }
      module = createPlaceholderPanel(placeholderManifest, {
        message: `Panel "${panelTitle}" is unavailable.`,
        details: detailsParts.join(' '),
      })();
    } else {
      try {
        module = this.options.registry.createModule(options.panelType);
      } catch (err) {
        console.error('Failed to create panel module', options.panelType, err);
        const details = err instanceof Error ? err.message : undefined;
        const message =
          availability.state === 'loading'
            ? `Loading "${panelTitle}" panel...`
            : `Panel "${panelTitle}" failed to load.`;
        module = createPlaceholderPanel(
          placeholderManifest,
          details ? { message, details } : { message },
        )();
      }
    }
    const handle = module.mount(options.container, host, init);
    entry.handle = handle;

    this.entries.set(options.panelId, entry);
    this.emitPanelEvent(entry, {
      type: 'panel_lifecycle',
      state: 'opened',
      binding,
    });
    this.applySessionBinding(entry);
  }

  unmountPanel(panelId: string): void {
    const entry = this.entries.get(panelId);
    if (!entry) {
      return;
    }
    this.emitPanelEvent(entry, {
      type: 'panel_lifecycle',
      state: 'closed',
      binding: entry.binding,
    });
    entry.handle.unmount();
    this.entries.delete(panelId);
  }

  getPanelBinding(panelId: string): PanelBinding | null {
    const entry = this.entries.get(panelId);
    if (!entry || !isSessionBoundPanelType(entry.panelType)) {
      return null;
    }
    return entry.binding ?? null;
  }

  setPanelBinding(panelId: string, binding: PanelBinding | null): void {
    const entry = this.entries.get(panelId);
    if (!entry) {
      return;
    }
    if (!isSessionBoundPanelType(entry.panelType)) {
      if (entry.binding) {
        entry.binding = null;
        this.options.onPanelBindingChange?.(panelId, null);
        for (const listener of entry.bindingListeners) {
          listener(null);
        }
        this.emitPanelEvent(entry, {
          type: 'panel_binding',
          binding: null,
        });
        this.applySessionBinding(entry);
      }
      return;
    }
    entry.binding = binding;
    this.options.onPanelBindingChange?.(panelId, binding);
    for (const listener of entry.bindingListeners) {
      listener(binding);
    }
    this.emitPanelEvent(entry, {
      type: 'panel_binding',
      binding,
    });
    this.applySessionBinding(entry);
  }

  setPanelMetadata(panelId: string, meta: Partial<PanelMetadata>): void {
    const entry = this.entries.get(panelId);
    if (!entry) {
      return;
    }
    entry.metadata = { ...entry.metadata, ...meta };
    this.options.onPanelMetadataChange?.(panelId, entry.metadata);
  }

  setContext(key: string, value: unknown): void {
    this.contextValues.set(key, value);
    const listeners = this.contextListeners.get(key);
    if (listeners) {
      for (const listener of listeners) {
        listener(value);
      }
    }
    if (key.startsWith('session.')) {
      this.notifyAllSessionContexts();
    }
  }

  getContext(key: string): unknown | null {
    return this.contextValues.get(key) ?? null;
  }

  subscribeContext(key: string, handler: (value: unknown) => void): () => void {
    let listeners = this.contextListeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.contextListeners.set(key, listeners);
    }
    listeners.add(handler);
    if (this.contextValues.has(key)) {
      handler(this.contextValues.get(key));
    }
    return () => {
      listeners?.delete(handler);
    };
  }

  setPanelVisibility(panelId: string, visible: boolean): void {
    const entry = this.entries.get(panelId);
    entry?.handle.onVisibilityChange?.(visible);
  }

  setPanelFocus(panelId: string, focused: boolean): void {
    const entry = this.entries.get(panelId);
    if (!entry) {
      return;
    }
    if (focused) {
      entry.handle.onFocus?.();
    } else {
      entry.handle.onBlur?.();
    }
  }

  setPanelSize(panelId: string, size: { width: number; height: number }): void {
    const entry = this.entries.get(panelId);
    entry?.handle.onResize?.(size);
  }

  sendPanelEvent(event: PanelEventEnvelope): void {
    this.options.sendPanelEvent?.(event);
  }

  dispatchPanelEvent(event: PanelEventEnvelope): void {
    const panelEventDebugEnabled = isPanelEventDebugEnabled();
    const payload = event.payload as { type?: unknown; action?: unknown } | null;
    const payloadType = typeof payload?.type === 'string' ? payload.type : null;
    if (panelEventDebugEnabled) {
      console.log('[panel-event] received', {
        panelId: event.panelId,
        panelType: event.panelType,
        sessionId: event.sessionId ?? null,
        payloadType,
      });
    }
    if (event.panelType === 'diff' && isDiffDebugEnabled()) {
      diffDebugLog('panel_event_received', {
        panelId: event.panelId,
        panelType: event.panelType,
        sessionId: event.sessionId ?? null,
        payloadType,
        action: payload?.action,
      });
    }
    if (event.panelId === '*') {
      const rawSessionId = typeof event.sessionId === 'string' ? event.sessionId.trim() : '';
      const sessionId = rawSessionId || null;
      let targets = Array.from(this.entries.values()).filter(
        (entry) => entry.panelType === event.panelType,
      );
      if (sessionId) {
        if (sessionId !== '*') {
          targets = targets.filter((entry) => resolveBindingTarget(entry.binding) === sessionId);
        }
      } else {
        targets = targets.filter((entry) => resolveBindingTarget(entry.binding) === null);
      }
      if (panelEventDebugEnabled) {
        console.log('[panel-event] broadcast', {
          panelType: event.panelType,
          sessionId,
          payloadType,
          targetCount: targets.length,
        });
      }
      for (const target of targets) {
        target.handle.onEvent?.(event);
      }
      return;
    }
    const entry = this.entries.get(event.panelId);
    if (!entry || entry.panelType !== event.panelType) {
      if (panelEventDebugEnabled) {
        const availablePanels = Array.from(this.entries.values())
          .filter((candidate) => candidate.panelType === event.panelType)
          .map((candidate) => candidate.panelId);
        console.warn('[panel-event] dropped', {
          panelId: event.panelId,
          panelType: event.panelType,
          payloadType,
          availablePanels,
        });
      }
      if (event.panelType === 'diff' && isDiffDebugEnabled()) {
        const availablePanels = Array.from(this.entries.values())
          .filter((candidate) => candidate.panelType === 'diff')
          .map((candidate) => candidate.panelId);
        diffDebugWarn('panel_event dropped', {
          panelId: event.panelId,
          panelType: event.panelType,
          availablePanels,
        });
      }
      return;
    }
    entry.handle.onEvent?.(event);
  }

  private createHost(entry: PanelEntry): PanelHost {
    return {
      panelId: () => entry.panelId,
      getBinding: () => (isSessionBoundPanelType(entry.panelType) ? entry.binding : null),
      setBinding: (binding) => {
        const nextBinding = isSessionBoundPanelType(entry.panelType) ? binding : null;
        entry.binding = nextBinding;
        this.options.onPanelBindingChange?.(entry.panelId, nextBinding);
        for (const listener of entry.bindingListeners) {
          listener(nextBinding);
        }
        this.applySessionBinding(entry);
      },
      onBindingChange: (handler) => {
        entry.bindingListeners.add(handler);
        return () => {
          entry.bindingListeners.delete(handler);
        };
      },
      setContext: (key, value) => {
        this.contextValues.set(key, value);
        const listeners = this.contextListeners.get(key);
        if (listeners) {
          for (const listener of listeners) {
            listener(value);
          }
        }
      },
      getContext: (key) => this.contextValues.get(key) ?? null,
      subscribeContext: (key, handler) => {
        let listeners = this.contextListeners.get(key);
        if (!listeners) {
          listeners = new Set();
          this.contextListeners.set(key, listeners);
        }
        listeners.add(handler);
        if (this.contextValues.has(key)) {
          handler(this.contextValues.get(key));
        }
        return () => {
          listeners?.delete(handler);
        };
      },
      sendEvent: (payload, options) => {
        const hasExplicitSession = !!options && 'sessionId' in options;
        const rawSessionId = typeof options?.sessionId === 'string' ? options.sessionId.trim() : '';
        const resolvedSessionId = hasExplicitSession
          ? rawSessionId || null
          : resolveBindingTarget(entry.binding);
        const event: PanelEventEnvelope = {
          type: 'panel_event',
          panelId: entry.panelId,
          panelType: entry.panelType,
          payload,
          ...(resolvedSessionId ? { sessionId: resolvedSessionId } : {}),
        };
        this.options.sendPanelEvent?.(event);
      },
      getSessionContext: () => this.buildSessionContext(entry),
      subscribeSessionContext: (handler) => {
        entry.sessionContextListeners.add(handler);
        return () => {
          entry.sessionContextListeners.delete(handler);
        };
      },
      updateSessionAttributes: async (patch) => {
        if (!this.options.updateSessionAttributes) {
          throw new Error('Session attributes are not supported');
        }
        const sessionId = resolveBindingTarget(entry.binding);
        if (!sessionId) {
          throw new Error('Panel is not bound to a session');
        }
        await this.options.updateSessionAttributes(sessionId, patch);
      },
      setPanelMetadata: (meta) => {
        entry.metadata = { ...entry.metadata, ...meta };
        this.options.onPanelMetadataChange?.(entry.panelId, entry.metadata);
      },
      persistPanelState: (state) => {
        this.options.onPanelStateChange?.(entry.panelId, state);
      },
      loadPanelState: () => this.options.getPanelState?.(entry.panelId) ?? null,
      openPanel: (panelType, options) => this.workspace?.openPanel(panelType, options) ?? null,
      closePanel: (panelId) => {
        this.workspace?.closePanel(panelId);
      },
      activatePanel: (panelId) => {
        this.workspace?.activatePanel(panelId);
      },
      movePanel: (panelId, placement, targetPanelId) => {
        this.workspace?.movePanel(panelId, placement, targetPanelId);
      },
      openPanelMenu: (panelId, anchor) => {
        this.workspace?.openPanelMenu?.(panelId, anchor);
      },
      startPanelDrag: (panelId, event) => {
        this.workspace?.startPanelDrag?.(panelId, event);
      },
      startPanelReorder: (panelId, event) => {
        this.workspace?.startPanelReorder?.(panelId, event);
      },
      openPanelLauncher: (options) => {
        this.workspace?.openPanelLauncher?.(options);
      },
      toggleSplitViewMode: (splitId) => {
        this.workspace?.toggleSplitViewMode?.(splitId);
      },
      closeSplit: (splitId) => {
        this.workspace?.closeSplit?.(splitId);
      },
    };
  }

  private applySessionBinding(entry: PanelEntry): void {
    const sessionId = resolveBindingTarget(entry.binding);
    if (sessionId === entry.lastSessionId) {
      return;
    }
    const previousSessionId = entry.lastSessionId;
    entry.lastSessionId = sessionId;
    entry.handle.onSessionChange?.(sessionId);
    this.emitPanelEvent(entry, {
      type: 'panel_session_changed',
      previousSessionId,
      sessionId,
    });
    this.notifySessionContext(entry);
  }

  private buildSessionContext(entry: PanelEntry): SessionContext | null {
    const sessionId = resolveBindingTarget(entry.binding);
    if (!sessionId) {
      return null;
    }
    const summaries = this.getSessionSummaries();
    const summary = summaries?.find((candidate) => candidate.sessionId === sessionId) ?? null;
    return {
      sessionId,
      attributes: normalizeSessionAttributes(summary?.attributes),
    };
  }

  private getSessionSummaries(): Array<{
    sessionId: string;
    attributes?: SessionAttributes;
  }> | null {
    const raw = this.contextValues.get('session.summaries');
    if (!Array.isArray(raw)) {
      return null;
    }
    return raw as Array<{ sessionId: string; attributes?: SessionAttributes }>;
  }

  private notifySessionContext(entry: PanelEntry): void {
    if (entry.sessionContextListeners.size === 0) {
      return;
    }
    const context = this.buildSessionContext(entry);
    for (const listener of entry.sessionContextListeners) {
      listener(context);
    }
  }

  private notifyAllSessionContexts(): void {
    for (const entry of this.entries.values()) {
      this.notifySessionContext(entry);
    }
  }

  private emitPanelEvent(entry: PanelEntry, payload: PanelHostInternalPayload): void {
    if (!this.options.sendPanelEvent) {
      return;
    }
    const sessionId = resolveBindingTarget(entry.binding);
    const event: PanelEventEnvelope = {
      type: 'panel_event',
      panelId: entry.panelId,
      panelType: entry.panelType,
      payload,
      ...(sessionId ? { sessionId } : {}),
    };
    this.options.sendPanelEvent(event);
  }
}

type PanelLifecyclePayload = {
  type: 'panel_lifecycle';
  state: 'opened' | 'closed';
  binding: PanelBinding | null;
};

type PanelBindingPayload = {
  type: 'panel_binding';
  binding: PanelBinding | null;
};

type PanelSessionChangedPayload = {
  type: 'panel_session_changed';
  previousSessionId: string | null;
  sessionId: string | null;
};

type PanelHostInternalPayload =
  | PanelLifecyclePayload
  | PanelBindingPayload
  | PanelSessionChangedPayload;

function resolveDefaultBinding(manifest: PanelTypeManifest | null): PanelBinding | null {
  if (!manifest || !isSessionBoundPanelType(manifest.type)) {
    return null;
  }
  const mode = manifest?.defaultSessionBinding ?? 'fixed';
  const scope =
    manifest?.sessionScope ??
    (manifest?.defaultSessionBinding === 'global' ? 'global' : 'optional');
  if (scope === 'global' || mode === 'global') {
    return { mode: 'global' };
  }
  return null;
}

function resolveBindingTarget(binding: PanelBinding | null): string | null {
  if (!binding || binding.mode === 'global') {
    return null;
  }
  return binding.sessionId;
}

function normalizeSessionAttributes(value: unknown): SessionAttributes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as SessionAttributes;
}
