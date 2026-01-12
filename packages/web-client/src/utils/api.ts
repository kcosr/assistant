/**
 * API utilities for making requests to the backend.
 *
 * Uses window.ASSISTANT_API_HOST from config.js if set,
 * otherwise falls back to the current page host.
 */

declare global {
  interface Window {
    ASSISTANT_API_HOST?: string;
    ASSISTANT_INSECURE?: boolean;
    ASSISTANT_WS_PORT?: number;
  }
}

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;

function normalizeApiHostInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('http//')) {
    return `http://${trimmed.slice('http//'.length)}`;
  }
  if (trimmed.startsWith('https//')) {
    return `https://${trimmed.slice('https//'.length)}`;
  }
  return trimmed;
}

function stripTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getConfiguredApiUrl(): URL | null {
  const raw = normalizeApiHostInput(window.ASSISTANT_API_HOST ?? '');
  if (!raw || !PROTOCOL_RE.test(raw)) {
    return null;
  }
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Get the API host for backend connections.
 */
export function getApiHost(): string {
  const configuredUrl = getConfiguredApiUrl();
  if (configuredUrl) {
    return configuredUrl.host;
  }
  const host = normalizeApiHostInput(window.ASSISTANT_API_HOST ?? window.location.host);
  return stripTrailingSlash(host);
}

/**
 * Check if insecure (http/ws) connections should be used.
 * Set window.ASSISTANT_INSECURE = true in config.js to enable.
 */
function useInsecure(): boolean {
  const flag = (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE;
  if (typeof flag === 'boolean') {
    return flag;
  }
  return !!(window as { __TAURI__?: unknown }).__TAURI__;
}

/**
 * Get the base URL for API requests (e.g., "https://assistant").
 */
export function getApiBaseUrl(): string {
  const configuredUrl = getConfiguredApiUrl();
  if (configuredUrl) {
    const protocol = useInsecure() ? 'http:' : configuredUrl.protocol;
    const origin = `${protocol}//${configuredUrl.host}`;
    const path = stripTrailingSlash(configuredUrl.pathname);
    return path ? `${origin}${path}` : origin;
  }

  const host = getApiHost();
  if (useInsecure()) {
    return `http://${host}`;
  }
  // Use https for configured host, or match current protocol when known.
  const locationProtocol = window.location.protocol;
  const protocol =
    window.ASSISTANT_API_HOST || locationProtocol === 'https:'
      ? 'https:'
      : locationProtocol === 'http:'
        ? 'http:'
        : 'https:';
  return `${protocol}//${host}`;
}

/**
 * Get the WebSocket URL for the backend.
 */
export function getWebSocketUrl(): string {
  // Check for separate WebSocket port (used by Tauri proxy)
  const wsPort = (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT;
  if (wsPort && wsPort > 0) {
    return `ws://localhost:${wsPort}`;
  }

  const configuredUrl = getConfiguredApiUrl();
  if (configuredUrl) {
    const protocol = useInsecure() || configuredUrl.protocol === 'http:' ? 'ws:' : 'wss:';
    const origin = `${protocol}//${configuredUrl.host}`;
    const basePath = stripTrailingSlash(configuredUrl.pathname);
    const wsPath = basePath ? `${basePath}/ws` : '/ws';
    return `${origin}${wsPath}`;
  }

  const host = getApiHost();
  if (useInsecure()) {
    return `ws://${host}/ws`;
  }
  // Use wss for configured host (assumes https), or match current protocol
  const wsProtocol =
    window.ASSISTANT_API_HOST || window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}/ws`;
}

/**
 * Make a fetch request to the API.
 * Converts relative URLs to absolute URLs using the API base when a custom host is configured.
 * When no custom host is set, keeps URLs relative so they work with the current page origin.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Only transform URLs when a custom API host is configured
  if (window.ASSISTANT_API_HOST && typeof input === 'string' && input.startsWith('/')) {
    input = `${getApiBaseUrl()}${input}`;
  }
  return fetch(input, init);
}
