// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PanelFactory,
  PanelHandle,
  PanelHost,
  PanelModule,
} from '../../../../web-client/src/controllers/panelRegistry';

const apiFetch = vi.fn();

vi.mock('../../../../web-client/src/utils/api', () => ({
  apiFetch,
  getApiBaseUrl: () => 'http://localhost',
}));

type OperationCall = {
  operation: string;
  body: Record<string, unknown>;
};

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const toDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDateCell = (root: ParentNode, date: string): HTMLButtonElement | null => {
  const cells = Array.from(
    root.querySelectorAll<HTMLButtonElement>(`.time-tracker-range-day[data-date="${date}"]`),
  );
  return cells.find((cell) => !cell.classList.contains('outside')) ?? cells[0] ?? null;
};

describe('time tracker range picker', () => {
  const originalRegistry = (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown })
    .ASSISTANT_PANEL_REGISTRY;
  let panelFactory: PanelFactory | null = null;
  let operationCalls: OperationCall[] = [];

  beforeEach(() => {
    panelFactory = null;
    operationCalls = [];

    apiFetch.mockReset();
    apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const match = /\/api\/plugins\/time-tracker\/operations\/([^/?#]+)/.exec(url);
      const operation = match?.[1] ?? '';
      const body = options?.body
        ? (JSON.parse(options.body.toString()) as Record<string, unknown>)
        : {};

      operationCalls.push({ operation, body });

      const json = (result: unknown) => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result }),
      });

      if (operation === 'instance_list') {
        return json([{ id: 'default', label: 'Default' }]);
      }
      if (operation === 'task_list') {
        return json([
          {
            id: 'task-1',
            name: 'Task',
            description: '',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]);
      }
      if (operation === 'entry_list') {
        return json([]);
      }
      if (operation === 'timer_status') {
        return json(null);
      }
      return json(null);
    });

    (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (panelType: string, factory: PanelFactory) => {
        if (panelType === 'time-tracker') {
          panelFactory = factory;
        }
      },
    };

    document.body.innerHTML = '';
  });

  afterEach(() => {
    if (originalRegistry === undefined) {
      delete (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY;
    } else {
      (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY =
        originalRegistry;
    }
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const mountPanel = async (options?: { isMobileViewport?: boolean }) => {
    vi.resetModules();
    await import('./index');

    expect(panelFactory).not.toBeNull();

    const panelModule = panelFactory?.() as PanelModule;
    const contextStore = new Map<string, unknown>();

    const host: PanelHost = {
      panelId: () => 'time-tracker-1',
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
      persistPanelState: () => undefined,
      loadPanelState: () => null,
      openPanel: () => null,
      closePanel: () => undefined,
      activatePanel: () => undefined,
      movePanel: () => undefined,
      openPanelMenu: () => undefined,
      startPanelDrag: () => undefined,
      startPanelReorder: () => undefined,
    };

    host.setContext('core.services', {
      dialogManager: { hasOpenDialog: false },
      contextMenuManager: { close: () => undefined, setActiveMenu: () => undefined },
      listColumnPreferencesClient: {
        load: async () => undefined,
      },
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => options?.isMobileViewport ?? false,
      notifyContextAvailabilityChange: () => undefined,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);

    const handle = panelModule.mount(container, host, {}) as PanelHandle;
    await flushPromises();
    await flushPromises();

    return { container, handle };
  };

  const openRangePopover = async (container: HTMLElement): Promise<void> => {
    const rangeToggle = container.querySelector<HTMLButtonElement>('[data-role="range-toggle"]');
    expect(rangeToggle).not.toBeNull();
    rangeToggle?.click();
    await flushPromises();
  };

  it.each([
    { label: 'desktop', isMobileViewport: false },
    { label: 'mobile', isMobileViewport: true },
  ])('renders a single-month grid on $label', async ({ isMobileViewport }) => {
    const { container, handle } = await mountPanel({ isMobileViewport });

    try {
      await openRangePopover(container);
      const dayCells = container.querySelectorAll<HTMLButtonElement>('.time-tracker-range-day');
      expect(dayCells).toHaveLength(42);
    } finally {
      handle.unmount();
    }
  });

  it.each([
    { label: 'desktop', isMobileViewport: false },
    { label: 'mobile', isMobileViewport: true },
  ])(
    'uses click start/end selection and resets start after a completed range on $label',
    async ({ isMobileViewport }) => {
      const { container, handle } = await mountPanel({ isMobileViewport });

      try {
        await openRangePopover(container);

        const now = new Date();
        const firstStart = toDateString(new Date(now.getFullYear(), now.getMonth(), 3));
        const firstEnd = toDateString(new Date(now.getFullYear(), now.getMonth(), 11));
        const secondStart = toDateString(new Date(now.getFullYear(), now.getMonth(), 19));
        const secondEnd = toDateString(new Date(now.getFullYear(), now.getMonth(), 24));

        const firstStartCell = getDateCell(container, firstStart);
        const firstEndCell = getDateCell(container, firstEnd);
        const secondStartCell = getDateCell(container, secondStart);
        const secondEndCell = getDateCell(container, secondEnd);
        expect(firstStartCell).not.toBeNull();
        expect(firstEndCell).not.toBeNull();
        expect(secondStartCell).not.toBeNull();
        expect(secondEndCell).not.toBeNull();

        firstStartCell?.click();
        firstEndCell?.click();

        // Third click starts a brand new range.
        secondStartCell?.click();
        secondEndCell?.click();

        const applyButton = container.querySelector<HTMLButtonElement>('[data-role="range-apply"]');
        applyButton?.click();
        await flushPromises();

        const latestEntryList = [...operationCalls]
          .reverse()
          .find((call) => call.operation === 'entry_list');
        expect(latestEntryList?.body['start_date']).toBe(secondStart);
        expect(latestEntryList?.body['end_date']).toBe(secondEnd);
      } finally {
        handle.unmount();
      }
    },
  );
});
