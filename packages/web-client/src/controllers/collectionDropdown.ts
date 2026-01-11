import type { CollectionItemSummary, CollectionReference } from './collectionTypes';
import { CollectionTagFilterController } from './collectionTagFilterController';
import { CollectionDropdownItemFocusController } from './collectionDropdownItemFocusController';
import {
  renderCollectionDropdownList,
  type CollectionDropdownGroupMeta,
} from './collectionDropdownListRenderer';
import { CollectionDropdownFilterController } from './collectionDropdownFilterController';
import { handleCollectionSearchKeyDown } from '../utils/collectionSearchKeyboard';

export type CollectionDropdownSortMode = 'alpha' | 'updated';

export interface CollectionDropdownControllerOptions {
  container: HTMLElement | null;
  dropdown: HTMLElement | null;
  trigger: HTMLButtonElement | null;
  triggerText: HTMLElement | null;
  searchInput: HTMLInputElement | null;
  list: HTMLElement | null;
  tagsContainer: HTMLElement | null;
  activeTagsContainer: HTMLElement | null;
  focusInput: () => void;
  isDialogOpen: () => boolean;
  isPanelOpen: () => boolean;
  isMobileViewport: () => boolean;
  setPanelOpen: (open: boolean) => void;
  getAllTags: () => string[];
  getGroupLabel: (type: string) => string;
  getSupportedTypes: () => string[] | null;
  getSortMode: () => CollectionDropdownSortMode;
  getActiveItemReference: () => CollectionReference | null;
  updateSelection: (reference: CollectionReference | null) => void;
  selectItem: (item: CollectionReference | null) => Promise<void> | void;
}

export class CollectionDropdownController {
  private dropdownGroupsMeta: CollectionDropdownGroupMeta[] = [];
  private isDropdownOpen = false;
  private readonly tagController: CollectionTagFilterController;
  private readonly itemFocusController: CollectionDropdownItemFocusController;
  private readonly filterController: CollectionDropdownFilterController;
  private totalAvailableItemCount = 0;

  constructor(private readonly options: CollectionDropdownControllerOptions) {
    this.tagController = new CollectionTagFilterController({
      tagsContainer: options.tagsContainer,
      activeTagsContainer: options.activeTagsContainer,
      searchInput: options.searchInput,
      getAllTags: options.getAllTags,
      onFiltersUpdated: (query) => this.filter(query),
    });

    this.itemFocusController = new CollectionDropdownItemFocusController({
      getList: () => this.options.list,
    });

    this.filterController = new CollectionDropdownFilterController({
      getGroupsMeta: () => this.dropdownGroupsMeta,
      getListEl: () => this.options.list,
      getTotalAvailableItemCount: () => this.totalAvailableItemCount,
      tagController: this.tagController,
      itemFocusController: this.itemFocusController,
    });
  }

  attach(): void {
    const { trigger, searchInput } = this.options;

    if (trigger) {
      trigger.addEventListener('click', () => {
        if (this.isDropdownOpen) {
          this.close();
        } else {
          this.open();
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        this.filter(searchInput.value);
      });

      searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
        this.handleSearchKeyDown(e);
      });
    }

