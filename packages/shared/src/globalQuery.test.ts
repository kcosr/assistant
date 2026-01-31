import { describe, expect, it } from 'vitest';

import type { AqlBuiltinField } from './aql';
import { DEFAULT_AQL_BUILTIN_FIELDS, parseAql } from './aql';
import type { GlobalQuery } from './globalQuery';
import { matchesGlobalQuery } from './globalQuery';

const GLOBAL_BUILTINS: AqlBuiltinField[] = [
  ...DEFAULT_AQL_BUILTIN_FIELDS,
  {
    name: 'favorite',
    key: 'favorite',
    label: 'Favorite',
    type: 'boolean',
    kind: 'builtin',
    displayable: false,
  },
  {
    name: 'pinned',
    key: 'pinned',
    label: 'Pinned',
    type: 'boolean',
    kind: 'builtin',
    displayable: false,
  },
  {
    name: 'instance',
    key: 'instance',
    label: 'Instance',
    type: 'ref',
    kind: 'builtin',
    displayable: false,
  },
];

describe('globalQuery', () => {
  it('matches raw queries against text and tags', () => {
    const query: GlobalQuery = {
      mode: 'raw',
      text: 'launch',
      includeTags: ['urgent'],
      excludeTags: ['blocked'],
      partialTag: null,
      partialTagIsExcluded: false,
    };

    expect(
      matchesGlobalQuery(
        { title: 'Launch plan', tags: ['urgent', 'team'] },
        query,
      ),
    ).toBe(true);

    expect(
      matchesGlobalQuery(
        { title: 'Launch plan', tags: ['urgent', 'blocked'] },
        query,
      ),
    ).toBe(false);
  });

  it('applies partial tag filters while typing exclude tags', () => {
    const query: GlobalQuery = {
      mode: 'raw',
      text: '',
      includeTags: [],
      excludeTags: [],
      partialTag: 'pin',
      partialTagIsExcluded: true,
    };

    expect(matchesGlobalQuery({ title: 'Item', tags: ['pinned'] }, query)).toBe(true);
    expect(matchesGlobalQuery({ title: 'Item', tags: ['other'] }, query)).toBe(false);
  });

  it('treats unsupported AQL fields as non-matching clauses', () => {
    const parsed = parseAql('favorite = true', {
      customFields: [],
      builtinFields: GLOBAL_BUILTINS,
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const query: GlobalQuery = { mode: 'aql', raw: 'favorite = true', parsed: parsed.query };

    expect(matchesGlobalQuery({ title: 'Item', tags: [] }, query)).toBe(false);
    expect(matchesGlobalQuery({ title: 'Item', favorite: true }, query)).toBe(true);
  });

  it('keeps OR logic working with unsupported AQL fields', () => {
    const parsed = parseAql('favorite = true OR tag : "urgent"', {
      customFields: [],
      builtinFields: GLOBAL_BUILTINS,
    });
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const query: GlobalQuery = {
      mode: 'aql',
      raw: 'favorite = true OR tag : "urgent"',
      parsed: parsed.query,
    };

    expect(matchesGlobalQuery({ title: 'Item', tags: ['urgent'] }, query)).toBe(true);
    expect(matchesGlobalQuery({ title: 'Item', tags: ['other'] }, query)).toBe(false);
  });
});
