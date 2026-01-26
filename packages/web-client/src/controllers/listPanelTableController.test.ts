// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListPanelTableController } from './listPanelTableController';

const originalPointerEvent = globalThis.PointerEvent;

class MockPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

describe('ListPanelTableController double-click edit', () => {
  const listId = 'list1';

  const baseRenderOptions = {
    listId,
    sortedItems: [{ id: 'item1', title: 'Item 1' }],
    showUrlColumn: false,
    showNotesColumn: false,
    showTagsColumn: false,
    showAddedColumn: false,
    showUpdatedColumn: false,
    showTouchedColumn: false,
    rerender: () => {},
  };

  const recentUserItemUpdates = new Set<string>();

  beforeEach(() => {
    document.body.innerHTML = '';

    if (!globalThis.PointerEvent) {
      (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
        MockPointerEvent as unknown as typeof PointerEvent;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';

    if (originalPointerEvent) {
      (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent = originalPointerEvent;
    } else {
      delete (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
    }
  });

  it('calls onEditItem when double-clicking a row', () => {
    const onEditItem = vi.fn();
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
      onEditItem,
    });

    const { tbody } = controller.renderTable(baseRenderOptions);
    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));

    expect(onEditItem).toHaveBeenCalledTimes(1);
    expect(onEditItem).toHaveBeenCalledWith(
      'list1',
      expect.objectContaining({ id: 'item1', title: 'Item 1' }),
    );
  });

  it('does not call onEditItem when double-clicking the menu trigger', () => {
    const onEditItem = vi.fn();
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
      onEditItem,
    });

    const { tbody } = controller.renderTable(baseRenderOptions);
    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    const menuTrigger = row?.querySelector<HTMLButtonElement>('.list-item-menu-trigger');
    expect(menuTrigger).not.toBeNull();

    menuTrigger?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));

    expect(onEditItem).not.toHaveBeenCalled();
  });
});

