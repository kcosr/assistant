export type TagMatchMode = 'all' | 'any';

export function normalizeTags(tags?: string[]): string[] {
  if (!tags) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawTag of tags) {
    const tag = rawTag.trim().toLowerCase();
    if (!tag || seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    normalized.push(tag);
  }

  return normalized;
}

export function matchesTags(options: {
  valueTags?: string[];
  filterTags?: string[];
  tagMatch?: TagMatchMode;
}): boolean {
  const { valueTags, filterTags, tagMatch } = options;

  const required = normalizeTags(filterTags);
  if (required.length === 0) {
    return true;
  }

  const actual = normalizeTags(valueTags);
  if (actual.length === 0) {
    return false;
  }

  if (tagMatch === 'any') {
    return required.some((tag) => actual.includes(tag));
  }

  return required.every((tag) => actual.includes(tag));
}

export function hasAllTags(valueTags?: string[], filterTags?: string[]): boolean {
  return matchesTags({
    ...(valueTags ? { valueTags } : {}),
    ...(filterTags ? { filterTags } : {}),
    tagMatch: 'all',
  });
}
