import type { ContextMenuManager } from './contextMenu';
import type { ListMoveTarget, ListPanelItem } from './listPanelController';
import { hasPinnedTag } from '../utils/pinnedTag';

const FOCUS_LIST_ID = '__focus__';
const PINNED_LIST_ID = '__pinned__';

export interface ListItemMenuControllerOptions {
  contextMenuManager: ContextMenuManager;
  icons: {
    edit: string;
    trash: string;
    copy: string;
    move: string;
    duplicate: string;
    x: string;
    eye: string;
    pin: string;
    clock: string;
    clockOff: string;
    moveTop: string;
    moveBottom: string;
  };
  recentUserItemUpdates: Set<string>;
  userUpdateTimeoutMs: number;
  getMoveTargetLists: () => ListMoveTarget[];
  updateListItem: (
    listId: string,
    itemId: string,
    updates: Record<string, unknown>,
  ) => Promise<boolean>;
  onEditItem: (
    listId: string,
    item: ListPanelItem,
    options?: { initialMode?: 'quick' | 'review' },
  ) => void;
  onDeleteItem: (listId: string, itemId: string, title: string) => void;
  onDeleteUnderlyingItem?: (listId: string, itemId: string, title: string) => void;
  onToggleItemFocus?: (listId: string, itemId: string, focused: boolean) => void;
  onToggleItemPinned?: (listId: string, itemId: string, pinned: boolean) => void;
  onMoveItemToList: (listId: string, itemId: string) => void;
  onCopyItemToList: (listId: string, itemId: string) => void;
  onTouchItem: (listId: string, itemId: string) => void;
  onClearTouchItem: (listId: string, itemId: string) => void;
}

export class ListItemMenuController {
  constructor(private readonly options: ListItemMenuControllerOptions) {}