describe('ListPanelTableController drag reorder and selection', () => {
  const listId = 'list1';

  const baseRenderOptions = {
    listId,
    sortedItems: [{ id: 'item1', title: 'Item 1' }],
    showUrlColumn: false,
    showNotesColumn: false,
    showTagsColumn: false,
    showAddedColumn: false,
    showUpdatedColumn: false,
    showTouchedColumn: false,
    rerender: () => {},
  };

  const recentUserItemUpdates = new Set<string>();

  beforeEach(() => {
    document.body.innerHTML = '';

    if (!globalThis.PointerEvent) {
      (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
        MockPointerEvent as unknown as typeof PointerEvent;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';

    if (originalPointerEvent) {
      (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent = originalPointerEvent;
    } else {
      delete (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent;
    }
  });

  it('starts dragging when the row body is used', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { tbody } = controller.renderTable(baseRenderOptions);
    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();

    expect(row?.draggable).toBe(false);
    row?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 10,
        clientY: 0,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );

    expect(row?.classList.contains('dragging')).toBe(true);

    document.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 10,
        clientY: 0,
        pointerId: 1,
        pointerType: 'mouse',
      }),
    );
  });

  it('does not start dragging from title text', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { tbody } = controller.renderTable(baseRenderOptions);
    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    const titleText = row?.querySelector<HTMLElement>('.list-item-title span');
    expect(row).not.toBeNull();
    expect(titleText).not.toBeNull();

    titleText?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 2,
        pointerType: 'mouse',
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 10,
        clientY: 0,
        pointerId: 2,
        pointerType: 'mouse',
      }),
    );

    expect(row?.classList.contains('dragging')).toBe(false);
  });

  it('selects a row on click when the panel is active', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody } = controller.renderTable(baseRenderOptions);
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.appendChild(table);
    document.body.appendChild(panelFrame);

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(row?.classList.contains('list-item-selected')).toBe(true);
  });

  it('clears selection when clicking the selected row in single-click mode', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody } = controller.renderTable(baseRenderOptions);
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.appendChild(table);
    document.body.appendChild(panelFrame);

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(row?.classList.contains('list-item-selected')).toBe(true);

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(row?.classList.contains('list-item-selected')).toBe(false);
  });

  it('ignores modifier-toggle selection when single-click mode is enabled', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody } = controller.renderTable({
      ...baseRenderOptions,
      sortedItems: [
        { id: 'item1', title: 'Item 1' },
        { id: 'item2', title: 'Item 2' },
      ],
    });
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.appendChild(table);
    document.body.appendChild(panelFrame);

    const rows = tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row');
    const firstRow = rows[0];
    const secondRow = rows[1];
    expect(firstRow).not.toBeNull();
    expect(secondRow).not.toBeNull();

    firstRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(firstRow?.classList.contains('list-item-selected')).toBe(true);

    secondRow?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    expect(firstRow?.classList.contains('list-item-selected')).toBe(true);
    expect(secondRow?.classList.contains('list-item-selected')).toBe(false);
  });

  it('does not select a row on click when the panel is not active', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody } = controller.renderTable(baseRenderOptions);
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame';
    panelFrame.appendChild(table);
    document.body.appendChild(panelFrame);

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(row?.classList.contains('list-item-selected')).toBe(false);
  });

  it('does not select a row on click when single-click selection is disabled', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    window.localStorage.setItem('aiAssistantListSingleClickSelectionEnabled', 'false');

    const { table, tbody } = controller.renderTable(baseRenderOptions);
    const panelFrame = document.createElement('div');
    panelFrame.className = 'panel-frame is-active';
    panelFrame.appendChild(table);
    document.body.appendChild(panelFrame);

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();

    row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(row?.classList.contains('list-item-selected')).toBe(false);

    window.localStorage.removeItem('aiAssistantListSingleClickSelectionEnabled');
  });

  it('moves selected items to another list on pointer drop', async () => {
    const onMoveItemsToList = vi.fn(async () => {});
    const sourceController = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
      onMoveItemsToList,
    });

    const targetController = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const source = sourceController.renderTable({
      ...baseRenderOptions,
      listId: 'list-a',
      sortedItems: [
        { id: 'item-1', title: 'Item 1' },
        { id: 'item-2', title: 'Item 2' },
      ],
    });

    const target = targetController.renderTable({
      ...baseRenderOptions,
      listId: 'list-b',
      sortedItems: [{ id: 'item-b1', title: 'Item B1', position: 0 }],
    });

    document.body.appendChild(source.table);
    document.body.appendChild(target.table);

    const sourceRows = Array.from(
      source.tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row'),
    );
    const targetRow = target.tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(sourceRows).toHaveLength(2);
    expect(targetRow).not.toBeNull();
    if (!targetRow) {
      throw new Error('Expected target row');
    }

    sourceRows[0]?.classList.add('list-item-selected');
    sourceRows[1]?.classList.add('list-item-selected');

    const originalElementFromPoint = document.elementFromPoint;
    if (!originalElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', {
        value: () => null,
        configurable: true,
      });
    }
    const elementFromPointSpy = vi
      .spyOn(document, 'elementFromPoint')
      .mockImplementation(() => targetRow);

    sourceRows[0]?.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        clientX: 0,
        clientY: 0,
        pointerId: 3,
        pointerType: 'mouse',
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: 12,
        clientY: 0,
        pointerId: 3,
        pointerType: 'mouse',
      }),
    );
    document.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        clientX: 12,
        clientY: 0,
        pointerId: 3,
        pointerType: 'mouse',
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onMoveItemsToList).toHaveBeenCalledTimes(1);
    expect(onMoveItemsToList).toHaveBeenCalledWith(
      'list-a',
      ['item-1', 'item-2'],
      'list-b',
      1,
    );

    elementFromPointSpy.mockRestore();
    if (!originalElementFromPoint) {
      delete (document as { elementFromPoint?: typeof document.elementFromPoint }).elementFromPoint;
    }
  });

  it('selects only visible rows when selecting visible', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () =>
        document.querySelectorAll('.list-item-row.list-item-selected').length,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody } = controller.renderTable({
      ...baseRenderOptions,
      sortedItems: [
        { id: 'item1', title: 'Item 1' },
        { id: 'item2', title: 'Item 2' },
        { id: 'item3', title: 'Item 3' },
      ],
    });

    const bodyEl = document.createElement('div');
    bodyEl.appendChild(table);
    document.body.appendChild(bodyEl);

    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row'));
    expect(rows).toHaveLength(3);

    // Hide the middle row (as search filtering does).
    rows[1]!.style.display = 'none';
    rows[1]!.classList.add('list-item-selected');

    controller.selectVisible(bodyEl);

    expect(rows[0]!.classList.contains('list-item-selected')).toBe(true);
    expect(rows[1]!.classList.contains('list-item-selected')).toBe(false);
    expect(rows[2]!.classList.contains('list-item-selected')).toBe(true);
  });

  it('updates bulk action visibility when selection changes', () => {
    const onSelectionChange = vi.fn();
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () =>
        document.querySelectorAll('.list-item-row.list-item-selected').length,
      onSelectionChange,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table } = controller.renderTable({
      ...baseRenderOptions,
      sortedItems: [
        { id: 'item1', title: 'Item 1' },
        { id: 'item2', title: 'Item 2' },
      ],
    });

    const bodyEl = document.createElement('div');
    bodyEl.appendChild(table);
    document.body.appendChild(bodyEl);

    const clearButton = document.createElement('button');
    clearButton.id = 'clear-selection-button';
    document.body.appendChild(clearButton);

    const deleteButton = document.createElement('button');
    deleteButton.id = 'delete-selection-button';
    document.body.appendChild(deleteButton);

    const moveButton = document.createElement('button');
    moveButton.id = 'move-selected-button';
    document.body.appendChild(moveButton);

    const copyButton = document.createElement('button');
    copyButton.id = 'copy-selected-button';
    document.body.appendChild(copyButton);

    controller.selectAll(bodyEl);

    expect(clearButton.classList.contains('visible')).toBe(true);
    expect(deleteButton.classList.contains('visible')).toBe(true);
    expect(moveButton.classList.contains('visible')).toBe(true);
    expect(copyButton.classList.contains('visible')).toBe(true);
    expect(onSelectionChange).toHaveBeenCalledTimes(1);

    controller.clearSelection(bodyEl);

    expect(clearButton.classList.contains('visible')).toBe(false);
    expect(deleteButton.classList.contains('visible')).toBe(false);
    expect(moveButton.classList.contains('visible')).toBe(false);
    expect(copyButton.classList.contains('visible')).toBe(false);
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
  });

  it('adds external drag payloads when provided', () => {
    const dataTransfer = {
      setData: vi.fn(),
      setDragImage: vi.fn(),
    } as unknown as DataTransfer;

    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
      getExternalDragPayload: () => ({ plainText: 'exported payload' }),
    });

    const { tbody } = controller.renderTable(baseRenderOptions);
    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    const menuTrigger = row?.querySelector<HTMLButtonElement>('.list-item-menu-trigger');
    expect(menuTrigger).not.toBeNull();

    const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(dragEvent, 'dataTransfer', { value: dataTransfer });
    menuTrigger?.dispatchEvent(dragEvent);

    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'exported payload');
  });
});

