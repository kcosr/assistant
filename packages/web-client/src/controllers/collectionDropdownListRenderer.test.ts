// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderCollectionDropdownList } from './collectionDropdownListRenderer';
import type { CollectionItemSummary } from './collectionTypes';

describe('renderCollectionDropdownList', () => {
  it('renders action containers when renderItemActions is provided', () => {
    const listEl = document.createElement('div');
    const items: CollectionItemSummary[] = [
      { type: 'list', id: 'l1', name: 'List One' },
      { type: 'list', id: 'l2', name: 'List Two' },
    ];

    renderCollectionDropdownList({
      listEl,
      items,
      getGroupLabel: () => 'Lists',
      onSelectItem: () => undefined,
      renderItemActions: (actionsEl, item) => {
        const marker = document.createElement('span');
        marker.className = 'action-marker';
        marker.textContent = item.id;
        actionsEl.appendChild(marker);
      },
    });

    const actionContainers = listEl.querySelectorAll('.collection-search-dropdown-item-actions');
    expect(actionContainers).toHaveLength(items.length);

    const markers = listEl.querySelectorAll('.action-marker');
    expect(markers).toHaveLength(items.length);
    expect(markers[0]?.textContent).toBe('l1');
    expect(markers[1]?.textContent).toBe('l2');
  });
});
