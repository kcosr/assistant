import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { createServer } from './server';

interface JsonResponse<T> {
  statusCode: number;
  body: T;
}

function requestJson<T = unknown>(
  options: http.RequestOptions & { body?: unknown },
): Promise<JsonResponse<T>> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf-8');
        });
        res.on('end', () => {
          try {
            const parsed = data ? (JSON.parse(data) as T) : ({} as T);
            resolve({ statusCode: res.statusCode ?? 0, body: parsed });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

describe('coding sidecar HTTP server', () => {
  let server: http.Server | undefined;
  let baseUrl: URL;

  beforeEach(async () => {
    const workspaceRoot = path.join(os.tmpdir(), `coding-sidecar-http-${Date.now()}`);
    process.env['WORKSPACE_ROOT'] = workspaceRoot;

    server = createServer();
    await new Promise<void>((resolve) => {
      server!.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get server address');
    }
    baseUrl = new URL(`http://127.0.0.1:${address.port}`);
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
      });
      server = undefined;
    }
  });

  it('responds to /health with version info', async () => {
    const url = new URL('/health', baseUrl);
    const response = await requestJson<{ ok: boolean; version: string }>({
      method: 'GET',
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(typeof response.body.version).toBe('string');
    expect(response.body.version.length).toBeGreaterThan(0);
  });

  it('writes and reads a file via HTTP endpoints', async () => {
    const sessionId = 'http-session';

    const writeUrl = new URL('/write', baseUrl);
    const writeResponse = await requestJson<{
      ok: boolean;
      result?: { ok: boolean; path: string; bytes: number };
    }>({
      method: 'POST',
      hostname: writeUrl.hostname,
      port: writeUrl.port,
      path: writeUrl.pathname,
      body: {
        sessionId,
        path: 'test.txt',
        content: 'hello from http',
      },
    });

    expect(writeResponse.statusCode).toBe(200);
    expect(writeResponse.body.ok).toBe(true);
    expect(writeResponse.body.result?.ok).toBe(true);

    const readUrl = new URL('/read', baseUrl);
    const readResponse = await requestJson<{
      ok: boolean;
      result?: { type: string; content?: string };
    }>({
      method: 'POST',
      hostname: readUrl.hostname,
      port: readUrl.port,
      path: readUrl.pathname,
      body: {
        sessionId,
        path: 'test.txt',
      },
    });

    expect(readResponse.statusCode).toBe(200);
    expect(readResponse.body.ok).toBe(true);
    expect(readResponse.body.result?.type).toBe('text');
    expect(readResponse.body.result?.content).toContain('hello from http');
  });

  it('finds files via the /find endpoint', async () => {
    const sessionId = 'http-find-session';

    const writeUrl = new URL('/write', baseUrl);
    await requestJson<{
      ok: boolean;
      result?: { ok: boolean; path: string; bytes: number };
    }>({
      method: 'POST',
      hostname: writeUrl.hostname,
      port: writeUrl.port,
      path: writeUrl.pathname,
      body: {
        sessionId,
        path: 'src/app.ts',
        content: 'console.log("app");',
      },
    });

    await requestJson<{
      ok: boolean;
      result?: { ok: boolean; path: string; bytes: number };
    }>({
      method: 'POST',
      hostname: writeUrl.hostname,
      port: writeUrl.port,
      path: writeUrl.pathname,
      body: {
        sessionId,
        path: 'src/utils/helper.ts',
        content: 'console.log("helper");',
      },
    });

    const findUrl = new URL('/find', baseUrl);
    const findResponse = await requestJson<{
      ok: boolean;
      result?: { files?: string[]; truncated?: boolean; limit?: number };
    }>({
      method: 'POST',
      hostname: findUrl.hostname,
      port: findUrl.port,
      path: findUrl.pathname,
      body: {
        sessionId,
        pattern: '**/*.ts',
        path: 'src',
      },
    });

    expect(findResponse.statusCode).toBe(200);
    expect(findResponse.body.ok).toBe(true);
    expect(Array.isArray(findResponse.body.result?.files)).toBe(true);
    expect(findResponse.body.result?.files).toContain('app.ts');
    expect(findResponse.body.result?.files).toContain('utils/helper.ts');
  });
});