describe('ListPanelTableController keyboard selection', () => {
  const listId = 'list1';
  const recentUserItemUpdates = new Set<string>();

  const baseRenderOptions = {
    listId,
    sortedItems: [
      { id: 'item1', title: 'Item 1' },
      { id: 'item2', title: 'Item 2' },
      { id: 'item3', title: 'Item 3' },
    ],
    showUrlColumn: false,
    showNotesColumn: false,
    showTagsColumn: false,
    showAddedColumn: false,
    showUpdatedColumn: false,
    showTouchedColumn: false,
    rerender: () => {},
  };

  const getSelectedCount = () =>
    document.querySelectorAll('.list-item-row.list-item-selected').length;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('selects and wraps with arrow navigation', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: getSelectedCount,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { tbody } = controller.renderTable(baseRenderOptions);
    expect(tbody.querySelectorAll('.list-item-row').length).toBe(3);

    controller.moveSelectionByOffset(1, { wrap: true });
    expect(controller.getFocusedItemId()).toBe('item1');

    controller.moveSelectionByOffset(1, { wrap: true });
    expect(controller.getFocusedItemId()).toBe('item2');

    controller.moveSelectionByOffset(1, { wrap: true });
    expect(controller.getFocusedItemId()).toBe('item3');

    controller.moveSelectionByOffset(1, { wrap: true });
    expect(controller.getFocusedItemId()).toBe('item1');
  });

  it('extends and contracts selection with shift navigation', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: getSelectedCount,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { tbody } = controller.renderTable(baseRenderOptions);

    controller.moveSelectionByOffset(1, { wrap: true });
    controller.moveSelectionByOffset(1, { wrap: true });
    expect(controller.getFocusedItemId()).toBe('item2');

    controller.moveSelectionByOffset(1, { extend: true, wrap: true });
    const selectedAfterExtend = Array.from(
      tbody.querySelectorAll('.list-item-row.list-item-selected'),
    ).map((row) => (row as HTMLElement).dataset['itemId']);
    expect(selectedAfterExtend).toEqual(['item2', 'item3']);

    controller.moveSelectionByOffset(-1, { extend: true, wrap: true });
    const selectedAfterContract = Array.from(
      tbody.querySelectorAll('.list-item-row.list-item-selected'),
    ).map((row) => (row as HTMLElement).dataset['itemId']);
    expect(selectedAfterContract).toEqual(['item2']);
  });
});

