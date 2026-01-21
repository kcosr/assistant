// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelHandle, PanelHost, PanelModule } from '../../../../web-client/src/controllers/panelRegistry';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';

const apiFetch = vi.fn();

vi.mock('../../../../web-client/src/utils/api', () => ({
  apiFetch,
  getApiBaseUrl: () => 'http://localhost',
}));

type FetchCall = {
  operation: string;
  body: Record<string, unknown>;
};

describe('artifacts panel selection context', () => {
  let panelFactory: (() => PanelModule) | null = null;
  let fetchCalls: FetchCall[] = [];

  const flushPromises = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const makeResponse = (result: unknown) => ({
    ok: true,
    status: 200,
    json: async () => ({ result }),
  });

  beforeEach(() => {
    fetchCalls = [];
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const match = /\/api\/plugins\/artifacts\/operations\/(.+)$/.exec(url);
      const operation = match?.[1] ?? '';
      const body = options?.body
        ? (JSON.parse(options.body.toString()) as Record<string, unknown>)
        : {};
      fetchCalls.push({ operation, body });

      if (operation === 'instance_list') {
        return makeResponse([{ id: 'default', label: 'Default' }]);
      }
      if (operation === 'list') {
        return makeResponse([
          {
            id: 'artifact-1',
            title: 'Report',
            filename: 'report.pdf',
            mimeType: 'application/pdf',
            size: 123,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        ]);
      }
      return makeResponse(null);
    });

    panelFactory = null;
    (window as typeof window & { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (_panelType: string, factory: () => PanelModule) => {
        panelFactory = factory;
      },
    };
  });

  it('adds selected artifact ids to panel context on command click', async () => {
    await import('./index');

    expect(panelFactory).not.toBeNull();
    const panelModule = panelFactory?.();
    expect(panelModule).toBeDefined();

    const contextStore = new Map<string, unknown>();
    let persistedState: unknown = null;

    const host: PanelHost = {
      panelId: () => 'panel-1',
      getBinding: () => null,
      setBinding: () => undefined,
      onBindingChange: () => () => undefined,
      setContext: (key, value) => {
        contextStore.set(key, value);
      },
      getContext: (key) => contextStore.get(key) ?? null,
      subscribeContext: () => () => undefined,
      sendEvent: () => undefined,
      getSessionContext: () => null,
      subscribeSessionContext: () => () => undefined,
      updateSessionAttributes: async () => undefined,
      setPanelMetadata: () => undefined,
      persistPanelState: (state) => {
        persistedState = state;
      },
      loadPanelState: () => persistedState,
      openPanel: (_panelType, _options) => null,
      closePanel: (_panelId) => undefined,
      activatePanel: (_panelId) => undefined,
      movePanel: (_panelId, _placement, _targetPanelId) => undefined,
    };

    const container = document.createElement('div');
    const handle = panelModule?.mount(container, host, {}) as PanelHandle;

    await flushPromises();
    await flushPromises();

    const item = container.querySelector<HTMLElement>('.artifacts-item');
    expect(item).not.toBeNull();

    item?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));

    const context = contextStore.get(getPanelContextKey('panel-1')) as Record<string, unknown>;
    expect(context.type).toBe('artifacts');
    expect(context.selectedItemIds).toEqual(['artifact-1']);
    expect(context.selectedItems).toEqual([{ id: 'artifact-1', title: 'Report' }]);

    handle.unmount();
  });
});
