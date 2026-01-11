import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { ConversationStore } from './conversationStore';
import { AgentRegistry } from './agents';
import { SessionHub, SessionIndex, createHttpServer } from './index';
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
    conversationLogPath: '',
    transcriptsDir: createTempDir('http-prefs-log'),
    dataDir: path.join(os.tmpdir(), `http-prefs-data-${Date.now()}-${Math.random().toString(16)}`),
    audioInputMode: 'manual',
    audioSampleRate: 24000,
    audioTranscriptionEnabled: false,
    audioOutputVoice: undefined,
    audioOutputSpeed: undefined,
    ttsModel: 'test-tts-model',
    ttsVoice: undefined,
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

function startTestServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  sessionIndex: SessionIndex;
}> {
  return new Promise((resolve, reject) => {
    const config = createEnvConfig();
    const conversationStore = new ConversationStore(config.transcriptsDir);
    const sessionsFile = createTempFile('http-prefs-sessions');
    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      conversationStore,
      sessionIndex,
      agentRegistry,
    });

    const eventStore: EventStore = {
      append: async () => {},
      appendBatch: async () => {},
      getEvents: async () => [],
      getEventsSince: async () => [],
      subscribe: () => () => {},
    };

    const noopToolHost: ToolHost = {
      listTools: async () => [],
      callTool: async () => {
        throw new Error('Tool calls not supported in HTTP preferences tests');
      },
    };

    const server = createHttpServer({
      config,
      conversationStore,
      sessionIndex,
      sessionHub,
      agentRegistry,
      toolHost: noopToolHost,
      eventStore,
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to start HTTP server for tests'));
        return;
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      resolve({ server, baseUrl, sessionIndex });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}

async function httpRequest(options: http.RequestOptions & { body?: unknown }): Promise<{
  statusCode: number;
  bodyText: string;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: response.statusCode ?? 0,
          bodyText,
        });
      });
    });

    request.on('error', reject);

    if (options.body !== undefined) {
      const json = JSON.stringify(options.body);
      request.write(json);
    }

    request.end();
  });
}

describe('HTTP preferences endpoints', () => {
  const servers: http.Server[] = [];

  afterAll(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('returns empty object when no preferences are set', async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const response = await httpRequest({
      method: 'GET',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/preferences',
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.bodyText) as unknown;
    expect(parsed).toEqual({});
  });

  it('applies PATCH /preferences as deep merge', async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const initialPut = await httpRequest({
      method: 'PUT',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/preferences',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        tagColors: {
          urgent: '#ef4444',
          work: '#3b82f6',
        },
        listColumns: {
          shopping: {
            notes: { width: 200, visibility: 'show-with-data' },
          },
        },
        globalDefaults: {
          listCompactView: true,
        },
      },
    });

    expect(initialPut.statusCode).toBe(200);

    const patchResponse = await httpRequest({
      method: 'PATCH',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/preferences',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        tagColors: {
          urgent: '#dc2626',
          personal: '#22c55e',
        },
        listColumns: {
          shopping: {
            notes: { width: 220 },
            tags: { visibility: 'always-show' },
          },
        },
        globalDefaults: {
          defaultSort: 'created-desc',
        },
      },
    });

    expect(patchResponse.statusCode).toBe(200);
    const patched = JSON.parse(patchResponse.bodyText) as {
      tagColors?: Record<string, string>;
      listColumns?: Record<string, Record<string, { width?: number; visibility?: string }>>;
      globalDefaults?: Record<string, unknown>;
    };

    expect(patched.tagColors).toEqual({
      urgent: '#dc2626',
      work: '#3b82f6',
      personal: '#22c55e',
    });
    expect(patched.listColumns?.['shopping']).toEqual({
      notes: { width: 220, visibility: 'show-with-data' },
      tags: { visibility: 'always-show' },
    });

    expect(patched.globalDefaults).toEqual({
      listCompactView: true,
      defaultSort: 'created-desc',
    });
  });

  it('replaces preferences on PUT /preferences', async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const firstPut = await httpRequest({
      method: 'PUT',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/preferences',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        tagColors: {
          urgent: '#ef4444',
        },
        globalDefaults: {
          listCompactView: true,
        },
      },
    });

    expect(firstPut.statusCode).toBe(200);

    const secondPut = await httpRequest({
      method: 'PUT',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/preferences',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        listColumns: {
          shopping: {
            notes: { width: 180, visibility: 'show-with-data' },
          },
        },
      },
    });

    expect(secondPut.statusCode).toBe(200);
    const replaced = JSON.parse(secondPut.bodyText) as {
      tagColors?: unknown;
      listColumns?: unknown;
      globalDefaults?: unknown;
    };

    expect(replaced.tagColors).toBeUndefined();
    expect(replaced.globalDefaults).toBeUndefined();
    expect(replaced.listColumns).toEqual({
      shopping: {
        notes: { width: 180, visibility: 'show-with-data' },
      },
    });
  });

  it('validates payloads and returns 400 for invalid structures', async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const invalidPatch = await httpRequest({
      method: 'PATCH',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/preferences',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        listColumns: 'not-an-object',
      },
    });

    expect(invalidPatch.statusCode).toBe(400);

    const invalidPut = await httpRequest({
      method: 'PUT',
      hostname: '127.0.0.1',
      port: new URL(baseUrl).port,
      path: '/preferences',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        tagColors: 'not-an-object',
      },
    });

    expect(invalidPut.statusCode).toBe(400);
  });
});
