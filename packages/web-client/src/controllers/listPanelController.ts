import type { ContextMenuManager } from './contextMenu';
import type { DialogManager } from './dialogManager';
import type { CollectionTagFilterController } from './collectionTagFilterController';
import type { ListCustomFieldDefinition } from './listCustomFields';
import { ListItemEditorDialog, type ListItemEditorDialogOpenOptions } from './listItemEditorDialog';
import { ListItemMenuController } from './listItemMenuController';
import { renderListPanelHeader, type ListPanelHeaderControls } from './listPanelHeaderRenderer';
import {
  ListPanelTableController,
  type ListPanelTableControllerOptions,
} from './listPanelTableController';
import type {
  ColumnVisibility,
  ListColumnConfig,
  ListColumnPreferences,
} from '../utils/listColumnPreferences';
import { arraysEqualBy, syncArrayContents } from '../utils/arrayUtils';
import { getListColumnPresence, getVisibleCustomFields } from '../utils/listColumnVisibility';
import { sortItems, type SortState } from '../utils/listSorting';
import { PINNED_TAG, hasPinnedTag, withoutPinnedTag } from '../utils/pinnedTag';
import type { AqlQuery } from '../utils/listItemQuery';
import {
  evaluateAql,
  getShowColumnOrder,
  sortItemsByOrderBy,
} from '../utils/listItemQuery';
import type { ListItemReference } from '../utils/listCustomFieldReference';

export interface ListMoveTarget {
  id: string;
  name: string;
}

export interface ListPanelItem {
  id?: string;
  title: string;
  url?: string;
  notes?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  addedAt?: string;
  updatedAt?: string;
  touchedAt?: string;
  position?: number;
  completed?: boolean;
  completedAt?: string;
}

export interface ListPanelData {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  defaultTags?: string[];
  customFields?: ListCustomFieldDefinition[];
  savedQueries?: Array<{
    id: string;
    name: string;
    query: string;
    isDefault?: boolean;
    createdAt?: string;
    updatedAt?: string;
  }>;
  items?: ListPanelItem[];
}

export interface ListPanelControllerOptions {
  bodyEl: HTMLElement | null;
  getSearchQuery: () => string;
  getSearchTagController: () => CollectionTagFilterController | null;
  getActiveInstanceId: () => string | null;
  callOperation?: <T>(operation: string, args: Record<string, unknown>) => Promise<T>;
  icons: {
    copy: string;
    duplicate: string;
    move: string;
    plus: string;
    edit: string;
    trash: string;
    moreVertical: string;
    x: string;
    clock: string;
    clockOff: string;
    moveTop: string;
    moveBottom: string;
    pin: string;
  };
  renderTags: (tags: string[] | undefined) => HTMLElement | null;
  setStatus: (text: string) => void;
  dialogManager: DialogManager;
  contextMenuManager: ContextMenuManager;
  recentUserItemUpdates: Set<string>;
  userUpdateTimeoutMs: number;
  getSelectedItemIds: () => string[];
  getSelectedItemCount: () => number;
  onSelectionChange?: () => void;
  getMoveTargetLists: () => ListMoveTarget[];
  openListMetadataDialog: (listId: string, data: ListPanelData) => void;
  getListColumnPreferences: (listId: string) => ListColumnPreferences | null;
  updateListColumnPreferences: (
    listId: string,
    columnKey: string,
    patch: Partial<ListColumnConfig>,
  ) => void;
  getSortState: (listId: string) => SortState | null;
  updateSortState: (listId: string, sortState: SortState | null) => void;
  getTimelineField: (listId: string) => string | null;
  updateTimelineField: (listId: string, timelineField: string | null) => void;
  getFocusMarkerItemId: (listId: string) => string | null;
  getFocusMarkerExpanded: (listId: string) => boolean;
  updateFocusMarker: (
    listId: string,
    focusMarkerItemId: string | null,
    focusMarkerExpanded?: boolean,
  ) => void;
  updateFocusMarkerExpanded: (listId: string, focusMarkerExpanded: boolean) => void;
  getAqlMode?: () => boolean;
  getAqlQuery?: () => AqlQuery | null;
  setRightControls: (elements: HTMLElement[]) => void;
  openReferencePicker?: (options: {
    listId: string;
    field: ListCustomFieldDefinition;
    item?: ListPanelItem;
    currentValue: ListItemReference | null;
  }) => Promise<ListItemReference | null>;
  openReference?: (reference: ListItemReference) => void;
  isReferenceAvailable?: (reference: ListItemReference) => boolean;
  checkReferenceAvailability?: (reference: ListItemReference) => Promise<boolean | null>;
}

const DEFAULT_VISIBILITY_BY_COLUMN: Record<string, ColumnVisibility> = {
  url: 'hide-in-compact',
  notes: 'show-with-data',
  tags: 'show-with-data',
  added: 'hide-in-compact',
  updated: 'hide-in-compact',
  touched: 'hide-in-compact',
};

const INSERT_AT_TOP_STORAGE_KEY = 'aiAssistantListInsertAtTop';
const LIST_ITEM_EXPORT_PLUGIN = 'lists';
const LIST_CLIPBOARD_TIMEOUT_MS = 60_000;

type ListClipboardMode = 'copy' | 'cut';
type ListClipboardPayload = {
  mode: ListClipboardMode;
  sourceListId: string;
  sourceInstanceId: string | null;
  itemIds: string[];
  expiresAt: number;
};

let listClipboard: ListClipboardPayload | null = null;
let listClipboardTimeout: ReturnType<typeof setTimeout> | null = null;

const clearListClipboard = (): void => {
  listClipboard = null;
  if (listClipboardTimeout) {
    clearTimeout(listClipboardTimeout);
    listClipboardTimeout = null;
  }
};

const setListClipboard = (payload: ListClipboardPayload | null): void => {
  clearListClipboard();
  if (!payload) {
    return;
  }
  listClipboard = payload;
  listClipboardTimeout = setTimeout(() => {
    clearListClipboard();
  }, LIST_CLIPBOARD_TIMEOUT_MS);
};

const getListClipboard = (): ListClipboardPayload | null => {
  if (!listClipboard) {
    return null;
  }
  if (Date.now() >= listClipboard.expiresAt) {
    clearListClipboard();
    return null;
  }
  return listClipboard;
};

type ListColumnState = {
  showTitleColumn: boolean;
  showUrlColumn: boolean;
  showNotesColumn: boolean;
  showTagsColumn: boolean;
  showAddedColumn: boolean;
  showUpdatedColumn: boolean;
  showTouchedColumn: boolean;
  visibleCustomFields: ListCustomFieldDefinition[];
  getColumnVisibility: (columnKey: string) => ColumnVisibility;
};

