import type { CollectionItemSummary, CollectionReference } from './collectionTypes';
import { CollectionTagFilterController } from './collectionTagFilterController';
import { CollectionDropdownItemFocusController } from './collectionDropdownItemFocusController';
import {
  renderCollectionDropdownList,
  type CollectionDropdownGroupMeta,
} from './collectionDropdownListRenderer';
import { CollectionDropdownFilterController } from './collectionDropdownFilterController';
import { handleCollectionSearchKeyDown } from '../utils/collectionSearchKeyboard';
import { applyMarkdownToElement } from '../utils/markdown';
import { applyTagColorToElement, normalizeTag } from '../utils/tagColors';
import { hasPinnedTag, isPinnedTag } from '../utils/pinnedTag';
import type { DialogManager } from './dialogManager';
import {
  ListMetadataDialog,
  type ListMetadataDialogInitialData,
  type ListMetadataDialogInstanceSelection,
  type ListMetadataDialogPayload,
} from './listMetadataDialog';
import type { ListCustomFieldDefinition } from './listCustomFields';

export type CollectionBrowserViewMode = 'cards' | 'cards_single' | 'list';
export type CollectionBrowserSortMode = 'alpha' | 'updated';

export interface CollectionBrowserControllerOptions {
  containerEl: HTMLElement | null;
  getAvailableItems: () => CollectionItemSummary[];
  getSupportedTypes: () => string[] | null;
  getAllTags: () => string[];
  getGroupLabel: (type: string) => string;
  getActiveItemReference: () => CollectionReference | null;
  selectItem: (item: CollectionReference | null) => Promise<void> | void;
  refreshItems: () => Promise<void>;
  dialogManager: DialogManager;
  icons: {
    plus: string;
    edit: string;
    chevronDown: string;
    clock: string;
    sortAlpha: string;
    fileText: string;
    list: string;
    pin: string;
  };
  onTogglePinned?: (item: CollectionReference, isPinned: boolean) => void;
  fetchPreview?: (
    itemType: 'note' | 'list',
    itemId: string,
    instanceId?: string,
  ) => Promise<CollectionPreviewCacheEntry | null>;
  listApi?: {
    getList?: (
      listId: string,
      instanceId?: string,
    ) => Promise<ListMetadataDialogInitialData | null>;
    createList?: (payload: ListMetadataDialogPayload) => Promise<string | null>;
    updateList?: (listId: string, payload: ListMetadataDialogPayload) => Promise<boolean>;
    deleteList?: (listId: string) => Promise<boolean>;
  };
  viewModeStorageKey: string;
  sortModeStorageKey: string;
  openNoteEditor: (mode: 'create' | 'edit', noteId?: string, instanceId?: string) => void;
  onSortModeChanged?: (mode: CollectionBrowserSortMode) => void;
  shouldShowInstanceBadge?: () => boolean;
  getListInstanceSelection?: () => ListMetadataDialogInstanceSelection | null;
}

export class CollectionBrowserController {
  private rootEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private tagsContainer: HTMLElement | null = null;
  private activeTagsContainer: HTMLElement | null = null;
  private viewToggleContainer: HTMLDivElement | null = null;
  private sortToggleContainer: HTMLDivElement | null = null;
  private createActionsContainer: HTMLDivElement | null = null;
  private viewToggleCardsBtn: HTMLButtonElement | null = null;
  private viewToggleSingleCardsBtn: HTMLButtonElement | null = null;
  private viewToggleListBtn: HTMLButtonElement | null = null;
  private sortToggleAlphaBtn: HTMLButtonElement | null = null;
  private sortToggleUpdatedBtn: HTMLButtonElement | null = null;
  private newNoteBtn: HTMLButtonElement | null = null;
  private createListBtn: HTMLButtonElement | null = null;
  private addMenuEl: HTMLElement | null = null;
  private addBtnEl: HTMLButtonElement | null = null;
  private listMetadataDialog: ListMetadataDialog | null = null;

  private groupsMeta: CollectionDropdownGroupMeta[] = [];
  private totalAvailableItemCount = 0;
  private viewMode: CollectionBrowserViewMode = 'cards';
  private sortMode: CollectionBrowserSortMode = 'alpha';

  private readonly previewCache = new Map<string, CollectionPreviewCacheEntry | null>();
  private readonly previewRequests = new Map<string, Promise<CollectionPreviewCacheEntry | null>>();
  private lastFilterQuery = '';
  private refilterScheduled = false;

  private tagController: CollectionTagFilterController | null = null;
  private itemFocusController: CollectionDropdownItemFocusController | null = null;
  private filterController: CollectionDropdownFilterController | null = null;

  constructor(private readonly options: CollectionBrowserControllerOptions) {
    const stored = this.readStoredViewMode();
    if (stored) {
      this.viewMode = stored;
    }
    const storedSort = this.readStoredSortMode();
    if (storedSort) {
      this.sortMode = storedSort;
    }
  }

  show(focusSearch: boolean = true): void {
    const container = this.options.containerEl;
    if (!container) {
      return;
    }
    this.ensureUi();
    if (!this.rootEl) {
      return;
    }
    container.innerHTML = '';
    container.appendChild(this.rootEl);

    this.applyViewMode();
    this.refresh();

    if (focusSearch) {
      setTimeout(() => {
        this.searchInput?.focus();
      }, 0);
    }
  }

  hide(): void {
    if (this.rootEl?.parentElement) {
      this.rootEl.parentElement.removeChild(this.rootEl);
    }
  }

