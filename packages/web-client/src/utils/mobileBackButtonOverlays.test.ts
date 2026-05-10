// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeMobileBackButtonOverlay } from './mobileBackButtonOverlays';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('closeMobileBackButtonOverlay', () => {
  it('clicks the attachment image viewer overlay when present', () => {
    const overlay = document.createElement('div');
    overlay.className = 'attachment-image-viewer-overlay';
    const clickSpy = vi.spyOn(overlay, 'click');
    document.body.appendChild(overlay);

    expect(closeMobileBackButtonOverlay()).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('returns false when no supported overlay is open', () => {
    expect(closeMobileBackButtonOverlay()).toBe(false);
  });
});