export class ListPanelController {
  private listViewShowAllColumns = false;
  private readonly listItemEditorDialog: ListItemEditorDialog;
  private readonly listItemMenuController: ListItemMenuController;
  private readonly tableController: ListPanelTableController;
  private currentDefaultTags: string[] = [];
  private currentAvailableTags: string[] = [];
  private currentCustomFields: ListCustomFieldDefinition[] = [];
  private currentSortState: SortState | null = null;
  private currentTimelineField: string | null = null;
  private currentFocusMarkerItemId: string | null = null;
  private currentFocusMarkerExpanded: boolean = false;
  private currentAqlQuery: AqlQuery | null = null;
  private currentAqlMode: boolean = false;
  private currentListId: string | null = null;
  private currentData: ListPanelData | null = null;
  private currentSortedItems: ListPanelItem[] = [];
  private currentColumnState: ListColumnState | null = null;
  private currentTable: {
    tbody: HTMLTableSectionElement;
    colCount: number;
    hasAnyItems: boolean;
  } | null = null;
  private addDialogInstanceOverrides = new Map<string, string>();
  constructor(private readonly options: ListPanelControllerOptions) {
    this.listItemEditorDialog = new ListItemEditorDialog({
      dialogManager: options.dialogManager,
      setStatus: options.setStatus,
      recentUserItemUpdates: options.recentUserItemUpdates,
      userUpdateTimeoutMs: options.userUpdateTimeoutMs,
      createListItem: (listId, item) => this.createListItem(listId, item),
      updateListItem: (listId, itemId, updates) => this.updateListItem(listId, itemId, updates),
      ...(options.openReferencePicker ? { openReferencePicker: options.openReferencePicker } : {}),
      ...(options.isReferenceAvailable
        ? { isReferenceAvailable: options.isReferenceAvailable }
        : {}),
      ...(options.checkReferenceAvailability
        ? { checkReferenceAvailability: options.checkReferenceAvailability }
        : {}),
    });

    this.listItemMenuController = new ListItemMenuController({
      contextMenuManager: options.contextMenuManager,
      icons: {
        edit: options.icons.edit,
        copy: options.icons.copy,
        duplicate: options.icons.duplicate,
        move: options.icons.move,
        trash: options.icons.trash,
        clock: options.icons.clock,
        clockOff: options.icons.clockOff,
        moveTop: options.icons.moveTop,
        moveBottom: options.icons.moveBottom,
      },
      recentUserItemUpdates: options.recentUserItemUpdates,
      userUpdateTimeoutMs: options.userUpdateTimeoutMs,
      getMoveTargetLists: () => this.options.getMoveTargetLists(),
      updateListItem: (listId, itemId, updates) => this.updateListItem(listId, itemId, updates),
      onEditItem: (
        listId: string,
        item: ListPanelItem,
        options?: ListItemEditorDialogOpenOptions,
      ) => {
        this.showListItemEditorDialog('edit', listId, item, options);
      },
      onDeleteItem: (listId, itemId, title) => {
        this.showListItemDeleteConfirmation(listId, itemId, title);
      },
      onMoveItemToList: (listId, itemId, targetListId) => {
        void this.moveItemToList(listId, itemId, targetListId);
      },
      onCopyItemToList: (listId, itemId, targetListId) => {
        void this.copyItemsToList(listId, [itemId], targetListId);
      },
      onTouchItem: (listId, itemId) => {
        void this.touchListItem(listId, itemId);
      },
      onClearTouchItem: (listId, itemId) => {
        void this.clearTouchListItem(listId, itemId);
      },
    });

    const tableOptions: ListPanelTableControllerOptions = {
      icons: { moreVertical: options.icons.moreVertical, pin: options.icons.pin },
      renderTags: options.renderTags,
      recentUserItemUpdates: options.recentUserItemUpdates,
      userUpdateTimeoutMs: options.userUpdateTimeoutMs,
      getSelectedItemCount: options.getSelectedItemCount,
      getExternalDragPayload: ({ itemIds }) => {
        const plainText = this.buildListItemExportText(itemIds);
        if (!plainText) {
          return null;
        }
        return { plainText };
      },
      showListItemMenu: (trigger, listId, item, itemId, row) => {
        this.showListItemMenu(trigger, listId, item, itemId, row);
      },
      updateListItem: (listId, itemId, updates) => this.updateListItem(listId, itemId, updates),
      onMoveItemsToList: (sourceListId, itemIds, targetListId, targetPosition) =>
        this.moveItemsToListFromDrag(sourceListId, itemIds, targetListId, targetPosition),
      onEditItem: (
        listId: string,
        item: ListPanelItem,
        options?: ListItemEditorDialogOpenOptions,
      ) => {
        this.showListItemEditorDialog('edit', listId, item, options);
      },
      ...(options.openReferencePicker
        ? { openReferencePicker: options.openReferencePicker }
        : {}),
      ...(options.openReference ? { onOpenReference: options.openReference } : {}),
      ...(options.isReferenceAvailable
        ? { isReferenceAvailable: options.isReferenceAvailable }
        : {}),
    };
    if (options.onSelectionChange) {
      tableOptions.onSelectionChange = options.onSelectionChange;
    }
    this.tableController = new ListPanelTableController(tableOptions);
  }

