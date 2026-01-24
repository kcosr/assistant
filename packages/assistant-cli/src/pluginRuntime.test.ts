import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CombinedPluginManifest } from '@assistant/shared';

const httpRequest = vi.hoisted(() => vi.fn(async () => ({ ok: true })));

vi.mock('./httpClient', () => ({ httpRequest }));
vi.mock('./config', () => ({ loadConfig: () => ({ baseUrl: 'http://localhost' }) }));

import { runPluginCli } from './pluginRuntime';

describe('runPluginCli', () => {
  const manifest: CombinedPluginManifest = {
    id: 'demo',
    version: '0.1.0',
    description: 'Demo plugin',
    surfaces: { tool: true, http: true, cli: true },
    operations: [
      {
        id: 'ping',
        summary: 'Ping',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
    server: {
      provides: ['demo'],
      capabilities: ['demo.ping'],
    },
  };

  beforeEach(() => {
    httpRequest.mockClear();
    delete process.env['ASSISTANT_SESSION_ID'];
  });

  afterEach(() => {
    delete process.env['ASSISTANT_SESSION_ID'];
  });

  it('uses ASSISTANT_SESSION_ID when --session-id is not provided', async () => {
    process.env['ASSISTANT_SESSION_ID'] = 'session-env';

    await runPluginCli({ manifest, argv: ['ping'] });

    expect(httpRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: { 'x-session-id': 'session-env' },
      }),
    );
  });

  it('prefers --session-id over ASSISTANT_SESSION_ID', async () => {
    process.env['ASSISTANT_SESSION_ID'] = 'session-env';

    await runPluginCli({ manifest, argv: ['ping', '--session-id', 'session-cli'] });

    expect(httpRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: { 'x-session-id': 'session-cli' },
      }),
    );
  });
});
