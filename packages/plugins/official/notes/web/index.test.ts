// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  KeyboardShortcutRegistry,
  createShortcutService,
} from '../../../../web-client/src/utils/keyboardShortcuts';

type PanelFactory = () => {
  mount: (container: HTMLElement, host: {
    panelId: () => string;
    getContext: (key: string) => unknown | null;
    subscribeContext: (key: string, handler: (value: unknown) => void) => () => void;
    setContext: (key: string, value: unknown) => void;
    persistPanelState: (state: unknown) => void;
    loadPanelState: () => unknown | null;
    setPanelMetadata: (meta: Record<string, unknown>) => void;
    openPanel: (panelType: string, options?: { focus?: boolean }) => string | null;
    closePanel: (panelId: string) => void;
    openPanelMenu?: (panelId: string, anchor: HTMLElement) => void;
    startPanelDrag?: (panelId: string, event: PointerEvent) => void;
    startPanelReorder?: (panelId: string, event: PointerEvent) => void;
  }) => {
    onVisibilityChange?: (visible: boolean) => void;
    unmount: () => void;
  };
};

const shortcutCleanups: Array<() => void> = [];

const createShortcutHarness = (
  getActivePanel: () => { panelId: string; panelType: string } | null,
) => {
  const registry = new KeyboardShortcutRegistry({
    isEnabled: () => true,
    getActivePanel,
  });
  registry.attach();
  shortcutCleanups.push(() => registry.detach());
  return createShortcutService(registry);
};

