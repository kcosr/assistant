// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadAttachment, openHtmlAttachmentInBrowser, resolveAttachmentUrl } from './attachmentActions';

function setLocationPathname(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, pathname, host: 'localhost', protocol: 'http:' },
    writable: true,
    configurable: true,
  });
}

describe('attachmentActions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setLocationPathname('/assistant/');
    document.body.innerHTML = '';
    delete (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST;
    delete (window as Window & { __TAURI__?: object }).__TAURI__;
    delete (
      window as Window & {
        Capacitor?: object;
      }
    ).Capacitor;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resolves API-relative URLs through the configured base URL', () => {
    (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'https://example.com/custom';

    expect(resolveAttachmentUrl('/api/attachments/s1/a1?download=1')).toBe(
      'https://example.com/custom/api/attachments/s1/a1?download=1',
    );
  });

  it('opens HTML attachments from fetched bytes via an object URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>Hello</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    const createObjectUrlSpy = vi.fn().mockReturnValue('blob:https://example.com/test');
    const revokeObjectUrlSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: createObjectUrlSpy,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revokeObjectUrlSpy,
      configurable: true,
      writable: true,
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await openHtmlAttachmentInBrowser('/api/attachments/s1/a1');

    expect(fetchSpy).toHaveBeenCalledWith('/assistant/api/attachments/s1/a1', { method: 'GET' });
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('a')).toBeNull();

    vi.runOnlyPendingTimers();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:https://example.com/test');
  });

  it('opens HTML attachments via Tauri shell when running on desktop', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    (window as Window & { __TAURI__?: object }).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    await openHtmlAttachmentInBrowser('/api/attachments/s1/a1');

    expect(invoke).toHaveBeenCalledWith('plugin:shell|open', {
      path: 'http://localhost/assistant/api/attachments/s1/a1',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('opens HTML attachments via the Android Capacitor attachment bridge', async () => {
    const bridgeOpen = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><body>Hello</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    );
    (
      window as Window & {
        Capacitor?: {
          getPlatform?: () => string;
          Plugins?: { AssistantAttachmentOpen?: { openHtmlAttachment?: typeof bridgeOpen } };
        };
      }
    ).Capacitor = {
      getPlatform: () => 'android',
      Plugins: {
        AssistantAttachmentOpen: {
          openHtmlAttachment: bridgeOpen,
        },
      },
    };

    await openHtmlAttachmentInBrowser('/api/attachments/s1/a1', 'report.html');

    expect(fetchSpy).toHaveBeenCalledWith('/assistant/api/attachments/s1/a1', { method: 'GET' });
    expect(bridgeOpen).toHaveBeenCalledWith({
      fileName: 'report.html',
      contentType: 'text/html',
      contentBase64: 'PGh0bWw+PGJvZHk+SGVsbG88L2JvZHk+PC9odG1sPg==',
    });
  });

  it('downloads attachments via Tauri save dialog and native write', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce('/tmp/report.html')
      .mockResolvedValueOnce(undefined);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('hello', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }),
    );
    (window as Window & { __TAURI__?: object }).__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn() },
    };

    await downloadAttachment('/api/attachments/s1/a1?download=1', 'report.html');

    expect(invoke).toHaveBeenNthCalledWith(1, 'plugin:dialog|save', {
      options: {
        defaultPath: 'report.html',
      },
    });
    expect(fetchSpy).toHaveBeenCalledWith('http://localhost/assistant/api/attachments/s1/a1?download=1');
    expect(invoke).toHaveBeenNthCalledWith(2, 'save_artifact_file', {
      path: '/tmp/report.html',
      content_base64: 'aGVsbG8=',
    });
  });
});
