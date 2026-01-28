// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstanceDropdownController } from './instanceDropdownController';

const createDropdownRoot = (): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
      <button type="button" data-role="instance-trigger">
        <span data-role="instance-trigger-text"></span>
      </button>
      <div class="panel-chrome-instance-menu" data-role="instance-menu" role="listbox">
        <input type="text" data-role="instance-search" />
        <button type="button" data-role="instance-clear"></button>
        <div data-role="instance-list"></div>
      </div>
    </div>
  `;
  document.body.appendChild(wrapper);
  const root = wrapper.querySelector<HTMLElement>('[data-role="instance-dropdown-container"]');
  if (!root) {
    throw new Error('Missing instance dropdown container');
  }
  return root;
};

describe('InstanceDropdownController', () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    document.body.innerHTML = '';
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    document.body.innerHTML = '';
  });

  it('selects an instance on click', () => {
    const root = createDropdownRoot();
    const onSelect = vi.fn();
    const controller = new InstanceDropdownController({ root, onSelect });
    controller.setInstances(
      [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
      ],
      ['alpha'],
    );

    controller.open();
    const items = root.querySelectorAll<HTMLElement>('.panel-chrome-instance-item');
    expect(items.length).toBe(2);
    items[1]?.click();

    expect(onSelect).toHaveBeenCalledWith(['beta']);
    expect(root.querySelector('[data-role="instance-menu"]')?.classList.contains('open')).toBe(
      false,
    );

    controller.destroy();
  });

  it('filters instances based on search input', () => {
    const root = createDropdownRoot();
    const controller = new InstanceDropdownController({
      root,
      onSelect: () => undefined,
    });
    controller.setInstances(
      [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
      ],
      ['alpha'],
    );

    controller.open();
    const search = root.querySelector<HTMLInputElement>('[data-role="instance-search"]');
    if (!search) {
      throw new Error('Missing search input');
    }
    search.value = 'bet';
    search.dispatchEvent(new Event('input'));

    const items = root.querySelectorAll<HTMLElement>('.panel-chrome-instance-item');
    expect(items.length).toBe(1);
    expect(items[0]?.textContent).toBe('Beta');

    controller.destroy();
  });

  it('supports multi-select without closing the menu', () => {
    const root = createDropdownRoot();
    const onSelect = vi.fn();
    const controller = new InstanceDropdownController({
      root,
      onSelect,
      selectionMode: 'multi',
    });
    controller.setInstances(
      [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
        { id: 'gamma', label: 'Gamma' },
      ],
      ['alpha'],
    );

    controller.open();
    const items = root.querySelectorAll<HTMLElement>('.panel-chrome-instance-item');
    items[1]?.click();

    expect(onSelect).toHaveBeenCalledWith(['beta', 'alpha']);
    expect(root.querySelector('[data-role="instance-menu"]')?.classList.contains('open')).toBe(
      true,
    );

    controller.destroy();
  });

  it('makes an exclusive selection when clicking a selected item in multi mode', () => {
    const root = createDropdownRoot();
    const onSelect = vi.fn();
    const controller = new InstanceDropdownController({
      root,
      onSelect,
      selectionMode: 'multi',
    });
    controller.setInstances(
      [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
        { id: 'gamma', label: 'Gamma' },
      ],
      ['alpha', 'beta'],
    );

    controller.open();
    const items = root.querySelectorAll<HTMLElement>('.panel-chrome-instance-item');
    items[1]?.click();

    expect(onSelect).toHaveBeenCalledWith(['beta']);
    expect(root.querySelector('[data-role="instance-menu"]')?.classList.contains('open')).toBe(
      false,
    );

    controller.destroy();
  });

  it('deselects an item via the row clear control', () => {
    const root = createDropdownRoot();
    const onSelect = vi.fn();
    const controller = new InstanceDropdownController({
      root,
      onSelect,
      selectionMode: 'multi',
    });
    controller.setInstances(
      [
        { id: 'alpha', label: 'Alpha' },
        { id: 'beta', label: 'Beta' },
      ],
      ['alpha', 'beta'],
    );

    controller.open();
    const clearButtons = root.querySelectorAll<HTMLButtonElement>(
      '.panel-chrome-instance-item-clear',
    );
    expect(clearButtons.length).toBeGreaterThan(0);
    clearButtons[0]?.click();

    expect(onSelect).toHaveBeenCalledWith(['beta']);
    expect(root.querySelector('[data-role="instance-menu"]')?.classList.contains('open')).toBe(
      true,
    );

    controller.destroy();
  });

  it('focuses the trigger after selecting an instance in single mode', () => {
    const root = createDropdownRoot();
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

    controller.destroy();
  });

  it('keeps focus in the search input when selecting in multi mode', () => {
    const root = createDropdownRoot();
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

    controller.destroy();
  });
});
