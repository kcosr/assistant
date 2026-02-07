// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch, getApiBaseUrl, getWebSocketUrl } from './api';

function clearWindowConfig(): void {
  delete (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST;
  delete (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE;
  delete (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT;
}

function setLocationPathname(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname, host: 'localhost', protocol: 'http:' },
    writable: true,
    configurable: true,
  });
}

describe('api url helpers', () => {
  beforeEach(() => {
    clearWindowConfig();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    setLocationPathname('/');
  });

  it('uses insecure scheme when ASSISTANT_INSECURE is true', () => {
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'localhost:4100';
    (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE = true;

    expect(getApiBaseUrl()).toBe('http://localhost:4100');
    expect(getWebSocketUrl()).toBe('ws://localhost:4100/ws');
  });

  it('honors full API URLs with paths', () => {
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST =
      'https://assistant.example/api';

    expect(getApiBaseUrl()).toBe('https://assistant.example/api');
    expect(getWebSocketUrl()).toBe('wss://assistant.example/api/ws');
  });

  it('prefers the WebSocket proxy port when provided', () => {
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'https://assistant.example';
    (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT = 7777;

    expect(getWebSocketUrl()).toBe('ws://localhost:7777');
  });

  it('repairs malformed protocol-less hosts', () => {
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'http//localhost:4100';

    expect(getApiBaseUrl()).toBe('http://localhost:4100');
    expect(getWebSocketUrl()).toBe('ws://localhost:4100/ws');
  });

  it('defaults to insecure when running in Tauri', () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'localhost:4100';

    expect(getApiBaseUrl()).toBe('http://localhost:4100');
  });
});

describe('reverse proxy sub-path support', () => {
  beforeEach(() => {
    clearWindowConfig();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
  });

  it('detects base path from page URL with trailing slash', () => {
    setLocationPathname('/assistant/');

    expect(getApiBaseUrl()).toBe('http://localhost/assistant');
    expect(getWebSocketUrl()).toBe('ws://localhost/assistant/ws');
  });

  it('detects base path from page URL without trailing slash', () => {
    setLocationPathname('/assistant');

    expect(getApiBaseUrl()).toBe('http://localhost/assistant');
    expect(getWebSocketUrl()).toBe('ws://localhost/assistant/ws');
  });

  it('detects base path from page URL with index.html', () => {
    setLocationPathname('/assistant/index.html');

    expect(getApiBaseUrl()).toBe('http://localhost/assistant');
    expect(getWebSocketUrl()).toBe('ws://localhost/assistant/ws');
  });

  it('works at root with no sub-path', () => {
    setLocationPathname('/');

    expect(getApiBaseUrl()).toBe('http://localhost');
    expect(getWebSocketUrl()).toBe('ws://localhost/ws');
  });

  it('works at root with index.html', () => {
    setLocationPathname('/index.html');

    expect(getApiBaseUrl()).toBe('http://localhost');
    expect(getWebSocketUrl()).toBe('ws://localhost/ws');
  });

  it('detects nested sub-paths', () => {
    setLocationPathname('/apps/assistant/');

    expect(getApiBaseUrl()).toBe('http://localhost/apps/assistant');
    expect(getWebSocketUrl()).toBe('ws://localhost/apps/assistant/ws');
  });

  it('prefers ASSISTANT_API_HOST over location-based detection', () => {
    setLocationPathname('/assistant/');
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST =
      'https://example.com/custom';

    expect(getApiBaseUrl()).toBe('https://example.com/custom');
    expect(getWebSocketUrl()).toBe('wss://example.com/custom/ws');
  });
});

describe('apiFetch with sub-path', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fetchSpy: any;

  beforeEach(() => {
    clearWindowConfig();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));
  });

  it('prepends base path to absolute URLs when at sub-path', async () => {
    setLocationPathname('/assistant/');

    await apiFetch('/api/test');

    expect(fetchSpy).toHaveBeenCalledWith('/assistant/api/test', undefined);
  });

  it('does not modify URLs when at root', async () => {
    setLocationPathname('/');

    await apiFetch('/api/test');

    expect(fetchSpy).toHaveBeenCalledWith('/api/test', undefined);
  });

  it('does not modify non-absolute URLs', async () => {
    setLocationPathname('/assistant/');

    await apiFetch('https://example.com/api/test');

    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/api/test', undefined);
  });

  it('uses full API base URL when ASSISTANT_API_HOST is set', async () => {
    setLocationPathname('/assistant/');
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST =
      'https://example.com/custom';

    await apiFetch('/api/test');

    expect(fetchSpy).toHaveBeenCalledWith('https://example.com/custom/api/test', undefined);
  });
});
