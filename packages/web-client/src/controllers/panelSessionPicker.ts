import type { CreateSessionOptions } from './sessionManager';
import { formatSessionLabel } from '../utils/sessionLabel';
import { ICONS } from '../utils/icons';

export interface SessionSummary {
  sessionId: string;
  name?: string;
  agentId?: string;
  pinnedAt?: string;
  updatedAt?: string;
}

export interface AgentSummary {
  agentId: string;
  displayName: string;
  type?: 'chat' | 'external';
}

export interface SessionPickerOpenOptions {
  anchor: HTMLElement;
  title: string;
  disabledSessionIds?: Set<string>;
  allowUnbound?: boolean;
  createSessionOptions?: CreateSessionOptions;
  onSelectSession: (sessionId: string) => void;
  onSelectUnbound?: () => void;
  onDeleteSession?: (sessionId: string) => void;
}

export interface SessionPickerControllerOptions {
  getSessionSummaries: () => SessionSummary[];
  getAgentSummaries: () => AgentSummary[];
  createSessionForAgent: (
    agentId: string,
    options?: CreateSessionOptions,
  ) => Promise<string | null>;
}

interface SessionPickerItemEntry {
  element: HTMLElement;
  onSelect: () => void;
}

export class SessionPickerController {
  private activeMenu: HTMLDivElement | null = null;
  private cleanup: (() => void) | null = null;
  private searchInput: HTMLInputElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private items: SessionPickerItemEntry[] = [];
  private focusedIndex = -1;

  constructor(private readonly options: SessionPickerControllerOptions) {}

  open(options: SessionPickerOpenOptions): void {
    this.close();

    const menu = document.createElement('div');
    menu.className = 'session-picker-popover';

    const title = options.title?.trim();
    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'session-picker-title';
      titleEl.textContent = title;
      menu.appendChild(titleEl);
    }

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'session-picker-search';
    searchInput.placeholder = 'Search sessions...';
    searchInput.autocomplete = 'off';
    if (title) {
      searchInput.setAttribute('aria-label', title);
    }
    menu.appendChild(searchInput);

    const listEl = document.createElement('div');
    listEl.className = 'session-picker-list';
    menu.appendChild(listEl);

    document.body.appendChild(menu);
    this.activeMenu = menu;
    this.searchInput = searchInput;
    this.listEl = listEl;
    this.items = [];
    this.focusedIndex = -1;

    const sessions = this.getOrderedSessions();
    const agentSummaries = this.options.getAgentSummaries();
    const agentNameById = new Map(
      agentSummaries
        .map((agent) => [agent.agentId, agent.displayName] as const)
        .filter((entry) => entry[0] && entry[1]),
    );
    const disabled = options.disabledSessionIds ?? new Set<string>();

    const getAgentLabel = (agentId?: string): string => {
      const trimmed = typeof agentId === 'string' ? agentId.trim() : '';
      if (!trimmed) {
        return '';
      }
      return agentNameById.get(trimmed) ?? trimmed;
    };

    const getSessionSearchLabel = (summary: SessionSummary): string => {
      const name = typeof summary.name === 'string' ? summary.name.trim() : '';
      const agentId = typeof summary.agentId === 'string' ? summary.agentId.trim() : '';
      const agentLabel = getAgentLabel(agentId);
      const idPrefix = summary.sessionId.slice(0, 8);
      return [name, agentLabel, agentId, idPrefix].filter(Boolean).join(' ').toLowerCase();
    };

    const getAgentSearchLabel = (summary: AgentSummary): string => {
      return summary.displayName.trim().toLowerCase();
    };

