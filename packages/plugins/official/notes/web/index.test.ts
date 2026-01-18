// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelHandle, PanelHost, PanelModule } from '../../../../web-client/src/controllers/panelRegistry';
import type { PanelEventEnvelope } from '@assistant/shared';

const apiFetch = vi.fn();

vi.mock('../../../../web-client/src/utils/api', () => ({
  apiFetch,
}));

type FetchCall = {
  operation: string;
  body: Record<string, unknown>;
};

describe('notes panel search launch', () => {
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
      const match = /\/api\/plugins\/notes\/operations\/(.+)$/.exec(url);
      const operation = match?.[1] ?? '';
      const body = options?.body ? (JSON.parse(options.body.toString()) as Record<string, unknown>) : {};
      fetchCalls.push({ operation, body });

      if (operation === 'instance_list') {
        return makeResponse([
          { id: 'default', label: 'Default' },
          { id: 'work', label: 'Work' },
        ]);
      }
      if (operation === 'list') {
        return makeResponse([]);
      }
      if (operation === 'read') {
        const title = typeof body['title'] === 'string' ? body['title'] : 'Unknown';
        return makeResponse({ title, content: '', tags: [], created: '', updated: '' });
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

  it('switches instance when opening a note from search results', async () => {
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

    handle.onEvent?.({
      type: 'panel_event',
      panelId: 'panel-1',
      panelType: 'notes',
      payload: {
        type: 'notes_show',
        instance_id: 'work',
        title: 'Work Note',
      },
    } as PanelEventEnvelope);

    await flushPromises();
    await flushPromises();

    const readCall = fetchCalls.find((call) => call.operation === 'read');
    expect(readCall?.body.instance_id).toBe('work');
    expect(readCall?.body.title).toBe('Work Note');

    handle.unmount();
  });
});
