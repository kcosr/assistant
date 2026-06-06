// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextMenuManager } from './contextMenu';
import { ListItemMenuController } from './listItemMenuController';
import type { ListPanelItem } from './listPanelController';

describe('ListItemMenuController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds Copy ID menu item that writes the item ID to the clipboard', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText,
      },
    });

    const contextMenuManager = new ContextMenuManager({
      isSessionPinned: () => false,
      pinSession: vi.fn(),
      clearHistory: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      editSession: vi.fn(),
    });

    const controller = new ListItemMenuController({
      contextMenuManager,
      icons: {
        edit: '<svg></svg>',
        trash: '<svg></svg>',
        copy: '<svg></svg>',
        duplicate: '<svg></svg>',
        move: '<svg></svg>',
        x: '<svg></svg>',
        eye: '<svg></svg>',
        pin: '<svg></svg>',
        clock: '<svg></svg>',
        clockOff: '<svg></svg>',
        moveTop: '<svg></svg>',
        moveBottom: '<svg></svg>',
      },
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getMoveTargetLists: () => [],
      updateListItem: vi.fn(),
      onEditItem: vi.fn(),
      onDeleteItem: vi.fn(),
      onMoveItemToList: vi.fn(),
      onCopyItemToList: vi.fn(),
      onTouchItem: vi.fn(),
      onClearTouchItem: vi.fn(),
    });

    const trigger = document.createElement('button');
    document.body.appendChild(trigger);

    const listId = 'list-1';

    const item: ListPanelItem = {
      id: 'item-123',
      title: 'My item',
    };

    const row = document.createElement('tr');

    controller.open(trigger, listId, item, 'item-123', row);

    const copyButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Copy ID');

    expect(copyButton).toBeDefined();

    copyButton!.click();

    expect(writeText).toHaveBeenCalledWith('item-123');
    expect(document.querySelector('.list-item-menu-wrapper')).toBeNull();
  });

  it('invokes move and copy target callbacks from the item menu', () => {
    const contextMenuManager = new ContextMenuManager({
      isSessionPinned: () => false,
      pinSession: vi.fn(),
      clearHistory: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      editSession: vi.fn(),
    });

    const onMoveItemToList = vi.fn();
    const onCopyItemToList = vi.fn();
    const controller = new ListItemMenuController({
      contextMenuManager,
      icons: {
        edit: '<svg></svg>',
        trash: '<svg></svg>',
        copy: '<svg></svg>',
        duplicate: '<svg></svg>',
        move: '<svg></svg>',
        x: '<svg></svg>',
        eye: '<svg></svg>',
        pin: '<svg></svg>',
        clock: '<svg></svg>',
        clockOff: '<svg></svg>',
        moveTop: '<svg></svg>',
        moveBottom: '<svg></svg>',
      },
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getMoveTargetLists: () => [],
      updateListItem: vi.fn(),
      onEditItem: vi.fn(),
      onDeleteItem: vi.fn(),
      onMoveItemToList,
      onCopyItemToList,
      onTouchItem: vi.fn(),
      onClearTouchItem: vi.fn(),
    });

    const trigger = document.createElement('button');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 20,
      bottom: 20,
      width: 20,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    document.body.appendChild(trigger);

    const item: ListPanelItem = {
      id: 'item-123',
      title: 'My item',
    };
    const row = document.createElement('tr');

    controller.open(trigger, 'list-1', item, 'item-123', row);

    const moveButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Move to list');
    expect(moveButton).toBeDefined();
    moveButton?.click();

    controller.open(trigger, 'list-1', item, 'item-123', row);
    const copyButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Copy to list');
    expect(copyButton).toBeDefined();
    copyButton?.click();

    expect(onMoveItemToList).toHaveBeenCalledWith('list-1', 'item-123');
    expect(onCopyItemToList).toHaveBeenCalledWith('list-1', 'item-123');
  });

  it('offers focus toggle and source deletion actions for focus items', () => {
    const contextMenuManager = new ContextMenuManager({
      isSessionPinned: () => false,
      pinSession: vi.fn(),
      clearHistory: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      editSession: vi.fn(),
    });
    const onDeleteItem = vi.fn();
    const onDeleteUnderlyingItem = vi.fn();
    const onToggleItemFocus = vi.fn();

    const controller = new ListItemMenuController({
      contextMenuManager,
      icons: {
        edit: '<svg></svg>',
        trash: '<svg></svg>',
        copy: '<svg></svg>',
        duplicate: '<svg></svg>',
        move: '<svg></svg>',
        x: '<svg></svg>',
        eye: '<svg></svg>',
        pin: '<svg></svg>',
        clock: '<svg></svg>',
        clockOff: '<svg></svg>',
        moveTop: '<svg></svg>',
        moveBottom: '<svg></svg>',
      },
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getMoveTargetLists: () => [],
      updateListItem: vi.fn(),
      onEditItem: vi.fn(),
      onDeleteItem,
      onDeleteUnderlyingItem,
      onToggleItemFocus,
      onMoveItemToList: vi.fn(),
      onCopyItemToList: vi.fn(),
      onTouchItem: vi.fn(),
      onClearTouchItem: vi.fn(),
    });

    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const item: ListPanelItem = {
      id: 'item-123',
      title: 'My item',
      sourceListId: 'source-list',
      sourceListName: 'Source List',
    };
    const row = document.createElement('tr');

    controller.open(trigger, '__focus__', item, 'item-123', row);

    const focusedButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Focused');
    const removeButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Remove from Focus');
    const deleteSourceButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Delete source item');

    expect(focusedButton).toBeDefined();
    expect(removeButton).toBeUndefined();
    expect(deleteSourceButton).toBeDefined();

    focusedButton!.click();
    expect(onToggleItemFocus).toHaveBeenCalledWith('__focus__', 'item-123', true);
    expect(onDeleteItem).not.toHaveBeenCalled();

    controller.open(trigger, '__focus__', item, 'item-123', row);
    const reopenedDeleteSourceButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Delete source item');
    reopenedDeleteSourceButton!.click();
    expect(onDeleteUnderlyingItem).toHaveBeenCalledWith('__focus__', 'item-123', 'My item');
  });

  it('offers a direct Focus toggle for source items', () => {
    const contextMenuManager = new ContextMenuManager({
      isSessionPinned: () => false,
      pinSession: vi.fn(),
      clearHistory: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      editSession: vi.fn(),
    });
    const onToggleItemFocus = vi.fn();

    const controller = new ListItemMenuController({
      contextMenuManager,
      icons: {
        edit: '<svg></svg>',
        trash: '<svg></svg>',
        copy: '<svg></svg>',
        duplicate: '<svg></svg>',
        move: '<svg></svg>',
        x: '<svg></svg>',
        eye: '<svg></svg>',
        pin: '<svg></svg>',
        clock: '<svg></svg>',
        clockOff: '<svg></svg>',
        moveTop: '<svg></svg>',
        moveBottom: '<svg></svg>',
      },
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getMoveTargetLists: () => [],
      updateListItem: vi.fn(),
      onEditItem: vi.fn(),
      onDeleteItem: vi.fn(),
      onToggleItemFocus,
      onMoveItemToList: vi.fn(),
      onCopyItemToList: vi.fn(),
      onTouchItem: vi.fn(),
      onClearTouchItem: vi.fn(),
    });

    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const item: ListPanelItem = {
      id: 'item-123',
      title: 'My item',
    };
    const row = document.createElement('tr');

    controller.open(trigger, 'source-list', item, 'item-123', row);

    const addButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Add to Focus');
    expect(addButton).toBeDefined();

    addButton!.click();
    expect(onToggleItemFocus).toHaveBeenCalledWith('source-list', 'item-123', false);
  });

  it('uses pin toggle actions for pinned state without treating unpin as delete', () => {
    const contextMenuManager = new ContextMenuManager({
      isSessionPinned: () => false,
      pinSession: vi.fn(),
      clearHistory: vi.fn(),
      deleteSession: vi.fn(),
      renameSession: vi.fn(),
      editSession: vi.fn(),
    });
    const onToggleItemPinned = vi.fn();
    const onDeleteItem = vi.fn();
    const onDeleteUnderlyingItem = vi.fn();

    const controller = new ListItemMenuController({
      contextMenuManager,
      icons: {
        edit: '<svg class="edit"></svg>',
        trash: '<svg class="trash"></svg>',
        copy: '<svg class="copy"></svg>',
        duplicate: '<svg class="duplicate"></svg>',
        move: '<svg class="move"></svg>',
        x: '<svg class="x"></svg>',
        eye: '<svg class="eye"></svg>',
        pin: '<svg class="pin"></svg>',
        clock: '<svg class="clock"></svg>',
        clockOff: '<svg class="clock-off"></svg>',
        moveTop: '<svg class="move-top"></svg>',
        moveBottom: '<svg class="move-bottom"></svg>',
      },
      recentUserItemUpdates: new Set<string>(),
      userUpdateTimeoutMs: 1000,
      getMoveTargetLists: () => [],
      updateListItem: vi.fn(),
      onEditItem: vi.fn(),
      onDeleteItem,
      onDeleteUnderlyingItem,
      onToggleItemPinned,
      onMoveItemToList: vi.fn(),
      onCopyItemToList: vi.fn(),
      onTouchItem: vi.fn(),
      onClearTouchItem: vi.fn(),
    });

    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    const row = document.createElement('tr');

    controller.open(
      trigger,
      'source-list',
      { id: 'item-1', title: 'Unpinned task', tags: ['work'] },
      'item-1',
      row,
    );
    const pinButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Pin item');
    expect(pinButton).toBeDefined();
    expect(pinButton?.innerHTML).toContain('pin');
    expect(pinButton?.classList.contains('pin-toggle')).toBe(true);
    expect(pinButton?.classList.contains('active')).toBe(false);

    pinButton!.click();
    expect(onToggleItemPinned).toHaveBeenCalledWith('source-list', 'item-1', false);

    controller.open(
      trigger,
      '__pinned__',
      {
        id: 'item-2',
        title: 'Pinned task',
        tags: ['pinned', 'work'],
        sourceListId: 'source-list',
        sourceListName: 'Source List',
      },
      'item-2',
      row,
    );
    const unpinButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Unpin item');
    const removeFromPinnedTrashButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Delete item');
    const deleteSourceButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.list-item-menu-item'),
    ).find((btn) => btn.getAttribute('aria-label') === 'Delete source item');

    expect(unpinButton).toBeDefined();
    expect(unpinButton?.innerHTML).toContain('pin');
    expect(unpinButton?.classList.contains('pin-toggle')).toBe(true);
    expect(unpinButton?.classList.contains('active')).toBe(true);
    expect(removeFromPinnedTrashButton).toBeUndefined();
    expect(deleteSourceButton).toBeDefined();

    unpinButton!.click();
    expect(onToggleItemPinned).toHaveBeenCalledWith('__pinned__', 'item-2', true);
    expect(onDeleteItem).not.toHaveBeenCalled();
    expect(onDeleteUnderlyingItem).not.toHaveBeenCalled();
  });
});
