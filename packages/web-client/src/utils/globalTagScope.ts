export type GlobalTagScope = {
  include: string[];
  exclude: string[];
  includeListsWithMatchingItems: boolean;
  includeUntagged: boolean;
};

const STORAGE_KEY = 'assistant:global-tag-scope';

export function buildGlobalTagScopeStorageKey(windowId?: string): string {
  const normalized = typeof windowId === 'string' ? windowId.trim() : '';
  return normalized ? `${STORAGE_KEY}:${normalized}` : STORAGE_KEY;
}

function normalizeTagList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }
    const trimmed = entry.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function normalizeGlobalTagScope(value: unknown): GlobalTagScope {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const include = normalizeTagList(raw['include']);
  const exclude = normalizeTagList(raw['exclude']);
  const includeListsWithMatchingItems = raw['includeListsWithMatchingItems'] === true;
  const includeUntagged = raw['includeUntagged'] === true;

  if (exclude.length > 0 && include.length > 0) {
    const includeSet = new Set(include);
    const filteredExclude = exclude.filter((tag) => !includeSet.has(tag));
    return { include, exclude: filteredExclude, includeListsWithMatchingItems, includeUntagged };
  }

  return { include, exclude, includeListsWithMatchingItems, includeUntagged };
}

export function loadGlobalTagScope(
  windowId: string,
  storage: Storage = window.localStorage,
): GlobalTagScope {
  try {
    const raw = storage.getItem(buildGlobalTagScopeStorageKey(windowId));
    if (!raw) {
      return normalizeGlobalTagScope(null);
    }
    return normalizeGlobalTagScope(JSON.parse(raw));
  } catch {
    return normalizeGlobalTagScope(null);
  }
}

export function saveGlobalTagScope(
  windowId: string,
  scope: GlobalTagScope,
  storage: Storage = window.localStorage,
): void {
  try {
    const normalized = normalizeGlobalTagScope(scope);
    storage.setItem(buildGlobalTagScopeStorageKey(windowId), JSON.stringify(normalized));
  } catch {
    // Ignore storage errors.
  }
}

export function isGlobalTagScopeActive(scope: GlobalTagScope): boolean {
  return scope.include.length > 0 || scope.exclude.length > 0;
}
