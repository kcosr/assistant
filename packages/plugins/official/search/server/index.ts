import type { CombinedPluginManifest } from '@assistant/shared';

import type { SearchService } from '../../../../agent-server/src/search/searchService';
import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type SearchArgs = {
  query: string;
  profiles?: string[];
  plugin?: string;
  scope?: string;
  instance?: string;
  limit?: number;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseProfiles(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const collected: string[] = [];
    for (const entry of value) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed && !collected.includes(trimmed)) {
        collected.push(trimmed);
      }
    }
    return collected.length > 0 ? collected : undefined;
  }
  if (typeof value === 'string') {
    const parts = value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return parts.length > 0 ? Array.from(new Set(parts)) : undefined;
  }
  return undefined;
}

function parseLimit(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return value;
}

function requireSearchService(ctx: ToolContext): SearchService {
  const searchService = ctx.searchService;
  if (!searchService) {
    throw new ToolError('search_unavailable', 'Search service unavailable');
  }
  return searchService;
}

function parseSearchArgs(raw: Record<string, unknown>): SearchArgs {
  const query = parseOptionalString(raw['query']);
  if (!query) {
    throw new ToolError('invalid_arguments', 'Missing required parameter: query');
  }
  const profiles = parseProfiles(raw['profiles'] ?? raw['profile']);
  const plugin = parseOptionalString(raw['plugin']);
  const scope = parseOptionalString(raw['scope']);
  const instance = parseOptionalString(raw['instance']);
  const limit = parseLimit(raw['limit']);

  return {
    query,
    ...(profiles ? { profiles } : {}),
    ...(plugin ? { plugin } : {}),
    ...(scope ? { scope } : {}),
    ...(instance ? { instance } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      search: async (args, ctx) => {
        const parsed = parseSearchArgs(asObject(args));
        const searchService = requireSearchService(ctx);
        return searchService.search(parsed);
      },
      scopes: async (_args, ctx) => {
        const searchService = requireSearchService(ctx);
        return searchService.getSearchableScopes();
      },
    },
  };
}
