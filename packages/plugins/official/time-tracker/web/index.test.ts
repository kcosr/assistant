// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PanelFactory,
  PanelHandle,
  PanelHost,
  PanelModule,
} from '../../../../web-client/src/controllers/panelRegistry';
import { toDateString } from './dateUtils';

const apiFetch = vi.fn();

vi.mock('../../../../web-client/src/utils/api', () => ({
  apiFetch,
  getApiBaseUrl: () => 'http://localhost',
}));

type OperationCall = {
  plugin: string;
  operation: string;
  body: Record<string, unknown>;
};

type MockTask = {
  id: string;
  name: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
};

type MockEntry = {
  id: string;
  task_id: string;
  duration_minutes: number;
  note?: string;
  entry_date?: string;
  reported?: boolean;
  entry_type?: 'manual' | 'timer';
  start_time?: string | null;
  end_time?: string | null;
  created_at?: string;
  updated_at?: string;
};

const flushPromises = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
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
  const originalTz = process.env.TZ;
  let panelFactory: PanelFactory | null = null;
  let operationCalls: OperationCall[] = [];
  let mockTasks: MockTask[] = [];
  let mockEntries: MockEntry[] = [];
  let filterEntryListByRequest = false;

  beforeEach(() => {
    panelFactory = null;
    operationCalls = [];
    mockTasks = [
      {
        id: 'task-1',
        name: 'Task',
        description: '',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ];
    mockEntries = [];
    filterEntryListByRequest = false;

    apiFetch.mockReset();
    apiFetch.mockImplementation(async (url: string, options?: RequestInit) => {
      const match = /\/api\/plugins\/([^/]+)\/operations\/([^/?#]+)/.exec(url);
      const plugin = match?.[1] ?? '';
      const operation = match?.[2] ?? '';
      const body = options?.body
        ? (JSON.parse(options.body.toString()) as Record<string, unknown>)
        : {};

      operationCalls.push({ plugin, operation, body });

      const json = (result: unknown) => ({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result }),
      });

      if (plugin === 'artifacts' && operation === 'instance_list') {
        return json([{ id: 'default', label: 'Default' }]);
      }
      if (plugin === 'artifacts' && operation === 'upload') {
        return json({ id: 'artifact-1', filename: 'time-report.xlsx' });
      }
      if (plugin !== 'time-tracker') {
        return json(null);
      }
      if (operation === 'instance_list') {
        return json([{ id: 'default', label: 'Default' }]);
      }
      if (operation === 'task_list') {
        return json(mockTasks);
      }
      if (operation === 'entry_list') {
        if (!filterEntryListByRequest) {
          return json(mockEntries);
        }
        const startDate = typeof body['start_date'] === 'string' ? body['start_date'] : null;
        const endDate = typeof body['end_date'] === 'string' ? body['end_date'] : null;
        const taskId = typeof body['task_id'] === 'string' ? body['task_id'] : null;
        const includeReported = body['include_reported'] === true;
        return json(
          mockEntries.filter((entry) => {
            const entryDate = entry.entry_date ?? '';
            if (startDate && entryDate < startDate) {
              return false;
            }
            if (endDate && entryDate > endDate) {
              return false;
            }
            if (taskId && entry.task_id !== taskId) {
              return false;
            }
            if (!includeReported && entry.reported) {
              return false;
            }
            return true;
          }),
        );
      }
      if (operation === 'entry_create') {
        const entry = makeEntry({
          id: `entry-${mockEntries.length + 1}`,
          task_id: String(body['task_id']),
          duration_minutes: Number(body['duration_minutes']),
          entry_date: String(body['entry_date']),
          note: typeof body['note'] === 'string' ? body['note'] : '',
        });
        mockEntries = [entry, ...mockEntries];
        return json(entry);
      }
      if (operation === 'timer_status') {
        return json(null);
      }
      if (operation === 'export_xlsx') {
        return json({
          filename: 'time-report.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content: 'dGVzdA==',
        });
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
    vi.useRealTimers();
    if (originalTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTz;
    }
    delete (window as { assistantDesktop?: unknown }).assistantDesktop;
    document.body.innerHTML = '';
  });

  const mountPanel = async (options?: {
    isMobileViewport?: boolean;
    panelState?: Record<string, unknown> | null;
  }) => {
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
      loadPanelState: () => options?.panelState ?? null,
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

  const makeEntry = (entry: MockEntry): MockEntry => ({
    entry_date: '2026-01-01',
    reported: false,
    entry_type: 'manual',
    start_time: null,
    end_time: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    note: '',
    ...entry,
  });

  const buildExportRows = async (
    tasks: MockTask[],
    entries: MockEntry[],
  ): Promise<Array<Record<string, unknown>>> => {
    mockTasks = tasks;
    mockEntries = entries;

    const { container, handle } = await mountPanel();
    try {
      const openButton = container.querySelector<HTMLButtonElement>('[data-role="export-xlsx"]');
      expect(openButton).not.toBeNull();
      openButton?.click();
      await flushPromises();

      const submitButton = document.body.querySelector<HTMLButtonElement>(
        '.time-tracker-export-dialog .confirm-dialog-button.primary',
      );
      expect(submitButton).not.toBeNull();
      submitButton?.click();
      await flushPromises();
      await flushPromises();

      const exportCall = operationCalls.find(
        (call) => call.plugin === 'time-tracker' && call.operation === 'export_xlsx',
      );
      expect(exportCall).toBeTruthy();
      expect(Array.isArray(exportCall?.body['rows'])).toBe(true);
      return exportCall?.body['rows'] as Array<Record<string, unknown>>;
    } finally {
      handle.unmount();
    }
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

  it('uses client-local timezone when deriving YYYY-MM-DD at UTC boundary', () => {
    const instant = '2026-01-01T00:30:00.000Z';

    process.env.TZ = 'UTC';
    expect(toDateString(new Date(instant))).toBe('2026-01-01');

    process.env.TZ = 'America/Los_Angeles';
    expect(toDateString(new Date(instant))).toBe('2025-12-31');
  });

  it('sends client-local entry_date when starting a timer', async () => {
    const { container, handle } = await mountPanel({
      panelState: { selectedTaskId: 'task-1' },
    });

    try {
      const expectedEntryDate = toDateString(new Date());
      const startButton = container.querySelector<HTMLButtonElement>('[data-role="timer-start"]');
      expect(startButton).not.toBeNull();
      expect(startButton?.disabled).toBe(false);

      startButton?.click();
      await flushPromises();

      const timerStartCall = [...operationCalls]
        .reverse()
        .find((call) => call.operation === 'timer_start');
      expect(timerStartCall).toBeTruthy();
      expect(timerStartCall?.body['task_id']).toBe('task-1');
      expect(timerStartCall?.body['entry_date']).toBe(expectedEntryDate);
    } finally {
      handle.unmount();
    }
  });

  it('refreshes stale today preset dates before listing a newly added entry', async () => {
    filterEntryListByRequest = true;
    const today = toDateString(new Date());
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = toDateString(yesterdayDate);

    const { container, handle } = await mountPanel({
      panelState: {
        selectedTaskId: 'task-1',
        rangePreset: 'today',
        rangeStart: yesterday,
        rangeEnd: yesterday,
      },
    });

    try {
      const addButton = container.querySelector<HTMLButtonElement>('[data-role="entry-add"]');
      expect(addButton).not.toBeNull();
      expect(addButton?.disabled).toBe(false);

      addButton?.click();
      await flushPromises();
      await flushPromises();

      const entryCreateCall = operationCalls.find((call) => call.operation === 'entry_create');
      expect(entryCreateCall?.body['entry_date']).toBe(today);

      const latestEntryList = [...operationCalls]
        .reverse()
        .find((call) => call.operation === 'entry_list');
      expect(latestEntryList?.body['start_date']).toBe(today);
      expect(latestEntryList?.body['end_date']).toBe(today);

      const entryList = container.querySelector<HTMLElement>('[data-role="entry-list"]');
      expect(entryList?.textContent).toContain('30m');
    } finally {
      handle.unmount();
    }
  });

  it('exports task description before unique note bullets', async () => {
    const rows = await buildExportRows(
      [
        {
          id: 'task-1',
          name: 'Client follow-up',
          description: '  Summarize client rollout blockers.  ',
        },
      ],
      [
        makeEntry({
          id: 'entry-1',
          task_id: 'task-1',
          duration_minutes: 30,
          note: ' - Drafted status update ',
        }),
        makeEntry({
          id: 'entry-2',
          task_id: 'task-1',
          duration_minutes: 45,
          note: '• Confirmed owners',
        }),
      ],
    );

    expect(rows).toEqual([
      {
        item: 'Client follow-up',
        total_minutes: 75,
        description:
          'Summarize client rollout blockers.\n\nNotes:\n• Drafted status update\n• Confirmed owners',
      },
    ]);
  });

  it('downloads exported XLSX through the desktop save bridge', async () => {
    const showSaveDialog = vi.fn().mockResolvedValue('/tmp/time-report.xlsx');
    const saveArtifactFile = vi.fn().mockResolvedValue(undefined);
    (window as typeof window & { assistantDesktop?: unknown }).assistantDesktop = {
      showSaveDialog,
      saveArtifactFile,
    };
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    mockEntries = [
      makeEntry({
        id: 'entry-1',
        task_id: 'task-1',
        duration_minutes: 30,
        note: 'Desktop export',
      }),
    ];

    const { container, handle } = await mountPanel();
    try {
      const openButton = container.querySelector<HTMLButtonElement>('[data-role="export-xlsx"]');
      expect(openButton).not.toBeNull();
      openButton?.click();
      await flushPromises();

      const submitButton = document.body.querySelector<HTMLButtonElement>(
        '.time-tracker-export-dialog .confirm-dialog-button.primary',
      );
      expect(submitButton).not.toBeNull();
      submitButton?.click();
      await flushPromises();
      await flushPromises();

      const link = document.body.querySelector<HTMLAnchorElement>(
        '.time-tracker-export-summary a[download]',
      );
      expect(link).not.toBeNull();
      expect(link?.download).toBe('time-report.xlsx');
      expect(link?.target).toBe('');

      const dispatched = link?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }),
      );
      await flushPromises();
      await flushPromises();

      expect(dispatched).toBe(false);
      expect(showSaveDialog).toHaveBeenCalledWith('time-report.xlsx');
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://localhost/api/plugins/artifacts/files/default/artifact-1?download=1',
      );
      expect(saveArtifactFile).toHaveBeenCalledWith('/tmp/time-report.xlsx', 'AQID');
    } finally {
      handle.unmount();
    }
  });

  it('exports task description only when entries have no notes', async () => {
    const rows = await buildExportRows(
      [{ id: 'task-1', name: 'Planning', description: ' Quarterly planning summary ' }],
      [
        makeEntry({
          id: 'entry-1',
          task_id: 'task-1',
          duration_minutes: 60,
          note: '',
        }),
      ],
    );

    expect(rows).toEqual([
      {
        item: 'Planning',
        total_minutes: 60,
        description: 'Quarterly planning summary',
      },
    ]);
  });

  it('preserves notes-only export descriptions', async () => {
    const rows = await buildExportRows(
      [{ id: 'task-1', name: 'Implementation', description: '' }],
      [
        makeEntry({
          id: 'entry-1',
          task_id: 'task-1',
          duration_minutes: 25,
          note: 'Built report view',
        }),
        makeEntry({
          id: 'entry-2',
          task_id: 'task-1',
          duration_minutes: 35,
          note: '* Added tests',
        }),
      ],
    );

    expect(rows).toEqual([
      {
        item: 'Implementation',
        total_minutes: 60,
        description: '• Built report view\n• Added tests',
      },
    ]);
  });

  it('deduplicates normalized notes case-insensitively', async () => {
    const rows = await buildExportRows(
      [{ id: 'task-1', name: 'QA', description: 'Verification pass' }],
      [
        makeEntry({
          id: 'entry-1',
          task_id: 'task-1',
          duration_minutes: 10,
          note: '- Smoke tested export',
        }),
        makeEntry({
          id: 'entry-2',
          task_id: 'task-1',
          duration_minutes: 20,
          note: 'smoke tested export',
        }),
        makeEntry({
          id: 'entry-3',
          task_id: 'task-1',
          duration_minutes: 30,
          note: '— Checked workbook formatting',
        }),
      ],
    );

    expect(rows).toEqual([
      {
        item: 'QA',
        total_minutes: 60,
        description:
          'Verification pass\n\nNotes:\n• Smoke tested export\n• Checked workbook formatting',
      },
    ]);
  });

  it('exports an empty description when a row has neither task description nor notes', async () => {
    const rows = await buildExportRows(
      [{ id: 'task-1', name: 'Admin', description: '   ' }],
      [
        makeEntry({
          id: 'entry-1',
          task_id: 'task-1',
          duration_minutes: 15,
          note: ' - ',
        }),
      ],
    );

    expect(rows).toEqual([
      {
        item: 'Admin',
        total_minutes: 15,
        description: '',
      },
    ]);
  });

  it('exports missing task entries as unknown task rows without task description', async () => {
    const rows = await buildExportRows(
      [],
      [
        makeEntry({
          id: 'entry-1',
          task_id: 'missing-task',
          duration_minutes: 20,
          note: '- Investigated orphaned entry',
        }),
      ],
    );

    expect(rows).toEqual([
      {
        item: 'Unknown task',
        total_minutes: 20,
        description: '• Investigated orphaned entry',
      },
    ]);
  });
});
