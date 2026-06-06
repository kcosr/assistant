// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ListPanelController,
  type ListPanelControllerOptions,
  type ListPanelItem,
  __TEST_ONLY,
} from './listPanelController';
import { ContextMenuManager } from './contextMenu';
import { DialogManager } from './dialogManager';

describe('ListPanelController keyboard shortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    __TEST_ONLY.clearListClipboard();
  });

  it('opens the add item dialog on "n"', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => [],
      getSelectedItemCount: () => 0,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', { id: 'list-1', name: 'List 1', items: [] });

    const handled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'n' }),
    );

    expect(handled).toBe(true);
    expect(document.querySelector('.confirm-dialog-overlay')).not.toBeNull();

    document.querySelector('.confirm-dialog-overlay')?.remove();
  });

  it('stops arrow navigation at list boundaries', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const getSelectedRows = () =>
      Array.from(document.querySelectorAll<HTMLElement>('.list-item-row.list-item-selected'));

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () =>
        getSelectedRows()
          .map((row) => row.dataset['itemId'])
          .filter((id): id is string => typeof id === 'string' && id.length > 0),
      getSelectedItemCount: () => getSelectedRows().length,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1' },
        { id: 'item-2', title: 'Item 2' },
        { id: 'item-3', title: 'Item 3' },
      ],
    });

    const arrowDown = () =>
      controller.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

    arrowDown();
    arrowDown();
    arrowDown();
    arrowDown();

    const selected = getSelectedRows()[0];
    expect(selected?.dataset['itemId']).toBe('item-3');
  });

  it('moves a single selected item up and down with w/s', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const selectedIds = ['item-2'];

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      callOperation,
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1', position: 0 },
        { id: 'item-2', title: 'Item 2', position: 1 },
        { id: 'item-3', title: 'Item 3', position: 2 },
      ],
    });

    const upHandled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'w' }),
    );
    expect(upHandled).toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-update', {
      listId: 'list-1',
      id: 'item-2',
      position: 0,
    });

    const downHandled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 's' }),
    );
    expect(downHandled).toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-update', {
      listId: 'list-1',
      id: 'item-2',
      position: 2,
    });
  });

  it('moves using neighboring stored positions when visible order differs from raw positions', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const selectedIds = ['item-3'];

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      callOperation,
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1', position: 0 },
        { id: 'item-2', title: 'Item 2', position: 1, completed: true },
        { id: 'item-3', title: 'Item 3', position: 3 },
        { id: 'item-4', title: 'Item 4', position: 4 },
      ],
    });

    const downHandled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 's' }),
    );

    expect(downHandled).toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-update', {
      listId: 'list-1',
      id: 'item-3',
      position: 4,
    });
  });

  it('preserves selection across rerender when an item move changes order', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const selectedIds: string[] = [];
    const updateSelectedIds = (): void => {
      selectedIds.length = 0;
      const rows = bodyEl.querySelectorAll<HTMLTableRowElement>('.list-item-row.list-item-selected');
      for (const row of rows) {
        const itemId = row.dataset['itemId'];
        if (itemId) {
          selectedIds.push(itemId);
        }
      }
    };

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      callOperation: vi.fn(
        async () => ({} as unknown),
      ) as NonNullable<ListPanelControllerOptions['callOperation']>,
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => [...selectedIds],
      getSelectedItemCount: () => selectedIds.length,
      onSelectionChange: updateSelectedIds,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1', position: 0 },
        { id: 'item-2', title: 'Item 2', position: 1 },
        { id: 'item-3', title: 'Item 3', position: 2 },
      ],
    });

    expect(controller.selectItemById('item-2', { scroll: false })).toBe(true);
    expect(selectedIds).toEqual(['item-2']);

    const updated = controller.applyItemUpdate({
      id: 'item-2',
      title: 'Item 2',
      position: 0,
    });

    expect(updated).toBe(true);
    expect(selectedIds).toEqual(['item-2']);

    const selectedRow = bodyEl.querySelector<HTMLTableRowElement>('.list-item-row.list-item-selected');
    expect(selectedRow?.dataset['itemId']).toBe('item-2');
  });

  it('preserves selection across rerender when external selection context is stale', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      callOperation: vi.fn(
        async () => ({} as unknown),
      ) as NonNullable<ListPanelControllerOptions['callOperation']>,
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => [],
      getSelectedItemCount: () => 0,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1', position: 0 },
        { id: 'item-2', title: 'Item 2', position: 1 },
        { id: 'item-3', title: 'Item 3', position: 2 },
      ],
    });

    expect(controller.selectItemById('item-2', { scroll: false })).toBe(true);

    const updated = controller.applyItemUpdate({
      id: 'item-2',
      title: 'Item 2',
      position: 0,
    });

    expect(updated).toBe(true);
    const selectedRow = bodyEl.querySelector<HTMLTableRowElement>('.list-item-row.list-item-selected');
    expect(selectedRow?.dataset['itemId']).toBe('item-2');
  });

  it('scrolls the restored item into view after a rerender when a move queued scroll follow', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const originalScrollIntoView = HTMLTableRowElement.prototype.scrollIntoView;
    HTMLTableRowElement.prototype.scrollIntoView = vi.fn();

    try {
      const controller = new ListPanelController({
        bodyEl,
        getSearchQuery: () => '',
        getSearchTagController: () => null,
        getActiveInstanceId: () => 'default',
        callOperation: vi.fn(
          async () => ({} as unknown),
        ) as NonNullable<ListPanelControllerOptions['callOperation']>,
        icons: {
          copy: '',
          duplicate: '',
          move: '',
          plus: '',
          edit: '',
          trash: '',
          moreVertical: '',
          x: '',
          eye: '',
          clock: '',
          clockOff: '',
          moveTop: '',
          moveBottom: '',
          pin: '',
        },
        renderTags: () => null,
        setStatus: () => undefined,
        dialogManager: new DialogManager(),
        contextMenuManager: new ContextMenuManager({
          isSessionPinned: () => false,
          pinSession: () => undefined,
          clearHistory: () => undefined,
          deleteSession: () => undefined,
          renameSession: () => undefined,
        }),
        recentUserItemUpdates: new Set<string>(),
        userUpdateTimeoutMs: 1000,
        getSelectedItemIds: () => [],
        getSelectedItemCount: () => 0,
        onSelectionChange: () => undefined,
        getMoveTargetLists: () => [],
        openListMetadataDialog: () => undefined,
        getListColumnPreferences: () => null,
        updateListColumnPreferences: () => undefined,
        getSortState: () => null,
        updateSortState: () => undefined,
        getTimelineField: () => null,
        updateTimelineField: () => undefined,
        getFocusMarkerItemId: () => null,
        getFocusMarkerExpanded: () => false,
        updateFocusMarker: () => undefined,
        updateFocusMarkerExpanded: () => undefined,
        setRightControls: () => undefined,
      });

      controller.render('list-1', {
        id: 'list-1',
        name: 'List 1',
        items: [
          { id: 'item-1', title: 'Item 1', position: 0 },
          { id: 'item-2', title: 'Item 2', position: 1 },
          { id: 'item-3', title: 'Item 3', position: 2 },
        ],
      });

      expect(controller.selectItemById('item-2', { scroll: false })).toBe(true);

      const selectItemByIdSpy = vi.spyOn(controller, 'selectItemById');
      const internal = controller as unknown as {
        queuePendingSelectionScroll: (itemId: string) => void;
        applyItemUpdate: (item: ListPanelItem) => boolean;
      };
      internal.queuePendingSelectionScroll('item-2');

      expect(
        internal.applyItemUpdate({
          id: 'item-2',
          title: 'Item 2',
          position: 10,
        }),
      ).toBe(true);

      expect(selectItemByIdSpy).toHaveBeenCalledWith('item-2', { scroll: true });
    } finally {
      HTMLTableRowElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });

  it('blocks move across completion boundaries', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const selectedIds = ['item-2'];

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      callOperation,
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1', position: 0 },
        { id: 'item-2', title: 'Item 2', position: 1, completed: true },
      ],
    });

    const handled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'w' }),
    );
    expect(handled).toBe(true);
    expect(callOperation).not.toHaveBeenCalled();
  });

  it('opens delete confirmation on Delete and Backspace like d', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const selectedIds = ['item-1'];

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [{ id: 'item-1', title: 'Item 1' }],
    });

    const deleteHandled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'Delete' }),
    );
    expect(deleteHandled).toBe(true);
    expect(document.querySelector('.confirm-dialog-overlay')).not.toBeNull();
    document.querySelector('.confirm-dialog-overlay')?.remove();

    const backspaceHandled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'Backspace' }),
    );
    expect(backspaceHandled).toBe(true);
    expect(document.querySelector('.confirm-dialog-overlay')).not.toBeNull();
    document.querySelector('.confirm-dialog-overlay')?.remove();
  });
});

