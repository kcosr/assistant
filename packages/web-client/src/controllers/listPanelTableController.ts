import { applyMarkdownToElement } from '../utils/markdown';
import { hasPinnedTag } from '../utils/pinnedTag';
import type { ListCustomFieldDefinition } from './listCustomFields';
import type { ListPanelItem } from './listPanelController';
import type { ColumnVisibility } from '../utils/listColumnPreferences';
import { getVisibleCustomFields, normalizeListCustomFields } from '../utils/listColumnVisibility';
import type { SortState } from '../utils/listSorting';
import { parseFieldValueToDate, toggleSort } from '../utils/listSorting';

const NOTES_EXPAND_ICON_SVG = `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="12" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 11h6M9 15h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const LIST_ITEM_DRAG_TYPE = 'application/x-list-item';
const LIST_ITEMS_DRAG_TYPE = 'application/x-list-items';
const LIST_SINGLE_CLICK_SELECTION_STORAGE_KEY = 'aiAssistantListSingleClickSelectionEnabled';
const LIST_INLINE_CUSTOM_FIELD_EDITING_STORAGE_KEY =
  'aiAssistantListInlineCustomFieldEditingEnabled';

export interface ListPanelTableControllerOptions {
  icons: {
    moreVertical: string;
    pin: string;
  };
  renderTags: (tags: string[] | undefined) => HTMLElement | null;
  recentUserItemUpdates: Set<string>;
  userUpdateTimeoutMs: number;
  getSelectedItemCount: () => number;
  getExternalDragPayload?: (params: {
    listId: string;
    itemIds: string[];
    primaryItemId: string;
  }) => { plainText?: string; html?: string } | null;
  onSelectionChange?: () => void;
  showListItemMenu: (
    trigger: HTMLElement,
    listId: string,
    item: ListPanelItem,
    itemId: string,
    row: HTMLTableRowElement,
  ) => void;
  updateListItem: (
    listId: string,
    itemId: string,
    updates: Record<string, unknown>,
  ) => Promise<boolean>;
  onMoveItemsToList?: (
    sourceListId: string,
    itemIds: string[],
    targetListId: string,
    targetPosition: number | null,
  ) => Promise<void>;
  onEditItem?: (listId: string, item: ListPanelItem) => void;
  onColumnResize?: (listId: string, columnKey: string, width: number) => void;
}

export interface ListPanelTableRenderOptions {
  listId: string;
  sortedItems: ListPanelItem[];
  columnOrder?: string[] | null;
  showTitleColumn?: boolean;
  showUrlColumn: boolean;
  showNotesColumn: boolean;
  showTagsColumn: boolean;
  showAddedColumn: boolean;
  showUpdatedColumn?: boolean;
  showTouchedColumn?: boolean;
  customFields?: ListCustomFieldDefinition[];
  visibleCustomFields?: ListCustomFieldDefinition[];
  showAllColumns?: boolean;
  columnWidths?: Record<string, number>;
  getColumnVisibility?: (columnKey: string) => ColumnVisibility;
  onColumnVisibilityChange?: (columnKey: string, visibility: ColumnVisibility) => void;
  onColumnResize?: (columnKey: string, width: number) => void;
  sortState?: SortState | null;
  onSortChange?: (sortState: SortState | null) => void;
  timelineField?: string | null;
  focusMarkerItemId?: string | null;
  focusMarkerExpanded?: boolean;
  onFocusMarkerMove?: (newMarkerItemId: string) => void;
  onFocusMarkerExpandedChange?: (expanded: boolean) => void;
  rerender: () => void;
}

export interface ListPanelTableRenderResult {
  table: HTMLTableElement;
  tbody: HTMLTableSectionElement;
  colCount: number;
  hasAnyItems: boolean;
}

type ListPanelTableRenderState = {
  listId: string;
  tbody: HTMLTableSectionElement;
  colCount: number;
  columnOrder: string[] | null;
  showTitleColumn: boolean;
  showUrlColumn: boolean;
  showNotesColumn: boolean;
  showTagsColumn: boolean;
  showAddedColumn: boolean;
  showUpdatedColumn: boolean;
  showTouchedColumn: boolean;
  visibleCustomFields: ListCustomFieldDefinition[];
  timelineFieldDef: ListCustomFieldDefinition | null;
  focusMarkerItemId: string | null;
  focusMarkerExpanded: boolean;
  onFocusMarkerMove: ((newMarkerItemId: string) => void) | undefined;
  onFocusMarkerExpandedChange: ((expanded: boolean) => void) | undefined;
  now: Date;
  rerender: () => void;
};

type ListPanelRowRenderOptions = {
  listId: string;
  item: ListPanelItem;
  index: number;
  sortedItems: ListPanelItem[];
  tbody: HTMLTableSectionElement;
  showTitleColumn: boolean;
  showUrlColumn: boolean;
  showNotesColumn: boolean;
  showTagsColumn: boolean;
  showAddedColumn: boolean;
  showUpdatedColumn: boolean;
  showTouchedColumn: boolean;
  visibleCustomFields: ListCustomFieldDefinition[];
  timelineFieldDef: ListCustomFieldDefinition | null;
  now: Date;
  rerender: () => void;
};

export class ListPanelTableController {
  private draggedItemId: string | null = null;
  private draggedItemIds: string[] | null = null;
  private draggedListId: string | null = null;
  private lastSelectedRowIndex: number | null = null;
  private keyboardSelectionAnchorIndex: number | null = null;
  private activeColumnMenu: HTMLElement | null = null;
  private notesPopup: HTMLElement | null = null;
  private notesPopupHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private notesPopupShowTimeout: ReturnType<typeof setTimeout> | null = null;
  private renderState: ListPanelTableRenderState | null = null;

  constructor(private readonly options: ListPanelTableControllerOptions) {
    if (typeof document !== 'undefined') {
      document.addEventListener('assistant:list-inline-custom-field-editing-updated', () => {
        this.renderState?.rerender();
      });
    }
  }

  private getOrCreateNotesPopup(): HTMLElement {
    if (this.notesPopup && this.notesPopup.isConnected) {
      return this.notesPopup;
    }
    const popup = document.createElement('div');
    popup.className = 'list-item-notes-popup';
    document.body.appendChild(popup);
    this.notesPopup = popup;

    // Hide popup when mouse leaves it
    popup.addEventListener('mouseleave', () => {
      this.hideNotesPopup();
    });

    // Keep popup visible while mouse is over it
    popup.addEventListener('mouseenter', () => {
      if (this.notesPopupHideTimeout) {
        clearTimeout(this.notesPopupHideTimeout);
        this.notesPopupHideTimeout = null;
      }
    });

    return popup;
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  private async copyFormattedToClipboard(html: string, plainText: string): Promise<boolean> {
    try {
      const blob = new Blob([html], { type: 'text/html' });
      const textBlob = new Blob([plainText], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blob,
          'text/plain': textBlob,
        }),
      ]);
      return true;
    } catch {
      // Fallback to plain text
      return this.copyToClipboard(plainText);
    }
  }

  private scheduleShowNotesPopup(notes: string, mouseX: number, mouseY: number): void {
    this.cancelShowNotesPopup();
    this.notesPopupShowTimeout = setTimeout(() => {
      this.showNotesPopup(notes, mouseX, mouseY);
    }, 400);
  }

  private cancelShowNotesPopup(): void {
    if (this.notesPopupShowTimeout) {
      clearTimeout(this.notesPopupShowTimeout);
      this.notesPopupShowTimeout = null;
    }
  }

  private showNotesPopup(notes: string, mouseX: number, mouseY: number): void {
    if (this.notesPopupHideTimeout) {
      clearTimeout(this.notesPopupHideTimeout);
      this.notesPopupHideTimeout = null;
    }

    const popup = this.getOrCreateNotesPopup();
    popup.innerHTML = '';

    // Create header with copy buttons
    const header = document.createElement('div');
    header.className = 'list-item-notes-popup-header';

    const copyWrapper = document.createElement('div');
    copyWrapper.className = 'list-item-notes-popup-copy-wrapper';

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'list-item-notes-popup-copy-button';
    copyButton.textContent = 'Copy';

    const copyDropdownButton = document.createElement('button');
    copyDropdownButton.type = 'button';
    copyDropdownButton.className = 'list-item-notes-popup-copy-dropdown';
    copyDropdownButton.innerHTML = '▾';

    const copyMenu = document.createElement('div');
    copyMenu.className = 'list-item-notes-popup-copy-menu';

    const copyFormattedItem = document.createElement('button');
    copyFormattedItem.type = 'button';
    copyFormattedItem.className = 'list-item-notes-popup-copy-menu-item';
    copyFormattedItem.textContent = 'Copy formatted';

    copyMenu.appendChild(copyFormattedItem);
    copyWrapper.appendChild(copyButton);
    copyWrapper.appendChild(copyDropdownButton);
    copyWrapper.appendChild(copyMenu);
    header.appendChild(copyWrapper);
    popup.appendChild(header);

    // Content area
    const content = document.createElement('div');
    content.className = 'list-item-notes-popup-content';
    applyMarkdownToElement(content, notes);
    popup.appendChild(content);

    // Copy button handlers
    const showCopySuccess = (): void => {
      const originalText = copyButton.textContent;
      copyButton.textContent = 'Copied!';
      copyButton.disabled = true;
      setTimeout(() => {
        copyButton.textContent = originalText;
        copyButton.disabled = false;
      }, 1500);
    };

    copyButton.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.copyToClipboard(notes).then((ok) => {
        if (ok) showCopySuccess();
      });
    });

    let menuOpen = false;
    const toggleMenu = (open: boolean): void => {
      menuOpen = open;
      copyMenu.classList.toggle('visible', open);
    };

    copyDropdownButton.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(!menuOpen);
    });

    copyFormattedItem.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu(false);
      void this.copyFormattedToClipboard(content.innerHTML, content.textContent || '').then(
        (ok) => {
          if (ok) showCopySuccess();
        },
      );
    });

    popup.classList.add('visible');

    // Measure actual popup size after content is rendered
    const popupRect = popup.getBoundingClientRect();
    const popupWidth = popupRect.width;
    const popupHeight = popupRect.height;
    const gap = 32;

    // Align right edge of popup to left of cursor
    let left = mouseX - popupWidth - gap;
    if (left < 16) {
      // Not enough space on left, position to the right of cursor
      left = mouseX + gap;
    }
    if (left + popupWidth > window.innerWidth - 16) {
      left = window.innerWidth - popupWidth - 16;
    }

    // Center vertically on cursor, keep within viewport
    let top = mouseY - popupHeight / 2;
    if (top < 16) {
      top = 16;
    }
    if (top + popupHeight > window.innerHeight - 16) {
      top = window.innerHeight - popupHeight - 16;
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }

  private hideNotesPopup(): void {
    if (this.notesPopupHideTimeout) {
      clearTimeout(this.notesPopupHideTimeout);
    }
    this.notesPopupHideTimeout = setTimeout(() => {
      if (this.notesPopup) {
        this.notesPopup.classList.remove('visible');
      }
      this.notesPopupHideTimeout = null;
    }, 150);
  }

  renderTable(renderOptions: ListPanelTableRenderOptions): ListPanelTableRenderResult {
    this.keyboardSelectionAnchorIndex = null;
    const {
      listId,
      sortedItems,
      columnOrder,
      showTitleColumn = true,
      showUrlColumn,
      showNotesColumn,
      showTagsColumn,
      showAddedColumn,
      showUpdatedColumn = false,
      showTouchedColumn = false,
      customFields,
      showAllColumns,
      columnWidths,
      getColumnVisibility,
      onColumnVisibilityChange,
      onColumnResize,
      sortState,
      onSortChange,
      timelineField,
      focusMarkerItemId,
      focusMarkerExpanded = false,
      onFocusMarkerMove,
      onFocusMarkerExpandedChange,
      rerender,
    } = renderOptions;

    const normalizedCustomFields = normalizeListCustomFields(customFields);
    const visibleCustomFields =
      renderOptions.visibleCustomFields ??
      getVisibleCustomFields({
        customFields: normalizedCustomFields,
        items: sortedItems,
        showAllColumns: !!showAllColumns,
        ...(getColumnVisibility ? { getColumnVisibility } : {}),
      });

    const table = document.createElement('table');
    table.className = 'collection-list-table';
    table.dataset['listId'] = listId;

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    const checkboxHeader = document.createElement('th');
    checkboxHeader.className = 'list-item-checkbox-header';
    checkboxHeader.dataset['columnKey'] = 'checkbox';
    if (onSortChange) {
      checkboxHeader.style.cursor = 'pointer';
      checkboxHeader.title = 'Sort by position';
      const indicator = document.createElement('span');
      indicator.className = 'sort-indicator';
      const isSorted = sortState?.column === 'position';
      if (isSorted) {
        checkboxHeader.classList.add('sorted');
        indicator.textContent = sortState.direction === 'asc' ? ' ▲' : ' ▼';
      } else {
        indicator.textContent = '';
      }
      checkboxHeader.appendChild(indicator);
      checkboxHeader.addEventListener('click', () => {
        const newSortState = toggleSort(sortState ?? null, 'position');
        onSortChange(newSortState);
      });
    }
    headerRow.appendChild(checkboxHeader);

    if (showTitleColumn) {
      const titleHeader = document.createElement('th');
      titleHeader.textContent = 'Title';
      titleHeader.dataset['columnKey'] = 'title';
      this.makeSortableHeader(titleHeader, 'title', sortState, onSortChange);
      headerRow.appendChild(titleHeader);
    }

    if (showUrlColumn) {
      const urlHeader = document.createElement('th');
      urlHeader.textContent = 'URL';
      urlHeader.dataset['columnKey'] = 'url';
      this.makeSortableHeader(urlHeader, 'url', sortState, onSortChange);
      this.addColumnContextMenu(urlHeader, 'url', 'URL', getColumnVisibility, (visibility) =>
        onColumnVisibilityChange?.('url', visibility),
      );
      headerRow.appendChild(urlHeader);
    }

    if (showNotesColumn) {
      const notesHeader = document.createElement('th');
      notesHeader.textContent = 'Notes';
      notesHeader.dataset['columnKey'] = 'notes';
      this.makeSortableHeader(notesHeader, 'notes', sortState, onSortChange);
      this.addColumnContextMenu(notesHeader, 'notes', 'Notes', getColumnVisibility, (visibility) =>
        onColumnVisibilityChange?.('notes', visibility),
      );
      headerRow.appendChild(notesHeader);
    }

    // Custom fields come after Notes
    for (const field of visibleCustomFields) {
      const customHeader = document.createElement('th');
      customHeader.textContent = field.label;
      const key = field.key;
      if (key) {
        customHeader.dataset['columnKey'] = key;
        this.makeSortableHeader(customHeader, key, sortState, onSortChange);
        this.addColumnContextMenu(
          customHeader,
          key,
          field.label,
          getColumnVisibility,
          (visibility) => onColumnVisibilityChange?.(key, visibility),
        );
      }
      headerRow.appendChild(customHeader);
    }

    if (showTagsColumn) {
      const tagsHeader = document.createElement('th');
      tagsHeader.textContent = 'Tags';
      tagsHeader.dataset['columnKey'] = 'tags';
      this.makeSortableHeader(tagsHeader, 'tags', sortState, onSortChange);
      this.addColumnContextMenu(tagsHeader, 'tags', 'Tags', getColumnVisibility, (visibility) =>
        onColumnVisibilityChange?.('tags', visibility),
      );
      headerRow.appendChild(tagsHeader);
    }

    if (showAddedColumn) {
      const addedHeader = document.createElement('th');
      addedHeader.textContent = 'Added';
      addedHeader.dataset['columnKey'] = 'added';
      this.makeSortableHeader(addedHeader, 'added', sortState, onSortChange);
      this.addColumnContextMenu(addedHeader, 'added', 'Added', getColumnVisibility, (visibility) =>
        onColumnVisibilityChange?.('added', visibility),
      );
      headerRow.appendChild(addedHeader);
    }

    if (showUpdatedColumn) {
      const updatedHeader = document.createElement('th');
      updatedHeader.textContent = 'Updated';
      updatedHeader.dataset['columnKey'] = 'updated';
      this.makeSortableHeader(updatedHeader, 'updated', sortState, onSortChange);
      this.addColumnContextMenu(
        updatedHeader,
        'updated',
        'Updated',
        getColumnVisibility,
        (visibility) => onColumnVisibilityChange?.('updated', visibility),
      );
      headerRow.appendChild(updatedHeader);
    }

    if (showTouchedColumn) {
      const touchedHeader = document.createElement('th');
      touchedHeader.textContent = 'Touched';
      touchedHeader.dataset['columnKey'] = 'touched';
      this.makeSortableHeader(touchedHeader, 'touched', sortState, onSortChange);
      this.addColumnContextMenu(
        touchedHeader,
        'touched',
        'Touched',
        getColumnVisibility,
        (visibility) => onColumnVisibilityChange?.('touched', visibility),
      );
      headerRow.appendChild(touchedHeader);
    }

    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    tbody.dataset['listId'] = listId;

    const colCount =
      1 +
      (showTitleColumn ? 1 : 0) +
      (showUrlColumn ? 1 : 0) +
      visibleCustomFields.length +
      (showNotesColumn ? 1 : 0) +
      (showTagsColumn ? 1 : 0) +
      (showAddedColumn ? 1 : 0) +
      (showUpdatedColumn ? 1 : 0) +
      (showTouchedColumn ? 1 : 0);

    const hasAnyItems = sortedItems.length > 0;

    // Timeline view: find the field to use for timeline indicator
    let timelineFieldDef: ListCustomFieldDefinition | null = null;
    if (timelineField) {
      timelineFieldDef = normalizedCustomFields.find((f) => f.key === timelineField) ?? null;
    }

    const now = new Date();
    let nowIndicatorInserted = false;

    // Helper to create NOW indicator row
    const createNowIndicatorRow = (): HTMLTableRowElement => {
      const nowRow = document.createElement('tr');
      nowRow.className = 'timeline-now-indicator-row';
      const nowCell = document.createElement('td');
      nowCell.colSpan = colCount;

      const indicator = document.createElement('div');
      indicator.className = 'timeline-now-indicator';

      const badge = document.createElement('span');
      badge.className = 'timeline-now-badge';

      // Format based on the timeline field type
      const fieldType = timelineFieldDef!.type;
      let timeText: string;
      if (fieldType === 'time') {
        timeText = now.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        });
      } else if (fieldType === 'date') {
        timeText = now.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
      } else {
        timeText = now.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });
      }
      badge.textContent = `Now · ${timeText}`;

      indicator.appendChild(badge);
      nowCell.appendChild(indicator);
      nowRow.appendChild(nowCell);
      return nowRow;
    };

    // Helper to create the focus marker row
    const createFocusMarkerRow = (expanded: boolean): HTMLTableRowElement => {
      const markerRow = document.createElement('tr');
      markerRow.className = 'focus-marker-row';
      markerRow.draggable = false;
      const markerCell = document.createElement('td');
      markerCell.colSpan = colCount;

      const indicator = document.createElement('div');
      indicator.className = 'focus-marker-indicator';

      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'focus-marker-badge';
      badge.setAttribute('aria-label', expanded ? 'Collapse items below' : 'Expand items below');
      badge.title = expanded ? 'Collapse items below' : 'Expand items below';

      // Caret icon - points down when collapsed (items hidden), up when expanded
      const caretSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      caretSvg.setAttribute('class', 'focus-marker-caret');
      caretSvg.setAttribute('viewBox', '0 0 24 24');
      caretSvg.setAttribute('aria-hidden', 'true');
      const caretPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      caretPath.setAttribute('fill', 'none');
      caretPath.setAttribute('stroke', 'currentColor');
      caretPath.setAttribute('stroke-width', '2');
      caretPath.setAttribute('stroke-linecap', 'round');
      caretPath.setAttribute('stroke-linejoin', 'round');
      // Chevron down when collapsed, chevron up when expanded
      caretPath.setAttribute('d', expanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6');
      caretSvg.appendChild(caretPath);
      badge.appendChild(caretSvg);

      badge.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onFocusMarkerExpandedChange?.(!expanded);
      });

      indicator.appendChild(badge);
      markerCell.appendChild(indicator);
      markerRow.appendChild(markerCell);

      const clearFocusMarkerDropTargets = (): void => {
        tbody.querySelectorAll('.focus-marker-drop-target').forEach((el) => {
          el.classList.remove('focus-marker-drop-target');
        });
      };

      // Touch handling for mobile - same pattern as item drag handles
      const isCoarsePointer =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;

      if (!isCoarsePointer) {
        const POINTER_DRAG_THRESHOLD = 6;
        let pointerDragActive = false;
        let pointerDragStarted = false;
        let pointerStartX = 0;
        let pointerStartY = 0;
        let pointerCurrentDropRow: HTMLTableRowElement | null = null;

        const pointerEventTargets: EventTarget[] = [document, window];
        const toPointerEvent = (event: Event): PointerEvent | null => {
          if ('pointerType' in event) {
            return event as PointerEvent;
          }
          return null;
        };

        const getDropRowFromEvent = (event: PointerEvent): HTMLTableRowElement | null => {
          const target = event.target;
          if (target instanceof Element) {
            const row = target.closest<HTMLTableRowElement>('.list-item-row');
            if (row) {
              return row;
            }
          }

          const element = document.elementFromPoint(event.clientX, event.clientY);
          return element?.closest<HTMLTableRowElement>('.list-item-row') ?? null;
        };

        const updatePointerTarget = (event: PointerEvent): void => {
          const targetRow = getDropRowFromEvent(event);

          if (targetRow) {
            if (pointerCurrentDropRow && pointerCurrentDropRow !== targetRow) {
              pointerCurrentDropRow.classList.remove('focus-marker-drop-target');
            }
            pointerCurrentDropRow = targetRow;
            pointerCurrentDropRow.classList.add('focus-marker-drop-target');
          } else if (pointerCurrentDropRow) {
            pointerCurrentDropRow.classList.remove('focus-marker-drop-target');
            pointerCurrentDropRow = null;
          }
        };

        const cleanupPointerListeners = (): void => {
          pointerEventTargets.forEach((target) => {
            target.removeEventListener('pointermove', handlePointerMove);
            target.removeEventListener('pointerup', handlePointerUp);
            target.removeEventListener('pointercancel', handlePointerCancel);
          });
        };

        const finishPointerDrag = (event?: Event): void => {
          if (!pointerDragActive) {
            return;
          }
          pointerDragActive = false;
          cleanupPointerListeners();

          if (!pointerDragStarted) {
            pointerCurrentDropRow = null;
            return;
          }

          event?.preventDefault();
          pointerDragStarted = false;
          markerRow.classList.remove('focus-marker-dragging');

          if (pointerCurrentDropRow) {
            const targetItemId = pointerCurrentDropRow.dataset['itemId'];
            pointerCurrentDropRow.classList.remove('focus-marker-drop-target');
            pointerCurrentDropRow = null;
            if (targetItemId) {
              onFocusMarkerMove?.(targetItemId);
            }
          } else {
            clearFocusMarkerDropTargets();
          }
        };

        const handlePointerMove = (event: Event): void => {
          const pointerEvent = toPointerEvent(event);
          if (!pointerEvent || !pointerDragActive || pointerEvent.pointerType === 'touch') {
            return;
          }

          const dx = Math.abs(pointerEvent.clientX - pointerStartX);
          const dy = Math.abs(pointerEvent.clientY - pointerStartY);

          if (!pointerDragStarted && (dx > POINTER_DRAG_THRESHOLD || dy > POINTER_DRAG_THRESHOLD)) {
            pointerDragStarted = true;
            markerRow.classList.add('focus-marker-dragging');
          }

          if (!pointerDragStarted) {
            return;
          }

          pointerEvent.preventDefault();
          updatePointerTarget(pointerEvent);
        };

        const handlePointerUp = (event: Event): void => {
          const pointerEvent = toPointerEvent(event);
          if (!pointerEvent || !pointerDragActive || pointerEvent.pointerType === 'touch') {
            return;
          }
          finishPointerDrag(pointerEvent);
        };

        const handlePointerCancel = (event: Event): void => {
          const pointerEvent = toPointerEvent(event);
          if (!pointerEvent || !pointerDragActive || pointerEvent.pointerType === 'touch') {
            return;
          }
          finishPointerDrag(pointerEvent);
        };

        markerRow.addEventListener('pointerdown', (event: PointerEvent) => {
          if (event.button !== 0 || event.pointerType === 'touch') {
            return;
          }

          pointerDragActive = true;
          pointerDragStarted = false;
          pointerStartX = event.clientX;
          pointerStartY = event.clientY;
          pointerCurrentDropRow = null;

          pointerEventTargets.forEach((target) => {
            target.addEventListener('pointermove', handlePointerMove);
            target.addEventListener('pointerup', handlePointerUp);
            target.addEventListener('pointercancel', handlePointerCancel);
          });
        });
      }

      if (isCoarsePointer) {
        let touchStartX = 0;
        let touchStartY = 0;
        let touchDragActive = false;
        let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
        let touchCurrentDropRow: HTMLTableRowElement | null = null;

        markerRow.addEventListener(
          'touchstart',
          (e) => {
            const touch = e.touches[0];
            if (!touch) return;

            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
            touchDragActive = false;

            if (touchLongPressTimer !== null) {
              clearTimeout(touchLongPressTimer);
            }

            touchLongPressTimer = setTimeout(() => {
              touchDragActive = true;
              markerRow.classList.add('focus-marker-dragging');
            }, 350);
          },
          { passive: true },
        );

        markerRow.addEventListener(
          'touchmove',
          (e) => {
            const touch = e.touches[0];
            if (!touch) return;

            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);

            if (!touchDragActive && (dx > 8 || dy > 8)) {
              if (touchLongPressTimer !== null) {
                clearTimeout(touchLongPressTimer);
                touchLongPressTimer = null;
              }
            }

            if (!touchDragActive) return;

            e.preventDefault();

            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetRow = element?.closest<HTMLTableRowElement>('.list-item-row');

            if (targetRow) {
              if (touchCurrentDropRow && touchCurrentDropRow !== targetRow) {
                touchCurrentDropRow.classList.remove('focus-marker-drop-target');
              }
              touchCurrentDropRow = targetRow;
              touchCurrentDropRow.classList.add('focus-marker-drop-target');
            } else if (touchCurrentDropRow) {
              touchCurrentDropRow.classList.remove('focus-marker-drop-target');
              touchCurrentDropRow = null;
            }
          },
          { passive: false },
        );

        markerRow.addEventListener('touchend', (e) => {
          if (touchLongPressTimer !== null) {
            clearTimeout(touchLongPressTimer);
            touchLongPressTimer = null;
          }

          if (!touchDragActive) return;

          e.preventDefault();
          touchDragActive = false;
          markerRow.classList.remove('focus-marker-dragging');

          if (!touchCurrentDropRow) return;

          const targetItemId = touchCurrentDropRow.dataset['itemId'];
          touchCurrentDropRow.classList.remove('focus-marker-drop-target');
          touchCurrentDropRow = null;

          if (targetItemId) {
            onFocusMarkerMove?.(targetItemId);
          }
        });
      }

      return markerRow;
    };

    // Track if we've inserted the focus marker
    let focusMarkerInserted = false;

    if (!hasAnyItems) {
      const emptyRow = document.createElement('tr');
      emptyRow.className = 'collection-list-empty-row';
      const cell = document.createElement('td');
      cell.colSpan = colCount;
      cell.textContent = 'This list has no items yet.';
      emptyRow.appendChild(cell);
      tbody.appendChild(emptyRow);
    } else {
      // Track the last past item index for timeline view
      let lastPastItemIndex = -1;

      for (let i = 0; i < sortedItems.length; i++) {
        const item = sortedItems[i];
        if (!item) continue;
        const isCompleted = item.completed ?? false;
        const itemId = item.id;

        // Timeline view: check if we need to insert "now" indicator before this item
        if (timelineFieldDef && !nowIndicatorInserted && !isCompleted) {
          const fieldValue = item.customFields?.[timelineFieldDef.key];
          const itemDate = parseFieldValueToDate(
            fieldValue,
            timelineFieldDef.type as 'date' | 'time' | 'datetime',
          );

          if (itemDate) {
            if (itemDate > now) {
              // Found a future item - insert NOW indicator before it
              tbody.appendChild(createNowIndicatorRow());
              nowIndicatorInserted = true;
            } else {
              // This is a past item - track it
              lastPastItemIndex = i;
            }
          } else if (lastPastItemIndex >= 0 && !nowIndicatorInserted) {
            // We hit an item with no date after past items - insert NOW indicator here
            tbody.appendChild(createNowIndicatorRow());
            nowIndicatorInserted = true;
          }
        }

        const row = this.buildItemRow({
          listId,
          item,
          index: i,
          sortedItems,
          tbody,
          showTitleColumn,
          showUrlColumn,
          showNotesColumn,
          showTagsColumn,
          showAddedColumn,
          showUpdatedColumn,
          showTouchedColumn,
          visibleCustomFields,
          timelineFieldDef,
          now,
          rerender,
        });

        // Hide rows below the focus marker when collapsed
        if (focusMarkerInserted && !focusMarkerExpanded) {
          row.classList.add('focus-marker-hidden');
        }

        // Add drop target handling for focus marker repositioning
        if (focusMarkerItemId && onFocusMarkerMove && itemId) {
          row.addEventListener('dragover', (e) => {
            const dt = e.dataTransfer;
            if (!dt || dt.getData('text/plain') !== 'focus-marker') return;
            e.preventDefault();
            e.stopPropagation();
            if (dt) dt.dropEffect = 'move';
            row.classList.add('focus-marker-drop-target');
          });

          row.addEventListener('dragleave', () => {
            row.classList.remove('focus-marker-drop-target');
          });

          row.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            row.classList.remove('focus-marker-drop-target');
            const dt = e.dataTransfer;
            if (!dt || dt.getData('text/plain') !== 'focus-marker') return;
            // Move marker to after this item
            if (itemId && itemId !== focusMarkerItemId) {
              onFocusMarkerMove(itemId);
            }
          });
        }

        tbody.appendChild(row);

        // Insert focus marker after the target item
        if (focusMarkerItemId && itemId === focusMarkerItemId && !focusMarkerInserted) {
          tbody.appendChild(createFocusMarkerRow(focusMarkerExpanded));
          focusMarkerInserted = true;
        }
      }
    }

    table.appendChild(tbody);

    const orderedKeys = columnOrder && columnOrder.length > 0 ? ['checkbox', ...columnOrder] : null;
    if (orderedKeys) {
      this.applyColumnOrder(headerRow, tbody, orderedKeys);
    }

    this.initializeColumnResizeHandles(headerRow, tbody, listId, columnWidths, onColumnResize);

    this.renderState = {
      listId,
      tbody,
      colCount,
      columnOrder: orderedKeys,
      showTitleColumn,
      showUrlColumn,
      showNotesColumn,
      showTagsColumn,
      showAddedColumn,
      showUpdatedColumn,
      showTouchedColumn,
      visibleCustomFields,
      timelineFieldDef,
      focusMarkerItemId: focusMarkerItemId ?? null,
      focusMarkerExpanded,
      onFocusMarkerMove,
      onFocusMarkerExpandedChange,
      now,
      rerender,
    };

    return { table, tbody, colCount, hasAnyItems };
  }

  updateRow(item: ListPanelItem, sortedItems: ListPanelItem[]): boolean {
    const state = this.renderState;
    if (!state) {
      return false;
    }
    const { focusMarkerExpanded, focusMarkerItemId, onFocusMarkerMove } = state;
    const itemId = item.id;
    if (!itemId) {
      return false;
    }
    const rows = Array.from(state.tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row'));
    const existingRow = rows.find((row) => row.dataset['itemId'] === itemId);
    if (!existingRow) {
      return false;
    }
    const index = sortedItems.findIndex((entry) => entry.id === itemId);
    if (index === -1) {
      return false;
    }
    const wasSelected = existingRow.classList.contains('list-item-selected');
    const newRow = this.buildItemRow({
      listId: state.listId,
      item,
      index,
      sortedItems,
      tbody: state.tbody,
      showTitleColumn: state.showTitleColumn,
      showUrlColumn: state.showUrlColumn,
      showNotesColumn: state.showNotesColumn,
      showTagsColumn: state.showTagsColumn,
      showAddedColumn: state.showAddedColumn,
      showUpdatedColumn: state.showUpdatedColumn,
      showTouchedColumn: state.showTouchedColumn,
      visibleCustomFields: state.visibleCustomFields,
      timelineFieldDef: state.timelineFieldDef,
      now: state.now,
      rerender: state.rerender,
    });
    if (state.columnOrder) {
      this.reorderRowByKeys(newRow, state.columnOrder);
    }
    if (wasSelected) {
      newRow.classList.add('list-item-selected');
    }
    existingRow.replaceWith(newRow);

    if (focusMarkerItemId && onFocusMarkerMove) {
      newRow.addEventListener('dragover', (e) => {
        const dt = e.dataTransfer;
        if (!dt || dt.getData('text/plain') !== 'focus-marker') return;
        e.preventDefault();
        e.stopPropagation();
        dt.dropEffect = 'move';
        newRow.classList.add('focus-marker-drop-target');
      });

      newRow.addEventListener('dragleave', () => {
        newRow.classList.remove('focus-marker-drop-target');
      });

      newRow.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        newRow.classList.remove('focus-marker-drop-target');
        const dt = e.dataTransfer;
        if (!dt || dt.getData('text/plain') !== 'focus-marker') return;
        if (itemId !== focusMarkerItemId) {
          onFocusMarkerMove(itemId);
        }
      });
    }

    if (focusMarkerItemId && !focusMarkerExpanded) {
      const markerRow = state.tbody.querySelector<HTMLTableRowElement>('.focus-marker-row');
      if (markerRow) {
        const rowNodes = Array.from(state.tbody.children);
        const markerIndex = rowNodes.indexOf(markerRow);
        const rowIndex = rowNodes.indexOf(newRow);
        if (markerIndex !== -1 && rowIndex > markerIndex) {
          newRow.classList.add('focus-marker-hidden');
        }
      }
    }

    return true;
  }

  getFocusedItemId(): string | null {
    const rows = this.getAllItemRows();
    if (rows.length === 0) {
      return null;
    }
    if (this.lastSelectedRowIndex !== null) {
      const row = rows[this.lastSelectedRowIndex];
      if (row && row.classList.contains('list-item-selected')) {
        return row.dataset['itemId'] ?? null;
      }
    }
    const selectedRow = rows.find((row) => row.classList.contains('list-item-selected')) ?? null;
    return selectedRow?.dataset['itemId'] ?? null;
  }

  moveSelectionByOffset(
    offset: number,
    options?: { extend?: boolean; wrap?: boolean },
  ): string | null {
    const allRows = this.getAllItemRows();
    if (allRows.length === 0) {
      return null;
    }
    const visibleRows = allRows.filter((row) => this.isRowVisible(row));
    if (visibleRows.length === 0) {
      return null;
    }

    const extend = options?.extend ?? false;
    const wrap = options?.wrap ?? true;
    const selectedVisibleRows = visibleRows.filter((row) =>
      row.classList.contains('list-item-selected'),
    );
    const hasSelection = selectedVisibleRows.length > 0;

    let targetRow: HTMLTableRowElement | null = null;
    if (!hasSelection) {
      const startIndex = offset < 0 ? visibleRows.length - 1 : 0;
      targetRow = visibleRows[startIndex] ?? null;
    } else {
      const focusRow = this.resolveFocusedRow(allRows, visibleRows, selectedVisibleRows);
      if (!focusRow) {
        targetRow = visibleRows[0] ?? null;
      } else {
        const currentIndex = visibleRows.indexOf(focusRow);
        let nextIndex = currentIndex + offset;
        if (nextIndex < 0) {
          nextIndex = wrap ? visibleRows.length - 1 : 0;
        } else if (nextIndex >= visibleRows.length) {
          nextIndex = wrap ? 0 : visibleRows.length - 1;
        }
        targetRow = visibleRows[nextIndex] ?? null;
      }
    }

    if (!targetRow) {
      return null;
    }

    const targetAllIndex = allRows.indexOf(targetRow);
    if (extend) {
      const anchorIndex = this.resolveKeyboardAnchorIndex(
        allRows,
        visibleRows,
        selectedVisibleRows,
      );
      this.keyboardSelectionAnchorIndex = anchorIndex;
      this.applyRangeSelection(allRows, visibleRows, anchorIndex, targetAllIndex);
    } else {
      this.keyboardSelectionAnchorIndex = null;
      this.applySingleSelection(allRows, targetRow);
    }

    this.lastSelectedRowIndex = targetAllIndex >= 0 ? targetAllIndex : null;
    this.updateSelectionButtons();
    if (typeof targetRow.scrollIntoView === 'function') {
      targetRow.scrollIntoView({ block: 'nearest' });
    }
    return targetRow.dataset['itemId'] ?? null;
  }

  clearSelectionCurrent(): boolean {
    const state = this.renderState;
    if (!state) {
      return false;
    }
    this.clearSelection(state.tbody);
    return true;
  }

  private buildItemRow(options: ListPanelRowRenderOptions): HTMLTableRowElement {
    const {
      listId,
      item,
      index,
      sortedItems,
      tbody,
      showTitleColumn,
      showUrlColumn,
      showNotesColumn,
      showTagsColumn,
      showAddedColumn,
      showUpdatedColumn,
      showTouchedColumn,
      visibleCustomFields,
      timelineFieldDef,
      now,
      rerender,
    } = options;
    const isCompleted = item.completed ?? false;
    const itemId = item.id;

    const row = document.createElement('tr');
    let rowClass = isCompleted ? 'list-item-row list-item-completed' : 'list-item-row';

    if (timelineFieldDef && !isCompleted) {
      const fieldValue = item.customFields?.[timelineFieldDef.key];
      const itemDate = parseFieldValueToDate(
        fieldValue,
        timelineFieldDef.type as 'date' | 'time' | 'datetime',
      );
      if (itemDate && itemDate < now) {
        rowClass += ' timeline-past';
      }
    }

    row.className = rowClass;
    row.dataset['listId'] = listId;
    row.dataset['itemIndex'] = String(index);
    if (typeof item.position === 'number') {
      row.dataset['itemPosition'] = String(item.position);
    }

    const setDragSelectionSuppressed = (active: boolean): void => {
      if (typeof document === 'undefined') {
        return;
      }
      document.body.classList.toggle('list-row-dragging', active);
    };

    const searchParts: string[] = [item.title];
    if (item.url) {
      searchParts.push(item.url);
    }
    if (item.notes) {
      searchParts.push(item.notes);
    }
    const itemTags = Array.isArray(item.tags)
      ? item.tags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0)
      : [];
    if (itemTags.length > 0) {
      for (const tag of itemTags) {
        searchParts.push(tag);
      }
      row.dataset['tags'] = itemTags.map((t) => t.toLowerCase()).join(',');
    } else {
      row.dataset['tags'] = '';
    }

    if (item.customFields && visibleCustomFields.length > 0) {
      for (const field of visibleCustomFields) {
        const key = field.key;
        if (!key) continue;
        const value = item.customFields[key];
        const text = this.formatCustomFieldValue(value, field.type);
        if (text.trim().length > 0) {
          searchParts.push(text);
        }
      }
    }

    row.dataset['search'] = searchParts.join(' ').toLowerCase();

    const getSelectedItemIds = (): string[] => {
      if (!itemId) {
        return [];
      }
      const selectedIds = new Set<string>();
      tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row.list-item-selected').forEach(
        (selectedRow) => {
          const selectedId = selectedRow.dataset['itemId'];
          if (selectedId) {
            selectedIds.add(selectedId);
          }
        },
      );
      if (!selectedIds.has(itemId)) {
        return [itemId];
      }
      const orderedSelected: string[] = [];
      for (const entry of sortedItems) {
        const entryId = entry?.id;
        if (entryId && selectedIds.has(entryId)) {
          orderedSelected.push(entryId);
        }
      }
      return orderedSelected.length > 0 ? orderedSelected : [itemId];
    };

    const parseDragPayload = (
      value: string,
    ): { sourceListId: string; itemIds: string[] } | null => {
      try {
        const parsed = JSON.parse(value) as {
          sourceListId?: unknown;
          itemIds?: unknown;
          itemId?: unknown;
        };
        const sourceListId = typeof parsed.sourceListId === 'string' ? parsed.sourceListId : null;
        if (!sourceListId) {
          return null;
        }
        const itemIds: string[] = [];
        if (Array.isArray(parsed.itemIds)) {
          for (const id of parsed.itemIds) {
            if (typeof id === 'string' && id.trim()) {
              itemIds.push(id);
            }
          }
        } else if (typeof parsed.itemId === 'string' && parsed.itemId.trim()) {
          itemIds.push(parsed.itemId);
        }
        if (itemIds.length === 0) {
          return null;
        }
        return { sourceListId, itemIds };
      } catch {
        return null;
      }
    };

    const getDragPayloadFromDataTransfer = (
      dataTransfer: DataTransfer | null,
    ): { sourceListId: string; itemIds: string[] } | null => {
      if (!dataTransfer) {
        return null;
      }
      const types = Array.from(dataTransfer.types);
      let raw: string | null = null;
      if (types.includes(LIST_ITEMS_DRAG_TYPE)) {
        raw = dataTransfer.getData(LIST_ITEMS_DRAG_TYPE);
      } else if (types.includes(LIST_ITEM_DRAG_TYPE)) {
        raw = dataTransfer.getData(LIST_ITEM_DRAG_TYPE);
      }
      if (!raw) {
        return null;
      }
      return parseDragPayload(raw);
    };

    const getStoredDragPayload = (): { sourceListId: string; itemIds: string[] } | null => {
      if (!this.draggedListId || !this.draggedItemIds || this.draggedItemIds.length === 0) {
        return null;
      }
      return { sourceListId: this.draggedListId, itemIds: this.draggedItemIds };
    };

    const getDragPayload = (
      dataTransfer: DataTransfer | null,
    ): { sourceListId: string; itemIds: string[] } | null => {
      return getDragPayloadFromDataTransfer(dataTransfer) ?? getStoredDragPayload();
    };

    const parseRowPosition = (rowEl: HTMLTableRowElement): number | null => {
      const rawPosition = rowEl.dataset['itemPosition'];
      if (rawPosition) {
        const position = Number(rawPosition);
        if (!Number.isNaN(position)) {
          return Math.floor(position);
        }
      }
      const rawIndex = rowEl.dataset['itemIndex'];
      if (rawIndex) {
        const indexValue = Number(rawIndex);
        if (!Number.isNaN(indexValue)) {
          return Math.floor(indexValue);
        }
      }
      return null;
    };

    const parseRowInsertPosition = (rowEl: HTMLTableRowElement): number | null => {
      const basePosition = parseRowPosition(rowEl);
      if (basePosition === null) {
        return null;
      }
      return basePosition + 1;
    };

    const getPointFromEvent = (event?: Event): { x: number; y: number } | null => {
      if (!event) {
        return null;
      }
      const withCoords = event as { clientX?: number; clientY?: number };
      if (typeof withCoords.clientX === 'number' && typeof withCoords.clientY === 'number') {
        return { x: withCoords.clientX, y: withCoords.clientY };
      }
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.changedTouches?.[0] ?? touchEvent.touches?.[0];
      if (touch) {
        return { x: touch.clientX, y: touch.clientY };
      }
      return null;
    };

    const resolveDropTarget = (
      targetRow: HTMLTableRowElement | null,
      event?: Event,
    ): { listId: string; position: number | null } | null => {
      if (targetRow) {
        const targetListId = targetRow.dataset['listId'];
        if (!targetListId) {
          return null;
        }
        return { listId: targetListId, position: parseRowInsertPosition(targetRow) };
      }

      if (typeof document === 'undefined') {
        return null;
      }

      let element: Element | null = null;
      const point = getPointFromEvent(event);
      if (point && typeof document.elementFromPoint === 'function') {
        element = document.elementFromPoint(point.x, point.y);
      } else if (event && 'target' in event) {
        element = event.target instanceof Element ? event.target : null;
      }

      if (!element) {
        return null;
      }

      const rowEl = element.closest<HTMLTableRowElement>('.list-item-row');
      if (rowEl) {
        const targetListId = rowEl.dataset['listId'];
        if (!targetListId) {
          return null;
        }
        return { listId: targetListId, position: parseRowInsertPosition(rowEl) };
      }

      const listHost = element.closest<HTMLElement>('[data-list-id]');
      const targetListId = listHost?.dataset?.['listId'];
      if (!targetListId) {
        return null;
      }

      const tbodyEl =
        listHost.tagName === 'TBODY'
          ? (listHost as HTMLTableSectionElement)
          : listHost.querySelector('tbody');
      const rowCount = tbodyEl ? tbodyEl.querySelectorAll('.list-item-row').length : 0;
      const position = rowCount === 0 ? 0 : rowCount;
      return { listId: targetListId, position };
    };

    const handleCrossListDrop = async (
      targetRow: HTMLTableRowElement | null,
      event?: Event,
    ): Promise<boolean> => {
      const onMoveItemsToList = this.options.onMoveItemsToList;
      if (!onMoveItemsToList) {
        return false;
      }
      const dataTransfer = event && 'dataTransfer' in event ? (event as DragEvent).dataTransfer : null;
      const payload = getDragPayload(dataTransfer);
      if (!payload) {
        return false;
      }
      const target = resolveDropTarget(targetRow, event);
      if (!target || payload.sourceListId === target.listId) {
        return false;
      }
      await onMoveItemsToList(payload.sourceListId, payload.itemIds, target.listId, target.position);
      return true;
    };

    let onDragStartFromHandle: ((e: DragEvent | null) => void) | null = null;
    let onDragEnd: (() => void) | null = null;
    let touchDragActive = false;

    const reorderDraggedItem = async (
      targetRow: HTMLTableRowElement | null,
      draggedId: string | null,
    ): Promise<void> => {
      if (!targetRow || !draggedId) {
        onDragEnd?.();
        return;
      }

      const targetItemId = targetRow.dataset['itemId'];
      if (!targetItemId || targetItemId === draggedId) {
        onDragEnd?.();
        return;
      }

      const draggedItem = sortedItems.find((it) => it.id === draggedId);
      const targetItem = sortedItems.find((it) => it.id === targetItemId);
      if (!draggedItem || !targetItem) {
        onDragEnd?.();
        return;
      }

      const draggedIsCompleted = draggedItem.completed ?? false;
      const targetIsCompleted = targetItem.completed ?? false;
      if (draggedIsCompleted !== targetIsCompleted) {
        onDragEnd?.();
        return;
      }

      const draggedIndex = sortedItems.findIndex((it) => it.id === draggedId);
      const targetIndex = sortedItems.findIndex((it) => it.id === targetItemId);
      if (draggedIndex === -1 || targetIndex === -1) {
        onDragEnd?.();
        return;
      }

      const insertIndex = draggedIndex > targetIndex ? targetIndex + 1 : targetIndex;
      const orderedItems = [...sortedItems];
      const [movedItem] = orderedItems.splice(draggedIndex, 1);
      if (!movedItem) {
        onDragEnd?.();
        return;
      }
      orderedItems.splice(insertIndex, 0, movedItem);

      const originalPositions = new Map<ListPanelItem, number | undefined>();
      orderedItems.forEach((entry, idx) => {
        originalPositions.set(entry, entry.position);
        entry.position = idx;
      });

      const newPosition = insertIndex;

      rerender();

      this.options.recentUserItemUpdates.add(draggedId);
      window.setTimeout(() => {
        this.options.recentUserItemUpdates.delete(draggedId);
      }, this.options.userUpdateTimeoutMs);

      const success = await this.options.updateListItem(listId, draggedId, {
        position: newPosition,
      });
      if (!success) {
        orderedItems.forEach((entry) => {
          const original = originalPositions.get(entry);
          if (typeof original === 'number') {
            entry.position = original;
          } else {
            delete entry.position;
          }
        });
        rerender();
      }

      onDragEnd?.();
    };

    const handleDrop = async (
      targetRow: HTMLTableRowElement | null,
      draggedId: string | null,
      event?: Event,
    ): Promise<void> => {
      if (await handleCrossListDrop(targetRow, event)) {
        onDragEnd?.();
        return;
      }
      await reorderDraggedItem(targetRow, draggedId);
    };

    if (itemId) {
      row.dataset['itemId'] = itemId;
      row.draggable = false;

      onDragStartFromHandle = (e: DragEvent | null): void => {
        const dragItemIds = getSelectedItemIds();
        this.draggedItemId = itemId;
        this.draggedItemIds = dragItemIds;
        this.draggedListId = listId;
        row.classList.add('dragging');
        if (e && e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          const primaryId = dragItemIds[0] ?? itemId;
          e.dataTransfer.setData(
            LIST_ITEMS_DRAG_TYPE,
            JSON.stringify({
              sourceListId: listId,
              itemIds: dragItemIds,
            }),
          );
          if (dragItemIds.length === 1) {
            e.dataTransfer.setData(
              LIST_ITEM_DRAG_TYPE,
              JSON.stringify({
                sourceListId: listId,
                itemId,
              }),
            );
          }
          const exportPayload = this.options.getExternalDragPayload?.({
            listId,
            itemIds: dragItemIds,
            primaryItemId: primaryId,
          });
          if (exportPayload?.plainText) {
            e.dataTransfer.setData('text/plain', exportPayload.plainText);
          } else {
            e.dataTransfer.setData('text/plain', primaryId);
          }
          if (exportPayload?.html) {
            e.dataTransfer.setData('text/html', exportPayload.html);
          }
          e.dataTransfer.setDragImage(row, 0, 0);
        }
      };
      onDragEnd = (): void => {
        this.draggedItemId = null;
        this.draggedItemIds = null;
        this.draggedListId = null;
        row.classList.remove('dragging');
        tbody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
        setDragSelectionSuppressed(false);
      };

      row.addEventListener('click', (e) => {
        if (this.shouldIgnoreRowSelection(e.target)) {
          return;
        }
        this.keyboardSelectionAnchorIndex = null;
        const singleClickEnabled = this.isSingleClickSelectionEnabled();
        if (e.shiftKey && this.lastSelectedRowIndex !== null) {
          e.preventDefault();
          const rows = Array.from(tbody.querySelectorAll('.list-item-row'));
          const currentIndex = rows.indexOf(row);
          if (currentIndex === -1) return;

          rows.forEach((r) => r.classList.remove('list-item-selected'));

          const start = Math.min(this.lastSelectedRowIndex, currentIndex);
          const end = Math.max(this.lastSelectedRowIndex, currentIndex);

          for (let j = start; j <= end; j++) {
            rows[j]?.classList.add('list-item-selected');
          }
          this.updateSelectionButtons();
        } else if (!singleClickEnabled && (e.ctrlKey || e.metaKey || e.altKey)) {
          e.preventDefault();
          row.classList.toggle('list-item-selected');
          const rows = Array.from(tbody.querySelectorAll('.list-item-row'));
          this.lastSelectedRowIndex = rows.indexOf(row);
          this.updateSelectionButtons();
        } else if (singleClickEnabled) {
          if (e.ctrlKey || e.metaKey || e.altKey) {
            return;
          }
          const isSelectedPanel =
            Boolean(row.closest('.panel-frame.is-active')) ||
            Boolean(row.closest('.panel-modal')) ||
            Boolean(row.closest('.panel-dock-popover'));
          if (!isSelectedPanel) {
            return;
          }
          const rows = Array.from(tbody.querySelectorAll('.list-item-row'));
          if (row.classList.contains('list-item-selected')) {
            rows.forEach((r) => r.classList.remove('list-item-selected'));
            this.lastSelectedRowIndex = null;
            this.updateSelectionButtons();
            return;
          }
          rows.forEach((r) => r.classList.remove('list-item-selected'));
          row.classList.add('list-item-selected');
          this.lastSelectedRowIndex = rows.indexOf(row);
          this.updateSelectionButtons();
        }
      });

      const onEditItem = this.options.onEditItem;
      if (onEditItem) {
        row.addEventListener('dblclick', (e) => {
          if (this.shouldIgnoreRowDoubleClick(e.target)) {
            return;
          }

          if (
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(pointer: coarse)').matches
          ) {
            return;
          }

          const mouseEvent = e as MouseEvent;
          if (mouseEvent.button !== 0) {
            return;
          }

          e.preventDefault();
          onEditItem(listId, item);
        });
      }

      let touchStartTime = 0;
      let touchStartX = 0;
      let touchStartY = 0;
      let touchSelectionBlocked = false;
      const LONG_PRESS_THRESHOLD_MS = 500;
      const TOUCH_MOVE_THRESHOLD = 10;

      row.addEventListener(
        'touchstart',
        (e) => {
          touchSelectionBlocked = this.shouldIgnoreRowSelection(e.target);
          if (touchSelectionBlocked) {
            return;
          }

          touchStartTime = Date.now();
          const touch = e.touches[0];
          if (touch) {
            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
          }
        },
        { passive: true },
      );

      row.addEventListener('touchend', (e) => {
        if (touchSelectionBlocked || touchDragActive) {
          touchSelectionBlocked = false;
          return;
        }

        const touchDuration = Date.now() - touchStartTime;
        const touch = e.changedTouches[0];

        if (touch && touchDuration >= LONG_PRESS_THRESHOLD_MS) {
          const dx = Math.abs(touch.clientX - touchStartX);
          const dy = Math.abs(touch.clientY - touchStartY);

          if (dx < TOUCH_MOVE_THRESHOLD && dy < TOUCH_MOVE_THRESHOLD) {
            e.preventDefault();
            this.keyboardSelectionAnchorIndex = null;
            row.classList.toggle('list-item-selected');
            const rows = Array.from(tbody.querySelectorAll('.list-item-row'));
            this.lastSelectedRowIndex = rows.indexOf(row);
            this.updateSelectionButtons();
          }
        }

        touchSelectionBlocked = false;
      });

      row.addEventListener('dragend', () => onDragEnd?.());

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this.draggedItemId && this.draggedItemId !== itemId) {
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
          }
          const draggedItem = sortedItems.find((it) => it.id === this.draggedItemId);
          if (!draggedItem) return;
          const draggedIsCompleted = draggedItem.completed ?? false;
          if (draggedIsCompleted !== isCompleted) return;

          row.classList.add('drag-over');
          return;
        }

        const payload = getDragPayload(e.dataTransfer ?? null);
        if (!payload || payload.sourceListId === listId) {
          return;
        }
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        await handleDrop(row, this.draggedItemId, e);
      });
    }

    const checkboxCell = document.createElement('td');
    checkboxCell.className = 'list-item-checkbox-cell';
    checkboxCell.dataset['columnKey'] = 'checkbox';

    const actions = document.createElement('div');
    actions.className = 'list-item-actions';

    const menuTrigger = document.createElement('button');
    menuTrigger.type = 'button';
    menuTrigger.className = 'list-item-menu-trigger';
    menuTrigger.innerHTML = this.options.icons.moreVertical;
    menuTrigger.setAttribute('aria-label', 'Item actions');

    if (itemId) {
      menuTrigger.title = 'Item actions';
      const isCoarsePointer =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;
      menuTrigger.draggable = !isCoarsePointer;
      let lastDragStartAt = 0;

      let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
      let touchDragStartX = 0;
      let touchDragStartY = 0;
      let touchCurrentDropRow: HTMLTableRowElement | null = null;
      let touchDraggedItemId: string | null = null;

      const POINTER_DRAG_THRESHOLD = 6;
      let pointerDragActive = false;
      let pointerDragStarted = false;
      let pointerStartX = 0;
      let pointerStartY = 0;
      let pointerCurrentDropRow: HTMLTableRowElement | null = null;

      const startDragFromHandle = (e: DragEvent | null) => {
        if (isCoarsePointer) {
          return;
        }
        lastDragStartAt = Date.now();
        setDragSelectionSuppressed(true);
        onDragStartFromHandle?.(e);
      };

      if (!isCoarsePointer) {
        menuTrigger.addEventListener('dragstart', (event) => {
          startDragFromHandle(event);
        });
        menuTrigger.addEventListener('dragend', () => {
          onDragEnd?.();
        });
      }

      const pointerEventTargets: EventTarget[] = [document, window];
      const toPointerEvent = (event: Event): PointerEvent | null => {
        if ('pointerType' in event) {
          return event as PointerEvent;
        }
        return null;
      };
      const getDropRowFromEvent = (event: PointerEvent): HTMLTableRowElement | null => {
        const target = event.target;
        if (target instanceof Element) {
          const rowEl = target.closest<HTMLTableRowElement>('.list-item-row');
          if (rowEl) {
            return rowEl;
          }
        }

        if (typeof document.elementFromPoint !== 'function') {
          return null;
        }

        const element = document.elementFromPoint(event.clientX, event.clientY);
        return element?.closest<HTMLTableRowElement>('.list-item-row') ?? null;
      };

      const updatePointerDropTarget = (event: PointerEvent): void => {
        const targetRow = getDropRowFromEvent(event);

        if (targetRow && targetRow !== row) {
          if (pointerCurrentDropRow && pointerCurrentDropRow !== targetRow) {
            pointerCurrentDropRow.classList.remove('drag-over');
          }
          pointerCurrentDropRow = targetRow;
          pointerCurrentDropRow.classList.add('drag-over');
        } else if (pointerCurrentDropRow) {
          pointerCurrentDropRow.classList.remove('drag-over');
          pointerCurrentDropRow = null;
        }
      };

      const cleanupPointerListeners = (): void => {
        pointerEventTargets.forEach((target) => {
          target.removeEventListener('pointermove', handlePointerMove);
          target.removeEventListener('pointerup', handlePointerUp);
          target.removeEventListener('pointercancel', handlePointerCancel);
        });
      };

      const finishPointerDrag = async (event?: Event): Promise<void> => {
        if (!pointerDragActive) {
          return;
        }
        pointerDragActive = false;
        setDragSelectionSuppressed(false);
        cleanupPointerListeners();

        if (!pointerDragStarted) {
          pointerCurrentDropRow = null;
          return;
        }

        event?.preventDefault();
        pointerDragStarted = false;

        const draggedId = this.draggedItemId;
        const targetRow = pointerCurrentDropRow;
        pointerCurrentDropRow = null;

        if (targetRow) {
          targetRow.classList.remove('drag-over');
        }

        await handleDrop(targetRow ?? null, draggedId ?? null, event);
      };

      const handlePointerMove = (event: Event): void => {
        const pointerEvent = toPointerEvent(event);
        if (!pointerEvent || !pointerDragActive || pointerEvent.pointerType === 'touch') {
          return;
        }

        const dx = Math.abs(pointerEvent.clientX - pointerStartX);
        const dy = Math.abs(pointerEvent.clientY - pointerStartY);

        if (!pointerDragStarted && (dx > POINTER_DRAG_THRESHOLD || dy > POINTER_DRAG_THRESHOLD)) {
          pointerDragStarted = true;
          startDragFromHandle(null);
        }

        if (!pointerDragStarted) {
          return;
        }

        pointerEvent.preventDefault();
        updatePointerDropTarget(pointerEvent);
      };

      const handlePointerUp = (event: Event): void => {
        const pointerEvent = toPointerEvent(event);
        if (!pointerEvent || !pointerDragActive || pointerEvent.pointerType === 'touch') {
          return;
        }
        void finishPointerDrag(pointerEvent);
      };

      const handlePointerCancel = (event: Event): void => {
        const pointerEvent = toPointerEvent(event);
        if (!pointerEvent || !pointerDragActive || pointerEvent.pointerType === 'touch') {
          return;
        }
        void finishPointerDrag(pointerEvent);
      };

      // Attach drag handlers to the row instead of menu trigger
      if (!isCoarsePointer) {
        row.addEventListener('pointerdown', (event: PointerEvent) => {
          if (event.button !== 0 || event.pointerType === 'touch') {
            return;
          }

          // Ignore drag on text, tags, and interactive elements
          if (this.shouldIgnoreDragStart(event.target)) {
            return;
          }

          event.preventDefault();
          setDragSelectionSuppressed(true);

          pointerDragActive = true;
          pointerDragStarted = false;
          pointerStartX = event.clientX;
          pointerStartY = event.clientY;
          pointerCurrentDropRow = null;

          pointerEventTargets.forEach((target) => {
            target.addEventListener('pointermove', handlePointerMove);
            target.addEventListener('pointerup', handlePointerUp);
            target.addEventListener('pointercancel', handlePointerCancel);
          });
        });
      }

      if (isCoarsePointer) {
        row.addEventListener(
          'touchstart',
          (e) => {
            const touch = e.touches[0];
            if (!touch || !itemId) return;

            // Ignore drag on text, tags, and interactive elements
            if (this.shouldIgnoreDragStart(e.target)) {
              return;
            }

            touchDragStartX = touch.clientX;
            touchDragStartY = touch.clientY;
            touchDragActive = false;
            touchDraggedItemId = itemId;

            if (touchLongPressTimer !== null && typeof window !== 'undefined') {
              clearTimeout(touchLongPressTimer);
            }

            touchLongPressTimer = setTimeout(() => {
              touchDragActive = true;
              onDragStartFromHandle?.(null);
            }, 350);
          },
          { passive: true },
        );

        row.addEventListener(
          'touchmove',
          (e) => {
            const touch = e.touches[0];
            if (!touch) return;

            const dx = Math.abs(touch.clientX - touchDragStartX);
            const dy = Math.abs(touch.clientY - touchDragStartY);
            if (!touchDragActive && (dx > 8 || dy > 8)) {
              if (touchLongPressTimer !== null && typeof window !== 'undefined') {
                clearTimeout(touchLongPressTimer);
                touchLongPressTimer = null;
              }
            }

            if (!touchDragActive || !touchDraggedItemId) {
              return;
            }

            e.preventDefault();

            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            const targetRow = element?.closest<HTMLTableRowElement>('.list-item-row');
            if (targetRow && targetRow !== row) {
              if (touchCurrentDropRow && touchCurrentDropRow !== targetRow) {
                touchCurrentDropRow.classList.remove('drag-over');
              }
              touchCurrentDropRow = targetRow;
              touchCurrentDropRow.classList.add('drag-over');
            } else if (touchCurrentDropRow) {
              touchCurrentDropRow.classList.remove('drag-over');
              touchCurrentDropRow = null;
            }
          },
          { passive: false },
        );

        row.addEventListener(
          'touchend',
          async (e) => {
            if (touchLongPressTimer !== null && typeof window !== 'undefined') {
              clearTimeout(touchLongPressTimer);
              touchLongPressTimer = null;
            }

            if (!touchDragActive) {
              return;
            }

            e.preventDefault();
            touchDragActive = false;

            const draggedId = touchDraggedItemId;
            const targetRow = touchCurrentDropRow;
            touchDraggedItemId = null;
            touchCurrentDropRow = null;

            if (targetRow) {
              targetRow.classList.remove('drag-over');
            }

            await handleDrop(targetRow ?? null, draggedId ?? null, e);
          },
          { passive: false },
        );

        row.addEventListener(
          'touchcancel',
          (e) => {
            if (touchLongPressTimer !== null && typeof window !== 'undefined') {
              clearTimeout(touchLongPressTimer);
              touchLongPressTimer = null;
            }

            if (!touchDragActive) {
              return;
            }

            e.preventDefault();
            touchDragActive = false;

            if (touchCurrentDropRow) {
              touchCurrentDropRow.classList.remove('drag-over');
              touchCurrentDropRow = null;
            }

            onDragEnd?.();
          },
          { passive: false },
        );
      }

      menuTrigger.addEventListener('click', (e) => {
        if (lastDragStartAt > 0 && Date.now() - lastDragStartAt < 1000) {
          lastDragStartAt = 0;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        this.options.showListItemMenu(menuTrigger, listId, item, itemId, row);
      });
    } else {
      menuTrigger.disabled = true;
    }

    actions.appendChild(menuTrigger);
    checkboxCell.appendChild(actions);

    row.appendChild(checkboxCell);

    if (showTitleColumn) {
      const titleCell = document.createElement('td');
      titleCell.className = isCompleted
        ? 'list-item-title list-item-completed-text'
        : 'list-item-title';
      titleCell.dataset['columnKey'] = 'title';

      const titleContent = document.createElement('div');
      titleContent.className = 'list-item-title-content';

      const titleMain = document.createElement('div');
      titleMain.className = 'list-item-title-main';

      if (hasPinnedTag(item.tags)) {
        const pin = document.createElement('span');
        pin.className = 'list-item-pin';
        pin.innerHTML = this.options.icons.pin;
        pin.setAttribute('aria-hidden', 'true');
        titleMain.appendChild(pin);
      }

      if (!showUrlColumn && item.url) {
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.draggable = false;
        link.textContent = item.title;
        link.title = item.url;
        if (isCompleted) {
          link.className = 'list-item-completed-text';
        }
        titleMain.appendChild(link);
      } else {
        const titleText = document.createElement('span');
        titleText.textContent = item.title;
        titleMain.appendChild(titleText);
      }

      titleContent.appendChild(titleMain);
      titleCell.appendChild(titleContent);
      row.appendChild(titleCell);
    }

    if (showUrlColumn) {
      const urlCell = document.createElement('td');
      urlCell.className = isCompleted ? 'list-item-completed-text' : '';
      urlCell.dataset['columnKey'] = 'url';
      if (item.url) {
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.draggable = false;
        link.textContent = item.url;
        if (isCompleted) {
          link.className = 'list-item-completed-text';
        }
        urlCell.appendChild(link);
      }
      row.appendChild(urlCell);
    }

    if (showNotesColumn) {
      const notesCell = document.createElement('td');
      notesCell.dataset['columnKey'] = 'notes';
      this.renderNotesCell(notesCell, listId, item, itemId, isCompleted);
      row.appendChild(notesCell);
    }

    const inlineCustomFieldEditingEnabled = this.isInlineCustomFieldEditingEnabled();
    for (const field of visibleCustomFields) {
      const key = field.key;
      const customCell = document.createElement('td');
      customCell.dataset['columnKey'] = key;
      const value = item.customFields ? item.customFields[key] : undefined;
      const text = this.formatCustomFieldValue(value, field.type);
      const isMarkdown = field.type === 'text' && field.markdown === true;
      const itemIdValue = itemId ?? '';
      const updateCustomField = async (
        nextValue: unknown | null,
        revert: () => void,
        control: HTMLInputElement | HTMLSelectElement,
      ): Promise<void> => {
        if (!itemIdValue) {
          return;
        }
        control.disabled = true;
        const ok = await this.options.updateListItem(listId, itemIdValue, {
          customFields: { [key]: nextValue },
        });
        if (!ok) {
          control.disabled = false;
          revert();
        }
      };

      if (inlineCustomFieldEditingEnabled && field.type === 'checkbox') {
        customCell.className = isCompleted ? 'list-item-completed-text' : '';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'list-item-form-checkbox list-item-inline-checkbox';
        const wasChecked = value === true;
        checkbox.checked = wasChecked;
        if (!itemIdValue) {
          checkbox.disabled = true;
        } else {
          checkbox.addEventListener('change', () => {
            const nextChecked = checkbox.checked;
            const revert = () => {
              checkbox.checked = wasChecked;
            };
            revert();
            void updateCustomField(nextChecked ? true : null, revert, checkbox);
          });
        }
        customCell.appendChild(checkbox);
      } else if (inlineCustomFieldEditingEnabled && field.type === 'select') {
        customCell.className = isCompleted ? 'list-item-completed-text' : '';
        const select = document.createElement('select');
        select.className = 'list-item-form-select list-item-inline-select';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '';
        select.appendChild(placeholder);

        const options: string[] = [];
        if (Array.isArray(field.options)) {
          for (const raw of field.options) {
            if (typeof raw !== 'string') continue;
            const trimmed = raw.trim();
            if (!trimmed) continue;
            if (!options.includes(trimmed)) {
              options.push(trimmed);
            }
          }
        }

        const currentValue = typeof value === 'string' ? value.trim() : '';
        if (currentValue && !options.includes(currentValue)) {
          options.push(currentValue);
        }

        for (const optionValue of options) {
          const option = document.createElement('option');
          option.value = optionValue;
          option.textContent = optionValue;
          select.appendChild(option);
        }
        select.value = currentValue;

        if (!itemIdValue) {
          select.disabled = true;
        } else {
          select.addEventListener('change', () => {
            const nextValue = select.value.trim();
            const revert = () => {
              select.value = currentValue;
            };
            revert();
            void updateCustomField(nextValue ? nextValue : null, revert, select);
          });
        }
        customCell.appendChild(select);
      } else if (isMarkdown) {
        this.renderMarkdownPreviewCell(
          customCell,
          text,
          isCompleted,
          'list-item-notes-cell list-item-custom-field-markdown-cell',
        );
      } else {
        customCell.className = isCompleted ? 'list-item-completed-text' : '';
        if (text.trim().length > 0) {
          customCell.textContent = text;
        }
      }
      row.appendChild(customCell);
    }

    if (showTagsColumn) {
      const tagsCell = document.createElement('td');
      tagsCell.className = isCompleted ? 'list-item-completed-text' : '';
      tagsCell.dataset['columnKey'] = 'tags';
      const tagsPills = this.options.renderTags(item.tags);
      if (tagsPills) {
        tagsCell.appendChild(tagsPills);
      }
      row.appendChild(tagsCell);
    }

    if (showAddedColumn) {
      const addedCell = document.createElement('td');
      addedCell.className = isCompleted ? 'list-item-completed-text' : '';
      addedCell.dataset['columnKey'] = 'added';
      if (item.addedAt) {
        const date = new Date(item.addedAt);
        addedCell.textContent = date.toLocaleDateString();
        addedCell.title = date.toLocaleString();
      }
      row.appendChild(addedCell);
    }

    if (showUpdatedColumn) {
      const updatedCell = document.createElement('td');
      updatedCell.className = isCompleted ? 'list-item-completed-text' : '';
      updatedCell.dataset['columnKey'] = 'updated';
      if (item.updatedAt) {
        const date = new Date(item.updatedAt);
        updatedCell.textContent = date.toLocaleDateString();
        updatedCell.title = date.toLocaleString();
      }
      row.appendChild(updatedCell);
    }

    if (showTouchedColumn) {
      const touchedCell = document.createElement('td');
      touchedCell.className = isCompleted ? 'list-item-completed-text' : '';
      touchedCell.dataset['columnKey'] = 'touched';
      if (item.touchedAt) {
        const date = new Date(item.touchedAt);
        touchedCell.textContent = date.toLocaleDateString();
        touchedCell.title = date.toLocaleString();
      }
      row.appendChild(touchedCell);
    }

    return row;
  }

  private renderNotesCell(
    notesCell: HTMLTableCellElement,
    listId: string,
    item: ListPanelItem,
    itemId: string | undefined,
    isCompleted: boolean,
  ): void {
    const notes = typeof item.notes === 'string' ? item.notes : '';
    this.renderMarkdownPreviewCell(notesCell, notes, isCompleted, 'list-item-notes-cell');
  }

  private renderMarkdownPreviewCell(
    cell: HTMLTableCellElement,
    markdown: string,
    isCompleted: boolean,
    cellClass: string,
  ): void {
    const baseClass = cellClass.trim();
    cell.className = isCompleted
      ? `${baseClass} list-item-completed-text`.trim()
      : baseClass;
    const content = typeof markdown === 'string' ? markdown : '';
    cell.innerHTML = '';

    if (content.trim().length > 0) {
      const display = document.createElement('div');
      display.className = 'list-item-notes-display';
      applyMarkdownToElement(display, content);
      cell.appendChild(display);
      cell.dataset['markdown'] = content;

      // Add fade effect if content overflows, and enable hover popup trigger
      setTimeout(() => {
        if (display.isConnected) {
          this.updateNotesOverflowState(cell, display, content);
        }
      }, 0);
    }
  }

  private applyColumnOrder(
    headerRow: HTMLTableRowElement,
    tbody: HTMLTableSectionElement,
    orderedKeys: string[],
  ): void {
    this.reorderRowByKeys(headerRow, orderedKeys);
    const rows = Array.from(
      tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row'),
    );
    for (const row of rows) {
      this.reorderRowByKeys(row, orderedKeys);
    }
  }

  private reorderRowByKeys(row: HTMLTableRowElement, orderedKeys: string[]): void {
    const cells = Array.from(row.children) as HTMLTableCellElement[];
    const byKey = new Map<string, HTMLTableCellElement>();
    for (const cell of cells) {
      const key = cell.dataset['columnKey'];
      if (key) {
        byKey.set(key, cell);
      }
    }
    const orderedCells: HTMLTableCellElement[] = [];
    for (const key of orderedKeys) {
      const cell = byKey.get(key);
      if (cell) {
        orderedCells.push(cell);
      }
    }
    if (orderedCells.length === 0) {
      return;
    }
    row.innerHTML = '';
    for (const cell of orderedCells) {
      row.appendChild(cell);
    }
  }

  private formatCustomFieldValue(value: unknown, type: string): string {
    if (value === null || value === undefined) {
      return '';
    }

    if (type === 'checkbox') {
      return value === true ? '✓' : '';
    }

    if (type === 'number') {
      if (typeof value === 'number') {
        return String(value);
      }
      if (typeof value === 'string') {
        return value.trim();
      }
      return '';
    }

    if (type === 'date') {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Try to format as locale date if valid
        const date = new Date(trimmed + 'T00:00:00');
        if (!isNaN(date.getTime())) {
          return date.toLocaleDateString();
        }
        return trimmed;
      }
      return '';
    }

    if (type === 'time') {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Try to format as locale time if valid (HH:MM or HH:MM:SS)
        const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (match) {
          const hours = parseInt(match[1]!, 10);
          const minutes = parseInt(match[2]!, 10);
          const date = new Date();
          date.setHours(hours, minutes, 0, 0);
          return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        }
        return trimmed;
      }
      return '';
    }

    if (type === 'datetime') {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        // Try to parse ISO datetime (from datetime-local input)
        const date = new Date(trimmed);
        if (!isNaN(date.getTime())) {
          return date.toLocaleString(undefined, {
            dateStyle: 'short',
            timeStyle: 'short',
          });
        }
        return trimmed;
      }
      return '';
    }

    if (type === 'select' || type === 'text') {
      if (typeof value === 'string') {
        return value.trim();
      }
      return String(value);
    }

    if (typeof value === 'string') {
      return value.trim();
    }
    return '';
  }

  private updateNotesOverflowState(
    cell: HTMLTableCellElement,
    display: HTMLElement,
    markdown: string,
  ): void {
    const shouldFade = display.scrollHeight > display.clientHeight + 1;
    display.classList.toggle('list-item-notes-display--fade', shouldFade);

    const existingTrigger = cell.querySelector<HTMLButtonElement>('.list-item-notes-expand-trigger');
    if (!shouldFade) {
      if (existingTrigger) {
        existingTrigger.remove();
        this.cancelShowNotesPopup();
        this.hideNotesPopup();
      }
      return;
    }

    if (existingTrigger) {
      return;
    }

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'list-item-notes-expand-trigger';
    trigger.innerHTML = NOTES_EXPAND_ICON_SVG;
    trigger.title = 'View full notes';
    trigger.setAttribute('aria-label', 'View full notes');
    cell.style.position = 'relative';
    cell.appendChild(trigger);

    trigger.addEventListener('mouseenter', (e: MouseEvent) => {
      this.scheduleShowNotesPopup(markdown, e.clientX, e.clientY);
    });
    trigger.addEventListener('mouseleave', () => {
      this.cancelShowNotesPopup();
      this.hideNotesPopup();
    });
  }

  private updateMarkdownOverflowStates(tbody: HTMLTableSectionElement): void {
    const cells = Array.from(
      tbody.querySelectorAll<HTMLTableCellElement>('.list-item-notes-cell'),
    );
    for (const cell of cells) {
      const display = cell.querySelector<HTMLElement>('.list-item-notes-display');
      if (!display) {
        continue;
      }
      const markdown = cell.dataset['markdown'] ?? '';
      this.updateNotesOverflowState(cell, display, markdown);
    }
  }

  clearSelection(bodyEl: HTMLElement): void {
    const selectedRows = bodyEl.querySelectorAll('.list-item-row.list-item-selected');
    selectedRows.forEach((row) => {
      row.classList.remove('list-item-selected');
    });
    this.lastSelectedRowIndex = null;
    this.keyboardSelectionAnchorIndex = null;
    this.updateSelectionButtons();
  }

  selectItemById(
    bodyEl: HTMLElement,
    itemId: string,
    options?: { scroll?: boolean },
  ): boolean {
    if (!itemId) {
      return false;
    }
    const rows = Array.from(bodyEl.querySelectorAll<HTMLTableRowElement>('.list-item-row'));
    const target = rows.find((row) => row.dataset['itemId'] === itemId);
    if (!target) {
      return false;
    }
    for (const row of rows) {
      row.classList.remove('list-item-selected');
    }
    target.classList.add('list-item-selected');
    this.lastSelectedRowIndex = rows.indexOf(target);
    this.keyboardSelectionAnchorIndex = null;
    this.updateSelectionButtons();
    if (options?.scroll !== false) {
      target.scrollIntoView({ block: 'center' });
    }
    return true;
  }

  selectVisible(bodyEl: HTMLElement): void {
    const rows = Array.from(bodyEl.querySelectorAll<HTMLTableRowElement>('.list-item-row'));

    for (const row of rows) {
      row.classList.remove('list-item-selected');
    }

    const visibleRows = rows.filter(
      (row) => row.style.display !== 'none' && !row.classList.contains('focus-marker-hidden'),
    );
    for (const row of visibleRows) {
      row.classList.add('list-item-selected');
    }

    this.lastSelectedRowIndex =
      visibleRows.length > 0 ? rows.indexOf(visibleRows[visibleRows.length - 1]!) : null;
    this.keyboardSelectionAnchorIndex = null;
    this.updateSelectionButtons();
  }

  selectAll(bodyEl: HTMLElement): void {
    const rows = Array.from(bodyEl.querySelectorAll<HTMLTableRowElement>('.list-item-row'));
    for (const row of rows) {
      row.classList.add('list-item-selected');
    }
    this.lastSelectedRowIndex = rows.length > 0 ? rows.length - 1 : null;
    this.keyboardSelectionAnchorIndex = null;
    this.updateSelectionButtons();
  }

  private getAllItemRows(): HTMLTableRowElement[] {
    const state = this.renderState;
    if (!state) {
      return [];
    }
    return Array.from(
      state.tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row[data-item-id]'),
    );
  }

  private isRowVisible(row: HTMLTableRowElement): boolean {
    if (row.classList.contains('focus-marker-hidden')) {
      return false;
    }
    if (row.style.display === 'none') {
      return false;
    }
    return true;
  }

  private isSingleClickSelectionEnabled(): boolean {
    if (typeof window === 'undefined') {
      return true;
    }
    try {
      return window.localStorage.getItem(LIST_SINGLE_CLICK_SELECTION_STORAGE_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  private isInlineCustomFieldEditingEnabled(): boolean {
    if (typeof window === 'undefined') {
      return true;
    }
    try {
      return (
        window.localStorage.getItem(LIST_INLINE_CUSTOM_FIELD_EDITING_STORAGE_KEY) !== 'false'
      );
    } catch {
      return true;
    }
  }

  private resolveFocusedRow(
    allRows: HTMLTableRowElement[],
    visibleRows: HTMLTableRowElement[],
    selectedVisibleRows: HTMLTableRowElement[],
  ): HTMLTableRowElement | null {
    if (this.lastSelectedRowIndex !== null) {
      const candidate = allRows[this.lastSelectedRowIndex];
      if (candidate && this.isRowVisible(candidate)) {
        return candidate;
      }
    }
    if (selectedVisibleRows.length > 0) {
      return selectedVisibleRows[selectedVisibleRows.length - 1] ?? null;
    }
    return visibleRows[0] ?? null;
  }

  private resolveKeyboardAnchorIndex(
    allRows: HTMLTableRowElement[],
    visibleRows: HTMLTableRowElement[],
    selectedVisibleRows: HTMLTableRowElement[],
  ): number {
    if (this.keyboardSelectionAnchorIndex !== null) {
      return this.keyboardSelectionAnchorIndex;
    }
    const focusRow = this.resolveFocusedRow(allRows, visibleRows, selectedVisibleRows);
    if (!focusRow) {
      return 0;
    }
    const index = allRows.indexOf(focusRow);
    return index >= 0 ? index : 0;
  }

  private applySingleSelection(
    allRows: HTMLTableRowElement[],
    targetRow: HTMLTableRowElement,
  ): void {
    for (const row of allRows) {
      row.classList.remove('list-item-selected');
    }
    targetRow.classList.add('list-item-selected');
  }

  private applyRangeSelection(
    allRows: HTMLTableRowElement[],
    visibleRows: HTMLTableRowElement[],
    anchorIndex: number,
    targetIndex: number,
  ): void {
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    for (const row of allRows) {
      row.classList.remove('list-item-selected');
    }
    for (const row of visibleRows) {
      const rowIndex = allRows.indexOf(row);
      if (rowIndex >= start && rowIndex <= end) {
        row.classList.add('list-item-selected');
      }
    }
  }

  private shouldIgnoreRowDoubleClick(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }

    const ignoredSelector =
      '.list-item-menu-trigger, .list-item-actions, input, button, select, textarea';
    return Boolean(target.closest(ignoredSelector));
  }

  private shouldIgnoreRowSelection(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }

    const ignoredSelector =
      '.list-item-menu-trigger, .list-item-actions, input, button, select, textarea';
    return Boolean(target.closest(ignoredSelector));
  }

  private shouldIgnoreDragStart(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }

    // Allow text selection in title text and links
    if (
      target.matches('span, a') ||
      target.closest('.list-item-title span, .list-item-title a')
    ) {
      return true;
    }

    // Allow interaction with tags
    if (target.matches('.collection-tag') || target.closest('.collection-tag')) {
      return true;
    }

    // Ignore other interactive elements
    const ignoredSelector = 'input, button, select, textarea, .list-item-notes-expand-trigger';
    return Boolean(target.closest(ignoredSelector));
  }

  private updateSelectionButtons(): void {
    const clearButton = document.getElementById('clear-selection-button');
    const deleteButton = document.getElementById('delete-selection-button');
    const moveButton = document.getElementById('move-selected-button');
    const copyButton = document.getElementById('copy-selected-button');
    const count = this.options.getSelectedItemCount();
    const hasSelection = count > 0;
    if (clearButton) {
      clearButton.classList.toggle('visible', hasSelection);
    }
    if (deleteButton) {
      deleteButton.classList.toggle('visible', hasSelection);
    }
    if (moveButton) {
      moveButton.classList.toggle('visible', hasSelection);
    }
    if (copyButton) {
      copyButton.classList.toggle('visible', hasSelection);
    }
    this.options.onSelectionChange?.();
  }

  private initializeColumnResizeHandles(
    headerRow: HTMLTableRowElement,
    tbody: HTMLTableSectionElement,
    listId: string,
    columnWidths: Record<string, number> | undefined,
    onColumnResize: ((columnKey: string, width: number) => void) | undefined,
  ): void {
    const headerCells = Array.from(headerRow.querySelectorAll<HTMLTableCellElement>('th'));
    for (const headerCell of headerCells) {
      const columnKey = headerCell.dataset['columnKey'];
      if (!columnKey) continue;
      this.addColumnResizeHandle({
        headerCell,
        listId,
        columnKey,
        ...(columnWidths ? { columnWidths } : {}),
        ...(onColumnResize ? { onColumnResize } : {}),
        tbody,
      });
    }
  }

  private addColumnContextMenu(
    headerCell: HTMLTableCellElement,
    columnKey: string,
    label: string,
    getColumnVisibility: ((columnKey: string) => ColumnVisibility) | undefined,
    onVisibilityChange: (visibility: ColumnVisibility) => void,
  ): void {
    headerCell.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();

      this.closeActiveColumnMenu();

      const menu = document.createElement('div');
      menu.className = 'list-column-menu';
      const titleEl = document.createElement('div');
      titleEl.className = 'list-column-menu-title';
      titleEl.textContent = `Column: ${label}`;
      menu.appendChild(titleEl);

      const currentVisibility = getColumnVisibility
        ? getColumnVisibility(columnKey)
        : ('show-with-data' as ColumnVisibility);

      const addOption = (mode: ColumnVisibility, text: string) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'list-column-menu-item';
        if (mode === currentVisibility) {
          button.classList.add('selected');
        }
        button.textContent = text;
        button.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.closeActiveColumnMenu();
          onVisibilityChange(mode);
        });
        menu.appendChild(button);
      };

      addOption('always-show', 'Always show');
      addOption('show-with-data', 'Show with data');
      addOption('hide-in-compact', 'Hide in compact');

      document.body.appendChild(menu);
      this.activeColumnMenu = menu;

      const rect = headerCell.getBoundingClientRect();
      const menuRect = menu.getBoundingClientRect();
      let left = event.clientX;
      let top = rect.bottom + 4;
      if (left + menuRect.width > window.innerWidth - 8) {
        left = window.innerWidth - menuRect.width - 8;
      }
      if (top + menuRect.height > window.innerHeight - 8) {
        top = rect.top - menuRect.height - 4;
      }
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;

      const handleOutsideClick = (e: MouseEvent | FocusEvent | KeyboardEvent) => {
        if (e instanceof KeyboardEvent && e.key !== 'Escape') {
          return;
        }
        if (e.target instanceof Node && menu.contains(e.target)) {
          return;
        }
        this.closeActiveColumnMenu();
        document.removeEventListener('click', handleOutsideClick);
        document.removeEventListener('contextmenu', handleOutsideClick);
        document.removeEventListener('keydown', handleOutsideClick);
      };

      document.addEventListener('click', handleOutsideClick);
      document.addEventListener('contextmenu', handleOutsideClick);
      document.addEventListener('keydown', handleOutsideClick);
    });
  }

  private closeActiveColumnMenu(): void {
    if (this.activeColumnMenu) {
      this.activeColumnMenu.remove();
      this.activeColumnMenu = null;
    }
  }

  private addColumnResizeHandle(options: {
    headerCell: HTMLTableCellElement;
    listId: string;
    columnKey: string;
    columnWidths?: Record<string, number>;
    onColumnResize?: (columnKey: string, width: number) => void;
    tbody: HTMLTableSectionElement;
  }): void {
    const { headerCell, listId, columnKey, columnWidths, onColumnResize, tbody } = options;
    if (!columnKey || columnKey === 'checkbox') {
      return;
    }

    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'list-column-resize-handle';
    headerCell.appendChild(resizeHandle);

    const minWidth = columnKey === 'title' ? 150 : 80;

    const ensureFixedTableLayout = (lockExistingWidths = false) => {
      const table = headerCell.closest('table');
      if (!table || !(table instanceof HTMLTableElement)) {
        return;
      }
      const computedLayout =
        typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
          ? window.getComputedStyle(table).tableLayout
          : null;
      const isFixed = table.style.tableLayout === 'fixed' || computedLayout === 'fixed';
      if (isFixed) {
        return;
      }

      const headerCells = Array.from(
        headerCell.parentElement?.querySelectorAll<HTMLTableCellElement>('th') ?? [],
      );
      const widths = lockExistingWidths
        ? headerCells.map((cell) => Math.round(cell.getBoundingClientRect().width))
        : null;

      table.style.tableLayout = 'fixed';

      if (!widths) {
        return;
      }

      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
      headerCells.forEach((cell, index) => {
        const width = widths[index];
        if (!width || !Number.isFinite(width)) {
          return;
        }
        const px = `${width}px`;
        cell.style.width = px;
        for (const row of rows) {
          const tableCell = row.children[index] as HTMLTableCellElement | undefined;
          if (tableCell) {
            tableCell.style.width = px;
          }
        }
      });
    };

    const applyWidthToColumn = (width: number) => {
      ensureFixedTableLayout();
      const px = `${Math.max(minWidth, Math.round(width))}px`;
      const headerCells = Array.from(
        headerCell.parentElement?.querySelectorAll<HTMLTableCellElement>('th') ?? [],
      );
      const columnIndex = headerCells.indexOf(headerCell);
      if (columnIndex === -1) {
        return;
      }
      headerCell.style.width = px;
      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
      for (const row of rows) {
        const cell = row.children[columnIndex] as HTMLTableCellElement | undefined;
        if (cell) {
          cell.style.width = px;
        }
      }
    };

    const initialWidth = columnWidths?.[columnKey];
    if (typeof initialWidth === 'number' && Number.isFinite(initialWidth) && initialWidth > 0) {
      applyWidthToColumn(initialWidth);
    }

    resizeHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      ensureFixedTableLayout(true);

      const rect = headerCell.getBoundingClientRect();
      const startX = event.clientX;
      const startWidth = rect.width;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== event.pointerId) {
          return;
        }
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(minWidth, startWidth + delta);
        applyWidthToColumn(newWidth);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== event.pointerId) {
          return;
        }
        upEvent.preventDefault();
        resizeHandle.releasePointerCapture(event.pointerId);
        resizeHandle.removeEventListener('pointermove', handlePointerMove);
        resizeHandle.removeEventListener('pointerup', handlePointerUp);
        resizeHandle.removeEventListener('pointercancel', handlePointerUp);

        const finalRect = headerCell.getBoundingClientRect();
        const finalWidth = Math.max(minWidth, Math.round(finalRect.width));
        if (this.options.onColumnResize) {
          this.options.onColumnResize(listId, columnKey, finalWidth);
        }
        if (onColumnResize) {
          onColumnResize(columnKey, finalWidth);
        }
        this.updateMarkdownOverflowStates(tbody);
      };

      resizeHandle.setPointerCapture(event.pointerId);
      resizeHandle.addEventListener('pointermove', handlePointerMove);
      resizeHandle.addEventListener('pointerup', handlePointerUp);
      resizeHandle.addEventListener('pointercancel', handlePointerUp);
    });
  }

  private makeSortableHeader(
    headerCell: HTMLTableCellElement,
    columnKey: string,
    sortState: SortState | null | undefined,
    onSortChange: ((sortState: SortState | null) => void) | undefined,
  ): void {
    if (!onSortChange || columnKey === 'checkbox') {
      return;
    }

    headerCell.classList.add('sortable-header');

    // Add sort indicator
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';

    const isSorted = sortState?.column === columnKey;
    if (isSorted) {
      headerCell.classList.add('sorted');
      indicator.textContent = sortState.direction === 'asc' ? ' ▲' : ' ▼';
    } else {
      indicator.textContent = '';
    }
    headerCell.appendChild(indicator);

    // Add click handler for sorting
    headerCell.addEventListener('click', (e) => {
      // Don't sort if clicking on resize handle
      if ((e.target as HTMLElement).classList.contains('list-column-resize-handle')) {
        return;
      }

      // Use toggleSort for three-state cycle: asc → desc → reset
      const newSortState = toggleSort(sortState ?? null, columnKey);
      onSortChange(newSortState);
    });
  }
}
