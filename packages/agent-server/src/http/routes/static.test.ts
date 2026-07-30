import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { HttpContext, HttpHelpers } from '../types';
import { handleStaticRoutes } from './static';

const servers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );
});

async function startStaticServer(publicDir: string): Promise<string> {
  const context = {
    webClientPublicDir: publicDir,
    webClientDistDir: publicDir,
  } as HttpContext;
  const helpers = {} as HttpHelpers;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const handled = await handleStaticRoutes(context, req, res, url, [], helpers);
    if (!handled) {
      res.statusCode = 404;
      res.end('Not found');
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Static test server did not bind to a TCP port');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('font static routes', () => {
  it('serves generated font stylesheets and WOFF2 assets', async () => {
    const publicDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-static-fonts-'));
    const fontsDir = path.join(publicDir, 'fonts');
    await fs.mkdir(fontsDir, { recursive: true });
    await fs.writeFile(path.join(fontsDir, 'fonts.css'), '@font-face {}', 'utf8');
    await fs.writeFile(path.join(fontsDir, 'inter.woff2'), Buffer.from([1, 2, 3]));
    const baseUrl = await startStaticServer(publicDir);

    const cssResponse = await fetch(`${baseUrl}/fonts/fonts.css`);
    expect(cssResponse.status).toBe(200);
    expect(cssResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
    expect(cssResponse.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(cssResponse.headers.get('etag')).toMatch(/^"[A-Za-z0-9_-]+"$/);

    const fontResponse = await fetch(`${baseUrl}/fonts/inter.woff2`);
    expect(fontResponse.status).toBe(200);
    expect(fontResponse.headers.get('content-type')).toBe('font/woff2');
    expect(fontResponse.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(new Uint8Array(await fontResponse.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const etag = fontResponse.headers.get('etag');
    expect(etag).toBeTruthy();
    const cachedResponse = await fetch(`${baseUrl}/fonts/inter.woff2`, {
      headers: { 'If-None-Match': etag ?? '' },
    });
    expect(cachedResponse.status).toBe(304);
    expect(await cachedResponse.text()).toBe('');
  });
});
