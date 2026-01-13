/**
 * Tauri utilities for desktop builds.
 * These functions safely no-op when not running in a Tauri context.
 */

declare global {
  interface Window {
    __TAURI__?: {
      core: {
        invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
      event: {
        listen: <T>(
          event: string,
          handler: (event: { payload: T }) => void,
        ) => Promise<() => void>;
      };
    };
  }
}

type ProxyReadyPayload = {
  http_port?: number;
  ws_port?: number;
};

type ProxyReadyDetail = {
  apiHost: string;
  wsPort: number;
};

const PROTOCOL_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
const TAURI_PROXY_TIMEOUT_MS = 1500;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
  onTimeout?: () => void,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((resolve) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      resolve(fallback);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  });
}

function normalizeProxyHost(proxyUrl: string): string {
  const trimmed = proxyUrl.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('//')) {
    try {
      return new URL(`http:${trimmed}`).host;
    } catch {
      return trimmed.replace(/^\/\//, '');
    }
  }
  if (PROTOCOL_RE.test(trimmed)) {
    try {
      return new URL(trimmed).host;
    } catch {
      return trimmed.replace(PROTOCOL_RE, '');
    }
  }
  return trimmed;
}

function notifyProxyReady(proxyHost: string, wsPort: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  const detail: ProxyReadyDetail = { apiHost: proxyHost, wsPort };
  window.dispatchEvent(new CustomEvent('assistant:tauri-proxy-ready', { detail }));
}

function applyProxySettings(proxyUrl: string, wsPort: number): void {
  const proxyHost = normalizeProxyHost(proxyUrl);
  if (proxyHost) {
    // Use HTTP for local proxy (no TLS needed for localhost)
    window.ASSISTANT_API_HOST = proxyHost;
    (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE = true;
  }

  if (wsPort > 0) {
    // Store WS port for the WebSocket URL builder
    (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT = wsPort;
  }

  if (proxyHost || wsPort > 0) {
    notifyProxyReady(proxyHost, wsPort);
  }
}

/**
 * Check if running in Tauri desktop context.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

/**
 * Get the configured backend URL from Tauri settings.
 * Returns empty string if not in Tauri or no URL configured.
 */
export async function getTauriBackendUrl(): Promise<string> {
  if (!isTauri()) {
    return '';
  }

  try {
    const url = await window.__TAURI__!.core.invoke<string>('get_backend_url');
    return url ?? '';
  } catch {
    return '';
  }
}

/**
 * Set the backend URL in Tauri settings (persists to disk).
 */
export async function setTauriBackendUrl(url: string): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    await window.__TAURI__!.core.invoke('set_backend_url', { url });
  } catch (err) {
    console.error('[tauri] Failed to save backend URL:', err);
  }
}

/**
 * Get the local HTTP proxy URL from Tauri.
 * The proxy handles TLS and certificate validation for the backend.
 */
export async function getTauriProxyUrl(): Promise<string> {
  if (!isTauri()) {
    return '';
  }

  try {
    const url = await window.__TAURI__!.core.invoke<string>('get_proxy_url');
    return url ?? '';
  } catch {
    return '';
  }
}

/**
 * Get the local WebSocket proxy port from Tauri.
 */
export async function getTauriWsProxyPort(): Promise<number> {
  if (!isTauri()) {
    return 0;
  }

  try {
    const port = await window.__TAURI__!.core.invoke<number>('get_ws_proxy_port');
    return port ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Configure Tauri-specific settings on app startup.
 * In Tauri, we connect to local proxies which handle backend connections.
 */
export async function configureTauri(): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    void window.__TAURI__!.event.listen<ProxyReadyPayload>('proxy-ready', (event) => {
      const payload = event.payload ?? {};
      const httpPort = typeof payload.http_port === 'number' ? payload.http_port : 0;
      const wsPort = typeof payload.ws_port === 'number' ? payload.ws_port : 0;
      if (httpPort > 0 || wsPort > 0) {
        const proxyUrl = httpPort > 0 ? `localhost:${httpPort}` : '';
        applyProxySettings(proxyUrl, wsPort);
      }
    });

    // Get the local proxy URLs
    const [proxyUrl, wsPort] = await Promise.all([
      withTimeout(getTauriProxyUrl(), TAURI_PROXY_TIMEOUT_MS, ''),
      withTimeout(getTauriWsProxyPort(), TAURI_PROXY_TIMEOUT_MS, 0),
    ]);
    applyProxySettings(proxyUrl, wsPort);
  } catch (err) {
    console.error('[tauri] Failed to configure proxy:', err);
  }
}

export async function waitForTauriProxyReady(timeoutMs = 5000): Promise<boolean> {
  if (!isTauri()) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.ASSISTANT_API_HOST ?? '';
  const wsPort = (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT ?? 0;
  if (host || wsPort > 0) {
    return true;
  }

  return new Promise((resolve) => {
    let settled = false;
    const onReady = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(true);
    };
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(false);
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      window.removeEventListener('assistant:tauri-proxy-ready', onReady);
    };

    window.addEventListener('assistant:tauri-proxy-ready', onReady, { once: true });
  });
}
