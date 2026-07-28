// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { showToast } from './toast';

describe('showToast', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows and then hides a transient status message', () => {
    vi.useFakeTimers();

    showToast('Steering accepted', 1000);

    const toast = document.querySelector<HTMLElement>('[data-role="app-toast"]');
    expect(toast?.textContent).toBe('Steering accepted');
    expect(toast?.classList.contains('is-visible')).toBe(true);
    expect(toast?.getAttribute('role')).toBe('status');

    vi.advanceTimersByTime(1000);

    expect(toast?.classList.contains('is-visible')).toBe(false);
  });
});