  private getInsertAtTopPreference(): boolean {
    try {
      return window.localStorage.getItem(INSERT_AT_TOP_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  }

  private async runOperation<T>(
    operation: string,
    args: Record<string, unknown>,
    options?: { instanceId?: string | null },
  ): Promise<T | null> {
    if (!this.options.callOperation) {
      return null;
    }
    const instanceId = options?.instanceId;
    const payload =
      instanceId && typeof instanceId === 'string' ? { ...args, instanceId } : args;
    return this.options.callOperation<T>(operation, payload);
  }

  applySearch(query: string): void {
    if (this.currentAqlMode) {
      return;
    }
    const table = this.currentTable;
    if (!table) {
      return;
    }
    this.filterRows(table.tbody, table.colCount, table.hasAnyItems, query);
  }

  applyItemUpdate(item: ListPanelItem): boolean {
    const itemId = item.id;
    if (!itemId || !this.currentData || !this.currentListId) {
      return false;
    }
    const items = this.currentData.items;
    if (!items) {
      return false;
    }
    const existingIndex = items.findIndex((entry) => entry.id === itemId);
    if (existingIndex === -1) {
      return false;
    }
    items[existingIndex] = item;

    const sortedIndex = this.currentSortedItems.findIndex((entry) => entry.id === itemId);
    if (sortedIndex !== -1) {
      this.currentSortedItems[sortedIndex] = item;
    }

    const nextSortedItems = sortItems(items, this.currentSortState, this.currentCustomFields);
    const orderChanged = !arraysEqualBy(
      nextSortedItems,
      this.currentSortedItems,
      (entry) => entry.id ?? '',
    );

    if (this.currentTimelineField || orderChanged) {
      this.rerenderCurrent();
      return true;
    }

    const nextColumnState = this.buildColumnState(
      this.options.getListColumnPreferences(this.currentListId),
      nextSortedItems,
      getShowColumnOrder(this.currentAqlQuery?.show ?? null),
    );
    if (!this.columnStateMatches(nextColumnState)) {
      this.rerenderCurrent();
      return true;
    }

    syncArrayContents(this.currentSortedItems, nextSortedItems);
    this.currentColumnState = nextColumnState;

    const tagState = this.computeTagState(this.currentData, nextSortedItems);
    this.currentAvailableTags = tagState.availableTags;
    this.currentDefaultTags = tagState.defaultTags;

    const updated = this.tableController.updateRow(item, this.currentSortedItems);
    if (!updated) {
      this.rerenderCurrent();
      return true;
    }

    if (this.currentAqlMode) {
      this.rerenderCurrent();
      return true;
    }

    this.applySearch(this.options.getSearchQuery());
    return true;
  }

  getAvailableTags(): string[] {
    return withoutPinnedTag(this.currentAvailableTags);
  }

  openAddItemDialog(
    listId: string,
    options?: {
      openOptions?: ListItemEditorDialogOpenOptions;
      instanceId?: string | null;
    },
  ): void {
    if (options?.instanceId) {
      this.addDialogInstanceOverrides.set(listId, options.instanceId);
    } else {
      this.addDialogInstanceOverrides.delete(listId);
    }
    this.showListItemEditorDialog('add', listId, undefined, options?.openOptions);
  }

  handleKeyboardEvent(event: KeyboardEvent): boolean {
    if (!this.currentListId || !this.currentData) {
      return false;
    }
    const key = event.key;
    const lowerKey = key.toLowerCase();
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
    const isCommand = event.ctrlKey || event.metaKey;

    if (isCommand && !event.altKey && !event.shiftKey) {
      if (lowerKey === 'c') {
        void this.copySelectionToClipboard('copy');
        this.focusListBody();
        return true;
      }
      if (lowerKey === 'x') {
        void this.copySelectionToClipboard('cut');
        this.focusListBody();
        return true;
      }
      if (lowerKey === 'v') {
        void this.pasteClipboardToCurrentList();
        this.focusListBody();
        return true;
      }
    }

    if (key === 'ArrowDown' || key === 'ArrowUp') {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return false;
      }
      const offset = key === 'ArrowUp' ? -1 : 1;
      const handled = this.tableController.moveSelectionByOffset(offset, {
        extend: event.shiftKey,
        wrap: false,
      });
      return Boolean(handled);
    }

    if (key === 'Escape') {
      if (this.options.getSelectedItemCount() === 0) {
        return false;
      }
      this.clearListSelection();
      return true;
    }

    if (hasModifier) {
      return false;
    }

    if (key === 'Enter') {
      return this.openEditForFocusedItem();
    }

    if (key === ' ' || key === 'Spacebar') {
      if (this.options.getSelectedItemCount() === 0) {
        return false;
      }
      void this.toggleSelectedItemsCompleted();
      return true;
    }

    if (lowerKey === 'd') {
      return this.requestDeleteSelectedItems();
    }
    if (lowerKey === 't') {
      if (this.options.getSelectedItemCount() !== 1) {
        return false;
      }
      void this.moveFocusedItemToBoundary('top');
      return true;
    }
    if (lowerKey === 'b') {
      if (this.options.getSelectedItemCount() !== 1) {
        return false;
      }
      void this.moveFocusedItemToBoundary('bottom');
      return true;
    }
    if (lowerKey === 'w') {
      if (this.options.getSelectedItemCount() !== 1) {
        return false;
      }
      void this.moveFocusedItemByOffset(-1);
      return true;
    }
    if (lowerKey === 's') {
      if (this.options.getSelectedItemCount() !== 1) {
        return false;
      }
      void this.moveFocusedItemByOffset(1);
      return true;
    }
    if (lowerKey === 'n') {
      this.openAddItemDialog(this.currentListId);
      return true;
    }

    if (lowerKey === 'p') {
      void this.togglePinnedForSelection();
      return true;
    }

    return false;
  }

  private focusListBody(): void {
    const bodyEl = this.options.bodyEl;
    if (bodyEl && typeof bodyEl.focus === 'function') {
      bodyEl.focus();
    }
  }

  private buildListItemExportText(itemIds: string[]): string | null {
    const listId = this.currentListId ?? this.currentData?.id ?? null;
    const listName = this.currentData?.name?.trim() ?? '';
    const instanceId = this.options.getActiveInstanceId();
    const itemsById = new Map<string, ListPanelItem>();
    for (const item of this.currentSortedItems) {
      if (item.id) {
        itemsById.set(item.id, item);
      }
    }

    const blocks: string[] = [];
    for (const id of itemIds) {
      const item = itemsById.get(id);
      if (!item || typeof item.title !== 'string') {
        continue;
      }
      const title = item.title.trim();
      if (!title) {
        continue;
      }
      const lines: string[] = [];
      lines.push(`plugin: ${LIST_ITEM_EXPORT_PLUGIN}`);
      if (item.id) {
        lines.push(`itemId: ${item.id}`);
      }
      lines.push(`title: ${title}`);
      if (item.notes && item.notes.trim()) {
        lines.push(`notes: ${item.notes.trim()}`);
      }
      if (item.url && item.url.trim()) {
        lines.push(`url: ${item.url.trim()}`);
      }
      if (listId) {
        lines.push(`listId: ${listId}`);
      }
      if (listName) {
        lines.push(`listName: ${listName}`);
      }
      if (instanceId) {
        lines.push(`instance_id: ${instanceId}`);
      }
      blocks.push(lines.join('\n'));
    }

    if (blocks.length === 0) {
      return null;
    }
    return blocks.join('\n\n');
  }

  private async writeListItemExportToClipboard(itemIds: string[]): Promise<boolean> {
    const payload = this.buildListItemExportText(itemIds);
    if (!payload) {
      return false;
    }
    try {
      await navigator.clipboard.writeText(payload);
      return true;
    } catch {
      return false;
    }
  }

  private async copySelectionToClipboard(mode: ListClipboardMode): Promise<void> {
    const itemIds = this.options.getSelectedItemIds();
    if (itemIds.length === 0) {
      this.options.setStatus(`Select at least one item to ${mode}`);
      return;
    }
    const sourceListId = this.currentListId;
    if (!sourceListId) {
      this.options.setStatus('No source list available');
      return;
    }
    const sourceInstanceId = this.options.getActiveInstanceId();
    setListClipboard({
      mode,
      sourceListId,
      sourceInstanceId,
      itemIds: [...itemIds],
      expiresAt: Date.now() + LIST_CLIPBOARD_TIMEOUT_MS,
    });
    await this.writeListItemExportToClipboard(itemIds);
    this.options.setStatus(
      `${mode === 'cut' ? 'Cut' : 'Copied'} ${itemIds.length} item${itemIds.length === 1 ? '' : 's'}`,
    );
  }

  private async pasteClipboardToCurrentList(): Promise<void> {
    const payload = getListClipboard();
    if (!payload) {
      this.options.setStatus('Nothing to paste');
      return;
    }
    const targetListId = this.currentListId;
    if (!targetListId) {
      this.options.setStatus('No target list available');
      return;
    }
    if (payload.sourceListId === targetListId) {
      this.options.setStatus('Paste into the same list is ignored');
      return;
    }
    const targetInstanceId = this.options.getActiveInstanceId();
    if (
      payload.sourceInstanceId &&
      targetInstanceId &&
      payload.sourceInstanceId !== targetInstanceId
    ) {
      this.options.setStatus('Paste only works within the same instance');
      return;
    }

    if (payload.mode === 'cut') {
      const moved = await this.bulkMoveItems(payload.itemIds, targetListId, {
        clearSelection: true,
        sourceListId: payload.sourceListId,
      });
      if (moved) {
        clearListClipboard();
      }
      return;
    }

    await this.copyItemsToList(payload.sourceListId, payload.itemIds, targetListId);
  }

  render(listId: string, data: ListPanelData): ListPanelHeaderControls {
    const bodyEl = this.options.bodyEl;
    if (!bodyEl) {
      return { rightControls: [] };
    }

    bodyEl.innerHTML = '';
    bodyEl.tabIndex = -1;

    // Load saved preferences for this list (only on first render for this list)
    if (this.currentListId !== listId) {
      this.currentSortState = this.options.getSortState(listId);
      this.currentTimelineField = this.options.getTimelineField(listId);
      this.currentFocusMarkerItemId = this.options.getFocusMarkerItemId(listId);
      this.currentFocusMarkerExpanded = this.options.getFocusMarkerExpanded(listId);
    }
    this.currentAqlMode = this.options.getAqlMode?.() ?? false;
    this.currentAqlQuery = this.currentAqlMode ? this.options.getAqlQuery?.() ?? null : null;

    // Get custom fields early for the header
    const customFields = Array.isArray(data.customFields) ? data.customFields : [];

    // Check if sorted by position (default or explicit)
    const aqlPrimarySort = this.currentAqlQuery?.orderBy?.[0] ?? null;
    const effectiveSortState = aqlPrimarySort
      ? { column: aqlPrimarySort.field.key, direction: aqlPrimarySort.direction }
      : this.currentSortState;
    const isSortedByPosition = !effectiveSortState || effectiveSortState.column === 'position';

    const { header, controls } = renderListPanelHeader({
      listId,
      data,
      icons: {
        plus: this.options.icons.plus,
        trash: this.options.icons.trash,
        edit: this.options.icons.edit,
      },
      showAllColumns: this.listViewShowAllColumns,
      timelineField: this.currentTimelineField,
      focusMarkerItemId: this.currentFocusMarkerItemId,
      isSortedByPosition,
      customFields,
      onSelectVisible: () => {
        this.selectVisibleItems();
      },
      onSelectAll: () => {
        this.selectAllItems();
      },
      onClearSelection: () => {
        this.clearListSelection();
      },
      onDeleteSelection: () => {
        this.showDeleteSelectedItemsConfirmation(listId);
      },
      onAddItem: (targetListId) => {
        this.showListItemEditorDialog('add', targetListId);
      },
      onToggleView: () => {
        this.listViewShowAllColumns = !this.listViewShowAllColumns;
        const newControls = this.render(listId, data);
        this.options.setRightControls(newControls.rightControls);
      },
      onEditMetadata: () => {
        this.options.openListMetadataDialog(listId, data);
      },
      onTimelineFieldChange: (fieldKey: string | null) => {
        this.currentTimelineField = fieldKey;
        // When enabling timeline view, also sort by that field and disable focus view
        if (fieldKey) {
          this.currentSortState = { column: fieldKey, direction: 'asc' };
          this.options.updateSortState(listId, this.currentSortState);
          // Disable focus view when enabling timeline view
          if (this.currentFocusMarkerItemId) {
            this.currentFocusMarkerItemId = null;
            this.currentFocusMarkerExpanded = false;
            this.options.updateFocusMarker(listId, null);
          }
        }
        this.options.updateTimelineField(listId, fieldKey);
        const newControls = this.render(listId, data);
        this.options.setRightControls(newControls.rightControls);
      },
      onFocusViewToggle: () => {
        if (this.currentFocusMarkerItemId) {
          // Disable focus view
          this.currentFocusMarkerItemId = null;
          this.currentFocusMarkerExpanded = false;
          this.options.updateFocusMarker(listId, null);
        } else {
          // Enable focus view - place marker after first item
          const firstItem = this.currentSortedItems.find((item) => !item.completed && item.id);
          if (firstItem?.id) {
            this.currentFocusMarkerItemId = firstItem.id;
            this.currentFocusMarkerExpanded = false;
            this.options.updateFocusMarker(listId, firstItem.id, false);
          }
        }
        const newControls = this.render(listId, data);
        this.options.setRightControls(newControls.rightControls);
      },
      getMoveTargetLists: () => this.options.getMoveTargetLists(),
      onMoveSelectedToList: (targetListId) => {
        void this.moveSelectedItemsToList(targetListId);
      },
      onCopySelectedToList: (targetListId) => {
        void this.copySelectedItemsToList(targetListId);
      },
      renderTags: this.options.renderTags,
    });

    bodyEl.appendChild(header);

    // Store current list and data for re-renders
    this.currentListId = listId;
    this.currentData = data;

    const rawItems = Array.isArray(data.items) ? data.items : [];
    const allItems = rawItems.filter(
      (item): item is ListPanelItem =>
        !!item && typeof item === 'object' && typeof item.title === 'string',
    );

    this.currentCustomFields = customFields;

    let filteredItems = allItems;
    if (this.currentAqlQuery?.where) {
      filteredItems = allItems.filter((item) => evaluateAql(this.currentAqlQuery!, item));
    }

    const aqlOrderBy = this.currentAqlQuery?.orderBy ?? [];
    const sortedItems =
      aqlOrderBy.length > 0
        ? sortItemsByOrderBy(filteredItems, aqlOrderBy, this.currentCustomFields)
        : sortItems(filteredItems, this.currentSortState, this.currentCustomFields);

    const tagState = this.computeTagState(data, sortedItems);
    this.currentAvailableTags = tagState.availableTags;
    this.currentDefaultTags = tagState.defaultTags;

    const listColumnPrefs = this.options.getListColumnPreferences(listId);
    const showOverride = getShowColumnOrder(this.currentAqlQuery?.show ?? null);
    const columnState = this.buildColumnState(listColumnPrefs, sortedItems, showOverride);
    const {
      showTitleColumn,
      showUrlColumn,
      showNotesColumn,
      showTagsColumn,
      showAddedColumn,
      showUpdatedColumn,
      showTouchedColumn,
      visibleCustomFields,
      getColumnVisibility,
    } = columnState;

    const columnWidths: Record<string, number> = {};
    const addColumnWidth = (key: string) => {
      if (!key) return;
      const config = listColumnPrefs?.[key];
      const width = config?.width;
      if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
        columnWidths[key] = width;
      }
    };

    addColumnWidth('title');
    addColumnWidth('url');
    addColumnWidth('notes');
    addColumnWidth('tags');
    addColumnWidth('added');
    addColumnWidth('updated');
    addColumnWidth('touched');
    for (const field of this.currentCustomFields) {
      const key = field.key;
      if (key) {
        addColumnWidth(key);
      }
    }

    const handleColumnVisibilityChange = (columnKey: string, visibility: ColumnVisibility) => {
      if (!columnKey) {
        return;
      }
      this.options.updateListColumnPreferences(listId, columnKey, { visibility });
      const newControls = this.render(listId, data);
      this.options.setRightControls(newControls.rightControls);
    };

    const handleColumnResize = (columnKey: string, width: number) => {
      if (!columnKey) {
        return;
      }
      if (!Number.isFinite(width) || width <= 0) {
        return;
      }
      this.options.updateListColumnPreferences(listId, columnKey, { width });
    };

    const handleSortChange = (newSortState: SortState | null) => {
      this.currentSortState = newSortState;
      this.options.updateSortState(listId, newSortState);
      // Disable focus view when changing to non-position sort
      const newIsSortedByPosition = !newSortState || newSortState.column === 'position';
      if (!newIsSortedByPosition && this.currentFocusMarkerItemId) {
        this.currentFocusMarkerItemId = null;
        this.currentFocusMarkerExpanded = false;
        this.options.updateFocusMarker(listId, null);
      }
      const newControls = this.render(listId, data);
      this.options.setRightControls(newControls.rightControls);
    };

    // Validate focus marker item exists and is not completed; if completed, move to previous item
    let validatedFocusMarkerItemId = this.currentFocusMarkerItemId;
    if (validatedFocusMarkerItemId) {
      const markerItem = sortedItems.find((item) => item.id === validatedFocusMarkerItemId);
      if (!markerItem) {
        // Item no longer exists, disable focus view
        this.currentFocusMarkerItemId = null;
        this.currentFocusMarkerExpanded = false;
        this.options.updateFocusMarker(listId, null);
        validatedFocusMarkerItemId = null;
      } else if (markerItem.completed) {
        // Marker item was completed, move marker to the item that was before it
        // (based on position value, not current sorted order)
        const markerPosition = markerItem.position ?? 0;
        const uncompletedItems = sortedItems.filter((item) => !item.completed && item.id);
        // Find the uncompleted item with the highest position that's less than marker's position
        let previousItem: (typeof sortedItems)[0] | undefined;
        for (const item of uncompletedItems) {
          const itemPosition = item.position ?? 0;
          if (itemPosition < markerPosition) {
            if (!previousItem || itemPosition > (previousItem.position ?? 0)) {
              previousItem = item;
            }
          }
        }
        // If no previous item (marker was first), use first uncompleted item
        if (!previousItem && uncompletedItems.length > 0) {
          previousItem = uncompletedItems[0];
        }
        if (previousItem?.id) {
          this.currentFocusMarkerItemId = previousItem.id;
          this.options.updateFocusMarker(listId, previousItem.id, this.currentFocusMarkerExpanded);
          validatedFocusMarkerItemId = previousItem.id;
        } else {
          // No uncompleted items left, disable focus view
          this.currentFocusMarkerItemId = null;
          this.currentFocusMarkerExpanded = false;
          this.options.updateFocusMarker(listId, null);
          validatedFocusMarkerItemId = null;
        }
      }
    }

    // Focus view is only active when sorted by position and no timeline view
    const focusViewActive =
      isSortedByPosition && !this.currentTimelineField && !!validatedFocusMarkerItemId;

    const handleFocusMarkerMove = (newMarkerItemId: string) => {
      this.currentFocusMarkerItemId = newMarkerItemId;
      this.options.updateFocusMarker(listId, newMarkerItemId, this.currentFocusMarkerExpanded);
      const newControls = this.render(listId, data);
      this.options.setRightControls(newControls.rightControls);
    };

    const handleFocusMarkerExpandedChange = (expanded: boolean) => {
      this.currentFocusMarkerExpanded = expanded;
      this.options.updateFocusMarkerExpanded(listId, expanded);
      const newControls = this.render(listId, data);
      this.options.setRightControls(newControls.rightControls);
    };

    const { table, tbody, colCount, hasAnyItems } = this.tableController.renderTable({
      listId,
      sortedItems,
      columnOrder: showOverride,
      showTitleColumn,
      showUrlColumn,
      showNotesColumn,
      showTagsColumn,
      showAddedColumn,
      showUpdatedColumn,
      showTouchedColumn,
      customFields: this.currentCustomFields,
      visibleCustomFields,
      showAllColumns: this.listViewShowAllColumns,
      columnWidths,
      getColumnVisibility,
      onColumnVisibilityChange: handleColumnVisibilityChange,
      onColumnResize: handleColumnResize,
      sortState: effectiveSortState,
      onSortChange: handleSortChange,
      timelineField: this.currentTimelineField,
      focusMarkerItemId: focusViewActive ? validatedFocusMarkerItemId : null,
      focusMarkerExpanded: this.currentFocusMarkerExpanded,
      onFocusMarkerMove: handleFocusMarkerMove,
      onFocusMarkerExpandedChange: handleFocusMarkerExpandedChange,
      rerender: () => {
        const newControls = this.render(listId, data);
        this.options.setRightControls(newControls.rightControls);
      },
    });

    bodyEl.appendChild(table);
    this.currentSortedItems = sortedItems;
    this.currentColumnState = columnState;
    this.currentTable = { tbody, colCount, hasAnyItems };
    this.applySearch(this.options.getSearchQuery());

    return controls;
  }

