import { LayoutPersistenceSchema, type LayoutPersistence } from '@assistant/shared';

const LAYOUT_STORAGE_KEY = 'aiAssistantPanelLayout';
const LAYOUT_VERSION_KEY = 'aiAssistantPanelLayoutVersion';
const CURRENT_LAYOUT_VERSION = 3;

function buildStorageKey(base: string, windowId?: string): string {
  const trimmed = typeof windowId === 'string' ? windowId.trim() : '';
  return trimmed ? `${base}:${trimmed}` : base;
}

export function loadPanelLayout(windowId?: string, storage: Storage = window.localStorage): LayoutPersistence | null {
  const version = getPanelLayoutVersion(windowId, storage);
  if (version !== null && version !== CURRENT_LAYOUT_VERSION) {
    return null;
  }

  const raw = storage.getItem(buildStorageKey(LAYOUT_STORAGE_KEY, windowId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = LayoutPersistenceSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    return result.data;
  } catch {
    return null;
  }
}

export function savePanelLayout(
  layout: LayoutPersistence,
  windowId?: string,
  storage: Storage = window.localStorage,
): void {
  storage.setItem(buildStorageKey(LAYOUT_STORAGE_KEY, windowId), JSON.stringify(layout));
  storage.setItem(
    buildStorageKey(LAYOUT_VERSION_KEY, windowId),
    String(CURRENT_LAYOUT_VERSION),
  );
}

export function clearPanelLayout(windowId?: string, storage: Storage = window.localStorage): void {
  storage.removeItem(buildStorageKey(LAYOUT_STORAGE_KEY, windowId));
  storage.removeItem(buildStorageKey(LAYOUT_VERSION_KEY, windowId));
}

export function getPanelLayoutVersion(
  windowId?: string,
  storage: Storage = window.localStorage,
): number | null {
  const raw = storage.getItem(buildStorageKey(LAYOUT_VERSION_KEY, windowId));
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function getCurrentLayoutVersion(): number {
  return CURRENT_LAYOUT_VERSION;
}
