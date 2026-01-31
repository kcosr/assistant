import type { GlobalTagScope } from './globalTagScope';

export function normalizeTagArray(tags: string[] | undefined): string[] {
  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

export function mergeTagArrays(primary: string[] | undefined, secondary: string[] | undefined): string[] {
  const combined = [...normalizeTagArray(primary), ...normalizeTagArray(secondary)];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of combined) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function matchesGlobalTagScope(
  tags: string[] | undefined,
  scope: GlobalTagScope | null | undefined,
): boolean {
  if (!scope) {
    return true;
  }
  const normalized = normalizeTagArray(tags);

  if (scope.include.length > 0) {
    if (!(normalized.length === 0 && scope.includeUntagged)) {
      for (const required of scope.include) {
        if (!normalized.includes(required)) {
          return false;
        }
      }
    }
  }

  if (scope.exclude.length > 0) {
    for (const excluded of scope.exclude) {
      if (normalized.includes(excluded)) {
        return false;
      }
    }
  }

  return true;
}
