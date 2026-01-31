// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ListPanelController,
  type ListPanelControllerOptions,
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

  it('pastes copied items into another list on Cmd/Ctrl+V', async () => {
    setupClipboard();
    const callOperation = vi.fn(async (operation) => {
      if (operation === 'items-bulk-copy') {
        return { result: { results: [{ ok: true }] } } as unknown;
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
        return { result: { results: [{ ok: true }] } } as unknown;
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