  private computeTagState(
    data: ListPanelData,
    items: ListPanelItem[],
  ): { availableTags: string[]; defaultTags: string[] } {
    const availableTags = new Map<string, string>();
    const rememberTag = (tag: string): void => {
      const trimmed = tag.trim();
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (!availableTags.has(lower)) {
        availableTags.set(lower, trimmed);
      }
    };

    if (Array.isArray(data.tags)) {
      for (const tag of data.tags) {
        if (typeof tag === 'string') rememberTag(tag);
      }
    }
    if (Array.isArray(data.defaultTags)) {
      for (const tag of data.defaultTags) {
        if (typeof tag === 'string') rememberTag(tag);
      }
    }
    for (const item of items) {
      if (!Array.isArray(item.tags)) continue;
      for (const tag of item.tags) {
        if (typeof tag === 'string') rememberTag(tag);
      }
    }

    const available = Array.from(availableTags.values()).sort((a, b) => a.localeCompare(b));

    const defaultTags: string[] = [];
    if (Array.isArray(data.defaultTags)) {
      const seen = new Set<string>();
      for (const tag of data.defaultTags) {
        if (typeof tag !== 'string') continue;
        const trimmed = tag.trim();
        if (!trimmed) continue;
        const lower = trimmed.toLowerCase();
        if (seen.has(lower)) continue;
        const canonical = available.find((t) => t.toLowerCase() === lower) ?? trimmed;
        seen.add(lower);
        defaultTags.push(canonical);
      }
    }

    return { availableTags: available, defaultTags };
  }

