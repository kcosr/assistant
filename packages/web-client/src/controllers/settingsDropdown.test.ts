// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsDropdownController } from './settingsDropdown';

describe('SettingsDropdownController', () => {
  const originalInnerHeight = window.innerHeight;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('sets a viewport-constrained max-height when opened and updates on resize', () => {
    const wrapper = document.createElement('div');
    const toggleButton = document.createElement('button');
    const dropdown = document.createElement('div');
    wrapper.append(toggleButton, dropdown);
    document.body.appendChild(wrapper);

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 500,
    });

    vi.spyOn(dropdown, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 0,
          y: 120,
          width: 200,
          height: 200,
          top: 120,
          right: 200,
          bottom: 320,
          left: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    const controller = new SettingsDropdownController({
      dropdown,
      toggleButton,
    });
    controller.attach();

    toggleButton.click();

    expect(dropdown.classList.contains('open')).toBe(true);
    expect(dropdown.style.maxHeight).toBe('372px');

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 700,
    });
    window.dispatchEvent(new Event('resize'));

    expect(dropdown.style.maxHeight).toBe('572px');

    toggleButton.click();

    expect(dropdown.classList.contains('open')).toBe(false);
    expect(dropdown.style.maxHeight).toBe('');
  });
});
