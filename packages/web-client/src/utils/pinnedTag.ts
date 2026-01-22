export const PINNED_TAG = 'pinned';

export const isPinnedTag = (raw: string): boolean =>
  raw.trim().toLowerCase() === PINNED_TAG;

export const hasPinnedTag = (tags?: string[]): boolean =>
  Array.isArray(tags) && tags.some((tag) => isPinnedTag(tag));

export const withoutPinnedTag = (tags?: string[]): string[] =>
  Array.isArray(tags) ? tags.filter((tag) => !isPinnedTag(tag)) : [];

export const applyPinnedTag = (tags: string[] | undefined, pinned: boolean): string[] => {
  const cleaned = withoutPinnedTag(tags);
  return pinned ? [...cleaned, PINNED_TAG] : cleaned;
};
