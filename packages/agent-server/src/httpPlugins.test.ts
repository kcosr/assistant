import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import type { CombinedPluginManifest } from '@assistant/shared';

import { AgentRegistry } from './agents';
import { SessionHub, SessionIndex, createHttpServer } from './index';
import type { PluginRegistry } from './plugins/registry';
import type { ToolHost } from './tools';
import type { EventStore } from './events';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

type HttpServerOptions = Parameters<typeof createHttpServer>[0];
type HttpEnvConfig = HttpServerOptions['config'];

function createEnvConfig(overrides?: Partial<HttpEnvConfig>): HttpEnvConfig {
  return {
    port: 0,
    apiKey: 'test-api-key',
    chatModel: 'test-model',
    toolsEnabled: false,
    dataDir: path.join(
      os.tmpdir(),
      `http-plugins-data-${Date.now()}-${Math.random().toString(16)}`,
    ),
    audioInputMode: 'manual',
    audioSampleRate: 24000,
    audioTranscriptionEnabled: false,
    audioOutputVoice: undefined,
    audioOutputSpeed: undefined,
    ttsModel: 'test-tts-model',
    ttsVoice: undefined,
    ttsFrameDurationMs: 250,
    ttsBackend: 'openai',
    elevenLabsApiKey: undefined,
    elevenLabsVoiceId: undefined,
    elevenLabsModelId: undefined,
    elevenLabsBaseUrl: undefined,
    maxMessagesPerMinute: 60,
    maxAudioBytesPerMinute: 2_000_000,
    maxToolCallsPerMinute: 30,
    debugChatCompletions: false,
    debugHttpRequests: false,
    ...overrides,
  };
}

function startTestServer(options?: {
  pluginRegistry?: PluginRegistry;
}): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const config = createEnvConfig();
    const sessionsFile = createTempFile('http-plugins-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const eventStore: EventStore = {
      append: async () => {},
      appendBatch: async () => {},
      getEvents: async () => [],
      getEventsSince: async () => [],
      subscribe: () => () => {},
      clearSession: async () => {},
      deleteSession: async () => {},
    };
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore,
    });

    const noopToolHost: ToolHost = {
      listTools: async () => [],
      callTool: async () => {
        throw new Error('Tool calls not supported in HTTP plugin tests');
      },
    };

    const serverOptions: Parameters<typeof createHttpServer>[0] = {
      config,
      sessionIndex,
      sessionHub,
      agentRegistry,
      toolHost: noopToolHost,
      eventStore,
    };
    if (options?.pluginRegistry) {
      serverOptions.pluginRegistry = options.pluginRegistry;
    }

    const server = createHttpServer(serverOptions);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to start HTTP server for plugins tests'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });

    server.on('error', (err) => reject(err));
  });
}

async function httpRequest(options: http.RequestOptions & { body?: unknown }): Promise<{
  statusCode: number;
  bodyText: string;
}> {
  return new Promise((resolve, reject) => {
    const headers = { ...(options.headers ?? {}) } as Record<string, string>;
    if (options.body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const request = http.request({ ...options, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          bodyText: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });

    request.on('error', reject);

    if (options.body !== undefined) {
      request.write(JSON.stringify(options.body));
    }

    request.end();
  });
}

describe('HTTP plugin manifest endpoints', () => {
  const servers: http.Server[] = [];

  afterAll(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns plugin manifests from the registry', async () => {
    const manifests: CombinedPluginManifest[] = [
      {
        id: 'test-plugin',
        version: '0.0.1',
        server: {
          provides: ['test'],
        },
      },
    ];

    const pluginRegistry: PluginRegistry = {
      initialize: async () => {},
      getTools: () => [],
      getManifests: () => manifests,
      shutdown: async () => {},
    };

    const { server, baseUrl } = await startTestServer({ pluginRegistry });
    servers.push(server);

    const response = await httpRequest({
      method: 'GET',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/api/plugins',
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.bodyText) as { plugins?: CombinedPluginManifest[] };
    expect(parsed.plugins?.[0]?.id).toBe('test-plugin');
  });

  it('returns an empty list when no registry is configured', async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const response = await httpRequest({
      method: 'GET',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/api/plugins',
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.bodyText) as { plugins?: CombinedPluginManifest[] };
    expect(parsed.plugins).toEqual([]);
  });

  it('stores and updates plugin settings', async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const port = new URL(baseUrl).port;
    const requestBase = {
      hostname: '127.0.0.1',
      port,
    };

    const emptyResponse = await httpRequest({
      ...requestBase,
      method: 'GET',
      path: '/api/plugins/example/settings',
    });

    expect(emptyResponse.statusCode).toBe(200);
    const emptyParsed = JSON.parse(emptyResponse.bodyText) as {
      settings?: Record<string, unknown>;
    };
    expect(emptyParsed.settings).toEqual({});

    const putResponse = await httpRequest({
      ...requestBase,
      method: 'PUT',
      path: '/api/plugins/example/settings',
      body: {
        version: '1.0.0',
        settings: {
          theme: 'dark',
          nested: { enabled: true },
        },
      },
    });

    expect(putResponse.statusCode).toBe(200);
    const putParsed = JSON.parse(putResponse.bodyText) as {
      settings?: Record<string, unknown>;
      version?: string;
    };
    expect(putParsed.version).toBe('1.0.0');
    expect(putParsed.settings?.['theme']).toBe('dark');

    const patchResponse = await httpRequest({
      ...requestBase,
      method: 'PATCH',
      path: '/api/plugins/example/settings',
      body: {
        settings: {
          theme: null,
          nested: { enabled: false },
          layout: 'grid',
        },
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    const patchParsed = JSON.parse(patchResponse.bodyText) as {
      settings?: Record<string, unknown>;
      version?: string;
    };
    expect(patchParsed.version).toBe('1.0.0');
    expect(patchParsed.settings?.['theme']).toBeUndefined();
    expect((patchParsed.settings?.['nested'] as { enabled?: boolean } | undefined)?.enabled).toBe(
      false,
    );
    expect(patchParsed.settings?.['layout']).toBe('grid');
  });
});
