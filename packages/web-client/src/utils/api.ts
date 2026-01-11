/**
 * API utilities for making requests to the backend.
 *
 * Uses window.ASSISTANT_API_HOST from config.js if set,
 * otherwise falls back to the current page host.
 */

declare global {
  interface Window {
    ASSISTANT_API_HOST?: string;
  }
}

/**
 * Get the API host for backend connections.
 */
export function getApiHost(): string {
  return window.ASSISTANT_API_HOST ?? window.location.host;
}

/**
 * Get the base URL for API requests (e.g., "https://assistant").
 */
export function getApiBaseUrl(): string {
  const host = getApiHost();
  // Use https for configured host, or match current protocol
  const protocol = window.ASSISTANT_API_HOST ? 'https:' : window.location.protocol;
  return `${protocol}//${host}`;
}

/**
 * Get the WebSocket URL for the backend.
 */
export function getWebSocketUrl(): string {
  const host = getApiHost();
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
