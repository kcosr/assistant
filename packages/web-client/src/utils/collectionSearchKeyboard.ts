import type { CollectionDropdownItemFocusController } from '../controllers/collectionDropdownItemFocusController';
import type { CollectionTagFilterController } from '../controllers/collectionTagFilterController';

export interface CollectionSearchKeyboardOptions {
  event: KeyboardEvent;
  searchInput: HTMLInputElement;
  tagController: CollectionTagFilterController;
  itemFocusController: CollectionDropdownItemFocusController;
  tagsContainer: HTMLElement | null;
  allowItemNavigation?: boolean;
  moveFocus: (delta: number) => void;
  selectItem: (itemEl: HTMLElement) => void;
  filter: (query: string) => void;
  onClose: () => void;
}

export function handleCollectionSearchKeyDown(options: CollectionSearchKeyboardOptions): void {
  const {
    event,
    searchInput,
    tagController,
    itemFocusController,
    tagsContainer,
    allowItemNavigation = true,
    moveFocus,
    selectItem,
    filter,
    onClose,
  } = options;

  const key = event.key.toLowerCase();

  const activeFilters = tagController.getActiveFiltersInOrder();

  if (tagController.isSuggestionsMode) {
    const tagSuggestions = tagController.getVisibleTagSuggestions();

    if (key === 'arrowdown' || key === 'arrowup') {
      event.preventDefault();
      event.stopPropagation();

      if (key === 'arrowdown') {
        if (tagController.focusIndex < tagSuggestions.length - 1) {
          tagController.setFocusedTagSuggestion(tagController.focusIndex + 1);
        } else {
          tagController.setFocusedTagSuggestion(-1);
          tagController.setSuggestionsMode(false);
          const items = itemFocusController.getVisibleItems();
          if (items.length > 0) {
            itemFocusController.setFocusedItem(items[0] ?? null);
          }
        }
      } else {
        if (tagController.focusIndex > 0) {
          tagController.setFocusedTagSuggestion(tagController.focusIndex - 1);
        } else {
          tagController.setFocusedTagSuggestion(-1);
        }
      }
      return;
    }

    if (key === 'enter' && tagController.focusIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      const selectedTag = tagSuggestions[tagController.focusIndex]?.dataset['tag'];
      if (selectedTag) {
        tagController.addTagFilterFromSuggestion(selectedTag);
      }
      return;
    }

    if (key === 'tab' && tagSuggestions.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      const targetIndex = tagController.focusIndex >= 0 ? tagController.focusIndex : 0;
      const selectedTag = tagSuggestions[targetIndex]?.dataset['tag'];
      if (selectedTag) {
        tagController.addTagFilterFromSuggestion(selectedTag);
      }
      return;
    }
  }

  if (key === 'arrowdown') {
    if (!allowItemNavigation) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (tagsContainer?.classList.contains('visible')) {
      const tagSuggestions = tagController.getVisibleTagSuggestions();
      if (tagSuggestions.length > 0) {
        tagController.setSuggestionsMode(true);
        tagController.setFocusedTagSuggestion(0);
        return;
      }
    }
    moveFocus(1);
  } else if (key === 'arrowup') {
    if (!allowItemNavigation) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    moveFocus(-1);
  } else if (key === 'enter') {
    event.preventDefault();
    event.stopPropagation();

    const tagSuggestions = tagController.getVisibleTagSuggestions();
    if (tagSuggestions.length === 1 && tagSuggestions[0]) {
      const singleTag = tagSuggestions[0].dataset['tag'];
      if (singleTag) {
        tagController.addTagFilterFromSuggestion(singleTag);
        return;
      }
    }

    const focused = itemFocusController.getFocusedItem();
    if (focused) {
      selectItem(focused);
    } else {
      const items = itemFocusController.getVisibleItems();
      if (items.length === 1 && items[0]) {
        selectItem(items[0]);
      } else if (items.length > 1) {
        itemFocusController.setFocusedItem(items[0] ?? null);
      }
    }
  } else if (key === 'escape') {
    event.preventDefault();
    event.stopPropagation();
    if (activeFilters.length > 0) {
      tagController.clearAllTagFilters();
      filter(searchInput.value);
    } else if (searchInput.value.trim().length > 0) {
      searchInput.value = '';
      filter('');
    } else {
      onClose();
    }
  } else if (key === 'tab') {
    onClose();
  } else if (key === 'backspace') {
    const cursorPos = searchInput.selectionStart ?? 0;
    if (cursorPos === 0 && activeFilters.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      tagController.removeLastTagFilter();
    }
  }
}
