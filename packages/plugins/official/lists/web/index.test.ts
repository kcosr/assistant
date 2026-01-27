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

describe('lists panel keyboard shortcuts', () => {
  const originalRegistry = (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown })
    .ASSISTANT_PANEL_REGISTRY;
  let factories: Record<string, PanelFactory>;
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

  beforeEach(() => {
    factories = {};
    (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (panelType: string, factory: PanelFactory) => {
        factories[panelType] = factory;
      },
    };
    vi.stubGlobal('ASSISTANT_API_HOST', 'http://localhost');
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

    host.setContext('panel.active', { panelId: host.panelId(), panelType: 'lists' });

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

  it('clears previous AQL input and applies list defaults when switching lists', async () => {
    vi.resetModules();

    const respond = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    const listSummaries = [
      { id: 'list-a', name: 'List A', customFields: [] },
      { id: 'list-b', name: 'List B', customFields: [] },
    ];
    const listDetails: Record<string, unknown> = {
      'list-a': { id: 'list-a', name: 'List A', customFields: [] },
      'list-b': { id: 'list-b', name: 'List B', customFields: [] },
    };
    const savedQueries: Record<string, unknown[]> = {
      'list-a': [],
      'list-b': [
        {
          id: 'default-b',
          name: 'Default',
          query: 'status = "Ready"',
          isDefault: true,
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body =
        typeof init?.body === 'string' && init.body.length > 0
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const operation = url.split('/').pop();
      switch (operation) {
        case 'instance_list':
          return respond([{ id: 'default', label: 'Default' }]);
        case 'list':
          return respond(listSummaries);
        case 'get':
          return respond(listDetails[String(body['id'])] ?? null);
        case 'items-list':
          return respond([]);
        case 'aql-query-list':
          return respond(savedQueries[String(body['listId'])] ?? []);
        default:
          return respond([]);
      }
    }));

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
      panelId: () => 'lists-aql-switch',
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
        selectedListId: 'list-a',
        selectedListInstanceId: 'default',
        mode: 'list',
        instanceIds: ['default'],
        searchMode: 'aql',
        aqlQueryText: 'title : "foo"',
        aqlAppliedQueryText: 'title : "foo"',
      }),
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

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

    host.setContext('panel.active', { panelId: host.panelId(), panelType: 'lists' });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const flush = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const waitFor = async (predicate: () => boolean) => {
      for (let i = 0; i < 10; i += 1) {
        if (predicate()) {
          return;
        }
        await flush();
      }
      throw new Error('Timed out waiting for condition');
    };

    const searchInput = container.querySelector<HTMLInputElement>(
      '.collection-list-search-input',
    );
    expect(searchInput).not.toBeNull();
    await waitFor(() => searchInput?.value === 'title : "foo"');

    const listItemSelector =
      '.collection-search-dropdown-item[data-collection-id="list-b"]';
    await waitFor(() => container.querySelectorAll(listItemSelector).length === 1);
    const listItems = container.querySelectorAll<HTMLElement>(listItemSelector);
    listItems[0]?.click();
    await waitFor(() => searchInput?.value === 'status = "Ready"');

    handle.unmount();
  });

  it('shows "Press enter to clear" when AQL input is emptied with an applied query', async () => {
    vi.resetModules();

    const respond = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    vi.stubGlobal('ASSISTANT_API_HOST', 'localhost');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body =
        typeof init?.body === 'string' && init.body.length > 0
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const operation = url.split('/').pop();
      switch (operation) {
        case 'instance_list':
          return respond([{ id: 'default', label: 'Default' }]);
        case 'list':
          return respond([{ id: 'list-a', name: 'List A', customFields: [] }]);
        case 'get':
          return respond({ id: String(body['id']), name: 'List A', customFields: [] });
        case 'items-list':
          return respond([]);
        case 'aql-query-list':
          return respond([]);
        default:
          return respond([]);
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    (globalThis as { fetch?: typeof fetchMock }).fetch = fetchMock;
    if (typeof window !== 'undefined') {
      window.fetch = fetchMock as typeof window.fetch;
      (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'http://localhost';
    }
    vi.doMock('../../../../web-client/src/utils/api', () => ({
      apiFetch: (input: RequestInfo | URL, init?: RequestInit) => fetchMock(input, init),
    }));

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
      panelId: () => 'lists-aql-clear',
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
        selectedListId: 'list-a',
        selectedListInstanceId: 'default',
        mode: 'list',
        instanceIds: ['default'],
        searchMode: 'aql',
        aqlQueryText: 'title : "foo"',
        aqlAppliedQueryText: 'title : "foo"',
      }),
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

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

    host.setContext('panel.active', { panelId: host.panelId(), panelType: 'lists' });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const waitFor = async (predicate: () => boolean) => {
      for (let i = 0; i < 10; i += 1) {
        if (predicate()) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error('Timed out waiting for condition');
    };

    const searchInput = container.querySelector<HTMLInputElement>(
      '.collection-list-search-input',
    );
    const statusMessage = container.querySelector<HTMLElement>('.collection-list-search-status');
    expect(searchInput).not.toBeNull();
    expect(statusMessage).not.toBeNull();

    await waitFor(() => searchInput?.value === 'title : "foo"');

    searchInput!.value = '';
    searchInput!.dispatchEvent(new Event('input', { bubbles: true }));

    await waitFor(() => statusMessage?.textContent === 'Press enter to clear');

    handle.unmount();
  });

  it('toggles AQL mode with "a" when the list panel is active', async () => {
    vi.resetModules();

    const respond = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    vi.stubGlobal('ASSISTANT_API_HOST', 'localhost');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const body =
        typeof init?.body === 'string' && init.body.length > 0
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : {};
      const operation = url.split('/').pop();
      switch (operation) {
        case 'instance_list':
          return respond([{ id: 'default', label: 'Default' }]);
        case 'list':
          return respond([{ id: 'list-a', name: 'List A', customFields: [] }]);
        case 'get':
          return respond({ id: String(body['id']), name: 'List A', customFields: [] });
        case 'items-list':
          return respond([]);
        case 'aql-query-list':
          return respond([]);
        default:
          return respond([]);
      }
    });
    vi.stubGlobal('fetch', fetchMock);
    (globalThis as { fetch?: typeof fetchMock }).fetch = fetchMock;
    if (typeof window !== 'undefined') {
      window.fetch = fetchMock as typeof window.fetch;
      (window as { ASSISTANT_API_HOST?: string }).ASSISTANT_API_HOST = 'http://localhost';
    }
    vi.doMock('../../../../web-client/src/utils/api', () => ({
      apiFetch: (input: RequestInfo | URL, init?: RequestInit) => fetchMock(input, init),
    }));

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
      panelId: () => 'lists-aql-toggle',
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
        selectedListId: 'list-a',
        selectedListInstanceId: 'default',
        mode: 'list',
        instanceIds: ['default'],
        searchMode: 'raw',
      }),
      setPanelMetadata: () => undefined,
      openPanel: () => null,
      closePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

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

    host.setContext('panel.active', { panelId: host.panelId(), panelType: 'lists' });

    const handle = panelModule.mount(container, host);
    handle.onVisibilityChange?.(true);

    const flush = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    const waitFor = async (predicate: () => boolean) => {
      for (let i = 0; i < 10; i += 1) {
        if (predicate()) {
          return;
        }
        await flush();
      }
      throw new Error('Timed out waiting for condition');
    };

    await waitFor(() => !!container.querySelector('.list-search-mode-toggle'));
    const toggleButton = container.querySelector<HTMLButtonElement>(
      '.list-search-mode-toggle',
    );
    expect(toggleButton).not.toBeNull();
    await waitFor(() => toggleButton?.getAttribute('aria-pressed') === 'false');

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'a',
        bubbles: true,
      }),
    );

    await waitFor(() => toggleButton?.getAttribute('aria-pressed') === 'true');

    handle.unmount();
  });

  it('shows mobile fabs and opens the command palette on search click', async () => {
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

    const openCommandPalette = vi.fn();
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
      isMobileViewport: () => true,
      notifyContextAvailabilityChange: () => undefined,
      openCommandPalette,
    });

    host.setContext('panel.active', { panelId: host.panelId(), panelType: 'lists' });

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

    const searchButton = container.querySelector<HTMLButtonElement>('.lists-fab-search');
    expect(searchButton).not.toBeNull();

    searchButton?.click();

    expect(openCommandPalette).toHaveBeenCalledTimes(1);

    handle.unmount();
  });
});