describe('ListPanelTableController notes column', () => {
  const listId = 'list1';
  const inlineEditingStorageKey = 'aiAssistantListInlineCustomFieldEditingEnabled';

  const recentUserItemUpdates = new Set<string>();

  beforeEach(() => {
    document.body.innerHTML = '';
    try {
      localStorage.removeItem(inlineEditingStorageKey);
    } catch {
      // Ignore localStorage errors in tests.
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      localStorage.removeItem(inlineEditingStorageKey);
    } catch {
      // Ignore localStorage errors in tests.
    }
  });

  it('renders markdown in the notes cell without inline editing', async () => {
    const updateListItem = vi.fn(async () => true);
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem,
    });

    const { table, tbody } = controller.renderTable({
      listId,
      sortedItems: [{ id: 'item1', title: 'Item 1', notes: '# Heading' }],
      showUrlColumn: false,
      showNotesColumn: true,
      showTagsColumn: false,
      showAddedColumn: false,
      rerender: () => {},
    });

    const bodyEl = document.createElement('div');
    bodyEl.appendChild(table);
    document.body.appendChild(bodyEl);

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();

    const cells = row ? Array.from(row.querySelectorAll<HTMLTableCellElement>('td')) : [];
    // checkbox, title, notes
    const notesCell = cells[2];
    expect(notesCell).toBeDefined();
    if (!notesCell) {
      throw new Error('Expected notes cell');
    }

    const display = notesCell.querySelector<HTMLElement>('.list-item-notes-display');
    expect(display).not.toBeNull();
    expect(display?.querySelector('h1')).not.toBeNull();

    // Clicking the notes cell does not enable inline editing.
    notesCell.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const textarea = notesCell.querySelector<HTMLTextAreaElement>('.list-item-notes-textarea');
    expect(textarea).toBeNull();
    expect(updateListItem).not.toHaveBeenCalled();
  });

  it('renders custom field columns when data exists', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody, colCount } = controller.renderTable({
      listId,
      sortedItems: [
        {
          id: 'item1',
          title: 'Item 1',
          customFields: { priority: 'High', urgent: true },
        },
      ],
      showUrlColumn: false,
      showNotesColumn: false,
      showTagsColumn: false,
      showAddedColumn: false,
      customFields: [
        { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Low'] },
        { key: 'urgent', label: 'Urgent', type: 'checkbox' },
      ],
      showAllColumns: false,
      rerender: () => {},
    });

    const headerCells = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'));
    expect(headerCells.map((c) => c.textContent)).toEqual(['', 'Title', 'Priority', 'Urgent']);
    expect(colCount).toBe(4);

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();
    if (!row) return;

    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
    // checkbox, title, priority, urgent
    const prioritySelect = cells[2]?.querySelector<HTMLSelectElement>('select');
    const urgentCheckbox = cells[3]?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(prioritySelect).not.toBeNull();
    expect(urgentCheckbox).not.toBeNull();
    expect(prioritySelect?.value).toBe('High');
    expect(urgentCheckbox?.checked).toBe(true);
  });

  it('renders empty inline select with a blank placeholder', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { tbody } = controller.renderTable({
      listId,
      sortedItems: [{ id: 'item1', title: 'Item 1' }],
      showUrlColumn: false,
      showNotesColumn: false,
      showTagsColumn: false,
      showAddedColumn: false,
      customFields: [
        { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Low'] },
      ],
      showAllColumns: false,
      rerender: () => {},
    });

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();
    if (!row) return;

    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
    const select = cells[2]?.querySelector<HTMLSelectElement>('select');
    expect(select).not.toBeNull();
    if (!select) return;

    expect(select.value).toBe('');
    expect(select.options[0]?.textContent ?? '').toBe('');
  });

  it('renders custom field values when inline editing is disabled', () => {
    try {
      localStorage.setItem(inlineEditingStorageKey, 'false');
    } catch {
      // Ignore localStorage errors in tests.
    }

    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { tbody } = controller.renderTable({
      listId,
      sortedItems: [
        {
          id: 'item1',
          title: 'Item 1',
          customFields: { priority: 'High', urgent: true },
        },
      ],
      showUrlColumn: false,
      showNotesColumn: false,
      showTagsColumn: false,
      showAddedColumn: false,
      customFields: [
        { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Low'] },
        { key: 'urgent', label: 'Urgent', type: 'checkbox' },
      ],
      showAllColumns: false,
      rerender: () => {},
    });

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();
    if (!row) return;

    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
    expect(cells[2]?.textContent).toBe('High');
    expect(cells[3]?.textContent).toBe('✓');
    expect(cells[2]?.querySelector('select')).toBeNull();
    expect(cells[3]?.querySelector('input[type=\"checkbox\"]')).toBeNull();
  });

  it('renders reference custom fields with navigation', () => {
    const onOpenReference = vi.fn();
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
      onOpenReference,
    });

    const { tbody } = controller.renderTable({
      listId,
      sortedItems: [
        {
          id: 'item1',
          title: 'Item 1',
          customFields: {
            ref: {
              kind: 'panel',
              panelType: 'notes',
              id: 'Project Note',
              label: 'Project Note',
            },
          },
        },
      ],
      showUrlColumn: false,
      showNotesColumn: false,
      showTagsColumn: false,
      showAddedColumn: false,
      customFields: [{ key: 'ref', label: 'Reference', type: 'ref' }],
      showAllColumns: false,
      rerender: () => {},
    });

    const button = tbody.querySelector<HTMLButtonElement>('.list-item-ref-pill');
    expect(button).not.toBeNull();
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpenReference).toHaveBeenCalledTimes(1);
    expect(onOpenReference.mock.calls[0]?.[0]).toMatchObject({
      kind: 'panel',
      panelType: 'notes',
      id: 'Project Note',
    });
  });

  it('recomputes markdown overflow after column resize', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody } = controller.renderTable({
      listId,
      sortedItems: [{ id: 'item1', title: 'Item 1', notes: '# Heading' }],
      showUrlColumn: false,
      showNotesColumn: true,
      showTagsColumn: false,
      showAddedColumn: false,
      rerender: () => {},
    });

    document.body.appendChild(table);

    const cell = tbody.querySelector<HTMLTableCellElement>('.list-item-notes-cell');
    expect(cell).not.toBeNull();
    if (!cell) return;

    const display = cell.querySelector<HTMLElement>('.list-item-notes-display');
    expect(display).not.toBeNull();
    if (!display) return;

    expect(cell.querySelector('.list-item-notes-expand-trigger')).toBeNull();

    Object.defineProperty(display, 'scrollHeight', { value: 200, configurable: true });
    Object.defineProperty(display, 'clientHeight', { value: 50, configurable: true });

    (controller as unknown as {
      updateMarkdownOverflowStates: (tbody: HTMLTableSectionElement) => void;
    }).updateMarkdownOverflowStates(tbody);

    expect(cell.querySelector('.list-item-notes-expand-trigger')).not.toBeNull();

    Object.defineProperty(display, 'scrollHeight', { value: 40, configurable: true });
    Object.defineProperty(display, 'clientHeight', { value: 50, configurable: true });

    (controller as unknown as {
      updateMarkdownOverflowStates: (tbody: HTMLTableSectionElement) => void;
    }).updateMarkdownOverflowStates(tbody);

    expect(cell.querySelector('.list-item-notes-expand-trigger')).toBeNull();
  });

  it('updates inline select and checkbox custom fields without optimistic UI', () => {
    const updateListItem = vi.fn(async () => true);
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem,
    });

    const { tbody } = controller.renderTable({
      listId,
      sortedItems: [
        {
          id: 'item1',
          title: 'Item 1',
          customFields: { priority: 'Low', urgent: false },
        },
        {
          id: 'item2',
          title: 'Item 2',
          customFields: { priority: 'High', urgent: true },
        },
      ],
      showUrlColumn: false,
      showNotesColumn: false,
      showTagsColumn: false,
      showAddedColumn: false,
      customFields: [
        { key: 'priority', label: 'Priority', type: 'select', options: ['High', 'Low'] },
        { key: 'urgent', label: 'Urgent', type: 'checkbox' },
      ],
      showAllColumns: false,
      rerender: () => {},
    });

    const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('.list-item-row'));
    expect(rows.length).toBe(2);

    const firstRowCells = Array.from(rows[0]!.querySelectorAll<HTMLTableCellElement>('td'));
    const secondRowCells = Array.from(rows[1]!.querySelectorAll<HTMLTableCellElement>('td'));

    const select1 = firstRowCells[2]?.querySelector<HTMLSelectElement>('select');
    const select2 = secondRowCells[2]?.querySelector<HTMLSelectElement>('select');
    const checkbox1 = firstRowCells[3]?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const checkbox2 = secondRowCells[3]?.querySelector<HTMLInputElement>('input[type="checkbox"]');

    expect(select1).not.toBeNull();
    expect(select2).not.toBeNull();
    expect(checkbox1).not.toBeNull();
    expect(checkbox2).not.toBeNull();

    if (!select1 || !select2 || !checkbox1 || !checkbox2) return;

    select1.value = 'High';
    select1.dispatchEvent(new Event('change', { bubbles: true }));

    select2.value = '';
    select2.dispatchEvent(new Event('change', { bubbles: true }));

    checkbox1.checked = true;
    checkbox1.dispatchEvent(new Event('change', { bubbles: true }));

    checkbox2.checked = false;
    checkbox2.dispatchEvent(new Event('change', { bubbles: true }));

    expect(updateListItem).toHaveBeenNthCalledWith(1, listId, 'item1', {
      customFields: { priority: 'High' },
    });
    expect(updateListItem).toHaveBeenNthCalledWith(2, listId, 'item2', {
      customFields: { priority: null },
    });
    expect(updateListItem).toHaveBeenNthCalledWith(3, listId, 'item1', {
      customFields: { urgent: true },
    });
    expect(updateListItem).toHaveBeenNthCalledWith(4, listId, 'item2', {
      customFields: { urgent: null },
    });

    expect(select1.value).toBe('Low');
    expect(select2.value).toBe('High');
    expect(checkbox1.checked).toBe(false);
    expect(checkbox2.checked).toBe(true);

    expect(select1.disabled).toBe(true);
    expect(select2.disabled).toBe(true);
    expect(checkbox1.disabled).toBe(true);
    expect(checkbox2.disabled).toBe(true);
  });

  it('renders markdown in custom text fields when enabled', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { tbody } = controller.renderTable({
      listId,
      sortedItems: [
        {
          id: 'item1',
          title: 'Item 1',
          customFields: { details: '# Heading' },
        },
      ],
      showUrlColumn: false,
      showNotesColumn: false,
      showTagsColumn: false,
      showAddedColumn: false,
      customFields: [{ key: 'details', label: 'Details', type: 'text', markdown: true }],
      showAllColumns: false,
      rerender: () => {},
    });

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();
    if (!row) return;

    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
    // checkbox, title, details
    const detailsCell = cells[2];
    expect(detailsCell).toBeDefined();
    if (!detailsCell) return;
    expect(detailsCell.querySelector('h1')).not.toBeNull();
  });
});

