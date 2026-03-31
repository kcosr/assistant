// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSidebarController } from './agentSidebarController';
import { ContextMenuManager } from './contextMenu';

describe('AgentSidebarController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('renders context usage in the session metadata row when known', () => {
    const agentSidebar = document.createElement('div');
    const sections = document.createElement('div');
    agentSidebar.appendChild(sections);

    const controller = new AgentSidebarController({
      agentSidebar,
      agentSidebarSections: sections,
      viewModeToggle: null,
      icons: { plus: '+' },
      getSessionSummaries: () => [
        {
          sessionId: 'session-1',
          agentId: 'assistant',
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T03:00:00.000Z',
          name: 'Morning Session',
          contextUsage: {
            availablePercent: 73,
            contextWindow: 200000,
            usage: {
              input: 12000,
              output: 1800,
              cacheRead: 35000,
              cacheWrite: 5200,
              totalTokens: 54000,
            },
          },
        },
      ],
      getAgentSummaries: () => [{ agentId: 'assistant', displayName: 'Assistant' }],
      getSelectedSessionId: () => null,
      sessionsWithPendingMessages: new Set(),
      sessionsWithActiveTyping: new Set(),
      getFocusedSessionId: () => null,
      setFocusedSessionId: vi.fn(),
      setFocusedSessionItem: vi.fn(),
      isSidebarFocused: () => false,
      selectSession: vi.fn(),
      openSessionComposer: vi.fn(),
      showSessionMenu: vi.fn(),
      focusInput: vi.fn(),
      getAutoFocusChatOnSessionReady: () => false,
      isMobileViewport: () => false,
      onSessionSelectedOnMobile: vi.fn(),
    });

    controller.render();

    const usage = sections.querySelector('.agent-sidebar-session-context-usage');
    expect(usage?.textContent).toBe('73%');
  });

  it('opens the session menu on desktop right click', () => {
    const agentSidebar = document.createElement('div');
    const sections = document.createElement('div');
    agentSidebar.appendChild(sections);
    const showSessionMenu = vi.fn();

    const controller = new AgentSidebarController({
      agentSidebar,
      agentSidebarSections: sections,
      viewModeToggle: null,
      icons: { plus: '+' },
      getSessionSummaries: () => [
        {
          sessionId: 'session-1',
          agentId: 'assistant',
          createdAt: '2026-03-29T00:00:00.000Z',
          updatedAt: '2026-03-29T03:00:00.000Z',
          name: 'Morning Session',
        },
      ],
      getAgentSummaries: () => [{ agentId: 'assistant', displayName: 'Assistant' }],
      getSelectedSessionId: () => null,
      sessionsWithPendingMessages: new Set(),
      sessionsWithActiveTyping: new Set(),
      getFocusedSessionId: () => null,
      setFocusedSessionId: vi.fn(),
      setFocusedSessionItem: vi.fn(),
      isSidebarFocused: () => false,
      selectSession: vi.fn(),
      openSessionComposer: vi.fn(),
      showSessionMenu,
      focusInput: vi.fn(),
      getAutoFocusChatOnSessionReady: () => false,
      isMobileViewport: () => false,
      onSessionSelectedOnMobile: vi.fn(),
    });

    controller.render();

    const item = sections.querySelector<HTMLElement>('.agent-sidebar-session-item');
    expect(item).not.toBeNull();

    item?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 23, clientY: 41 }),
    );

    expect(showSessionMenu).toHaveBeenCalledWith(23, 41, 'session-1');
  });

  it('opens the session menu on mobile long press without selecting the session', () => {
    vi.useFakeTimers();
    try {
      const agentSidebar = document.createElement('div');
      const sections = document.createElement('div');
      agentSidebar.appendChild(sections);
      const showSessionMenu = vi.fn();
      const selectSession = vi.fn();
      const onSessionSelectedOnMobile = vi.fn();

      const controller = new AgentSidebarController({
        agentSidebar,
        agentSidebarSections: sections,
        viewModeToggle: null,
        icons: { plus: '+' },
        getSessionSummaries: () => [
          {
            sessionId: 'session-1',
            agentId: 'assistant',
            createdAt: '2026-03-29T00:00:00.000Z',
            updatedAt: '2026-03-29T03:00:00.000Z',
            name: 'Morning Session',
          },
        ],
        getAgentSummaries: () => [{ agentId: 'assistant', displayName: 'Assistant' }],
        getSelectedSessionId: () => null,
        sessionsWithPendingMessages: new Set(),
        sessionsWithActiveTyping: new Set(),
        getFocusedSessionId: () => null,
        setFocusedSessionId: vi.fn(),
        setFocusedSessionItem: vi.fn(),
        isSidebarFocused: () => false,
        selectSession,
        openSessionComposer: vi.fn(),
        showSessionMenu,
        focusInput: vi.fn(),
        getAutoFocusChatOnSessionReady: () => false,
        isMobileViewport: () => true,
        onSessionSelectedOnMobile,
      });

      controller.render();

      const item = sections.querySelector<HTMLElement>('.agent-sidebar-session-item');
      expect(item).not.toBeNull();
      if (!item) {
        throw new Error('expected session item');
      }
      item.getBoundingClientRect = () =>
        ({
          left: 10,
          top: 20,
          right: 110,
          bottom: 60,
          width: 100,
          height: 40,
          x: 10,
          y: 20,
          toJSON: () => ({}),
        }) as DOMRect;

      const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperties(pointerDown, {
        pointerType: { value: 'touch' },
        button: { value: 0 },
        clientX: { value: 32 },
        clientY: { value: 44 },
      });
      item.dispatchEvent(pointerDown);

      vi.advanceTimersByTime(500);

      expect(showSessionMenu).toHaveBeenCalledWith(60, 52, 'session-1');

      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

      expect(selectSession).not.toHaveBeenCalled();
      expect(onSessionSelectedOnMobile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the session menu open when mobile long press triggers a trailing contextmenu event', () => {
    vi.useFakeTimers();
    try {
      const agentSidebar = document.createElement('div');
      const sections = document.createElement('div');
      agentSidebar.appendChild(sections);
      document.body.appendChild(agentSidebar);

      const contextMenuManager = new ContextMenuManager({
        isSessionPinned: () => false,
        pinSession: vi.fn(),
        clearHistory: vi.fn(),
        deleteSession: vi.fn(),
        renameSession: vi.fn(),
      });

      const controller = new AgentSidebarController({
        agentSidebar,
        agentSidebarSections: sections,
        viewModeToggle: null,
        icons: { plus: '+' },
        getSessionSummaries: () => [
          {
            sessionId: 'session-1',
            agentId: 'assistant',
            createdAt: '2026-03-29T00:00:00.000Z',
            updatedAt: '2026-03-29T03:00:00.000Z',
            name: 'Morning Session',
          },
        ],
        getAgentSummaries: () => [{ agentId: 'assistant', displayName: 'Assistant' }],
        getSelectedSessionId: () => null,
        sessionsWithPendingMessages: new Set(),
        sessionsWithActiveTyping: new Set(),
        getFocusedSessionId: () => null,
        setFocusedSessionId: vi.fn(),
        setFocusedSessionItem: vi.fn(),
        isSidebarFocused: () => false,
        selectSession: vi.fn(),
        openSessionComposer: vi.fn(),
        showSessionMenu: (x, y, sessionId) => {
          contextMenuManager.showSessionMenu(x, y, sessionId);
        },
        focusInput: vi.fn(),
        getAutoFocusChatOnSessionReady: () => false,
        isMobileViewport: () => true,
        onSessionSelectedOnMobile: vi.fn(),
      });

      controller.render();

      const item = sections.querySelector<HTMLElement>('.agent-sidebar-session-item');
      expect(item).not.toBeNull();
      if (!item) {
        throw new Error('expected session item');
      }
      item.getBoundingClientRect = () =>
        ({
          left: 10,
          top: 20,
          right: 110,
          bottom: 60,
          width: 100,
          height: 40,
          x: 10,
          y: 20,
          toJSON: () => ({}),
        }) as DOMRect;

      const pointerDown = new Event('pointerdown', { bubbles: true, cancelable: true });
      Object.defineProperties(pointerDown, {
        pointerType: { value: 'touch' },
        button: { value: 0 },
        clientX: { value: 32 },
        clientY: { value: 44 },
      });
      item.dispatchEvent(pointerDown);

      vi.advanceTimersByTime(500);

      expect(document.querySelector('.context-menu')).not.toBeNull();

      item.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 32,
          clientY: 44,
        }),
      );

      expect(document.querySelector('.context-menu')).not.toBeNull();
    } finally {
      vi.useRealTimers();
      document.querySelector('.context-menu')?.remove();
    }
  });
});