  private buildColumnState(
    listColumnPrefs: ListColumnPreferences | null,
    items: ListPanelItem[],
    columnOrderOverride: string[] | null,
  ): ListColumnState {
    const isCompactView = !this.listViewShowAllColumns;
    const showOverrideSet = columnOrderOverride ? new Set(columnOrderOverride) : null;

    const resolveVisibilityMode = (
      columnKey: string,
      defaultVisibility: ColumnVisibility,
    ): ColumnVisibility => {
      const config = listColumnPrefs?.[columnKey];
      const value = config?.visibility;
      if (value === 'always-show' || value === 'show-with-data' || value === 'hide-in-compact') {
        return value;
      }
      return defaultVisibility;
    };

    const getColumnVisibility = (columnKey: string): ColumnVisibility => {
      if (showOverrideSet) {
        return showOverrideSet.has(columnKey) ? 'always-show' : 'always-hide';
      }
      if (columnKey === 'title') {
        return 'always-show';
      }
      const defaultVisibility =
        DEFAULT_VISIBILITY_BY_COLUMN[columnKey] ?? ('show-with-data' as ColumnVisibility);
      return resolveVisibilityMode(columnKey, defaultVisibility);
    };

    const presence = getListColumnPresence(items);

    const isColumnVisible = (
      columnKey: string,
      defaultVisibility: ColumnVisibility,
      hasData: boolean,
    ): boolean => {
      const mode = resolveVisibilityMode(columnKey, defaultVisibility);
      switch (mode) {
        case 'always-show':
          return true;
        case 'show-with-data':
          return hasData;
        case 'hide-in-compact':
          return !isCompactView;
        default:
          return true;
      }
    };

    const showTitleColumn = showOverrideSet ? showOverrideSet.has('title') : true;
    const showUrlColumn = showOverrideSet
      ? showOverrideSet.has('url')
      : isColumnVisible('url', 'hide-in-compact', presence.hasUrl);
    const showNotesColumn = showOverrideSet
      ? showOverrideSet.has('notes')
      : isColumnVisible('notes', 'show-with-data', presence.hasNotes);
    const showTagsColumn = showOverrideSet
      ? showOverrideSet.has('tags')
      : isColumnVisible('tags', 'show-with-data', presence.hasTags);
    const showAddedColumn = showOverrideSet
      ? showOverrideSet.has('added')
      : isColumnVisible('added', 'hide-in-compact', presence.hasAdded);
    const showUpdatedColumn = showOverrideSet
      ? showOverrideSet.has('updated')
      : isColumnVisible('updated', 'hide-in-compact', presence.hasUpdated);
    const showTouchedColumn = showOverrideSet
      ? showOverrideSet.has('touched')
      : isColumnVisible('touched', 'hide-in-compact', presence.hasTouched);

    let visibleCustomFields: ListCustomFieldDefinition[] = [];
    if (showOverrideSet && columnOrderOverride) {
      for (const key of columnOrderOverride) {
        const field = this.currentCustomFields.find((entry) => entry.key === key);
        if (field) {
          visibleCustomFields.push(field);
        }
      }
    } else {
      visibleCustomFields = getVisibleCustomFields({
        customFields: this.currentCustomFields,
        items,
        showAllColumns: this.listViewShowAllColumns,
        getColumnVisibility,
      });
    }

    return {
      showTitleColumn,
      showUrlColumn,
      showNotesColumn,
      showTagsColumn,
      showAddedColumn,
      showUpdatedColumn,
      showTouchedColumn,
      visibleCustomFields,
      getColumnVisibility,
    };
  }

  private columnStateMatches(next: ListColumnState): boolean {
    const current = this.currentColumnState;
    if (!current) {
      return false;
    }
    if (
      current.showTitleColumn !== next.showTitleColumn ||
      current.showUrlColumn !== next.showUrlColumn ||
      current.showNotesColumn !== next.showNotesColumn ||
      current.showTagsColumn !== next.showTagsColumn ||
      current.showAddedColumn !== next.showAddedColumn ||
      current.showUpdatedColumn !== next.showUpdatedColumn ||
      current.showTouchedColumn !== next.showTouchedColumn
    ) {
      return false;
    }
    return arraysEqualBy(
      current.visibleCustomFields,
      next.visibleCustomFields,
      (field) => field.key,
    );
  }

