import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  PreferencesStore,
  deepMergePreferences,
  parsePreferences,
  parsePreferencesPatch,
  type Preferences,
} from './preferencesStore';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.json`);
}

describe('PreferencesStore', () => {
  it('returns empty object when no preferences file exists', async () => {
    const filePath = createTempFile('prefs-missing');
    const store = new PreferencesStore(filePath);

    const prefs = await store.getPreferences();
    expect(prefs).toEqual({});
  });

  it('writes and reads full preferences', async () => {
    const filePath = createTempFile('prefs-read-write');
    const store = new PreferencesStore(filePath);

    const initial: Preferences = {
      tagColors: {
        urgent: '#ef4444',
      },
      listColumns: {
        shopping: {
          notes: { width: 200, visibility: 'show-with-data' },
        },
      },
      globalDefaults: {
        listCompactView: true,
        defaultSort: 'created-desc',
      },
      showToolOutput: true,
      expandToolOutput: false,
      showThinking: true,
    };

    const written = await store.setPreferences(initial);
    expect(written).toEqual(initial);

    const roundTrip = await store.getPreferences();
    expect(roundTrip).toEqual(initial);
  });

  it('deep merges preferences on update', async () => {
    const filePath = createTempFile('prefs-deep-merge');
    const store = new PreferencesStore(filePath);

    await store.setPreferences({
      tagColors: {
        urgent: '#ef4444',
        work: '#3b82f6',
      },
      listColumns: {
        shopping: {
          notes: { width: 200, visibility: 'show-with-data' },
          tags: { width: 150, visibility: 'always-show' },
        },
      },
      globalDefaults: {
        listCompactView: true,
      },
      showToolOutput: true,
      expandToolOutput: false,
      showThinking: true,
    });

    const updated = await store.updatePreferences({
      tagColors: {
        urgent: '#dc2626',
        personal: '#22c55e',
      },
      listColumns: {
        shopping: {
          notes: { width: 220 },
          extra: { visibility: 'always-hide' },
        },
        projects: {
          priority: { width: 100, visibility: 'always-show' },
        },
      },
      globalDefaults: {
        defaultSort: 'created-desc',
      },
      showToolOutput: false,
      expandToolOutput: true,
      showThinking: false,
    });

    expect(updated.tagColors).toEqual({
      urgent: '#dc2626',
      work: '#3b82f6',
      personal: '#22c55e',
    });

    expect(updated.listColumns).toEqual({
      shopping: {
        notes: { width: 220, visibility: 'show-with-data' },
        tags: { width: 150, visibility: 'always-show' },
        extra: { visibility: 'always-hide' },
      },
      projects: {
        priority: { width: 100, visibility: 'always-show' },
      },
    });

    expect(updated.globalDefaults).toEqual({
      listCompactView: true,
      defaultSort: 'created-desc',
    });

    expect(updated.showToolOutput).toBe(false);
    expect(updated.expandToolOutput).toBe(true);
    expect(updated.showThinking).toBe(false);
  });
});

describe('preferences helpers', () => {
  it('deepMergePreferences merges nested objects without mutating inputs', () => {
    const base: Preferences = {
      tagColors: { urgent: '#ef4444' },
      listColumns: {
        shopping: {
          notes: { width: 200, visibility: 'show-with-data' },
        },
      },
      globalDefaults: { listCompactView: true },
      showToolOutput: true,
      expandToolOutput: false,
      showThinking: true,
    };

    const patch = {
      tagColors: { urgent: '#dc2626', work: '#3b82f6' },
      listColumns: {
        shopping: {
          notes: { width: 220 },
          tags: { visibility: 'always-show' },
        },
      },
      globalDefaults: { defaultSort: 'created-desc' },
      showToolOutput: false,
      expandToolOutput: true,
      showThinking: false,
    } as const;

    const merged = deepMergePreferences(base, patch);

    expect(merged).toEqual({
      tagColors: {
        urgent: '#dc2626',
        work: '#3b82f6',
      },
      listColumns: {
        shopping: {
          notes: { width: 220, visibility: 'show-with-data' },
          tags: { visibility: 'always-show' },
        },
      },
      globalDefaults: {
        listCompactView: true,
        defaultSort: 'created-desc',
      },
      showToolOutput: false,
      expandToolOutput: true,
      showThinking: false,
    });

    expect(base.tagColors?.['urgent']).toBe('#ef4444');
    expect(base.listColumns?.['shopping']?.['notes']?.width).toBe(200);
    expect(base.globalDefaults?.defaultSort).toBeUndefined();
    expect(base.showToolOutput).toBe(true);
    expect(base.expandToolOutput).toBe(false);
    expect(base.showThinking).toBe(true);
  });

  it('parsePreferences validates full payload', () => {
    const valid: unknown = {
      tagColors: { urgent: '#ef4444' },
      listColumns: {
        shopping: {
          notes: { width: 200, visibility: 'show-with-data' },
        },
      },
      globalDefaults: {
        listCompactView: true,
        defaultSort: 'created-desc',
      },
    };

    expect(() => parsePreferences(valid)).not.toThrow();

    const invalid: unknown = {
      tagColors: 'not-an-object',
    };

    expect(() => parsePreferences(invalid)).toThrow('Invalid preferences payload');
  });

  it('parsePreferencesPatch validates partial payload', () => {
    const validPatch: unknown = {
      tagColors: { urgent: '#dc2626' },
    };

    expect(() => parsePreferencesPatch(validPatch)).not.toThrow();

    const invalidPatch: unknown = {
      listColumns: 'not-an-object',
    };

    expect(() => parsePreferencesPatch(invalidPatch)).toThrow('Invalid preferences payload');
  });
});
