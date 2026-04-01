// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as capacitor from './capacitor';
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

  it('opens downloads externally in Tauri instead of relying on anchor download', async () => {
    const openSpy = vi.spyOn(capacitor, 'openExternalUrl').mockResolvedValue(undefined);
    (window as Window & { __TAURI__?: object }).__TAURI__ = {
      core: { invoke: vi.fn() },
      event: { listen: vi.fn() },
    };

    await downloadAttachment('/api/attachments/s1/a1?download=1', 'report.html');

    expect(openSpy).toHaveBeenCalledWith('http://localhost/assistant/api/attachments/s1/a1?download=1');
    expect(document.body.querySelector('a')).toBeNull();
  });
});
