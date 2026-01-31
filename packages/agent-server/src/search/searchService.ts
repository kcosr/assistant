import type { PluginRegistry } from '../plugins/registry';
import {
  DEFAULT_PLUGIN_INSTANCE_ID,
  normalizePluginInstanceId,
  resolvePluginInstances,
} from '../plugins/instances';
import type { SearchProvider, SearchResult } from '../plugins/types';

export interface GlobalSearchOptions {
  query: string;
  profiles?: string[];
  plugin?: string;
  /** @deprecated Use plugin instead. */
  scope?: string;
  instance?: string;
  limit?: number;
}

export interface SearchableScope {
  pluginId: string;
  label: string;
  instances: Array<{ id: string; label: string }>;
}

export interface SearchApiResult extends SearchResult {
  pluginId: string;
  instanceId: string;
}

export interface SearchApiResponse {
  results: SearchApiResult[];
  timing?: {
    totalMs: number;
    byPlugin?: Record<string, number>;
  };
}

type ProviderEntry = {
  pluginId: string;
  provider: SearchProvider;
};

const normalizeLabel = (raw: string): string => {
  return raw
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

export class SearchService {
  private readonly providers = new Map<string, SearchProvider>();
  private readonly scopes = new Map<string, SearchableScope>();

  constructor(private readonly registry?: PluginRegistry) {}

  registerProvider(pluginId: string, provider: SearchProvider): void {
    if (!pluginId || !provider) {
      return;
    }
    this.providers.set(pluginId, provider);
    if (!this.scopes.has(pluginId)) {
      this.scopes.set(pluginId, {
        pluginId,
        label: normalizeLabel(pluginId),
        instances: [{ id: DEFAULT_PLUGIN_INSTANCE_ID, label: 'Default' }],
      });
    }
  }

  registerScope(scope: SearchableScope): void {
    if (!scope?.pluginId) {
      return;
    }
    this.scopes.set(scope.pluginId, scope);
  }

  syncFromRegistry(): void {
    if (!this.registry?.getRegisteredPlugins) {
      return;
    }
    this.providers.clear();
    this.scopes.clear();

    for (const registration of this.registry.getRegisteredPlugins()) {
      const provider = registration.plugin.searchProvider;
      if (!provider) {
        continue;
      }
      const manifest = registration.manifest ?? registration.plugin.manifest;
      const manifestId = manifest?.id?.trim() ?? '';
      const pluginId =
        manifestId ||
        registration.plugin.name?.trim() ||
        registration.pluginId?.trim() ||
        '';
      if (!pluginId) {
        continue;
      }
      const panelTitle =
        manifest?.panels?.find((panel) => panel.type === pluginId)?.title ??
        manifest?.panels?.[0]?.title ??
        '';
      const label = panelTitle?.trim() || normalizeLabel(pluginId);
      const instances = resolvePluginInstances(pluginId, registration.pluginConfig).map(
        (instance) => ({
          id: instance.id,
          label: instance.label,
        }),
      );
      this.providers.set(pluginId, provider);
      this.scopes.set(pluginId, { pluginId, label, instances });
    }
  }

  getSearchableScopes(): SearchableScope[] {
    return Array.from(this.scopes.values());
  }

  async search(options: GlobalSearchOptions): Promise<SearchApiResponse> {
    const query = options.query.trim();
    const plugin = options.plugin?.trim() ?? options.scope?.trim() ?? '';
    const instance = options.instance?.trim() ?? '';
    const limit =
      typeof options.limit === 'number' && Number.isFinite(options.limit)
        ? options.limit
        : undefined;
    const profiles = this.normalizeProfiles(options.profiles);
    if (!query && !plugin && profiles.length === 0) {
      return { results: [] };
    }

    const providers = this.resolveProviders(plugin);
    const started = Date.now();
    const tasks = providers.map(async ({ pluginId, provider }) => {
      const pluginStart = Date.now();
      const instanceIds = this.resolveInstanceIds(pluginId, instance, profiles);
      if (instanceIds.length === 0) {
        return { pluginId, results: [] as SearchApiResult[], duration: 0 };
      }

      const collected: SearchApiResult[] = [];
      for (const instanceId of instanceIds) {
        try {
          const results = await provider.search(query, {
            instanceId,
            ...(limit !== undefined ? { limit } : {}),
          });
          for (const result of results) {
            collected.push({ ...result, pluginId, instanceId });
          }
        } catch (err) {
          console.warn(`[search] Provider failed`, { pluginId, instanceId, error: err });
        }
      }

      return { pluginId, results: collected, duration: Date.now() - pluginStart };
    });

    const settled = await Promise.all(tasks);
    const byPlugin: Record<string, number> = {};
    const results: SearchApiResult[] = [];
    for (const entry of settled) {
      byPlugin[entry.pluginId] = entry.duration;
      results.push(...entry.results);
    }

    const indexed = results.map((result, index) => ({ result, index }));
    indexed.sort((a, b) => {
      const scoreA = typeof a.result.score === 'number' ? a.result.score : 0;
      const scoreB = typeof b.result.score === 'number' ? b.result.score : 0;
      if (scoreA !== scoreB) {
        return scoreB - scoreA;
      }
      return a.index - b.index;
    });

    return {
      results: indexed.map((entry) => entry.result),
      timing: {
        totalMs: Date.now() - started,
        byPlugin,
      },
    };
  }

  private resolveProviders(plugin: string): ProviderEntry[] {
    if (plugin) {
      const provider = this.providers.get(plugin);
      return provider ? [{ pluginId: plugin, provider }] : [];
    }
    return Array.from(this.providers.entries()).map(([pluginId, provider]) => ({
      pluginId,
      provider,
    }));
  }

  private resolveInstanceIds(
    pluginId: string,
    requestedInstance: string,
    profiles: string[],
  ): string[] {
    const known = this.scopes.get(pluginId)?.instances ?? [];
    const profilesSet = profiles.length > 0 ? new Set(profiles) : null;

    if (requestedInstance) {
      const normalized = normalizePluginInstanceId(requestedInstance) ?? requestedInstance.trim();
      if (!normalized) {
        return [];
      }
      if (profilesSet && !profilesSet.has(normalized)) {
        return [];
      }
      if (known.some((entry) => entry.id === normalized)) {
        return [normalized];
      }
      return [];
    }

    const candidates = profilesSet
      ? known.filter((entry) => profilesSet.has(entry.id))
      : known;

    if (candidates.length === 0) {
      return profilesSet ? [] : [DEFAULT_PLUGIN_INSTANCE_ID];
    }

    return candidates.map((entry) => entry.id);
  }

  private normalizeProfiles(raw?: string[]): string[] {
    if (!raw || raw.length === 0) {
      return [];
    }
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const entry of raw) {
      if (typeof entry !== 'string') {
        continue;
      }
      const candidate = normalizePluginInstanceId(entry);
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      normalized.push(candidate);
    }
    return normalized;
  }
}
