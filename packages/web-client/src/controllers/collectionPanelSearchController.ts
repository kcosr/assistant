import type { ViewQuery } from '@assistant/shared';
import { CollectionTagFilterController } from './collectionTagFilterController';

export interface CollectionPanelSearchControllerOptions {
  containerEl: HTMLElement | null;
  icons: {
    x: string;
  };
}

export class CollectionPanelSearchController {
  private rootEl: HTMLElement | null = null;
  private leftControlsContainer: HTMLElement | null = null;
  private rightControlsContainer: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private searchClearButton: HTMLButtonElement | null = null;
  private searchActiveTagsContainer: HTMLElement | null = null;
  private searchTagsContainer: HTMLElement | null = null;
  private statusMessageEl: HTMLElement | null = null;
  private tagController: CollectionTagFilterController | null = null;
  private escapeClearsFirst = true;
  private restoringState = false;
  private tagsEnabled = true;

  private onQueryChanged: ((query: string) => void) | null = null;
  private getAllTags: () => string[] = () => [];
  private keydownHandler: ((event: KeyboardEvent) => boolean) | null = null;

  constructor(private readonly options: CollectionPanelSearchControllerOptions) {
    this.ensureUi();
    this.attachListeners();
  }

  setOnQueryChanged(handler: ((query: string) => void) | null): void {
    this.onQueryChanged = handler;
    if (handler) {
      handler(this.getQuery());
    }
  }

  setLeftControls(elements: HTMLElement[] | null): void {
    this.ensureUi();
    const container = this.leftControlsContainer;
    if (!container) {
      return;
    }

    container.innerHTML = '';
    if (!elements || elements.length === 0) {
      return;
    }

    for (const el of elements) {
      container.appendChild(el);
    }
  }

  setRightControls(elements: HTMLElement[] | null): void {
    this.ensureUi();
    const container = this.rightControlsContainer;
    if (!container) {
      return;
    }

    container.innerHTML = '';
    if (!elements || elements.length === 0) {
      return;
    }

    for (const el of elements) {
      container.appendChild(el);
    }
  }

  clearControls(): void {
    this.setLeftControls(null);
    this.setRightControls(null);
  }

  setTagsProvider(getAllTags: () => string[]): void {
    this.getAllTags = getAllTags;
    this.refreshTagSuggestions();
  }

  setTagFilteringEnabled(enabled: boolean): void {
    this.tagsEnabled = enabled;
    const tagController = this.tagController;
    if (!tagController) {
      return;
    }
    if (!enabled) {
      tagController.clearAllTagFilters();
      tagController.updateTagSuggestions(null, false);
    } else {
      this.refreshTagSuggestions();
    }
    this.updateClearButtonVisibility();
  }

