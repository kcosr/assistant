// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureTauri, waitForTauriProxyReady } from './tauri';

afterEach(() => {
  vi.useRealTimers();
  delete (window as { __TAURI__?: unknown }).__TAURI__;
  delete (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST;
  delete (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT;
});

describe('configureTauri', () => {
  it('resolves when proxy invocations time out', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const never = new Promise<string>(() => {});
    const neverPort = new Promise<number>(() => {});
    const invoke = vi.fn((cmd: string) => {
      if (cmd === 'get_proxy_url') {
        return never;
      }
      if (cmd === 'get_ws_proxy_port') {
        return neverPort;
      }
      return Promise.resolve('');
    });
    const listen = vi.fn(() => Promise.resolve(() => {}));

    (window as { __TAURI__?: unknown }).__TAURI__ = {
      core: { invoke },
      event: { listen },
    };

    const pending = configureTauri();
    await vi.advanceTimersByTimeAsync(2000);
    await pending;

    expect(listen).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

describe('waitForTauriProxyReady', () => {
  it('resolves when proxy-ready event fires', async () => {
    (window as { __TAURI__?: unknown }).__TAURI__ = {};

    const waitPromise = waitForTauriProxyReady(1000);
    window.dispatchEvent(new CustomEvent('assistant:tauri-proxy-ready'));

    await expect(waitPromise).resolves.toBe(true);
  });
});
