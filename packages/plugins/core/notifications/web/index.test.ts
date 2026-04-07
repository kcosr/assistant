// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelHost, PanelModule } from '../../../../web-client/src/controllers/panelRegistry';

describe('notifications panel', () => {
  let panelFactory: (() => PanelModule) | null = null;

  function createHost(overrides: Partial<PanelHost> = {}): PanelHost {
    let persistedState: unknown = null;
    return {
      panelId: () => 'notif-panel-1',
      getBinding: () => null,
      setBinding: vi.fn(),
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
      kind: 'notification',
      title: 'Test Notification',
      body: 'Test body',
      createdAt: new Date().toISOString(),
      readAt: null,
      source: 'tool',
      sessionId: null,
      sessionTitle: null,
      tts: false,
      voiceMode: 'none',
      ttsText: null,
      sourceEventId: null,
      sessionActivitySeq: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    panelFactory = null;
    delete (window as any).AssistantNativeVoice;
    delete (window as any).Capacitor;
    (window as any).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (_panelType: string, factory: () => PanelModule) => {
        panelFactory = factory;
      },
    };
    vi.resetModules();
    await import('./index');
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('retries request_snapshot until the first snapshot arrives', async () => {
    vi.useFakeTimers();
    expect(panelFactory).not.toBeNull();
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    expect(host.sendEvent).toHaveBeenCalledTimes(1);
    expect(host.sendEvent).toHaveBeenLastCalledWith({ type: 'request_snapshot' });

    await vi.advanceTimersByTimeAsync(3000);

    expect(host.sendEvent).toHaveBeenCalledTimes(4);
    expect(host.sendEvent).toHaveBeenLastCalledWith({ type: 'request_snapshot' });

    handle.unmount();
  });

  it('stops retrying request_snapshot after the first snapshot arrives', async () => {
    vi.useFakeTimers();
    expect(panelFactory).not.toBeNull();
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [],
      },
    } as any);

    await vi.advanceTimersByTimeAsync(5000);

    expect(host.sendEvent).toHaveBeenCalledTimes(1);
    expect(host.sendEvent).toHaveBeenLastCalledWith({ type: 'request_snapshot' });

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

  it('updates an existing notification in place on updated events', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [makeNotification({ id: 'n1', title: 'Old title', readAt: null })],
      },
    } as any);

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'updated',
        notification: makeNotification({
          id: 'n1',
          title: 'Updated title',
          readAt: '2024-01-01T00:00:00.000Z',
        }),
      },
    } as any);

    const items = container.querySelectorAll('.notif-item');
    expect(items.length).toBe(1);
    expect(items[0]?.querySelector('.notif-title')?.textContent).toBe('Updated title');
    expect(items[0]?.classList.contains('notif-item-read')).toBe(true);

    handle.unmount();
  });

  it('falls back to sessionId for session attention rows until a real session label is available', async () => {
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
            id: 'attention-1',
            kind: 'session_attention',
            sessionId: 'sess-1',
            title: 'Latest 1',
          }),
        ],
      },
    } as any);

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'upserted',
        notification: makeNotification({
          id: 'attention-1',
          kind: 'session_attention',
          sessionId: 'sess-1',
          title: 'Latest 2',
        }),
      },
    } as any);

    const items = container.querySelectorAll('.notif-item');
    expect(items.length).toBe(1);
    expect(items[0]?.querySelector('.notif-title')?.textContent).toBe('sess-1');
    expect(items[0]?.querySelector('.notif-kind-badge')).toBeNull();

    handle.unmount();
  });

  it('uses the session title as the card title for session attention rows', async () => {
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
            id: 'attention-1',
            kind: 'session_attention',
            title: 'Latest assistant reply text',
            body: 'Latest assistant reply text',
            sessionId: 'sess-1',
            sessionTitle: 'Project Alpha',
          }),
        ],
      },
    } as any);

    expect(container.querySelector('.notif-title')?.textContent).toBe('Project Alpha');
    expect(container.querySelector('.notif-body-text')?.textContent).toBe(
      'Latest assistant reply text',
    );
    expect(container.querySelector('.notif-kind-badge')).toBeNull();
    expect(
      container.querySelector('.notif-source-icon svg path')?.getAttribute('d'),
    ).toContain('M5.45 5.11');

    handle.unmount();
  });

  it('prefers the live client session label for session attention rows', async () => {
    const module = panelFactory!();
    const host = createHost({
      getContext: (key: string) => {
        if (key === 'session.summaries') {
          return [
            {
              sessionId: 'sess-1',
              name: 'Client Session Title',
              attributes: { core: { autoTitle: 'Ignored Auto Title' } },
            },
          ];
        }
        if (key === 'agent.summaries') {
          return [];
        }
        return null;
      },
    });
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({
            id: 'attention-1',
            kind: 'session_attention',
            title: 'Latest assistant reply',
            body: 'Latest assistant reply text',
            sessionId: 'sess-1',
            sessionTitle: null,
          }),
        ],
      },
    } as any);

    expect(container.querySelector('.notif-title')?.textContent).toBe('Client Session Title');
    expect(container.querySelector('.notif-session-link')).toBeNull();

    handle.unmount();
  });

  it('falls back to the same agent-based session label path as the chat tab', async () => {
    const module = panelFactory!();
    const host = createHost({
      getContext: (key: string) => {
        if (key === 'session.summaries') {
          return [
            {
              sessionId: 'sess-1',
              agentId: 'voice_assistant',
            },
          ];
        }
        if (key === 'agent.summaries') {
          return [{ agentId: 'voice_assistant', displayName: 'Voice Assistant' }];
        }
        return null;
      },
    });
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({
            id: 'attention-1',
            kind: 'session_attention',
            title: 'Latest assistant reply',
            body: 'Latest assistant reply text',
            sessionId: 'sess-1',
            sessionTitle: null,
          }),
        ],
      },
    } as any);

    expect(container.querySelector('.notif-title')?.textContent).toBe('Voice Assistant');
    expect(container.querySelector('.notif-session-link')).toBeNull();

    handle.unmount();
  });

  it('rerenders session attention rows when session summaries change', async () => {
    const module = panelFactory!();
    let sessionSummaries: Array<Record<string, unknown>> = [
      {
        sessionId: 'sess-1',
        name: 'Initial Title',
      },
    ];
    let sessionSummariesHandler: ((value: unknown) => void) | null = null;
    const host = createHost({
      getContext: (key: string) => {
        if (key === 'session.summaries') {
          return sessionSummaries;
        }
        if (key === 'agent.summaries') {
          return [];
        }
        return null;
      },
      subscribeContext: (key: string, handler: (value: unknown) => void) => {
        if (key === 'session.summaries') {
          sessionSummariesHandler = handler;
        }
        return () => {
          if (key === 'session.summaries') {
            sessionSummariesHandler = null;
          }
        };
      },
    });
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({
            id: 'attention-1',
            kind: 'session_attention',
            title: 'Latest assistant reply',
            body: 'Latest assistant reply text',
            sessionId: 'sess-1',
            sessionTitle: null,
          }),
        ],
      },
    } as any);

    expect(container.querySelector('.notif-title')?.textContent).toBe('Initial Title');

    sessionSummaries = [
      {
        sessionId: 'sess-1',
        name: 'Updated Title',
      },
    ];
    sessionSummariesHandler?.(sessionSummaries);

    expect(container.querySelector('.notif-title')?.textContent).toBe('Updated Title');

    handle.unmount();
  });

  it('rerenders session attention rows when agent summaries change', async () => {
    const module = panelFactory!();
    let agentSummaries: Array<Record<string, unknown>> = [
      { agentId: 'voice_assistant', displayName: 'Voice Assistant' },
    ];
    let agentSummariesHandler: ((value: unknown) => void) | null = null;
    const host = createHost({
      getContext: (key: string) => {
        if (key === 'session.summaries') {
          return [{ sessionId: 'sess-1', agentId: 'voice_assistant' }];
        }
        if (key === 'agent.summaries') {
          return agentSummaries;
        }
        return null;
      },
      subscribeContext: (key: string, handler: (value: unknown) => void) => {
        if (key === 'agent.summaries') {
          agentSummariesHandler = handler;
        }
        return () => {
          if (key === 'agent.summaries') {
            agentSummariesHandler = null;
          }
        };
      },
    });
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({
            id: 'attention-1',
            kind: 'session_attention',
            title: 'Latest assistant reply',
            body: 'Latest assistant reply text',
            sessionId: 'sess-1',
            sessionTitle: null,
          }),
        ],
      },
    } as any);

    expect(container.querySelector('.notif-title')?.textContent).toBe('Voice Assistant');

    agentSummaries = [{ agentId: 'voice_assistant', displayName: 'Renamed Assistant' }];
    agentSummariesHandler?.(agentSummaries);

    expect(container.querySelector('.notif-title')?.textContent).toBe('Renamed Assistant');

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

  it('opens the linked session on item click instead of toggling read state', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [makeNotification({ id: 'n1', sessionId: 'sess-1', sessionTitle: 'My Session' })],
      },
    } as any);

    const item = container.querySelector('.notif-item');
    item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(host.openPanel).toHaveBeenCalledWith(
      'chat',
      expect.objectContaining({
        binding: { mode: 'fixed', sessionId: 'sess-1' },
        focus: true,
      }),
    );
    expect(host.sendEvent).not.toHaveBeenCalledWith({ type: 'toggle_read', id: 'n1' });

    handle.unmount();
  });

  it('sends clear when dismiss button is clicked', async () => {
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

    const dismissBtn = container.querySelector('.notif-dismiss-btn') as HTMLElement;
    dismissBtn.click();

    expect(host.sendEvent).toHaveBeenCalledWith({ type: 'clear', id: 'n1' });
    expect(host.sendEvent).not.toHaveBeenCalledWith({ type: 'toggle_read', id: 'n1' });

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

  it('does not render a separate session link row for session-linked notifications', async () => {
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

    expect(container.querySelector('.notif-session-link')).toBeNull();

    handle.unmount();
  });

  it('renders Android-native Play and Speak actions for voice-capable notifications', async () => {
    const performNotificationSpeaker = vi.fn();
    const performNotificationMic = vi.fn();
    (window as any).AssistantNativeVoice = {
      performNotificationSpeaker,
      performNotificationMic,
    };
    (window as any).Capacitor = {
      getPlatform: () => 'android',
    };

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
            id: 'n1',
            sessionId: 'sess-1',
            sessionTitle: 'Session 1',
            tts: true,
            voiceMode: 'speak_then_listen',
            ttsText: 'Speak me',
          }),
        ],
      },
    } as any);

    const actionButtons = container.querySelectorAll('.notif-action-btn');
    expect(actionButtons).toHaveLength(2);
    expect(actionButtons[0]?.textContent).toContain('Play');
    expect(actionButtons[1]?.textContent).toContain('Speak');

    (actionButtons[0] as HTMLElement).click();
    (actionButtons[1] as HTMLElement).click();

    expect(performNotificationSpeaker).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({ id: 'n1' }),
      }),
    );
    expect(performNotificationMic).toHaveBeenCalledWith(
      expect.objectContaining({
        notification: expect.objectContaining({ id: 'n1' }),
      }),
    );
    expect(host.sendEvent).not.toHaveBeenCalledWith({ type: 'toggle_read', id: 'n1' });

    handle.unmount();
  });

  it('renders compact-row Speaker and Mic icon buttons without the small tts glyph', async () => {
    const performNotificationSpeaker = vi.fn();
    const performNotificationMic = vi.fn();
    (window as any).AssistantNativeVoice = {
      performNotificationSpeaker,
      performNotificationMic,
    };
    (window as any).Capacitor = {
      getPlatform: () => 'android',
    };

    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    const densityBtn = container.querySelectorAll('.notif-toggle-btn')[1] as HTMLElement;
    densityBtn.click();

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({
            id: 'n1',
            sessionId: 'sess-1',
            sessionTitle: 'Session 1',
            tts: true,
            voiceMode: 'speak_then_listen',
            ttsText: 'Speak me',
          }),
        ],
      },
    } as any);

    const compactButtons = container.querySelectorAll('.notif-action-btn-compact');
    expect(compactButtons).toHaveLength(2);
    expect(container.querySelector('.notif-tts-icon')).toBeNull();

    (compactButtons[0] as HTMLElement).click();
    (compactButtons[1] as HTMLElement).click();

    expect(performNotificationSpeaker).toHaveBeenCalledTimes(1);
    expect(performNotificationMic).toHaveBeenCalledTimes(1);

    handle.unmount();
  });

  it('does not render native voice actions when the Android bridge is unavailable', async () => {
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
            id: 'n1',
            sessionId: 'sess-1',
            tts: true,
            voiceMode: 'speak_then_listen',
            ttsText: 'Speak me',
          }),
        ],
      },
    } as any);

    expect(container.querySelector('.notif-action-btn')).toBeNull();

    handle.unmount();
  });

  it('collapses the header popover after opening a session from a header panel item tap', async () => {
    const module = panelFactory!();
    const closePanel = vi.fn();
    const dispatchEventSpy = vi.spyOn(document.body, 'dispatchEvent');
    const host = createHost({
      closePanel,
      getContext: (key: string) => {
        if (key !== 'panel.layout') {
          return null;
        }
        return {
          layout: { type: 'leaf', panelId: 'notif-panel-1' },
          panels: {
            'notif-panel-1': { panelType: 'notifications' },
          },
          headerPanels: ['notif-panel-1'],
          headerPanelSizes: {},
        };
      },
    });
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [makeNotification({ sessionId: 'sess-1', sessionTitle: 'My Session' })],
      },
    } as any);

    const item = container.querySelector('.notif-item') as HTMLElement;
    item.click();

    expect(host.openPanel).toHaveBeenCalled();
    expect(closePanel).not.toHaveBeenCalled();
    expect(dispatchEventSpy).toHaveBeenCalledWith(expect.any(MouseEvent));

    handle.unmount();
  });

  it('closes the notifications panel after opening a session from a modal panel item tap', async () => {
    const module = panelFactory!();
    const closePanel = vi.fn();
    const host = createHost({ closePanel });
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    const overlay = document.createElement('div');
    overlay.className = 'panel-modal-overlay open';
    const frame = document.createElement('div');
    frame.className = 'panel-frame panel-frame-modal';
    frame.dataset['panelId'] = 'notif-panel-1';
    overlay.appendChild(frame);
    document.body.appendChild(overlay);

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [makeNotification({ sessionId: 'sess-1', sessionTitle: 'My Session' })],
      },
    } as any);

    const item = container.querySelector('.notif-item') as HTMLElement;
    item.click();

    expect(host.openPanel).toHaveBeenCalled();
    expect(closePanel).toHaveBeenCalledWith('notif-panel-1');

    overlay.remove();
    handle.unmount();
  });

  it('activates an existing bound chat panel when the card is clicked', async () => {
    const module = panelFactory!();
    const host = createHost({
      getContext: (key: string) => {
        if (key !== 'panel.layout') {
          return null;
        }
        return {
          layout: { type: 'leaf', panelId: 'chat-1' },
          panels: {
            'chat-1': {
              panelType: 'chat',
              binding: { mode: 'fixed', sessionId: 'sess-1' },
            },
            'notifications-1': {
              panelType: 'notifications',
            },
          },
          headerPanels: [],
          headerPanelSizes: {},
        };
      },
    });
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        notifications: [
          makeNotification({ id: 'n1', sessionId: 'sess-1', sessionTitle: 'My Session' }),
        ],
      },
    } as any);

    const item = container.querySelector('.notif-item') as HTMLElement;
    item.click();

    expect(host.activatePanel).toHaveBeenCalledWith('chat-1');
    expect(host.openPanel).not.toHaveBeenCalled();
    expect(host.sendEvent).not.toHaveBeenCalledWith({ type: 'toggle_read', id: 'n1' });

    handle.unmount();
  });

  it('renders a disabled stop button when no native voice interaction is active', async () => {
    (window as any).AssistantNativeVoice = {
      getState: vi.fn().mockResolvedValue({ state: 'idle' }),
      addListener: vi.fn(() => ({ remove: vi.fn() })),
      stopCurrentInteraction: vi.fn(),
    };
    (window as any).Capacitor = {
      getPlatform: () => 'android',
    };

    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});
    await Promise.resolve();
    await Promise.resolve();

    const stopBtn = container.querySelector('.notif-stop-btn') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();
    expect(stopBtn.disabled).toBe(true);

    handle.unmount();
  });

  it('enables the stop button and stops the active native voice interaction', async () => {
    let stateChangedListener: ((payload: unknown) => void) | null = null;
    const stopCurrentInteraction = vi.fn();
    (window as any).AssistantNativeVoice = {
      getState: vi.fn().mockResolvedValue({ state: 'speaking' }),
      addListener: vi.fn((_eventName: string, listener: (payload: unknown) => void) => {
        stateChangedListener = listener;
        return { remove: vi.fn() };
      }),
      stopCurrentInteraction,
    };
    (window as any).Capacitor = {
      getPlatform: () => 'android',
    };

    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});
    await Promise.resolve();
    await Promise.resolve();

    const stopBtn = container.querySelector('.notif-stop-btn') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(false);

    stopBtn.click();
    expect(stopCurrentInteraction).toHaveBeenCalledTimes(1);

    stateChangedListener?.({ state: 'idle' });
    expect(stopBtn.disabled).toBe(true);

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

  it('discards stale snapshots that arrive after newer incremental events', async () => {
    const module = panelFactory!();
    const host = createHost();
    const container = document.createElement('div');
    const handle = module.mount(container, host, {});

    // Receive a created event at revision 5
    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'created',
        revision: 5,
        notification: makeNotification({ id: 'new-one', title: 'Latest' }),
      },
    } as any);

    expect(container.querySelectorAll('.notif-item').length).toBe(1);

    // A stale snapshot at revision 3 arrives late (from the initial request_snapshot)
    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        revision: 3,
        notifications: [makeNotification({ id: 'old', title: 'Old' })],
      },
    } as any);

    // Should still show the newer notification, stale snapshot was discarded
    const items = container.querySelectorAll('.notif-item');
    expect(items.length).toBe(1);
    expect(items[0]?.querySelector('.notif-title')?.textContent).toBe('Latest');

    // A fresh snapshot at revision 6 should be accepted
    handle.onEvent!({
      payload: {
        type: 'notification_update',
        event: 'snapshot',
        revision: 6,
        notifications: [
          makeNotification({ id: 'new-one', title: 'Latest' }),
          makeNotification({ id: 'another', title: 'Another' }),
        ],
      },
    } as any);

    expect(container.querySelectorAll('.notif-item').length).toBe(2);

    handle.unmount();
  });
});
