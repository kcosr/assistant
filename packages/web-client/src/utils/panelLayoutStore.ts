import { LayoutPersistenceSchema, type LayoutPersistence } from '@assistant/shared';

const LAYOUT_STORAGE_KEY = 'aiAssistantPanelLayout';
const LAYOUT_VERSION_KEY = 'aiAssistantPanelLayoutVersion';
const CURRENT_LAYOUT_VERSION = 3;

export function loadPanelLayout(): LayoutPersistence | null {
  const version = getPanelLayoutVersion();
  if (version !== null && version !== CURRENT_LAYOUT_VERSION) {
    return null;
  }

  const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
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

export function savePanelLayout(layout: LayoutPersistence): void {
  window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  window.localStorage.setItem(LAYOUT_VERSION_KEY, String(CURRENT_LAYOUT_VERSION));
}

export function clearPanelLayout(): void {
  window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
  window.localStorage.removeItem(LAYOUT_VERSION_KEY);
}

export function getPanelLayoutVersion(): number | null {
  const raw = window.localStorage.getItem(LAYOUT_VERSION_KEY);
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
