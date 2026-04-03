import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { AgentRegistry } from './agents';
import { AttachmentStore } from './attachments/store';
import { SessionHub, SessionIndex, createHttpServer } from './index';
import type { ToolHost } from './tools';
import type { EventStore } from './events';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

type HttpServerOptions = Parameters<typeof createHttpServer>[0];
type HttpEnvConfig = HttpServerOptions['config'];

function createEnvConfig(overrides?: Partial<HttpEnvConfig>): HttpEnvConfig {
  return {
    port: 0,
    apiKey: 'test-api-key',
    toolsEnabled: false,
    dataDir: path.join(
      os.tmpdir(),
      `http-attachments-data-${Date.now()}-${Math.random().toString(16)}`,
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

function createEventStore(): EventStore {
  return {
    append: async () => {},
    appendBatch: async () => {},
    getEvents: async () => [],
    getEventsSince: async () => [],
    subscribe: () => () => {},
    clearSession: async () => {},
    deleteSession: async () => {},
  };
}

async function startTestServer(): Promise<{
  server: http.Server;
  baseUrl: string;
  store: AttachmentStore;
}> {
  const config = createEnvConfig();
  const sessionIndex = new SessionIndex(createTempFile('http-attachments-sessions'));
  const agentRegistry = new AgentRegistry([]);
  const eventStore = createEventStore();
  const store = new AttachmentStore(path.join(config.dataDir, 'attachments'));
  const sessionHub = new SessionHub({
    sessionIndex,
    agentRegistry,
    eventStore,
    attachmentStore: store,
  });

  const noopToolHost: ToolHost = {
    listTools: async () => [],
    callTool: async () => {
      throw new Error('Tool calls not supported in HTTP attachment tests');
    },
  };

  const server = createHttpServer({
    config,
    sessionIndex,
    sessionHub,
    agentRegistry,
    toolHost: noopToolHost,
    eventStore,
  });

  const baseUrl = await new Promise<string>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to start HTTP server for attachment tests'));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });

    server.on('error', reject);
  });

  return { server, baseUrl, store };
}

async function httpRequest(options: http.RequestOptions): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const request = http.request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    request.on('error', reject);
    request.end();
  });
}

describe('HTTP attachment routes', () => {
  const servers: http.Server[] = [];

  afterAll(async () => {
    for (const server of servers) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('serves downloadable attachments with metadata headers', async () => {
    const { server, baseUrl, store } = await startTestServer();
    servers.push(server);
    const created = await store.createAttachment({
      sessionId: 'session-1',
      requestId: 'request-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      fileName: 'report.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('report body', 'utf8'),
    });

    const url = new URL(`/api/attachments/session-1/${created.attachmentId}?download=1`, baseUrl);
    const response = await httpRequest({
      method: 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/plain');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body.toString('utf8')).toBe('report body');
  });

  it('forces HTML attachments to download disposition even on the open route', async () => {
    const { server, baseUrl, store } = await startTestServer();
    servers.push(server);
    const created = await store.createAttachment({
      sessionId: 'session-1',
      requestId: 'request-1',
      turnId: 'turn-1',
      toolCallId: 'tool-html',
      fileName: 'report.html',
      contentType: 'text/html; charset=utf-8',
      bytes: Buffer.from('<html><body>Hello</body></html>', 'utf8'),
    });

    const url = new URL(`/api/attachments/session-1/${created.attachmentId}`, baseUrl);
    const response = await httpRequest({
      method: 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
  });
});
