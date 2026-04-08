// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionPickerController } from './panelSessionPicker';

describe('SessionPickerController', () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    document.body.innerHTML = '';
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    window.matchMedia = originalMatchMedia;
    document.body.innerHTML = '';
  });

  it('invokes edit from the session row action button', () => {
    const onEditSession = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [{ sessionId: 's1', name: 'Session 1' }],
      getAgentSummaries: () => [],
      openSessionComposer: vi.fn(),
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    controller.open({
      anchor,
      title: 'Sessions',
      onSelectSession: () => undefined,
      onEditSession: (sessionId) => onEditSession(sessionId),
    });

    const renameBtn = document.querySelector<HTMLButtonElement>(
      '.session-picker-item[data-session-id="s1"] .session-picker-rename-btn',
    );
    expect(renameBtn).toBeTruthy();
    renameBtn?.click();

    expect(onEditSession).toHaveBeenCalledWith('s1');
    expect(document.querySelector('.session-picker-popover')).toBeNull();

    controller.close();
  });

  it('can open without autofocus for the voice-chip session picker flow', async () => {
    const controller = new SessionPickerController({
      getSessionSummaries: () => [{ sessionId: 's1', name: 'Session 1' }],
      getAgentSummaries: () => [],
      openSessionComposer: vi.fn(),
    });

    const anchor = document.createElement('button');
    anchor.textContent = 'open';
    document.body.appendChild(anchor);
    anchor.focus();

    controller.open({
      anchor,
      title: 'Select voice session',
      autoFocusSearch: false,
      onSelectSession: () => undefined,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const searchInput = document.querySelector<HTMLInputElement>('.session-picker-search');
    expect(searchInput).toBeTruthy();
    expect(document.activeElement).toBe(anchor);

    controller.close();
  });

  it('invokes clear from the session row action button', () => {
    const onClearSession = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [{ sessionId: 's1', name: 'Session 1' }],
      getAgentSummaries: () => [],
      openSessionComposer: vi.fn(),
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    controller.open({
      anchor,
      title: 'Sessions',
      onSelectSession: () => undefined,
      onClearSession: (sessionId) => onClearSession(sessionId),
    });

    const clearBtn = document.querySelector<HTMLButtonElement>(
      '.session-picker-item[data-session-id="s1"] .session-picker-clear-btn',
    );
    expect(clearBtn).toBeTruthy();
    clearBtn?.click();

    expect(onClearSession).toHaveBeenCalledWith('s1');
    expect(document.querySelector('.session-picker-popover')).toBeNull();

    controller.close();
  });

  it('shows a touch submenu that can initiate delete confirmation', () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const onDeleteSession = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [{ sessionId: 's1', name: 'Session 1' }],
      getAgentSummaries: () => [],
      openSessionComposer: vi.fn(),
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    controller.open({
      anchor,
      title: 'Sessions',
      onSelectSession: () => undefined,
      onDeleteSession: (sessionId) => onDeleteSession(sessionId),
    });

    const moreBtn = document.querySelector<HTMLButtonElement>(
      '.session-picker-item[data-session-id="s1"] .session-picker-more-btn',
    );
    expect(moreBtn).toBeTruthy();
    moreBtn?.click();

    const submenuDelete = document.querySelector<HTMLButtonElement>(
      '.session-picker-submenu .session-picker-submenu-item.danger',
    );
    expect(submenuDelete).toBeTruthy();
    submenuDelete?.click();

    const sessionRow = document.querySelector<HTMLElement>(
      '.session-picker-item[data-session-id="s1"]',
    );
    expect(sessionRow?.classList.contains('confirming')).toBe(true);

    const confirmBtn = document.querySelector<HTMLButtonElement>(
      '.session-picker-item[data-session-id="s1"] .session-picker-confirm-btn',
    );
    expect(confirmBtn).toBeTruthy();
    confirmBtn?.click();

    expect(onDeleteSession).toHaveBeenCalledWith('s1');
    expect(document.querySelector('.session-picker-popover')).toBeNull();

    controller.close();
  });

  it('opens the composer for prompt-working-dir agents', async () => {
    const openSessionComposer = vi.fn();
    const onSelectSession = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [],
      getAgentSummaries: () => [
        {
          agentId: 'general',
          displayName: 'General',
          sessionWorkingDir: {
            mode: 'prompt',
            roots: ['/workspaces'],
          },
        },
      ],
      openSessionComposer,
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    controller.open({
      anchor,
      title: 'Sessions',
      onSelectSession,
    });

    const agentItem = document.querySelector<HTMLDivElement>('.session-picker-item');
    expect(agentItem).toBeTruthy();
    agentItem?.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openSessionComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialAgentId: 'general',
        initialMode: 'session',
        onSessionCreated: expect.any(Function),
      }),
    );

    const callback = openSessionComposer.mock.calls[0]?.[0]?.onSessionCreated as
      | ((sessionId: string) => void)
      | undefined;
    callback?.('new-session');
    expect(onSelectSession).toHaveBeenCalledWith('new-session');

    controller.close();
  });

  it('opens the composer for fixed-working-dir agents', async () => {
    const openSessionComposer = vi.fn();
    const onSelectSession = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [],
      getAgentSummaries: () => [
        {
          agentId: 'assistant',
          displayName: 'Assistant',
          sessionWorkingDir: {
            mode: 'fixed',
            path: '/home/kevin/assistant',
          },
        },
      ],
      openSessionComposer,
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    controller.open({
      anchor,
      title: 'Sessions',
      onSelectSession,
    });

    const agentItem = document.querySelector<HTMLDivElement>('.session-picker-item');
    expect(agentItem).toBeTruthy();
    agentItem?.click();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openSessionComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialAgentId: 'assistant',
        initialMode: 'session',
        onSessionCreated: expect.any(Function),
      }),
    );
    const callback = openSessionComposer.mock.calls[0]?.[0]?.onSessionCreated as
      | ((sessionId: string) => void)
      | undefined;
    callback?.('new-session');
    expect(onSelectSession).toHaveBeenCalledWith('new-session');

    controller.close();
  });

  it('forwards createSessionOptions into the composer open request', async () => {
    const openSessionComposer = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [],
      getAgentSummaries: () => [
        {
          agentId: 'general',
          displayName: 'General',
          sessionWorkingDir: {
            mode: 'prompt',
            roots: ['/workspaces'],
          },
        },
      ],
      openSessionComposer,
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    controller.open({
      anchor,
      title: 'Sessions',
      onSelectSession: () => undefined,
      createSessionOptions: {
        sessionConfig: {
          model: 'gpt-5.4',
        },
      },
    });

    document.querySelector<HTMLDivElement>('.session-picker-item')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(openSessionComposer).toHaveBeenCalledWith(
      expect.objectContaining({
        initialAgentId: 'general',
        createSessionOptions: {
          sessionConfig: {
            model: 'gpt-5.4',
          },
        },
      }),
    );

    controller.close();
  });
});
