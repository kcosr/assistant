// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ListPanelController, type ListPanelControllerOptions } from './listPanelController';
import { ContextMenuManager } from './contextMenu';
import { DialogManager } from './dialogManager';

describe('ListPanelController keyboard shortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('opens the add item dialog on "n"', () => {
    const bodyEl = document.createElement('div');
    document.body.appendChild(bodyEl);

    const controller = new ListPanelController({
      bodyEl,
      getSearchQuery: () => '',
      getSearchTagController: () => null,
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
