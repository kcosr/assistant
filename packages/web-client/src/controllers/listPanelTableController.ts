import { applyMarkdownToElement } from '../utils/markdown';
import type { ListCustomFieldDefinition } from './listCustomFields';
import type { ListPanelItem } from './listPanelController';
import type { ColumnVisibility } from '../utils/listColumnPreferences';
import { getVisibleCustomFields, normalizeListCustomFields } from '../utils/listColumnVisibility';
import type { SortState } from '../utils/listSorting';
import { parseFieldValueToDate, toggleSort } from '../utils/listSorting';

const NOTES_EXPAND_ICON_SVG = `<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="12" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 11h6M9 15h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export interface ListPanelTableControllerOptions {
  icons: {
    moreVertical: string;
  };
  renderTags: (tags: string[] | undefined) => HTMLElement | null;
  recentUserItemUpdates: Set<string>;
  userUpdateTimeoutMs: number;
  getSelectedItemCount: () => number;
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
  onEditItem?: (listId: string, item: ListPanelItem) => void;
  onColumnResize?: (listId: string, columnKey: string, width: number) => void;
}

export interface ListPanelTableRenderOptions {
  listId: string;
  sortedItems: ListPanelItem[];
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
  private lastSelectedRowIndex: number | null = null;
  private activeColumnMenu: HTMLElement | null = null;
  private notesPopup: HTMLElement | null = null;
  private notesPopupHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private notesPopupShowTimeout: ReturnType<typeof setTimeout> | null = null;
  private renderState: ListPanelTableRenderState | null = null;

  constructor(private readonly options: ListPanelTableControllerOptions) {}

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
    const {
      listId,
      sortedItems,
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

    const titleHeader = document.createElement('th');
    titleHeader.textContent = 'Title';
    titleHeader.dataset['columnKey'] = 'title';
    this.makeSortableHeader(titleHeader, 'title', sortState, onSortChange);
    headerRow.appendChild(titleHeader);

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

    const colCount =
      1 +
      1 +
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
      markerRow.draggable = true;
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

      // Drag handling for moving the marker
      markerRow.addEventListener('dragstart', (e) => {
        markerRow.classList.add('focus-marker-dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', 'focus-marker');
        }
      });

      markerRow.addEventListener('dragend', () => {
        markerRow.classList.remove('focus-marker-dragging');
        // Clean up any drag-over states
        tbody.querySelectorAll('.focus-marker-drop-target').forEach((el) => {
          el.classList.remove('focus-marker-drop-target');
        });
      });

      // Touch handling for mobile - same pattern as item drag handles
      const isCoarsePointer =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;

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
            if (!dt || dt.types.indexOf('text/plain') === -1) return;
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

    this.initializeColumnResizeHandles(headerRow, tbody, listId, columnWidths, onColumnResize);

    this.renderState = {
      listId,
      tbody,
      colCount,
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
    if (wasSelected) {
      newRow.classList.add('list-item-selected');
    }
    existingRow.replaceWith(newRow);

    if (focusMarkerItemId && onFocusMarkerMove) {
      newRow.addEventListener('dragover', (e) => {
        const dt = e.dataTransfer;
        if (!dt || dt.types.indexOf('text/plain') === -1) return;
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

  private buildItemRow(options: ListPanelRowRenderOptions): HTMLTableRowElement {
    const {
      listId,
      item,
      index,
      sortedItems,
      tbody,
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

    let onDragStartFromHandle: ((e: DragEvent | null) => void) | null = null;
    let onDragEnd: (() => void) | null = null;

    if (itemId) {
      row.dataset['itemId'] = itemId;
      row.draggable = false;
      onDragStartFromHandle = (e: DragEvent | null): void => {
        this.draggedItemId = itemId;
        row.classList.add('dragging');
        if (e && e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', itemId);
          e.dataTransfer.setDragImage(row, 0, 0);
        }
      };
      onDragEnd = (): void => {
        this.draggedItemId = null;
        row.classList.remove('dragging');
        tbody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      };

      row.addEventListener('click', (e) => {
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
        } else if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          row.classList.toggle('list-item-selected');
          const rows = Array.from(tbody.querySelectorAll('.list-item-row'));
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
      const LONG_PRESS_THRESHOLD_MS = 500;
      const TOUCH_MOVE_THRESHOLD = 10;

      row.addEventListener(
        'touchstart',
        (e) => {
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
        const touchDuration = Date.now() - touchStartTime;
        const touch = e.changedTouches[0];

        if (touch && touchDuration >= LONG_PRESS_THRESHOLD_MS) {
          const dx = Math.abs(touch.clientX - touchStartX);
          const dy = Math.abs(touch.clientY - touchStartY);

          if (dx < TOUCH_MOVE_THRESHOLD && dy < TOUCH_MOVE_THRESHOLD) {
            e.preventDefault();
            row.classList.toggle('list-item-selected');
            const rows = Array.from(tbody.querySelectorAll('.list-item-row'));
            this.lastSelectedRowIndex = rows.indexOf(row);
            this.updateSelectionButtons();
          }
        }
      });

      row.addEventListener('dragend', () => onDragEnd?.());

      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!this.draggedItemId || this.draggedItemId === itemId) return;
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = 'move';
        }
        const draggedItem = sortedItems.find((it) => it.id === this.draggedItemId);
        if (!draggedItem) return;
        const draggedIsCompleted = draggedItem.completed ?? false;
        if (draggedIsCompleted !== isCompleted) return;

        row.classList.add('drag-over');
      });

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over');
      });

      row.addEventListener('drop', async (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (!this.draggedItemId || !itemId || this.draggedItemId === itemId) return;

        const draggedItem = sortedItems.find((it) => it.id === this.draggedItemId);
        if (!draggedItem) return;
        const draggedIsCompleted = draggedItem.completed ?? false;
        if (draggedIsCompleted !== isCompleted) return;

        const newPosition = item.position ?? index;

        const originalPosition = draggedItem.position ?? 0;
        draggedItem.position = newPosition;

        rerender();

        const draggedId = this.draggedItemId;
        if (!draggedId) {
          return;
        }

        this.options.recentUserItemUpdates.add(draggedId);
        window.setTimeout(() => {
          this.options.recentUserItemUpdates.delete(draggedId);
        }, this.options.userUpdateTimeoutMs);

        const success = await this.options.updateListItem(listId, draggedId, {
          position: newPosition,
        });
        if (!success) {
          draggedItem.position = originalPosition;
          rerender();
        }
      });
    }

    const checkboxCell = document.createElement('td');
    checkboxCell.className = 'list-item-checkbox-cell';

    const actions = document.createElement('div');
    actions.className = 'list-item-actions';

    const menuTrigger = document.createElement('button');
    menuTrigger.type = 'button';
    menuTrigger.className = 'list-item-menu-trigger';
    menuTrigger.innerHTML = this.options.icons.moreVertical;
    menuTrigger.setAttribute('aria-label', 'Item actions');

    if (itemId) {
      menuTrigger.title = 'Drag to reorder, click for actions';
      menuTrigger.draggable = true;
      let lastDragStartAt = 0;
      const isCoarsePointer =
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches;

      let touchLongPressTimer: ReturnType<typeof setTimeout> | null = null;
      let touchStartX = 0;
      let touchStartY = 0;
      let touchDragActive = false;
      let touchCurrentDropRow: HTMLTableRowElement | null = null;
      let touchDraggedItemId: string | null = null;

      const startDragFromHandle = (e: DragEvent | null) => {
        if (isCoarsePointer) {
          return;
        }
        lastDragStartAt = Date.now();
        onDragStartFromHandle?.(e);
      };

      menuTrigger.addEventListener('dragstart', (e) => {
        e.stopPropagation();
        startDragFromHandle(e);
      });

      menuTrigger.addEventListener('dragend', () => {
        onDragEnd?.();
      });

      if (isCoarsePointer) {
        menuTrigger.addEventListener(
          'touchstart',
          (e) => {
            e.stopPropagation();
            const touch = e.touches[0];
            if (!touch || !itemId) return;

            touchStartX = touch.clientX;
            touchStartY = touch.clientY;
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

        menuTrigger.addEventListener(
          'touchmove',
          (e) => {
            e.stopPropagation();
            const touch = e.touches[0];
            if (!touch) return;

            const dx = Math.abs(touch.clientX - touchStartX);
            const dy = Math.abs(touch.clientY - touchStartY);
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

        menuTrigger.addEventListener(
          'touchend',
          async (e) => {
            e.stopPropagation();

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
            if (!touchCurrentDropRow || !draggedId) {
              onDragEnd?.();
              return;
            }

            const targetItemId = touchCurrentDropRow.dataset['itemId'];
            if (!targetItemId || targetItemId === touchDraggedItemId) {
              touchCurrentDropRow.classList.remove('drag-over');
              touchCurrentDropRow = null;
              onDragEnd?.();
              return;
            }

            const draggedItem = sortedItems.find((it) => it.id === draggedId);
            const targetItem = sortedItems.find((it) => it.id === targetItemId);
            if (!draggedItem || !targetItem) {
              touchCurrentDropRow.classList.remove('drag-over');
              touchCurrentDropRow = null;
              onDragEnd?.();
              return;
            }

            const draggedIsCompleted = draggedItem.completed ?? false;
            const targetIsCompleted = targetItem.completed ?? false;
            if (draggedIsCompleted !== targetIsCompleted) {
              touchCurrentDropRow.classList.remove('drag-over');
              touchCurrentDropRow = null;
              onDragEnd?.();
              return;
            }

            const newPosition =
              typeof targetItem.position === 'number'
                ? targetItem.position
                : typeof item.position === 'number'
                  ? item.position
                  : index;

            const originalPosition = draggedItem.position ?? 0;
            draggedItem.position = newPosition;

            rerender();

            this.options.recentUserItemUpdates.add(draggedId);
            window.setTimeout(() => {
              this.options.recentUserItemUpdates.delete(draggedId);
            }, this.options.userUpdateTimeoutMs);

            const success = await this.options.updateListItem(listId, draggedId, {
              position: newPosition,
            });
            if (!success) {
              draggedItem.position = originalPosition;
              rerender();
            }

            touchCurrentDropRow.classList.remove('drag-over');
            touchCurrentDropRow = null;
            onDragEnd?.();
          },
          { passive: false },
        );

        menuTrigger.addEventListener(
          'touchcancel',
          (e) => {
            e.stopPropagation();

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

    const titleCell = document.createElement('td');
    titleCell.className = isCompleted
      ? 'list-item-title list-item-completed-text'
      : 'list-item-title';

    const titleContent = document.createElement('div');
    titleContent.className = 'list-item-title-content';

    const titleMain = document.createElement('div');
    titleMain.className = 'list-item-title-main';

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

    if (showUrlColumn) {
      const urlCell = document.createElement('td');
      urlCell.className = isCompleted ? 'list-item-completed-text' : '';
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
      this.renderNotesCell(notesCell, listId, item, itemId, isCompleted);
      row.appendChild(notesCell);
    }

    for (const field of visibleCustomFields) {
      const customCell = document.createElement('td');
      customCell.className = isCompleted ? 'list-item-completed-text' : '';
      const key = field.key;
      const value = item.customFields ? item.customFields[key] : undefined;
      const text = this.formatCustomFieldValue(value, field.type);
      if (text.trim().length > 0) {
        customCell.textContent = text;
      }
      row.appendChild(customCell);
    }

    if (showTagsColumn) {
      const tagsCell = document.createElement('td');
      tagsCell.className = isCompleted ? 'list-item-completed-text' : '';
      const tagsPills = this.options.renderTags(item.tags);
      if (tagsPills) {
        tagsCell.appendChild(tagsPills);
      }
      row.appendChild(tagsCell);
    }

    if (showAddedColumn) {
      const addedCell = document.createElement('td');
      addedCell.className = isCompleted ? 'list-item-completed-text' : '';
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
    notesCell.className = isCompleted
      ? 'list-item-notes-cell list-item-completed-text'
      : 'list-item-notes-cell';
    const notes = typeof item.notes === 'string' ? item.notes : '';
    notesCell.innerHTML = '';

    if (notes.trim().length > 0) {
      const display = document.createElement('div');
      display.className = 'list-item-notes-display';
      applyMarkdownToElement(display, notes);
      notesCell.appendChild(display);

      // Add fade effect if content overflows, and enable hover popup trigger
      setTimeout(() => {
        if (display.isConnected) {
          const shouldFade = display.scrollHeight > display.clientHeight + 1;
          display.classList.toggle('list-item-notes-display--fade', shouldFade);

          if (shouldFade) {
            // Add a small trigger area in the bottom-right corner
            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'list-item-notes-expand-trigger';
            trigger.innerHTML = NOTES_EXPAND_ICON_SVG;
            trigger.title = 'View full notes';
            trigger.setAttribute('aria-label', 'View full notes');
            notesCell.style.position = 'relative';
            notesCell.appendChild(trigger);

            trigger.addEventListener('mouseenter', (e: MouseEvent) => {
              this.scheduleShowNotesPopup(notes, e.clientX, e.clientY);
            });
            trigger.addEventListener('mouseleave', () => {
              this.cancelShowNotesPopup();
              this.hideNotesPopup();
            });
          }
        }
      }, 0);
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

  clearSelection(bodyEl: HTMLElement): void {
    const selectedRows = bodyEl.querySelectorAll('.list-item-row.list-item-selected');
    selectedRows.forEach((row) => {
      row.classList.remove('list-item-selected');
    });
    this.lastSelectedRowIndex = null;
    this.updateSelectionButtons();
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
    this.updateSelectionButtons();
  }

  selectAll(bodyEl: HTMLElement): void {
    const rows = Array.from(bodyEl.querySelectorAll<HTMLTableRowElement>('.list-item-row'));
    for (const row of rows) {
      row.classList.add('list-item-selected');
    }
    this.lastSelectedRowIndex = rows.length > 0 ? rows.length - 1 : null;
    this.updateSelectionButtons();
  }

  private shouldIgnoreRowDoubleClick(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) {
      return false;
    }

    const ignoredSelector =
      '.list-item-menu-trigger, .list-item-actions, input, button, select, textarea';
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

    const applyWidthToColumn = (width: number) => {
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

    resizeHandle.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();

      const rect = headerCell.getBoundingClientRect();
      const startX = event.clientX;
      const startWidth = rect.width;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX;
        const newWidth = Math.max(minWidth, startWidth + delta);
        applyWidthToColumn(newWidth);
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        upEvent.preventDefault();
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        const finalRect = headerCell.getBoundingClientRect();
        const finalWidth = Math.max(minWidth, Math.round(finalRect.width));
        if (this.options.onColumnResize) {
          this.options.onColumnResize(listId, columnKey, finalWidth);
        }
        if (onColumnResize) {
          onColumnResize(columnKey, finalWidth);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
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
