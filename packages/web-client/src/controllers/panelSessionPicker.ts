import type { CreateSessionOptions } from './sessionManager';
import { apiFetch } from '../utils/api';
import { formatSessionLabel, resolveAutoTitle } from '../utils/sessionLabel';
import { ICONS } from '../utils/icons';

export interface SessionSummary {
  sessionId: string;
  name?: string;
  agentId?: string;
  pinnedAt?: string;
  updatedAt?: string;
  attributes?: Record<string, unknown>;
}

export interface AgentSummary {
  agentId: string;
  displayName: string;
  type?: 'chat' | 'external';
  sessionWorkingDirMode?: 'auto' | 'prompt';
  sessionWorkingDirRoots?: string[];
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
  onClearSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string) => void;
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
  private activeSubmenu: HTMLDivElement | null = null;
  private cleanup: (() => void) | null = null;
  private searchInput: HTMLInputElement | null = null;
  private listEl: HTMLDivElement | null = null;
  private items: SessionPickerItemEntry[] = [];
  private focusedIndex = -1;
  private workingDirOverlay: HTMLDivElement | null = null;
  private workingDirCleanup: (() => void) | null = null;
  private workingDirAbort: AbortController | null = null;
  private workingDirItems: SessionPickerItemEntry[] = [];
  private workingDirFocusedIndex = -1;

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
      const autoTitle = resolveAutoTitle(summary.attributes);
      const agentId = typeof summary.agentId === 'string' ? summary.agentId.trim() : '';
      const agentLabel = getAgentLabel(agentId);
      const idPrefix = summary.sessionId.slice(0, 8);
      return [name, autoTitle, agentLabel, agentId, idPrefix]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    };

    const getAgentSearchLabel = (summary: AgentSummary): string => {
      return summary.displayName.trim().toLowerCase();
    };

    const renderList = (): void => {
      if (!this.listEl) {
        return;
      }

      this.closeSubmenu();
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
        if (itemOptions?.sessionId) {
          item.dataset['sessionId'] = itemOptions.sessionId;
        }

        const normalState = document.createElement('div');
        normalState.className = 'session-picker-item-normal';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'session-picker-item-label';
        labelSpan.textContent = label;
        normalState.appendChild(labelSpan);

        let confirmState: HTMLDivElement | null = null;

        if (itemOptions?.sessionId && options.onRenameSession) {
          const renameBtn = document.createElement('button');
          renameBtn.type = 'button';
          renameBtn.className = 'session-picker-rename-btn';
          renameBtn.innerHTML = ICONS.edit;
          renameBtn.title = 'Rename session';
          renameBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            options.onRenameSession?.(itemOptions.sessionId!);
          });
          normalState.appendChild(renameBtn);
        }

        if (itemOptions?.sessionId && options.onClearSession) {
          const clearBtn = document.createElement('button');
          clearBtn.type = 'button';
          clearBtn.className = 'session-picker-clear-btn';
          clearBtn.innerHTML = ICONS.reset;
          clearBtn.title = 'Clear session history';
          clearBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.close();
            options.onClearSession?.(itemOptions.sessionId!);
          });
          normalState.appendChild(clearBtn);
        }

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

        if (itemOptions?.sessionId && this.isTouchDevice()) {
          const hasActions = Boolean(
            options.onRenameSession || options.onClearSession || options.onDeleteSession,
          );
          if (hasActions) {
            const moreBtn = document.createElement('button');
            moreBtn.type = 'button';
            moreBtn.className = 'session-picker-more-btn';
            moreBtn.innerHTML = ICONS.moreVertical;
            moreBtn.title = 'Session actions';
            moreBtn.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              this.openSubmenu({
                anchor: moreBtn,
                item,
                sessionId: itemOptions.sessionId!,
                ...(options.onRenameSession ? { onRename: options.onRenameSession } : {}),
                ...(options.onClearSession ? { onClear: options.onClearSession } : {}),
                canDelete: Boolean(options.onDeleteSession),
              });
            });
            normalState.appendChild(moreBtn);
          }
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
          const createSessionForAgent = async (agent: AgentSummary) => {
            let workingDir: string | undefined;
            if (agent.sessionWorkingDirMode === 'prompt') {
              const entries = await this.fetchWorkingDirEntries(agent.agentId);
              if (entries.length > 0) {
                workingDir = await this.promptForWorkingDir({
                  agentLabel: agent.displayName,
                  entries,
                });
              }
            }
            const createOptions = options.createSessionOptions;
            const sessionId = await this.options.createSessionForAgent(agent.agentId, {
              ...(createOptions ? createOptions : {}),
              ...(workingDir ? { workingDir } : {}),
            });
            if (sessionId) {
              options.onSelectSession(sessionId);
            }
          };
          for (const agent of filteredAgents) {
            addItem(agent.displayName, async () => {
              await createSessionForAgent(agent);
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
        if (this.activeSubmenu) {
          this.closeSubmenu();
          return;
        }
        this.close();
        if (options.anchor.isConnected) {
          options.anchor.focus();
        }
      }
    };

    const handleMenuClick = (event: MouseEvent) => {
      if (!this.activeSubmenu) {
        return;
      }
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      const keepOpen =
        Boolean((target as Element | null)?.closest?.('.session-picker-submenu')) ||
        Boolean((target as Element | null)?.closest?.('.session-picker-more-btn'));
      if (!keepOpen) {
        this.closeSubmenu();
      }
    };

    searchInput.addEventListener('input', renderList);
    menu.addEventListener('keydown', handleKeyDown);
    menu.addEventListener('click', handleMenuClick);
    window.addEventListener('mousedown', handlePointerDown);
    this.cleanup = () => {
      searchInput.removeEventListener('input', renderList);
      menu.removeEventListener('keydown', handleKeyDown);
      menu.removeEventListener('click', handleMenuClick);
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }

  close(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.closeSubmenu();
    this.closeWorkingDirPicker();
    if (this.activeMenu) {
      this.activeMenu.remove();
      this.activeMenu = null;
    }
    this.searchInput = null;
    this.listEl = null;
    this.items = [];
    this.focusedIndex = -1;
  }

  isOpen(): boolean {
    return Boolean(this.activeMenu);
  }

  private closeWorkingDirPicker(): void {
    this.workingDirCleanup?.();
    this.workingDirCleanup = null;
    if (this.workingDirAbort) {
      this.workingDirAbort.abort();
      this.workingDirAbort = null;
    }
    if (this.workingDirOverlay) {
      this.workingDirOverlay.remove();
      this.workingDirOverlay = null;
    }
    this.workingDirItems = [];
    this.workingDirFocusedIndex = -1;
  }

  private async fetchWorkingDirEntries(
    agentId: string,
  ): Promise<Array<{ root: string; directories: string[] }>> {
    try {
      const controller = new AbortController();
      this.workingDirAbort = controller;
      const response = await apiFetch('/api/plugins/agents/operations/list-working-dirs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return [];
      }
      const data = (await response.json()) as unknown;
      const roots =
        data && typeof data === 'object'
          ? (data as { roots?: unknown }).roots ??
            (data as { result?: { roots?: unknown } }).result?.roots
          : undefined;
      if (!Array.isArray(roots)) {
        return [];
      }
      const parsed: Array<{ root: string; directories: string[] }> = [];
      for (const entry of roots) {
        if (!entry || typeof entry !== 'object') {
          continue;
        }
        const anyEntry = entry as { root?: unknown; directories?: unknown };
        const root = typeof anyEntry.root === 'string' ? anyEntry.root.trim() : '';
        if (!root) {
          continue;
        }
        const directories = Array.isArray(anyEntry.directories)
          ? anyEntry.directories
              .filter((dir) => typeof dir === 'string')
              .map((dir) => dir.trim())
              .filter((dir) => dir.length > 0)
          : [];
        parsed.push({ root, directories });
      }
      return parsed;
    } catch {
      return [];
    } finally {
      this.workingDirAbort = null;
    }
  }

  private async promptForWorkingDir(options: {
    entries: Array<{ root: string; directories: string[] }>;
    agentLabel?: string;
  }): Promise<string | undefined> {
    const entries = options.entries.filter(
      (entry) => entry.root.trim().length > 0 && entry.directories.length >= 0,
    );
    if (entries.length === 0) {
      return undefined;
    }

    this.closeWorkingDirPicker();

    return new Promise((resolve) => {
      let resolved = false;
      const finalize = (value?: string) => {
        if (resolved) {
          return;
        }
        resolved = true;
        this.closeWorkingDirPicker();
        resolve(value);
      };

      const overlay = document.createElement('div');
      overlay.className = 'working-dir-picker-overlay';

      const popover = document.createElement('div');
      popover.className = 'session-picker-popover working-dir-picker-popover';

      const titleEl = document.createElement('div');
      titleEl.className = 'session-picker-title';
      titleEl.textContent = options.agentLabel
        ? `Working directory (${options.agentLabel})`
        : 'Working directory';
      popover.appendChild(titleEl);

      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'session-picker-search';
      searchInput.placeholder = 'Search directories...';
      searchInput.autocomplete = 'off';
      searchInput.setAttribute('aria-label', titleEl.textContent ?? 'Working directory');
      popover.appendChild(searchInput);

      const listEl = document.createElement('div');
      listEl.className = 'session-picker-list';
      popover.appendChild(listEl);

      overlay.appendChild(popover);
      document.body.appendChild(overlay);
      this.workingDirOverlay = overlay;

      const renderList = (): void => {
        listEl.innerHTML = '';
        this.workingDirItems = [];
        this.workingDirFocusedIndex = -1;
        const filter = searchInput.value.trim().toLowerCase();

        const addSection = (label: string): void => {
          const section = document.createElement('div');
          section.className = 'session-picker-section';
          section.textContent = label;
          listEl.appendChild(section);
        };

        const addEmpty = (label: string): void => {
          const empty = document.createElement('div');
          empty.className = 'session-picker-empty';
          empty.textContent = label;
          listEl.appendChild(empty);
        };

        const addItem = (label: string, onSelect: () => void, fullValue?: string): void => {
          const item = document.createElement('div');
          item.className = 'session-picker-item';
          item.setAttribute('role', 'button');
          item.tabIndex = 0;

          const labelSpan = document.createElement('span');
          labelSpan.className = 'session-picker-item-label';
          labelSpan.textContent = label;
          if (fullValue) {
            labelSpan.title = fullValue;
          }
          item.appendChild(labelSpan);

          const handleSelect = () => {
            onSelect();
          };
          item.addEventListener('click', (event) => {
            event.preventDefault();
            handleSelect();
          });
          item.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              handleSelect();
            }
          });

          listEl.appendChild(item);
          this.workingDirItems.push({ element: item, onSelect: handleSelect });
        };

        addSection('Options');
        addItem('Use default', () => finalize(undefined));

        let matches = 0;
        for (const entry of entries) {
          const directories = filter
            ? entry.directories.filter((dir) => dir.toLowerCase().includes(filter))
            : entry.directories;
          if (directories.length === 0) {
            continue;
          }
          addSection(entry.root);
          for (const dir of directories) {
            const label = dir.replace(/\/+$/, '').split('/').filter(Boolean).pop() ?? dir;
            addItem(label, () => finalize(dir), dir);
            matches += 1;
          }
        }
        if (matches === 0) {
          addEmpty(filter ? 'No matching directories.' : 'No directories available.');
        }

        if (this.workingDirItems.length > 0) {
          this.setWorkingDirFocusedIndex(0);
        }
      };

      renderList();
      setTimeout(() => searchInput.focus(), 0);

      const handleOverlayClick = (event: MouseEvent) => {
        if (event.target === overlay) {
          finalize(undefined);
        }
      };

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          this.moveWorkingDirFocus(1);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          this.moveWorkingDirFocus(-1);
          return;
        }
        if (event.key === 'Enter') {
          const didSelect = this.selectWorkingDirFocusedItem();
          if (didSelect) {
            event.preventDefault();
          }
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          finalize(undefined);
        }
      };

      searchInput.addEventListener('input', renderList);
      overlay.addEventListener('click', handleOverlayClick);
      popover.addEventListener('keydown', handleKeyDown);

      this.workingDirCleanup = () => {
        searchInput.removeEventListener('input', renderList);
        overlay.removeEventListener('click', handleOverlayClick);
        popover.removeEventListener('keydown', handleKeyDown);
      };
    });
  }

  private setWorkingDirFocusedIndex(nextIndex: number): void {
    if (this.workingDirItems.length === 0) {
      return;
    }
    const clamped = Math.max(0, Math.min(this.workingDirItems.length - 1, nextIndex));
    if (this.workingDirFocusedIndex === clamped) {
      return;
    }
    if (this.workingDirFocusedIndex >= 0) {
      const previous = this.workingDirItems[this.workingDirFocusedIndex];
      previous?.element.classList.remove('focused');
    }
    this.workingDirFocusedIndex = clamped;
    const current = this.workingDirItems[this.workingDirFocusedIndex];
    if (current) {
      current.element.classList.add('focused');
      current.element.scrollIntoView({ block: 'nearest' });
    }
  }

  private moveWorkingDirFocus(delta: number): void {
    if (this.workingDirItems.length === 0) {
      return;
    }
    const next = this.workingDirFocusedIndex + delta;
    this.setWorkingDirFocusedIndex(next);
  }

  private selectWorkingDirFocusedItem(): boolean {
    if (this.workingDirItems.length === 0 || this.workingDirFocusedIndex < 0) {
      return false;
    }
    const entry = this.workingDirItems[this.workingDirFocusedIndex];
    if (!entry) {
      return false;
    }
    entry.onSelect();
    return true;
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
    const targetWidth = Math.min(360, Math.max(280, anchorRect.width));
    menu.style.minWidth = `${targetWidth}px`;
    menu.style.width = `${targetWidth}px`;
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

  private isTouchDevice(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }
    const matchMedia = window.matchMedia;
    if (typeof matchMedia !== 'function') {
      return false;
    }
    try {
      return matchMedia('(hover: none)').matches;
    } catch {
      return false;
    }
  }

  private closeSubmenu(): void {
    if (!this.activeSubmenu) {
      return;
    }
    this.activeSubmenu.remove();
    this.activeSubmenu = null;
  }

  private openSubmenu(options: {
    anchor: HTMLElement;
    item: HTMLElement;
    sessionId: string;
    onRename?: (sessionId: string) => void;
    onClear?: (sessionId: string) => void;
    canDelete: boolean;
  }): void {
    if (!this.activeMenu) {
      return;
    }

    this.closeSubmenu();
    options.item.classList.remove('confirming');

    const submenu = document.createElement('div');
    submenu.className = 'session-picker-submenu';
    submenu.setAttribute('role', 'menu');

    const addItem = (itemOptions: {
      label: string;
      icon: string;
      danger?: boolean;
      onSelect: () => void;
    }): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'session-picker-submenu-item';
      if (itemOptions.danger) {
        button.classList.add('danger');
      }
      button.innerHTML = `<span class="session-picker-submenu-icon">${itemOptions.icon}</span><span>${itemOptions.label}</span>`;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        itemOptions.onSelect();
      });
      submenu.appendChild(button);
    };

    if (options.onRename) {
      addItem({
        label: 'Rename',
        icon: ICONS.edit,
        onSelect: () => {
          this.closeSubmenu();
          this.close();
          options.onRename?.(options.sessionId);
        },
      });
    }

    if (options.onClear) {
      addItem({
        label: 'Clear history',
        icon: ICONS.reset,
        onSelect: () => {
          this.closeSubmenu();
          this.close();
          options.onClear?.(options.sessionId);
        },
      });
    }

    if (options.canDelete) {
      addItem({
        label: 'Delete',
        icon: ICONS.trash,
        danger: true,
        onSelect: () => {
          this.closeSubmenu();
          options.item.classList.add('confirming');
        },
      });
    }

    const anchorRect = options.anchor.getBoundingClientRect();
    const menuRect = this.activeMenu.getBoundingClientRect();

    submenu.style.visibility = 'hidden';
    submenu.style.left = '0px';
    submenu.style.top = '0px';
    this.activeMenu.appendChild(submenu);
    const submenuRect = submenu.getBoundingClientRect();
    submenu.style.visibility = '';

    const padding = 8;
    let top = anchorRect.bottom - menuRect.top + 4;
    let left = anchorRect.right - menuRect.left - submenuRect.width;

    if (left < padding) {
      left = padding;
    }
    if (left + submenuRect.width > menuRect.width - padding) {
      left = Math.max(padding, menuRect.width - submenuRect.width - padding);
    }

    if (top + submenuRect.height > menuRect.height - padding) {
      top = Math.max(padding, menuRect.height - submenuRect.height - padding);
    }

    submenu.style.left = `${left}px`;
    submenu.style.top = `${top}px`;

    this.activeSubmenu = submenu;
  }
}
