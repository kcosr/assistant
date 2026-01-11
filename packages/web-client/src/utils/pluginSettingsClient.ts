import { apiFetch } from './api';

export interface PluginSettings {
  version?: string;
  settings: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSettings(value: unknown): PluginSettings | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawVersion = value['version'];
  const rawSettings = value['settings'];
  const settings = isRecord(rawSettings) ? rawSettings : {};
  const normalized: PluginSettings = { settings };
  if (typeof rawVersion === 'string' && rawVersion.trim().length > 0) {
    normalized.version = rawVersion.trim();
  }
  return normalized;
}

export class PluginSettingsClient {
  private readonly cache = new Map<string, PluginSettings>();

  get(pluginId: string): PluginSettings | null {
    if (!pluginId) {
      return null;
    }
    return this.cache.get(pluginId) ?? null;
  }

  getAll(): Record<string, PluginSettings> {
    return Object.fromEntries(this.cache.entries());
  }

  async load(pluginId: string): Promise<PluginSettings | null> {
    const trimmed = pluginId.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const response = await apiFetch(`/api/plugins/${encodeURIComponent(trimmed)}/settings`);
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as unknown;
      const normalized = normalizeSettings(data);
      if (!normalized) {
        return null;
      }
      this.cache.set(trimmed, normalized);
      return normalized;
    } catch {
      return null;
    }
  }

  async update(pluginId: string, patch: Partial<PluginSettings>): Promise<PluginSettings | null> {
    const trimmed = pluginId.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const response = await apiFetch(`/api/plugins/${encodeURIComponent(trimmed)}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as unknown;
      const normalized = normalizeSettings(data);
      if (!normalized) {
        return null;
      }
      this.cache.set(trimmed, normalized);
      return normalized;
    } catch {
      return null;
    }
  }

  async set(pluginId: string, payload: PluginSettings): Promise<PluginSettings | null> {
    const trimmed = pluginId.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const response = await apiFetch(`/api/plugins/${encodeURIComponent(trimmed)}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        return null;
      }
      const data = (await response.json()) as unknown;
      const normalized = normalizeSettings(data);
      if (!normalized) {
        return null;
      }
      this.cache.set(trimmed, normalized);
      return normalized;
    } catch {
      return null;
    }
  }
}
