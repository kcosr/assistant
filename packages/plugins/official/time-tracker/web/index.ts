import type { PanelEventEnvelope } from '@assistant/shared';

import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { DialogManager } from '../../../../web-client/src/controllers/dialogManager';
import { ContextMenuManager } from '../../../../web-client/src/controllers/contextMenu';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';
import { ListColumnPreferencesClient } from '../../../../web-client/src/utils/listColumnPreferences';
import { apiFetch, getApiBaseUrl } from '../../../../web-client/src/utils/api';
import {
  CORE_PANEL_SERVICES_CONTEXT_KEY,
  type PanelCoreServices,
} from '../../../../web-client/src/utils/panelServices';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';
import { ICONS } from '../../../../web-client/src/utils/icons';

const TIME_TRACKER_PANEL_TEMPLATE = `
  <aside class="time-tracker-panel" aria-label="Time tracker panel">
    <div class="panel-header panel-chrome-row time-tracker-panel-header" data-role="chrome-row">
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Time Tracker</span>
        <div class="panel-chrome-instance" data-role="instance-actions">
          <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
            <button
              type="button"
              class="panel-chrome-instance-trigger"
              data-role="instance-trigger"
              aria-label="Select instance"
              aria-haspopup="listbox"
              aria-expanded="false"
            >
              <span class="panel-chrome-instance-trigger-text" data-role="instance-trigger-text"
                >Default</span
              >
              <svg
                class="panel-chrome-instance-trigger-icon"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                aria-hidden="true"
              >
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <div
              class="panel-chrome-instance-menu"
              data-role="instance-menu"
              role="listbox"
              aria-label="Instances"
            >
              <div class="panel-chrome-instance-search-row">
                <input
                  type="text"
                  class="panel-chrome-instance-search"
                  data-role="instance-search"
                  placeholder="Search instances..."
                  aria-label="Search instances"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="panel-chrome-instance-clear"
                  data-role="instance-clear"
                  aria-label="Clear selection"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6l-12 12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </div>
              <div class="panel-chrome-instance-list" data-role="instance-list"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
      <div class="panel-chrome-frame-controls" data-role="chrome-controls">
        <button type="button" class="panel-chrome-button panel-chrome-toggle" data-action="toggle" aria-label="Panel controls" title="Panel controls">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div class="panel-chrome-frame-buttons">
          <button type="button" class="panel-chrome-button" data-action="move" aria-label="Move panel" title="Move">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
            </svg>
          </button>
          <button type="button" class="panel-chrome-button" data-action="reorder" aria-label="Reorder panel" title="Reorder">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
            </svg>
          </button>
          <button type="button" class="panel-chrome-button" data-action="menu" aria-label="More actions" title="More actions">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="12" cy="5" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
        </div>
        <button type="button" class="panel-chrome-button panel-chrome-close" data-action="close" aria-label="Close panel" title="Close">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="time-tracker-track" data-role="track-zone">
      <div class="time-tracker-task-row" data-role="task-row">
        <div class="time-tracker-task-selector" data-role="task-selector">
          <label class="time-tracker-task-label" for="time-tracker-task-input">Task</label>
          <div class="time-tracker-task-input" data-role="task-input">
            <input
              id="time-tracker-task-input"
              type="text"
              class="time-tracker-task-input-field"
              placeholder="Search or create task..."
              autocomplete="off"
              aria-label="Search or create task"
              data-role="task-input-field"
            />
            <button type="button" class="time-tracker-task-toggle" data-role="task-toggle">
              ${ICONS.chevronDown}
            </button>
          </div>
          <div class="time-tracker-task-dropdown" data-role="task-dropdown" aria-label="Tasks"></div>
        </div>
        <button type="button" class="time-tracker-task-edit" data-role="task-edit">Edit</button>
      </div>
      <div class="time-tracker-task-hint" data-role="task-hint">
        Select a task to start tracking.
      </div>
      <div class="time-tracker-controls" data-role="task-controls">
        <button type="button" class="time-tracker-button primary" data-role="timer-start">
          ${ICONS.clock}
          <span>Start Timer</span>
        </button>
        <div class="time-tracker-split-button" data-role="entry-add-group">
          <button type="button" class="time-tracker-button time-tracker-split-main" data-role="entry-add">
            + <span data-role="entry-add-duration">0:30</span>
          </button>
          <button type="button" class="time-tracker-button time-tracker-split-toggle" data-role="entry-add-toggle">
            ${ICONS.chevronDown}
          </button>
          <div class="time-tracker-duration-menu" data-role="duration-menu"></div>
        </div>
      </div>
      <div class="time-tracker-timer" data-role="timer-state">
        <div class="time-tracker-timer-header">
          <span class="time-tracker-timer-task" data-role="timer-task">Task</span>
          <span class="time-tracker-timer-display" data-role="timer-display">00:00:00</span>
        </div>
        <div class="time-tracker-timer-actions">
          <button type="button" class="time-tracker-button danger" data-role="timer-stop">Stop &amp; Save</button>
          <button type="button" class="time-tracker-button ghost" data-role="timer-discard">Discard</button>
        </div>
      </div>
      <div class="time-tracker-stop-confirm" data-role="stop-confirm">
        <div class="time-tracker-stop-message" data-role="stop-message"></div>
        <div class="time-tracker-stop-actions">
          <button type="button" class="time-tracker-button primary" data-role="stop-save">Save</button>
          <button type="button" class="time-tracker-button" data-role="stop-edit">Edit Details</button>
          <button type="button" class="time-tracker-button ghost" data-role="stop-discard">Discard</button>
        </div>
      </div>
      <label class="time-tracker-note" data-role="note-row">
        <span>Note</span>
        <input
          type="text"
          class="time-tracker-note-input"
          placeholder="Optional note"
          data-role="note-input"
        />
      </label>
    </div>
    <div class="time-tracker-entries">
      <div class="time-tracker-filters" data-role="filter-bar">
        <div class="time-tracker-filter-title">Entries</div>
        <div class="time-tracker-filter-controls">
          <button type="button" class="time-tracker-filter-button" data-range="today">Today</button>
          <button type="button" class="time-tracker-filter-button" data-range="week">Week</button>
          <button type="button" class="time-tracker-filter-button" data-range="month">Month</button>
          <button type="button" class="time-tracker-filter-button" data-role="range-toggle">
            <span data-role="range-label">Range</span>
            <span class="time-tracker-button-caret">${ICONS.chevronDown}</span>
          </button>
        </div>
        <div class="time-tracker-filter-extras">
          <label class="time-tracker-filter-checkbox">
            <input type="checkbox" data-role="filter-reported" />
            <span>Show reported</span>
          </label>
        </div>
        <div class="time-tracker-range-popover" data-role="range-popover">
          <div class="time-tracker-range-header">
            <button type="button" class="time-tracker-range-nav" data-role="range-prev">&lt;</button>
            <div class="time-tracker-range-month" data-role="range-month"></div>
            <button type="button" class="time-tracker-range-nav" data-role="range-next">&gt;</button>
          </div>
          <div class="time-tracker-range-weekdays" data-role="range-weekdays"></div>
          <div class="time-tracker-range-grid" data-role="range-grid"></div>
          <div class="time-tracker-range-actions">
            <button type="button" class="time-tracker-button ghost" data-role="range-cancel">Cancel</button>
            <button type="button" class="time-tracker-button primary" data-role="range-apply">Apply</button>
          </div>
        </div>
      </div>
      <div class="time-tracker-entry-list" data-role="entry-list"></div>
      <div class="time-tracker-range-total" data-role="range-total">
        <span data-role="range-total-value">Total: 0m</span>
        <button type="button" class="time-tracker-button ghost" data-role="export-xlsx">
          Export XLSX
        </button>
      </div>
    </div>
  </aside>
`;

const DEFAULT_INSTANCE_ID = 'default';

type Task = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type Entry = {
  id: string;
  task_id: string;
  entry_date: string;
  duration_minutes: number;
  reported: boolean;
  note: string;
  entry_type: 'manual' | 'timer';
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
};

type ActiveTimer = {
  id: string;
  task_id: string;
  entry_date: string;
  accumulated_seconds: number;
  last_resumed_at: string;
  created_at: string;
};

type Instance = {
  id: string;
  label: string;
};

type OperationResponse<T> = { ok: true; result: T } | { error: string; code?: string };

type RangePreset = 'today' | 'week' | 'month' | 'range';

type DateRange = {
  start: string;
  end: string;
  preset: RangePreset;
};

type TaskOption =
  | { type: 'create'; label: string; query: string }
  | { type: 'task'; label: string; task: Task };

type ExportRow = {
  item: string;
  total_minutes: number;
  description: string;
};

type ArtifactMetadata = {
  id: string;
  filename: string;
};

const DURATION_PRESETS = [15, 30, 45, 60, 90, 120];

const fallbackDialogManager = new DialogManager();
const fallbackContextMenuManager = new ContextMenuManager({
  isSessionPinned: () => false,
  pinSession: () => undefined,
  clearHistory: () => undefined,
  deleteSession: () => undefined,
  renameSession: () => undefined,
});
const fallbackListColumnPreferencesClient = new ListColumnPreferencesClient();
void fallbackListColumnPreferencesClient.load();

function resolveServices(host: PanelHost): PanelCoreServices {
  const raw = host.getContext(CORE_PANEL_SERVICES_CONTEXT_KEY);
  const core =
    raw && typeof raw === 'object'
      ? (raw as PanelCoreServices)
      : (null as PanelCoreServices | null);
  if (core) {
    return core;
  }
  return {
    dialogManager: fallbackDialogManager,
    contextMenuManager: fallbackContextMenuManager,
    listColumnPreferencesClient: fallbackListColumnPreferencesClient,
    focusInput: () => {
      host.openPanel('chat', { focus: true });
    },
    setStatus: () => undefined,
    isMobileViewport: () => {
      if (typeof window === 'undefined') {
        return false;
      }
      try {
        if (typeof window.matchMedia === 'function') {
          return window.matchMedia('(max-width: 600px)').matches;
        }
      } catch {
        // Ignore matchMedia errors and fall back to window size.
      }
      return window.innerWidth <= 600;
    },
    notifyContextAvailabilityChange: () => undefined,
  };
}