describe('notes panel context', () => {
  const originalRegistry = (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown })
    .ASSISTANT_PANEL_REGISTRY;
  let factories: Record<string, PanelFactory>;

  beforeEach(() => {
    factories = {};
    (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (panelType: string, factory: PanelFactory) => {
        factories[panelType] = factory;
      },
    };
    vi.stubGlobal('ASSISTANT_API_HOST', 'localhost');
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (originalRegistry === undefined) {
      delete (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY;
    } else {
      (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY =
        originalRegistry;
    }
    for (const cleanup of shortcutCleanups.splice(0)) {
      cleanup();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('uses the active note instance in context attributes', async () => {
    vi.resetModules();
    await import('./index');

    const factory = factories['notes'];
    expect(factory).toBeDefined();

    const panelModule = factory!();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const context = new Map<string, unknown>();
    const subscribers = new Map<string, Set<(value: unknown) => void>>();
    const notify = (key: string, value: unknown) => {
      const handlers = subscribers.get(key);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(value);
      }
    };

    const panelId = 'notes-ctx';
    const contextKey = `panel.context.${panelId}`;
    let latestContext: Record<string, unknown> | null = null;

    const host = {
      panelId: () => panelId,
      getContext: (key: string) => context.get(key) ?? null,
      subscribeContext: (key: string, handler: (value: unknown) => void) => {
        const handlers = subscribers.get(key) ?? new Set();
        handlers.add(handler);
        subscribers.set(key, handlers);
        return () => {
          handlers.delete(handler);
        };
      },
      setContext: (key: string, value: unknown) => {
        context.set(key, value);
        if (key === contextKey && value && typeof value === 'object') {
          latestContext = value as Record<string, unknown>;
        }
        notify(key, value);
      },
      persistPanelState: () => undefined,
      loadPanelState: () => ({
        selectedNoteTitle: 'Dev Note',
        selectedNoteInstanceId: 'default',
        mode: 'note',
        instanceIds: ['work', 'default'],
      }),
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

    const jsonResponse = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (!url.includes('/api/plugins/notes/operations/')) {
          return jsonResponse({});
        }
        const operation = url.split('/').pop() ?? '';
        const body = init?.body ? JSON.parse(init.body as string) : {};

        if (operation === 'instance_list') {
          return jsonResponse([
            { id: 'work', label: 'Work' },
            { id: 'default', label: 'Default' },
          ]);
        }
        if (operation === 'list') {
          if (body.instance_id === 'default') {
            return jsonResponse([
              { title: 'Dev Note', tags: [], created: '2024-01-01', updated: '2024-01-02' },
            ]);
          }
          return jsonResponse([]);
        }
        if (operation === 'read') {
          return jsonResponse({
            title: 'Dev Note',
            content: 'Hello',
            tags: [],
            created: '2024-01-01',
            updated: '2024-01-02',
          });
        }
        return jsonResponse([]);
      }),
    );

    const keyboardShortcuts = createShortcutHarness(() => {
      const active = context.get('panel.active') as
        | { panelId?: string; panelType?: string }
        | null;
      if (!active || typeof active.panelId !== 'string' || typeof active.panelType !== 'string') {
        return null;
      }
      return { panelId: active.panelId, panelType: active.panelType };
    });
    host.setContext('core.services', {
      dialogManager: { hasOpenDialog: false },
      contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
      listColumnPreferencesClient: {
        load: () => Promise.resolve(),
      },
      keyboardShortcuts,
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => false,
      notifyContextAvailabilityChange: () => undefined,
    });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const waitFor = async (predicate: () => boolean) => {
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Timed out waiting for note context');
    };

    await waitFor(() => latestContext?.type === 'note');

    const contextAttributes = latestContext?.contextAttributes as Record<string, string> | undefined;
    expect(latestContext?.instance_id).toBe('default');
    expect(contextAttributes?.['instance-id']).toBe('default');
    expect(contextAttributes?.['instance-ids']).toBe('work,default');

    handle.unmount();
  });

  it('renders and saves note descriptions', async () => {
    vi.resetModules();
    await import('./index');

    const factory = factories['notes'];
    expect(factory).toBeDefined();

    const panelModule = factory!();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const context = new Map<string, unknown>();
    const subscribers = new Map<string, Set<(value: unknown) => void>>();
    const notify = (key: string, value: unknown) => {
      const handlers = subscribers.get(key);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(value);
      }
    };

    const panelId = 'notes-desc';
    const host = {
      panelId: () => panelId,
      getContext: (key: string) => context.get(key) ?? null,
      subscribeContext: (key: string, handler: (value: unknown) => void) => {
        const handlers = subscribers.get(key) ?? new Set();
        handlers.add(handler);
        subscribers.set(key, handlers);
        return () => {
          handlers.delete(handler);
        };
      },
      setContext: (key: string, value: unknown) => {
        context.set(key, value);
        notify(key, value);
      },
      persistPanelState: () => undefined,
      loadPanelState: () => ({
        selectedNoteTitle: 'Dev Note',
        selectedNoteInstanceId: 'default',
        mode: 'note',
        instanceIds: ['default'],
      }),
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

    const jsonResponse = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    let writePayload: Record<string, unknown> | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (!url.includes('/api/plugins/notes/operations/')) {
          return jsonResponse({});
        }
        const operation = url.split('/').pop() ?? '';
        const body = init?.body ? JSON.parse(init.body as string) : {};

        if (operation === 'instance_list') {
          return jsonResponse([{ id: 'default', label: 'Default' }]);
        }
        if (operation === 'list') {
          return jsonResponse([
            {
              title: 'Dev Note',
              tags: [],
              created: '2024-01-01',
              updated: '2024-01-02',
              description: 'Short description',
            },
          ]);
        }
        if (operation === 'read') {
          return jsonResponse({
            title: 'Dev Note',
            content: 'Hello',
            tags: [],
            created: '2024-01-01',
            updated: '2024-01-02',
            description: 'Short description',
          });
        }
        if (operation === 'write') {
          writePayload = body;
          return jsonResponse({
            title: body.title,
            tags: body.tags ?? [],
            created: '2024-01-01',
            updated: '2024-01-03',
            description: body.description ?? '',
          });
        }
        return jsonResponse([]);
      }),
    );

    const keyboardShortcuts = createShortcutHarness(() => {
      const active = context.get('panel.active') as
        | { panelId?: string; panelType?: string }
        | null;
      if (!active || typeof active.panelId !== 'string' || typeof active.panelType !== 'string') {
        return null;
      }
      return { panelId: active.panelId, panelType: active.panelType };
    });
    host.setContext('core.services', {
      dialogManager: { hasOpenDialog: false },
      contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
      listColumnPreferencesClient: {
        load: () => Promise.resolve(),
      },
      keyboardShortcuts,
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => false,
      notifyContextAvailabilityChange: () => undefined,
    });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const waitFor = async (predicate: () => boolean) => {
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Timed out waiting for description UI');
    };

    await waitFor(
      () => container.querySelector<HTMLElement>('.collection-note-description') !== null,
    );

    const descriptionEl = container.querySelector<HTMLElement>('.collection-note-description');
    expect(descriptionEl?.textContent).toBe('Short description');

    const editButton = container.querySelector<HTMLButtonElement>('.collection-note-edit-button');
    editButton?.click();

    const descriptionInput = container.querySelector<HTMLTextAreaElement>(
      '.note-description-textarea',
    );
    expect(descriptionInput).toBeTruthy();
    if (!descriptionInput) {
      throw new Error('Expected description input');
    }
    descriptionInput.value = 'Updated description';

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save',
    );
    saveButton?.click();

    await waitFor(() => writePayload !== null);
    expect(writePayload?.description).toBe('Updated description');

    handle.unmount();
  });
});

