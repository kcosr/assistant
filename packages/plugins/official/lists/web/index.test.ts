// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

describe('lists panel keyboard shortcuts', () => {
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
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('focuses the shared search input on "f"', async () => {
    vi.resetModules();
    await import('./index');

    const factory = factories['lists'];
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
      panelId: () => 'lists-1',
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
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => false,
      notifyContextAvailabilityChange: () => undefined,
    });

    host.setContext('panel.active', { panelId: host.panelId() });

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

  it('uses the active list instance in context attributes', async () => {
    vi.resetModules();
    await import('./index');

    const factory = factories['lists'];
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

    const panelId = 'lists-ctx';
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
        selectedListId: 'devtools',
        selectedListInstanceId: 'default',
        mode: 'list',
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
        if (!url.includes('/api/plugins/lists/operations/')) {
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
              {
                id: 'devtools',
                name: 'Devtools',
                description: 'Tasks, bugs and ideas for existing development tools.',
              },
            ]);
          }
          return jsonResponse([]);
        }
        if (operation === 'get') {
          return jsonResponse({
            id: 'devtools',
            name: 'Devtools',
            description: 'Tasks, bugs and ideas for existing development tools.',
          });
        }
        if (operation === 'items-list') {
          return jsonResponse([
            { id: 'item-1', title: 'Deploy updated assistant skills', position: 0 },
          ]);
        }
        return jsonResponse([]);
      }),
    );

    host.setContext('core.services', {
      dialogManager: { hasOpenDialog: false },
      contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
      listColumnPreferencesClient: {
        load: () => Promise.resolve(),
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
      throw new Error('Timed out waiting for list context');
    };

    await waitFor(() => latestContext?.type === 'list');

    const contextAttributes = latestContext?.contextAttributes as Record<string, string> | undefined;
    expect(latestContext?.instance_id).toBe('default');
    expect(contextAttributes?.['instance-id']).toBe('default');
    expect(contextAttributes?.['instance-ids']).toBe('work,default');

    handle.unmount();
  });

  it('shows mobile fabs and focuses search on click', async () => {
    vi.resetModules();
    await import('./index');

    const factory = factories['lists'];
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
      panelId: () => 'lists-mobile',
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
        selectedListId: 'devtools',
        selectedListInstanceId: 'default',
        mode: 'list',
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

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (!url.includes('/api/plugins/lists/operations/')) {
          return jsonResponse({});
        }
        const operation = url.split('/').pop() ?? '';
        const body = init?.body ? JSON.parse(init.body as string) : {};

        if (operation === 'instance_list') {
          return jsonResponse([{ id: 'default', label: 'Default' }]);
        }
        if (operation === 'list') {
          if (body.instance_id === 'default') {
            return jsonResponse([
              {
                id: 'devtools',
                name: 'Devtools',
                description: 'Tasks, bugs and ideas for existing development tools.',
              },
            ]);
          }
          return jsonResponse([]);
        }
        if (operation === 'get') {
          return jsonResponse({
            id: 'devtools',
            name: 'Devtools',
            description: 'Tasks, bugs and ideas for existing development tools.',
          });
        }
        if (operation === 'items-list') {
          return jsonResponse([
            { id: 'item-1', title: 'Deploy updated assistant skills', position: 0 },
          ]);
        }
        return jsonResponse([]);
      }),
    );

    host.setContext('core.services', {
      dialogManager: { hasOpenDialog: false },
      contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
      listColumnPreferencesClient: {
        load: () => Promise.resolve(),
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
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => true,
      notifyContextAvailabilityChange: () => undefined,
    });

    host.setContext('panel.active', { panelId: host.panelId() });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const waitFor = async (predicate: () => boolean) => {
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Timed out waiting for fabs');
    };

    await waitFor(
      () =>
        !!container.querySelector('.lists-fab-add.is-visible') &&
        !!container.querySelector('.lists-fab-search.is-visible'),
    );

    const searchInput = container.querySelector<HTMLInputElement>(
      '.collection-list-search-input',
    );
    expect(searchInput).not.toBeNull();

    const searchButton = container.querySelector<HTMLButtonElement>('.lists-fab-search');
    expect(searchButton).not.toBeNull();

    searchButton?.click();

    expect(document.activeElement).toBe(searchInput);

    handle.unmount();
  });
});