describe('ListPanelTableController column preferences', () => {
  const listId = 'list1';

  const recentUserItemUpdates = new Set<string>();

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies columnWidths to headers and cells when provided', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const { table, tbody } = controller.renderTable({
      listId,
      sortedItems: [{ id: 'item1', title: 'Item 1', url: 'https://example.com' }],
      showUrlColumn: true,
      showNotesColumn: false,
      showTagsColumn: false,
      showAddedColumn: false,
      columnWidths: {
        title: 220,
        url: 140,
      },
      rerender: () => {},
    });

    document.body.appendChild(table);

    const headerCells = Array.from(table.querySelectorAll<HTMLTableCellElement>('thead th'));
    expect(headerCells).toHaveLength(3);

    const titleHeader = headerCells[1];
    const urlHeader = headerCells[2];
    if (!titleHeader || !urlHeader) {
      throw new Error('Expected title and URL headers');
    }
    expect(titleHeader.dataset['columnKey']).toBe('title');
    expect(urlHeader.dataset['columnKey']).toBe('url');

    expect(titleHeader.style.width).toBe('220px');
    expect(urlHeader.style.width).toBe('140px');

    const row = tbody.querySelector<HTMLTableRowElement>('.list-item-row');
    expect(row).not.toBeNull();
    if (!row) return;

    const cells = Array.from(row.querySelectorAll<HTMLTableCellElement>('td'));
    expect(cells[1]?.style.width).toBe('220px');
    expect(cells[2]?.style.width).toBe('140px');
  });

  it('invokes onColumnVisibilityChange when selecting a visibility option', () => {
    const controller = new ListPanelTableController({
      icons: { moreVertical: '', pin: '' },
      renderTags: () => null,
      recentUserItemUpdates,
      userUpdateTimeoutMs: 1000,
      getSelectedItemCount: () => 0,
      showListItemMenu: vi.fn(),
      updateListItem: vi.fn(async () => true),
    });

    const onColumnVisibilityChange = vi.fn();

    const { table } = controller.renderTable({
      listId,
      sortedItems: [{ id: 'item1', title: 'Item 1', notes: 'note' }],
      showUrlColumn: false,
      showNotesColumn: true,
      showTagsColumn: false,
      showAddedColumn: false,
      getColumnVisibility: (columnKey) =>
        columnKey === 'notes' ? 'show-with-data' : 'always-show',
      onColumnVisibilityChange,
      rerender: () => {},
    });

    document.body.appendChild(table);

    const notesHeader = table.querySelector<HTMLTableCellElement>(
      'thead th[data-column-key="notes"]',
    );
    expect(notesHeader).not.toBeNull();
    if (!notesHeader) return;

    notesHeader.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, button: 2, clientX: 10, clientY: 10 }),
    );

    const menu = document.body.querySelector<HTMLDivElement>('.list-column-menu');
    expect(menu).not.toBeNull();
    if (!menu) return;

    const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>('.list-column-menu-item'));
    expect(buttons.length).toBeGreaterThan(0);

    const hideInCompactButton = buttons.find((btn) => btn.textContent === 'Hide in compact');
    expect(hideInCompactButton).toBeDefined();
    hideInCompactButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onColumnVisibilityChange).toHaveBeenCalledTimes(1);
    expect(onColumnVisibilityChange).toHaveBeenCalledWith('notes', 'hide-in-compact');
  });
});
