// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureDesktop, waitForDesktopProxyReady } from './desktop';

afterEach(() => {
  vi.useRealTimers();
  delete (window as { assistantDesktop?: unknown }).assistantDesktop;
  delete (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST;
  delete (window as { ASSISTANT_INSECURE?: boolean }).ASSISTANT_INSECURE;
  delete (window as { ASSISTANT_WS_PORT?: number }).ASSISTANT_WS_PORT;
});

describe('configureDesktop', () => {
  it('configures Electron proxy globals from the preload bridge', async () => {
    const onProxyReady = vi.fn();
    (window as typeof window & { assistantDesktop?: unknown }).assistantDesktop = {
      getProxyUrl: vi.fn().mockResolvedValue('localhost:49152'),
      getWsProxyPort: vi.fn().mockResolvedValue(49153),
      onProxyReady,
    };

    await configureDesktop();

    expect(onProxyReady).toHaveBeenCalledTimes(1);
    expect(window.ASSISTANT_API_HOST).toBe('localhost:49152');
    expect(window.ASSISTANT_INSECURE).toBe(true);
    expect(window.ASSISTANT_WS_PORT).toBe(49153);
  });

  it('applies Electron proxy-ready events after startup', async () => {
    let handler: (payload: { http_port?: number; ws_port?: number }) => void = () => undefined;
    (window as typeof window & { assistantDesktop?: unknown }).assistantDesktop = {
      getProxyUrl: vi.fn().mockResolvedValue(''),
      getWsProxyPort: vi.fn().mockResolvedValue(0),
      onProxyReady: vi.fn((callback) => {
        handler = callback;
        return () => undefined;
      }),
    };

    await configureDesktop();
    handler({
      http_port: 49154,
      ws_port: 49155,
    });

    expect(window.ASSISTANT_API_HOST).toBe('localhost:49154');
    expect(window.ASSISTANT_INSECURE).toBe(true);
    expect(window.ASSISTANT_WS_PORT).toBe(49155);
  });
});

describe('waitForDesktopProxyReady', () => {
  it('resolves when the desktop proxy-ready event fires', async () => {
    (window as typeof window & { assistantDesktop?: unknown }).assistantDesktop = {};

    const waitPromise = waitForDesktopProxyReady(1000);
    window.dispatchEvent(new CustomEvent('assistant:desktop-proxy-ready'));

    await expect(waitPromise).resolves.toBe(true);
  });
});
