import { afterEach, describe, expect, it, vi } from 'vitest';

import { httpRequest } from './httpClient';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('httpRequest', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('keeps root behavior when baseUrl has no path prefix', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    await httpRequest(
      { baseUrl: 'https://host.example' },
      { path: '/api/plugins/notes/operations/list', method: 'GET' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://host.example/api/plugins/notes/operations/list',
      expect.any(Object),
    );
  });

  it('preserves a baseUrl path prefix when request path starts with /', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    await httpRequest(
      { baseUrl: 'https://host.example/path/to/service' },
      { path: '/api/plugins/notes/operations/list', method: 'GET' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://host.example/path/to/service/api/plugins/notes/operations/list',
      expect.any(Object),
    );
  });

  it('preserves a baseUrl path prefix when baseUrl ends with /', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    await httpRequest(
      { baseUrl: 'https://host.example/path/to/service/' },
      { path: '/api/plugins/notes/operations/list', method: 'GET' },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://host.example/path/to/service/api/plugins/notes/operations/list',
      expect.any(Object),
    );
  });

  it('accepts request paths without a leading slash', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    await httpRequest(
      { baseUrl: 'https://host.example/path/to/service' },
      {
        path: 'api/plugins/notes/operations/list',
        method: 'GET',
        query: { limit: 10 },
      },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://host.example/path/to/service/api/plugins/notes/operations/list?limit=10',
      expect.any(Object),
    );
  });
});
