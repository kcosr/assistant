// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { ListPanelController } from './listPanelController';
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
});
