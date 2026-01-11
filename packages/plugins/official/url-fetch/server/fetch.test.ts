import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUrl } from './fetch';

function createHtml(parts: { head?: string; body?: string }): string {
  const head = parts.head ?? '';
  const body = parts.body ?? '';
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('url-fetch fetchUrl', () => {
  it('returns raw HTML in raw mode', async () => {
    const html = createHtml({
      head: '<title>Raw Page</title>',
      body: '<p>Hello raw world</p>',
    });

    const response = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchUrl('https://example.com/raw', 'raw');

    expect(result.mode).toBe('raw');
    expect(result.url).toBe('https://example.com/raw');
    expect(result.content).toBe(html);
  });

  it('extracts readable text content in extracted mode', async () => {
    const html = createHtml({
      head: '<title>Article Title</title>',
      body: '<article><h1>Article Title</h1><p>First paragraph.</p></article>',
    });

    const response = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchUrl('https://example.com/article', 'extracted');

    expect(result.mode).toBe('extracted');
    expect(result.url).toBe('https://example.com/article');
    expect(result.content).toBeDefined();
    expect(result.content).toContain('First paragraph');
    expect(result.title).toBeDefined();
  });

  it('extracts metadata from og tags in metadata mode', async () => {
    const html = createHtml({
      head: [
        '<title>Fallback Title</title>',
        '<meta property="og:title" content="OG Title" />',
        '<meta property="og:description" content="OG Description" />',
        '<meta property="og:site_name" content="Example Site" />',
      ].join(''),
    });

    const response = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchUrl('https://example.com/meta', 'metadata');

    expect(result.mode).toBe('metadata');
    expect(result.url).toBe('https://example.com/meta');
    expect(result.title).toBe('OG Title');
    expect(result.description).toBe('OG Description');
    expect(result.siteName).toBe('Example Site');
    expect(result.content).toBeUndefined();
  });

  it('returns empty metadata when tags are missing in metadata mode', async () => {
    const html = createHtml({
      head: '',
      body: '<p>No metadata here</p>',
    });

    const response = new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    const result = await fetchUrl('https://example.com/nometa', 'metadata');

    expect(result.mode).toBe('metadata');
    expect(result.url).toBe('https://example.com/nometa');
    expect(result.title).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.siteName).toBeUndefined();
    expect(result.content).toBeUndefined();
  });
});
