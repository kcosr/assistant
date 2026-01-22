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

  it('focuses the shared search input on Cmd/Ctrl + Alt + F', async () => {
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
        getSingleClickSelection: () => true,
        updateFocusMarker: () => undefined,
        updateFocusMarkerExpanded: () => undefined,
        updateSingleClickSelection: () => undefined,
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
        altKey: true,
        metaKey: true,
        bubbles: true,
      }),
    );

    expect(document.activeElement).toBe(searchInput);

    handle.unmount();
  });
});
