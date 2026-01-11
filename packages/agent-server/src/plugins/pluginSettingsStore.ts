import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const PluginSettingsSchema = z
  .object({
    version: z.string().optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .strict();

const PluginSettingsPatchSchema = PluginSettingsSchema.partial();

const PluginSettingsRecordSchema = z.record(PluginSettingsSchema);

export type PluginSettings = z.infer<typeof PluginSettingsSchema>;
export type PluginSettingsPatch = z.infer<typeof PluginSettingsPatchSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeObjects(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete result[key];
      continue;
    }

    const existing = base[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      result[key] = mergeObjects(existing, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

export function parsePluginSettings(input: unknown): PluginSettings {
  const parsed = PluginSettingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('Invalid plugin settings payload');
  }
  return parsed.data;
}

export function parsePluginSettingsPatch(input: unknown): PluginSettingsPatch {
  const parsed = PluginSettingsPatchSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error('Invalid plugin settings patch');
  }
  return parsed.data;
}

export class PluginSettingsStore {
  private readonly filePath: string;
  private initialised = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async getSettings(pluginId: string): Promise<PluginSettings> {
    const all = await this.readAll();
    const entry = all[pluginId];
    return this.normalize(entry);
  }

  async setSettings(pluginId: string, settings: PluginSettings): Promise<PluginSettings> {
    const validated = parsePluginSettings(settings);
    const all = await this.readAll();
    all[pluginId] = this.normalize(validated);
    await this.writeAll(all);
    return all[pluginId] ?? this.normalize(undefined);
  }

  async updateSettings(pluginId: string, patch: PluginSettingsPatch): Promise<PluginSettings> {
    const validatedPatch = parsePluginSettingsPatch(patch);
    const all = await this.readAll();
    const current = this.normalize(all[pluginId]);
    const next: PluginSettings = {};

    if (validatedPatch.version !== undefined) {
      if (validatedPatch.version && validatedPatch.version.trim().length > 0) {
        next.version = validatedPatch.version.trim();
      }
    } else if (current.version) {
      next.version = current.version;
    }

    if (validatedPatch.settings !== undefined) {
      const merged = mergeObjects(current.settings ?? {}, validatedPatch.settings);
      if (Object.keys(merged).length > 0) {
        next.settings = merged;
      }
    } else if (current.settings && Object.keys(current.settings).length > 0) {
      next.settings = current.settings;
    }

    if (!next.version && (!next.settings || Object.keys(next.settings).length === 0)) {
      delete all[pluginId];
    } else {
      all[pluginId] = next;
    }

    await this.writeAll(all);
    return this.normalize(all[pluginId]);
  }

  private normalize(entry: PluginSettings | undefined): PluginSettings {
    const settings = entry?.settings ?? {};
    const normalized: PluginSettings = { settings };
    if (entry?.version) {
      normalized.version = entry.version;
    }
    return normalized;
  }

  private async readAll(): Promise<Record<string, PluginSettings>> {
    let content: string;
    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return {};
      }
      console.error('Failed to read plugin settings file', err);
      return {};
    }

    let raw: unknown;
    try {
      raw = JSON.parse(content) as unknown;
    } catch (err) {
      console.error('Failed to parse plugin settings file', err);
      return {};
    }

    const parsed = PluginSettingsRecordSchema.safeParse(raw);
    if (!parsed.success) {
      console.error('Invalid plugin settings file content', parsed.error);
      return {};
    }

    return parsed.data;
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

  private async writeAll(settings: Record<string, PluginSettings>): Promise<void> {
    try {
      await this.ensureFileDirectory();
      const json = JSON.stringify(settings, null, 2);
      await fs.writeFile(this.filePath, `${json}\n`, 'utf8');
    } catch (err) {
      console.error('Failed to write plugin settings file', err);
      throw err;
    }
  }
}
