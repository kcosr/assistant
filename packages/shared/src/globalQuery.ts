import type { AqlField, AqlQuery } from './aql';
import { evaluateAqlWithOptions } from './aql';

export type GlobalQuery =
  | {
      mode: 'raw';
      text: string;
      includeTags: string[];
      excludeTags: string[];
      partialTag?: string | null;
      partialTagIsExcluded?: boolean;
    }
  | {
      mode: 'aql';
      raw: string;
      parsed: AqlQuery;
    };

export const GLOBAL_QUERY_CONTEXT_KEY = 'global.query';

export type GlobalQueryTarget = {
  title?: string;
  notes?: string;
  url?: string;
  tags?: string[];
  favorite?: boolean;
  pinned?: boolean;
  instanceId?: string;
};

const normalizeTag = (tag: string): string => tag.trim().toLowerCase();

const normalizeText = (value: string | undefined): string =>
  typeof value === 'string' ? value.toLowerCase() : '';

const normalizeTags = (tags?: string[]): string[] =>
  Array.isArray(tags) ? tags.map(normalizeTag).filter(Boolean) : [];

export function isGlobalQuery(value: unknown): value is GlobalQuery {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const raw = value as {
    mode?: unknown;
    text?: unknown;
    includeTags?: unknown;
    excludeTags?: unknown;
    raw?: unknown;
    parsed?: unknown;
  };
  if (raw.mode === 'raw') {
    return (
      typeof raw.text === 'string' &&
      Array.isArray(raw.includeTags) &&
      Array.isArray(raw.excludeTags)
    );
  }
  if (raw.mode === 'aql') {
    return typeof raw.raw === 'string' && !!raw.parsed && typeof raw.parsed === 'object';
  }
  return false;
}

export function matchesGlobalQuery(target: GlobalQueryTarget, query: GlobalQuery | null): boolean {
  if (!query) {
    return true;
  }
  if (query.mode === 'raw') {
    return matchesGlobalRawQuery(target, query);
  }
  return matchesGlobalAqlQuery(target, query);
}

export function matchesGlobalRawQuery(
  target: GlobalQueryTarget,
  query: Extract<GlobalQuery, { mode: 'raw' }>,
): boolean {
  const tags = normalizeTags(target.tags);
  const includeTags = normalizeTags(query.includeTags);
  const excludeTags = normalizeTags(query.excludeTags);
  const partialTag = query.partialTag ? normalizeTag(query.partialTag) : '';
  const partialTagIsExcluded = query.partialTagIsExcluded === true;

  if (excludeTags.length > 0 && excludeTags.some((tag) => tags.includes(tag))) {
    return false;
  }

  if (includeTags.length > 0) {
    for (const tag of includeTags) {
      if (!tags.includes(tag)) {
        return false;
      }
    }
  }

  if (partialTag.length > 0) {
    const matchesPartial = tags.some((tag) => tag.startsWith(partialTag));
    if (partialTagIsExcluded) {
      // While typing !@..., keep filtering based on matching tags (consistent with in-panel search).
      if (!matchesPartial) {
        return false;
      }
    } else if (!matchesPartial) {
      return false;
    }
  }

  const text = normalizeText(query.text).trim();
  if (!text) {
    return true;
  }

  const parts: string[] = [];
  const title = normalizeText(target.title);
  if (title) parts.push(title);
  const notes = normalizeText(target.notes);
  if (notes) parts.push(notes);
  const url = normalizeText(target.url);
  if (url) parts.push(url);
  if (tags.length > 0) {
    parts.push(tags.join(' '));
  }

  return parts.join('\n').includes(text);
}

export function matchesGlobalAqlQuery(
  target: GlobalQueryTarget,
  query: Extract<GlobalQuery, { mode: 'aql' }>,
): boolean {
  const supportsFavorite = typeof target.favorite === 'boolean';
  const supportsPinned = typeof target.pinned === 'boolean';
  const supportsInstance = typeof target.instanceId === 'string' && target.instanceId.trim().length > 0;

  const isFieldSupported = (field: AqlField): boolean => {
    if (field.key === 'favorite') {
      return supportsFavorite;
    }
    if (field.key === 'pinned') {
      return supportsPinned;
    }
    if (field.key === 'instance') {
      return supportsInstance;
    }
    return true;
  };

  const item = {
    title: target.title ?? '',
    ...(typeof target.notes === 'string' ? { notes: target.notes } : {}),
    ...(typeof target.url === 'string' ? { url: target.url } : {}),
    ...(Array.isArray(target.tags) ? { tags: target.tags } : {}),
    ...(supportsFavorite ? { favorite: target.favorite } : {}),
    ...(supportsPinned ? { pinned: target.pinned } : {}),
    ...(supportsInstance ? { instanceId: target.instanceId } : {}),
  };

  return evaluateAqlWithOptions(
    query.parsed,
    item,
    { isFieldSupported },
  );
}
