export interface StoredGlobalQueryState {
  version: 1;
  mode: 'raw' | 'aql';
  rawText: string;
  rawIncludeTags: string[];
  rawExcludeTags: string[];
  aqlText: string;
  appliedAql: string | null;
  savedQueries: Array<{ id: string; name: string; query: string }>;
  selectedSavedQueryId: string | null;
}

const STORAGE_KEY = 'assistant:global-query';

const buildStorageKey = (windowId?: string): string => {
  const trimmed = typeof windowId === 'string' ? windowId.trim() : '';
  return trimmed ? `${STORAGE_KEY}:${trimmed}` : STORAGE_KEY;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter((entry) => entry.length > 0);
};

const normalizeSavedQueries = (
  value: unknown,
): Array<{ id: string; name: string; query: string }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: Array<{ id: string; name: string; query: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const raw = entry as { id?: unknown; name?: unknown; query?: unknown };
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    const query = typeof raw.query === 'string' ? raw.query.trim() : '';
    if (!id || !name || !query) {
      continue;
    }
    result.push({ id, name, query });
  }
  return result;
};

export function loadGlobalQueryState(
  windowId?: string,
  storage: Storage = window.localStorage,
): StoredGlobalQueryState | null {
  try {
    const raw = storage.getItem(buildStorageKey(windowId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredGlobalQueryState> | null;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    if (parsed.version !== 1) {
      return null;
    }
    const mode = parsed.mode === 'aql' ? 'aql' : 'raw';
    return {
      version: 1,
      mode,
      rawText: typeof parsed.rawText === 'string' ? parsed.rawText : '',
      rawIncludeTags: normalizeStringArray(parsed.rawIncludeTags),
      rawExcludeTags: normalizeStringArray(parsed.rawExcludeTags),
      aqlText: typeof parsed.aqlText === 'string' ? parsed.aqlText : '',
      appliedAql: typeof parsed.appliedAql === 'string' ? parsed.appliedAql : null,
      savedQueries: normalizeSavedQueries(parsed.savedQueries),
      selectedSavedQueryId:
        typeof parsed.selectedSavedQueryId === 'string' ? parsed.selectedSavedQueryId : null,
    };
  } catch {
    return null;
  }
}

export function saveGlobalQueryState(
  state: StoredGlobalQueryState,
  windowId?: string,
  storage: Storage = window.localStorage,
): void {
  try {
    storage.setItem(buildStorageKey(windowId), JSON.stringify(state));
  } catch {
    // Ignore storage errors.
  }
}
