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
}));

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

type ScheduleInfo = {
  agentId: string;
  scheduleId: string;
  cron: string;
  cronDescription: string;
  prompt?: string;
  preCheck?: string;
  sessionTitle?: string;
  enabled: boolean;
  reuseSession: boolean;
  status: 'idle' | 'running' | 'disabled';
  runningCount: number;
  runningStartedAt: string | null;
  maxConcurrent: number;
  nextRun: string | null;
  lastRun: {
    timestamp: string;
    result: 'completed' | 'failed' | 'skipped';
    error?: string;
    skipReason?: string;
  } | null;
};

const SCHEDULES: ScheduleInfo[] = [
  {
    agentId: 'agent-a',
    scheduleId: 'schedule-1',
    cron: '0 6 * * *',
    cronDescription: 'At 06:00 AM',
    preCheck: '/tmp/check-a.sh',
    sessionTitle: 'Morning Seed',
    enabled: true,
    reuseSession: true,
    status: 'idle',
    runningCount: 0,
    runningStartedAt: null,
    maxConcurrent: 1,
    nextRun: '2026-04-01T11:00:00.000Z',
    lastRun: null,
  },
  {
    agentId: 'agent-b',
    scheduleId: 'schedule-2',
    cron: '0 12 * * *',
    cronDescription: 'At 12:00 PM',
    prompt: 'Review the repo.',
    enabled: false,
    reuseSession: false,
    status: 'disabled',
    runningCount: 0,
    runningStartedAt: null,
    maxConcurrent: 1,
    nextRun: null,
    lastRun: {
      timestamp: '2026-03-31T10:00:00.000Z',
      result: 'skipped',
      skipReason: 'Nothing to do',
    },
  },
];

describe('scheduled sessions panel', () => {
  const originalRegistry = (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown })
    .ASSISTANT_PANEL_REGISTRY;
  let panelFactory: PanelFactory | null = null;

  beforeEach(() => {
    panelFactory = null;
    apiFetch.mockReset();
    apiFetch.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: { schedules: SCHEDULES },
      }),
    }));

    (globalThis as { ASSISTANT_PANEL_REGISTRY?: unknown }).ASSISTANT_PANEL_REGISTRY = {
      registerPanel: (panelType: string, factory: PanelFactory) => {
        if (panelType === 'scheduled-sessions') {
          panelFactory = factory;
        }
      },
    };

    vi.stubGlobal(
      'requestAnimationFrame',
      ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)) as typeof requestAnimationFrame,
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      ((id: number) => window.clearTimeout(id)) as typeof cancelAnimationFrame,
    );
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserver {
        observe(): void {}
        disconnect(): void {}
        unobserve(): void {}
      },
    );

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

  const mountPanel = async (panelState: Record<string, unknown> | null = null) => {
    vi.resetModules();
    await import('./index');

    expect(panelFactory).not.toBeNull();

    const panelModule = panelFactory?.() as PanelModule;
    const contextStore = new Map<string, unknown>();
    const persistPanelState = vi.fn();
    const host: PanelHost = {
      panelId: () => 'scheduled-sessions-1',
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
      persistPanelState,
      loadPanelState: () => panelState,
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
      focusInput: () => undefined,
      setStatus: () => undefined,
      isMobileViewport: () => false,
      notifyContextAvailabilityChange: () => undefined,
    });

    const container = document.createElement('div');
    document.body.appendChild(container);

    const handle = panelModule.mount(container, host, {}) as PanelHandle;
    await flushPromises();

    return { container, handle, persistPanelState };
  };

  it('renders a flat list with details collapsed by default', async () => {
    const { container, handle } = await mountPanel();

    try {
      expect(container.querySelectorAll('.scheduled-sessions-group')).toHaveLength(0);
      expect(container.querySelectorAll('.scheduled-sessions-item')).toHaveLength(2);
      expect(container.querySelectorAll('.scheduled-sessions-details.is-collapsed')).toHaveLength(2);

      const titles = Array.from(
        container.querySelectorAll<HTMLElement>('.scheduled-sessions-row-title'),
      ).map((element) => element.textContent?.trim());
      expect(titles).toEqual(['Morning Seed', 'schedule-2']);

      const agents = Array.from(
        container.querySelectorAll<HTMLElement>('.scheduled-sessions-agent'),
      ).map((element) => element.textContent?.trim());
      expect(agents).toEqual(['agent-a', 'agent-b']);
    } finally {
      handle.unmount();
    }
  });

  it('expands a schedule row and persists expanded state', async () => {
    const { container, handle, persistPanelState } = await mountPanel();

    try {
      const row = container.querySelector<HTMLElement>(
        '[data-action="toggle-schedule"][data-agent-id="agent-a"][data-schedule-id="schedule-1"]',
      );
      expect(row).not.toBeNull();

      row?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const item = container.querySelector<HTMLElement>(
        '.scheduled-sessions-item[data-agent-id="agent-a"][data-schedule-id="schedule-1"]',
      );
      const details = item?.querySelector<HTMLElement>('.scheduled-sessions-details');
      expect(item?.classList.contains('is-expanded')).toBe(true);
      expect(details?.classList.contains('is-collapsed')).toBe(false);
      expect(persistPanelState).toHaveBeenLastCalledWith({
        expandedSchedules: ['agent-a:schedule-1'],
      });

      const rerenderedRow = container.querySelector<HTMLElement>(
        '[data-action="toggle-schedule"][data-agent-id="agent-a"][data-schedule-id="schedule-1"]',
      );
      rerenderedRow?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const rerenderedItem = container.querySelector<HTMLElement>(
        '.scheduled-sessions-item[data-agent-id="agent-a"][data-schedule-id="schedule-1"]',
      );
      const rerenderedDetails =
        rerenderedItem?.querySelector<HTMLElement>('.scheduled-sessions-details');
      expect(rerenderedItem?.classList.contains('is-expanded')).toBe(false);
      expect(rerenderedDetails?.classList.contains('is-collapsed')).toBe(true);
      expect(persistPanelState).toHaveBeenLastCalledWith({
        expandedSchedules: [],
      });
    } finally {
      handle.unmount();
    }
  });

  it('restores expanded schedules from panel state', async () => {
    const { container, handle } = await mountPanel({
      expandedSchedules: ['agent-b:schedule-2'],
    });

    try {
      const expandedItem = container.querySelector<HTMLElement>(
        '.scheduled-sessions-item[data-agent-id="agent-b"][data-schedule-id="schedule-2"]',
      );
      expect(expandedItem?.classList.contains('is-expanded')).toBe(true);
      expect(
        expandedItem
          ?.querySelector<HTMLElement>('.scheduled-sessions-details')
          ?.classList.contains('is-collapsed'),
      ).toBe(false);
    } finally {
      handle.unmount();
    }
  });
});
