// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSidebarController } from './agentSidebarController';

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
});
