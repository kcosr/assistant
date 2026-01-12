import type { PanelEventEnvelope } from '@assistant/shared';

import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { apiFetch } from '../../../../web-client/src/utils/api';

const SCHEDULED_SESSIONS_TEMPLATE = `
  <aside class="scheduled-sessions-panel" aria-label="Scheduled sessions panel">
    <div class="panel-header scheduled-sessions-header">
      <div class="panel-header-main">
        <span class="panel-header-label">Scheduled Sessions</span>
        <span class="scheduled-sessions-summary" data-role="summary"></span>
      </div>
      <div class="panel-header-actions">
        <button type="button" class="scheduled-sessions-button" data-role="refresh">Refresh</button>
      </div>
    </div>
    <div class="scheduled-sessions-status" data-role="status"></div>
    <div class="scheduled-sessions-body" data-role="body"></div>
  </aside>
`;

type ScheduleStatus = 'idle' | 'running' | 'disabled';

type LastRunInfo = {
  timestamp: string;
  result: 'completed' | 'failed' | 'skipped';
  error?: string;
  skipReason?: string;
};

type ScheduleInfo = {
  agentId: string;
  scheduleId: string;
  cron: string;
  cronDescription: string;
  prompt?: string;
  preCheck?: string;
  enabled: boolean;
  runtimeEnabled: boolean;
  status: ScheduleStatus;
  runningCount: number;
  runningStartedAt: string | null;
  maxConcurrent: number;
  nextRun: string | null;
  lastRun: LastRunInfo | null;
};

type SchedulesResponse = {
  schedules: ScheduleInfo[];
};

type RunResponse = {
  status: 'started' | 'skipped';
  reason?: string | null;
};

type PanelState = {
  collapsedAgents: string[];
  collapsedSchedules: string[];
};

const registry = window.ASSISTANT_PANEL_REGISTRY;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || hours > 0) {
    parts.push(`${minutes}m`);
  }
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

