// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { DialogManager } from './dialogManager';
import { GlobalAqlHeaderController } from './globalAqlHeaderController';

describe('GlobalAqlHeaderController tag chip behavior', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('adds clicked tags to global AQL and falls back to the last valid applied query', () => {
    const container = document.createElement('div');
    const toggleButton = document.createElement('button');
    document.body.appendChild(container);
    document.body.appendChild(toggleButton);

    const updates: Array<{ mode: string; raw?: string } | null> = [];
    const controller = new GlobalAqlHeaderController({
      containerEl: container,
      toggleButtonEl: toggleButton,
      dialogManager: new DialogManager(),
      icons: {
        x: 'x',
        check: 'check',
        save: 'save',
        trash: 'trash',
      },
      onQueryChanged: (query) => {
        if (!query) {
          updates.push(null);
          return;
        }
        if (query.mode === 'aql') {
          updates.push({ mode: query.mode, raw: query.raw });
          return;
        }
        updates.push({ mode: query.mode });
      },
    });
    updates.length = 0;

    let rowClicks = 0;
    const row = document.createElement('div');
    row.addEventListener('click', () => {
      rowClicks += 1;
    });
    document.body.appendChild(row);

    const firstChip = document.createElement('span');
    firstChip.className = 'collection-tag';
    firstChip.dataset['tag'] = 'urgent';
    firstChip.textContent = 'urgent';
    row.appendChild(firstChip);

    firstChip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(rowClicks).toBe(0);
    expect(updates.at(-1)).toEqual({ mode: 'aql', raw: 'tag = "urgent"' });

    const searchInput = container.querySelector<HTMLInputElement>('.collection-list-search-input');
    expect(searchInput).not.toBeNull();
    searchInput!.value = 'tag =';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));

    const secondChip = document.createElement('span');
    secondChip.className = 'collection-browser-item-tag';
    secondChip.dataset['tag'] = 'backend';
    secondChip.textContent = 'backend';
    row.appendChild(secondChip);

    secondChip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(updates.at(-1)).toEqual({
      mode: 'aql',
      raw: '(tag = "urgent") AND tag = "backend"',
    });

    controller.setTagChipClickBehavior('replace');

    const thirdChip = document.createElement('span');
    thirdChip.className = 'collection-tag';
    thirdChip.dataset['tag'] = 'frontend';
    thirdChip.textContent = 'frontend';
    row.appendChild(thirdChip);

    thirdChip.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(updates.at(-1)).toEqual({
      mode: 'aql',
      raw: 'tag = "frontend"',
    });
  });
});