    document.addEventListener('click', (e) => {
      if (!this.isDropdownOpen) return;
      const { container } = this.options;
      if (!container) return;

      const target = e.target as Node;
      if (!container.contains(target)) {
        this.close(false);
      }
    });
  }

  open(): void {
    const { container, dropdown, searchInput, trigger } = this.options;
    if (!container || !dropdown || !searchInput) {
      return;
    }
    if (this.isDropdownOpen) {
      return;
    }

    if (!this.options.isPanelOpen()) {
      this.options.setPanelOpen(true);
    }

    this.isDropdownOpen = true;
    container.classList.add('open');
    trigger?.setAttribute('aria-expanded', 'true');

    searchInput.value = '';
    this.tagController.reset();
    this.filter('');

    // Don't auto-focus search input on mobile - it triggers the keyboard
    if (!this.options.isMobileViewport()) {
      setTimeout(() => {
        searchInput.focus();
      }, 0);
    }
  }

  close(restoreFocusToInput: boolean = true): void {
    const { container, trigger } = this.options;
    if (!container) {
      return;
    }
    if (!this.isDropdownOpen) {
      return;
    }

    this.isDropdownOpen = false;
    container.classList.remove('open');
    trigger?.setAttribute('aria-expanded', 'false');

    this.tagController.reset();

    // Don't auto-focus input on mobile - it triggers the keyboard
    if (restoreFocusToInput && !this.options.isDialogOpen() && !this.options.isMobileViewport()) {
      this.options.focusInput();
    }
  }

  populate(items: CollectionItemSummary[]): void {
    const { list, triggerText, trigger } = this.options;
    if (!list) {
      return;
    }

    this.totalAvailableItemCount = items.length;

    const supportedTypes = this.options.getSupportedTypes();
    const filteredItems = supportedTypes
      ? items.filter((item) => supportedTypes.includes(item.type))
      : items;

    // Sort items to match the browser order
    const sortMode = this.options.getSortMode();
    const sortedItems = this.sortItems(filteredItems, sortMode);

    const activeItem = this.options.getActiveItemReference();
    if (sortedItems.length === 0) {
      if (triggerText) {
        triggerText.textContent = 'No items available';
      }
    } else if (!activeItem && triggerText) {
      triggerText.textContent = 'Select an item…';
    }

    this.dropdownGroupsMeta = renderCollectionDropdownList({
      listEl: list,
      items: sortedItems,
      getGroupLabel: this.options.getGroupLabel,
      onSelectItem: (itemEl) => {
        this.selectDropdownItem(itemEl);
      },
    });

    this.options.updateSelection(activeItem);

    if (trigger) {
      trigger.disabled = sortedItems.length === 0;
    }
  }

  private sortItems(
    items: CollectionItemSummary[],
    sortMode: CollectionDropdownSortMode,
  ): CollectionItemSummary[] {
    // Build group label index that mirrors the browser ordering logic.
    const groupOrderLabels: string[] = [];
    const supportedTypes = this.options.getSupportedTypes();
    if (supportedTypes) {
      for (const type of supportedTypes) {
        const label = this.options.getGroupLabel(type).toLowerCase();
        if (!groupOrderLabels.includes(label)) {
          groupOrderLabels.push(label);
        }
      }
    }
    for (const item of items) {
      const label = this.options.getGroupLabel(item.type).toLowerCase();
      if (!groupOrderLabels.includes(label)) {
        groupOrderLabels.push(label);
      }
    }
    const labelIndex = new Map(groupOrderLabels.map((label, i) => [label, i]));

    return [...items].sort((a, b) => {
      // First sort by type group
      const labelA = this.options.getGroupLabel(a.type).toLowerCase();
      const labelB = this.options.getGroupLabel(b.type).toLowerCase();
      const idxA = labelIndex.get(labelA) ?? Number.POSITIVE_INFINITY;
      const idxB = labelIndex.get(labelB) ?? Number.POSITIVE_INFINITY;
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      // Then sort within group by selected mode
      if (sortMode === 'updated') {
        const timeA = this.parseUpdatedAtMs(a.updatedAt);
        const timeB = this.parseUpdatedAtMs(b.updatedAt);
        if (timeA !== timeB) {
          return timeB - timeA;
        }
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  }

  private parseUpdatedAtMs(updatedAt: string | undefined): number {
    if (!updatedAt) return 0;
    const ms = Date.parse(updatedAt);
    return Number.isNaN(ms) ? 0 : ms;
  }

  refreshFilter(): void {
    const query = this.options.searchInput?.value ?? '';
    this.filterController.filter(query);
  }

  private filter(query: string): void {
    this.filterController.filter(query);
  }

  private moveDropdownFocus(delta: number): void {
    const items = this.itemFocusController.getVisibleItems();
    if (items.length === 0) {
      this.options.searchInput?.focus();
      return;
    }

    const focused = this.itemFocusController.getFocusedItem();
    let idx = focused ? items.indexOf(focused) : -1;

    if (delta < 0 && idx <= 0) {
      this.itemFocusController.setFocusedItem(null);
      if (this.options.tagsContainer?.classList.contains('visible')) {
        const tagSuggestions = this.tagController.getVisibleTagSuggestions();
        if (tagSuggestions.length > 0) {
          this.tagController.setSuggestionsMode(true);
          this.tagController.setFocusedTagSuggestion(tagSuggestions.length - 1);
          return;
        }
      }
      this.options.searchInput?.focus();
      return;
    }

    if (delta > 0 && idx >= items.length - 1) {
      return;
    }

    if (idx < 0) idx = delta > 0 ? -1 : 0;
    const next = idx + delta;

    const nextItem = items[next];
    if (nextItem) {
      this.itemFocusController.setFocusedItem(nextItem);
    }
  }

  private selectDropdownItem(item: HTMLElement): void {
    const itemType = item.dataset['collectionType'];
    const itemId = item.dataset['collectionId'];
    if (!itemType || !itemId) {
      return;
    }
    this.close(false);
    void this.options.selectItem({
      type: itemType,
      id: itemId,
    });
  }

  private handleSearchKeyDown(e: KeyboardEvent): void {
    const { searchInput } = this.options;
    if (!searchInput) return;

    handleCollectionSearchKeyDown({
      event: e,
      searchInput,
      tagController: this.tagController,
      itemFocusController: this.itemFocusController,
      tagsContainer: this.options.tagsContainer,
      moveFocus: (delta) => this.moveDropdownFocus(delta),
      selectItem: (itemEl) => this.selectDropdownItem(itemEl),
      filter: (query) => this.filter(query),
      onClose: () => this.close(),
    });
  }
}
