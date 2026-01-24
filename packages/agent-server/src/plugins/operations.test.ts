import { describe, expect, it, vi } from 'vitest';

import type { CombinedPluginManifest } from '@assistant/shared';
import type { HttpContext } from '../http/types';
import type { ToolContext } from '../tools';
import { createPluginOperationSurface } from './operations';

describe('plugin operations', () => {
  it('creates default tool definitions from operations', async () => {
    const manifest: CombinedPluginManifest = {
      id: 'demo',
      version: '0.1.0',
      operations: [
        {
          id: 'ping',
          summary: 'Ping',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const { tools } = createPluginOperationSurface({
      manifest,
      handlers: { ping: handler },
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('demo_ping');
    expect(tools[0]?.description).toBe('Ping');

    const ctx: ToolContext = { sessionId: 't1', signal: new AbortController().signal };
    const result = await tools[0]?.handler({}, ctx);
    expect(result).toEqual({ ok: true });
  });

  it('routes HTTP operations with default paths', async () => {
    const manifest: CombinedPluginManifest = {
      id: 'demo',
      version: '0.1.0',
      operations: [
        {
          id: 'ping',
          summary: 'Ping',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const handler = vi.fn().mockResolvedValue({ ok: true });
    const { httpRoutes } = createPluginOperationSurface({
      manifest,
      handlers: { ping: handler },
    });

    expect(httpRoutes).toHaveLength(1);

    let status = 0;
    let payload: unknown;
    const helpers = {
      sendJson: (statusCode: number, body: unknown) => {
        status = statusCode;
        payload = body;
      },
      readJsonBody: async () => ({}),
    };

    const url = new URL('http://localhost/api/plugins/demo/operations/ping');
    const segments = url.pathname.split('/').filter(Boolean);
    const context = {
      httpToolContext: { sessionId: 'http', signal: new AbortController().signal },
      sessionHub: { broadcastToAll: vi.fn() },
    } as unknown as HttpContext;

    const handled = await httpRoutes[0]?.(
      context,
      { method: 'POST' } as never,
      {} as never,
      url,
      segments,
      helpers,
    );

    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(payload).toEqual({ ok: true, result: { ok: true } });
  });

  it('normalizes tool names for dashed plugin ids', async () => {
    const manifest: CombinedPluginManifest = {
      id: 'session-info',
      version: '0.1.0',
      operations: [
        {
          id: 'label_set',
          summary: 'Set label',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const { tools } = createPluginOperationSurface({
      manifest,
      handlers: { label_set: vi.fn().mockResolvedValue({ ok: true }) },
    });

    expect(tools[0]?.name).toBe('session_info_label_set');
  });

  it('respects manifest surface toggles', async () => {
    const manifest: CombinedPluginManifest = {
      id: 'demo',
      version: '0.1.0',
      surfaces: { tool: false, http: false },
      operations: [
        {
          id: 'ping',
          summary: 'Ping',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const { tools, httpRoutes } = createPluginOperationSurface({
      manifest,
      handlers: { ping: vi.fn().mockResolvedValue({ ok: true }) },
    });

    expect(tools).toHaveLength(0);
    expect(httpRoutes).toHaveLength(0);
  });

  it('passes session id from headers into the tool context', async () => {
    const manifest: CombinedPluginManifest = {
      id: 'demo',
      version: '0.1.0',
      operations: [
        {
          id: 'ping',
          summary: 'Ping',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const handler = vi.fn().mockImplementation((_args, ctx) => ({ sessionId: ctx.sessionId }));
    const { httpRoutes } = createPluginOperationSurface({
      manifest,
      handlers: { ping: handler },
    });

    let status = 0;
    let payload: unknown;
    const helpers = {
      sendJson: (statusCode: number, body: unknown) => {
        status = statusCode;
        payload = body;
      },
      readJsonBody: async () => ({}),
    };

    const url = new URL('http://localhost/api/plugins/demo/operations/ping');
    const segments = url.pathname.split('/').filter(Boolean);
    const context = {
      httpToolContext: { sessionId: 'http', signal: new AbortController().signal },
    } as unknown as HttpContext;

    const handled = await httpRoutes[0]?.(
      context,
      { method: 'POST', headers: { 'x-session-id': 's1' } } as never,
      {} as never,
      url,
      segments,
      helpers,
    );

    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(payload).toEqual({ ok: true, result: { sessionId: 's1' } });
  });

  it('wires requestInteraction when session id is provided', async () => {
    const manifest: CombinedPluginManifest = {
      id: 'demo',
      version: '0.1.0',
      operations: [
        {
          id: 'ping',
          summary: 'Ping',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    };

    const handler = vi.fn().mockImplementation(async (_args, ctx) => {
      if (!ctx.requestInteraction) {
        throw new Error('requestInteraction missing');
      }
      return ctx.requestInteraction({
        type: 'input',
        onResponse: () => ({ complete: { ok: true } }),
      });
    });

    const waitForResponse = vi.fn().mockResolvedValue({ action: 'submit', input: {} });
    const sessionHub = {
      getInteractionAvailability: vi.fn().mockReturnValue({
        supportedCount: 1,
        enabledCount: 1,
        available: true,
      }),
      matchCliToolCall: vi.fn().mockResolvedValue(undefined),
      getInteractionRegistry: () => ({ waitForResponse }),
      broadcastToSession: vi.fn(),
    };

    const { httpRoutes } = createPluginOperationSurface({
      manifest,
      handlers: { ping: handler },
    });

    let status = 0;
    let payload: unknown;
    const helpers = {
      sendJson: (statusCode: number, body: unknown) => {
        status = statusCode;
        payload = body;
      },
      readJsonBody: async () => ({}),
    };

    const url = new URL('http://localhost/api/plugins/demo/operations/ping');
    const segments = url.pathname.split('/').filter(Boolean);
    const context = {
      httpToolContext: {
        sessionId: 'http',
        signal: new AbortController().signal,
        sessionHub,
      },
    } as unknown as HttpContext;

    const handled = await httpRoutes[0]?.(
      context,
      { method: 'POST', headers: { 'x-session-id': 's1' } } as never,
      {} as never,
      url,
      segments,
      helpers,
    );

    expect(handled).toBe(true);
    expect(status).toBe(200);
    expect(payload).toEqual({ ok: true, result: { ok: true } });
    expect(sessionHub.getInteractionAvailability).toHaveBeenCalledWith('s1');
    expect(sessionHub.matchCliToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1' }),
    );
    expect(waitForResponse).toHaveBeenCalledTimes(1);
  });
});
