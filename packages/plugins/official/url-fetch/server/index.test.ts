import type { CombinedPluginManifest } from '@assistant/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { createPlugin } from './index';

const MANIFEST = { id: 'url-fetch', version: '0.1.0' } as CombinedPluginManifest;

describe('url-fetch plugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the fetch operation', () => {
    const plugin = createPlugin({ manifest: MANIFEST });

    expect(plugin.operations).toBeDefined();
    expect(typeof plugin.operations?.fetch).toBe('function');
  });

  it('throws invalid_arguments when url is missing', async () => {
    const plugin = createPlugin({ manifest: MANIFEST });
    const ctx: ToolContext = { sessionId: 'test-session', signal: new AbortController().signal };
    const fetchOp = plugin.operations?.fetch;
    if (!fetchOp) {
      throw new Error('Expected fetch operation to be defined');
    }

    await expect(fetchOp({}, ctx)).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Missing required parameter: url',
    });
  });

  it('calls fetch and returns fetch result for valid args', async () => {
    const plugin = createPlugin({ manifest: MANIFEST });
    const fetchOp = plugin.operations?.fetch;
    if (!fetchOp) {
      throw new Error('Expected fetch operation to be defined');
    }

    const html =
      '<!doctype html><html><head><title>Page</title></head><body><p>Hello</p></body></html>';
    const response = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const ctx: ToolContext = { sessionId: 'test-session', signal: new AbortController().signal };

    const result = (await fetchOp({ url: 'https://example.com', mode: 'raw' }, ctx)) as {
      url?: string;
      mode?: string;
      content?: string;
    };

    expect(result.url).toBe('https://example.com');
    expect(result.mode).toBe('raw');
    expect(result.content).toBe(html);
  });
});