  invalidatePreview(reference: CollectionReference): void {
    const itemType = reference.type.toLowerCase().trim();
    if (itemType !== 'note' && itemType !== 'list') {
      return;
    }
    const key = this.getPreviewKey(itemType, reference.id, reference.instanceId);
    this.previewCache.delete(key);

    const listEl = this.listEl;
    if (!listEl) {
      return;
    }

    const items = listEl.querySelectorAll<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-type][data-collection-id]',
    );
    for (const itemEl of Array.from(items)) {
      const type = itemEl.dataset['collectionType']?.toLowerCase().trim();
      const id = itemEl.dataset['collectionId'];
      if (type !== itemType || id !== reference.id) {
        continue;
      }

      const previewEl = itemEl.querySelector<HTMLElement>('.collection-browser-item-preview');
      if (previewEl) {
        delete previewEl.dataset['previewLoaded'];
      }
      const base = itemEl.dataset['searchTextBase'] || '';
      itemEl.dataset['searchText'] = base;

      if (previewEl && (this.viewMode === 'cards' || this.viewMode === 'cards_single')) {
        void this.populatePreviewForElement({
          itemType,
          itemId: reference.id,
          itemEl,
          previewEl,
        });
      }
    }
  }

  refresh(): void {
    if (!this.rootEl) {
      return;
    }
    this.updateCreateButtonVisibility();
    this.populate(this.options.getAvailableItems());
    this.applySearchQuery(this.searchInput?.value ?? '');
  }

  resetFilters(): void {
    this.tagController?.reset();
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    this.applySearchQuery('');
  }

  setSharedSearchElements(args: {
    searchInput: HTMLInputElement | null;
    tagController: CollectionTagFilterController | null;
    tagsContainer: HTMLElement | null;
    activeTagsContainer: HTMLElement | null;
  }): void {
    this.searchInput = args.searchInput;
    this.tagController = args.tagController;
    this.tagsContainer = args.tagsContainer;
    this.activeTagsContainer = args.activeTagsContainer;
    this.ensureSearchControllers();
  }

  private ensureSearchControllers(): void {
    if (!this.listEl) {
      return;
    }

    if (!this.itemFocusController) {
      this.itemFocusController = new CollectionDropdownItemFocusController({
        getList: () => this.listEl,
      });
    }

    if (this.tagController) {
      this.filterController = new CollectionDropdownFilterController({
        getGroupsMeta: () => this.groupsMeta,
        getListEl: () => this.listEl,
        getTotalAvailableItemCount: () => this.totalAvailableItemCount,
        tagController: this.tagController,
        itemFocusController: this.itemFocusController,
      });
    } else {
      this.filterController = null;
    }
  }

  applySearchQuery(query: string): void {
    this.filter(query);
  }

  getAllKnownTags(): string[] {
    const tags = new Set<string>();
    for (const raw of this.options.getAllTags()) {
      if (typeof raw !== 'string') continue;
      const t = raw.trim().toLowerCase();
      if (!t || isPinnedTag(t)) continue;
      tags.add(t);
    }

    const listEl = this.listEl;
    if (listEl) {
      const items = listEl.querySelectorAll<HTMLElement>(
        '.collection-search-dropdown-item[data-collection-type][data-collection-id]',
      );
      for (const itemEl of Array.from(items)) {
        const datasetTags = (itemEl.dataset['tags'] ?? '').split(',');
        for (const rawTag of datasetTags) {
          const t = rawTag.trim().toLowerCase();
          if (!t || isPinnedTag(t)) continue;
          tags.add(t);
        }
      }
    }

    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }

  private ensureUi(): void {
    if (this.rootEl) {
      return;
    }

    const root = document.createElement('div');
    root.className = 'collection-browser';

    const header = document.createElement('div');
    header.className = 'collection-browser-header';

    const searchRow = document.createElement('div');
    searchRow.className = 'collection-browser-search-row';

    // LEFT: View toggle (Cards/Stack/List)
    const viewToggle = document.createElement('div');
    viewToggle.className = 'collection-browser-view-toggle';

    const cardsBtn = document.createElement('button');
    cardsBtn.type = 'button';
    cardsBtn.className = 'collection-browser-view-button';
    cardsBtn.textContent = 'Cards';
    cardsBtn.setAttribute('aria-label', 'Card view (grid)');

    const singleCardsBtn = document.createElement('button');
    singleCardsBtn.type = 'button';
    singleCardsBtn.className = 'collection-browser-view-button';
    singleCardsBtn.textContent = 'Stack';
    singleCardsBtn.setAttribute('aria-label', 'Card view (single column)');

    const listBtn = document.createElement('button');
    listBtn.type = 'button';
    listBtn.className = 'collection-browser-view-button';
    listBtn.textContent = 'List';
    listBtn.setAttribute('aria-label', 'List view');

    cardsBtn.addEventListener('click', () => this.setViewMode('cards'));
    singleCardsBtn.addEventListener('click', () => this.setViewMode('cards_single'));
    listBtn.addEventListener('click', () => this.setViewMode('list'));

    viewToggle.appendChild(cardsBtn);
    viewToggle.appendChild(singleCardsBtn);
    viewToggle.appendChild(listBtn);

    // RIGHT: Sort toggle (icon buttons) + Add dropdown
    const rightControls = document.createElement('div');
    rightControls.className = 'collection-browser-right-controls';

    const sortToggle = document.createElement('div');
    sortToggle.className = 'collection-browser-view-toggle collection-browser-sort-toggle';

    const alphaBtn = document.createElement('button');
    alphaBtn.type = 'button';
    alphaBtn.className = 'collection-browser-view-button collection-browser-icon-button';
    alphaBtn.innerHTML = this.options.icons.sortAlpha;
    alphaBtn.setAttribute('aria-label', 'Sort alphabetically');
    alphaBtn.setAttribute('title', 'Sort A–Z');

    const updatedBtn = document.createElement('button');
    updatedBtn.type = 'button';
    updatedBtn.className = 'collection-browser-view-button collection-browser-icon-button';
    updatedBtn.innerHTML = this.options.icons.clock;
    updatedBtn.setAttribute('aria-label', 'Sort by last updated');
    updatedBtn.setAttribute('title', 'Sort by updated');

    alphaBtn.addEventListener('click', () => this.setSortMode('alpha'));
    updatedBtn.addEventListener('click', () => this.setSortMode('updated'));

    sortToggle.appendChild(alphaBtn);
    sortToggle.appendChild(updatedBtn);

    // Add button/dropdown - show simple button if only one type is supported
    const createActions = document.createElement('div');
    createActions.className = 'collection-browser-create-actions';

    const supportedTypes = this.options.getSupportedTypes();
    const supportsNotes =
      !supportedTypes || supportedTypes.some((t) => t.toLowerCase().trim() === 'note');
    const supportsLists =
      !supportedTypes || supportedTypes.some((t) => t.toLowerCase().trim() === 'list');

    // If only one type is supported, use a simple button; otherwise use dropdown
    if (supportsNotes && !supportsLists) {
      // Notes only - simple + button
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'collection-browser-add-button collection-browser-add-button--simple';
      addBtn.innerHTML = this.options.icons.plus;
      addBtn.setAttribute('aria-label', 'Create new note');
      addBtn.addEventListener('click', () => {
        this.options.openNoteEditor('create');
      });
      createActions.appendChild(addBtn);
    } else if (supportsLists && !supportsNotes) {
      // Lists only - simple + button
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'collection-browser-add-button collection-browser-add-button--simple';
      addBtn.innerHTML = this.options.icons.plus;
      addBtn.setAttribute('aria-label', 'Create new list');
      addBtn.addEventListener('click', () => {
        this.openCreateListDialog();
      });
      createActions.appendChild(addBtn);
    } else {
      // Both types supported - use dropdown
      const addDropdownWrapper = document.createElement('div');
      addDropdownWrapper.className = 'collection-browser-add-dropdown';

      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'collection-browser-add-button';
      addBtn.innerHTML = `${this.options.icons.plus}${this.options.icons.chevronDown}`;
      addBtn.setAttribute('aria-label', 'Create new item');
      addBtn.setAttribute('aria-haspopup', 'menu');
      addBtn.setAttribute('aria-expanded', 'false');

      const addMenu = document.createElement('div');
      addMenu.className = 'collection-browser-add-menu';

      const addNoteItem = document.createElement('button');
      addNoteItem.type = 'button';
      addNoteItem.className = 'collection-browser-add-menu-item';
      addNoteItem.innerHTML = `${this.options.icons.fileText}<span>Note</span>`;
      addNoteItem.addEventListener('click', () => {
        this.closeAddMenu();
        this.options.openNoteEditor('create');
      });

      const addListItem = document.createElement('button');
      addListItem.type = 'button';
      addListItem.className = 'collection-browser-add-menu-item';
      addListItem.innerHTML = `${this.options.icons.list}<span>List</span>`;
      addListItem.addEventListener('click', () => {
        this.closeAddMenu();
        this.openCreateListDialog();
      });

      addMenu.appendChild(addNoteItem);
      addMenu.appendChild(addListItem);

      addDropdownWrapper.appendChild(addBtn);
      addDropdownWrapper.appendChild(addMenu);
      createActions.appendChild(addDropdownWrapper);

      // Toggle add menu
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = addMenu.classList.contains('open');
        if (isOpen) {
          this.closeAddMenu();
        } else {
          addMenu.classList.add('open');
          addBtn.setAttribute('aria-expanded', 'true');
          // Close on outside click
          const closeHandler = (evt: MouseEvent) => {
            if (!addDropdownWrapper.contains(evt.target as Node)) {
              this.closeAddMenu();
              document.removeEventListener('click', closeHandler);
            }
          };
          document.addEventListener('click', closeHandler);
        }
      });

      this.addMenuEl = addMenu;
      this.addBtnEl = addBtn;
    }

    rightControls.appendChild(sortToggle);
    rightControls.appendChild(createActions);

    // Assemble row: [viewToggle] [spacer for search] [rightControls]
    searchRow.appendChild(viewToggle);
    searchRow.appendChild(rightControls);

    header.appendChild(searchRow);

    const listEl = document.createElement('div');
    listEl.className = 'collection-search-dropdown-list collection-browser-list';

    root.appendChild(header);
    root.appendChild(listEl);

    this.rootEl = root;
    this.listEl = listEl;
    this.viewToggleContainer = viewToggle;
    this.sortToggleContainer = sortToggle;
    this.createActionsContainer = createActions;
    this.viewToggleCardsBtn = cardsBtn;
    this.viewToggleSingleCardsBtn = singleCardsBtn;
    this.viewToggleListBtn = listBtn;
    this.sortToggleAlphaBtn = alphaBtn;
    this.sortToggleUpdatedBtn = updatedBtn;

    this.listMetadataDialog = new ListMetadataDialog({
      dialogManager: this.options.dialogManager,
      getAllKnownTags: () => this.getAllKnownTags(),
      createList: (payload) => this.createList(payload),
      updateList: (listId, payload) => this.updateList(listId, payload),
      deleteList: (listId) => this.deleteList(listId),
      ...(this.options.getListInstanceSelection
        ? { getInstanceSelection: this.options.getListInstanceSelection }
        : {}),
    });

    this.ensureSearchControllers();
  }

  openListMetadataEditor(
    listId: string,
    data: {
      name: string;
      description?: string;
      tags?: string[] | undefined;
      defaultTags?: string[] | undefined;
      customFields?: ListCustomFieldDefinition[] | undefined;
      instanceId?: string | undefined;
    },
  ): void {
    this.ensureUi();
    const dialog = this.listMetadataDialog;
    if (!dialog) {
      return;
    }
    dialog.open('edit', {
      id: listId,
      name: data.name,
      description: data.description ?? '',
      tags: Array.isArray(data.tags) ? data.tags : [],
      defaultTags: Array.isArray(data.defaultTags) ? data.defaultTags : [],
      customFields: Array.isArray(data.customFields) ? data.customFields : [],
      ...(data.instanceId ? { instanceId: data.instanceId } : {}),
    });
  }

  getSharedSearchRightControls(): HTMLElement[] {
    const controls: HTMLElement[] = [];
    if (this.createActionsContainer) {
      controls.push(this.createActionsContainer);
    }
    if (this.sortToggleContainer) {
      controls.push(this.sortToggleContainer);
    }
    if (this.viewToggleContainer) {
      controls.push(this.viewToggleContainer);
    }
    return controls;
  }

  private updateCreateButtonVisibility(): void {
    const supportedTypes = this.options.getSupportedTypes();
    const listsSupported =
      !supportedTypes || supportedTypes.some((t) => t.toLowerCase().trim() === 'list');
    const notesSupported =
      !supportedTypes || supportedTypes.some((t) => t.toLowerCase().trim() === 'note');

    if (this.createListBtn) {
      this.createListBtn.style.display = listsSupported ? '' : 'none';
      this.createListBtn.disabled = false;
    }
    if (this.newNoteBtn) {
      this.newNoteBtn.style.display = notesSupported ? '' : 'none';
      this.newNoteBtn.disabled = false;
    }
  }

  private decorateItemPinned(itemEl: HTMLElement, item: CollectionItemSummary): void {
    if (!hasPinnedTag(item.tags)) {
      return;
    }
    const labelEl = itemEl.querySelector<HTMLElement>('.collection-search-dropdown-item-label');
    if (!labelEl) {
      return;
    }
    let titleRow: HTMLElement | null = null;
    if (
      labelEl.parentElement &&
      labelEl.parentElement.classList.contains('collection-browser-item-title')
    ) {
      titleRow = labelEl.parentElement as HTMLElement;
    } else {
      titleRow = document.createElement('div');
      titleRow.className = 'collection-browser-item-title';
      labelEl.insertAdjacentElement('beforebegin', titleRow);
      titleRow.appendChild(labelEl);
    }
    const pin = document.createElement('span');
    pin.className = 'collection-browser-item-pin';
    pin.innerHTML = this.options.icons.pin;
    pin.setAttribute('aria-hidden', 'true');
    titleRow.insertBefore(pin, labelEl);
  }

  private decorateItemInstanceBadge(itemEl: HTMLElement, item: CollectionItemSummary): void {
    if (!item.instanceId) {
      return;
    }
    if (this.options.shouldShowInstanceBadge && !this.options.shouldShowInstanceBadge()) {
      return;
    }
    const label = item.instanceLabel ?? item.instanceId;
    const badge = document.createElement('span');
    badge.className = 'collection-browser-item-badge';
    badge.textContent = label;
    badge.dataset['instanceId'] = item.instanceId;

    const labelEl = itemEl.querySelector<HTMLElement>('.collection-search-dropdown-item-label');
    if (labelEl) {
      let titleRow: HTMLElement | null = null;
      if (
        labelEl.parentElement &&
        labelEl.parentElement.classList.contains('collection-browser-item-title')
      ) {
        titleRow = labelEl.parentElement;
      } else {
        titleRow = document.createElement('div');
        titleRow.className = 'collection-browser-item-title';
        labelEl.insertAdjacentElement('beforebegin', titleRow);
        titleRow.appendChild(labelEl);
      }
      titleRow.appendChild(badge);
    } else {
      itemEl.appendChild(badge);
    }
  }

  private decorateListItem(itemEl: HTMLElement, item: CollectionItemSummary): void {
    if (item.type.toLowerCase().trim() !== 'list') {
      return;
    }
    const editEl = document.createElement('span');
    editEl.className = 'collection-browser-item-edit';
    editEl.innerHTML = this.options.icons.edit;
    editEl.setAttribute('aria-label', `Edit list ${item.name}`);
    editEl.title = 'Edit list';
    editEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      void this.openEditListDialog(item);
    });
    itemEl.appendChild(editEl);
  }

  private openCreateListDialog(): void {
    this.listMetadataDialog?.open('create');
  }

  private closeAddMenu(): void {
    this.addMenuEl?.classList.remove('open');
    this.addBtnEl?.setAttribute('aria-expanded', 'false');
  }

  private async openEditListDialog(item: CollectionItemSummary): Promise<void> {
    const dialog = this.listMetadataDialog;
    if (!dialog) {
      return;
    }
    const listId = item.id;
    const listInstanceId = item.instanceId ?? undefined;
    const fallback = (): void => {
      dialog.open('edit', {
        id: listId,
        name: item.name,
        tags: item.tags ?? [],
        defaultTags: [],
        ...(listInstanceId ? { instanceId: listInstanceId } : {}),
      });
    };

    const listApi = this.options.listApi;
    if (!listApi?.getList) {
      fallback();
      return;
    }
    try {
      const data = await listApi.getList(listId, listInstanceId);
      if (!data) {
        fallback();
        return;
      }
      const dialogData: ListMetadataDialogInitialData = {
        id: listId,
        name: data.name ?? item.name,
        description: data.description ?? '',
        tags: Array.isArray(data.tags) ? data.tags : (item.tags ?? []),
        defaultTags: Array.isArray(data.defaultTags) ? data.defaultTags : [],
        customFields: Array.isArray(data.customFields) ? data.customFields : [],
      };
      const resolvedInstanceId = data.instanceId ?? listInstanceId;
      if (resolvedInstanceId) {
        dialogData.instanceId = resolvedInstanceId;
      }
      dialog.open('edit', dialogData);
    } catch (err) {
      console.error('Failed to load list metadata', err);
      fallback();
    }
  }

  private async createList(payload: ListMetadataDialogPayload): Promise<boolean> {
    const listApi = this.options.listApi;
    if (!listApi?.createList) {
      console.error('List creation is unavailable for this panel.');
      return false;
    }
    try {
      const listId = await listApi.createList(payload);
      if (!listId) {
        console.error('Create list response missing id');
        return false;
      }

      await this.options.refreshItems();

      await this.options.selectItem({
        type: 'list',
        id: listId,
        ...(payload.instanceId ? { instanceId: payload.instanceId } : {}),
      });
      return true;
    } catch (err) {
      console.error('Failed to create list', err);
      return false;
    }
  }

  private async updateList(listId: string, payload: ListMetadataDialogPayload): Promise<boolean> {
    const listApi = this.options.listApi;
    if (!listApi?.updateList) {
      console.error('List updates are unavailable for this panel.');
      return false;
    }
    try {
      const ok = await listApi.updateList(listId, payload);
      if (!ok) {
        console.error('Failed to update list');
        return false;
      }
      await this.options.refreshItems();
      return true;
    } catch (err) {
      console.error('Failed to update list', err);
      return false;
    }
  }

  private async deleteList(listId: string): Promise<boolean> {
    const listApi = this.options.listApi;
    if (!listApi?.deleteList) {
      console.error('List deletion is unavailable for this panel.');
      return false;
    }
    try {
      const ok = await listApi.deleteList(listId);
      if (!ok) {
        console.error('Failed to delete list');
        return false;
      }
      await this.options.refreshItems();
      return true;
    } catch (err) {
      console.error('Failed to delete list', err);
      return false;
    }
  }

  private setViewMode(mode: CollectionBrowserViewMode): void {
    if (this.viewMode === mode) {
      return;
    }
    this.viewMode = mode;
    this.applyViewMode();
    if (mode === 'cards' || mode === 'cards_single') {
      this.loadPreviewsForRenderedItems();
    }
    this.storeViewMode(mode);
  }

  private applyViewMode(): void {
    if (!this.rootEl) {
      return;
    }
    this.rootEl.classList.toggle('view-cards', this.viewMode === 'cards');
    this.rootEl.classList.toggle('view-cards-single', this.viewMode === 'cards_single');
    this.rootEl.classList.toggle('view-list', this.viewMode === 'list');
    this.viewToggleCardsBtn?.classList.toggle('active', this.viewMode === 'cards');
    this.viewToggleSingleCardsBtn?.classList.toggle('active', this.viewMode === 'cards_single');
    this.viewToggleListBtn?.classList.toggle('active', this.viewMode === 'list');
    this.sortToggleAlphaBtn?.classList.toggle('active', this.sortMode === 'alpha');
    this.sortToggleUpdatedBtn?.classList.toggle('active', this.sortMode === 'updated');
  }

  private readStoredViewMode(): CollectionBrowserViewMode | null {
    try {
      const value = window.localStorage.getItem(this.options.viewModeStorageKey);
      if (value === 'list' || value === 'cards' || value === 'cards_single') {
        return value;
      }
    } catch {
      // Ignore localStorage errors.
    }
    return null;
  }

  private readStoredSortMode(): CollectionBrowserSortMode | null {
    try {
      const value = window.localStorage.getItem(this.options.sortModeStorageKey);
      if (value === 'alpha' || value === 'updated') {
        return value;
      }
    } catch {
      // Ignore localStorage errors.
    }
    return null;
  }

  private storeViewMode(mode: CollectionBrowserViewMode): void {
    try {
      window.localStorage.setItem(this.options.viewModeStorageKey, mode);
    } catch {
      // Ignore localStorage errors.
    }
  }

  private storeSortMode(mode: CollectionBrowserSortMode): void {
    try {
      window.localStorage.setItem(this.options.sortModeStorageKey, mode);
    } catch {
      // Ignore localStorage errors.
    }
  }

  private setSortMode(mode: CollectionBrowserSortMode): void {
    if (this.sortMode === mode) {
      return;
    }
    this.sortMode = mode;
    this.options.onSortModeChanged?.(mode);
    this.applyViewMode();
    this.storeSortMode(mode);
    this.refresh();
  }

  getSortMode(): CollectionBrowserSortMode {
    return this.sortMode;
  }

  private populate(items: CollectionItemSummary[]): void {
    const listEl = this.listEl;
    if (!listEl) {
      return;
    }

    this.updateCreateButtonVisibility();

    const supportedTypes = this.options.getSupportedTypes();
    const allowedItems = supportedTypes
      ? items.filter((item) => supportedTypes.includes(item.type))
      : items;

    this.totalAvailableItemCount = allowedItems.length;

    const groupOrderLabels: string[] = [];
    if (supportedTypes) {
      for (const type of supportedTypes) {
        const label = this.options.getGroupLabel(type).toLowerCase();
        if (!groupOrderLabels.includes(label)) {
          groupOrderLabels.push(label);
        }
      }
    }
    for (const item of allowedItems) {
      const label = this.options.getGroupLabel(item.type).toLowerCase();
      if (!groupOrderLabels.includes(label)) {
        groupOrderLabels.push(label);
      }
    }
    const labelIndex = new Map(groupOrderLabels.map((label, i) => [label, i]));

    const sortedItems = [...allowedItems].sort((a, b) => {
      const labelA = this.options.getGroupLabel(a.type).toLowerCase();
      const labelB = this.options.getGroupLabel(b.type).toLowerCase();
      const idxA = labelIndex.get(labelA) ?? Number.POSITIVE_INFINITY;
      const idxB = labelIndex.get(labelB) ?? Number.POSITIVE_INFINITY;
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      if (this.sortMode === 'updated') {
        const timeA = parseUpdatedAtMs(a.updatedAt);
        const timeB = parseUpdatedAtMs(b.updatedAt);
        if (timeA !== timeB) {
          return timeB - timeA;
        }
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    this.groupsMeta = renderCollectionDropdownList({
      listEl,
      items: sortedItems,
      getGroupLabel: this.options.getGroupLabel,
      onSelectItem: (itemEl) => this.selectItem(itemEl),
      renderItemContent: (itemEl, item) => {
        this.decorateItemPinned(itemEl, item);
        this.decorateItemInstanceBadge(itemEl, item);
        this.decorateListItem(itemEl, item);
        this.decorateItemPreview(itemEl, item);
        this.decorateItemTags(itemEl, item);
      },
    });

    if (!supportedTypes || supportedTypes.includes('note')) {
      for (const group of this.groupsMeta) {
        for (const itemEl of group.items) {
          if (itemEl.dataset['collectionType'] === 'note') {
            this.addNoteItemActions(itemEl);
          }
        }
      }
    }

    this.updateActiveHighlight();

    if (this.viewMode === 'cards' || this.viewMode === 'cards_single') {
      this.loadPreviewsForRenderedItems();
    }
  }

  private decorateItemPreview(itemEl: HTMLElement, item: CollectionItemSummary): void {
    const itemType = item.type.toLowerCase().trim();
    if (itemType !== 'note' && itemType !== 'list') {
      return;
    }

    const previewEl = document.createElement('div');
    previewEl.className = 'collection-browser-item-preview';
    previewEl.setAttribute('aria-hidden', 'true');
    previewEl.dataset['previewKey'] = this.getPreviewKey(item.type, item.id, item.instanceId);
    itemEl.appendChild(previewEl);
  }

  private decorateItemTags(itemEl: HTMLElement, item: CollectionItemSummary): void {
    const tags = Array.isArray(item.tags)
      ? item.tags
          .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
          .map((tag) => tag.trim())
          .filter((tag) => !isPinnedTag(tag))
      : [];

    if (tags.length === 0) {
      return;
    }

    const tagsEl = document.createElement('div');
    tagsEl.className = 'collection-browser-item-tags';

    for (const tag of tags) {
      const tagEl = document.createElement('span');
      tagEl.className = 'collection-browser-item-tag';
      tagEl.textContent = tag;
      tagEl.dataset['tag'] = normalizeTag(tag);
      applyTagColorToElement(tagEl, tag);
      tagsEl.appendChild(tagEl);
    }

    itemEl.appendChild(tagsEl);
  }

  private loadPreviewsForRenderedItems(): void {
    const listEl = this.listEl;
    if (!listEl) {
      return;
    }
    const items = listEl.querySelectorAll<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-type][data-collection-id]',
    );
    for (const itemEl of Array.from(items)) {
      const itemType = itemEl.dataset['collectionType']?.toLowerCase().trim();
      const itemId = itemEl.dataset['collectionId']?.trim();
      if (!itemType || !itemId) continue;
      if (itemType !== 'note' && itemType !== 'list') continue;

      const previewEl = itemEl.querySelector<HTMLElement>('.collection-browser-item-preview');
      if (!previewEl) continue;
      if (previewEl.dataset['previewLoaded'] === 'true') continue;

      const instanceId = itemEl.dataset['collectionInstanceId']?.trim() || undefined;
      void this.populatePreviewForElement({
        itemType,
        itemId,
        ...(instanceId ? { instanceId } : {}),
        itemEl,
        previewEl,
      });
    }
  }

  private getPreviewKey(type: string, id: string, instanceId?: string): string {
    const base = `${type.toLowerCase().trim()}:${id}`;
    return instanceId ? `${type.toLowerCase().trim()}:${instanceId}:${id}` : base;
  }

  private async populatePreviewForElement(args: {
    itemType: 'note' | 'list';
    itemId: string;
    instanceId?: string;
    itemEl: HTMLElement;
    previewEl: HTMLElement;
  }): Promise<void> {
    const { itemType, itemId, instanceId, itemEl, previewEl } = args;
    const key = this.getPreviewKey(itemType, itemId, instanceId);
    const filterState = this.getSearchFilterState(this.lastFilterQuery);

    const cached = this.previewCache.has(key) ? this.previewCache.get(key) : undefined;
    if (cached !== undefined) {
      this.applySearchIndexToItemElement(itemEl, cached);
      this.renderPreview(previewEl, cached, filterState);
      previewEl.dataset['previewLoaded'] = 'true';
      return;
    }

    previewEl.classList.add('collection-browser-item-preview--loading');

    const inFlight = this.previewRequests.get(key);
    if (inFlight) {
      const entry = await inFlight;
      this.applySearchIndexToItemElement(itemEl, entry);
      this.renderPreview(previewEl, entry, filterState);
      previewEl.dataset['previewLoaded'] = 'true';
      return;
    }

    const request = this.fetchPreview(itemType, itemId, instanceId);
    this.previewRequests.set(key, request);

    const entry = await request;
    this.previewRequests.delete(key);
    this.previewCache.set(key, entry);

    this.applySearchIndexToItemElement(itemEl, entry);
    this.renderPreview(previewEl, entry, filterState);
    previewEl.dataset['previewLoaded'] = 'true';

    const currentFilterState = this.getSearchFilterState(this.lastFilterQuery);
    if (
      currentFilterState &&
      (currentFilterState.hasTextQuery ||
        currentFilterState.hasTagFilters ||
        currentFilterState.hasExcludedTagFilters ||
        currentFilterState.hasPartialTag)
    ) {
      this.scheduleRefilter();
    }
  }

  private renderPreview(
    previewEl: HTMLElement,
    entry: CollectionPreviewCacheEntry | null,
    filterState: CollectionBrowserSearchFilterState | null,
  ): void {
    previewEl.classList.remove('collection-browser-item-preview--loading');
    previewEl.innerHTML = '';
    previewEl.classList.remove('collection-browser-item-preview--fade');

    if (!entry) {
      previewEl.classList.add('collection-browser-item-preview--empty');
      return;
    }

    previewEl.classList.remove('collection-browser-item-preview--empty');

    if (entry.kind === 'note') {
      const contentEl = document.createElement('div');
      contentEl.className = 'collection-note-content markdown-content';
      applyMarkdownToElement(contentEl, entry.content);
      previewEl.appendChild(contentEl);
      this.updatePreviewFade(previewEl);
      return;
    }

    const sorted = sortListItems(entry.items);
    const filtered = filterState ? filterListItems(sorted, filterState) : sorted;
    const maxItems = 20;
    const previewItems = filtered.slice(0, maxItems);
    if (previewItems.length === 0) {
      previewEl.classList.add('collection-browser-item-preview--empty');
      return;
    }

    const list = document.createElement('ul');
    list.className = 'collection-browser-item-preview-list';
    for (const item of previewItems) {
      const li = document.createElement('li');
      li.textContent = item.title;
      if (item.completed) {
        li.classList.add('completed');
      }
      list.appendChild(li);
    }
    previewEl.appendChild(list);

    const remaining = Math.max(0, filtered.length - previewItems.length);
    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'collection-browser-item-preview-more';
      more.textContent = `+${remaining} more`;
      previewEl.appendChild(more);
    }

    this.updatePreviewFade(previewEl);
  }

  private updatePreviewFade(previewEl: HTMLElement): void {
    setTimeout(() => {
      if (!previewEl.isConnected) return;
      const hasMore = !!previewEl.querySelector('.collection-browser-item-preview-more');
      const shouldFade = hasMore || previewEl.scrollHeight > previewEl.clientHeight + 1;
      previewEl.classList.toggle('collection-browser-item-preview--fade', shouldFade);
    }, 0);
  }

  private async fetchPreview(
    itemType: 'note' | 'list',
    itemId: string,
    instanceId?: string,
  ): Promise<CollectionPreviewCacheEntry | null> {
    if (!this.options.fetchPreview) {
      return null;
    }
    return this.options.fetchPreview(itemType, itemId, instanceId);
  }

  private filter(query: string): void {
    this.lastFilterQuery = query;
    this.applyFilter(query);
    this.ensureSearchIndex(query);
  }

  private applyFilter(query: string): void {
    this.filterController?.filter(query);
    this.updateActiveHighlight();
    this.updateVisibleListPreviews(query);
  }

  private scheduleRefilter(): void {
    if (this.refilterScheduled) {
      return;
    }
    this.refilterScheduled = true;
    setTimeout(() => {
      this.refilterScheduled = false;
      this.applyFilter(this.lastFilterQuery);
    }, 0);
  }

  private getSearchFilterState(query: string): CollectionBrowserSearchFilterState | null {
    const tagController = this.tagController;
    if (!tagController) {
      return null;
    }
    const parsed = tagController.parseSearchQuery(query);
    const allTagFilters = Array.from(
      new Set([...tagController.getActiveTagFilters(), ...parsed.includeTags]),
    );
    const allExcludedTagFilters = Array.from(
      new Set([...tagController.getActiveExcludedTagFilters(), ...parsed.excludeTags]),
    );
    const lowerText = parsed.text.trim().toLowerCase();
    return {
      allTagFilters,
      hasTagFilters: allTagFilters.length > 0,
      allExcludedTagFilters,
      hasExcludedTagFilters: allExcludedTagFilters.length > 0,
      lowerText,
      hasTextQuery: lowerText.length > 0,
      partialTag: parsed.partialTag,
      partialTagIsExcluded: parsed.partialTagIsExcluded,
      hasPartialTag: parsed.partialTag !== null && parsed.partialTag.length > 0,
    };
  }

  private updateVisibleListPreviews(query: string): void {
    if (this.viewMode !== 'cards' && this.viewMode !== 'cards_single') {
      return;
    }
    const listEl = this.listEl;
    if (!listEl) {
      return;
    }
    const filterState = this.getSearchFilterState(query);
    const items = listEl.querySelectorAll<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-type="list"][data-collection-id]',
    );
    for (const itemEl of Array.from(items)) {
      if (itemEl.style.display === 'none') {
        continue;
      }
      const itemId = itemEl.dataset['collectionId']?.trim();
      const instanceId = itemEl.dataset['collectionInstanceId']?.trim();
      if (!itemId) continue;
      const key = this.getPreviewKey('list', itemId, instanceId);
      const entry = this.previewCache.get(key);
      if (!entry || entry.kind !== 'list') continue;
      const previewEl = itemEl.querySelector<HTMLElement>('.collection-browser-item-preview');
      if (!previewEl) continue;
      this.renderPreview(previewEl, entry, filterState);
    }
  }

  private applySearchIndexToItemElement(
    itemEl: HTMLElement,
    entry: CollectionPreviewCacheEntry | null,
  ): void {
    let indexEl = itemEl.querySelector<HTMLElement>('.collection-browser-item-search-index');
    if (!indexEl) {
      indexEl = document.createElement('span');
      indexEl.className = 'collection-browser-item-search-index';
      indexEl.setAttribute('aria-hidden', 'true');
      indexEl.hidden = true;
      itemEl.appendChild(indexEl);
    }

    if (!entry) {
      indexEl.textContent = '';
      const base = itemEl.dataset['searchTextBase'] || '';
      itemEl.dataset['searchText'] = base;
      return;
    }

    if (entry.kind === 'note') {
      indexEl.textContent = entry.content;
      const base = itemEl.dataset['searchTextBase'] || '';
      itemEl.dataset['searchText'] = `${base}\n${entry.content}`.toLowerCase();
      return;
    }

    const parts: string[] = [];
    const tagSet = new Set<string>();
    const existingTags = (itemEl.dataset['tags'] || '')
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0);
    for (const tag of existingTags) tagSet.add(tag);

    for (const item of entry.items) {
      parts.push(item.title);
      if (item.notes) parts.push(item.notes);
      if (item.url) parts.push(item.url);
      for (const tag of item.tags) {
        tagSet.add(tag);
        parts.push(tag);
      }
    }
    itemEl.dataset['tags'] = Array.from(tagSet).join(',');
    const indexText = parts.join('\n');
    indexEl.textContent = indexText;
    const base = itemEl.dataset['searchTextBase'] || '';
    itemEl.dataset['searchText'] = `${base}\n${indexText}`.toLowerCase();
  }

  private ensureSearchIndex(query: string): void {
    const filterState = this.getSearchFilterState(query);
    if (!filterState) {
      return;
    }
    const shouldFetch =
      filterState.hasTextQuery || filterState.hasTagFilters || filterState.hasPartialTag;
    if (!shouldFetch) {
      return;
    }

    const listEl = this.listEl;
    if (!listEl) {
      return;
    }
    const items = listEl.querySelectorAll<HTMLElement>(
      '.collection-search-dropdown-item[data-collection-type][data-collection-id]',
    );
    for (const itemEl of Array.from(items)) {
      const itemType = itemEl.dataset['collectionType']?.toLowerCase().trim();
      const itemId = itemEl.dataset['collectionId']?.trim();
      const instanceId = itemEl.dataset['collectionInstanceId']?.trim();
      if (!itemType || !itemId) continue;
      if (itemType !== 'note' && itemType !== 'list') continue;

      const key = this.getPreviewKey(itemType, itemId, instanceId);
      const cached = this.previewCache.has(key) ? this.previewCache.get(key) : undefined;
      if (cached !== undefined) {
        this.applySearchIndexToItemElement(itemEl, cached);
        continue;
      }
      if (this.previewRequests.has(key)) {
        continue;
      }

      const request = this.fetchPreview(itemType, itemId, instanceId);
      this.previewRequests.set(key, request);
      void request.then((entry) => {
        this.previewRequests.delete(key);
        this.previewCache.set(key, entry);
        this.applySearchIndexToItemElement(itemEl, entry);

        if (this.viewMode === 'cards' || this.viewMode === 'cards_single') {
          const previewEl = itemEl.querySelector<HTMLElement>('.collection-browser-item-preview');
          if (previewEl) {
            this.renderPreview(previewEl, entry, this.getSearchFilterState(this.lastFilterQuery));
            previewEl.dataset['previewLoaded'] = 'true';
          }
        }

        this.scheduleRefilter();
      });
    }
  }

  private updateActiveHighlight(): void {
    const listEl = this.listEl;
    if (!listEl) {
      return;
    }
    listEl
      .querySelectorAll('.collection-search-dropdown-item.selected')
      .forEach((el) => el.classList.remove('selected'));

    const item = this.getActiveItemElement();
    if (item) {
      item.classList.add('selected');
    }
  }

  focusActiveItem(): void {
    if (!this.itemFocusController) {
      return;
    }
    const item = this.getActiveItemElement();
    if (!item) {
      return;
    }
    this.itemFocusController.setFocusedItem(item);
  }

  private getActiveItemElement(): HTMLElement | null {
    const listEl = this.listEl;
    if (!listEl) {
      return null;
    }
    const active = this.options.getActiveItemReference();
    if (!active) {
      return null;
    }
    const selectorParts = [
      `.collection-search-dropdown-item[data-collection-type="${active.type}"]` +
        `[data-collection-id="${active.id}"]`,
    ];
    if (active.instanceId) {
      selectorParts.push(`[data-collection-instance-id="${active.instanceId}"]`);
    }
    const item = listEl.querySelector(selectorParts.join(''));
    return item instanceof HTMLElement ? item : null;
  }

  private moveFocus(delta: number): void {
    const itemFocusController = this.itemFocusController;
    const tagController = this.tagController;
    const searchInput = this.searchInput;
    if (!itemFocusController || !tagController || !searchInput) {
      return;
    }

    const items = itemFocusController.getVisibleItems();
    if (items.length === 0) {
      searchInput.focus();
      return;
    }

    const focused = itemFocusController.getFocusedItem();
    let idx = focused ? items.indexOf(focused) : -1;

    if (delta < 0 && idx <= 0) {
      itemFocusController.setFocusedItem(null);
      if (this.tagsContainer?.classList.contains('visible')) {
        const tagSuggestions = tagController.getVisibleTagSuggestions();
        if (tagSuggestions.length > 0) {
          tagController.setSuggestionsMode(true);
          tagController.setFocusedTagSuggestion(tagSuggestions.length - 1);
          return;
        }
      }
      searchInput.focus();
      return;
    }

    if (delta > 0 && idx >= items.length - 1) {
      return;
    }

    if (idx < 0) idx = delta > 0 ? -1 : 0;
    const next = idx + delta;

    const nextItem = items[next];
    if (nextItem) {
      itemFocusController.setFocusedItem(nextItem);
    }
  }

  private getReferenceFromElement(item: HTMLElement): CollectionReference | null {
    const itemType = item.dataset['collectionType'];
    const itemId = item.dataset['collectionId'];
    if (!itemType || !itemId) {
      return null;
    }
    const instanceId = item.dataset['collectionInstanceId'];
    return {
      type: itemType,
      id: itemId,
      ...(instanceId ? { instanceId } : {}),
    };
  }

  private selectItem(item: HTMLElement): void {
    const reference = this.getReferenceFromElement(item);
    if (!reference) {
      return;
    }
    void this.options.selectItem(reference);
  }

  handleSharedSearchKeyDown(e: KeyboardEvent): boolean {
    const searchInput = this.searchInput;
    const tagController = this.tagController;
    const itemFocusController = this.itemFocusController;
    if (!searchInput || !tagController || !itemFocusController) {
      return false;
    }

    handleCollectionSearchKeyDown({
      event: e,
      searchInput,
      tagController,
      itemFocusController,
      tagsContainer: this.tagsContainer,
      allowItemNavigation: false,
      moveFocus: (delta) => this.moveFocus(delta),
      selectItem: (itemEl) => this.selectItem(itemEl),
      filter: (query) => this.filter(query),
      onClose: () => {
        // Browser mode stays open on escape/tab.
      },
    });
    return true;
  }

  private togglePinnedForFocusedItem(): boolean {
    const handler = this.options.onTogglePinned;
    if (!handler) {
      return false;
    }
    const itemFocusController = this.itemFocusController;
    if (!itemFocusController) {
      return false;
    }
    const focused = itemFocusController.getFocusedItem();
    if (!focused) {
      return false;
    }
    const reference = this.getReferenceFromElement(focused);
    if (!reference) {
      return false;
    }
    const tagSource =
      focused.dataset['collectionTags'] ?? focused.dataset['tags'] ?? '';
    const tags = tagSource
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
    const isPinned = tags.some((tag) => isPinnedTag(tag));
    handler(reference, isPinned);
    return true;
  }

  handleKeyboardEvent(event: KeyboardEvent): boolean {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return false;
    }

    switch (event.key) {
      case 'ArrowUp':
        this.moveFocusInGrid('up');
        return true;
      case 'ArrowDown':
        this.moveFocusInGrid('down');
        return true;
      case 'ArrowLeft':
        this.moveFocusInGrid('left');
        return true;
      case 'ArrowRight':
        this.moveFocusInGrid('right');
        return true;
      case 'Enter':
        return this.selectFocusedItem();
      default:
        break;
    }

    if (event.key.toLowerCase() === 'p') {
      return this.togglePinnedForFocusedItem();
    }

    return false;
  }

  private selectFocusedItem(): boolean {
    const itemFocusController = this.itemFocusController;
    if (!itemFocusController) {
      return false;
    }
    const focused = itemFocusController.getFocusedItem();
    if (focused) {
      this.selectItem(focused);
      return true;
    }
    const items = itemFocusController.getVisibleItems();
    if (items.length === 0) {
      return false;
    }
    if (items.length === 1 && items[0]) {
      this.selectItem(items[0]);
      return true;
    }
    itemFocusController.setFocusedItem(items[0] ?? null);
    return true;
  }

  private moveFocusInGrid(direction: 'up' | 'down' | 'left' | 'right'): void {
    const itemFocusController = this.itemFocusController;
    if (!itemFocusController) {
      return;
    }
    const items = itemFocusController.getVisibleItems();
    if (items.length === 0) {
      this.searchInput?.focus();
      return;
    }

    const positioned = items
      .map((item) => ({ item, rect: item.getBoundingClientRect() }))
      .sort((a, b) => {
        if (a.rect.top === b.rect.top) {
          return a.rect.left - b.rect.left;
        }
        return a.rect.top - b.rect.top;
      });

    const rows: Array<{ top: number; items: Array<{ item: HTMLElement; rect: DOMRect }> }> = [];
    const rowThreshold = 6;
    for (const entry of positioned) {
      const currentRow = rows[rows.length - 1];
      if (!currentRow || Math.abs(entry.rect.top - currentRow.top) > rowThreshold) {
        rows.push({ top: entry.rect.top, items: [entry] });
      } else {
        currentRow.items.push(entry);
      }
    }
    for (const row of rows) {
      row.items.sort((a, b) => a.rect.left - b.rect.left);
    }

    const focused = itemFocusController.getFocusedItem();
    if (!focused) {
      const fallback = direction === 'left' || direction === 'up'
        ? positioned[positioned.length - 1]
        : positioned[0];
      itemFocusController.setFocusedItem(fallback?.item ?? null);
      return;
    }

    let currentRowIndex = -1;
    let currentColIndex = -1;
    let currentRect: DOMRect | null = null;

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!row) {
        continue;
      }
      const colIndex = row.items.findIndex((entry) => entry.item === focused);
      if (colIndex >= 0) {
        currentRowIndex = rowIndex;
        currentColIndex = colIndex;
        currentRect = row.items[colIndex]?.rect ?? null;
        break;
      }
    }

    if (currentRowIndex < 0) {
      itemFocusController.setFocusedItem(positioned[0]?.item ?? null);
      return;
    }

    const currentRow = rows[currentRowIndex];
    if (!currentRow) {
      itemFocusController.setFocusedItem(positioned[0]?.item ?? null);
      return;
    }

    const findClosestInRow = (rowIndex: number): HTMLElement | null => {
      const row = rows[rowIndex];
      const firstItem = row?.items[0];
      if (!row || !firstItem) {
        return null;
      }
      const baseLeft = currentRect?.left ?? firstItem.rect.left;
      let closest = firstItem;
      let closestDistance = Math.abs(firstItem.rect.left - baseLeft);
      for (const entry of row.items) {
        const distance = Math.abs(entry.rect.left - baseLeft);
        if (distance < closestDistance) {
          closest = entry;
          closestDistance = distance;
        }
      }
      return closest.item;
    };

    let nextItem: HTMLElement | null = null;
    if (direction === 'left') {
      if (currentColIndex > 0) {
        nextItem = currentRow.items[currentColIndex - 1]?.item ?? null;
      } else if (currentRowIndex > 0) {
        const previousRow = rows[currentRowIndex - 1];
        if (previousRow) {
          nextItem = previousRow.items[previousRow.items.length - 1]?.item ?? null;
        }
      }
    } else if (direction === 'right') {
      if (currentColIndex < currentRow.items.length - 1) {
        nextItem = currentRow.items[currentColIndex + 1]?.item ?? null;
      } else if (currentRowIndex < rows.length - 1) {
        const nextRow = rows[currentRowIndex + 1];
        if (nextRow) {
          nextItem = nextRow.items[0]?.item ?? null;
        }
      }
    } else if (direction === 'up') {
      if (currentRowIndex > 0) {
        nextItem = findClosestInRow(currentRowIndex - 1);
      }
    } else if (direction === 'down') {
      if (currentRowIndex < rows.length - 1) {
        nextItem = findClosestInRow(currentRowIndex + 1);
      }
    }

    if (nextItem) {
      itemFocusController.setFocusedItem(nextItem);
    }
  }

  private addNoteItemActions(itemEl: HTMLElement): void {
    const noteId = itemEl.dataset['collectionId'];
    if (!noteId) {
      return;
    }
    const instanceId = itemEl.dataset['collectionInstanceId'];

    const actionsEl = document.createElement('span');
    actionsEl.className = 'collection-browser-item-actions';

    const editAction = document.createElement('span');
    editAction.className = 'collection-browser-item-action';
    editAction.innerHTML = this.options.icons.edit;
    editAction.setAttribute('role', 'button');
    editAction.setAttribute('aria-label', `Edit note ${noteId}`);
    editAction.tabIndex = 0;

    const openEditor = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      this.options.openNoteEditor('edit', noteId, instanceId ?? undefined);
    };
    editAction.addEventListener('click', openEditor);
    editAction.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        openEditor(e);
      }
    });

    actionsEl.appendChild(editAction);
    itemEl.appendChild(actionsEl);
  }
}

