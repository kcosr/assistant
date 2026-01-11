import path from 'node:path';

import type { PluginConfig } from '../config';

export const DEFAULT_PLUGIN_INSTANCE_ID = 'default';

export type PluginInstanceDefinition = {
  id: string;
  label: string;
};

export type PluginInstanceConfigDefinition = PluginInstanceDefinition & {
  config: PluginConfig;
};

type PluginInstanceConfigEntry =
  | string
  | {
      id: string;
      label?: string;
      config?: Record<string, unknown>;
      [key: string]: unknown;
    };

const INSTANCE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

function formatInstanceLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function mergeConfigValues(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    if (overrideValue === undefined) {
      continue;
    }
    if (key === 'instances') {
      continue;
    }
    const baseValue = result[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = mergeConfigValues(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

function extractInstanceOverride(
  pluginId: string,
  entry: Record<string, unknown>,
): Record<string, unknown> {
  const override: Record<string, unknown> = {};
  const rawConfig = entry['config'];
  if (rawConfig !== undefined && !isPlainObject(rawConfig)) {
    console.warn(
      `[plugins] Ignoring invalid instance config override for plugin "${pluginId}"`,
    );
  }
  if (isPlainObject(rawConfig)) {
    Object.assign(override, rawConfig);
  }
  for (const [key, value] of Object.entries(entry)) {
    if (key === 'id' || key === 'label' || key === 'config') {
      continue;
    }
    if (value !== undefined) {
      override[key] = value;
    }
  }
  if ('instances' in override) {
    delete override['instances'];
  }
  return override;
}

export function normalizePluginInstanceId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (!INSTANCE_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function resolvePluginInstanceConfigs(
  pluginId: string,
  pluginConfig?: PluginConfig,
): PluginInstanceConfigDefinition[] {
  const baseConfig: Record<string, unknown> = { ...(pluginConfig ?? {}) };
  if ('instances' in baseConfig) {
    delete baseConfig['instances'];
  }

  const map = new Map<string, PluginInstanceConfigDefinition>();
  map.set(DEFAULT_PLUGIN_INSTANCE_ID, {
    id: DEFAULT_PLUGIN_INSTANCE_ID,
    label: 'Default',
    config: baseConfig as PluginConfig,
  });

  const rawInstances = pluginConfig?.instances;
  if (!Array.isArray(rawInstances)) {
    return Array.from(map.values());
  }

  for (const entry of rawInstances as PluginInstanceConfigEntry[]) {
    if (typeof entry === 'string') {
      const normalized = normalizePluginInstanceId(entry);
      if (!normalized) {
        console.warn(
          `[plugins] Ignoring invalid instance id "${entry}" for plugin "${pluginId}"`,
        );
        continue;
      }
      const label =
        normalized === DEFAULT_PLUGIN_INSTANCE_ID
          ? 'Default'
          : formatInstanceLabel(normalized);
      map.set(normalized, {
        id: normalized,
        label,
        config: mergeConfigValues(baseConfig, {}) as PluginConfig,
      });
      continue;
    }

    if (entry && typeof entry === 'object') {
      const normalized = normalizePluginInstanceId(entry.id);
      if (!normalized) {
        console.warn(
          `[plugins] Ignoring invalid instance id "${entry.id}" for plugin "${pluginId}"`,
        );
        continue;
      }
      const label =
        entry.label?.trim() ||
        (normalized === DEFAULT_PLUGIN_INSTANCE_ID
          ? 'Default'
          : formatInstanceLabel(normalized));
      const override = extractInstanceOverride(pluginId, entry);
      map.set(normalized, {
        id: normalized,
        label,
        config: mergeConfigValues(baseConfig, override) as PluginConfig,
      });
    }
  }

  return Array.from(map.values());
}

export function resolvePluginInstances(
  pluginId: string,
  pluginConfig?: PluginConfig,
): PluginInstanceDefinition[] {
  const map = new Map<string, PluginInstanceDefinition>();
  map.set(DEFAULT_PLUGIN_INSTANCE_ID, {
    id: DEFAULT_PLUGIN_INSTANCE_ID,
    label: 'Default',
  });

  const rawInstances = pluginConfig?.instances;
  if (!Array.isArray(rawInstances)) {
    return Array.from(map.values());
  }

  for (const entry of rawInstances as PluginInstanceConfigEntry[]) {
    if (typeof entry === 'string') {
      const normalized = normalizePluginInstanceId(entry);
      if (!normalized || normalized === DEFAULT_PLUGIN_INSTANCE_ID) {
        if (!normalized) {
          console.warn(
            `[plugins] Ignoring invalid instance id "${entry}" for plugin "${pluginId}"`,
          );
        }
        continue;
      }
      map.set(normalized, { id: normalized, label: formatInstanceLabel(normalized) });
      continue;
    }

    if (entry && typeof entry === 'object') {
      const normalized = normalizePluginInstanceId(entry.id);
      if (!normalized || normalized === DEFAULT_PLUGIN_INSTANCE_ID) {
        if (!normalized) {
          console.warn(
            `[plugins] Ignoring invalid instance id "${entry.id}" for plugin "${pluginId}"`,
          );
        }
        continue;
      }
      const label = entry.label?.trim() || formatInstanceLabel(normalized);
      map.set(normalized, { id: normalized, label });
    }
  }

  return Array.from(map.values());
}

export function resolvePluginInstanceDataDir(baseDir: string, instanceId: string): string {
  return path.join(baseDir, instanceId);
}
