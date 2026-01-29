// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { setupCommandPaletteFab } from './commandPaletteFab';

describe('setupCommandPaletteFab', () => {
  it('toggles visibility and opens the command palette on click', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);

    let isMobile = true;
    const openCommandPalette = vi.fn();

    const teardown = setupCommandPaletteFab({
      button,
      icon: '<svg class="icon-sm"></svg>',
      openCommandPalette,
      isMobileViewport: () => isMobile,
      isCapacitorAndroid: () => false,
    });

    expect(button.classList.contains('is-visible')).toBe(true);

    isMobile = false;
    window.dispatchEvent(new Event('resize'));

    expect(button.classList.contains('is-visible')).toBe(false);

    button.click();
    expect(openCommandPalette).toHaveBeenCalledTimes(1);

    teardown();
  });
});
