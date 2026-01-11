import type { CollectionItemSummary } from './collectionTypes';

export interface CollectionDropdownGroupMeta {
  header: HTMLElement;
  divider: HTMLElement | null;
  items: HTMLElement[];
  label: string;
}

export interface CollectionDropdownListRenderOptions {
  listEl: HTMLElement;
  items: CollectionItemSummary[];
  getGroupLabel: (type: string) => string;
  onSelectItem: (itemEl: HTMLElement) => void;
  renderItemContent?: (itemEl: HTMLElement, item: CollectionItemSummary) => void;
}

export function renderCollectionDropdownList(
  options: CollectionDropdownListRenderOptions,
): CollectionDropdownGroupMeta[] {
  const { listEl, items, getGroupLabel, onSelectItem, renderItemContent } = options;

  listEl.innerHTML = '';

  const groupedItems = new Map<string, CollectionItemSummary[]>();
  for (const item of items) {
    const groupLabel = getGroupLabel(item.type);
    const group = groupedItems.get(groupLabel) ?? [];
    group.push(item);
    groupedItems.set(groupLabel, group);
  }

  const groupLabels = Array.from(groupedItems.keys());
  const groupsMeta: CollectionDropdownGroupMeta[] = [];

  groupLabels.forEach((label, gi) => {
    const groupItems = groupedItems.get(label) ?? [];

    const header = document.createElement('div');
    header.className = 'collection-search-dropdown-header';
    header.textContent = label;
    header.dataset['group'] = String(gi);
    listEl.appendChild(header);

    const itemElements: HTMLElement[] = [];

    for (const item of groupItems) {
      const itemEl = document.createElement('button');
      itemEl.type = 'button';
      itemEl.className = 'collection-search-dropdown-item';
      const labelEl = document.createElement('span');
      labelEl.className = 'collection-search-dropdown-item-label';
      labelEl.textContent = item.name;
      itemEl.appendChild(labelEl);
      itemEl.dataset['collectionType'] = item.type;
      itemEl.dataset['collectionId'] = item.id;
      itemEl.dataset['group'] = String(gi);
      itemEl.dataset['searchTextBase'] = item.name.toLowerCase();
      itemEl.dataset['searchText'] = item.name.toLowerCase();
      const collectionTags =
        item.tags && item.tags.length > 0 ? item.tags.map((t) => t.toLowerCase()) : [];
      itemEl.dataset['collectionTags'] = collectionTags.join(',');
      if (collectionTags.length > 0) {
        itemEl.dataset['tags'] = collectionTags.join(',');
      } else {
        itemEl.dataset['tags'] = '';
      }

      renderItemContent?.(itemEl, item);

      itemEl.addEventListener('click', () => {
        onSelectItem(itemEl);
      });

      listEl.appendChild(itemEl);
      itemElements.push(itemEl);
    }

    let divider: HTMLElement | null = null;
    if (gi < groupLabels.length - 1) {
      divider = document.createElement('div');
      divider.className = 'collection-search-dropdown-divider';
      divider.dataset['group'] = String(gi);
      listEl.appendChild(divider);
    }

    groupsMeta.push({
      header,
      divider,
      items: itemElements,
      label: label.toLowerCase(),
    });
  });

  if (items.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'collection-search-dropdown-empty';
    emptyEl.textContent = 'No items available';
    listEl.appendChild(emptyEl);
  }

  return groupsMeta;
}