export type CollectionPreviewCacheEntry =
  | {
      kind: 'note';
      content: string;
    }
  | {
      kind: 'list';
      items: ListPreviewItem[];
    };

type CollectionBrowserSearchFilterState = {
  allTagFilters: string[];
  hasTagFilters: boolean;
  allExcludedTagFilters: string[];
  hasExcludedTagFilters: boolean;
  lowerText: string;
  hasTextQuery: boolean;
  partialTag: string | null;
  hasPartialTag: boolean;
  partialTagIsExcluded: boolean;
};

type ListPreviewItem = {
  title: string;
  notes?: string;
  url?: string;
  tags: string[];
  completed: boolean;
  position: number;
};

function sortListItems(items: ListPreviewItem[]): ListPreviewItem[] {
  const uncompleted = items
    .filter((item) => !item.completed)
    .slice()
    .sort((a, b) => a.position - b.position);
  const completed = items
    .filter((item) => item.completed)
    .slice()
    .sort((a, b) => a.position - b.position);
  return [...uncompleted, ...completed];
}

function filterListItems(
  items: ListPreviewItem[],
  filterState: CollectionBrowserSearchFilterState,
): ListPreviewItem[] {
  const {
    hasTextQuery,
    lowerText,
    hasTagFilters,
    allTagFilters,
    hasExcludedTagFilters,
    allExcludedTagFilters,
    hasPartialTag,
    partialTag,
    partialTagIsExcluded,
  } = filterState;

  if (!hasTextQuery && !hasTagFilters && !hasExcludedTagFilters && !hasPartialTag) {
    return items;
  }

  return items.filter((item) => {
    if (hasExcludedTagFilters && allExcludedTagFilters.some((t) => item.tags.includes(t))) {
      return false;
    }

    let tagMatch = true;
    if (hasTagFilters) {
      for (const filterTag of allTagFilters) {
        if (!item.tags.includes(filterTag)) {
          tagMatch = false;
          break;
        }
      }
    }

    let partialTagMatch = true;
    if (hasPartialTag && partialTag) {
      if (partialTagIsExcluded) {
        // When typing !@..., we still show suggestions, but keep item filtering based on item tags.
        partialTagMatch = item.tags.some((t) => t.startsWith(partialTag));
      } else {
        partialTagMatch = item.tags.some((t) => t.startsWith(partialTag));
      }
    }

    let textMatch = true;
    if (hasTextQuery) {
      const parts: string[] = [item.title];
      if (item.notes) parts.push(item.notes);
      if (item.url) parts.push(item.url);
      if (item.tags.length > 0) parts.push(item.tags.join(' '));
      const haystack = parts.join('\n').toLowerCase();
      textMatch = haystack.includes(lowerText);
    }

    return tagMatch && partialTagMatch && textMatch;
  });
}

function parseUpdatedAtMs(updatedAt: string | undefined): number {
  if (typeof updatedAt !== 'string') {
    return 0;
  }
  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}
