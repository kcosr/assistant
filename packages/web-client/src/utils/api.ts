/**
 * API utilities for making requests to the backend.
 *
 * Uses window.ASSISTANT_API_HOST from config.js if set,
 * otherwise falls back to the current page host.
 *
 * When served behind a reverse proxy at a sub-path (e.g., /assistant),
 * the base path is auto-detected from the page URL so that API requests,
 * WebSocket connections, and static assets resolve correctly without
 * requiring explicit configuration.
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
 * Detect the base path from the current page URL.
 *
 * When the app is served behind a reverse proxy at a sub-path
 * (e.g., https://host/assistant/), this returns the sub-path
 * (e.g., "/assistant"). When served at the root, returns "".
 *
 * The detection strips known page filenames like "/index.html"
 * and trailing slashes to produce a clean path prefix.
 */
function getLocationBasePath(): string {
  let pathname = window.location.pathname;
  // Strip known page filenames
  if (pathname.endsWith('/index.html')) {
    pathname = pathname.slice(0, -'/index.html'.length);
  }
  return stripTrailingSlash(pathname);
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
 * Get the base URL for API requests (e.g., "https://host/assistant").
 *
 * When ASSISTANT_API_HOST is set, uses that as the base.
 * Otherwise, auto-detects the base path from the page URL to support
 * reverse proxy sub-path deployments.
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
  const basePath = getLocationBasePath();
  if (useInsecure()) {
    return `http://${host}${basePath}`;
  }
  // Use https for configured host, or match current protocol when known.
  const locationProtocol = window.location.protocol;
  const protocol =
    window.ASSISTANT_API_HOST || locationProtocol === 'https:'
      ? 'https:'
      : locationProtocol === 'http:'
        ? 'http:'
        : 'https:';
  return `${protocol}//${host}${basePath}`;
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
  const basePath = getLocationBasePath();
  const wsPath = basePath ? `${basePath}/ws` : '/ws';
  if (useInsecure()) {
    return `ws://${host}${wsPath}`;
  }
  // Use wss for configured host (assumes https), or match current protocol
  const wsProtocol =
    window.ASSISTANT_API_HOST || window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${wsProtocol}//${host}${wsPath}`;
}

/**
 * Make a fetch request to the API.
 *
 * Transforms absolute-path URLs (starting with "/") by prepending the
 * appropriate base URL:
 * - When ASSISTANT_API_HOST is set, uses the configured API base URL.
 * - Otherwise, prepends the auto-detected base path from the page URL
 *   so requests work correctly behind a reverse proxy at a sub-path.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof input === 'string' && input.startsWith('/')) {
    if (window.ASSISTANT_API_HOST) {
      input = `${getApiBaseUrl()}${input}`;
    } else {
      const basePath = getLocationBasePath();
      if (basePath) {
        input = `${basePath}${input}`;
      }
    }
  }
  return fetch(input, init);
}