async function callOperation<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/plugins/time-tracker/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore json parsing failures
  }

  if (!response.ok || !payload || 'error' in payload) {
    const message =
      payload && 'error' in payload && payload.error
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

async function callArtifactsOperation<T>(
  operation: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await apiFetch(`/api/plugins/artifacts/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore json parsing failures
  }

  if (!response.ok || !payload || 'error' in payload) {
    const message =
      payload && 'error' in payload && payload.error
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

async function resolveArtifactsInstanceId(targetId: string): Promise<string> {
  try {
    const raw = await callArtifactsOperation<unknown>('instance_list', {});
    const list = Array.isArray(raw) ? raw.map(parseInstance).filter(Boolean) : [];
    const instances = list as Instance[];
    if (instances.some((instance) => instance.id === targetId)) {
      return targetId;
    }
  } catch {
    // Ignore lookup errors and fall back to default.
  }
  return DEFAULT_INSTANCE_ID;
}

function buildArtifactsDownloadUrl(options: {
  instanceId: string;
  artifactId: string;
}): string {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  return `${base}/api/plugins/artifacts/files/${encodeURIComponent(
    options.instanceId,
  )}/${encodeURIComponent(options.artifactId)}?download=1`;
}

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateString(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(date, diff);
}

function endOfWeek(date: Date): Date {
  return addDays(startOfWeek(date), 6);
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function formatDateLabel(dateString: string, options?: { includeYear?: boolean }): string {
  const date = parseDateString(dateString);
  if (!date) {
    return dateString;
  }
  const includeYear = options?.includeYear ?? false;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
  });
}

function formatRangeLabel(start: string, end: string): string {
  if (start === end) {
    return formatDateLabel(start, { includeYear: true });
  }
  const startDate = parseDateString(start);
  const endDate = parseDateString(end);
  const sameYear = startDate && endDate && startDate.getFullYear() === endDate.getFullYear();
  return `${formatDateLabel(start, { includeYear: !sameYear })} - ${formatDateLabel(end, {
    includeYear: true,
  })}`;
}

function formatCreatedAt(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}/${day} ${hours}:${minutes}`;
}

function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  if (hours > 0 && mins > 0) {
    return `${hours}h ${mins}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  return `${mins}m`;
}

function formatDurationHhMm(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

function formatTimerDisplay(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
    secs,
  ).padStart(2, '0')}`;
}

function formatInstanceLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseDurationInput(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colonMatch) {
    const hours = Number(colonMatch[1]);
    const minutes = Number(colonMatch[2]);
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const total = hours * 60 + minutes;
      return total > 0 ? total : null;
    }
  }
  const hmMatch = trimmed.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+)m)?$/);
  if (hmMatch && (hmMatch[1] || hmMatch[2])) {
    const hours = hmMatch[1] ? Number(hmMatch[1]) : 0;
    const minutes = hmMatch[2] ? Number(hmMatch[2]) : 0;
    if (!Number.isNaN(hours) && !Number.isNaN(minutes)) {
      const total = Math.round(hours * 60 + minutes);
      return total > 0 ? total : null;
    }
  }
  const hoursOnly = trimmed.match(/^(\d+(?:\.\d+)?)h$/);
  if (hoursOnly) {
    const hours = Number(hoursOnly[1]);
    if (!Number.isNaN(hours)) {
      const total = Math.round(hours * 60);
      return total > 0 ? total : null;
    }
  }
  const minutesOnly = trimmed.match(/^(\d+)(?:m)?$/);
  if (minutesOnly) {
    const minutes = Number(minutesOnly[1]);
    if (!Number.isNaN(minutes)) {
      return minutes > 0 ? minutes : null;
    }
  }
  return null;
}

function parseInstance(value: unknown): Instance | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = raw['id'];
  if (typeof id !== 'string') {
    return null;
  }
  const label =
    typeof raw['label'] === 'string' && raw['label'].trim().length > 0
      ? raw['label']
      : formatInstanceLabel(id);
  return { id, label };
}

function parseTask(value: unknown): Task | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string') {
    return null;
  }
  return {
    id: raw['id'] as string,
    name: raw['name'] as string,
    description: typeof raw['description'] === 'string' ? (raw['description'] as string) : '',
    created_at: typeof raw['created_at'] === 'string' ? (raw['created_at'] as string) : '',
    updated_at: typeof raw['updated_at'] === 'string' ? (raw['updated_at'] as string) : '',
  };
}

function parseEntry(value: unknown): Entry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || typeof raw['task_id'] !== 'string') {
    return null;
  }
  const duration = raw['duration_minutes'];
  if (typeof duration !== 'number') {
    return null;
  }
  const reported = raw['reported'];
  const entryType = raw['entry_type'];
  if (entryType !== 'manual' && entryType !== 'timer') {
    return null;
  }
  return {
    id: raw['id'] as string,
    task_id: raw['task_id'] as string,
    entry_date: typeof raw['entry_date'] === 'string' ? (raw['entry_date'] as string) : '',
    duration_minutes: duration,
    reported: typeof reported === 'boolean' ? reported : Boolean(reported),
    note: typeof raw['note'] === 'string' ? (raw['note'] as string) : '',
    entry_type: entryType,
    start_time: typeof raw['start_time'] === 'string' ? (raw['start_time'] as string) : null,
    end_time: typeof raw['end_time'] === 'string' ? (raw['end_time'] as string) : null,
    created_at: typeof raw['created_at'] === 'string' ? (raw['created_at'] as string) : '',
    updated_at: typeof raw['updated_at'] === 'string' ? (raw['updated_at'] as string) : '',
  };
}

function parseTimer(value: unknown): ActiveTimer | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw['id'] !== 'string' || typeof raw['task_id'] !== 'string') {
    return null;
  }
  const accumulated = raw['accumulated_seconds'];
  if (typeof accumulated !== 'number') {
    return null;
  }
  return {
    id: raw['id'] as string,
    task_id: raw['task_id'] as string,
    entry_date: typeof raw['entry_date'] === 'string' ? (raw['entry_date'] as string) : '',
    accumulated_seconds: accumulated,
    last_resumed_at:
      typeof raw['last_resumed_at'] === 'string' ? (raw['last_resumed_at'] as string) : '',
    created_at: typeof raw['created_at'] === 'string' ? (raw['created_at'] as string) : '',
  };
}

function compareDatesDesc(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}

function compareTimestampsDesc(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}

