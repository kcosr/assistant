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
}

type PanelInventoryGlobal = {
  snapshot: PanelInventorySnapshot | null;
};

const GLOBAL_KEY = '__ASSISTANT_PANEL_INVENTORY__';

function getGlobalStore(): PanelInventoryGlobal {
  const globalAny = globalThis as { [GLOBAL_KEY]?: PanelInventoryGlobal };
  if (!globalAny[GLOBAL_KEY]) {
    globalAny[GLOBAL_KEY] = { snapshot: null };
  }
  return globalAny[GLOBAL_KEY] as PanelInventoryGlobal;
}

export function updatePanelInventory(payload: PanelInventoryPayload): PanelInventorySnapshot {
  const snapshot: PanelInventorySnapshot = {
    panels: payload.panels.map((panel) => ({ ...panel })),
    selectedPanelId: payload.selectedPanelId ?? null,
    selectedChatPanelId: payload.selectedChatPanelId ?? null,
    layout: payload.layout ?? null,
    headerPanels: payload.headerPanels ? [...payload.headerPanels] : [],
    updatedAt: new Date().toISOString(),
  };
  getGlobalStore().snapshot = snapshot;
  return snapshot;
}

export function getPanelInventorySnapshot(): PanelInventorySnapshot | null {
  const { snapshot } = getGlobalStore();
  if (!snapshot) {
    return null;
  }
  return {
    panels: snapshot.panels.map((panel) => ({ ...panel })),
    selectedPanelId: snapshot.selectedPanelId,
    selectedChatPanelId: snapshot.selectedChatPanelId,
    layout: snapshot.layout,
    headerPanels: [...snapshot.headerPanels],
    updatedAt: snapshot.updatedAt,
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
  panels: PanelInventoryItem[];
  selectedPanelId: string | null;
  selectedChatPanelId: string | null;
  layout?: LayoutNode | null;
  headerPanels?: string[];
} {
  const snapshot = getPanelInventorySnapshot();
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
    panels: PanelInventoryItem[];
    selectedPanelId: string | null;
    selectedChatPanelId: string | null;
    layout?: LayoutNode | null;
    headerPanels?: string[];
  } = {
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
  selectedPanelId: string | null;
  selectedChatPanelId: string | null;
  panel: PanelInventoryItem | null;
  chatPanel: PanelInventoryItem | null;
  layout?: LayoutNode | null;
  headerPanels?: string[];
} {
  const snapshot = getPanelInventorySnapshot();
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
    selectedPanelId: string | null;
    selectedChatPanelId: string | null;
    panel: PanelInventoryItem | null;
    chatPanel: PanelInventoryItem | null;
    layout?: LayoutNode | null;
    headerPanels?: string[];
  } = {
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
  getGlobalStore().snapshot = null;
}