describe('ListPanelController add dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('passes instance overrides when adding items', async () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      callOperation,
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => [],
      getSelectedItemCount: () => 0,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    });

    controller.openAddItemDialog('list-1', {
      instanceId: 'secondary',
      openOptions: {
        availableTags: [],
        defaultTags: [],
        customFields: [],
      },
    });

    const form = document.querySelector('form.list-item-form') as HTMLFormElement | null;
    const titleInput = form?.querySelector('input.list-item-form-input') as
      | HTMLInputElement
      | null;

    expect(form).not.toBeNull();
    expect(titleInput).not.toBeNull();

    if (!form || !titleInput) {
      return;
    }

    titleInput.value = 'New item';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOperation).toHaveBeenCalledWith(
      'item-add',
      expect.objectContaining({
        listId: 'list-1',
        title: 'New item',
        instanceId: 'secondary',
      }),
    );
  });
});

describe('ListPanelController focus view', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const buildController = (options: Partial<ListPanelControllerOptions> = {}) => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);
    const baseOptions: ListPanelControllerOptions = {
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => [],
      getSelectedItemCount: () => 0,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    };
    return new ListPanelController({ ...baseOptions, ...options });
  };

  const submitEditDialogTitle = async (title: string) => {
    const form = document.querySelector('form.list-item-form') as HTMLFormElement | null;
    const titleInput = form?.querySelector('input.list-item-form-input') as
      | HTMLInputElement
      | null;
    expect(form).not.toBeNull();
    expect(titleInput).not.toBeNull();
    if (!form || !titleInput) {
      return;
    }
    titleInput.value = title;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('routes focus ordering, source updates, removal, and source deletion separately', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('__focus__', {
      id: '__focus__',
      name: 'Focus',
      viewKind: 'focus',
      items: [
        {
          id: 'item-1',
          title: 'Focused task',
          position: 1,
          sourceListId: 'work',
          sourceListName: 'Work',
        },
      ],
    });

    const internal = controller as unknown as {
      updateListItem: (
        listId: string,
        itemId: string,
        updates: Record<string, unknown>,
      ) => Promise<boolean>;
      deleteListItem: (listId: string, itemId: string) => Promise<boolean>;
      deleteSourceListItem: (itemId: string) => Promise<boolean>;
    };

    await expect(internal.updateListItem('__focus__', 'item-1', { position: 0 })).resolves.toBe(
      true,
    );
    expect(callOperation).toHaveBeenLastCalledWith('focus-update', {
      itemId: 'item-1',
      position: 0,
    });

    await expect(
      internal.updateListItem('__focus__', 'item-1', { completed: true }),
    ).resolves.toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-update', {
      listId: 'work',
      id: 'item-1',
      completed: true,
    });

    await expect(
      internal.updateListItem('__focus__', 'item-1', { targetListId: 'later' }),
    ).resolves.toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-move', {
      id: 'item-1',
      targetListId: 'later',
    });

    await expect(internal.deleteListItem('__focus__', 'item-1')).resolves.toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('focus-remove', { itemId: 'item-1' });

    await expect(internal.deleteSourceListItem('item-1')).resolves.toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-remove', {
      listId: 'work',
      id: 'item-1',
    });
  });

  it('routes pinned view edits to source items and removal to pinned tag removal', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('__pinned__', {
      id: '__pinned__',
      name: 'Pinned',
      viewKind: 'pinned',
      items: [
        {
          id: 'item-1',
          title: 'Pinned task',
          tags: ['pinned', 'urgent'],
          sourceListId: 'work',
          sourceListName: 'Work',
        },
      ],
    });

    const internal = controller as unknown as {
      updateListItem: (
        listId: string,
        itemId: string,
        updates: Record<string, unknown>,
      ) => Promise<boolean>;
      deleteListItem: (listId: string, itemId: string) => Promise<boolean>;
    };

    await expect(
      internal.updateListItem('__pinned__', 'item-1', { completed: true }),
    ).resolves.toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-update', {
      listId: 'work',
      id: 'item-1',
      completed: true,
    });

    await expect(internal.deleteListItem('__pinned__', 'item-1')).resolves.toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('item-tags-remove', {
      listId: 'work',
      id: 'item-1',
      tags: ['pinned'],
    });
    expect(callOperation).not.toHaveBeenCalledWith(
      'item-remove',
      expect.objectContaining({ id: 'item-1' }),
    );
  });

  it('does not treat pinned view source-backed rows as focused', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('__pinned__', {
      id: '__pinned__',
      name: 'Pinned',
      viewKind: 'pinned',
      items: [
        {
          id: 'item-1',
          title: 'Pinned task',
          tags: ['pinned'],
          sourceListId: 'work',
          sourceListName: 'Work',
        },
      ],
    });

    const internal = controller as unknown as {
      updateListItem: (
        listId: string,
        itemId: string,
        updates: Record<string, unknown>,
      ) => Promise<boolean>;
    };

    await expect(
      internal.updateListItem('__pinned__', 'item-1', { focused: true }),
    ).resolves.toBe(true);
    expect(callOperation).toHaveBeenLastCalledWith('focus-add', { itemId: 'item-1' });
  });

  it('does not remove focus when editing a non-focused source item', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('today', {
      id: 'today',
      name: 'Today',
      items: [{ id: 'item-1', title: 'Original', focused: false }],
    });

    const internal = controller as unknown as {
      showListItemEditorDialog: (
        mode: 'edit',
        listId: string,
        item: ListPanelItem,
      ) => void;
    };
    internal.showListItemEditorDialog('edit', 'today', {
      id: 'item-1',
      title: 'Original',
      focused: false,
    });
    await submitEditDialogTitle('Changed');

    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(callOperation).toHaveBeenCalledWith(
      'item-update',
      expect.objectContaining({
        listId: 'today',
        id: 'item-1',
        title: 'Changed',
      }),
    );
    expect(callOperation).not.toHaveBeenCalledWith('focus-remove', { itemId: 'item-1' });
  });

  it('moves a source item when an edit submits a different target list', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('today', {
      id: 'today',
      name: 'Today',
      items: [{ id: 'item-1', title: 'Existing task' }],
    });

    const internal = controller as unknown as {
      updateListItem: (
        listId: string,
        itemId: string,
        updates: Record<string, unknown>,
      ) => Promise<boolean>;
    };

    await expect(
      internal.updateListItem('today', 'item-1', {
        title: 'Updated task',
        targetListId: 'work',
      }),
    ).resolves.toBe(true);

    expect(callOperation).toHaveBeenNthCalledWith(1, 'item-update', {
      listId: 'today',
      id: 'item-1',
      title: 'Updated task',
    });
    expect(callOperation).toHaveBeenNthCalledWith(2, 'item-move', {
      id: 'item-1',
      targetListId: 'work',
    });
  });

  it('does not re-add focus when editing an already-focused source item', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('today', {
      id: 'today',
      name: 'Today',
      items: [{ id: 'item-1', title: 'Original', focused: true }],
    });

    const internal = controller as unknown as {
      showListItemEditorDialog: (
        mode: 'edit',
        listId: string,
        item: ListPanelItem,
      ) => void;
    };
    internal.showListItemEditorDialog('edit', 'today', {
      id: 'item-1',
      title: 'Original',
      focused: true,
    });
    await submitEditDialogTitle('Changed');

    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(callOperation).toHaveBeenCalledWith(
      'item-update',
      expect.objectContaining({
        listId: 'today',
        id: 'item-1',
        title: 'Changed',
      }),
    );
    expect(callOperation).not.toHaveBeenCalledWith('focus-add', { itemId: 'item-1' });
  });

  it('refreshes the focused row indicator immediately after toggling focus', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const rightControls: HTMLElement[][] = [];
    const controller = buildController({
      callOperation,
      setRightControls: (controls) => {
        rightControls.push(controls);
      },
    });
    const controls = controller.render('today', {
      id: 'today',
      name: 'Today',
      items: [{ id: 'item-1', title: 'Task', focused: false }],
    });
    for (const element of controls.rightControls) {
      document.body.appendChild(element);
    }

    expect(document.querySelector('.list-item-menu-trigger-focused')).toBeNull();

    const internal = controller as unknown as {
      toggleItemFocus: (itemId: string, currentlyFocused: boolean) => Promise<boolean>;
    };
    await expect(internal.toggleItemFocus('item-1', false)).resolves.toBe(true);

    expect(callOperation).toHaveBeenCalledWith('focus-add', { itemId: 'item-1' });
    expect(document.querySelector('.list-item-menu-trigger-focused')).not.toBeNull();
    expect(rightControls.length).toBe(1);
  });

  it('bulk deletes source items from focus view', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const selectedIds = ['item-1', 'item-2'];
    const controller = buildController({
      callOperation,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });
    controller.render('__focus__', {
      id: '__focus__',
      name: 'Focus',
      viewKind: 'focus',
      items: [
        {
          id: 'item-1',
          title: 'First',
          sourceListId: 'work',
          sourceListName: 'Work',
        },
        {
          id: 'item-2',
          title: 'Second',
          sourceListId: 'today',
          sourceListName: 'Today',
        },
      ],
    });

    const internal = controller as unknown as {
      showDeleteSelectedItemsConfirmation: (listId: string) => void;
    };
    internal.showDeleteSelectedItemsConfirmation('__focus__');

    const title = document.querySelector<HTMLElement>('.confirm-dialog-title');
    const message = document.querySelector<HTMLElement>('.confirm-dialog-message');
    expect(title?.textContent).toBe('Delete Source Items');
    expect(message?.textContent).toContain('Delete 2 selected source items');

    document.querySelector<HTMLButtonElement>('.confirm-dialog-button.danger')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOperation).toHaveBeenNthCalledWith(1, 'item-remove', {
      listId: 'work',
      id: 'item-1',
    });
    expect(callOperation).toHaveBeenNthCalledWith(2, 'item-remove', {
      listId: 'today',
      id: 'item-2',
    });
  });

  it('bulk removes selected items from Focus without deleting source items', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const selectedIds = ['item-1', 'item-2'];
    const controller = buildController({
      callOperation,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });
    controller.render('__focus__', {
      id: '__focus__',
      name: 'Focus',
      viewKind: 'focus',
      items: [
        {
          id: 'item-1',
          title: 'First',
          sourceListId: 'work',
          sourceListName: 'Work',
        },
        {
          id: 'item-2',
          title: 'Second',
          sourceListId: 'today',
          sourceListName: 'Today',
        },
      ],
    });

    const internal = controller as unknown as {
      removeSelectedItemsFromFocus: (listId: string) => Promise<void>;
    };
    await internal.removeSelectedItemsFromFocus('__focus__');

    expect(callOperation).toHaveBeenNthCalledWith(1, 'focus-remove', { itemId: 'item-1' });
    expect(callOperation).toHaveBeenNthCalledWith(2, 'focus-remove', { itemId: 'item-2' });
    expect(callOperation).not.toHaveBeenCalledWith(
      'item-remove',
      expect.objectContaining({ id: expect.any(String) }),
    );
  });

  it('bulk adds selected source-list items to Focus without moving already-focused rows', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const selectedIds = ['item-1', 'item-2'];
    const controller = buildController({
      callOperation,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });
    controller.render('today', {
      id: 'today',
      name: 'Today',
      items: [
        { id: 'item-1', title: 'Already focused', focused: true },
        { id: 'item-2', title: 'New focus item', focused: false },
      ],
    });

    const internal = controller as unknown as {
      addSelectedItemsToFocus: () => Promise<void>;
    };
    await internal.addSelectedItemsToFocus();

    expect(callOperation).toHaveBeenCalledTimes(1);
    expect(callOperation).toHaveBeenCalledWith('focus-add', { itemId: 'item-2' });
  });

  it('bulk removes selected focused source-list items from Focus', async () => {
    const callOperation = vi.fn(
      async () => ({} as unknown),
    ) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const selectedIds = ['item-1', 'item-2'];
    const controller = buildController({
      callOperation,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });
    controller.render('today', {
      id: 'today',
      name: 'Today',
      items: [
        { id: 'item-1', title: 'Focused one', focused: true },
        { id: 'item-2', title: 'Focused two', focused: true },
      ],
    });

    const internal = controller as unknown as {
      removeSelectedItemsFromFocus: (listId: string) => Promise<void>;
    };
    await internal.removeSelectedItemsFromFocus('today');

    expect(callOperation).toHaveBeenNthCalledWith(1, 'focus-remove', { itemId: 'item-1' });
    expect(callOperation).toHaveBeenNthCalledWith(2, 'focus-remove', { itemId: 'item-2' });
  });

  it('shows both focus selection actions for any selected rows', () => {
    let selectedIds: string[] = [];
    const controller = buildController({
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });
    const controls = controller.render('today', {
      id: 'today',
      name: 'Today',
      items: [
        { id: 'item-1', title: 'Focused one', focused: true },
        { id: 'item-2', title: 'Not focused', focused: false },
      ],
    });
    for (const element of controls.rightControls) {
      document.body.appendChild(element);
    }

    const internal = controller as unknown as {
      handleSelectionChange: () => void;
    };
    const addButton = document.querySelector<HTMLElement>(
      '[data-role="add-focus-selection-button"]',
    );
    const removeButton = document.querySelector<HTMLElement>(
      '[data-role="remove-focus-selection-button"]',
    );

    selectedIds = ['item-1'];
    internal.handleSelectionChange();
    expect(addButton?.classList.contains('visible')).toBe(true);
    expect(removeButton?.classList.contains('visible')).toBe(true);

    selectedIds = ['item-2'];
    internal.handleSelectionChange();
    expect(addButton?.classList.contains('visible')).toBe(true);
    expect(removeButton?.classList.contains('visible')).toBe(true);

    selectedIds = ['item-1', 'item-2'];
    internal.handleSelectionChange();
    expect(addButton?.classList.contains('visible')).toBe(true);
    expect(removeButton?.classList.contains('visible')).toBe(true);
  });

  it('adds newly created focus-view items to the selected source list and Focus', async () => {
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'item-add') {
        return { id: 'new-item', title: 'New task' } as unknown;
      }
      return {} as unknown;
    }) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('__focus__', {
      id: '__focus__',
      name: 'Focus',
      viewKind: 'focus',
      items: [],
    });

    const internal = controller as unknown as {
      createListItem: (listId: string, item: Record<string, unknown>) => Promise<boolean>;
    };

    await expect(internal.createListItem('work', { title: 'New task' })).resolves.toBe(true);
    expect(callOperation).toHaveBeenNthCalledWith(1, 'item-add', {
      listId: 'work',
      title: 'New task',
    });
    expect(callOperation).toHaveBeenNthCalledWith(2, 'focus-add', {
      itemId: 'new-item',
    });
  });

  it('adds newly created focus-view items to the top of Focus when inserted at top', async () => {
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'item-add') {
        return { id: 'new-item', title: 'New task' } as unknown;
      }
      return {} as unknown;
    }) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const controller = buildController({ callOperation });
    controller.render('__focus__', {
      id: '__focus__',
      name: 'Focus',
      viewKind: 'focus',
      items: [],
    });

    const internal = controller as unknown as {
      createListItem: (listId: string, item: Record<string, unknown>) => Promise<boolean>;
    };

    await expect(internal.createListItem('work', { title: 'New task', position: 0 })).resolves.toBe(
      true,
    );
    expect(callOperation).toHaveBeenNthCalledWith(1, 'item-add', {
      listId: 'work',
      title: 'New task',
      position: 0,
    });
    expect(callOperation).toHaveBeenNthCalledWith(2, 'focus-add', {
      itemId: 'new-item',
      position: 0,
    });
  });

  it('routes the focus header add button through the source-list picker flow', async () => {
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'item-add') {
        return { id: 'new-item', title: 'New task' } as unknown;
      }
      return {} as unknown;
    }) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const resolveAddItemTarget = vi.fn(async () => ({
      listId: 'work',
      instanceId: 'default',
    }));
    const controller = buildController({ callOperation, resolveAddItemTarget });
    const controls = controller.render('__focus__', {
      id: '__focus__',
      name: 'Focus',
      viewKind: 'focus',
      items: [],
    });
    for (const element of controls.rightControls) {
      document.body.appendChild(element);
    }

    const addButton = document.querySelector<HTMLButtonElement>('.collection-list-add-button');
    expect(addButton).not.toBeNull();
    addButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resolveAddItemTarget).toHaveBeenCalledTimes(1);

    const form = document.querySelector('form.list-item-form') as HTMLFormElement | null;
    const titleInput = form?.querySelector('input.list-item-form-input') as
      | HTMLInputElement
      | null;

    expect(form).not.toBeNull();
    expect(titleInput).not.toBeNull();

    if (!form || !titleInput) {
      return;
    }

    titleInput.value = 'New task';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOperation).toHaveBeenNthCalledWith(
      1,
      'item-add',
      expect.objectContaining({
        listId: 'work',
        title: 'New task',
        instanceId: 'default',
      }),
    );
    expect(callOperation).toHaveBeenNthCalledWith(2, 'focus-add', {
      itemId: 'new-item',
      instanceId: 'default',
    });
  });
});

