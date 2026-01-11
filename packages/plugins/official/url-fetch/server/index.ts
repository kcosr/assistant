import type { CombinedPluginManifest } from '@assistant/shared';

import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import { ToolError } from '../../../../agent-server/src/tools';
import { fetchUrl } from './fetch';

type UrlFetchMode = 'extracted' | 'raw' | 'metadata';

type UrlFetchArgs = {
  url: string;
  mode: UrlFetchMode;
};

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function parseArgs(raw: Record<string, unknown>): UrlFetchArgs {
  const urlValue = raw['url'];
  if (typeof urlValue !== 'string' || !urlValue.trim()) {
    throw new ToolError('invalid_arguments', 'Missing required parameter: url');
  }

  const modeValue = raw['mode'];
  let mode: UrlFetchMode = 'extracted';
  if (modeValue === 'raw' || modeValue === 'metadata' || modeValue === 'extracted') {
    mode = modeValue;
  }

  return { url: urlValue, mode };
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      fetch: async (args) => {
        const parsed = parseArgs(asObject(args));
        return fetchUrl(parsed.url, parsed.mode);
      },
    },
  };
}
