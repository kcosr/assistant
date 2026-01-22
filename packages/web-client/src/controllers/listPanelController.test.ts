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
});