describe('notes panel keyboard shortcuts', () => {
  const originalRegistry = (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown })
    .ASSISTANT_PANEL_REGISTRY;
  let factories: Record<string, PanelFactory>;

  beforeEach(() => {
    factories = {};
    (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (panelType: string, factory: PanelFactory) => {
        factories[panelType] = factory;
      },
    };
    vi.stubGlobal('ASSISTANT_API_HOST', 'localhost');
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, result: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (originalRegistry === undefined) {
      delete (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY;
    } else {
      (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY =
        originalRegistry;
    }
    for (const cleanup of shortcutCleanups.splice(0)) {
      cleanup();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('focuses the shared search input on "f"', async () => {
    vi.resetModules();
    await import('./index');

    const factory = factories['notes'];
    expect(factory).toBeDefined();

    const panelModule = factory!();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const context = new Map<string, unknown>();
    const subscribers = new Map<string, Set<(value: unknown) => void>>();
    const notify = (key: string, value: unknown) => {
      const handlers = subscribers.get(key);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(value);
      }
    };

    const host = {
      panelId: () => 'notes-1',
      getContext: (key: string) => context.get(key) ?? null,
      subscribeContext: (key: string, handler: (value: unknown) => void) => {
        const handlers = subscribers.get(key) ?? new Set();
        handlers.add(handler);
        subscribers.set(key, handlers);
        return () => {
          handlers.delete(handler);
        };
      },
      setContext: (key: string, value: unknown) => {
        context.set(key, value);
        notify(key, value);
      },
      persistPanelState: () => undefined,
      loadPanelState: () => null,
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

    const pendingPreferences = new Promise<void>(() => {});
    const keyboardShortcuts = createShortcutHarness(() => {
      const active = context.get('panel.active') as
        | { panelId?: string; panelType?: string }
        | null;
      if (!active || typeof active.panelId !== 'string' || typeof active.panelType !== 'string') {
        return null;
      }
      return { panelId: active.panelId, panelType: active.panelType };
    });
    host.setContext('core.services', {
      dialogManager: { hasOpenDialog: false },
      contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
      listColumnPreferencesClient: {
        load: () => pendingPreferences,
        getListPreferences: () => null,
        updateColumn: () => undefined,
        getSortState: () => null,
        updateSortState: () => undefined,
        getTimelineField: () => null,
        updateTimelineField: () => undefined,
        getFocusMarkerItemId: () => null,
        getFocusMarkerExpanded: () => false,
        updateFocusMarker: () => undefined,
        updateFocusMarkerExpanded: () => undefined,
      },
      keyboardShortcuts,
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => false,
      notifyContextAvailabilityChange: () => undefined,
    });

    host.setContext('panel.active', { panelId: host.panelId(), panelType: 'notes' });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const searchInput = container.querySelector<HTMLInputElement>(
      '.collection-list-search-input',
    );
    expect(searchInput).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'f',
        bubbles: true,
      }),
    );

    expect(document.activeElement).toBe(searchInput);

    handle.unmount();
  });

  it('blurs the shared search input on Escape when empty', async () => {
    vi.resetModules();
    await import('./index');

    const factory = factories['notes'];
    expect(factory).toBeDefined();

    const panelModule = factory!();
    const container = document.createElement('div');
    document.body.appendChild(container);

    const context = new Map<string, unknown>();
    const subscribers = new Map<string, Set<(value: unknown) => void>>();
    const notify = (key: string, value: unknown) => {
      const handlers = subscribers.get(key);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(value);
      }
    };

    const host = {
      panelId: () => 'notes-1',
      getContext: (key: string) => context.get(key) ?? null,
      subscribeContext: (key: string, handler: (value: unknown) => void) => {
        const handlers = subscribers.get(key) ?? new Set();
        handlers.add(handler);
        subscribers.set(key, handlers);
        return () => {
          handlers.delete(handler);
        };
      },
      setContext: (key: string, value: unknown) => {
        context.set(key, value);
        notify(key, value);
      },
      persistPanelState: () => undefined,
      loadPanelState: () => null,
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

    const pendingPreferences = new Promise<void>(() => {});
    const keyboardShortcuts = createShortcutHarness(() => {
      const active = context.get('panel.active') as
        | { panelId?: string; panelType?: string }
        | null;
      if (!active || typeof active.panelId !== 'string' || typeof active.panelType !== 'string') {
        return null;
      }
      return { panelId: active.panelId, panelType: active.panelType };
    });
    host.setContext('core.services', {
      dialogManager: { hasOpenDialog: false },
      contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
      listColumnPreferencesClient: {
        load: () => pendingPreferences,
        getListPreferences: () => null,
        updateColumn: () => undefined,
        getSortState: () => null,
        updateSortState: () => undefined,
        getTimelineField: () => null,
        updateTimelineField: () => undefined,
        getFocusMarkerItemId: () => null,
        getFocusMarkerExpanded: () => false,
        updateFocusMarker: () => undefined,
        updateFocusMarkerExpanded: () => undefined,
      },
      keyboardShortcuts,
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => false,
      notifyContextAvailabilityChange: () => undefined,
    });

    host.setContext('panel.active', { panelId: host.panelId(), panelType: 'notes' });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const searchInput = container.querySelector<HTMLInputElement>(
      '.collection-list-search-input',
    );
    expect(searchInput).not.toBeNull();

    searchInput?.focus();
    expect(document.activeElement).toBe(searchInput);

    searchInput?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      }),
    );

    expect(document.activeElement).not.toBe(searchInput);

    handle.unmount();
  });
});
