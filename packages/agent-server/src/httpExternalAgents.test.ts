import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import type { ChatEvent, CombinedPluginManifest, ServerMessage } from '@assistant/shared';

import { AgentRegistry } from './agents';
import { createHttpServer, SessionHub, SessionIndex } from './index';
import type { PluginRegistry } from './plugins/registry';
import { createPluginOperationSurface } from './plugins/operations';
import type { ToolHost } from './tools';
import type { EventStore } from './events';
import manifestJson from '../../plugins/core/sessions/manifest.json';
import { createPlugin as createSessionsPlugin } from '../../plugins/core/sessions/server';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

type HttpServerOptions = Parameters<typeof createHttpServer>[0];
type HttpEnvConfig = HttpServerOptions['config'];

const CREATE_SESSION_PATH = '/api/plugins/sessions/operations/create';
const DELETE_SESSION_PATH = '/api/plugins/sessions/operations/delete';

function createSessionsPluginRegistry(): PluginRegistry {
  const manifest = manifestJson as CombinedPluginManifest;
  const module = createSessionsPlugin({ manifest });
  const { tools, httpRoutes } = createPluginOperationSurface({
    manifest,
    handlers: module.operations ?? {},
  });

  return {
    initialize: async () => {},
    getTools: () => tools,
    getHttpRoutes: () => httpRoutes,
    getManifests: () => [manifest],
    shutdown: async () => {},
  };
}

class TestSessionHub extends SessionHub {
  public lastBroadcast: { sessionId: string; message: ServerMessage } | undefined;
  public broadcasts: Array<{ sessionId: string; message: ServerMessage }> = [];

  override broadcastToSession(sessionId: string, message: ServerMessage): void {
    this.lastBroadcast = { sessionId, message };
    this.broadcasts.push({ sessionId, message });
  }
}

function createEnvConfig(overrides?: Partial<HttpEnvConfig>): HttpEnvConfig {
  return {
    port: 0,
    apiKey: 'test-api-key',
    chatModel: 'test-model',
    toolsEnabled: false,
    dataDir: path.join(
      os.tmpdir(),
      `http-external-data-${Date.now()}-${Math.random().toString(16)}`,
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

function startTestServer(
  agentRegistry: AgentRegistry,
  options?: { pluginRegistry?: PluginRegistry },
): Promise<{
  server: http.Server;
  baseUrl: string;
  sessionIndex: SessionIndex;
  sessionHub: TestSessionHub;
  eventStore: EventStore;
}> {
  return new Promise((resolve, reject) => {
    const config = createEnvConfig();
    const sessionIndex = new SessionIndex(createTempFile('http-external-sessions'));
    const pluginRegistry = options?.pluginRegistry ?? createSessionsPluginRegistry();
    const eventState = new Map<string, ChatEvent[]>();
    const eventStore: EventStore = {
      append: async (sessionId, event) => {
        const events = eventState.get(sessionId) ?? [];
        events.push(event);
        eventState.set(sessionId, events);
      },
      appendBatch: async (sessionId, events) => {
        const existing = eventState.get(sessionId) ?? [];
        existing.push(...events);
        eventState.set(sessionId, existing);
      },
      getEvents: async (sessionId) => eventState.get(sessionId) ?? [],
      getEventsSince: async (sessionId, afterEventId) => {
        const events = eventState.get(sessionId) ?? [];
        if (!afterEventId) {
          return events;
        }
        const index = events.findIndex((event) => event.id === afterEventId);
        if (index === -1) {
          return events;
        }
        return events.slice(index + 1);
      },
      subscribe: () => () => {},
      clearSession: async (sessionId) => {
        eventState.delete(sessionId);
      },
      deleteSession: async (sessionId) => {
        eventState.delete(sessionId);
      },
    };
    const sessionHub = new TestSessionHub({
      sessionIndex,
      agentRegistry,
      eventStore,
      ...(pluginRegistry ? { pluginRegistry } : {}),
    });

    const noopToolHost: ToolHost = {
      listTools: async () => [],
      callTool: async () => {
        throw new Error('Tool calls not supported in HTTP external tests');
      },
    };

    const server = createHttpServer({
      config,
      sessionIndex,
      sessionHub,
      agentRegistry,
      toolHost: noopToolHost,
      eventStore,
      ...(pluginRegistry ? { pluginRegistry } : {}),
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to start HTTP server for tests'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        sessionIndex,
        sessionHub,
        eventStore,
      });
    });

    server.on('error', (err) => reject(err));
  });
}

async function httpRequest(
  options: http.RequestOptions & { body?: string; json?: unknown },
): Promise<{
  statusCode: number;
  bodyText: string;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
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

    if (options.json !== undefined) {
      request.write(JSON.stringify(options.json));
    } else if (options.body !== undefined) {
      request.write(options.body);
    }

    request.end();
  });
}

