# Lists Dropdown Quick Add Button

## Status

**Draft** - January 2026

## Summary

Add a small + button to the right side of each list entry in the lists dropdown. Clicking it opens the new item modal for that specific list, allowing quick item creation without first selecting and opening the list.

## Problem

Currently, to add an item to a specific list:
1. Open the lists dropdown
2. Click the list to select it
3. Wait for the list to load
4. Click the add button or press 'a'

This is slow when the user just wants to quickly add an item to a known list.

## Proposed Solution

Add a quick-add (+) button to each list row in the dropdown:

```
┌─────────────────────────────────────────────┐
│ Lists                                       │
├─────────────────────────────────────────────┤
│ ▶ Shopping list                         [+] │
│   Work tasks                            [+] │
│   Reading list                          [+] │
└─────────────────────────────────────────────┘
```

### Behavior

- Clicking the + button opens the add-item dialog for that list
- The dropdown closes after clicking +
- The + button click stops propagation (doesn't also select the list)
- The list panel remains on the current list (doesn't switch to the target list)
- The + button is always visible on all platforms
- On hover, the + button shows a subtle highlight
- No keyboard focus/activation for the + button (mouse/touch only)

## Implementation

### 1. Extend `renderCollectionDropdownList` to support action buttons

Add a new option `renderItemActions` to the renderer:

```typescript
export interface CollectionDropdownListRenderOptions {
  listEl: HTMLElement;
  items: CollectionItemSummary[];
  getGroupLabel: (type: string) => string;
  onSelectItem: (itemEl: HTMLElement) => void;
  renderItemContent?: (itemEl: HTMLElement, item: CollectionItemSummary) => void;
  renderItemActions?: (itemEl: HTMLElement, item: CollectionItemSummary) => void;  // NEW
}
```

In the render function, call `renderItemActions` after creating the label:

```typescript
const itemEl = document.createElement('button');
itemEl.type = 'button';
itemEl.className = 'collection-search-dropdown-item';

const labelEl = document.createElement('span');
labelEl.className = 'collection-search-dropdown-item-label';
labelEl.textContent = item.name;
itemEl.appendChild(labelEl);

// NEW: Add actions container
const actionsEl = document.createElement('span');
actionsEl.className = 'collection-search-dropdown-item-actions';
itemEl.appendChild(actionsEl);

renderItemActions?.(actionsEl, item);
```

### 2. Update lists plugin to add the + button

In the lists plugin's dropdown initialization:

```typescript
dropdownController = new CollectionDropdownController({
  // ...existing options...
});

// When populating the dropdown, use the renderItemActions callback
this.dropdownGroupsMeta = renderCollectionDropdownList({
  listEl: list,
  items: sortedItems,
  getGroupLabel: this.options.getGroupLabel,
  onSelectItem: (itemEl) => {
    this.selectDropdownItem(itemEl);
  },
  renderItemActions: (actionsEl, item) => {
    if (item.type !== 'list') return;  // Only for lists, not notes
    
    const addBtn = document.createElement('span');
    addBtn.className = 'collection-search-dropdown-item-add';
    addBtn.title = 'Add item to this list';
    addBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dropdownController?.close(false);
      listPanelController.openAddItemDialog(item.id, {
        instanceId: item.instanceId,
        openOptions: {
          availableTags: [],
          defaultTags: listSummary?.defaultTags ?? [],
          customFields: listSummary?.customFields ?? [],
        },
      });
    });
    actionsEl.appendChild(addBtn);
  },
});
```

### 3. Add CSS styling

```css
.collection-search-dropdown .collection-search-dropdown-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.collection-search-dropdown .collection-search-dropdown-item-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collection-search-dropdown-item-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
}

.collection-search-dropdown-item-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 0.25rem;
  color: var(--color-text-muted);
  cursor: pointer;
}

.collection-search-dropdown-item-add:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.collection-search-dropdown-item-add .icon {
  width: 14px;
  height: 14px;
}
```

## Files to Update

- `packages/web-client/src/controllers/collectionDropdownListRenderer.ts` — Add `renderItemActions` option
- `packages/plugins/official/lists/web/index.ts` — Implement quick-add button using the new callback
- `packages/plugins/official/lists/web/styles.css` — Add styling for actions and + button

## Open Questions

None. (Decisions: always show + on all platforms; no keyboard focus/activation for +.)
