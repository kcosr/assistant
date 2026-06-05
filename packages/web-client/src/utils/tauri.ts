/**
 * Compatibility wrappers for the transitional Tauri desktop package.
 * New desktop code should use ./desktop.
 */

import {
  configureDesktop,
  getDesktopBackendUrl,
  getDesktopProxyUrl,
  getDesktopWsProxyPort,
  isTauri,
  setDesktopBackendUrl,
} from './desktop';

export { isTauri };

export async function getTauriBackendUrl(): Promise<string> {
  return getDesktopBackendUrl();
}

export async function setTauriBackendUrl(url: string): Promise<void> {
  await setDesktopBackendUrl(url);
}

export async function getTauriProxyUrl(): Promise<string> {
  return getDesktopProxyUrl();
}

export async function getTauriWsProxyPort(): Promise<number> {
  return getDesktopWsProxyPort();
}

export async function configureTauri(): Promise<void> {
  await configureDesktop();
}

export async function waitForTauriProxyReady(timeoutMs = 5000): Promise<boolean> {
  if (!isTauri()) {
    return true;
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
      window.removeEventListener('assistant:tauri-proxy-ready', onReady);
    };
    window.addEventListener('assistant:desktop-proxy-ready', onReady, { once: true });
    window.addEventListener('assistant:tauri-proxy-ready', onReady, { once: true });
  });
}
