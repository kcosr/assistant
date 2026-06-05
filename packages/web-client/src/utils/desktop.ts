/**
 * Native desktop utilities for Electron and transitional Tauri builds.
 */

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    assistantDesktop?: {
      platform?: string;
      getBackendUrl?: () => Promise<string>;
      setBackendUrl?: (url: string) => Promise<void>;
      getSettings?: () => Promise<unknown>;
      updateSettings?: (settings: {
        backendUrl?: string;
        skipCertValidation?: boolean;
      }) => Promise<unknown>;
      getProxyUrl?: () => Promise<string>;
      getWsProxyPort?: () => Promise<number>;
      showSaveDialog?: (defaultPath: string) => Promise<string | string[] | null>;
      saveArtifactFile?: (path: string, contentBase64: string) => Promise<void>;
      openTempHtmlAttachmentFile?: (fileName: string, contentBase64: string) => Promise<void>;
      openExternal?: (url: string) => Promise<void>;
      onProxyReady?: (
        handler: (payload: { http_port?: number; ws_port?: number }) => void,
      ) => (() => void) | Promise<() => void>;
    };
    __TAURI__?: {
      core: {
        invoke: TauriInvoke;
      };
      event?: {
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
const DESKTOP_PROXY_TIMEOUT_MS = 1500;
const EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

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

function dispatchProxyReady(proxyHost: string, wsPort: number): void {
  if (typeof window === 'undefined') {
    return;
  }
  const detail: ProxyReadyDetail = { apiHost: proxyHost, wsPort };
  window.dispatchEvent(new CustomEvent('assistant:desktop-proxy-ready', { detail }));
  if (isTauri()) {
    window.dispatchEvent(new CustomEvent('assistant:tauri-proxy-ready', { detail }));
  }
}

function applyProxySettings(proxyUrl: string, wsPort: number): void {
  const proxyHost = normalizeProxyHost(proxyUrl);
  if (proxyHost) {
    window.ASSISTANT_API_HOST = proxyHost;
    window.ASSISTANT_INSECURE = true;
  }

  if (wsPort > 0) {
    window.ASSISTANT_WS_PORT = wsPort;
  }

  if (proxyHost || wsPort > 0) {
    dispatchProxyReady(proxyHost, wsPort);
  }
}

function getTauriInvoke(): TauriInvoke | null {
  return window.__TAURI__?.core?.invoke ?? null;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

export function isElectronDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.assistantDesktop;
}

export function isDesktopNative(): boolean {
  return isElectronDesktop() || isTauri();
}

export async function getDesktopBackendUrl(): Promise<string> {
  if (window.assistantDesktop?.getBackendUrl) {
    return (await window.assistantDesktop.getBackendUrl()) ?? '';
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return '';
  }
  try {
    return (await invoke<string>('get_backend_url')) ?? '';
  } catch {
    return '';
  }
}

export async function setDesktopBackendUrl(url: string): Promise<void> {
  if (window.assistantDesktop?.setBackendUrl) {
    await window.assistantDesktop.setBackendUrl(url);
    return;
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return;
  }
  try {
    await invoke('set_backend_url', { url });
  } catch (err) {
    console.error('[desktop] Failed to save backend URL:', err);
  }
}

export async function getDesktopProxyUrl(): Promise<string> {
  if (window.assistantDesktop?.getProxyUrl) {
    try {
      return (await window.assistantDesktop.getProxyUrl()) ?? '';
    } catch {
      return '';
    }
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return '';
  }
  try {
    return (await invoke<string>('get_proxy_url')) ?? '';
  } catch {
    return '';
  }
}

export async function getDesktopWsProxyPort(): Promise<number> {
  if (window.assistantDesktop?.getWsProxyPort) {
    try {
      return (await window.assistantDesktop.getWsProxyPort()) ?? 0;
    } catch {
      return 0;
    }
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return 0;
  }
  try {
    return (await invoke<number>('get_ws_proxy_port')) ?? 0;
  } catch {
    return 0;
  }
}

export async function showDesktopSaveDialog(defaultPath: string): Promise<string | null> {
  if (window.assistantDesktop?.showSaveDialog) {
    const savePath = await window.assistantDesktop.showSaveDialog(defaultPath);
    return Array.isArray(savePath) ? (savePath[0] ?? null) : savePath;
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }
  const savePath = await invoke<string | string[] | null>('plugin:dialog|save', {
    options: { defaultPath },
  });
  return Array.isArray(savePath) ? (savePath[0] ?? null) : savePath;
}

export async function saveDesktopArtifactFile(
  filePath: string,
  contentBase64: string,
): Promise<void> {
  if (window.assistantDesktop?.saveArtifactFile) {
    await window.assistantDesktop.saveArtifactFile(filePath, contentBase64);
    return;
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error('Desktop save bridge unavailable');
  }
  await invoke('save_artifact_file', {
    path: filePath,
    content_base64: contentBase64,
  });
}

export async function openDesktopTempHtmlAttachmentFile(
  fileName: string,
  contentBase64: string,
): Promise<void> {
  if (window.assistantDesktop?.openTempHtmlAttachmentFile) {
    await window.assistantDesktop.openTempHtmlAttachmentFile(fileName, contentBase64);
    return;
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error('Desktop attachment bridge unavailable');
  }
  await invoke('open_temp_html_attachment_file', {
    fileName,
    contentBase64,
  });
}

export async function openDesktopExternal(url: string): Promise<void> {
  if (window.assistantDesktop?.openExternal) {
    await window.assistantDesktop.openExternal(url);
    return;
  }
  const invoke = getTauriInvoke();
  if (!invoke) {
    window.open(url, '_blank');
    return;
  }
  await invoke('plugin:shell|open', { path: url });
}

function resolveExternalDesktopHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed, window.location.href);
    if (!EXTERNAL_LINK_PROTOCOLS.has(url.protocol)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function installDesktopExternalLinkHandler(root: Document | HTMLElement = document): () => void {
  if (!isDesktopNative()) {
    return () => undefined;
  }

  const handleClick = (event: Event): void => {
    if (!(event instanceof MouseEvent)) {
      return;
    }
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (!(event.target instanceof Element)) {
      return;
    }

    const anchor = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.hasAttribute('download')) {
      return;
    }

    const externalUrl = resolveExternalDesktopHref(anchor.href);
    if (!externalUrl) {
      return;
    }

    event.preventDefault();
    void openDesktopExternal(externalUrl).catch((err) => {
      console.error('[desktop] Failed to open external link:', err);
    });
  };

  root.addEventListener('click', handleClick, true);
  return () => root.removeEventListener('click', handleClick, true);
}

export async function configureDesktop(): Promise<void> {
  if (!isDesktopNative()) {
    return;
  }

  try {
    if (window.assistantDesktop?.onProxyReady) {
      void window.assistantDesktop.onProxyReady((payload) => {
        const httpPort = typeof payload.http_port === 'number' ? payload.http_port : 0;
        const wsPort = typeof payload.ws_port === 'number' ? payload.ws_port : 0;
        if (httpPort > 0 || wsPort > 0) {
          applyProxySettings(httpPort > 0 ? `localhost:${httpPort}` : '', wsPort);
        }
      });
    }

    if (window.__TAURI__?.event?.listen) {
      void window.__TAURI__.event.listen<ProxyReadyPayload>('proxy-ready', (event) => {
        const payload = event.payload ?? {};
        const httpPort = typeof payload.http_port === 'number' ? payload.http_port : 0;
        const wsPort = typeof payload.ws_port === 'number' ? payload.ws_port : 0;
        if (httpPort > 0 || wsPort > 0) {
          applyProxySettings(httpPort > 0 ? `localhost:${httpPort}` : '', wsPort);
        }
      });
    }

    const [proxyUrl, wsPort] = await Promise.all([
      withTimeout(getDesktopProxyUrl(), DESKTOP_PROXY_TIMEOUT_MS, ''),
      withTimeout(getDesktopWsProxyPort(), DESKTOP_PROXY_TIMEOUT_MS, 0),
    ]);
    applyProxySettings(proxyUrl, wsPort);
  } catch (err) {
    console.error('[desktop] Failed to configure proxy:', err);
  }
}

export async function waitForDesktopProxyReady(timeoutMs = 5000): Promise<boolean> {
  if (!isDesktopNative()) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  const host = window.ASSISTANT_API_HOST ?? '';
  const wsPort = window.ASSISTANT_WS_PORT ?? 0;
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
      window.removeEventListener('assistant:desktop-proxy-ready', onReady);
    };

    window.addEventListener('assistant:desktop-proxy-ready', onReady, { once: true });
  });
}
