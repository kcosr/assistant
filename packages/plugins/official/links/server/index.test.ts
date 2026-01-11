import { describe, expect, it } from 'vitest';
import type { CombinedPluginManifest, ServerOpenUrlMessage } from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { createPlugin } from './index';

const MANIFEST = { id: 'links', version: '0.1.0' } as CombinedPluginManifest;

describe('links plugin', () => {
  it('exposes open operation', () => {
    const plugin = createPlugin({ manifest: MANIFEST });

    expect(plugin.operations).toBeDefined();
    expect(typeof plugin.operations?.open).toBe('function');
  });

  it('throws invalid_arguments when url is missing', async () => {
    const plugin = createPlugin({ manifest: MANIFEST });
    const open = plugin.operations?.open;
    if (!open) {
      throw new Error('Expected open operation to be defined');
    }

    const ctx: ToolContext = { sessionId: 'test-session', signal: new AbortController().signal };

    await expect(open({} as Record<string, unknown>, ctx)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Missing required parameter: url',
    });
  });

  it('broadcasts open_url with rewritten Spotify URI by default', async () => {
    const plugin = createPlugin({ manifest: MANIFEST });
    await plugin.initialize?.('/tmp/data-dir');

    const open = plugin.operations?.open;
    if (!open) {
      throw new Error('Expected open operation to be defined');
    }

    let lastBroadcast: { sessionId: string; message: ServerOpenUrlMessage } | undefined;

    const ctx: ToolContext = {
      sessionId: 'session-1',
      signal: new AbortController().signal,
      sessionHub: {
        broadcastToSession: (sessionId: string, message: ServerOpenUrlMessage) => {
          lastBroadcast = { sessionId, message };
        },
      } as never,
    };

    const result = (await open({ url: 'https://open.spotify.com/track/12345?si=abc' }, ctx)) as {
      url?: string;
    };

    expect(result.url).toBe('spotify:track:12345');
    expect(lastBroadcast).toBeDefined();
    expect(lastBroadcast?.sessionId).toBe('session-1');
    expect(lastBroadcast?.message.type).toBe('open_url');
    expect(lastBroadcast?.message.url).toBe('spotify:track:12345');
  });

  it('respects plugin config to disable Spotify URL rewriting', async () => {
    const plugin = createPlugin({ manifest: MANIFEST });
    await plugin.initialize?.('/tmp/data-dir', {
      enabled: true,
      spotify: { rewriteWebUrlsToUris: false },
    });

    const open = plugin.operations?.open;
    if (!open) {
      throw new Error('Expected open operation to be defined');
    }

    let lastBroadcast: { sessionId: string; message: ServerOpenUrlMessage } | undefined;

    const ctx: ToolContext = {
      sessionId: 'session-1',
      signal: new AbortController().signal,
      sessionHub: {
        broadcastToSession: (sessionId: string, message: ServerOpenUrlMessage) => {
          lastBroadcast = { sessionId, message };
        },
      } as never,
    };

    const url = 'https://open.spotify.com/track/12345?si=abc';
    const result = (await open({ url }, ctx)) as { url?: string };

    expect(result.url).toBe(url);
    expect(lastBroadcast?.message.url).toBe(url);
  });

  it('respects raw=true to disable rewriting per-call', async () => {
    const plugin = createPlugin({ manifest: MANIFEST });
    await plugin.initialize?.('/tmp/data-dir', {
      enabled: true,
      spotify: { rewriteWebUrlsToUris: true },
    });

    const open = plugin.operations?.open;
    if (!open) {
      throw new Error('Expected open operation to be defined');
    }

    let lastBroadcast: { sessionId: string; message: ServerOpenUrlMessage } | undefined;

    const ctx: ToolContext = {
      sessionId: 'session-1',
      signal: new AbortController().signal,
      sessionHub: {
        broadcastToSession: (sessionId: string, message: ServerOpenUrlMessage) => {
          lastBroadcast = { sessionId, message };
        },
      } as never,
    };

    const url = 'https://open.spotify.com/track/12345?si=abc';
    const result = (await open({ url, raw: true }, ctx)) as { url?: string };

    expect(result.url).toBe(url);
    expect(lastBroadcast?.message.url).toBe(url);
  });
});
