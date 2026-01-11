export interface ContextMenuActions {
  isSessionPinned: (sessionId: string) => boolean;
  pinSession: (sessionId: string, pinned: boolean) => Promise<void> | void;
  clearHistory: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string) => Promise<void> | void;
}

export class ContextMenuManager {
  private activeContextMenu: HTMLElement | null = null;

  constructor(private readonly actions: ContextMenuActions) {}

  close(): void {
    if (this.activeContextMenu) {
      this.activeContextMenu.remove();
      this.activeContextMenu = null;
    }
  }

  setActiveMenu(menu: HTMLElement | null): void {
    this.activeContextMenu = menu;
  }

  showSessionMenu(x: number, y: number, sessionId: string): void {
    this.close();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const addMenuItem = (
      label: string,
      onClick: () => void,
      extraClass?: string,
    ): HTMLButtonElement => {
      const button = document.createElement('button');
      button.className = extraClass ? `context-menu-item ${extraClass}` : 'context-menu-item';
      button.textContent = label;
      button.addEventListener('click', () => {
        this.close();
        onClick();
      });
      menu.appendChild(button);
      return button;
    };

    const isPinned = this.actions.isSessionPinned(sessionId);
    addMenuItem(isPinned ? 'Unpin' : 'Pin to top', () => {
      void this.actions.pinSession(sessionId, !isPinned);
    });

    addMenuItem('Rename session', () => {
      void this.actions.renameSession(sessionId);
    });

    addMenuItem('Clear history', () => {
      this.actions.clearHistory(sessionId);
    });

    addMenuItem(
      'Delete',
      () => {
        this.actions.deleteSession(sessionId);
      },
      'danger',
    );

    document.body.appendChild(menu);
    this.activeContextMenu = menu;

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  }
}