    const renderList = (): void => {
      if (!this.listEl) {
        return;
      }

      this.listEl.innerHTML = '';
      this.items = [];
      this.focusedIndex = -1;

      const filter = searchInput.value.trim().toLowerCase();
      let hasContent = false;

      const addDivider = (): void => {
        const divider = document.createElement('div');
        divider.className = 'session-picker-divider';
        this.listEl?.appendChild(divider);
      };

      const addSection = (label: string): void => {
        if (hasContent) {
          addDivider();
        }
        const section = document.createElement('div');
        section.className = 'session-picker-section';
        section.textContent = label;
        this.listEl?.appendChild(section);
        hasContent = true;
      };

      const addEmpty = (label: string): void => {
        const empty = document.createElement('div');
        empty.className = 'session-picker-empty';
        empty.textContent = label;
        this.listEl?.appendChild(empty);
      };

      const addItem = (
        label: string,
        onSelect: () => void | Promise<void>,
        itemOptions?: { disabled?: boolean; sessionId?: string },
      ): void => {
        const item = document.createElement('div');
        item.className = 'session-picker-item';
        item.setAttribute('role', 'button');

        const normalState = document.createElement('div');
        normalState.className = 'session-picker-item-normal';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'session-picker-item-label';
        labelSpan.textContent = label;
        normalState.appendChild(labelSpan);

        let confirmState: HTMLDivElement | null = null;

        if (itemOptions?.sessionId && options.onDeleteSession) {
          const deleteBtn = document.createElement('button');
          deleteBtn.type = 'button';
          deleteBtn.className = 'session-picker-delete-btn';
          deleteBtn.innerHTML = ICONS.trash;
          deleteBtn.title = 'Delete session';

          confirmState = document.createElement('div');
          confirmState.className = 'session-picker-item-confirm';

          const confirmLabel = document.createElement('span');
          confirmLabel.className = 'session-picker-confirm-label';
          confirmLabel.textContent = 'Delete?';
          confirmState.appendChild(confirmLabel);

          const confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          confirmBtn.className = 'session-picker-confirm-btn';
          confirmBtn.innerHTML = ICONS.check;
          confirmBtn.title = 'Confirm delete';
          confirmState.appendChild(confirmBtn);

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'session-picker-cancel-btn';
          cancelBtn.innerHTML = ICONS.x;
          cancelBtn.title = 'Cancel';
          confirmState.appendChild(cancelBtn);

          deleteBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            item.classList.add('confirming');
          });

          confirmBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            options.onDeleteSession!(itemOptions.sessionId!);
          });

          cancelBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            item.classList.remove('confirming');
          });

          normalState.appendChild(deleteBtn);
        }

        item.appendChild(normalState);
        if (confirmState) {
          item.appendChild(confirmState);
        }

        if (itemOptions?.disabled) {
          item.classList.add('disabled');
          item.setAttribute('aria-disabled', 'true');
        } else {
          item.tabIndex = 0;
          const handleSelect = () => {
            this.close();
            void onSelect();
          };
          item.addEventListener('click', (event) => {
            if (item.classList.contains('confirming')) {
              return;
            }
            event.preventDefault();
            handleSelect();
          });
          item.addEventListener('keydown', (event) => {
            if (item.classList.contains('confirming')) {
              return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleSelect();
            }
          });
          const index = this.items.length;
          this.items.push({ element: item, onSelect: handleSelect });
          item.addEventListener('mouseenter', () => {
            this.setFocusedIndex(index);
          });
        }

        this.listEl?.appendChild(item);
      };

      if (options.allowUnbound) {
        addSection('Unbound');
        addItem('Unbound', () => options.onSelectUnbound?.(), {
          disabled: !options.onSelectUnbound,
        });
      }

      addSection('Sessions');
      const filteredSessions = sessions.filter((session) => {
        if (!filter) {
          return true;
        }
        return getSessionSearchLabel(session).includes(filter);
      });

      if (filteredSessions.length === 0) {
        const message = sessions.length === 0 ? 'No sessions available.' : 'No matching sessions.';
        addEmpty(message);
      } else {
        for (const session of filteredSessions) {
          const label = this.formatSessionLabel(session, agentSummaries);
          const isDisabled = disabled.has(session.sessionId);
          addItem(
            isDisabled ? `${label} (open)` : label,
            () => options.onSelectSession(session.sessionId),
            { disabled: isDisabled, sessionId: session.sessionId },
          );
        }
      }

      const filteredAgents = agentSummaries.filter((agent) => {
        if (!filter) {
          return true;
        }
        return getAgentSearchLabel(agent).includes(filter);
      });
      const shouldShowAgents = filter ? filteredAgents.length > 0 : true;

      if (shouldShowAgents) {
        addSection('New session');
        if (filteredAgents.length === 0) {
          addEmpty('No agents available.');
        } else {
          for (const agent of filteredAgents) {
            addItem(agent.displayName, async () => {
              const sessionId = await this.options.createSessionForAgent(
                agent.agentId,
                options.createSessionOptions,
              );
              if (sessionId) {
                options.onSelectSession(sessionId);
              }
            });
          }
        }
      }

      if (this.items.length > 0) {
        this.setFocusedIndex(0);
      }
    };

    renderList();
    this.positionMenu(menu, options.anchor);

    setTimeout(() => {
      searchInput.focus();
    }, 0);

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (menu.contains(target) || options.anchor.contains(target)) {
        return;
      }
      this.close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.moveFocus(1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.moveFocus(-1);
        return;
      }
      if (event.key === 'Enter') {
        const didSelect = this.selectFocusedItem();
        if (didSelect) {
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        if (options.anchor.isConnected) {
          options.anchor.focus();
        }
      }
    };

    searchInput.addEventListener('input', renderList);
    menu.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handlePointerDown);
    this.cleanup = () => {
      searchInput.removeEventListener('input', renderList);
      menu.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }

  close(): void {
    this.cleanup?.();
    this.cleanup = null;
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
    this.searchInput = null;
    this.listEl = null;
    this.items = [];
    this.focusedIndex = -1;
  }

  private getOrderedSessions(): SessionSummary[] {
    const sessions = [...this.options.getSessionSummaries()];
    return sessions.sort((a, b) => this.compareSessions(a, b));
  }

  private compareSessions(a: SessionSummary, b: SessionSummary): number {
    const aPinned = Boolean(a.pinnedAt);
    const bPinned = Boolean(b.pinnedAt);
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }
    if (aPinned && bPinned) {
      const aTime = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
      const bTime = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;
      if (aTime !== bTime) {
        return bTime - aTime;
      }
    }
    const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (aUpdated !== bUpdated) {
      return bUpdated - aUpdated;
    }
    return a.sessionId.localeCompare(b.sessionId);
  }

  private formatSessionLabel(summary: SessionSummary, agentSummaries: AgentSummary[]): string {
    return formatSessionLabel(summary, { agentSummaries });
  }

  private setFocusedIndex(nextIndex: number): void {
    if (this.items.length === 0) {
      this.focusedIndex = -1;
      return;
    }

    const clamped = Math.max(0, Math.min(nextIndex, this.items.length - 1));
    if (this.focusedIndex === clamped) {
      return;
    }

    const previous = this.items[this.focusedIndex];
    if (previous) {
      previous.element.classList.remove('focused');
    }
    const next = this.items[clamped];
    if (!next) {
      this.focusedIndex = -1;
      return;
    }
    next.element.classList.add('focused');
    next.element.scrollIntoView({ block: 'nearest' });
    this.focusedIndex = clamped;
  }

  private moveFocus(delta: number): void {
    if (this.items.length === 0) {
      return;
    }
    const startIndex = this.focusedIndex;
    const nextIndex = startIndex < 0 ? (delta > 0 ? 0 : this.items.length - 1) : startIndex + delta;
    this.setFocusedIndex(nextIndex);
  }

  private selectFocusedItem(): boolean {
    if (this.focusedIndex < 0) {
      return false;
    }
    const entry = this.items[this.focusedIndex];
    if (!entry) {
      return false;
    }
    entry.onSelect();
    return true;
  }

  private positionMenu(menu: HTMLDivElement, anchor: HTMLElement): void {
    const anchorRect = anchor.getBoundingClientRect();
    menu.style.minWidth = `${Math.max(240, anchorRect.width)}px`;
    const menuRect = menu.getBoundingClientRect();
    const padding = 8;

    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;

    if (left + menuRect.width > window.innerWidth - padding) {
      left = window.innerWidth - menuRect.width - padding;
    }
    if (left < padding) {
      left = padding;
    }

    if (top + menuRect.height > window.innerHeight - padding) {
      top = anchorRect.top - menuRect.height - 6;
    }
    if (top < padding) {
      top = padding;
    }

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }
}
