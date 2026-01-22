import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import type { CombinedPluginManifest } from '@assistant/shared';

import { AgentRegistry } from './agents';
import { SessionHub, SessionIndex, createHttpServer } from './index';
import type { AppConfig } from './config';
import type { ToolHost } from './tools';
import type { EventStore } from './events';
import type { PluginRegistry } from './plugins/registry';
import { createPluginOperationSurface } from './plugins/operations';
import manifestJson from '../../plugins/official/files/manifest.json';
import { createPlugin as createFilesPlugin } from '../../plugins/official/files/server';

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
    dataDir: path.join(os.tmpdir(), `http-files-data-${Date.now()}-${Math.random().toString(16)}`),
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

function createFilesPluginRegistry(): PluginRegistry {
  const manifest = manifestJson as CombinedPluginManifest;
  const module = createFilesPlugin({ manifest });
  const { tools, httpRoutes } = createPluginOperationSurface({
    manifest,
    handlers: module.operations ?? {},
  });

  return {
    initialize: async (config, dataDir) => {
      const pluginConfig = config.plugins?.['files'];
      await module.initialize?.(dataDir, pluginConfig);
    },
    getTools: () => tools,
    getHttpRoutes: () => httpRoutes,
    getManifests: () => [manifest],
    shutdown: async () => {
      await module.shutdown?.();
    },
  };
}

async function startTestServer(workspaceRoot: string): Promise<{
  server: http.Server;
  baseUrl: string;
}> {
  const config = createEnvConfig();
  const sessionsFile = createTempFile('http-files-sessions');
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
      throw new Error('Tool calls not supported in HTTP files tests');
    },
  };

  const pluginRegistry = createFilesPluginRegistry();
  const appConfig: AppConfig = {
    agents: [],
    profiles: [],
    plugins: {
      files: { enabled: true, workspaceRoot },
    },
    mcpServers: [],
  };
  await pluginRegistry.initialize(appConfig, config.dataDir);

  const server = createHttpServer({
    config,
    sessionIndex,
    sessionHub,
    agentRegistry,
    toolHost: noopToolHost,
    eventStore,
    pluginRegistry,
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to start HTTP server for files tests'));
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

    const req = http.request({ ...options, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          bodyText: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });

    req.on('error', reject);

    if (options.body !== undefined) {
      req.write(JSON.stringify(options.body));
    }

    req.end();
  });
}

describe('HTTP files plugin routes', () => {
  const servers: http.Server[] = [];

  afterAll(() => {
    for (const server of servers) {
      server.close();
    }
  });

  it('lists directory contents from the workspace root', async () => {
    const workspace = createTempDir('files-list');
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, 'alpha.txt'), 'hello');
    await fs.mkdir(path.join(workspace, 'dir'));
    await fs.writeFile(path.join(workspace, '.hidden'), 'secret');

    const { server, baseUrl } = await startTestServer(workspace);
    servers.push(server);

    const url = new URL('/api/plugins/files/operations/workspace-list', baseUrl);
    const response = await httpRequest({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      body: {},
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.bodyText) as {
      result?: { entries?: Array<{ name: string }> };
    };
    const names = (body.result?.entries ?? []).map((entry) => entry.name).sort();
    expect(names).toEqual(['.hidden', 'alpha.txt', 'dir']);
  });

  it('returns file previews', async () => {
    const workspace = createTempDir('files-preview');
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, 'note.txt'), 'hello preview');

    const { server, baseUrl } = await startTestServer(workspace);
    servers.push(server);

    const url = new URL('/api/plugins/files/operations/workspace-read', baseUrl);
    const response = await httpRequest({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      body: { path: 'note.txt' },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.bodyText) as {
      result?: { binary?: boolean; content?: string };
    };
    expect(body.result?.binary).toBe(false);
    expect(body.result?.content).toContain('hello preview');
  });

  it('rejects path traversal', async () => {
    const workspace = createTempDir('files-traversal');
    await fs.mkdir(workspace, { recursive: true });

    const { server, baseUrl } = await startTestServer(workspace);
    servers.push(server);

    const url = new URL('/api/plugins/files/operations/workspace-list', baseUrl);
    const response = await httpRequest({
      method: 'POST',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      body: { path: '../' },
    });

    expect(response.statusCode).toBe(400);
  });
});
