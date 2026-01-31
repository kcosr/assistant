import type { LayoutNode, PanelInventoryItem, PanelInventoryPayload } from '@assistant/shared';

export interface PanelInventorySnapshot {
  panels: PanelInventoryItem[];
  selectedPanelId: string | null;
  selectedChatPanelId: string | null;
  layout: LayoutNode | null;
  headerPanels: string[];
  updatedAt: string;
}

export interface PanelInventoryOptions {
  includeChat?: boolean;
  includeContext?: boolean;
  includeLayout?: boolean;
  windowId?: string;
}

type PanelInventoryGlobal = {
  entries: Map<string, WindowInventoryEntry>;
};

const GLOBAL_KEY = '__ASSISTANT_PANEL_INVENTORY__';

function getGlobalStore(): PanelInventoryGlobal {
  const globalAny = globalThis as { [GLOBAL_KEY]?: PanelInventoryGlobal };
  if (!globalAny[GLOBAL_KEY]) {
    globalAny[GLOBAL_KEY] = { entries: new Map<string, WindowInventoryEntry>() };
  }
  return globalAny[GLOBAL_KEY] as PanelInventoryGlobal;
}

export interface PanelWindowInfo {
  windowId: string;
  updatedAt: string;
}

interface WindowInventoryEntry {
  windowId: string;
  connectionId: string;
  snapshot: PanelInventorySnapshot;
}

export class PanelInventoryWindowError extends Error {
  code: 'window_required' | 'window_not_found';
  windows: PanelWindowInfo[];

  constructor(
    code: 'window_required' | 'window_not_found',
    message: string,
    windows: PanelWindowInfo[],
  ) {
    super(message);
    this.code = code;
    this.windows = windows;
  }
}

function normalizeWindowId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function updatePanelInventory(
  payload: PanelInventoryPayload,
  options?: { windowId?: string; connectionId?: string },
): PanelInventorySnapshot {
  const normalizedConnectionId = normalizeWindowId(options?.connectionId) ?? 'unknown';
  const windowId =
    normalizeWindowId(payload.windowId) ??
    normalizeWindowId(options?.windowId) ??
    (normalizedConnectionId !== 'unknown' ? normalizedConnectionId : 'unknown');
  const snapshot: PanelInventorySnapshot = {
    panels: payload.panels.map((panel) => ({ ...panel })),
    selectedPanelId: payload.selectedPanelId ?? null,
    selectedChatPanelId: payload.selectedChatPanelId ?? null,
    layout: payload.layout ?? null,
    headerPanels: payload.headerPanels ? [...payload.headerPanels] : [],
    updatedAt: new Date().toISOString(),
  };
  getGlobalStore().entries.set(windowId, {
    windowId,
    connectionId: normalizedConnectionId,
    snapshot,
  });
  return snapshot;
}

export function removePanelInventoryForConnection(connectionId: string): void {
  const normalized = normalizeWindowId(connectionId);
  if (!normalized) {
    return;
  }
  const store = getGlobalStore();
  for (const [windowId, entry] of store.entries.entries()) {
    if (entry.connectionId === normalized) {
      store.entries.delete(windowId);
    }
  }
}

export function listPanelWindows(): PanelWindowInfo[] {
  const store = getGlobalStore();
  return Array.from(store.entries.values()).map((entry) => ({
    windowId: entry.windowId,
    updatedAt: entry.snapshot.updatedAt,
  }));
}

function resolvePanelInventoryEntry(windowId?: string): {
  entry: WindowInventoryEntry | null;
  windows: PanelWindowInfo[];
  status: 'resolved' | 'missing' | 'ambiguous' | 'not_found';
} {
  const store = getGlobalStore();
  const windows = listPanelWindows();
  if (windowId) {
    const entry = store.entries.get(windowId) ?? null;
    if (!entry) {
      return { entry: null, windows, status: 'not_found' };
    }
    return { entry, windows, status: 'resolved' };
  }

  if (store.entries.size === 0) {
    return { entry: null, windows, status: 'missing' };
  }

  if (store.entries.size === 1) {
    const entry = Array.from(store.entries.values())[0] ?? null;
    if (!entry) {
      return { entry: null, windows, status: 'missing' };
    }
    return { entry, windows, status: 'resolved' };
  }

  return { entry: null, windows, status: 'ambiguous' };
}

export function resolvePanelWindowTarget(windowId?: string): {
  status: 'resolved' | 'missing' | 'ambiguous' | 'not_found';
  windowId?: string;
  connectionId?: string;
  windows: PanelWindowInfo[];
} {
  const resolved = resolvePanelInventoryEntry(windowId);
  if (resolved.status !== 'resolved' || !resolved.entry) {
    return {
      status: resolved.status,
      windows: resolved.windows,
    };
  }
  return {
    status: 'resolved',
    windowId: resolved.entry.windowId,
    connectionId: resolved.entry.connectionId,
    windows: resolved.windows,
  };
}

