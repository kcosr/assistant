import type { CombinedPluginManifest, ServerOpenUrlMessage } from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginConfig, PluginModule } from '../../../../agent-server/src/plugins/types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type SpotifyConfigOptions = {
  rewriteWebUrlsToUris?: boolean;
};

type LinksPluginConfig = PluginConfig & {
  spotify?: SpotifyConfigOptions;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function rewriteSpotifyUrl(url: string, config?: SpotifyConfigOptions): string {
  const shouldRewrite = config?.rewriteWebUrlsToUris ?? true;
  if (!shouldRewrite) {
    return url;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'open.spotify.com' && !hostname.endsWith('.spotify.com')) {
    return url;
  }

  const match = parsed.pathname.match(
    /^\/(track|album|playlist|artist|show|episode)\/([A-Za-z0-9]+)(?:[/?].*)?$/,
  );
  if (!match) {
    return url;
  }

  const type = match[1];
  const id = match[2];

  return `spotify:${type}:${id}`;
}

function parseArgs(raw: Record<string, unknown>): { url: string; raw: boolean } {
  const urlValue = raw['url'];
  if (typeof urlValue !== 'string' || !urlValue.trim()) {
    throw new ToolError('invalid_arguments', 'Missing required parameter: url');
  }

  const rawFlag = raw['raw'];
  const useRaw = typeof rawFlag === 'boolean' ? rawFlag : false;

  return { url: urlValue.trim(), raw: useRaw };
}

function requireSessionId(ctx: ToolContext): string {
  const sessionId = ctx.sessionId?.trim();
  if (!sessionId) {
    throw new ToolError('invalid_session', 'links_open requires a non-empty sessionId');
  }
  return sessionId;
}

function requireSessionHub(ctx: ToolContext) {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_unavailable', 'Session hub is not available for links_open tool');
  }
  return sessionHub;
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let spotifyConfig: SpotifyConfigOptions | undefined;

  return {
    operations: {
      open: async (args, ctx) => {
        const parsed = parseArgs(asObject(args));
        const sessionId = requireSessionId(ctx);
        const sessionHub = requireSessionHub(ctx);

        const finalUrl = parsed.raw ? parsed.url : rewriteSpotifyUrl(parsed.url, spotifyConfig);

        const message: ServerOpenUrlMessage = {
          type: 'open_url',
          sessionId,
          url: finalUrl,
        };

        sessionHub.broadcastToSession(sessionId, message);

        return { url: finalUrl };
      },
    },
    async initialize(_dataDir: string, pluginConfig?: LinksPluginConfig) {
      const rawSpotify = pluginConfig?.spotify;
      if (rawSpotify && typeof rawSpotify === 'object') {
        spotifyConfig = {
          ...(rawSpotify.rewriteWebUrlsToUris !== undefined
            ? { rewriteWebUrlsToUris: rawSpotify.rewriteWebUrlsToUris === true }
            : {}),
        };
      } else {
        spotifyConfig = undefined;
      }
    },
    async shutdown() {
      spotifyConfig = undefined;
    },
  };
}
