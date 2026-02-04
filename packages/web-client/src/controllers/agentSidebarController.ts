import { stripContextLine } from '../utils/chatMessageRenderer';
import { resolveAutoTitle } from '../utils/sessionLabel';
import type { CreateSessionOptions } from './sessionManager';

interface SessionSummary {
  agentId?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When set, indicates that the session is pinned in the UI.
   * The value is the timestamp when the session was pinned and
   * is used for ordering pinned sessions (most recently pinned first).
   */
  pinnedAt?: string;
  /**
   * Optional user-defined session name.
   */
  name?: string;
  /**
   * Optional session-scoped attributes for plugins/panels.
   */
  attributes?: Record<string, unknown>;
  lastSnippet?: string;
}

interface AgentSummary {
  agentId: string;
  displayName: string;
  description?: string;
  type?: 'chat' | 'external';
  sessionWorkingDirMode?: 'auto' | 'prompt';
  sessionWorkingDirRoots?: string[];
}

export type SidebarViewMode = 'by-agent' | 'all-sessions';

const SIDEBAR_VIEW_MODE_STORAGE_KEY = 'sidebarViewMode';

export interface AgentSidebarControllerOptions {
  agentSidebar: HTMLElement | null;
  agentSidebarSections: HTMLElement | null;
  viewModeToggle: HTMLButtonElement | null;
  icons: { plus: string };
  getSessionSummaries: () => SessionSummary[];
  getAgentSummaries: () => AgentSummary[];
  getSelectedSessionId: () => string | null;
  sessionsWithPendingMessages: Set<string>;
  sessionsWithActiveTyping: Set<string>;
  getFocusedSessionId: () => string | null;
  setFocusedSessionId: (id: string | null) => void;
  setFocusedSessionItem: (item: HTMLElement | null) => void;
  isSidebarFocused: () => boolean;
  selectSession: (sessionId: string) => void;
  createSessionForAgent: (
    agentId: string,
    options?: CreateSessionOptions,
  ) => Promise<string | null>;
  showSessionMenu: (x: number, y: number, sessionId: string) => void;
  focusInput: () => void;
  getAutoFocusChatOnSessionReady: () => boolean;
  isMobileViewport: () => boolean;
  onSessionSelectedOnMobile: () => void;
  onRendered?: () => void;
}

export class AgentSidebarController {
  private viewMode: SidebarViewMode = 'by-agent';
  private headerNewSessionButton: HTMLButtonElement | null = null;
  private headerAgentDropdown: HTMLElement | null = null;
  private headerAgentDropdownList: HTMLElement | null = null;
  private headerAgentDropdownOpen = false;

  constructor(private readonly options: AgentSidebarControllerOptions) {
    this.loadViewMode();
    this.initViewModeToggle();
    this.initHeaderNewSessionControls();
  }

  private isPinned(session: SessionSummary): boolean {
    return typeof session.pinnedAt === 'string' && session.pinnedAt.length > 0;
  }

  private compareSessions(a: SessionSummary, b: SessionSummary): number {
    const aPinned = this.isPinned(a);
    const bPinned = this.isPinned(b);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;

    if (aPinned && bPinned) {
      const aPinnedTime = new Date(a.pinnedAt as string).getTime();
      const bPinnedTime = new Date(b.pinnedAt as string).getTime();
      if (aPinnedTime !== bPinnedTime) {
        return bPinnedTime - aPinnedTime;
      }
    }

    const aCreated = new Date(a.createdAt).getTime();
    const bCreated = new Date(b.createdAt).getTime();
    return bCreated - aCreated;
  }

  private buildSessionLabel(session: SessionSummary, fallbackTitle?: string): string {
    const name = typeof session.name === 'string' ? session.name.trim() : '';
    if (name) {
      return name;
    }

    const autoTitle = resolveAutoTitle(session.attributes);
    if (autoTitle) {
      return autoTitle;
    }

    const snippet =
      typeof session.lastSnippet === 'string' ? stripContextLine(session.lastSnippet).trim() : '';
    if (snippet.length > 0) {
      return snippet;
    }

    const title = typeof fallbackTitle === 'string' ? fallbackTitle.trim() : '';
    if (title.length > 0) {
      return title;
    }

    return 'New session';
  }