describe('external agents HTTP endpoints', () => {
  const servers: http.Server[] = [];

  afterAll(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('requires sessionId for external agents and validates format', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'external-a',
        displayName: 'External A',
        description: 'External agent',
        type: 'external',
        external: {
          inputUrl: 'https://example.com/input',
          callbackBaseUrl: 'http://127.0.0.1',
        },
      },
    ]);

    const { server, baseUrl } = await startTestServer(agentRegistry);
    servers.push(server);

    const port = new URL(baseUrl).port;

    const missingSessionId = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-a' },
    });
    expect(missingSessionId.statusCode).toBe(400);

    const invalidSessionId = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-a', sessionId: 'bad id' },
    });
    expect(invalidSessionId.statusCode).toBe(400);

    const tooLong = 'a'.repeat(129);
    const tooLongSessionId = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-a', sessionId: tooLong },
    });
    expect(tooLongSessionId.statusCode).toBe(400);
  });

  it('attaches idempotently and rejects agent mismatches', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'external-a',
        displayName: 'External A',
        description: 'External agent',
        type: 'external',
        external: {
          inputUrl: 'https://example.com/input',
          callbackBaseUrl: 'http://127.0.0.1',
        },
      },
      {
        agentId: 'external-b',
        displayName: 'External B',
        description: 'External agent',
        type: 'external',
        external: {
          inputUrl: 'https://example.com/input',
          callbackBaseUrl: 'http://127.0.0.1',
        },
      },
    ]);

    const { server, baseUrl } = await startTestServer(agentRegistry);
    servers.push(server);

    const port = new URL(baseUrl).port;

    const first = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-a', sessionId: 'EXTERNAL-123' },
    });
    expect(first.statusCode).toBe(201);
    const firstParsed = JSON.parse(first.bodyText) as {
      result?: { sessionId?: string; agentId?: string };
    };
    expect(firstParsed.result?.sessionId).toBe('EXTERNAL-123');
    expect(firstParsed.result?.agentId).toBe('external-a');

    const second = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-a', sessionId: 'EXTERNAL-123' },
    });
    expect(second.statusCode).toBe(201);
    const secondParsed = JSON.parse(second.bodyText) as {
      result?: { sessionId?: string; agentId?: string };
    };
    expect(secondParsed.result?.sessionId).toBe('EXTERNAL-123');
    expect(secondParsed.result?.agentId).toBe('external-a');

    const mismatch = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-b', sessionId: 'EXTERNAL-123' },
    });
    expect(mismatch.statusCode).toBe(400);
  });

  it('revives deleted sessions and accepts external callbacks', async () => {
    const agentRegistry = new AgentRegistry([
      {
        agentId: 'external-a',
        displayName: 'External A',
        description: 'External agent',
        type: 'external',
        external: {
          inputUrl: 'https://example.com/input',
          callbackBaseUrl: 'http://127.0.0.1',
        },
      },
    ]);

    const { server, baseUrl, sessionIndex, sessionHub, eventStore } =
      await startTestServer(agentRegistry);
    servers.push(server);

    const port = new URL(baseUrl).port;

    const created = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-a', sessionId: 'EXTERNAL-REUSE' },
    });
    expect(created.statusCode).toBe(201);

    const deleted = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: DELETE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { sessionId: 'EXTERNAL-REUSE' },
    });
    expect(deleted.statusCode).toBe(200);

    const revived = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: CREATE_SESSION_PATH,
      headers: { 'Content-Type': 'application/json' },
      json: { agentId: 'external-a', sessionId: 'EXTERNAL-REUSE' },
    });
    expect(revived.statusCode).toBe(201);
    const revivedParsed = JSON.parse(revived.bodyText) as {
      result?: { sessionId?: string; deleted?: boolean };
    };
    expect(revivedParsed.result?.sessionId).toBe('EXTERNAL-REUSE');
    expect(revivedParsed.result?.deleted).toBeUndefined();

    const eventsBefore = await eventStore.getEvents('EXTERNAL-REUSE');
    expect(eventsBefore).toEqual([]);

    const callback = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: '/external/sessions/EXTERNAL-REUSE/messages',
      headers: { 'Content-Type': 'text/plain' },
      body: 'Hello *world*',
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.bodyText).toBe('');

    const eventsAfter = await eventStore.getEvents('EXTERNAL-REUSE');
    const assistantDone = eventsAfter.find(
      (event) =>
        event.type === 'assistant_done' &&
        (event as { payload?: { text?: string } }).payload?.text === 'Hello *world*',
    );
    expect(assistantDone).toBeTruthy();

    const broadcastMessages = sessionHub.broadcasts
      .filter((entry) => entry.sessionId === 'EXTERNAL-REUSE')
      .map((entry) => entry.message);
    const textDone = broadcastMessages.find((message) => message.type === 'text_done') as
      | { text?: string }
      | undefined;
    expect(textDone?.text).toBe('Hello *world*');

    const missingCallback = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: '/external/sessions/MISSING/messages',
      headers: { 'Content-Type': 'text/plain' },
      body: 'Hello',
    });
    expect(missingCallback.statusCode).toBe(404);

    await sessionIndex.markSessionDeleted('EXTERNAL-REUSE');
    const deletedCallback = await httpRequest({
      method: 'POST',
      hostname: '127.0.0.1',
      port,
      path: '/external/sessions/EXTERNAL-REUSE/messages',
      headers: { 'Content-Type': 'text/plain' },
      body: 'Hello again',
    });
    expect(deletedCallback.statusCode).toBe(404);
  });
});
