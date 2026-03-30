export interface ContextMenuActions {
  isSessionPinned: (sessionId: string) => boolean;
  pinSession: (sessionId: string, pinned: boolean) => Promise<void> | void;
  clearHistory: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string) => Promise<void> | void;
  editSession?: (sessionId: string) => Promise<void> | void;
}

export interface ContextMenuItemDefinition {
  label: string;
  onClick: () => void;
  extraClass?: string;
}

type ContextMenuRenderOptions = {
  menuClassName?: string;
  x: number;
  y: number;
  items: ContextMenuItemDefinition[];
  onClose?: () => void;
  closeOnScrollTarget?: HTMLElement | null;
};

export class ContextMenuManager {
  private activeContextMenu: HTMLElement | null = null;
  private activeMenuCleanup: (() => void) | null = null;

  constructor(private readonly actions: ContextMenuActions) {}

  close(): void {
    if (this.activeMenuCleanup) {
      this.activeMenuCleanup();
    } else {
      this.activeContextMenu?.remove();
    }
    this.activeMenuCleanup = null;
    this.activeContextMenu = null;
  }

  isOpen(): boolean {
    return Boolean(this.activeContextMenu);
  }

  setActiveMenu(menu: HTMLElement | null): void {
    this.activeMenuCleanup?.();
    this.activeMenuCleanup = null;
    this.activeContextMenu = menu;
  }

  private renderMenu(options: ContextMenuRenderOptions): void {
    this.close();
    const { x, y, items, onClose, closeOnScrollTarget, menuClassName = 'context-menu' } = options;

    const menu = document.createElement('div');
    menu.className = menuClassName;
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const addMenuItem = (item: ContextMenuItemDefinition): HTMLButtonElement => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = item.extraClass
        ? `context-menu-item ${item.extraClass}`
        : 'context-menu-item';
      button.textContent = item.label;
      button.addEventListener('click', () => {
        this.close();
        item.onClick();
      });
      menu.appendChild(button);
      return button;
    };

    for (const item of items) {
      addMenuItem(item);
    }

    document.body.appendChild(menu);
    this.activeContextMenu = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }

    const handleOutside = (event: MouseEvent | FocusEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') {
        return;
      }
      if (event.target instanceof Node && menu.contains(event.target)) {
        return;
      }
      this.close();
    };
    const handleScroll = () => {
      this.close();
    };

    document.addEventListener('click', handleOutside);
    document.addEventListener('contextmenu', handleOutside);
    document.addEventListener('keydown', handleOutside);
    closeOnScrollTarget?.addEventListener('scroll', handleScroll, { passive: true });

    this.activeMenuCleanup = () => {
      menu.remove();
      document.removeEventListener('click', handleOutside);
      document.removeEventListener('contextmenu', handleOutside);
      document.removeEventListener('keydown', handleOutside);
      closeOnScrollTarget?.removeEventListener('scroll', handleScroll);
      onClose?.();
      if (this.activeContextMenu === menu) {
        this.activeContextMenu = null;
      }
      if (this.activeMenuCleanup) {
        this.activeMenuCleanup = null;
      }
    };
  }

  showAnchoredMenu(options: {
    anchorEl: HTMLElement;
    items: ContextMenuItemDefinition[];
    menuClassName?: string;
    onClose?: () => void;
    closeOnScrollTarget?: HTMLElement | null;
  }): void {
    const { anchorEl, items, menuClassName, onClose, closeOnScrollTarget } = options;
    const anchorRect = anchorEl.getBoundingClientRect();
    const estimatedWidth = 180;
    this.renderMenu({
      x: anchorRect.left + anchorRect.width / 2 - estimatedWidth / 2,
      y: anchorRect.bottom + 6,
      items,
      ...(menuClassName ? { menuClassName } : {}),
      ...(onClose ? { onClose } : {}),
      ...(closeOnScrollTarget !== undefined ? { closeOnScrollTarget } : {}),
    });
  }

  showSessionMenu(x: number, y: number, sessionId: string): void {
    const isPinned = this.actions.isSessionPinned(sessionId);
    const items: ContextMenuItemDefinition[] = [
      {
        label: isPinned ? 'Unpin' : 'Pin to top',
        onClick: () => {
          void this.actions.pinSession(sessionId, !isPinned);
        },
      },
      {
        label: 'Rename session',
        onClick: () => {
          void this.actions.renameSession(sessionId);
        },
      },
      ...(typeof this.actions.editSession === 'function'
        ? [
            {
              label: 'Edit session',
              onClick: () => {
                void this.actions.editSession?.(sessionId);
              },
            },
          ]
        : []),
      {
        label: 'Clear history',
        onClick: () => {
          this.actions.clearHistory(sessionId);
        },
      },
      {
        label: 'Delete',
        onClick: () => {
          this.actions.deleteSession(sessionId);
        },
        extraClass: 'danger',
      },
    ];
    this.renderMenu({ x, y, items });
  }
}
