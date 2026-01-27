// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InstanceDropdownController } from './instanceDropdownController';

const createRoot = (): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
      <button data-role="instance-trigger">
        <span data-role="instance-trigger-text"></span>
      </button>
      <div data-role="instance-menu">
        <input data-role="instance-search" />
        <button data-role="instance-clear"></button>
        <div data-role="instance-list"></div>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  const container = root.querySelector<HTMLElement>('[data-role="instance-dropdown-container"]');
  if (!container) {
    throw new Error('Missing instance dropdown container');
  }
  return container;
};

describe('InstanceDropdownController', () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    document.body.innerHTML = '';
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  it('focuses the trigger after selecting an instance in single mode', () => {
    const root = createRoot();
    const controller = new InstanceDropdownController({
      root,
      onSelect: vi.fn(),
      selectionMode: 'single',
    });
    controller.setInstances(
      [
        { id: 'default', label: 'Default' },
        { id: 'work', label: 'Work' },
      ],
      ['default'],
    );

    controller.open();
    const searchInput = root.querySelector<HTMLInputElement>('[data-role="instance-search"]');
    const trigger = root.querySelector<HTMLButtonElement>('[data-role="instance-trigger"]');
    if (!searchInput || !trigger) {
      throw new Error('Missing dropdown elements');
    }

    searchInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    searchInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(trigger).toBe(document.activeElement);
  });

  it('keeps focus in the search input when selecting in multi mode', () => {
    const root = createRoot();
    const controller = new InstanceDropdownController({
      root,
      onSelect: vi.fn(),
      selectionMode: 'multi',
    });
    controller.setInstances(
      [
        { id: 'default', label: 'Default' },
        { id: 'work', label: 'Work' },
      ],
      ['default'],
    );

    controller.open();
    const searchInput = root.querySelector<HTMLInputElement>('[data-role="instance-search"]');
    if (!searchInput) {
      throw new Error('Missing search input');
    }

    searchInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    searchInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );

    expect(document.activeElement).toBe(searchInput);
  });
});