function formatRelative(value: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  if (abs < 1000) {
    return 'now';
  }
  const text = formatDuration(abs);
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

function formatLastRun(lastRun: LastRunInfo | null): { label: string; detail: string } {
  if (!lastRun) {
    return { label: 'Never run', detail: '' };
  }
  const base = formatTimestamp(lastRun.timestamp);
  if (lastRun.result === 'completed') {
    return { label: `${base} (completed)`, detail: '' };
  }
  if (lastRun.result === 'failed') {
    const detail = lastRun.error ? `Error: ${lastRun.error}` : '';
    return { label: `${base} (failed)`, detail };
  }
  const reason = lastRun.skipReason ? `Reason: ${lastRun.skipReason}` : '';
  return { label: `${base} (skipped)`, detail: reason };
}

function groupByAgent(schedules: ScheduleInfo[]): Map<string, ScheduleInfo[]> {
  const grouped = new Map<string, ScheduleInfo[]>();
  for (const schedule of schedules) {
    if (!grouped.has(schedule.agentId)) {
      grouped.set(schedule.agentId, []);
    }
    grouped.get(schedule.agentId)?.push(schedule);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.scheduleId.localeCompare(b.scheduleId));
  }
  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

async function fetchSchedules(): Promise<ScheduleInfo[]> {
  const response = await apiFetch('/api/scheduled-sessions');
  let payload: SchedulesResponse | null = null;
  try {
    payload = (await response.json()) as SchedulesResponse;
  } catch {
    // ignore
  }
  if (!response.ok || !payload || !Array.isArray(payload.schedules)) {
    throw new Error(`Request failed (${response.status})`);
  }
  return payload.schedules;
}

async function runSchedule(agentId: string, scheduleId: string): Promise<RunResponse> {
  const response = await apiFetch(
    `/api/scheduled-sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(scheduleId)}/run`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  let payload: RunResponse | null = null;
  try {
    payload = (await response.json()) as RunResponse;
  } catch {
    // ignore
  }
  if (!response.ok || !payload) {
    throw new Error(`Request failed (${response.status})`);
  }
  return payload;
}

async function setScheduleEnabled(agentId: string, scheduleId: string, enabled: boolean): Promise<void> {
  const action = enabled ? 'enable' : 'disable';
  const response = await apiFetch(
    `/api/scheduled-sessions/${encodeURIComponent(agentId)}/${encodeURIComponent(scheduleId)}/${action}`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }
}

if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for scheduled-sessions plugin.');
} else {
  registry.registerPanel('scheduled-sessions', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.innerHTML = SCHEDULED_SESSIONS_TEMPLATE.trim();

      const root = container.firstElementChild as HTMLElement | null;
      if (!root) {
        throw new Error('Failed to render scheduled sessions panel');
      }

      const summaryEl = root.querySelector<HTMLElement>('[data-role="summary"]');
      const statusEl = root.querySelector<HTMLElement>('[data-role="status"]');
      const bodyEl = root.querySelector<HTMLElement>('[data-role="body"]');
      const refreshButton = root.querySelector<HTMLButtonElement>('[data-role="refresh"]');

      if (!summaryEl || !statusEl || !bodyEl || !refreshButton) {
        throw new Error('Scheduled sessions panel failed to locate required elements');
      }

      let schedules = new Map<string, ScheduleInfo>();
      let loading = false;
      let message = '';

      const collapsedAgents = new Set<string>();
      const collapsedSchedules = new Set<string>();

      const loadPanelState = (): void => {
        const saved = host.loadPanelState();
        if (!saved || typeof saved !== 'object') {
          return;
        }
        const raw = saved as Partial<PanelState>;
        if (Array.isArray(raw.collapsedAgents)) {
          for (const entry of raw.collapsedAgents) {
            if (typeof entry === 'string') {
              collapsedAgents.add(entry);
            }
          }
        }
        if (Array.isArray(raw.collapsedSchedules)) {
          for (const entry of raw.collapsedSchedules) {
            if (typeof entry === 'string') {
              collapsedSchedules.add(entry);
            }
          }
        }
      };

      const persistPanelState = (): void => {
        const state: PanelState = {
          collapsedAgents: Array.from(collapsedAgents),
          collapsedSchedules: Array.from(collapsedSchedules),
        };
        host.persistPanelState(state);
      };

      const setMessage = (next: string): void => {
        message = next;
        render();
      };

      const updateSchedules = (nextSchedules: ScheduleInfo[]): void => {
        schedules = new Map(
          nextSchedules.map((schedule) => [`${schedule.agentId}:${schedule.scheduleId}`, schedule]),
        );
        render();
      };

      const refresh = async (): Promise<void> => {
        if (loading) {
          return;
        }
        loading = true;
        setMessage('Loading schedules...');
        try {
          const data = await fetchSchedules();
          updateSchedules(data);
          message = '';
        } catch (err) {
          message = (err as Error).message || 'Failed to fetch schedules';
        } finally {
          loading = false;
          render();
        }
      };

      const handlePanelEvent = (event: PanelEventEnvelope): void => {
        const payload = event.payload as Record<string, unknown> | null;
        if (!payload || payload['type'] !== 'scheduled_session:status') {
          return;
        }
        const schedule = payload['payload'] as ScheduleInfo | undefined;
        if (!schedule || !schedule.agentId || !schedule.scheduleId) {
          return;
        }
        schedules.set(`${schedule.agentId}:${schedule.scheduleId}`, schedule);
        render();
      };

      const render = (): void => {
        const allSchedules = Array.from(schedules.values());
        const grouped = groupByAgent(allSchedules);
        const runningCount = allSchedules.filter((schedule) => schedule.status === 'running').length;
        const disabledCount = allSchedules.filter((schedule) => schedule.status === 'disabled').length;
        summaryEl.textContent = `${allSchedules.length} schedules | ${runningCount} running | ${disabledCount} disabled`;
        statusEl.textContent = message;

        if (allSchedules.length === 0 && !loading) {
          bodyEl.innerHTML = '<div class="scheduled-sessions-empty">No schedules configured.</div>';
          return;
        }

        let html = '';
        for (const [agentId, agentSchedules] of grouped.entries()) {
          const agentCollapsed = collapsedAgents.has(agentId);
          html += `
            <section class="scheduled-sessions-group" data-agent-id="${escapeHtml(agentId)}">
              <button type="button" class="scheduled-sessions-group-header" data-action="toggle-agent" data-agent-id="${escapeHtml(agentId)}">
                <span class="scheduled-sessions-group-title">${escapeHtml(agentId)}</span>
                <span class="scheduled-sessions-group-meta">${agentSchedules.length} schedule${agentSchedules.length === 1 ? '' : 's'}</span>
              </button>
              <div class="scheduled-sessions-group-body${agentCollapsed ? ' is-collapsed' : ''}">
          `;

          for (const schedule of agentSchedules) {
            const scheduleKey = `${schedule.agentId}:${schedule.scheduleId}`;
            const scheduleCollapsed = collapsedSchedules.has(scheduleKey);
            const statusLabel = schedule.status === 'running' ? 'Running' : schedule.status === 'disabled' ? 'Disabled' : 'Idle';
            const runningDetail =
              schedule.status === 'running' && schedule.runningStartedAt
                ? `Running for ${formatDuration(Date.now() - new Date(schedule.runningStartedAt).getTime())}`
                : '';
            const lastRun = formatLastRun(schedule.lastRun);
            const runDisabled = schedule.runningCount >= schedule.maxConcurrent;
            const enableLabel = schedule.runtimeEnabled ? 'Disable' : 'Enable';

            html += `
              <div class="scheduled-sessions-item">
                <div class="scheduled-sessions-row" data-action="toggle-schedule" data-agent-id="${escapeHtml(schedule.agentId)}" data-schedule-id="${escapeHtml(schedule.scheduleId)}">
                  <span class="status-dot status-dot--${escapeHtml(schedule.status)}"></span>
                  <div class="scheduled-sessions-row-main">
                    <div class="scheduled-sessions-row-title">${escapeHtml(schedule.scheduleId)}</div>
                    <div class="scheduled-sessions-row-sub">${escapeHtml(schedule.cron)} | ${escapeHtml(schedule.cronDescription)}</div>
                  </div>
                  <div class="scheduled-sessions-row-meta">
                    <div class="scheduled-sessions-row-next">${formatRelative(schedule.nextRun)}</div>
                    <div class="scheduled-sessions-row-status">${escapeHtml(statusLabel)}</div>
                  </div>
                  <div class="scheduled-sessions-row-actions">
                    <button type="button" class="scheduled-sessions-button" data-action="run" data-agent-id="${escapeHtml(schedule.agentId)}" data-schedule-id="${escapeHtml(schedule.scheduleId)}" ${runDisabled ? 'disabled' : ''}>Run</button>
                    <button type="button" class="scheduled-sessions-button" data-action="toggle-enabled" data-agent-id="${escapeHtml(schedule.agentId)}" data-schedule-id="${escapeHtml(schedule.scheduleId)}">${escapeHtml(enableLabel)}</button>
                  </div>
                </div>
                <div class="scheduled-sessions-details${scheduleCollapsed ? ' is-collapsed' : ''}">
                  <div class="scheduled-sessions-detail-grid">
                    <div class="scheduled-sessions-detail">
                      <div class="scheduled-sessions-detail-label">Next run</div>
                      <div class="scheduled-sessions-detail-value">${escapeHtml(formatTimestamp(schedule.nextRun))} (${escapeHtml(formatRelative(schedule.nextRun))})</div>
                    </div>
                    <div class="scheduled-sessions-detail">
                      <div class="scheduled-sessions-detail-label">Status</div>
                      <div class="scheduled-sessions-detail-value">${escapeHtml(statusLabel)}${runningDetail ? ` | ${escapeHtml(runningDetail)}` : ''}</div>
                    </div>
                    <div class="scheduled-sessions-detail">
                      <div class="scheduled-sessions-detail-label">Last run</div>
                      <div class="scheduled-sessions-detail-value">${escapeHtml(lastRun.label)}</div>
                      ${lastRun.detail ? `<div class="scheduled-sessions-detail-note">${escapeHtml(lastRun.detail)}</div>` : ''}
                    </div>
                    <div class="scheduled-sessions-detail">
                      <div class="scheduled-sessions-detail-label">Concurrency</div>
                      <div class="scheduled-sessions-detail-value">${schedule.runningCount}/${schedule.maxConcurrent}</div>
                    </div>
                  </div>
                  <div class="scheduled-sessions-detail-grid">
                    <div class="scheduled-sessions-detail">
                      <div class="scheduled-sessions-detail-label">Prompt</div>
                      <div class="scheduled-sessions-detail-value">${schedule.prompt ? escapeHtml(schedule.prompt) : '-'}</div>
                    </div>
                    <div class="scheduled-sessions-detail">
                      <div class="scheduled-sessions-detail-label">Pre-check</div>
                      <div class="scheduled-sessions-detail-value">${schedule.preCheck ? escapeHtml(schedule.preCheck) : '-'}</div>
                    </div>
                  </div>
                </div>
              </div>
            `;
          }

          html += '</div></section>';
        }

        bodyEl.innerHTML = html;
      };

      const handleClick = async (event: MouseEvent): Promise<void> => {
        const target = event.target as HTMLElement | null;
        if (!target) {
          return;
        }
        const actionEl = target.closest<HTMLElement>('[data-action]');
        if (!actionEl) {
          return;
        }
        const action = actionEl.dataset.action;
        const agentId = actionEl.dataset.agentId ?? '';
        const scheduleId = actionEl.dataset.scheduleId ?? '';

        if (action === 'toggle-agent') {
          if (!agentId) {
            return;
          }
          if (collapsedAgents.has(agentId)) {
            collapsedAgents.delete(agentId);
          } else {
            collapsedAgents.add(agentId);
          }
          persistPanelState();
          render();
          return;
        }

        if (action === 'toggle-schedule') {
          if (!agentId || !scheduleId) {
            return;
          }
          const key = `${agentId}:${scheduleId}`;
          if (collapsedSchedules.has(key)) {
            collapsedSchedules.delete(key);
          } else {
            collapsedSchedules.add(key);
          }
          persistPanelState();
          render();
          return;
        }

        if (action === 'run') {
          event.preventDefault();
          event.stopPropagation();
          if (!agentId || !scheduleId) {
            return;
          }
          try {
            const result = await runSchedule(agentId, scheduleId);
            if (result.status === 'skipped') {
              setMessage(`Run skipped: ${result.reason ?? 'unknown'}`);
            } else {
              setMessage('Run started');
            }
          } catch (err) {
            setMessage((err as Error).message || 'Failed to run schedule');
          }
          return;
        }

        if (action === 'toggle-enabled') {
          event.preventDefault();
          event.stopPropagation();
          if (!agentId || !scheduleId) {
            return;
          }
          const key = `${agentId}:${scheduleId}`;
          const schedule = schedules.get(key);
          const nextEnabled = schedule ? !schedule.runtimeEnabled : true;
          try {
            await setScheduleEnabled(agentId, scheduleId, nextEnabled);
            setMessage(nextEnabled ? 'Schedule enabled' : 'Schedule disabled');
          } catch (err) {
            setMessage((err as Error).message || 'Failed to update schedule');
          }
          return;
        }
      };

      loadPanelState();
      render();
      void refresh();

      refreshButton.addEventListener('click', () => {
        void refresh();
      });

      bodyEl.addEventListener('click', (event) => {
        void handleClick(event as MouseEvent);
      });

      const timer = window.setInterval(() => {
        if (schedules.size > 0) {
          render();
        }
      }, 30_000);

      return {
        onVisibilityChange: (visible) => {
          if (visible) {
            void refresh();
          }
        },
        onEvent: handlePanelEvent,
        unmount() {
          window.clearInterval(timer);
          container.innerHTML = '';
        },
      };
    },
  }));
}
