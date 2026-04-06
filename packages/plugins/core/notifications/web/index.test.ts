// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelHost, PanelModule } from '../../../../web-client/src/controllers/panelRegistry';

describe('notifications panel', () => {
  let panelFactory: (() => PanelModule) | null = null;

  function createHost(overrides: Partial<PanelHost> = {}): PanelHost {
    let persistedState: unknown = null;
    return {
      panelId: () => 'notif-panel-1',
      getBinding: () => null,
      setBinding: () => undefined,
      onBindingChange: () => () => undefined,
      setContext: () => undefined,
      getContext: () => null,
      subscribeContext: () => () => undefined,
      sendEvent: vi.fn(),
      getSessionContext: () => null,
      subscribeSessionContext: () => () => undefined,
      updateSessionAttributes: async () => undefined,
      setPanelMetadata: vi.fn(),
      persistPanelState: (state) => {
        persistedState = state;
      },
      loadPanelState: () => persistedState,
      openPanel: vi.fn(() => null),
      closePanel: () => undefined,
      activatePanel: vi.fn(),
      movePanel: () => undefined,
      ...overrides,
    };
  }

  function makeNotification(overrides: Record<string, unknown> = {}) {
    return {
      id: `n-${Math.random().toString(36).slice(2)}`,
      title: 'Test Notification',
      body: 'Test body',
      createdAt: new Date().toISOString(),
      readAt: null,
      source: 'tool',
      sessionId: null,
      sessionTitle: null,
      tts: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    panelFactory = null;
    (window as any).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (_panelType: string, factory: () => PanelModule) => {
        panelFactory = factory;
      },
    };
    vi.resetModules();
    await import('./index');
  });

  it('registers the panel and mounts', async () => {
    expect(panelFactory).not.toBeNull();
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    expect(container.querySelector('.notif-body')).not.toBeNull();
    expect(container.querySelector('.notif-empty')).not.toBeNull();

    // Should have sent request_snapshot on mount
    expect(host.sendEvent).toHaveBeenCalledWith({ type: 'request_snapshot' });

    handle.unmount();
  });

  it('renders notifications from a snapshot event', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({ id: 'n1', title: 'First' }),
          makeNotification({ id: 'n2', title: 'Second', readAt: '2024-01-01' }),
        ],
      },
    } as any);

    const items = container.querySelectorAll('.notif-item');
    expect(items.length).toBe(2);

    // First item is unread
    expect(items[0]?.classList.contains('notif-item-read')).toBe(false);
    expect(items[0]?.querySelector('.notif-unread-dot')).not.toBeNull();

    // Second item is read
    expect(items[1]?.classList.contains('notif-item-read')).toBe(true);
    expect(items[1]?.querySelector('.notif-unread-dot')).toBeNull();

    handle.unmount();
  });

  it('adds new notification on created event', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [makeNotification({ title: 'Existing' })],
      },
    } as any);

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'created',
        notification: makeNotification({ title: 'New One' }),
      },
    } as any);

    const items = container.querySelectorAll('.notif-item');
    expect(items.length).toBe(2);
    // New notification should be first (newest first)
    expect(items[0]?.querySelector('.notif-title')?.textContent).toBe('New One');

    handle.unmount();
  });

  it('removes notification on removed event', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({ id: 'keep', title: 'Keep' }),
          makeNotification({ id: 'remove', title: 'Remove' }),
        ],
      },
    } as any);

    handle.onEvent!({
      payload: { type: 'notification_update', event: 'removed', id: 'remove' },
    } as any);

    const items = container.querySelectorAll('.notif-item');
    expect(items.length).toBe(1);
    expect(items[0]?.querySelector('.notif-title')?.textContent).toBe('Keep');

    handle.unmount();
  });

  it('sends toggle_read on item click', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [makeNotification({ id: 'n1' })],
      },
    } as any);

    const item = container.querySelector('.notif-item');
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(host.sendEvent).toHaveBeenCalledWith({ type: 'toggle_read', id: 'n1' });

    handle.unmount();
  });

  it('toggles filter between all and unread', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({ id: 'n1', title: 'Unread' }),
          makeNotification({ id: 'n2', title: 'Read', readAt: '2024-01-01' }),
        ],
      },
    } as any);

    // Initially shows all
    expect(container.querySelectorAll('.notif-item').length).toBe(2);

    // Click filter button to switch to unread
    const filterBtn = container.querySelector('.notif-toggle-btn') as HTMLElement;
    filterBtn.click();

    expect(container.querySelectorAll('.notif-item').length).toBe(1);
    expect(
      container.querySelector('.notif-item .notif-title')?.textContent,
    ).toBe('Unread');

    handle.unmount();
  });

  it('updates panel badge with unread count', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({ readAt: null }),
          makeNotification({ readAt: null }),
          makeNotification({ readAt: '2024-01-01' }),
        ],
      },
    } as any);

    expect(host.setPanelMetadata).toHaveBeenCalledWith({ badge: '2' });

    handle.unmount();
  });

  it('shows session link for session-linked notifications', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({
            sessionId: 'sess-1',
            sessionTitle: 'My Session',
          }),
        ],
      },
    } as any);

    const sessionLink = container.querySelector('.notif-session-link');
    expect(sessionLink).not.toBeNull();
    expect(sessionLink?.textContent).toContain('My Session');

    handle.unmount();
  });

  it('opens session via openPanel when session link is clicked', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({ sessionId: 'sess-1', sessionTitle: 'My Session' }),
        ],
      },
    } as any);

    const sessionLink = container.querySelector('.notif-session-link') as HTMLElement;
    sessionLink.click();

    expect(host.openPanel).toHaveBeenCalledWith(
      'chat',
      expect.objectContaining({
        binding: { mode: 'fixed', sessionId: 'sess-1' },
        focus: true,
      }),
    );

    handle.unmount();
  });

  it('shows empty state when no notifications', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: { event: 'snapshot', notifications: [] },
    } as any);

    const emptyEl = container.querySelector('.notif-empty') as HTMLElement;
    expect(emptyEl.style.display).not.toBe('none');

    const listEl = container.querySelector('.notif-list') as HTMLElement;
    expect(listEl.style.display).toBe('none');

    handle.unmount();
  });

  it('sends mark_all_read when overflow menu item is clicked', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    // Open overflow menu
    const menuBtn = container.querySelector('.notif-menu-btn') as HTMLElement;
    menuBtn.dispatchEvent(new MouseEvent('click', { bubbles: false }));

    const dropdown = container.querySelector('.notif-menu-dropdown') as HTMLElement;
    expect(dropdown.style.display).not.toBe('none');

    // Click mark all read
    const markAllBtn = dropdown.querySelector('.notif-menu-item') as HTMLElement;
    markAllBtn.click();

    expect(host.sendEvent).toHaveBeenCalledWith({ type: 'mark_all_read' });

    handle.unmount();
  });
});