  private loadViewMode(): void {
    try {
      const saved = window.localStorage.getItem(SIDEBAR_VIEW_MODE_STORAGE_KEY);
      if (saved === 'all-sessions' || saved === 'by-agent') {
        this.viewMode = saved;
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  private saveViewMode(): void {
    try {
      window.localStorage.setItem(SIDEBAR_VIEW_MODE_STORAGE_KEY, this.viewMode);
    } catch {
      // Ignore localStorage errors
    }
  }

  private initViewModeToggle(): void {
    const { viewModeToggle } = this.options;
    if (!viewModeToggle) return;

    viewModeToggle.addEventListener('click', () => {
      this.viewMode = this.viewMode === 'by-agent' ? 'all-sessions' : 'by-agent';
      this.saveViewMode();
      this.updateToggleButtonState();
      this.render();
    });
    this.updateToggleButtonState();
  }

  private updateToggleButtonState(): void {
    const { viewModeToggle } = this.options;
    if (!viewModeToggle) return;

    const isAllSessions = this.viewMode === 'all-sessions';
    viewModeToggle.classList.toggle('active', isAllSessions);
    viewModeToggle.setAttribute(
      'aria-label',
      isAllSessions ? 'Group sessions by agent' : 'Show all sessions together',
    );
    viewModeToggle.setAttribute('title', isAllSessions ? 'Group by agent' : 'Show all');
  }

  private initHeaderNewSessionControls(): void {
    const { agentSidebar } = this.options;
    if (!agentSidebar) return;

    const button = agentSidebar.querySelector<HTMLButtonElement>('#sidebar-agent-add-button');
    const dropdown = agentSidebar.querySelector<HTMLElement>('#agent-add-dropdown');
    const list = agentSidebar.querySelector<HTMLElement>('#agent-add-dropdown-list');

    if (!button || !dropdown || !list) {
      return;
    }

    this.headerNewSessionButton = button;
    this.headerAgentDropdown = dropdown;
    this.headerAgentDropdownList = list;

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleHeaderAgentDropdown();
    });

    dropdown.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    document.addEventListener('click', (event) => {
      if (!this.headerAgentDropdownOpen) {
        return;
      }
      const target = event.target as Node | null;
      if (!target || !this.headerAgentDropdown || !this.headerNewSessionButton) {
        return;
      }
      if (
        !this.headerAgentDropdown.contains(target) &&
        target !== this.headerNewSessionButton &&
        !this.headerNewSessionButton.contains(target)
      ) {
        this.toggleHeaderAgentDropdown(false);
      }
    });
  }

  getVisibleSessionIds(): string[] {
    const { agentSidebarSections } = this.options;
    if (!agentSidebarSections) {
      return [];
    }
    const items = agentSidebarSections.querySelectorAll<HTMLElement>('.agent-sidebar-session-item');
    const ids: string[] = [];
    for (const item of items) {
      const sessionId = item.dataset['sessionId'];
      if (!sessionId) {
        continue;
      }
      const section = item.closest<HTMLElement>('.agent-sidebar-section');
      if (section && section.classList.contains('collapsed')) {
        continue;
      }
      ids.push(sessionId);
    }
    return ids;
  }

  private toggleHeaderAgentDropdown(open?: boolean): void {
    const next = open ?? !this.headerAgentDropdownOpen;
    if (next === this.headerAgentDropdownOpen) {
      return;
    }
    this.headerAgentDropdownOpen = next;

    if (!this.headerNewSessionButton || !this.headerAgentDropdown) {
      return;
    }

    if (this.headerAgentDropdownOpen) {
      this.populateHeaderAgentDropdown();
    }

    this.headerAgentDropdown.classList.toggle('open', this.headerAgentDropdownOpen);
    this.headerNewSessionButton.classList.toggle('active', this.headerAgentDropdownOpen);
    this.headerNewSessionButton.setAttribute('aria-expanded', String(this.headerAgentDropdownOpen));
  }

  private populateHeaderAgentDropdown(): void {
    if (!this.headerAgentDropdownList) {
      return;
    }

    const agents = this.options.getAgentSummaries();
    this.headerAgentDropdownList.innerHTML = '';

    if (!Array.isArray(agents) || agents.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'agent-add-dropdown-empty';
      empty.textContent = 'No agents available';
      this.headerAgentDropdownList.appendChild(empty);
      return;
    }

    for (const agent of agents) {
      const itemButton = document.createElement('button');
      itemButton.type = 'button';
      itemButton.className = 'agent-add-dropdown-item';
      itemButton.dataset['agentId'] = agent.agentId;
      itemButton.textContent = agent.displayName;
      itemButton.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleHeaderAgentDropdown(false);
        void this.options.createSessionForAgent(agent.agentId);
      });
      this.headerAgentDropdownList.appendChild(itemButton);
    }
  }

  getViewMode(): SidebarViewMode {
    return this.viewMode;
  }

  private renderAllSessionsView(): void {
    const { agentSidebar, agentSidebarSections } = this.options;
    if (!agentSidebar || !agentSidebarSections) return;

    const allSessions = [...this.options.getSessionSummaries()].sort((a, b) =>
      this.compareSessions(a, b),
    );
    const agentSummaries = this.options.getAgentSummaries();
    const agentMap = new Map(agentSummaries.map((a) => [a.agentId, a]));

    const section = document.createElement('section');
    section.className = 'agent-sidebar-section agent-sidebar-all-sessions';

    const listEl = document.createElement('ul');
    listEl.className = 'agent-sidebar-session-list agent-sidebar-all-sessions-list';

    if (allSessions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'agent-sidebar-empty';
      empty.textContent = 'No sessions yet';
      section.appendChild(empty);
      agentSidebarSections.appendChild(section);
      return;
    }

    for (const session of allSessions) {
      const item = document.createElement('li');
      item.className = 'agent-sidebar-session-item';
      item.dataset['sessionId'] = session.sessionId;

      if (session.sessionId === this.options.getSelectedSessionId()) {
        item.classList.add('active');
      }

      item.addEventListener('click', () => {
        // On mobile, close the sidebar and return early
        if (this.options.isMobileViewport()) {
          this.options.onSessionSelectedOnMobile();
          if (session.sessionId !== this.options.getSelectedSessionId()) {
            this.options.selectSession(session.sessionId);
          }
          return;
        }

        if (session.sessionId === this.options.getSelectedSessionId()) {
          console.log('[client] click on active session, entering sidebar focus mode');
          this.options.setFocusedSessionId(session.sessionId);
          this.options.setFocusedSessionItem(item);
          agentSidebar?.focus();
          return;
        }

        this.options.selectSession(session.sessionId);

        // Don't auto-focus input on mobile - it triggers the keyboard
        if (this.options.getAutoFocusChatOnSessionReady() && !this.options.isMobileViewport()) {
          setTimeout(() => {
            this.options.focusInput();
          }, 0);
        }
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.options.showSessionMenu(e.clientX, e.clientY, session.sessionId);
      });

      const row = document.createElement('div');
      row.className = 'agent-sidebar-session-row';

      const label = document.createElement('div');
      label.className = 'agent-sidebar-session-item-label';
      const agentId = session.agentId;
      const agent = agentId ? agentMap.get(agentId) : null;
      const sessionLabel = this.buildSessionLabel(session, agent?.displayName);
      const truncatedSnippet =
        sessionLabel.length > 60 ? `${sessionLabel.slice(0, 57)}…` : sessionLabel;
      label.textContent = truncatedSnippet;

      row.appendChild(label);
      item.appendChild(row);

      const meta = document.createElement('div');
      meta.className = 'agent-sidebar-session-item-meta agent-sidebar-session-item-meta-all';

      // Show agent name for context
      const agentLabel = document.createElement('span');
      agentLabel.className = 'agent-sidebar-session-agent-label';
      agentLabel.textContent = agent ? agent.displayName : agentId ? agentId : 'Unknown';
      meta.appendChild(agentLabel);

      const timeEl = document.createElement('span');
      const date = new Date(session.updatedAt);
      timeEl.textContent = date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
      meta.appendChild(timeEl);

      const typingIndicator = document.createElement('span');
      typingIndicator.className = 'session-typing-indicator';
      typingIndicator.dataset['sessionId'] = session.sessionId;
      typingIndicator.innerHTML =
        '<span class="typing-indicator"><span></span><span></span><span></span></span>';
      if (this.options.sessionsWithPendingMessages.has(session.sessionId)) {
        typingIndicator.classList.add('has-pending');
      }
      if (this.options.sessionsWithActiveTyping.has(session.sessionId)) {
        typingIndicator.classList.add('visible');
        typingIndicator.classList.remove('has-pending');
      }
      meta.appendChild(typingIndicator);

      const activityIndicator = document.createElement('span');
      activityIndicator.className = 'session-activity-indicator hidden';
      activityIndicator.dataset['sessionId'] = session.sessionId;
      activityIndicator.textContent = '●';
      meta.appendChild(activityIndicator);

      item.appendChild(meta);
      listEl.appendChild(item);
    }

    section.appendChild(listEl);
    agentSidebarSections.appendChild(section);

    if (this.options.isSidebarFocused() && this.options.getFocusedSessionId()) {
      const sessionId = this.options.getFocusedSessionId();
      const itemToFocus = sessionId
        ? agentSidebarSections.querySelector(
            `.agent-sidebar-session-item[data-session-id="${sessionId}"]`,
          )
        : null;
      if (itemToFocus) {
        itemToFocus.classList.add('focused');
      }
    }
  }

  render(): void {
    const { agentSidebar, agentSidebarSections } = this.options;
    if (!agentSidebar || !agentSidebarSections) {
      return;
    }

    agentSidebarSections.innerHTML = '';

    if (this.viewMode === 'all-sessions') {
      this.renderAllSessionsView();
      if (typeof this.options.onRendered === 'function') {
        this.options.onRendered();
      }
      return;
    }

    const sessionsByAgent = new Map<string, SessionSummary[]>();
    for (const session of this.options.getSessionSummaries()) {
      if (typeof session.agentId !== 'string' || session.agentId.length === 0) {
        continue;
      }
      const list = sessionsByAgent.get(session.agentId) ?? [];
      list.push(session);
      sessionsByAgent.set(session.agentId, list);
    }

    const createSectionElement = (
      title: string,
      subtitle: string | undefined,
      sessions: SessionSummary[],
      agentId: string,
      agentType?: 'chat' | 'external',
    ): HTMLElement => {
      const section = document.createElement('section');
      section.className = 'agent-sidebar-section';
      if (agentId) {
        section.dataset['agentId'] = agentId;
      }
      if (agentType) {
        section.dataset['agentType'] = agentType;
      }

      const header = document.createElement('div');
      header.className = 'agent-sidebar-section-header';

      const headerMain = document.createElement('div');
      headerMain.className = 'agent-sidebar-section-header-main';

      const titleEl = document.createElement('div');
      titleEl.className = 'agent-sidebar-section-title';
      titleEl.textContent = title;
      headerMain.appendChild(titleEl);

      if (subtitle && subtitle.trim().length > 0) {
        const subtitleEl = document.createElement('div');
        subtitleEl.className = 'agent-sidebar-section-subtitle';
        subtitleEl.textContent = subtitle;
        headerMain.appendChild(subtitleEl);
      }

      header.appendChild(headerMain);

      const actions = document.createElement('div');
      actions.className = 'agent-sidebar-section-actions';

      const newSessionButton = document.createElement('button');
      newSessionButton.type = 'button';
      newSessionButton.className = 'agent-sidebar-new-session-button';
      newSessionButton.setAttribute('aria-label', `New session for ${title}`);
      newSessionButton.innerHTML = this.options.icons.plus;
      newSessionButton.addEventListener('click', (e) => {
        e.stopPropagation();
        void this.options.createSessionForAgent(agentId);
      });
      actions.appendChild(newSessionButton);

      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'agent-sidebar-section-toggle';
      toggleButton.setAttribute('aria-label', `Toggle ${title} sessions`);
      toggleButton.textContent = '▾';
      toggleButton.addEventListener('click', (e) => {
        e.stopPropagation();
        section.classList.toggle('collapsed');
      });
      actions.appendChild(toggleButton);

      header.appendChild(actions);

      header.addEventListener('click', () => {
        const sortedSessions = [...sessions].sort((a, b) => this.compareSessions(a, b));
        const firstSession = sortedSessions[0];
        if (firstSession) {
          this.options.selectSession(firstSession.sessionId);
        }
      });

      section.appendChild(header);

      const listEl = document.createElement('ul');
      listEl.className = 'agent-sidebar-session-list';

      const sessionsSorted = [...sessions].sort((a, b) => this.compareSessions(a, b));

      if (sessionsSorted.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'agent-sidebar-empty';
        empty.textContent = 'No sessions yet';
        section.appendChild(listEl);
        section.appendChild(empty);
        return section;
      }

      for (const session of sessionsSorted) {
        const item = document.createElement('li');
        item.className = 'agent-sidebar-session-item';
        item.dataset['sessionId'] = session.sessionId;

        if (session.sessionId === this.options.getSelectedSessionId()) {
          item.classList.add('active');
        }

        item.addEventListener('click', () => {
          // On mobile, close the sidebar and return early
          if (this.options.isMobileViewport()) {
            this.options.onSessionSelectedOnMobile();
            if (session.sessionId !== this.options.getSelectedSessionId()) {
              this.options.selectSession(session.sessionId);
            }
            return;
          }

          if (session.sessionId === this.options.getSelectedSessionId()) {
            console.log('[client] click on active session, entering sidebar focus mode');
            this.options.setFocusedSessionId(session.sessionId);
            this.options.setFocusedSessionItem(item);
            agentSidebar?.focus();
            return;
          }

          this.options.selectSession(session.sessionId);

          // Don't auto-focus input on mobile - it triggers the keyboard
          if (this.options.getAutoFocusChatOnSessionReady() && !this.options.isMobileViewport()) {
            setTimeout(() => {
              this.options.focusInput();
            }, 0);
          }
        });

        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          this.options.showSessionMenu(e.clientX, e.clientY, session.sessionId);
        });

        const row = document.createElement('div');
        row.className = 'agent-sidebar-session-row';

        const label = document.createElement('div');
        label.className = 'agent-sidebar-session-item-label';
        const sessionLabel = this.buildSessionLabel(session, title);
        const truncatedSnippet =
          sessionLabel.length > 60 ? `${sessionLabel.slice(0, 57)}…` : sessionLabel;
        label.textContent = truncatedSnippet;

        row.appendChild(label);
        item.appendChild(row);

        const meta = document.createElement('div');
        meta.className = 'agent-sidebar-session-item-meta';
        const date = new Date(session.updatedAt);
        const timeText = date.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
        });
        const timeEl = document.createElement('span');
        timeEl.textContent = timeText;
        meta.appendChild(timeEl);

        const typingIndicator = document.createElement('span');
        typingIndicator.className = 'session-typing-indicator';
        typingIndicator.dataset['sessionId'] = session.sessionId;
        typingIndicator.innerHTML =
          '<span class="typing-indicator"><span></span><span></span><span></span></span>';
        if (this.options.sessionsWithPendingMessages.has(session.sessionId)) {
          typingIndicator.classList.add('has-pending');
        }
        if (this.options.sessionsWithActiveTyping.has(session.sessionId)) {
          typingIndicator.classList.add('visible');
          typingIndicator.classList.remove('has-pending');
        }
        meta.appendChild(typingIndicator);

        const activityIndicator = document.createElement('span');
        activityIndicator.className = 'session-activity-indicator hidden';
        activityIndicator.dataset['sessionId'] = session.sessionId;
        activityIndicator.textContent = '●';
        meta.appendChild(activityIndicator);

        item.appendChild(meta);
        listEl.appendChild(item);
      }

      section.appendChild(listEl);
      return section;
    };

    const renderedAgentIds = new Set<string>();

    for (const agent of this.options.getAgentSummaries()) {
      const sessions = sessionsByAgent.get(agent.agentId) ?? [];
      const section = createSectionElement(
        agent.displayName,
        agent.description,
        sessions,
        agent.agentId,
        agent.type,
      );
      agentSidebarSections.appendChild(section);
      renderedAgentIds.add(agent.agentId);
    }

    for (const [agentId, sessions] of sessionsByAgent) {
      if (renderedAgentIds.has(agentId)) {
        continue;
      }
      const fallbackTitle = `Agent ${agentId}`;
      const section = createSectionElement(fallbackTitle, undefined, sessions, agentId);
      agentSidebarSections.appendChild(section);
      renderedAgentIds.add(agentId);
    }

    // Ad-hoc sessions are no longer supported.

    if (this.options.isSidebarFocused() && this.options.getFocusedSessionId()) {
      const sessionId = this.options.getFocusedSessionId();
      const itemToFocus = sessionId
        ? agentSidebarSections.querySelector(
            `.agent-sidebar-session-item[data-session-id="${sessionId}"]`,
          )
        : null;
      if (itemToFocus) {
        itemToFocus.classList.add('focused');
      }
    }

    if (typeof this.options.onRendered === 'function') {
      this.options.onRendered();
    }
  }
}
