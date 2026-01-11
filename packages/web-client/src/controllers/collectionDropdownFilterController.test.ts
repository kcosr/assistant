// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { CollectionDropdownFilterController } from './collectionDropdownFilterController';
import { CollectionTagFilterController } from './collectionTagFilterController';
import { CollectionDropdownItemFocusController } from './collectionDropdownItemFocusController';

function createItem(label: string, tags: string[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'collection-search-dropdown-item';
  el.textContent = label;
  el.dataset['searchText'] = label.toLowerCase();
  const normalizedTags = tags.map((t) => t.toLowerCase());
  el.dataset['collectionTags'] = normalizedTags.join(',');
  el.dataset['tags'] = normalizedTags.join(',');
  return el;
}

describe('CollectionDropdownFilterController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('does not treat a standalone "!" token as a text query', () => {
    const searchInput = document.createElement('input');
    const tagsContainer = document.createElement('div');
    const activeTagsContainer = document.createElement('div');
    const list = document.createElement('div');

    const item1 = createItem('One', []);
    const item2 = createItem('Two', []);
    list.appendChild(item1);
    list.appendChild(item2);

    const header = document.createElement('div');

    const tagController = new CollectionTagFilterController({
      tagsContainer,
      activeTagsContainer,
      searchInput,
      getAllTags: () => [],
      onFiltersUpdated: () => {},
    });

    const focusController = new CollectionDropdownItemFocusController({
      getList: () => list,
    });

    const controller = new CollectionDropdownFilterController({
      getGroupsMeta: () => [{ header, divider: null, items: [item1, item2], label: 'group' }],
      getListEl: () => list,
      getTotalAvailableItemCount: () => 2,
      tagController,
      itemFocusController: focusController,
    });

    controller.filter('!');

    expect(item1.style.display).toBe('');
    expect(item2.style.display).toBe('');
  });
});