  setStatusMessage(message: string | null, kind: 'error' | 'info' = 'info'): void {
    const el = this.statusMessageEl;
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.classList.remove('visible');
      el.classList.remove('error');
      return;
    }
    el.textContent = message;
    el.classList.add('visible');
    el.classList.toggle('error', kind === 'error');
  }

  setKeydownHandler(handler: ((event: KeyboardEvent) => boolean) | null): void {
    this.keydownHandler = handler;
  }

  setPlaceholder(placeholder: string): void {
    if (this.searchInput) {
      this.searchInput.placeholder = placeholder;
    }
  }

  setVisible(visible: boolean): void {
    if (!this.rootEl) return;
    this.rootEl.style.display = visible ? '' : 'none';
  }

  focus(select: boolean = true): boolean {
    if (!this.searchInput) return false;
    this.searchInput.focus();
    if (select) {
      this.searchInput.select();
    }
    return true;
  }

  clear(): void {
    const searchInput = this.searchInput;
    const tagController = this.tagController;
    if (!searchInput || !tagController) return;
    searchInput.value = '';
    tagController.clearAllTagFilters();
    tagController.updateTagSuggestions(null, false);
    this.escapeClearsFirst = true;
    this.applyQueryChange();
  }

  getQuery(): string {
    return this.searchInput?.value ?? '';
  }

  getSearchInputEl(): HTMLInputElement | null {
    return this.searchInput;
  }

  getRootEl(): HTMLElement | null {
    return this.rootEl;
  }

  getTagsContainerEl(): HTMLElement | null {
    return this.searchTagsContainer;
  }

  getTagController(): CollectionTagFilterController | null {
    return this.tagController;
  }

  /**
   * Sync the shared search UI (text input + tag filters) from a stored
   * view query without triggering a new state update. This is
   * used when entering view mode so the search bar reflects the current
   * view filters instead of clearing them.
   */
  syncFromViewQuery(query: ViewQuery | undefined): void {
    this.ensureUi();
    const searchInput = this.searchInput;
    const tagController = this.tagController;
    if (!searchInput || !tagController) {
      return;
    }

    this.restoringState = true;

    // Reset existing filters and suggestions.
    tagController.clearAllTagFilters();
    tagController.updateTagSuggestions(null, false);

    const includeTags = Array.isArray(query?.tags?.include)
      ? (query!.tags!.include as string[])
      : [];
    const excludeTags = Array.isArray(query?.tags?.exclude)
      ? (query!.tags!.exclude as string[])
      : [];

    for (const tag of includeTags) {
      if (typeof tag === 'string' && tag.trim().length > 0) {
        tagController.addTagFilter(tag.trim(), 'include');
      }
    }

    for (const tag of excludeTags) {
      if (typeof tag === 'string' && tag.trim().length > 0) {
        tagController.addTagFilter(tag.trim(), 'exclude');
      }
    }

    if (typeof query?.query === 'string') {
      searchInput.value = query.query;
    } else {
      searchInput.value = '';
    }

    this.restoringState = false;
    this.updateClearButtonVisibility();
    this.refreshTagSuggestions();
  }

  private ensureUi(): void {
    if (this.rootEl) {
      return;
    }
    const container = this.options.containerEl;
    if (!container) {
      return;
    }

    const root = document.createElement('div');
    root.className = 'collection-list-search-container';

    const row = document.createElement('div');
    row.className = 'collection-panel-search-row';

    const leftControls = document.createElement('div');
    leftControls.className = 'collection-search-row-left';

    const center = document.createElement('div');
    center.className = 'collection-search-row-center';

    const rightControls = document.createElement('div');
    rightControls.className = 'collection-search-row-right';

    const searchStack = document.createElement('div');
    searchStack.className = 'collection-list-search-stack';

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'collection-list-search';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'collection-list-search-input';
    searchInput.placeholder = 'Search…';
    searchInput.autocomplete = 'off';
    searchInput.setAttribute('aria-label', 'Search');
    searchWrapper.appendChild(searchInput);

    const searchClearButton = document.createElement('button');
    searchClearButton.type = 'button';
    searchClearButton.className = 'collection-list-search-clear';
    searchClearButton.setAttribute('aria-label', 'Clear search');
    searchClearButton.innerHTML = this.options.icons.x;
    searchWrapper.appendChild(searchClearButton);

    const searchActiveTagsContainer = document.createElement('div');
    searchActiveTagsContainer.className = 'collection-search-dropdown-active-tags';

    const searchTagsContainer = document.createElement('div');
    searchTagsContainer.className = 'collection-search-dropdown-tags';

    const statusMessage = document.createElement('div');
    statusMessage.className = 'collection-list-search-status';

    searchStack.appendChild(searchWrapper);
    searchStack.appendChild(searchActiveTagsContainer);
    searchStack.appendChild(searchTagsContainer);
    searchStack.appendChild(statusMessage);

    center.appendChild(searchStack);
    row.appendChild(leftControls);
    row.appendChild(center);
    row.appendChild(rightControls);
    root.appendChild(row);

    container.innerHTML = '';
    container.appendChild(root);

    this.rootEl = root;
    this.leftControlsContainer = leftControls;
    this.rightControlsContainer = rightControls;
    this.searchInput = searchInput;
    this.searchClearButton = searchClearButton;
    this.searchActiveTagsContainer = searchActiveTagsContainer;
    this.searchTagsContainer = searchTagsContainer;
    this.statusMessageEl = statusMessage;

    const tagController = new CollectionTagFilterController({
      tagsContainer: searchTagsContainer,
      activeTagsContainer: searchActiveTagsContainer,
      searchInput,
      getAllTags: () => this.getAllTagsLower(),
      onFiltersUpdated: () => {
        this.escapeClearsFirst = true;
        this.applyQueryChange();
      },
    });
    this.tagController = tagController;
  }

  private attachListeners(): void {
    const searchInput = this.searchInput;
    const searchClearButton = this.searchClearButton;
    const tagController = this.tagController;
    if (!searchInput || !searchClearButton || !tagController) {
      return;
    }

    searchInput.addEventListener('input', () => {
      this.escapeClearsFirst = true;
      this.applyQueryChange();
    });

    searchInput.addEventListener('focus', () => {
      this.escapeClearsFirst = true;
    });

    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.keydownHandler?.(e)) {
        return;
      }

    if (this.tagsEnabled && tagController.isSuggestionsMode) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const suggestions = tagController.getVisibleTagSuggestions();
          if (suggestions.length === 0) {
            return;
          }
          const direction = e.key === 'ArrowDown' ? 1 : -1;
          const currentIndex = tagController.focusIndex;
          const nextIndex =
            currentIndex === -1
              ? direction === 1
                ? 0
                : suggestions.length - 1
              : (currentIndex + direction + suggestions.length) % suggestions.length;
          tagController.setFocusedTagSuggestion(nextIndex);
          return;
        }

        if (e.key === 'Enter' || e.key === 'Tab') {
          const suggestions = tagController.getVisibleTagSuggestions();
          if (suggestions.length > 0) {
            e.preventDefault();
            const index = tagController.focusIndex >= 0 ? tagController.focusIndex : 0;
            const el = suggestions[index];
            const tag = el?.dataset['tag'];
            if (tag) {
              tagController.addTagFilterFromSuggestion(tag);
            }
            return;
          }
        }
      }

    if (this.tagsEnabled && e.key === 'Backspace') {
        const cursorPos = searchInput.selectionStart ?? 0;
        if (cursorPos === 0 && tagController.getActiveFiltersInOrder().length > 0) {
          e.preventDefault();
          e.stopPropagation();
          tagController.removeLastTagFilter();
          this.applyQueryChange();
          return;
        }
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();

    const hasFilters =
      searchInput.value.trim().length > 0 ||
      (this.tagsEnabled &&
        (tagController.getActiveTagFilters().length > 0 ||
          tagController.getActiveExcludedTagFilters().length > 0));

        if (hasFilters && this.escapeClearsFirst) {
          searchInput.value = '';
    if (this.tagsEnabled) {
      tagController.clearAllTagFilters();
      tagController.updateTagSuggestions(null, false);
    }
          this.escapeClearsFirst = false;
          this.applyQueryChange();
        } else {
          this.escapeClearsFirst = true;
          searchInput.blur();
        }
      }
    });

    searchClearButton.addEventListener('click', (e) => {
      e.preventDefault();
      searchInput.value = '';
      tagController.clearAllTagFilters();
      tagController.updateTagSuggestions(null, false);
      this.escapeClearsFirst = true;
      this.applyQueryChange();
      searchInput.focus();
    });

    this.applyQueryChange();
  }

  private getAllTagsLower(): string[] {
    const unique = new Set<string>();
    for (const rawTag of this.getAllTags()) {
      if (typeof rawTag !== 'string') continue;
      const tag = rawTag.trim().toLowerCase();
      if (!tag) continue;
      unique.add(tag);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }

  private updateClearButtonVisibility(): void {
    const searchInput = this.searchInput;
    const searchClearButton = this.searchClearButton;
    const tagController = this.tagController;
    if (!searchInput || !searchClearButton || !tagController) return;

    if (
      searchInput.value.trim().length > 0 ||
      (this.tagsEnabled &&
        (tagController.getActiveTagFilters().length > 0 ||
          tagController.getActiveExcludedTagFilters().length > 0))
    ) {
      searchClearButton.classList.add('visible');
    } else {
      searchClearButton.classList.remove('visible');
    }
  }

  private refreshTagSuggestions(): void {
    const tagController = this.tagController;
    const searchInput = this.searchInput;
    if (!tagController || !searchInput || !this.tagsEnabled) return;

    const parsed = tagController.parseSearchQuery(searchInput.value);
    tagController.updateTagSuggestions(parsed.partialTag, parsed.partialTagIsExcluded);
  }

  private applyQueryChange(): void {
    this.updateClearButtonVisibility();
    if (this.tagsEnabled) {
      this.refreshTagSuggestions();
    }
    if (!this.restoringState) {
      this.onQueryChanged?.(this.getQuery());
    }
  }
}
