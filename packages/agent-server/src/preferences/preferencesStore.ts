import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const ColumnVisibilitySchema = z.enum([
  'always-show',
  'show-with-data',
  'hide-in-compact',
  'always-hide',
]);

const ListColumnConfigSchema = z.object({
  width: z.number().int().positive().optional(),
  visibility: ColumnVisibilitySchema.optional(),
});

const ListColumnPreferencesSchema = z.record(ListColumnConfigSchema);

const SortStateSchema = z.object({
  column: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

const ListViewPreferencesSchema = z.object({
  columns: ListColumnPreferencesSchema.optional(),
  sortState: SortStateSchema.nullable().optional(),
  timelineField: z.string().nullable().optional(),
  focusMarkerItemId: z.string().nullable().optional(),
  focusMarkerExpanded: z.boolean().nullable().optional(),
});

const ViewDisplayPreferencesSchema = z.object({
  expandedMode: z.boolean().optional(),
  columns: ListColumnPreferencesSchema.optional(),
});

const GlobalDefaultsSchema = z
  .object({
    listCompactView: z.boolean().optional(),
    defaultSort: z.string().optional(),
  })
  .catchall(z.union([z.string(), z.boolean()]));

const PreferencesSchema = z
  .object({
    tagColors: z.record(z.string()).optional(),
    listColumns: z.record(ListColumnPreferencesSchema).optional(),
    listViewPrefs: z.record(ListViewPreferencesSchema).optional(),
    viewPrefs: z.record(ViewDisplayPreferencesSchema).optional(),
    globalDefaults: GlobalDefaultsSchema.optional(),
    // Tool output display preferences
    showToolOutput: z.boolean().optional(),
    expandToolOutput: z.boolean().optional(),
    // Thinking display preferences
    showThinking: z.boolean().optional(),
  })
  .strict();

export type ColumnVisibility = z.infer<typeof ColumnVisibilitySchema>;
export type ListColumnConfig = z.infer<typeof ListColumnConfigSchema>;
export type ListColumnPreferences = z.infer<typeof ListColumnPreferencesSchema>;
export type Preferences = z.infer<typeof PreferencesSchema>;

const PreferencesPatchSchema = PreferencesSchema.partial();

export type PreferencesPatch = z.infer<typeof PreferencesPatchSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMergeObjects<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    // null means delete the key
    if (value === null) {
      delete result[key];
      continue;
    }

    const existing = base[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = deepMergeObjects(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

export function deepMergePreferences(base: Preferences, patch: PreferencesPatch): Preferences {
  const result: Preferences = { ...base };

  const mergeKey = (key: keyof Preferences): void => {
    const patchValue = patch[key];
    if (patchValue === undefined) {
      return;
    }
    const baseValue = base[key];
    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      (result as Record<string, unknown>)[key] = deepMergeObjects(
        baseValue as Record<string, unknown>,
        patchValue as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = patchValue as unknown;
    }
  };

  mergeKey('tagColors');
  mergeKey('listColumns');
  mergeKey('listViewPrefs');
  mergeKey('viewPrefs');
  mergeKey('globalDefaults');
  mergeKey('showToolOutput');
  mergeKey('expandToolOutput');
  mergeKey('showThinking');

  return result;
}

export function parsePreferences(input: unknown): Preferences {
  const parsed = PreferencesSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('Invalid preferences payload');
  }
  return parsed.data;
}

export function parsePreferencesPatch(input: unknown): PreferencesPatch {
  const parsed = PreferencesPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('Invalid preferences payload');
  }
  return parsed.data;
}

export class PreferencesStore {
  private readonly filePath: string;
  private initialised = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getPreferences(): Promise<Preferences> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return {};
      }

      console.error('Failed to read preferences file', err);
      return {};
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content) as unknown;
    } catch (err) {
      console.error('Failed to parse preferences file', err);
      return {};
    }

    const parsed = PreferencesSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('Invalid preferences file content', parsed.error);
      return {};
    }

    return parsed.data;
  }

  async setPreferences(full: Preferences): Promise<Preferences> {
    const preferences = parsePreferences(full);
    await this.writePreferences(preferences);
    return preferences;
  }

  async updatePreferences(patch: PreferencesPatch): Promise<Preferences> {
    const validatedPatch = parsePreferencesPatch(patch);
    const current = await this.getPreferences();
    const merged = deepMergePreferences(current, validatedPatch);
    await this.writePreferences(merged);
    return merged;
  }

  private async ensureFileDirectory(): Promise<void> {
    if (this.initialised) {
      return;
    }
    this.initialised = true;
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Best-effort only; failures will surface on write.
    }
  }

  private async writePreferences(preferences: Preferences): Promise<void> {
    try {
      await this.ensureFileDirectory();
      const json = JSON.stringify(preferences, null, 2);
      await fs.writeFile(this.filePath, `${json}\n`, 'utf8');
    } catch (err) {
      console.error('Failed to write preferences file', err);
      throw err;
    }
  }
}
