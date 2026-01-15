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
    HTMLElement.prototype.scrollIntoView = () => undefined;
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
      'alpha',
    );

    controller.open();
    const items = root.querySelectorAll<HTMLElement>('.panel-chrome-instance-item');
    expect(items.length).toBe(2);
    items[1]?.click();

    expect(onSelect).toHaveBeenCalledWith('beta');
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
      'alpha',
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
});
