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

  it('invokes rename from the session row action button', () => {
    const onRenameSession = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [{ sessionId: 's1', name: 'Session 1' }],
      getAgentSummaries: () => [],
      createSessionForAgent: async () => null,
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    controller.open({
      anchor,
      title: 'Sessions',
      onSelectSession: () => undefined,
      onRenameSession: (sessionId) => onRenameSession(sessionId),
    });

    const renameBtn = document.querySelector<HTMLButtonElement>(
      '.session-picker-item[data-session-id="s1"] .session-picker-rename-btn',
    );
    expect(renameBtn).toBeTruthy();
    renameBtn?.click();

    expect(onRenameSession).toHaveBeenCalledWith('s1');
    expect(document.querySelector('.session-picker-popover')).toBeNull();

    controller.close();
  });

  it('invokes clear from the session row action button', () => {
    const onClearSession = vi.fn();
    const controller = new SessionPickerController({
      getSessionSummaries: () => [{ sessionId: 's1', name: 'Session 1' }],
      getAgentSummaries: () => [],
      createSessionForAgent: async () => null,
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
      createSessionForAgent: async () => null,
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
});

