import type { ContextMenuManager } from './contextMenu';
import type { ListMoveTarget, ListPanelItem } from './listPanelController';

export interface ListItemMenuControllerOptions {
  contextMenuManager: ContextMenuManager;
  icons: {
    edit: string;
    trash: string;
    copy: string;
    move: string;
    duplicate: string;
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
  onMoveItemToList: (listId: string, itemId: string, targetListId: string) => void;
  onCopyItemToList: (listId: string, itemId: string, targetListId: string) => void;
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

    let activeSubmenu: HTMLDivElement | null = null;
    let activeSubmenuKind: 'move' | 'copy' | null = null;

    const closeSubmenu = (): void => {
      if (activeSubmenu) {
        activeSubmenu.remove();
        activeSubmenu = null;
        activeSubmenuKind = null;
      }
    };

    const buildSubmenu = (
      kind: 'move' | 'copy',
      triggerButton: HTMLButtonElement,
      onSelect: (targetListId: string) => void,
    ): void => {
      if (activeSubmenu && activeSubmenuKind === kind) {
        closeSubmenu();
        return;
      }

      closeSubmenu();
      const submenu = document.createElement('div');
      submenu.className = 'list-item-menu-submenu';
      submenu.setAttribute('role', 'menu');
      submenu.dataset['kind'] = kind;

      const targets = this.options
        .getMoveTargetLists()
        .filter((target) => target.id !== listId)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (targets.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'list-item-menu-submenu-empty';
        empty.textContent = 'No other lists';
        submenu.appendChild(empty);
      } else {
        for (const target of targets) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'list-item-menu-submenu-item';
          btn.textContent = target.name;
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.options.contextMenuManager.close();
            onSelect(target.id);
          });
          submenu.appendChild(btn);
        }
      }

      wrapper.appendChild(submenu);
      activeSubmenu = submenu;
      activeSubmenuKind = kind;

      const menuRect = menu.getBoundingClientRect();
      const triggerRect = triggerButton.getBoundingClientRect();
      const submenuRect = submenu.getBoundingClientRect();

      let left = menuRect.right + 6;
      if (left + submenuRect.width > window.innerWidth - 8) {
        left = menuRect.left - submenuRect.width - 6;
      }
      let top = triggerRect.top;
      if (top + submenuRect.height > window.innerHeight - 8) {
        top = window.innerHeight - submenuRect.height - 8;
      }
      if (top < 8) {
        top = 8;
      }

      submenu.style.left = `${left}px`;
      submenu.style.top = `${top}px`;
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

    const moveButton = document.createElement('button');
    moveButton.type = 'button';
    moveButton.className = 'list-item-menu-item';
    moveButton.innerHTML = this.options.icons.move;
    moveButton.setAttribute('aria-label', 'Move to list');
    moveButton.setAttribute('aria-haspopup', 'menu');
    moveButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      buildSubmenu('move', moveButton, (targetListId) => {
        this.options.onMoveItemToList(listId, itemId, targetListId);
      });
    });
    menu.appendChild(moveButton);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.className = 'list-item-menu-item';
    copyButton.innerHTML = this.options.icons.duplicate;
    copyButton.setAttribute('aria-label', 'Copy to list');
    copyButton.setAttribute('aria-haspopup', 'menu');
    copyButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      buildSubmenu('copy', copyButton, (targetListId) => {
        this.options.onCopyItemToList(listId, itemId, targetListId);
      });
    });
    menu.appendChild(copyButton);

    addMenuButton(
      this.options.icons.trash,
      'Delete item',
      () => {
        this.options.onDeleteItem(listId, itemId, item.title);
      },
      'delete',
    );

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
    if (activeSubmenu) {
      closeSubmenu();
    }
  }
}