function setVisible(el: HTMLElement | null, visible: boolean): void {
  if (!el) {
    return;
  }
  el.style.display = visible ? '' : 'none';
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const registry = window.ASSISTANT_PANEL_REGISTRY;

if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for time tracker plugin.');
} else {
  registry.registerPanel('time-tracker', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.innerHTML = TIME_TRACKER_PANEL_TEMPLATE.trim();
      const root = container.firstElementChild as HTMLElement | null;
      if (!root) {
        throw new Error('Failed to render time tracker panel');
      }

      const services = resolveServices(host);

      const taskInput = root.querySelector<HTMLInputElement>('[data-role="task-input-field"]');
      const taskToggle = root.querySelector<HTMLButtonElement>('[data-role="task-toggle"]');
      const taskDropdown = root.querySelector<HTMLElement>('[data-role="task-dropdown"]');
      const taskRow = root.querySelector<HTMLElement>('[data-role="task-row"]');
      const taskEditButton = root.querySelector<HTMLButtonElement>('[data-role="task-edit"]');
      const taskHint = root.querySelector<HTMLElement>('[data-role="task-hint"]');
      const taskControls = root.querySelector<HTMLElement>('[data-role="task-controls"]');
      const timerStartButton = root.querySelector<HTMLButtonElement>('[data-role="timer-start"]');
      const entryAddButton = root.querySelector<HTMLButtonElement>('[data-role="entry-add"]');
      const entryAddToggle = root.querySelector<HTMLButtonElement>(
        '[data-role="entry-add-toggle"]',
      );
      const entryAddDuration = root.querySelector<HTMLElement>('[data-role="entry-add-duration"]');
      const durationMenu = root.querySelector<HTMLElement>('[data-role="duration-menu"]');
      const timerState = root.querySelector<HTMLElement>('[data-role="timer-state"]');
      const timerTaskLabel = root.querySelector<HTMLElement>('[data-role="timer-task"]');
      const timerDisplay = root.querySelector<HTMLElement>('[data-role="timer-display"]');
      const timerStopButton = root.querySelector<HTMLButtonElement>('[data-role="timer-stop"]');
      const timerDiscardButton = root.querySelector<HTMLButtonElement>(
        '[data-role="timer-discard"]',
      );
      const stopConfirm = root.querySelector<HTMLElement>('[data-role="stop-confirm"]');
      const stopMessage = root.querySelector<HTMLElement>('[data-role="stop-message"]');
      const stopSaveButton = root.querySelector<HTMLButtonElement>('[data-role="stop-save"]');
      const stopEditButton = root.querySelector<HTMLButtonElement>('[data-role="stop-edit"]');
      const stopDiscardButton = root.querySelector<HTMLButtonElement>('[data-role="stop-discard"]');
      const noteInput = root.querySelector<HTMLInputElement>('[data-role="note-input"]');
      const entryList = root.querySelector<HTMLElement>('[data-role="entry-list"]');
      const rangeTotal = root.querySelector<HTMLElement>('[data-role="range-total"]');
      const rangeTotalValue = root.querySelector<HTMLElement>('[data-role="range-total-value"]');
      const exportButton = root.querySelector<HTMLButtonElement>('[data-role="export-xlsx"]');
      const filterButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-range]'));
      const rangeToggle = root.querySelector<HTMLButtonElement>('[data-role="range-toggle"]');
      const rangeLabel = root.querySelector<HTMLElement>('[data-role="range-label"]');
      const reportedFilter = root.querySelector<HTMLInputElement>('[data-role="filter-reported"]');
      const rangePopover = root.querySelector<HTMLElement>('[data-role="range-popover"]');
      const rangeMonth = root.querySelector<HTMLElement>('[data-role="range-month"]');
      const rangePrev = root.querySelector<HTMLButtonElement>('[data-role="range-prev"]');
      const rangeNext = root.querySelector<HTMLButtonElement>('[data-role="range-next"]');
      const rangeWeekdays = root.querySelector<HTMLElement>('[data-role="range-weekdays"]');
      const rangeGrid = root.querySelector<HTMLElement>('[data-role="range-grid"]');
      const rangeCancel = root.querySelector<HTMLButtonElement>('[data-role="range-cancel"]');
      const rangeApply = root.querySelector<HTMLButtonElement>('[data-role="range-apply"]');

      if (
        !taskInput ||
        !taskDropdown ||
        !taskToggle ||
        !taskRow ||
        !taskEditButton ||
        !taskHint ||
        !taskControls ||
        !timerStartButton ||
        !entryAddButton ||
        !entryAddToggle ||
        !entryAddDuration ||
        !durationMenu ||
        !timerState ||
        !timerTaskLabel ||
        !timerDisplay ||
        !timerStopButton ||
        !timerDiscardButton ||
        !stopConfirm ||
        !stopMessage ||
        !stopSaveButton ||
        !stopEditButton ||
        !stopDiscardButton ||
        !noteInput ||
        !entryList ||
        !rangeTotal ||
        !rangeTotalValue ||
        !exportButton ||
        !rangeToggle ||
        !rangeLabel ||
        !reportedFilter ||
        !rangePopover ||
        !rangeMonth ||
        !rangePrev ||
        !rangeNext ||
        !rangeWeekdays ||
        !rangeGrid ||
        !rangeCancel ||
        !rangeApply
      ) {
        throw new Error('Missing time tracker panel elements');
      }

      let instances: Instance[] = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
      let selectedInstanceId = DEFAULT_INSTANCE_ID;
      let tasks: Task[] = [];
      let entries: Entry[] = [];
      let activeTimer: ActiveTimer | null = null;
      let selectedTaskId: string | null = null;
      let selectedDuration = 30;
      let includeReported = false;
      let stopEntry: Entry | null = null;
      let isVisible = true;
      let taskRefreshToken = 0;
      let entryRefreshToken = 0;
      let taskDropdownOpen = false;
      let suppressTaskBlur = false;
      let taskOptions: TaskOption[] = [];
      let taskHighlightIndex = 0;
      let timerInterval: number | null = null;
      let dateRange: DateRange = {
        start: toDateString(new Date()),
        end: toDateString(new Date()),
        preset: 'today',
      };
      let rangeDraftStart = dateRange.start;
      let rangeDraftEnd = dateRange.end;
      let rangeDraftMonth = new Date();
      let isRangeDragging = false;
      let chromeController: PanelChromeController | null = null;

      const stored = host.loadPanelState();
      if (stored && typeof stored === 'object') {
        const data = stored as Record<string, unknown>;
        if (typeof data['instanceId'] === 'string') {
          selectedInstanceId = data['instanceId'];
        }
        if (typeof data['selectedTaskId'] === 'string') {
          selectedTaskId = data['selectedTaskId'];
        }
        if (typeof data['rangeStart'] === 'string' && typeof data['rangeEnd'] === 'string') {
          dateRange = {
            start: data['rangeStart'] as string,
            end: data['rangeEnd'] as string,
            preset:
              data['rangePreset'] === 'today' ||
              data['rangePreset'] === 'week' ||
              data['rangePreset'] === 'month' ||
              data['rangePreset'] === 'range'
                ? (data['rangePreset'] as RangePreset)
                : 'range',
          };
        }
        if (typeof data['duration'] === 'number' && data['duration'] > 0) {
          selectedDuration = data['duration'] as number;
        }
        if (typeof data['includeReported'] === 'boolean') {
          includeReported = data['includeReported'] as boolean;
        }
      }

      const contextKey = getPanelContextKey(host.panelId());

      function updatePanelContext(): void {
        const task = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null;
        const contextAttributes: Record<string, string> = {
          'instance-id': selectedInstanceId,
        };
        if (task) {
          contextAttributes['task-id'] = task.id;
          contextAttributes['task-name'] = task.name;
        }
        host.setContext(contextKey, {
          type: 'time-tracker',
          id: selectedTaskId ?? selectedInstanceId,
          name: task?.name ?? 'Time Tracker',
          instance_id: selectedInstanceId,
          task_id: selectedTaskId,
          task_name: task?.name ?? null,
          contextAttributes,
        });
        services.notifyContextAvailabilityChange();
      }

      function persistState(): void {
        host.persistPanelState({
          instanceId: selectedInstanceId,
          selectedTaskId,
          rangeStart: dateRange.start,
          rangeEnd: dateRange.end,
          rangePreset: dateRange.preset,
          duration: selectedDuration,
          includeReported,
        });
      }

      const callInstanceOperation = async <T>(
        operation: string,
        body: Record<string, unknown>,
      ): Promise<T> =>
        callOperation(operation, {
          ...body,
          instance_id: selectedInstanceId,
        });

      function getInstanceLabel(instanceId: string): string {
        const match = instances.find((instance) => instance.id === instanceId);
        return match?.label ?? formatInstanceLabel(instanceId);
      }

      function updatePanelMetadata(): void {
        if (selectedInstanceId === DEFAULT_INSTANCE_ID) {
          host.setPanelMetadata({ title: 'Time Tracker' });
          return;
        }
        host.setPanelMetadata({
          title: `Time Tracker (${getInstanceLabel(selectedInstanceId)})`,
        });
      }

      function renderInstanceSelect(): void {
        chromeController?.setInstances(instances, [selectedInstanceId]);
      }

      function setActiveInstance(instanceId: string): void {
        if (instanceId === selectedInstanceId) {
          return;
        }
        selectedInstanceId = instanceId;
        selectedTaskId = null;
        tasks = [];
        entries = [];
        activeTimer = null;
        stopEntry = null;
        noteInput.value = '';
        clearTimerInterval();
        updateTaskInputValue();
        updateTrackState();
        renderEntries();
        renderInstanceSelect();
        updatePanelMetadata();
        updatePanelContext();
        persistState();
        void refreshTasks({ silent: true });
        void refreshEntries({ silent: true });
        void refreshTimer({ silent: true });
      }

      async function refreshInstances(options?: { silent?: boolean }): Promise<void> {
        try {
          const raw = await callOperation<unknown>('instance_list', {});
          const list = Array.isArray(raw) ? raw.map(parseInstance).filter(Boolean) : [];
          const resolved =
            list.length > 0
              ? (list as Instance[])
              : [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          instances = resolved;
          const hasSelected = instances.some((instance) => instance.id === selectedInstanceId);
          if (!hasSelected) {
            selectedInstanceId = DEFAULT_INSTANCE_ID;
            persistState();
          }
          renderInstanceSelect();
          updatePanelMetadata();
        } catch (error) {
          if (!options?.silent) {
            setStatus('Failed to load instances');
          }
          console.error('Failed to refresh instances', error);
          instances = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          renderInstanceSelect();
          updatePanelMetadata();
        }
      }

      function sortTasks(list: Task[]): Task[] {
        return [...list].sort((a, b) => compareTimestampsDesc(a.updated_at, b.updated_at));
      }

      function getTaskById(id: string | null): Task | null {
        if (!id) {
          return null;
        }
        return tasks.find((task) => task.id === id) ?? null;
      }

      function setStatus(message: string): void {
        services.setStatus(message);
      }

      function updateTaskInputValue(): void {
        const task = getTaskById(selectedTaskId);
        if (task) {
          taskInput.value = task.name;
          return;
        }
        if (!taskDropdownOpen) {
          taskInput.value = '';
        }
      }

      function updateTrackState(): void {
        const hasTimer = !!activeTimer;
        const hasStopEntry = !!stopEntry;
        const hasTask = !!selectedTaskId;

        if (hasTimer || hasStopEntry) {
          closeTaskDropdown();
          closeDurationMenu();
        }

        setVisible(taskRow, !hasTimer && !hasStopEntry);
        setVisible(taskControls, !hasTimer && !hasStopEntry);
        setVisible(taskHint, !hasTimer && !hasStopEntry && !hasTask);
        setVisible(taskEditButton, !hasTimer && !hasStopEntry && hasTask);
        setVisible(timerState, hasTimer && !hasStopEntry);
        setVisible(stopConfirm, hasStopEntry);

        timerStartButton.disabled = !hasTask || hasTimer || hasStopEntry;
        entryAddButton.disabled = !hasTask || hasTimer || hasStopEntry;
        entryAddToggle.disabled = !hasTask || hasTimer || hasStopEntry;
        noteInput.disabled = !hasTask && !hasTimer && !hasStopEntry;

        const task = getTaskById(selectedTaskId);
        if (task && timerTaskLabel) {
          timerTaskLabel.textContent = task.name;
        }
      }

      function updateDurationLabel(): void {
        entryAddDuration.textContent = formatDurationHhMm(selectedDuration);
      }

      function clearTimerInterval(): void {
        if (timerInterval) {
          window.clearInterval(timerInterval);
          timerInterval = null;
        }
      }

      function computeElapsedSeconds(timer: ActiveTimer): number {
        const resumedAt = new Date(timer.last_resumed_at);
        const delta = Math.max(0, Date.now() - resumedAt.getTime());
        return timer.accumulated_seconds + Math.floor(delta / 1000);
      }

      function updateTimerDisplay(): void {
        if (!activeTimer) {
          return;
        }
        const seconds = computeElapsedSeconds(activeTimer);
        timerDisplay.textContent = formatTimerDisplay(seconds);
      }

      function startTimerInterval(): void {
        clearTimerInterval();
        if (!activeTimer) {
          return;
        }
        updateTimerDisplay();
        timerInterval = window.setInterval(updateTimerDisplay, 1000);
      }

      function refreshRangeLabel(): void {
        rangeLabel.textContent =
          dateRange.preset === 'range'
            ? formatRangeLabel(dateRange.start, dateRange.end)
            : dateRange.preset === 'today'
              ? 'Today'
              : dateRange.preset === 'week'
                ? 'This week'
                : 'This month';
      }

      function applyPreset(preset: RangePreset): void {
        const now = new Date();
        let start = dateRange.start;
        let end = dateRange.end;
        if (preset === 'today') {
          start = toDateString(now);
          end = start;
        } else if (preset === 'week') {
          start = toDateString(startOfWeek(now));
          end = toDateString(endOfWeek(now));
        } else if (preset === 'month') {
          start = toDateString(startOfMonth(now));
          end = toDateString(endOfMonth(now));
        }
        dateRange = { start, end, preset };
        refreshRangeLabel();
        persistState();
        void refreshEntries();
      }

      function setCustomRange(start: string, end: string): void {
        dateRange = { start, end, preset: 'range' };
        refreshRangeLabel();
        persistState();
        void refreshEntries();
      }

      function renderFilterButtons(): void {
        filterButtons.forEach((button) => {
          const preset = button.dataset['range'] as RangePreset | undefined;
          if (!preset) {
            return;
          }
          button.classList.toggle('active', dateRange.preset === preset);
        });
      }

      function renderEntries(): void {
        const sorted = [...entries].sort((a, b) => {
          const dateCompare = compareDatesDesc(a.entry_date, b.entry_date);
          if (dateCompare !== 0) {
            return dateCompare;
          }
          return compareTimestampsDesc(a.updated_at, b.updated_at);
        });

        entryList.innerHTML = '';
        exportButton.disabled = sorted.length === 0;

        if (sorted.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'time-tracker-empty';
          empty.textContent = 'No entries for this period.';
          entryList.appendChild(empty);
          rangeTotalValue.textContent = 'Total: 0m';
          return;
        }

        let currentDate: string | null = null;
        let groupContainer: HTMLElement | null = null;
        let groupTotalMinutes = 0;
        let totalMinutes = 0;

        const flushGroup = (): void => {
          if (!groupContainer || !currentDate) {
            return;
          }
          const header = groupContainer.querySelector<HTMLElement>(
            '.time-tracker-entry-group-header',
          );
          if (header) {
            const totalEl = header.querySelector<HTMLElement>('.time-tracker-entry-group-total');
            if (totalEl) {
              totalEl.textContent = formatDuration(groupTotalMinutes);
            }
          }
          groupTotalMinutes = 0;
        };

        for (const entry of sorted) {
          if (entry.entry_date !== currentDate) {
            flushGroup();
            currentDate = entry.entry_date;
            groupContainer = document.createElement('div');
            groupContainer.className = 'time-tracker-entry-group';

            const header = document.createElement('div');
            header.className = 'time-tracker-entry-group-header';

            const dateLabel = document.createElement('span');
            dateLabel.className = 'time-tracker-entry-group-date';
            dateLabel.textContent = formatDateLabel(entry.entry_date, { includeYear: true });
            header.appendChild(dateLabel);

            const totalLabel = document.createElement('span');
            totalLabel.className = 'time-tracker-entry-group-total';
            totalLabel.textContent = '0m';
            header.appendChild(totalLabel);

            groupContainer.appendChild(header);
            entryList.appendChild(groupContainer);
          }

          if (!groupContainer) {
            continue;
          }

          const row = document.createElement('div');
          row.className = 'time-tracker-entry-row';

          const info = document.createElement('div');
          info.className = 'time-tracker-entry-info';

          const taskName = document.createElement('div');
          taskName.className = 'time-tracker-entry-task';
          const task = getTaskById(entry.task_id);
          taskName.textContent = task ? task.name : 'Unknown task';
          info.appendChild(taskName);

          const duration = document.createElement('div');
          duration.className = 'time-tracker-entry-duration';
          duration.textContent = formatDuration(entry.duration_minutes);
          info.appendChild(duration);

          const actions = document.createElement('div');
          actions.className = 'time-tracker-entry-actions';

          const editButton = document.createElement('button');
          editButton.type = 'button';
          editButton.className = 'time-tracker-entry-action';
          editButton.textContent = 'Edit';
          editButton.addEventListener('click', () => {
            openEntryEditor(entry);
          });
          actions.appendChild(editButton);

          const deleteButton = document.createElement('button');
          deleteButton.type = 'button';
          deleteButton.className = 'time-tracker-entry-action danger';
          deleteButton.innerHTML = ICONS.trash;
          deleteButton.setAttribute('aria-label', 'Delete entry');
          deleteButton.title = 'Delete entry';

          // Inline confirmation elements
          const confirmContainer = document.createElement('div');
          confirmContainer.className = 'time-tracker-entry-confirm';

          const confirmLabel = document.createElement('span');
          confirmLabel.className = 'time-tracker-entry-confirm-label';
          confirmLabel.textContent = 'Delete?';
          confirmContainer.appendChild(confirmLabel);

          const confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          confirmBtn.className = 'time-tracker-entry-action confirm';
          confirmBtn.innerHTML = ICONS.check;
          confirmBtn.title = 'Confirm delete';
          confirmContainer.appendChild(confirmBtn);

          const cancelBtn = document.createElement('button');
          cancelBtn.type = 'button';
          cancelBtn.className = 'time-tracker-entry-action cancel';
          cancelBtn.innerHTML = ICONS.x;
          cancelBtn.title = 'Cancel';
          confirmContainer.appendChild(cancelBtn);

          deleteButton.addEventListener('click', () => {
            row.classList.add('confirming');
          });

          confirmBtn.addEventListener('click', async () => {
            await deleteEntry(entry.id);
          });

          cancelBtn.addEventListener('click', () => {
            row.classList.remove('confirming');
          });

          actions.appendChild(deleteButton);
          actions.appendChild(confirmContainer);

          const rowTop = document.createElement('div');
          rowTop.className = 'time-tracker-entry-row-top';
          rowTop.appendChild(info);
          rowTop.appendChild(actions);
          row.appendChild(rowTop);

          const meta = document.createElement('div');
          meta.className = 'time-tracker-entry-meta';

          const createdAt = document.createElement('span');
          createdAt.className = 'time-tracker-entry-created';
          createdAt.textContent = formatCreatedAt(entry.created_at);
          meta.appendChild(createdAt);

          if (entry.note) {
            const note = document.createElement('span');
            note.className = 'time-tracker-entry-note';
            note.textContent = entry.note;
            meta.appendChild(note);
          }

          row.appendChild(meta);

          groupContainer.appendChild(row);
          groupTotalMinutes += entry.duration_minutes;
          totalMinutes += entry.duration_minutes;
        }

        flushGroup();
        rangeTotalValue.textContent = `Total: ${formatDuration(totalMinutes)}`;
      }

      function buildExportRows(): {
        rows: ExportRow[];
        totalMinutes: number;
        entryCount: number;
        taskCount: number;
      } {
        function normalizeExportNote(note: string): string {
          return note.replace(/^[-*•–—]\s+/, '');
        }

        const taskMap = new Map<
          string,
          { item: string; totalMinutes: number; notes: Map<string, string> }
        >();
        let totalMinutes = 0;
        for (const entry of entries) {
          totalMinutes += entry.duration_minutes;
          const task = getTaskById(entry.task_id);
          const item = task ? task.name : 'Unknown task';
          const existing =
            taskMap.get(entry.task_id) ??
            ({ item, totalMinutes: 0, notes: new Map<string, string>() } as const);
          const next = {
            item: existing.item,
            totalMinutes: existing.totalMinutes + entry.duration_minutes,
            notes: existing.notes,
          };
          const rawNote = entry.note.trim();
          if (rawNote) {
            const normalizedNote = normalizeExportNote(rawNote);
            if (!normalizedNote) {
              continue;
            }
            const key = normalizedNote.toLowerCase();
            if (!next.notes.has(key)) {
              next.notes.set(key, normalizedNote);
            }
          }
          taskMap.set(entry.task_id, next);
        }
        const rows = Array.from(taskMap.values())
          .map((record) => {
            const notes = Array.from(record.notes.values());
            const description =
              notes.length > 0 ? notes.map((note) => `• ${note}`).join('\n') : '';
            return {
              item: record.item,
              total_minutes: record.totalMinutes,
              description,
            };
          })
          .sort((a, b) => a.item.localeCompare(b.item));
        return {
          rows,
          totalMinutes,
          entryCount: entries.length,
          taskCount: rows.length,
        };
      }

      async function exportXlsx(
        rows: ExportRow[],
        markReported: boolean,
      ): Promise<{ artifact: ArtifactMetadata; instanceId: string }> {
        const raw = await callInstanceOperation<unknown>('export_xlsx', {
          rows,
          start_date: dateRange.start,
          end_date: dateRange.end,
        });
        if (!raw || typeof raw !== 'object') {
          throw new Error('Failed to export XLSX');
        }
        const payload = raw as { filename?: string; mimeType?: string; content?: string };
        if (!payload.content || !payload.filename) {
          throw new Error('Failed to export XLSX');
        }
        const mimeType =
          payload.mimeType ??
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        const artifactsInstanceId = await resolveArtifactsInstanceId(selectedInstanceId);
        const artifact = await callArtifactsOperation<ArtifactMetadata>('upload', {
          instance_id: artifactsInstanceId,
          title: payload.filename,
          filename: payload.filename,
          content: payload.content,
          mimeType,
        });

        if (markReported) {
          const toReport = entries.filter((entry) => !entry.reported);
          for (const entry of toReport) {
            await callInstanceOperation('entry_update', { id: entry.id, reported: true });
          }
          void refreshEntries({ silent: true });
          void refreshTasks({ silent: true });
        }
        setStatus('Exported XLSX to Artifacts.');
        return { artifact, instanceId: artifactsInstanceId };
      }

      function openExportDialog(): void {
        if (entries.length === 0) {
          setStatus('No entries to export.');
          return;
        }
        const { rows, totalMinutes, entryCount, taskCount } = buildExportRows();
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        const decimalHours = totalMinutes / 60;

        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay time-tracker-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog time-tracker-dialog time-tracker-export-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        const title = document.createElement('h3');
        title.className = 'confirm-dialog-title';
        title.textContent = 'Export XLSX';
        dialog.appendChild(title);

        const form = document.createElement('form');
        form.className = 'list-item-form';

        const summary = document.createElement('div');
        summary.className = 'time-tracker-export-summary';
        summary.innerHTML = `
          <div><strong>Entries:</strong> ${entryCount}</div>
          <div><strong>Tasks:</strong> ${taskCount}</div>
          <div><strong>Total:</strong> ${hours}h ${minutes}m (${decimalHours.toFixed(2)}h)</div>
        `;
        form.appendChild(summary);

        const error = document.createElement('p');
        error.className = 'time-tracker-form-error';
        error.textContent = '';
        form.appendChild(error);

        const checkboxRow = document.createElement('div');
        checkboxRow.className = 'list-item-form-checkbox-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'list-item-form-checkbox';
        checkbox.id = `time-tracker-export-reported-${Math.random().toString(36).slice(2)}`;
        checkbox.checked = true;

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.textContent = 'Mark exported entries as reported';

        checkboxRow.appendChild(checkbox);
        checkboxRow.appendChild(checkboxLabel);
        form.appendChild(checkboxRow);

        const buttons = document.createElement('div');
        buttons.className = 'confirm-dialog-buttons';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'confirm-dialog-button cancel';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => {
          closeDialog();
        });
        buttons.appendChild(cancelButton);

        const exportBtn = document.createElement('button');
        exportBtn.type = 'submit';
        exportBtn.className = 'confirm-dialog-button primary';
        exportBtn.textContent = 'Export';
        buttons.appendChild(exportBtn);

        form.appendChild(buttons);
        dialog.appendChild(form);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        services.dialogManager.hasOpenDialog = true;

        const closeDialog = (): void => {
          overlay.remove();
          document.removeEventListener('keydown', handleKeyDown);
          services.dialogManager.hasOpenDialog = false;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
          }
        };

        document.addEventListener('keydown', handleKeyDown);

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          error.textContent = '';
          exportBtn.disabled = true;
          try {
            const result = await exportXlsx(rows, checkbox.checked);
            const downloadUrl = buildArtifactsDownloadUrl({
              instanceId: result.instanceId,
              artifactId: result.artifact.id,
            });

            form.innerHTML = '';
            const success = document.createElement('div');
            success.className = 'time-tracker-export-summary';

            const headline = document.createElement('div');
            const strong = document.createElement('strong');
            strong.textContent = 'Export complete.';
            headline.appendChild(strong);
            success.appendChild(headline);

            const downloadRow = document.createElement('div');
            downloadRow.textContent = 'Download: ';
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.target = '_blank';
            link.rel = 'noopener';
            link.textContent = result.artifact.filename;
            downloadRow.appendChild(link);
            success.appendChild(downloadRow);

            form.appendChild(success);

            const closeRow = document.createElement('div');
            closeRow.className = 'confirm-dialog-buttons';
            const closeButton = document.createElement('button');
            closeButton.type = 'button';
            closeButton.className = 'confirm-dialog-button primary';
            closeButton.textContent = 'Close';
            closeButton.addEventListener('click', () => {
              closeDialog();
            });
            closeRow.appendChild(closeButton);
            form.appendChild(closeRow);
          } catch (err) {
            error.textContent = (err as Error).message || 'Failed to export XLSX.';
            exportBtn.disabled = false;
          }
        });
      }

      function renderDurationMenu(): void {
        durationMenu.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'time-tracker-duration-list';
        for (const minutes of DURATION_PRESETS) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'time-tracker-duration-item';
          item.textContent = formatDurationHhMm(minutes);
          item.addEventListener('click', () => {
            selectedDuration = minutes;
            updateDurationLabel();
            persistState();
            closeDurationMenu();
            void addManualEntry(minutes);
          });
          list.appendChild(item);
        }
        const custom = document.createElement('button');
        custom.type = 'button';
        custom.className = 'time-tracker-duration-item';
        custom.textContent = 'Custom...';
        custom.addEventListener('click', () => {
          closeDurationMenu();
          openCustomDurationDialog();
        });
        list.appendChild(custom);
        durationMenu.appendChild(list);
      }

      function openDurationMenu(): void {
        durationMenu.classList.add('open');
      }

      function closeDurationMenu(): void {
        durationMenu.classList.remove('open');
      }

      function toggleDurationMenu(): void {
        if (durationMenu.classList.contains('open')) {
          closeDurationMenu();
        } else {
          openDurationMenu();
        }
      }

      function buildTaskOptions(query: string): TaskOption[] {
        const normalized = query.trim().toLowerCase();
        const filtered = normalized.length
          ? tasks.filter((task) => task.name.toLowerCase().includes(normalized))
          : tasks;
        const options: TaskOption[] = [
          {
            type: 'create',
            label: normalized.length ? `Create "${query}"` : 'Create new task',
            query: query.trim(),
          },
          ...filtered.map((task) => ({ type: 'task', label: task.name, task }) as TaskOption),
        ];
        return options;
      }

      function renderTaskDropdown(): void {
        const query = taskInput.value;
        const normalizedQuery = query.trim().toLowerCase();
        taskOptions = buildTaskOptions(query);
        if (taskOptions.length === 0) {
          taskHighlightIndex = 0;
        } else if (normalizedQuery.length > 0) {
          const matchIndex = taskOptions.findIndex(
            (option) =>
              option.type === 'task' && option.task.name.trim().toLowerCase() === normalizedQuery,
          );
          if (matchIndex >= 0) {
            taskHighlightIndex = matchIndex;
          } else {
            taskHighlightIndex = Math.min(taskHighlightIndex, taskOptions.length - 1);
          }
        } else {
          taskHighlightIndex = Math.min(taskHighlightIndex, taskOptions.length - 1);
        }
        taskDropdown.innerHTML = '';

        taskOptions.forEach((option, index) => {
          const item = document.createElement('div');
          item.className = 'time-tracker-task-option';
          if (index === taskHighlightIndex) {
            item.classList.add('active');
          }
          if (option.type === 'create') {
            item.classList.add('create');
          }
          item.textContent = option.label;
          item.addEventListener('mouseenter', () => {
            taskHighlightIndex = index;
            updateTaskHighlight();
          });
          item.addEventListener('click', () => {
            selectTaskOption(option);
          });
          taskDropdown.appendChild(item);
        });
      }

      function updateTaskHighlight(): void {
        const items = Array.from(
          taskDropdown.querySelectorAll<HTMLElement>('.time-tracker-task-option'),
        );
        items.forEach((item, index) => {
          item.classList.toggle('active', index === taskHighlightIndex);
        });
      }

      function openTaskDropdown(): void {
        taskDropdownOpen = true;
        taskHighlightIndex = 0;
        renderTaskDropdown();
        taskDropdown.classList.add('open');
      }

      function closeTaskDropdown(): void {
        taskDropdownOpen = false;
        taskDropdown.classList.remove('open');
      }

      function clearTaskFilter(): void {
        selectedTaskId = null;
        updateTaskInputValue();
        updateTrackState();
        updatePanelContext();
        persistState();
        void refreshEntries({ silent: true });
      }

      function selectTaskOption(option: TaskOption): void {
        if (option.type === 'create') {
          const name = option.query.trim();
          // If no name provided, clear filter instead
          if (!name) {
            clearTaskFilter();
            closeTaskDropdown();
            taskInput.blur();
            return;
          }
          void (async () => {
            try {
              const created = await createTask(name, '');
              if (created) {
                selectedTaskId = created.id;
                updateTaskInputValue();
                updateTrackState();
                updatePanelContext();
                persistState();
                void refreshEntries({ silent: true });
              }
            } catch (error) {
              setStatus((error as Error).message || 'Failed to create task');
            }
          })();
        } else {
          selectedTaskId = option.task.id;
          updateTaskInputValue();
          updateTrackState();
          updatePanelContext();
          persistState();
          void refreshEntries({ silent: true });
        }
        closeTaskDropdown();
        taskInput.blur();
      }

      function updateTaskList(newTasks: Task[]): void {
        const previousSelection = selectedTaskId;
        tasks = sortTasks(newTasks);
        if (selectedTaskId && !getTaskById(selectedTaskId)) {
          selectedTaskId = null;
        }
        updateTaskInputValue();
        updateTrackState();
        // Update context since tasks list changed (task name might have changed)
        updatePanelContext();
        if (taskDropdownOpen) {
          renderTaskDropdown();
        }
        // Always re-render entries since they display task names
        renderEntries();
        if (previousSelection && !selectedTaskId) {
          void refreshEntries({ silent: true });
        }
      }

      async function refreshTasks(options?: { silent?: boolean }): Promise<void> {
        const token = ++taskRefreshToken;
        try {
          const raw = await callInstanceOperation<unknown>('task_list', {});
          if (token !== taskRefreshToken) {
            return;
          }
          const list = Array.isArray(raw) ? raw.map(parseTask).filter(Boolean) : [];
          updateTaskList(list as Task[]);
        } catch (error) {
          if (!options?.silent) {
            setStatus('Failed to load tasks');
          }
          console.error('Failed to refresh tasks', error);
        }
      }

      async function refreshEntries(options?: { silent?: boolean }): Promise<void> {
        const token = ++entryRefreshToken;
        try {
          const raw = await callInstanceOperation<unknown>('entry_list', {
            start_date: dateRange.start,
            end_date: dateRange.end,
            ...(selectedTaskId ? { task_id: selectedTaskId } : {}),
            include_reported: includeReported,
          });
          if (token !== entryRefreshToken) {
            return;
          }
          const list = Array.isArray(raw) ? raw.map(parseEntry).filter(Boolean) : [];
          entries = list as Entry[];
          renderEntries();
        } catch (error) {
          if (!options?.silent) {
            setStatus('Failed to load entries');
          }
          console.error('Failed to refresh entries', error);
        }
      }

      async function refreshTimer(options?: { silent?: boolean }): Promise<void> {
        try {
          const previousSelection = selectedTaskId;
          const raw = await callInstanceOperation<unknown>('timer_status', {});
          activeTimer = raw ? parseTimer(raw) : null;
          if (activeTimer) {
            selectedTaskId = activeTimer.task_id;
            updateTaskInputValue();
          }
          updateTrackState();
          startTimerInterval();
          if (activeTimer && selectedTaskId !== previousSelection) {
            updatePanelContext();
            void refreshEntries({ silent: true });
          }
        } catch (error) {
          if (!options?.silent) {
            setStatus('Failed to load timer');
          }
          console.error('Failed to refresh timer', error);
        }
      }

      async function createTask(name: string, description: string): Promise<Task> {
        const raw = await callInstanceOperation<unknown>('task_create', {
          name,
          ...(description ? { description } : {}),
        });
        const task = parseTask(raw);
        if (!task) {
          throw new Error('Failed to create task');
        }
        tasks = sortTasks([task, ...tasks.filter((item) => item.id !== task.id)]);
        updateTaskList(tasks);
        return task;
      }

      async function updateTask(taskId: string, name: string, description: string): Promise<Task> {
        const raw = await callInstanceOperation<unknown>('task_update', {
          id: taskId,
          name,
          description,
        });
        const task = parseTask(raw);
        if (!task) {
          throw new Error('Failed to update task');
        }
        tasks = sortTasks([task, ...tasks.filter((item) => item.id !== task.id)]);
        updateTaskList(tasks);
        return task;
      }

      async function deleteTask(taskId: string): Promise<boolean> {
        try {
          await callInstanceOperation('task_delete', { id: taskId });
          tasks = tasks.filter((task) => task.id !== taskId);
          updateTaskList(tasks);
          if (selectedTaskId === taskId) {
            selectedTaskId = null;
            updatePanelContext();
          }
          updateTrackState();
          persistState();
          void refreshEntries({ silent: true });
          return true;
        } catch (error) {
          setStatus((error as Error).message || 'Failed to delete task');
          return false;
        }
      }

      async function addManualEntry(durationMinutes: number): Promise<void> {
        const taskId = selectedTaskId;
        if (!taskId) {
          setStatus('Select a task first');
          return;
        }
        try {
          await callInstanceOperation('entry_create', {
            task_id: taskId,
            duration_minutes: durationMinutes,
            entry_date: toDateString(new Date()),
            note: noteInput.value.trim(),
          });
          noteInput.value = '';
          void refreshEntries({ silent: true });
          void refreshTasks({ silent: true });
        } catch (error) {
          setStatus((error as Error).message || 'Failed to create entry');
        }
      }

      async function startTimer(): Promise<void> {
        const taskId = selectedTaskId;
        if (!taskId) {
          setStatus('Select a task first');
          return;
        }
        try {
          const raw = await callInstanceOperation<unknown>('timer_start', { task_id: taskId });
          activeTimer = parseTimer(raw);
          updateTrackState();
          startTimerInterval();
        } catch (error) {
          setStatus((error as Error).message || 'Failed to start timer');
        }
      }

      async function discardTimer(): Promise<void> {
        try {
          await callInstanceOperation('timer_discard', {});
          activeTimer = null;
          stopEntry = null;
          updateTrackState();
          clearTimerInterval();
        } catch (error) {
          setStatus((error as Error).message || 'Failed to discard timer');
        }
      }

      async function stopTimer(): Promise<void> {
        try {
          const raw = await callInstanceOperation<unknown>('timer_stop', {
            note: noteInput.value.trim(),
          });
          const data = raw as { entry?: unknown };
          const entry = data.entry ? parseEntry(data.entry) : null;
          activeTimer = null;
          clearTimerInterval();
          stopEntry = null;
          stopMessage.textContent = '';
          noteInput.value = '';
          if (entry) {
            setStatus(`Logged ${formatDuration(entry.duration_minutes)}.`);
          }
          updateTrackState();
          void refreshEntries({ silent: true });
          void refreshTasks({ silent: true });
        } catch (error) {
          setStatus((error as Error).message || 'Failed to stop timer');
        }
      }

      async function finalizeStopEntry(saveEntry: boolean): Promise<void> {
        if (!stopEntry) {
          return;
        }
        const currentNote = noteInput.value.trim();
        let updateFailed = false;
        if (saveEntry && currentNote !== stopEntry.note) {
          try {
            const raw = await callInstanceOperation<unknown>('entry_update', {
              id: stopEntry.id,
              note: currentNote,
            });
            const updated = parseEntry(raw);
            if (updated) {
              stopEntry = updated;
            }
          } catch (error) {
            setStatus((error as Error).message || 'Failed to update entry');
            updateFailed = true;
          }
        }
        if (updateFailed) {
          return;
        }
        stopEntry = null;
        noteInput.value = '';
        updateTrackState();
      }

      async function discardStopEntry(): Promise<void> {
        if (!stopEntry) {
          return;
        }
        try {
          await callInstanceOperation('entry_delete', { id: stopEntry.id });
        } catch (error) {
          setStatus((error as Error).message || 'Failed to delete entry');
          return;
        }
        stopEntry = null;
        noteInput.value = '';
        updateTrackState();
        void refreshEntries({ silent: true });
      }

      async function openCustomDurationDialog(): Promise<void> {
        const value = await services.dialogManager.showTextInputDialog({
          title: 'Custom Duration',
          message: 'Enter a duration (e.g. 1:30, 90m, 1.5h).',
          confirmText: 'Add Entry',
          labelText: 'Duration',
          initialValue: formatDurationHhMm(selectedDuration),
          validate: (input) => {
            const parsed = parseDurationInput(input);
            return parsed ? null : 'Enter a valid duration.';
          },
        });
        if (value === null) {
          return;
        }
        const parsed = parseDurationInput(value);
        if (!parsed) {
          setStatus('Invalid duration');
          return;
        }
        selectedDuration = parsed;
        updateDurationLabel();
        persistState();
        void addManualEntry(parsed);
      }

      function openTaskEditor(options: {
        mode: 'create' | 'edit';
        task?: Task | null;
        initialName?: string;
        onSave: (name: string, description: string) => Promise<void>;
      }): Promise<void> {
        return new Promise((resolve) => {
          const overlay = document.createElement('div');
          overlay.className = 'confirm-dialog-overlay time-tracker-dialog-overlay';

          const dialog = document.createElement('div');
          dialog.className = 'confirm-dialog time-tracker-dialog';
          dialog.setAttribute('role', 'dialog');
          dialog.setAttribute('aria-modal', 'true');

          const title = document.createElement('h3');
          title.className = 'confirm-dialog-title';
          title.textContent = options.mode === 'create' ? 'Create Task' : 'Edit Task';
          dialog.appendChild(title);

          const form = document.createElement('form');
          form.className = 'list-item-form';

          const error = document.createElement('p');
          error.className = 'time-tracker-form-error';
          error.textContent = '';
          form.appendChild(error);

          const nameLabel = document.createElement('label');
          nameLabel.className = 'list-item-form-label';
          nameLabel.textContent = 'Name';
          const nameInput = document.createElement('input');
          nameInput.type = 'text';
          nameInput.className = 'list-item-form-input';
          nameInput.value = options.task?.name ?? options.initialName ?? '';
          nameInput.required = true;
          nameLabel.appendChild(nameInput);
          form.appendChild(nameLabel);

          const descriptionLabel = document.createElement('label');
          descriptionLabel.className = 'list-item-form-label';
          descriptionLabel.textContent = 'Description';
          const descriptionInput = document.createElement('textarea');
          descriptionInput.className = 'list-item-form-textarea';
          descriptionInput.value = options.task?.description ?? '';
          descriptionLabel.appendChild(descriptionInput);
          form.appendChild(descriptionLabel);

          const buttons = document.createElement('div');
          buttons.className = 'confirm-dialog-buttons';

          const cancelButton = document.createElement('button');
          cancelButton.type = 'button';
          cancelButton.className = 'confirm-dialog-button cancel';
          cancelButton.textContent = 'Cancel';
          cancelButton.addEventListener('click', () => {
            closeDialog();
          });
          buttons.appendChild(cancelButton);

          if (options.mode === 'edit' && options.task) {
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.className = 'confirm-dialog-button danger';
            deleteButton.textContent = 'Delete Task';
            deleteButton.addEventListener('click', async () => {
              await confirmTaskDelete(options.task);
              closeDialog();
            });
            buttons.appendChild(deleteButton);
          }

          const saveButton = document.createElement('button');
          saveButton.type = 'submit';
          saveButton.className = 'confirm-dialog-button primary';
          saveButton.textContent = 'Save';
          buttons.appendChild(saveButton);

          form.appendChild(buttons);
          dialog.appendChild(form);
          overlay.appendChild(dialog);
          document.body.appendChild(overlay);
          services.dialogManager.hasOpenDialog = true;

          const closeDialog = (): void => {
            overlay.remove();
            document.removeEventListener('keydown', handleKeyDown);
            services.dialogManager.hasOpenDialog = false;
            resolve();
          };

          const handleKeyDown = (event: KeyboardEvent) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              closeDialog();
            }
          };

          document.addEventListener('keydown', handleKeyDown);

          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const name = nameInput.value.trim();
            if (!name) {
              error.textContent = 'Name is required.';
              nameInput.focus();
              return;
            }
            error.textContent = '';
            try {
              await options.onSave(name, descriptionInput.value.trim());
              closeDialog();
            } catch (err) {
              error.textContent = (err as Error).message || 'Failed to save task.';
            }
          });

          nameInput.focus();
        });
      }

      async function confirmTaskDelete(task: Task | null | undefined): Promise<void> {
        if (!task) {
          return;
        }
        let entryCount = 0;
        try {
          const raw = await callInstanceOperation<unknown>('entry_list', {
            task_id: task.id,
            include_reported: true,
          });
          if (Array.isArray(raw)) {
            entryCount = raw.length;
          }
        } catch {
          entryCount = entries.filter((entry) => entry.task_id === task.id).length;
        }
        await new Promise<void>((resolve) => {
          services.dialogManager.showConfirmDialog({
            title: 'Delete Task',
            message: `Delete "${task.name}" and all ${entryCount} entries?`,
            confirmText: 'Delete',
            confirmClassName: 'danger',
            onConfirm: async () => {
              await deleteTask(task.id);
              resolve();
            },
            onCancel: () => resolve(),
          });
        });
      }

      function openEntryEditor(entry: Entry): void {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay time-tracker-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog time-tracker-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');

        const title = document.createElement('h3');
        title.className = 'confirm-dialog-title';
        title.textContent = 'Edit Entry';
        dialog.appendChild(title);

        const form = document.createElement('form');
        form.className = 'list-item-form';

        const error = document.createElement('p');
        error.className = 'time-tracker-form-error';
        error.textContent = '';
        form.appendChild(error);

        const taskLabel = document.createElement('label');
        taskLabel.className = 'list-item-form-label';
        taskLabel.textContent = 'Task';
        const taskSelect = document.createElement('select');
        taskSelect.className = 'list-item-form-select';
        const hasTask = tasks.some((task) => task.id === entry.task_id);
        if (!hasTask) {
          const missingOption = document.createElement('option');
          missingOption.value = entry.task_id;
          missingOption.textContent = 'Unknown task';
          taskSelect.appendChild(missingOption);
        }
        tasks.forEach((task) => {
          const option = document.createElement('option');
          option.value = task.id;
          option.textContent = task.name;
          taskSelect.appendChild(option);
        });
        taskSelect.value = entry.task_id;
        taskLabel.appendChild(taskSelect);
        form.appendChild(taskLabel);

        const dateLabel = document.createElement('label');
        dateLabel.className = 'list-item-form-label';
        dateLabel.textContent = 'Date';
        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.className = 'list-item-form-input';
        dateInput.value = entry.entry_date;
        dateLabel.appendChild(dateInput);
        form.appendChild(dateLabel);

        const durationLabel = document.createElement('label');
        durationLabel.className = 'list-item-form-label';
        durationLabel.textContent = 'Duration';
        const durationInput = document.createElement('input');
        durationInput.type = 'text';
        durationInput.className = 'list-item-form-input';
        durationInput.value = formatDurationHhMm(entry.duration_minutes);
        durationLabel.appendChild(durationInput);
        form.appendChild(durationLabel);

        const noteLabel = document.createElement('label');
        noteLabel.className = 'list-item-form-label';
        noteLabel.textContent = 'Note';
        const noteField = document.createElement('textarea');
        noteField.className = 'list-item-form-textarea';
        noteField.value = entry.note;
        noteLabel.appendChild(noteField);
        form.appendChild(noteLabel);

        const reportedRow = document.createElement('div');
        reportedRow.className = 'list-item-form-checkbox-row';

        const reportedCheckbox = document.createElement('input');
        reportedCheckbox.type = 'checkbox';
        reportedCheckbox.className = 'list-item-form-checkbox';
        reportedCheckbox.id = `time-tracker-reported-${Math.random().toString(36).slice(2)}`;
        reportedCheckbox.checked = entry.reported;

        const reportedLabel = document.createElement('label');
        reportedLabel.htmlFor = reportedCheckbox.id;
        reportedLabel.textContent = 'Reported';

        reportedRow.appendChild(reportedCheckbox);
        reportedRow.appendChild(reportedLabel);
        form.appendChild(reportedRow);

        const buttons = document.createElement('div');
        buttons.className = 'confirm-dialog-buttons';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'confirm-dialog-button cancel';
        cancelButton.textContent = 'Cancel';
        cancelButton.addEventListener('click', () => {
          closeDialog();
        });
        buttons.appendChild(cancelButton);

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'confirm-dialog-button danger';
        deleteButton.textContent = 'Delete Entry';
        deleteButton.addEventListener('click', async () => {
          await deleteEntry(entry.id);
          closeDialog();
        });
        buttons.appendChild(deleteButton);

        const saveButton = document.createElement('button');
        saveButton.type = 'submit';
        saveButton.className = 'confirm-dialog-button primary';
        saveButton.textContent = 'Save';
        buttons.appendChild(saveButton);

        form.appendChild(buttons);
        dialog.appendChild(form);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        services.dialogManager.hasOpenDialog = true;

        const closeDialog = (): void => {
          overlay.remove();
          document.removeEventListener('keydown', handleKeyDown);
          services.dialogManager.hasOpenDialog = false;
        };

        const handleKeyDown = (event: KeyboardEvent) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
          }
        };

        document.addEventListener('keydown', handleKeyDown);

        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const parsedDuration = parseDurationInput(durationInput.value);
          if (!parsedDuration) {
            error.textContent = 'Enter a valid duration.';
            durationInput.focus();
            return;
          }
          if (!dateInput.value) {
            error.textContent = 'Date is required.';
            dateInput.focus();
            return;
          }
          error.textContent = '';
          try {
            await callInstanceOperation('entry_update', {
              id: entry.id,
              task_id: taskSelect.value,
              entry_date: dateInput.value,
              duration_minutes: parsedDuration,
              reported: reportedCheckbox.checked,
              note: noteField.value.trim(),
            });
            closeDialog();
            void refreshEntries({ silent: true });
            void refreshTasks({ silent: true });
          } catch (err) {
            error.textContent = (err as Error).message || 'Failed to update entry.';
          }
        });

        durationInput.focus();
      }

      async function deleteEntry(entryId: string): Promise<void> {
        try {
          await callInstanceOperation('entry_delete', { id: entryId });
          void refreshEntries({ silent: true });
          void refreshTasks({ silent: true });
        } catch (error) {
          setStatus((error as Error).message || 'Failed to delete entry');
        }
      }

      function updateRangeDraft(start: string, end: string): void {
        rangeDraftStart = start;
        rangeDraftEnd = end;
      }

      function renderRangeCalendar(): void {
        const monthLabel = rangeDraftMonth.toLocaleDateString(undefined, {
          month: 'long',
          year: 'numeric',
        });
        rangeMonth.textContent = monthLabel;

        const weekLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        rangeWeekdays.innerHTML = '';
        weekLabels.forEach((label) => {
          const cell = document.createElement('div');
          cell.className = 'time-tracker-range-weekday';
          cell.textContent = label;
          rangeWeekdays.appendChild(cell);
        });

        rangeGrid.innerHTML = '';
        const firstDay = new Date(rangeDraftMonth.getFullYear(), rangeDraftMonth.getMonth(), 1);
        const startDayOffset = (firstDay.getDay() + 6) % 7;
        const startDate = addDays(firstDay, -startDayOffset);

        const draftStart = parseDateString(rangeDraftStart);
        const draftEnd = parseDateString(rangeDraftEnd);
        const isSameMonth = (date: Date) =>
          date.getFullYear() === rangeDraftMonth.getFullYear() &&
          date.getMonth() === rangeDraftMonth.getMonth();

        for (let i = 0; i < 42; i += 1) {
          const day = addDays(startDate, i);
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'time-tracker-range-day';
          cell.textContent = String(day.getDate());
          cell.dataset['date'] = toDateString(day);
          if (!isSameMonth(day)) {
            cell.classList.add('outside');
          }
          const inRange = draftStart && draftEnd ? day >= draftStart && day <= draftEnd : false;
          if (draftStart && isSameDay(day, draftStart)) {
            cell.classList.add('start');
          }
          if (draftEnd && isSameDay(day, draftEnd)) {
            cell.classList.add('end');
          }
          if (inRange) {
            cell.classList.add('in-range');
          }
          cell.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            isRangeDragging = true;
            const dateStr = cell.dataset['date'];
            if (!dateStr) {
              return;
            }
            updateRangeDraft(dateStr, dateStr);
            renderRangeCalendar();
          });
          cell.addEventListener('mouseenter', () => {
            if (!isRangeDragging) {
              return;
            }
            const dateStr = cell.dataset['date'];
            if (!dateStr) {
              return;
            }
            updateRangeDraft(rangeDraftStart, dateStr);
            normalizeDraftRange();
            renderRangeCalendar();
          });
          cell.addEventListener('click', (event) => {
            event.stopPropagation();
            const dateStr = cell.dataset['date'];
            if (!dateStr) {
              return;
            }
            if (rangeDraftStart && rangeDraftEnd && rangeDraftStart !== rangeDraftEnd) {
              updateRangeDraft(dateStr, dateStr);
            } else if (rangeDraftStart && rangeDraftStart !== dateStr) {
              updateRangeDraft(rangeDraftStart, dateStr);
              normalizeDraftRange();
            } else {
              updateRangeDraft(dateStr, dateStr);
            }
            renderRangeCalendar();
          });
          rangeGrid.appendChild(cell);
        }
      }

      function normalizeDraftRange(): void {
        if (rangeDraftStart > rangeDraftEnd) {
          const temp = rangeDraftStart;
          rangeDraftStart = rangeDraftEnd;
          rangeDraftEnd = temp;
        }
      }

      function openRangePopover(): void {
        rangeDraftStart = dateRange.start;
        rangeDraftEnd = dateRange.end;
        const startDate = parseDateString(rangeDraftStart);
        rangeDraftMonth = startDate ?? new Date();
        renderRangeCalendar();
        rangePopover.classList.add('open');
      }

      function closeRangePopover(): void {
        rangePopover.classList.remove('open');
      }

      function handlePanelEvent(event: PanelEventEnvelope): void {
        const payload = event.payload as Record<string, unknown> | undefined;
        if (!payload || typeof payload !== 'object') {
          return;
        }
        const payloadInstance = payload['instance_id'];
        const eventInstanceId =
          typeof payloadInstance === 'string' && payloadInstance.length > 0
            ? payloadInstance
            : DEFAULT_INSTANCE_ID;
        if (eventInstanceId !== selectedInstanceId) {
          return;
        }
        const type = payload['type'];
        if (type === 'time-tracker:task:created' || type === 'time-tracker:task:updated') {
          void refreshTasks({ silent: true });
          return;
        }
        if (type === 'time-tracker:task:deleted') {
          void refreshTasks({ silent: true });
          void refreshEntries({ silent: true });
          return;
        }
        if (
          type === 'time-tracker:entry:created' ||
          type === 'time-tracker:entry:updated' ||
          type === 'time-tracker:entry:deleted'
        ) {
          void refreshEntries({ silent: true });
          void refreshTasks({ silent: true });
          return;
        }
        if (type === 'time-tracker:timer:started') {
          void refreshTimer({ silent: true });
          return;
        }
        if (type === 'time-tracker:timer:stopped' || type === 'time-tracker:timer:discarded') {
          void refreshTimer({ silent: true });
          void refreshEntries({ silent: true });
          return;
        }
        if (type === 'time-tracker:filter:set') {
          const start = payload['start_date'];
          const end = payload['end_date'];
          if (typeof start === 'string' && typeof end === 'string') {
            setCustomRange(start, end);
            renderFilterButtons();
          }
        }
      }

      function handleDocumentClick(event: MouseEvent): void {
        const target = event.target as Node;
        const taskControlClicked = taskInput.contains(target) || taskToggle.contains(target);
        if (taskDropdownOpen && !taskDropdown.contains(target) && !taskControlClicked) {
          closeTaskDropdown();
        }
        if (durationMenu.classList.contains('open') && !durationMenu.contains(target)) {
          if (!entryAddButton.contains(target) && !entryAddToggle.contains(target)) {
            closeDurationMenu();
          }
        }
        if (rangePopover.classList.contains('open') && !rangePopover.contains(target)) {
          if (!rangeToggle.contains(target)) {
            closeRangePopover();
          }
        }
      }

      const handleDocumentMouseUp = (): void => {
        if (isRangeDragging) {
          isRangeDragging = false;
        }
      };

      document.addEventListener('mousedown', handleDocumentClick);
      document.addEventListener('mouseup', handleDocumentMouseUp);

      chromeController = new PanelChromeController({
        root,
        host,
        title: 'Time Tracker',
        onInstanceChange: (instanceIds) => {
          const next = instanceIds[0] ?? DEFAULT_INSTANCE_ID;
          setActiveInstance(next);
        },
      });
      chromeController.setInstances(instances, [selectedInstanceId]);

      taskInput.addEventListener('focus', () => {
        taskInput.value = '';
        // Clear the task filter when focusing the input
        if (selectedTaskId) {
          clearTaskFilter();
        }
        if (!taskDropdownOpen) {
          openTaskDropdown();
        } else {
          renderTaskDropdown();
        }
      });

      taskDropdown.addEventListener('pointerdown', () => {
        suppressTaskBlur = true;
      });

      taskInput.addEventListener('blur', () => {
        window.setTimeout(() => {
          if (!taskDropdownOpen) {
            return;
          }
          if (suppressTaskBlur) {
            suppressTaskBlur = false;
            return;
          }
          const active = document.activeElement;
          if (
            (active && taskInput.contains(active)) ||
            (active && taskToggle.contains(active)) ||
            (active && taskDropdown.contains(active))
          ) {
            return;
          }
          closeTaskDropdown();
        }, 0);
      });

      taskInput.addEventListener('input', () => {
        if (!taskDropdownOpen) {
          openTaskDropdown();
        } else {
          taskHighlightIndex = 0;
          renderTaskDropdown();
        }
      });

      taskInput.addEventListener('keydown', (event) => {
        if (!taskDropdownOpen) {
          if (event.key === 'ArrowDown') {
            openTaskDropdown();
            event.preventDefault();
          }
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          taskHighlightIndex = Math.min(taskHighlightIndex + 1, taskOptions.length - 1);
          updateTaskHighlight();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          taskHighlightIndex = Math.max(taskHighlightIndex - 1, 0);
          updateTaskHighlight();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          const option = taskOptions[taskHighlightIndex];
          if (option) {
            selectTaskOption(option);
          }
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeTaskDropdown();
        }
      });

      taskToggle.addEventListener('click', () => {
        if (taskDropdownOpen) {
          closeTaskDropdown();
        } else {
          openTaskDropdown();
          taskInput.focus();
        }
      });

      taskEditButton.addEventListener('click', () => {
        const task = getTaskById(selectedTaskId);
        if (!task) {
          return;
        }
        void openTaskEditor({
          mode: 'edit',
          task,
          onSave: async (name, description) => {
            await updateTask(task.id, name, description);
          },
        });
      });

      timerStartButton.addEventListener('click', () => {
        void startTimer();
      });

      entryAddButton.addEventListener('click', () => {
        if (entryAddButton.disabled) {
          return;
        }
        closeDurationMenu();
        void addManualEntry(selectedDuration);
      });

      entryAddToggle.addEventListener('click', () => {
        if (entryAddButton.disabled) {
          return;
        }
        toggleDurationMenu();
      });

      timerStopButton.addEventListener('click', () => {
        void stopTimer();
      });

      timerDiscardButton.addEventListener('click', () => {
        void discardTimer();
      });

      stopSaveButton.addEventListener('click', () => {
        void finalizeStopEntry(true);
      });

      stopEditButton.addEventListener('click', () => {
        if (!stopEntry) {
          return;
        }
        openEntryEditor(stopEntry);
        void finalizeStopEntry(false);
      });

      stopDiscardButton.addEventListener('click', () => {
        void discardStopEntry();
      });

      filterButtons.forEach((button) => {
        const preset = button.dataset['range'] as RangePreset | undefined;
        if (!preset) {
          return;
        }
        button.addEventListener('click', () => {
          applyPreset(preset);
          renderFilterButtons();
        });
      });

      reportedFilter.checked = includeReported;
      reportedFilter.addEventListener('change', () => {
        includeReported = reportedFilter.checked;
        persistState();
        void refreshEntries();
      });

      exportButton.addEventListener('click', () => {
        if (exportButton.disabled) {
          return;
        }
        openExportDialog();
      });

      rangeToggle.addEventListener('click', () => {
        if (rangePopover.classList.contains('open')) {
          closeRangePopover();
        } else {
          openRangePopover();
        }
      });

      rangePrev.addEventListener('click', () => {
        rangeDraftMonth = new Date(
          rangeDraftMonth.getFullYear(),
          rangeDraftMonth.getMonth() - 1,
          1,
        );
        renderRangeCalendar();
      });

      rangeNext.addEventListener('click', () => {
        rangeDraftMonth = new Date(
          rangeDraftMonth.getFullYear(),
          rangeDraftMonth.getMonth() + 1,
          1,
        );
        renderRangeCalendar();
      });

      rangeCancel.addEventListener('click', () => {
        closeRangePopover();
      });

      rangeApply.addEventListener('click', () => {
        normalizeDraftRange();
        setCustomRange(rangeDraftStart, rangeDraftEnd);
        renderFilterButtons();
        closeRangePopover();
      });

      renderDurationMenu();
      updateDurationLabel();
      refreshRangeLabel();
      renderFilterButtons();
      updateTrackState();
      updatePanelContext();

      void refreshInstances({ silent: true }).then(() => {
        void refreshTasks({ silent: true }).then(() => {
          updateTaskInputValue();
        });
        void refreshEntries({ silent: true });
        void refreshTimer({ silent: true });
      });

      return {
        onVisibilityChange: (visible) => {
          isVisible = visible;
          if (visible) {
            void refreshTasks({ silent: true });
            void refreshEntries({ silent: true });
            void refreshTimer({ silent: true });
            chromeController?.scheduleLayoutCheck();
          }
        },
        onFocus: () => {
          if (isVisible && !activeTimer && !stopEntry) {
            taskInput.focus();
          }
        },
        onEvent: (event) => {
          handlePanelEvent(event);
        },
        unmount: () => {
          clearTimerInterval();
          document.removeEventListener('mousedown', handleDocumentClick);
          document.removeEventListener('mouseup', handleDocumentMouseUp);
          chromeController?.destroy();
        },
      };
    },
  }));
}