  open(
    trigger: HTMLElement,
    listId: string,
    item: ListPanelItem,
    itemId: string,
    row: HTMLTableRowElement,
  ): void {
    if (!itemId) {
      return;
    }

    this.options.contextMenuManager.close();

    const rect = trigger.getBoundingClientRect();
    const wrapper = document.createElement('div');
    wrapper.className = 'list-item-menu-wrapper';
    const menu = document.createElement('div');
    menu.className = 'list-item-menu';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    wrapper.appendChild(menu);

    menu.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    const addMenuButton = (
      iconSvg: string,
      title: string,
      onClick: () => void,
      extraClass?: string,
    ): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = extraClass ? `list-item-menu-item ${extraClass}` : 'list-item-menu-item';
      if (iconSvg) {
        btn.innerHTML = iconSvg;
      }
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.options.contextMenuManager.close();
        onClick();
      });
      menu.appendChild(btn);
      return btn;
    };

    const toggleCompleted = async () => {
      const currentlyCompleted = item.completed ?? false;
      const newCompleted = !currentlyCompleted;

      item.completed = newCompleted;
      if (newCompleted) {
        item.completedAt = new Date().toISOString();
        row.classList.add('list-item-completed');
      } else {
        delete item.completed;
        delete item.completedAt;
        row.classList.remove('list-item-completed');
      }

      const titleCell = row.querySelector('.list-item-title');
      titleCell?.classList.toggle('list-item-completed-text', newCompleted);

      this.options.recentUserItemUpdates.add(itemId);
      window.setTimeout(() => {
        this.options.recentUserItemUpdates.delete(itemId);
      }, this.options.userUpdateTimeoutMs);

      const success = await this.options.updateListItem(listId, itemId, {
        completed: newCompleted,
      });
      if (!success) {
        item.completed = currentlyCompleted;
        if (currentlyCompleted) {
          item.completedAt = new Date().toISOString();
          row.classList.add('list-item-completed');
          titleCell?.classList.add('list-item-completed-text');
        } else {
          delete item.completed;
          delete item.completedAt;
          row.classList.remove('list-item-completed');
          titleCell?.classList.remove('list-item-completed-text');
        }
      }
    };

    const toggleTitle = item.completed ? 'Mark as incomplete' : 'Mark as complete';
    const toggleBtn = addMenuButton('', toggleTitle, () => {
      void toggleCompleted();
    });
    const checkboxIcon = document.createElement('span');
    checkboxIcon.className = 'list-item-menu-checkbox';
    if (item.completed) {
      checkboxIcon.classList.add('checked');
    }
    toggleBtn.appendChild(checkboxIcon);

    addMenuButton(this.options.icons.edit, 'Edit item', () => {
      this.options.onEditItem(listId, item);
    });

    const moveItemPosition = async (position: number): Promise<void> => {
      this.options.recentUserItemUpdates.add(itemId);
      window.setTimeout(() => {
        this.options.recentUserItemUpdates.delete(itemId);
      }, this.options.userUpdateTimeoutMs);
      await this.options.updateListItem(listId, itemId, { position });
    };

    addMenuButton(this.options.icons.moveTop, 'Move to top', () => {
      void moveItemPosition(0);
    });

    addMenuButton(this.options.icons.moveBottom, 'Move to bottom', () => {
      void moveItemPosition(Number.MAX_SAFE_INTEGER);
    });

    if (item.touchedAt) {
      addMenuButton(this.options.icons.clockOff, 'Clear touch', () => {
        this.options.onClearTouchItem(listId, itemId);
      });
    } else {
      addMenuButton(this.options.icons.clock, 'Touch item', () => {
        this.options.onTouchItem(listId, itemId);
      });
    }

    addMenuButton(this.options.icons.copy, 'Copy ID', () => {
      const navClipboard = (
        navigator as Navigator & {
          clipboard?: {
            writeText?: (value: string) => Promise<void>;
          };
        }
      ).clipboard;
      if (navClipboard?.writeText) {
        void navClipboard.writeText(itemId);
      }
    });

    addMenuButton(this.options.icons.move, 'Move to list', () => {
      this.options.onMoveItemToList(listId, itemId);
    });

    addMenuButton(this.options.icons.duplicate, 'Copy to list', () => {
      this.options.onCopyItemToList(listId, itemId);
    });

    const hasSourceItem =
      typeof item.sourceListId === 'string' && item.sourceListId.trim().length > 0;
    const isFocusItem = listId === FOCUS_LIST_ID && hasSourceItem;
    const isPinnedViewItem = listId === PINNED_LIST_ID && hasSourceItem;
    if (this.options.onToggleItemFocus) {
      const isFocused = isFocusItem || item.focused === true;
      addMenuButton(
        this.options.icons.eye,
        isFocused ? 'Focused' : 'Add to Focus',
        () => {
          this.options.onToggleItemFocus?.(listId, itemId, isFocused);
        },
        isFocused ? 'focus-toggle active' : 'focus-toggle',
      );
    }

    if (this.options.onToggleItemPinned) {
      const isPinned = isPinnedViewItem || hasPinnedTag(item.tags);
      addMenuButton(
        this.options.icons.pin,
        isPinned ? 'Unpin item' : 'Pin item',
        () => {
          this.options.onToggleItemPinned?.(listId, itemId, isPinned);
        },
        isPinned ? 'pin-toggle active' : 'pin-toggle',
      );
    }

    if (!isFocusItem && !isPinnedViewItem) {
      addMenuButton(
        this.options.icons.trash,
        'Delete item',
        () => {
          this.options.onDeleteItem(listId, itemId, item.title);
        },
        'delete',
      );
    }

    if (hasSourceItem && this.options.onDeleteUnderlyingItem) {
      addMenuButton(
        this.options.icons.trash,
        'Delete source item',
        () => {
          this.options.onDeleteUnderlyingItem?.(listId, itemId, item.title);
        },
        'delete',
      );
    }

    document.body.appendChild(wrapper);
    this.options.contextMenuManager.setActiveMenu(wrapper);

    const menuRect = menu.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;
    if (menuRect.right > window.innerWidth - 8) {
      left = window.innerWidth - menuRect.width - 8;
    }
    if (menuRect.bottom > window.innerHeight - 8) {
      top = rect.top - menuRect.height - 4;
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
}