describe('ListPanelController clipboard shortcuts', () => {
  beforeEach(() => {
    __TEST_ONLY.clearListClipboard();
    document.body.innerHTML = '';
  });

  const setupClipboard = () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    return writeText;
  };

  const buildController = (options: Partial<ListPanelControllerOptions> = {}) => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);
    const baseOptions: ListPanelControllerOptions = {
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
      getActiveInstanceId: () => 'default',
      icons: {
        copy: '',
        duplicate: '',
        move: '',
        plus: '',
        edit: '',
        trash: '',
        moreVertical: '',
        x: '',
        eye: '',
        clock: '',
        clockOff: '',
        moveTop: '',
        moveBottom: '',
        pin: '',
      },
      renderTags: () => null,
      setStatus: () => undefined,
      dialogManager: new DialogManager(),
      contextMenuManager: new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: () => undefined,
        clearHistory: () => undefined,
        deleteSession: () => undefined,
        renameSession: () => undefined,
      }),
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getSelectedItemIds: () => [],
      getSelectedItemCount: () => 0,
      onSelectionChange: () => undefined,
      getMoveTargetLists: () => [],
      openListMetadataDialog: () => undefined,
      getListColumnPreferences: () => null,
      updateListColumnPreferences: () => undefined,
      getSortState: () => null,
      updateSortState: () => undefined,
      getTimelineField: () => null,
      updateTimelineField: () => undefined,
      getFocusMarkerItemId: () => null,
      getFocusMarkerExpanded: () => false,
      updateFocusMarker: () => undefined,
      updateFocusMarkerExpanded: () => undefined,
      setRightControls: () => undefined,
    };
    return new ListPanelController({ ...baseOptions, ...options });
  };

  it('copies selected items to the clipboard and stores buffer on Cmd/Ctrl+C', async () => {
    const writeText = setupClipboard();
    const selectedIds = ['item-1'];
    const controller = buildController({
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [{ id: 'item-1', title: 'Item 1', notes: 'Note 1' }],
    });

    const handled = controller.handleKeyboardEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }),
    );

    expect(handled).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(writeText).toHaveBeenCalledTimes(1);
    const calls = writeText.mock.calls as unknown as Array<[string]>;
    const text = calls[0]?.[0] ?? '';
    expect(text).toContain('plugin: lists');
    expect(text).toContain('itemId: item-1');
    expect(text).toContain('title: Item 1');
    expect(text).toContain('listId: list-1');
    expect(text).toContain('instance_id: default');
    expect(__TEST_ONLY.getListClipboard()?.mode).toBe('copy');
  });

  it('moves selected items to the top preserving their current order', async () => {
    setupClipboard();
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'items-bulk-move') {
        return { results: [{ ok: true }, { ok: true }] } as unknown;
      }
      return {} as unknown;
    }) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const setStatus = vi.fn();
    const selectedIds = ['item-3', 'item-1'];

    const controller = buildController({
      callOperation,
      setStatus,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });

    const controls = controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1', position: 0 },
        { id: 'item-2', title: 'Item 2', position: 1 },
        { id: 'item-3', title: 'Item 3', position: 2 },
        { id: 'item-4', title: 'Item 4', position: 3 },
      ],
    });
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    document.body.querySelector<HTMLButtonElement>('[data-role="move-selection-top-button"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOperation).toHaveBeenCalledWith('items-bulk-move', {
      operations: [
        { id: 'item-1', targetListId: 'list-1', position: 0 },
        { id: 'item-3', targetListId: 'list-1', position: 1 },
      ],
    });
    expect(setStatus).toHaveBeenCalledWith('Moved 2 selected items to the top');
  });

  it('moves selected items to the bottom preserving their current order', async () => {
    setupClipboard();
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'items-bulk-move') {
        return { results: [{ ok: true }, { ok: true }] } as unknown;
      }
      return {} as unknown;
    }) as NonNullable<ListPanelControllerOptions['callOperation']>;
    const setStatus = vi.fn();
    const selectedIds = ['item-2', 'item-4'];

    const controller = buildController({
      callOperation,
      setStatus,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });

    const controls = controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [
        { id: 'item-1', title: 'Item 1', position: 0 },
        { id: 'item-2', title: 'Item 2', position: 1 },
        { id: 'item-3', title: 'Item 3', position: 2 },
        { id: 'item-4', title: 'Item 4', position: 3 },
      ],
    });
    for (const el of controls.rightControls) {
      document.body.appendChild(el);
    }

    document.body.querySelector<HTMLButtonElement>('[data-role="selection-status"]')?.click();
    document.body.querySelector<HTMLButtonElement>('[data-role="move-selection-bottom-button"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOperation).toHaveBeenCalledWith('items-bulk-move', {
      operations: [
        { id: 'item-2', targetListId: 'list-1' },
        { id: 'item-4', targetListId: 'list-1' },
      ],
    });
    expect(setStatus).toHaveBeenCalledWith('Moved 2 selected items to the bottom');
  });

  it('pastes copied items into another list on Cmd/Ctrl+V', async () => {
    setupClipboard();
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'items-bulk-copy') {
        return { results: [{ ok: true }] } as unknown;
      }
      return {} as unknown;
    }) as NonNullable<ListPanelControllerOptions['callOperation']>;

    let selectedIds = ['item-1'];
    const controller = buildController({
      callOperation,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [{ id: 'item-1', title: 'Item 1' }],
    });

    controller.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    selectedIds = [];
    controller.render('list-2', { id: 'list-2', name: 'List 2', items: [] });

    controller.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOperation).toHaveBeenCalledWith('items-bulk-copy', {
      sourceListId: 'list-1',
      targetListId: 'list-2',
      items: [{ id: 'item-1' }],
    });
  });

  it('cuts items and moves them on Cmd/Ctrl+V', async () => {
    setupClipboard();
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'items-bulk-move') {
        return { results: [{ ok: true }] } as unknown;
      }
      return {} as unknown;
    }) as NonNullable<ListPanelControllerOptions['callOperation']>;

    let selectedIds = ['item-1'];
    const controller = buildController({
      callOperation,
      getSelectedItemIds: () => selectedIds,
      getSelectedItemCount: () => selectedIds.length,
    });

    controller.render('list-1', {
      id: 'list-1',
      name: 'List 1',
      items: [{ id: 'item-1', title: 'Item 1' }],
    });

    controller.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(__TEST_ONLY.getListClipboard()?.mode).toBe('cut');

    selectedIds = [];
    controller.render('list-2', { id: 'list-2', name: 'List 2', items: [] });

    controller.handleKeyboardEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(callOperation).toHaveBeenCalledWith('items-bulk-move', {
      operations: [{ id: 'item-1', targetListId: 'list-2' }],
    });
    expect(__TEST_ONLY.getListClipboard()).toBeNull();
  });
});
