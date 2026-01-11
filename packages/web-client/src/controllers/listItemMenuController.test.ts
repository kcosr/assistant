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
    });

    const controller = new ListItemMenuController({
      contextMenuManager,
      icons: {
        edit: '<svg></svg>',
        trash: '<svg></svg>',
        copy: '<svg></svg>',
        duplicate: '<svg></svg>',
        move: '<svg></svg>',
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
  });
});
