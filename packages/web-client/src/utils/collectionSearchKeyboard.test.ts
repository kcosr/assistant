// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { handleCollectionSearchKeyDown } from './collectionSearchKeyboard';
import type { CollectionDropdownItemFocusController } from '../controllers/collectionDropdownItemFocusController';
import type { CollectionTagFilterController } from '../controllers/collectionTagFilterController';

describe('handleCollectionSearchKeyDown', () => {
  it('does not move focus on arrow keys when item navigation is disabled', () => {
    const searchInput = document.createElement('input');

    const tagController = {
      isSuggestionsMode: false,
      getVisibleTagSuggestions: () => [],
      focusIndex: -1,
      setFocusedTagSuggestion: vi.fn(),
      setSuggestionsMode: vi.fn(),
      addTagFilterFromSuggestion: vi.fn(),
      getActiveFiltersInOrder: () => [],
      clearAllTagFilters: vi.fn(),
      getActiveTagFilters: () => [],
      getActiveExcludedTagFilters: () => [],
      removeLastTagFilter: vi.fn(),
    } as unknown as CollectionTagFilterController;

    const itemFocusController = {
      getVisibleItems: () => [],
      getFocusedItem: () => null,
      setFocusedItem: vi.fn(),
    } as unknown as CollectionDropdownItemFocusController;

    const moveFocus = vi.fn();
    const selectItem = vi.fn();
    const filter = vi.fn();
    const onClose = vi.fn();

    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });

    handleCollectionSearchKeyDown({
      event,
      searchInput,
      tagController,
      itemFocusController,
      tagsContainer: null,
      allowItemNavigation: false,
      moveFocus,
      selectItem,
      filter,
      onClose,
    });

    expect(moveFocus).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
