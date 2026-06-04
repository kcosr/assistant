import { describe, expect, it, vi } from 'vitest';

import { isAllowedExternalUrl, isSameFileUrl, openAllowedExternalUrl } from './externalUrls';

describe('external URL policy', () => {
  it('allows normal external browser and mail URLs', () => {
    expect(isAllowedExternalUrl('https://example.test/path')).toBe(true);
    expect(isAllowedExternalUrl('http://example.test/path')).toBe(true);
    expect(isAllowedExternalUrl('mailto:user@example.test')).toBe(true);
  });

  it('blocks local, custom, script, and invalid URLs', () => {
    expect(isAllowedExternalUrl('file:///tmp/example.html')).toBe(false);
    expect(isAllowedExternalUrl('smb://server/share')).toBe(false);
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedExternalUrl('not a url')).toBe(false);
  });

  it('opens only allowed external URLs', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);

    await openAllowedExternalUrl('https://example.test', openExternal);
    await expect(openAllowedExternalUrl('file:///tmp/example.html', openExternal)).rejects.toThrow(
      'Blocked external URL',
    );

    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://example.test');
  });

  it('recognizes same-file app navigations while allowing hash changes', () => {
    const appUrl =
      'file:///Applications/Assistant.app/Contents/Resources/web-client/public/index.html';

    expect(isSameFileUrl(`${appUrl}#chat`, appUrl)).toBe(true);
    expect(isSameFileUrl('https://example.test', appUrl)).toBe(false);
    expect(isSameFileUrl('file:///tmp/index.html', appUrl)).toBe(false);
  });
});