  private rerenderCurrent(): void {
    if (!this.currentListId || !this.currentData) {
      return;
    }
    const controls = this.render(this.currentListId, this.currentData);
    this.options.setRightControls(controls.rightControls);
  }

  private async createListItem(listId: string, item: Record<string, unknown>): Promise<boolean> {
    if (!this.options.callOperation) {
      return false;
    }
    try {
      const instanceId = this.addDialogInstanceOverrides.get(listId);
      await this.runOperation(
        'item-add',
        { listId, ...item },
        instanceId ? { instanceId } : undefined,
      );
      if (instanceId) {
        this.addDialogInstanceOverrides.delete(listId);
      }
      return true;
    } catch {
      return false;
    }
  }

  private async updateListItem(
    listId: string,
    itemId: string,
    updates: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.options.callOperation) {
      return false;
    }
    try {
      await this.runOperation('item-update', { listId, id: itemId, ...updates });
      return true;
    } catch {
      return false;
    }
  }

  private async touchListItem(listId: string, itemId: string): Promise<void> {
    if (!this.options.callOperation) {
      this.options.setStatus('Lists tool is unavailable');
      return;
    }
    try {
      const updated = await this.runOperation<ListPanelItem>('item-touch', {
        listId,
        id: itemId,
      });
      if (updated) {
        this.applyTouchUpdate(itemId, updated);
      }
    } catch {
      this.options.setStatus('Failed to clear touch');
    }
  }

  private async clearTouchListItem(listId: string, itemId: string): Promise<void> {
    if (!this.options.callOperation) {
      this.options.setStatus('Lists tool is unavailable');
      return;
    }
    try {
      const updated = await this.runOperation<ListPanelItem>('item-update', {
        listId,
        id: itemId,
        touchedAt: null,
      });
      if (updated) {
        this.applyTouchUpdate(itemId, updated);
      }
    } catch {
      this.options.setStatus('Failed to touch item');
    }
  }

  private applyTouchUpdate(itemId: string, updated: ListPanelItem): void {
    void itemId;
    this.applyItemUpdate(updated);
  }

  private async deleteListItem(listId: string, itemId: string): Promise<boolean> {
    if (!this.options.callOperation) {
      return false;
    }
    try {
      await this.runOperation('item-remove', { listId, id: itemId });
      return true;
    } catch {
      return false;
    }
  }

  private showListItemMenu(
    trigger: HTMLElement,
    listId: string,
    item: ListPanelItem,
    itemId: string,
    row: HTMLTableRowElement,
  ): void {
    this.listItemMenuController.open(trigger, listId, item, itemId, row);
  }

  private showListItemEditorDialog(
    mode: 'add' | 'edit',
    listId: string,
    item?: ListPanelItem,
    openOptionsOverride?: ListItemEditorDialogOpenOptions,
  ): void {
    const openOptions: ListItemEditorDialogOpenOptions = {
      availableTags:
        openOptionsOverride?.availableTags ?? withoutPinnedTag(this.currentAvailableTags),
      customFields: openOptionsOverride?.customFields ?? this.currentCustomFields,
    };
    if (openOptionsOverride?.initialMode) {
      openOptions.initialMode = openOptionsOverride.initialMode;
    }

    if (mode === 'add') {
      const collected: string[] = [];
      const seen = new Set<string>();

      const addTag = (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return;
        const lower = trimmed.toLowerCase();
        if (seen.has(lower)) return;
        const canonical =
          this.currentAvailableTags.find((t) => t.toLowerCase() === lower) ?? trimmed;
        seen.add(lower);
        collected.push(canonical);
      };

      if (Array.isArray(openOptionsOverride?.defaultTags)) {
        openOptions.defaultTags = openOptionsOverride.defaultTags;
      } else {
        for (const tag of this.currentDefaultTags) {
          if (typeof tag === 'string' && !hasPinnedTag([tag])) {
            addTag(tag);
          }
        }

        for (const tag of this.getAppliedTagFilters()) {
          if (!hasPinnedTag([tag])) {
            addTag(tag);
          }
        }

        openOptions.defaultTags = collected;
      }
      openOptions.insertAtTop =
        openOptionsOverride?.insertAtTop ?? this.getInsertAtTopPreference();
    } else if (
      mode === 'edit' &&
      item &&
      item.customFields &&
      typeof item.customFields === 'object'
    ) {
      openOptions.initialCustomFieldValues = item.customFields as Record<string, unknown>;
    }

    this.listItemEditorDialog.open(mode, listId, item, openOptions);
  }

  private showListItemDeleteConfirmation(listId: string, itemId: string, title: string): void {
    this.options.dialogManager.showConfirmDialog({
      title: 'Delete Item',
      message: `Delete "${title}" from this list?`,
      confirmText: 'Delete',
      confirmClassName: 'danger',
      keydownStopsPropagation: true,
      removeKeydownOnButtonClick: true,
      onConfirm: () => {
        void (async () => {
          const ok = await this.deleteListItem(listId, itemId);
          if (!ok) {
            this.options.setStatus('Failed to delete list item');
          }
        })();
      },
      cancelCloseBehavior: 'remove-only',
      confirmCloseBehavior: 'remove-only',
    });
  }

  private showDeleteSelectedItemsConfirmation(listId: string): void {
    const selectedIds = this.options.getSelectedItemIds();
    if (selectedIds.length === 0) {
      return;
    }

    const count = selectedIds.length;
    this.options.dialogManager.showConfirmDialog({
      title: 'Delete Selected Items',
      message: `Delete ${count} selected item${count === 1 ? '' : 's'} from this list? This cannot be undone.`,
      confirmText: 'Delete',
      confirmClassName: 'danger',
      keydownStopsPropagation: true,
      removeKeydownOnButtonClick: true,
      onConfirm: () => {
        this.clearListSelection();
        void (async () => {
          let failed = 0;
          for (const itemId of selectedIds) {
            const ok = await this.deleteListItem(listId, itemId);
            if (!ok) {
              failed++;
            }
          }
          if (failed > 0) {
            this.options.setStatus(`Failed to delete ${failed} item${failed === 1 ? '' : 's'}`);
          }
        })();
      },
      cancelCloseBehavior: 'remove-only',
      confirmCloseBehavior: 'remove-only',
    });
  }

  clearListSelection(): void {
    const bodyEl = this.options.bodyEl;
    if (bodyEl) {
      this.tableController.clearSelection(bodyEl);
    }
  }

  selectItemById(itemId: string, options?: { scroll?: boolean }): boolean {
    const bodyEl = this.options.bodyEl;
    if (!bodyEl) {
      return false;
    }
    return this.tableController.selectItemById(bodyEl, itemId, options);
  }

  private selectVisibleItems(): void {
    const bodyEl = this.options.bodyEl;
    if (!bodyEl) {
      return;
    }
    this.tableController.selectVisible(bodyEl);
  }

  private selectAllItems(): void {
    const bodyEl = this.options.bodyEl;
    if (!bodyEl) {
      return;
    }
    this.tableController.selectAll(bodyEl);
  }

  private async moveSelectedItemsToList(targetListId: string): Promise<void> {
    const selectedIds = this.options.getSelectedItemIds();
    if (selectedIds.length === 0) {
      this.options.setStatus('Select at least one item to move');
      return;
    }

    const trimmedTargetId = targetListId.trim();
    if (!trimmedTargetId) {
      return;
    }

    await this.bulkMoveItems(selectedIds, trimmedTargetId, {
      clearSelection: true,
      sourceListId: this.currentListId ?? null,
    });
  }

  private async showMoveSelectedItemsDialog(): Promise<void> {
    const selectedIds = this.options.getSelectedItemIds();
    if (selectedIds.length === 0) {
      this.options.setStatus('Select at least one item to move');
      return;
    }

    const count = selectedIds.length;
    const targetListId = await this.options.dialogManager.showTextInputDialog({
      title: 'Move Items',
      message: `Move ${count} selected item${count === 1 ? '' : 's'} to which list?`,
      confirmText: 'Move',
      confirmClassName: 'primary',
      cancelText: 'Cancel',
      labelText: 'Target list ID',
      placeholder: 'reading-list',
      validate: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'Target list ID must not be empty';
        }
        return null;
      },
    });

    if (!targetListId) {
      return;
    }

    await this.bulkMoveItems(selectedIds, targetListId.trim(), {
      clearSelection: true,
      sourceListId: this.currentListId ?? null,
    });
  }

  private async bulkMoveItems(
    itemIds: string[],
    targetListId: string,
    options?: {
      clearSelection?: boolean;
      sourceListId?: string | null;
      targetPosition?: number | null;
    },
  ): Promise<boolean> {
    if (itemIds.length === 0) {
      return false;
    }

    if (!this.options.callOperation) {
      this.options.setStatus('Lists tool is unavailable');
      return false;
    }
    try {
      const basePosition =
        typeof options?.targetPosition === 'number' && Number.isFinite(options.targetPosition)
          ? Math.max(0, Math.floor(options.targetPosition))
          : null;
      const result = await this.runOperation('items-bulk-move', {
        operations: itemIds.map((id, index) => ({
          id,
          targetListId,
          ...(basePosition !== null ? { position: basePosition + index } : {}),
        })),
      });
      const { okCount, totalCount } = this.countBulkResults(result, itemIds.length);

      if (options?.clearSelection) {
        this.clearListSelection();
      }

      if (okCount === totalCount) {
        this.options.setStatus(
          `Moved ${okCount} item${okCount === 1 ? '' : 's'} to "${targetListId}"`,
        );
        return true;
      } else if (okCount > 0) {
        const failed = totalCount - okCount;
        this.options.setStatus(
          `Moved ${okCount} item${okCount === 1 ? '' : 's'} to "${targetListId}", ` +
            `but ${failed} failed`,
        );
        return false;
      } else {
        this.options.setStatus('Failed to move items');
        return false;
      }
    } catch (err) {
      console.error('Error performing bulk move:', err);
      this.options.setStatus('Failed to move items');
      return false;
    }
  }

  private async moveItemsToListFromDrag(
    sourceListId: string,
    itemIds: string[],
    targetListId: string,
    targetPosition: number | null,
  ): Promise<void> {
    if (itemIds.length === 0) {
      return;
    }
    const trimmedTargetId = targetListId.trim();
    if (!trimmedTargetId || trimmedTargetId === sourceListId) {
      return;
    }
    await this.bulkMoveItems(itemIds, trimmedTargetId, {
      clearSelection: true,
      sourceListId,
      targetPosition,
    });
  }

  private async moveItemToList(
    listId: string,
    itemId: string,
    targetListId: string,
  ): Promise<void> {
    const trimmedTargetId = targetListId.trim();
    if (!trimmedTargetId) {
      return;
    }
    await this.bulkMoveItems([itemId], trimmedTargetId, {
      clearSelection: false,
      sourceListId: listId,
    });
  }

  private async copySelectedItemsToList(targetListId: string): Promise<void> {
    const selectedIds = this.options.getSelectedItemIds();
    if (selectedIds.length === 0) {
      this.options.setStatus('Select at least one item to copy');
      return;
    }

    const sourceListId = this.currentListId;
    if (!sourceListId) {
      this.options.setStatus('No source list available');
      return;
    }

    const trimmedTargetId = targetListId.trim();
    if (!trimmedTargetId) {
      return;
    }

    await this.copyItemsToList(sourceListId, selectedIds, trimmedTargetId);
  }

  private async copyItemsToList(
    sourceListId: string,
    itemIds: string[],
    targetListId: string,
  ): Promise<void> {
    if (itemIds.length === 0) {
      return;
    }
    const trimmedTargetId = targetListId.trim();
    if (!trimmedTargetId) {
      return;
    }

    if (!this.options.callOperation) {
      this.options.setStatus('Lists tool is unavailable');
      return;
    }
    try {
      const result = await this.runOperation('items-bulk-copy', {
        sourceListId,
        targetListId: trimmedTargetId,
        items: itemIds.map((id) => ({ id })),
      });
      const { okCount, totalCount } = this.countBulkResults(result, itemIds.length);

      if (okCount === totalCount) {
        this.options.setStatus(
          `Copied ${okCount} item${okCount === 1 ? '' : 's'} to "${trimmedTargetId}"`,
        );
      } else if (okCount > 0) {
        const failed = totalCount - okCount;
        this.options.setStatus(
          `Copied ${okCount} item${okCount === 1 ? '' : 's'} to "${trimmedTargetId}", ` +
            `but ${failed} failed`,
        );
      } else {
        this.options.setStatus('Failed to copy items');
      }
    } catch (err) {
      console.error('Error performing bulk copy:', err);
      this.options.setStatus('Failed to copy items');
    }
  }

  private countBulkResults(
    data: unknown,
    fallbackTotal: number,
  ): { okCount: number; totalCount: number } {
    let okCount = 0;
    let totalCount = fallbackTotal;

    if (data && typeof data === 'object') {
      const obj = data as { ok?: unknown; result?: unknown };
      const result = obj.result as { results?: unknown } | undefined;
      const results = result?.results;
      if (Array.isArray(results)) {
        totalCount = results.length;
        for (const entry of results) {
          if (!entry || typeof entry !== 'object') continue;
          const resultEntry = entry as { ok?: unknown };
          if (resultEntry.ok === true) {
            okCount++;
          }
        }
      }
    }

    return { okCount, totalCount };
  }

  private getAppliedTagFilters(): string[] {
    const tagController = this.options.getSearchTagController();
    if (!tagController) {
      return [];
    }
    const parsed = tagController.parseSearchQuery(this.options.getSearchQuery());
    const combined = [...tagController.getActiveTagFilters(), ...parsed.includeTags];
    return Array.from(new Set(combined));
  }

  private filterRows(
    tbody: HTMLTableSectionElement,
    colCount: number,
    hasAnyItems: boolean,
    rawSearch: string,
  ): void {
    const tagController = this.options.getSearchTagController();
    const parsed = tagController
      ? tagController.parseSearchQuery(rawSearch)
      : {
          includeTags: [],
          excludeTags: [],
          text: rawSearch,
          partialTag: null,
          partialTagIsExcluded: false,
        };
    const { includeTags: queryTags, excludeTags: queryExcludedTags, text, partialTag } = parsed;

    const allTagFilters = Array.from(
      new Set([...(tagController?.getActiveTagFilters() ?? []), ...queryTags]),
    );
    const allExcludedTagFilters = Array.from(
      new Set([...(tagController?.getActiveExcludedTagFilters() ?? []), ...queryExcludedTags]),
    );
    const lowerText = text.trim().toLowerCase();
    const hasTextQuery = lowerText.length > 0;
    const hasTagFilters = allTagFilters.length > 0;
    const hasExcludedTagFilters = allExcludedTagFilters.length > 0;
    const hasPartialTag = partialTag !== null && partialTag.length > 0;

    const rows = Array.from(
      tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row[data-item-id]'),
    );

    let anyVisible = false;

    if (!hasTextQuery && !hasTagFilters && !hasExcludedTagFilters && !hasPartialTag) {
      for (const row of rows) {
        row.style.display = '';
      }
      anyVisible = rows.length > 0;
    } else {
      for (const row of rows) {
        const itemTags = (row.dataset['tags'] ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

        let tagMatch = true;
        if (hasTagFilters) {
          for (const filterTag of allTagFilters) {
            if (!itemTags.includes(filterTag)) {
              tagMatch = false;
              break;
            }
          }
        }

        let excludedMatch = false;
        if (hasExcludedTagFilters) {
          excludedMatch = allExcludedTagFilters.some((t) => itemTags.includes(t));
        }

        let partialTagMatch = true;
        if (hasPartialTag && partialTag) {
          partialTagMatch = itemTags.some((t) => t.startsWith(partialTag));
        }

        const searchText = row.dataset['search'] ?? '';
        const textMatch = !hasTextQuery || searchText.includes(lowerText);

        const hit = tagMatch && !excludedMatch && partialTagMatch && textMatch;
        row.style.display = hit ? '' : 'none';
        if (hit) {
          anyVisible = true;
        }
      }
    }

    let noMatchRow = tbody.querySelector<HTMLTableRowElement>('.collection-list-no-match-row');
    const isFiltering = hasTextQuery || hasTagFilters || hasExcludedTagFilters || hasPartialTag;
    if (noMatchRow && (!isFiltering || !hasAnyItems || anyVisible)) {
      noMatchRow.remove();
      noMatchRow = null;
    }

    if (isFiltering && hasAnyItems && !anyVisible) {
      if (!noMatchRow) {
        noMatchRow = document.createElement('tr');
        noMatchRow.className = 'collection-list-empty-row collection-list-no-match-row';
        const cell = document.createElement('td');
        cell.colSpan = colCount;
        cell.textContent = 'No items match this search.';
        noMatchRow.appendChild(cell);
        tbody.appendChild(noMatchRow);
      }
    }
  }

  private getSelectedItems(): ListPanelItem[] {
    const selectedIds = this.options.getSelectedItemIds();
    if (!this.currentData || selectedIds.length === 0) {
      return [];
    }
    const items = this.currentData.items ?? [];
    const byId = new Map(items.map((item) => [item.id, item]));
    return selectedIds.map((id) => byId.get(id)).filter((item): item is ListPanelItem => !!item);
  }

  private openEditForFocusedItem(): boolean {
    const listId = this.currentListId;
    if (!listId || !this.currentData) {
      return false;
    }
    const itemId = this.tableController.getFocusedItemId();
    if (!itemId) {
      return false;
    }
    const item = this.currentData.items?.find((entry) => entry.id === itemId);
    if (!item) {
      return false;
    }
    this.showListItemEditorDialog('edit', listId, item);
    return true;
  }

  private requestDeleteSelectedItems(): boolean {
    if (!this.currentListId) {
      return false;
    }
    const count = this.options.getSelectedItemCount();
    if (count === 0) {
      return false;
    }
    this.showDeleteSelectedItemsConfirmation(this.currentListId);
    return true;
  }

  private applyOptimisticCompletion(item: ListPanelItem, completed: boolean): void {
    const updated: ListPanelItem = { ...item, completed };
    if (completed) {
      updated.completedAt = new Date().toISOString();
    } else {
      delete updated.completedAt;
    }
    this.applyItemUpdate(updated);
  }

  private async toggleSelectedItemsCompleted(): Promise<boolean> {
    const listId = this.currentListId;
    if (!listId) {
      return false;
    }
    const selectedItems = this.getSelectedItems();
    if (selectedItems.length === 0) {
      return false;
    }

    const shouldComplete = selectedItems.some((item) => !item.completed);
    for (const item of selectedItems) {
      if (item.id) {
        this.applyOptimisticCompletion(item, shouldComplete);
      }
    }

    if (selectedItems.length === 1) {
      const itemId = selectedItems[0]?.id;
      if (!itemId) {
        return false;
      }
      const ok = await this.updateListItem(listId, itemId, { completed: shouldComplete });
      if (!ok) {
        this.options.setStatus('Failed to update item');
      }
      return ok;
    }

    if (!this.options.callOperation) {
      this.options.setStatus('Lists tool is unavailable');
      return false;
    }
    try {
      await this.runOperation('items-bulk-update-completed', {
        listId,
        itemIds: selectedItems
          .map((item) => item.id)
          .filter((id): id is string => typeof id === 'string'),
        completed: shouldComplete,
      });
      return true;
    } catch (err) {
      console.error('Error updating completed items:', err);
      this.options.setStatus('Failed to update selected items');
      return false;
    }
  }

  private async togglePinnedForSelection(): Promise<boolean> {
    const listId = this.currentListId;
    if (!listId || !this.currentData) {
      return false;
    }

    let selectedItems = this.getSelectedItems();
    if (selectedItems.length === 0) {
      const focusedId = this.tableController.getFocusedItemId();
      if (!focusedId) {
        return false;
      }
      const focused = this.currentData.items?.find((item) => item.id === focusedId);
      if (focused) {
        selectedItems = [focused];
      }
    }

    if (selectedItems.length === 0) {
      return false;
    }

    const shouldPin = !selectedItems.every((item) => hasPinnedTag(item.tags));
    const itemIds = selectedItems
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string');

    if (itemIds.length === 0) {
      return false;
    }

    if (!this.options.callOperation) {
      this.options.setStatus('Lists tool is unavailable');
      return false;
    }

    try {
      await this.runOperation('items-bulk-update-tags', {
        listId,
        items: itemIds.map((id) => ({
          id,
          ...(shouldPin ? { addTags: [PINNED_TAG] } : { removeTags: [PINNED_TAG] }),
        })),
      });
      return true;
    } catch (err) {
      console.error('Error updating pinned items:', err);
      this.options.setStatus('Failed to update pinned items');
      return false;
    }
  }

  private async moveFocusedItemByOffset(offset: -1 | 1): Promise<boolean> {
    const listId = this.currentListId;
    if (!listId || !this.currentData) {
      return false;
    }
    const selectedIds = this.options.getSelectedItemIds();
    if (selectedIds.length !== 1) {
      return false;
    }
    const itemId = selectedIds[0];
    if (!itemId) {
      return false;
    }
    const currentIndex = this.currentSortedItems.findIndex((item) => item.id === itemId);
    if (currentIndex === -1) {
      return false;
    }
    const nextIndex = currentIndex + offset;
    if (nextIndex < 0 || nextIndex >= this.currentSortedItems.length) {
      return false;
    }
    const currentItem = this.currentSortedItems[currentIndex];
    const nextItem = this.currentSortedItems[nextIndex];
    if (!currentItem || !nextItem) {
      return false;
    }
    const currentCompleted = currentItem.completed ?? false;
    const nextCompleted = nextItem.completed ?? false;
    if (currentCompleted !== nextCompleted) {
      return false;
    }
    this.options.recentUserItemUpdates.add(itemId);
    window.setTimeout(() => {
      this.options.recentUserItemUpdates.delete(itemId);
    }, this.options.userUpdateTimeoutMs);
    const ok = await this.updateListItem(listId, itemId, { position: nextIndex });
    if (!ok) {
      this.options.setStatus('Failed to move item');
    }
    return ok;
  }

  private async moveFocusedItemToBoundary(
    boundary: 'top' | 'bottom',
  ): Promise<boolean> {
    const listId = this.currentListId;
    if (!listId) {
      return false;
    }
    const selectedIds = this.options.getSelectedItemIds();
    if (selectedIds.length !== 1) {
      return false;
    }
    const itemId = selectedIds[0];
    if (!itemId) {
      return false;
    }
    this.options.recentUserItemUpdates.add(itemId);
    window.setTimeout(() => {
      this.options.recentUserItemUpdates.delete(itemId);
    }, this.options.userUpdateTimeoutMs);
    const position = boundary === 'top' ? 0 : Number.MAX_SAFE_INTEGER;
    const ok = await this.updateListItem(listId, itemId, { position });
    if (!ok) {
      this.options.setStatus('Failed to move item');
    }
    return ok;
  }
}

export const __TEST_ONLY = {
  clearListClipboard,
  getListClipboard,
};