function getPanelInventorySnapshot(
  windowId?: string,
): { snapshot: PanelInventorySnapshot | null; windowId?: string } {
  const resolved = resolvePanelInventoryEntry(windowId);
  if (resolved.status === 'missing') {
    return { snapshot: null };
  }
  if (resolved.status === 'ambiguous') {
    throw new PanelInventoryWindowError(
      'window_required',
      'Multiple windows are active; specify windowId to choose one.',
      resolved.windows,
    );
  }
  if (resolved.status === 'not_found') {
    throw new PanelInventoryWindowError(
      'window_not_found',
      'Requested windowId is not active.',
      resolved.windows,
    );
  }
  const snapshot = resolved.entry?.snapshot ?? null;
  if (!snapshot) {
    return { snapshot: null };
  }
  return {
    snapshot: {
      panels: snapshot.panels.map((panel) => ({ ...panel })),
      selectedPanelId: snapshot.selectedPanelId,
      selectedChatPanelId: snapshot.selectedChatPanelId,
      layout: snapshot.layout,
      headerPanels: [...snapshot.headerPanels],
      updatedAt: snapshot.updatedAt,
    },
    windowId: resolved.entry?.windowId,
  };
}

function stripPanelContext<T extends { context?: unknown }>(panel: T, includeContext: boolean): T {
  if (includeContext) {
    return panel;
  }
  const { context: _context, ...rest } = panel;
  return rest as T;
}

export function listPanels(options: PanelInventoryOptions = {}): {
  windowId?: string;
  panels: PanelInventoryItem[];
  selectedPanelId: string | null;
  selectedChatPanelId: string | null;
  layout?: LayoutNode | null;
  headerPanels?: string[];
} {
  const { snapshot, windowId } = getPanelInventorySnapshot(options.windowId);
  const includeChat = options.includeChat ?? false;
  const includeContext = options.includeContext ?? false;
  const includeLayout = options.includeLayout ?? false;

  if (!snapshot) {
    return { panels: [], selectedPanelId: null, selectedChatPanelId: null };
  }

  const panels = snapshot.panels
    .filter((panel) => includeChat || panel.panelType !== 'chat')
    .map((panel) => stripPanelContext(panel, includeContext));

  const result: {
    windowId?: string;
    panels: PanelInventoryItem[];
    selectedPanelId: string | null;
    selectedChatPanelId: string | null;
    layout?: LayoutNode | null;
    headerPanels?: string[];
  } = {
    ...(windowId ? { windowId } : {}),
    panels,
    selectedPanelId: snapshot.selectedPanelId,
    selectedChatPanelId: snapshot.selectedChatPanelId,
  };
  if (includeLayout) {
    result.layout = snapshot.layout;
    result.headerPanels = [...snapshot.headerPanels];
  }
  return result;
}

export function getSelectedPanels(options: PanelInventoryOptions = {}): {
  windowId?: string;
  selectedPanelId: string | null;
  selectedChatPanelId: string | null;
  panel: PanelInventoryItem | null;
  chatPanel: PanelInventoryItem | null;
  layout?: LayoutNode | null;
  headerPanels?: string[];
} {
  const { snapshot, windowId } = getPanelInventorySnapshot(options.windowId);
  const includeChat = options.includeChat ?? false;
  const includeContext = options.includeContext ?? false;
  const includeLayout = options.includeLayout ?? false;

  if (!snapshot) {
    return {
      selectedPanelId: null,
      selectedChatPanelId: null,
      panel: null,
      chatPanel: null,
    };
  }

  const panel =
    snapshot.selectedPanelId != null
      ? (snapshot.panels.find((entry) => entry.panelId === snapshot.selectedPanelId) ?? null)
      : null;
  const chatPanel =
    includeChat && snapshot.selectedChatPanelId != null
      ? (snapshot.panels.find((entry) => entry.panelId === snapshot.selectedChatPanelId) ?? null)
      : null;

  const result: {
    windowId?: string;
    selectedPanelId: string | null;
    selectedChatPanelId: string | null;
    panel: PanelInventoryItem | null;
    chatPanel: PanelInventoryItem | null;
    layout?: LayoutNode | null;
    headerPanels?: string[];
  } = {
    ...(windowId ? { windowId } : {}),
    selectedPanelId: snapshot.selectedPanelId,
    selectedChatPanelId: snapshot.selectedChatPanelId,
    panel: panel ? stripPanelContext(panel, includeContext) : null,
    chatPanel: chatPanel ? stripPanelContext(chatPanel, includeContext) : null,
  };
  if (includeLayout) {
    result.layout = snapshot.layout;
    result.headerPanels = [...snapshot.headerPanels];
  }
  return result;
}

export function resetPanelInventoryForTests(): void {
  getGlobalStore().entries.clear();
}
