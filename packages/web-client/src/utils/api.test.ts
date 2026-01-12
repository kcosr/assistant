// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { getApiBaseUrl, getWebSocketUrl } from './api';

function clearWindowConfig(): void {
  delete (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST;
  delete (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE;
  delete (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT;
}

describe('api url helpers', () => {
  beforeEach(() => {
    clearWindowConfig();
    delete (window as { __TAURI__?: unknown }).__TAURI__;
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
