import { mkdir } from 'node:fs/promises';

import type { CombinedPluginManifest } from '@assistant/shared';
import ExcelJS from 'exceljs';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import {
  DEFAULT_PLUGIN_INSTANCE_ID,
  normalizePluginInstanceId,
  resolvePluginInstanceDataDir,
  resolvePluginInstances,
  type PluginInstanceDefinition,
} from '../../../../agent-server/src/plugins/instances';
import {
  TimeTrackerStore,
  TaskNotFoundError,
  EntryNotFoundError,
  TimerAlreadyActiveError,
  NoActiveTimerError,
  DuplicateTaskNameError,
  ValidationError,
} from './store';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

function asObject(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} is required and must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolError('invalid_arguments', `${field} cannot be empty`);
  }
  return trimmed;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  return value;
}

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ToolError('invalid_arguments', `${field} must be a boolean`);
  }
  return value;
}

function parseOptionalTrimmedString(value: unknown, field: string): string | undefined {
  const parsed = parseOptionalString(value, field);
  if (parsed === undefined) {
    return undefined;
  }
  return parsed.trim();
}

function parseDurationMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolError('invalid_arguments', 'duration_minutes must be a number');
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new ToolError('invalid_arguments', 'duration_minutes must be an integer >= 1');
  }
  return value;
}

function parseOptionalDateString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolError('invalid_arguments', `${field} cannot be empty`);
  }
  if (!isValidDateString(trimmed)) {
    throw new ToolError('invalid_arguments', `${field} must be in YYYY-MM-DD format`);
  }
  return trimmed;
}

function requireDateString(value: unknown, field: string): string {
  const parsed = parseOptionalDateString(value, field);
  if (!parsed) {
    throw new ToolError('invalid_arguments', `${field} is required`);
  }
  return parsed;
}

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    return false;
  }
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function getLocalDateString(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function broadcast(ctx: ToolContext, payload: Record<string, unknown>, panelId = '*'): void {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    return;
  }
  sessionHub.broadcastToAll({
    type: 'panel_event',
    panelId,
    panelType: 'time-tracker',
    sessionId: '*',
    payload,
  });
}

function handleStoreError(error: unknown): never {
  if (error instanceof TaskNotFoundError) {
    throw new ToolError('task_not_found', error.message);
  }
  if (error instanceof EntryNotFoundError) {
    throw new ToolError('entry_not_found', error.message);
  }
  if (error instanceof DuplicateTaskNameError) {
    throw new ToolError('invalid_arguments', error.message || 'Task name already exists');
  }
  if (error instanceof TimerAlreadyActiveError) {
    throw new ToolError('invalid_arguments', error.message || 'Timer already active');
  }
  if (error instanceof NoActiveTimerError) {
    throw new ToolError('not_found', error.message || 'No active timer');
  }
  if (error instanceof ValidationError) {
    throw new ToolError('invalid_arguments', error.message);
  }
  throw error;
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let baseDataDir = '';
  let instances: PluginInstanceDefinition[] = [];
  let instanceById = new Map<string, PluginInstanceDefinition>();
  const stores = new Map<string, TimeTrackerStore>();

  const resolveInstanceId = (value: unknown): string => {
    if (value === undefined) {
      return DEFAULT_PLUGIN_INSTANCE_ID;
    }
    if (typeof value !== 'string') {
      throw new ToolError('invalid_arguments', 'instance_id must be a string');
    }
    const normalized = normalizePluginInstanceId(value);
    if (!normalized) {
      throw new ToolError(
        'invalid_arguments',
        'instance_id must be a slug (letters, numbers, hyphens, underscores)',
      );
    }
    if (!instanceById.has(normalized)) {
      throw new ToolError('invalid_arguments', `Unknown instance_id: ${normalized}`);
    }
    return normalized;
  };

  const getStore = async (instanceId: string): Promise<TimeTrackerStore> => {
    const existing = stores.get(instanceId);
    if (existing) {
      return existing;
    }
    if (!baseDataDir) {
      throw new ToolError('plugin_not_initialized', 'Time tracker plugin has not been initialized');
    }
    const instanceDir = resolvePluginInstanceDataDir(baseDataDir, instanceId);
    await mkdir(instanceDir, { recursive: true });
    const store = new TimeTrackerStore(instanceDir);
    stores.set(instanceId, store);
    return store;
  };

  return {
    operations: {
      instance_list: async () => instances,
      task_create: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const name = requireNonEmptyString(parsed['name'], 'name');
        const description = parseOptionalString(parsed['description'], 'description');
        try {
          const task = (await getStore(instanceId)).createTask({
            name,
            ...(description !== undefined ? { description } : {}),
          });
          broadcast(ctx, { type: 'time-tracker:task:created', instance_id: instanceId, task });
          return task;
        } catch (error) {
          handleStoreError(error);
        }
      },
      task_list: async (args) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const query = parseOptionalTrimmedString(parsed['query'], 'query');
        try {
          return (await getStore(instanceId)).listTasks(
            query && query.length > 0 ? query : undefined,
          );
        } catch (error) {
          handleStoreError(error);
        }
      },
      task_get: async (args) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const task = (await getStore(instanceId)).getTask(id);
        if (!task) {
          throw new ToolError('task_not_found', `Task not found: ${id}`);
        }
        return task;
      },
      task_update: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const name = parseOptionalTrimmedString(parsed['name'], 'name');
        const description = parseOptionalString(parsed['description'], 'description');
        if (name !== undefined && name.trim().length === 0) {
          throw new ToolError('invalid_arguments', 'name cannot be empty');
        }
        try {
          const task = (await getStore(instanceId)).updateTask({
            id,
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description } : {}),
          });
          broadcast(ctx, { type: 'time-tracker:task:updated', instance_id: instanceId, task });
          return task;
        } catch (error) {
          handleStoreError(error);
        }
      },
      task_delete: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        try {
          (await getStore(instanceId)).deleteTask(id);
          broadcast(ctx, { type: 'time-tracker:task:deleted', instance_id: instanceId, id });
          return { ok: true };
        } catch (error) {
          handleStoreError(error);
        }
      },
      entry_create: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const taskId = requireNonEmptyString(parsed['task_id'], 'task_id');
        const durationMinutes = parseDurationMinutes(parsed['duration_minutes']);
        const entryDate =
          parseOptionalDateString(parsed['entry_date'], 'entry_date') ?? getLocalDateString();
        const note = parseOptionalString(parsed['note'], 'note');
        const reported = parseOptionalBoolean(parsed['reported'], 'reported');
        try {
          const entry = (await getStore(instanceId)).createEntry({
            taskId,
            entryDate,
            durationMinutes,
            note,
            ...(reported !== undefined ? { reported } : {}),
            entryType: 'manual',
          });
          broadcast(ctx, { type: 'time-tracker:entry:created', instance_id: instanceId, entry });
          return entry;
        } catch (error) {
          handleStoreError(error);
        }
      },
      entry_list: async (args) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const startDate = parseOptionalDateString(parsed['start_date'], 'start_date');
        const endDate = parseOptionalDateString(parsed['end_date'], 'end_date');
        const taskId = parseOptionalTrimmedString(parsed['task_id'], 'task_id');
        const includeReported = parseOptionalBoolean(
          parsed['include_reported'],
          'include_reported',
        );
        try {
          return (await getStore(instanceId)).listEntries({
            ...(startDate ? { startDate } : {}),
            ...(endDate ? { endDate } : {}),
            ...(taskId ? { taskId } : {}),
            ...(includeReported !== undefined ? { includeReported } : {}),
          });
        } catch (error) {
          handleStoreError(error);
        }
      },
      entry_get: async (args) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const entry = (await getStore(instanceId)).getEntry(id);
        if (!entry) {
          throw new ToolError('entry_not_found', `Entry not found: ${id}`);
        }
        return entry;
      },
      entry_update: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const taskId = parseOptionalTrimmedString(parsed['task_id'], 'task_id');
        const entryDate = parseOptionalDateString(parsed['entry_date'], 'entry_date');
        const durationMinutesRaw = parsed['duration_minutes'];
        const note = parseOptionalString(parsed['note'], 'note');
        const reported = parseOptionalBoolean(parsed['reported'], 'reported');
        let durationMinutes: number | undefined;
        if (durationMinutesRaw !== undefined) {
          durationMinutes = parseDurationMinutes(durationMinutesRaw);
        }
        try {
          const entry = (await getStore(instanceId)).updateEntry({
            id,
            ...(taskId ? { taskId } : {}),
            ...(entryDate ? { entryDate } : {}),
            ...(durationMinutes !== undefined ? { durationMinutes } : {}),
            ...(reported !== undefined ? { reported } : {}),
            ...(note !== undefined ? { note } : {}),
          });
          broadcast(ctx, { type: 'time-tracker:entry:updated', instance_id: instanceId, entry });
          return entry;
        } catch (error) {
          handleStoreError(error);
        }
      },
      entry_delete: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        try {
          (await getStore(instanceId)).deleteEntry(id);
          broadcast(ctx, { type: 'time-tracker:entry:deleted', instance_id: instanceId, id });
          return { ok: true };
        } catch (error) {
          handleStoreError(error);
        }
      },
      timer_start: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const taskId = requireNonEmptyString(parsed['task_id'], 'task_id');
        const entryDate =
          parseOptionalDateString(parsed['entry_date'], 'entry_date') ?? getLocalDateString();
        try {
          const timer = (await getStore(instanceId)).startTimer({ taskId, entryDate });
          broadcast(ctx, { type: 'time-tracker:timer:started', instance_id: instanceId, timer });
          return timer;
        } catch (error) {
          handleStoreError(error);
        }
      },
      timer_status: async (args) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        try {
          return (await getStore(instanceId)).getActiveTimer();
        } catch (error) {
          handleStoreError(error);
        }
      },
      timer_stop: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const note = parseOptionalString(parsed['note'], 'note');
        try {
          const result = (await getStore(instanceId)).stopTimer(note);
          broadcast(ctx, {
            type: 'time-tracker:timer:stopped',
            timer_id: result.timerId,
            instance_id: instanceId,
            entry: result.entry,
          });
          broadcast(ctx, {
            type: 'time-tracker:entry:created',
            instance_id: instanceId,
            entry: result.entry,
          });
          return { timer_id: result.timerId, entry: result.entry };
        } catch (error) {
          handleStoreError(error);
        }
      },
      export_xlsx: async (args) => {
        const parsed = asObject(args);
        const rowsRaw = parsed['rows'];
        if (!Array.isArray(rowsRaw)) {
          throw new ToolError('invalid_arguments', 'rows must be an array');
        }
        const startDate = parseOptionalDateString(parsed['start_date'], 'start_date');
        const endDate = parseOptionalDateString(parsed['end_date'], 'end_date');
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Time Report');

        sheet.columns = [
          { header: 'Item', key: 'item', width: 32 },
          { header: 'Hours', key: 'hours', width: 10 },
          { header: 'Minutes', key: 'minutes', width: 10 },
          { header: 'Hours (Decimal)', key: 'hours_decimal', width: 16 },
          { header: 'Description', key: 'description', width: 60 },
        ];

        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true };

        const rows = rowsRaw
          .map((row) => {
            if (!row || typeof row !== 'object') {
              return null;
            }
            const record = row as Record<string, unknown>;
            const item = record['item'];
            const totalMinutes = record['total_minutes'];
            const description = record['description'];
            if (typeof item !== 'string' || typeof totalMinutes !== 'number') {
              return null;
            }
            return {
              item,
              totalMinutes,
              description: typeof description === 'string' ? description : '',
            };
          })
          .filter(Boolean) as Array<{ item: string; totalMinutes: number; description: string }>;

        let rowIndex = 2;
        for (const row of rows) {
          const hours = Math.floor(row.totalMinutes / 60);
          const minutes = row.totalMinutes % 60;
          const excelRow = sheet.getRow(rowIndex);
          excelRow.getCell('A').value = row.item;
          excelRow.getCell('B').value = hours;
          excelRow.getCell('C').value = minutes;
          excelRow.getCell('D').value = {
            formula: `B${rowIndex}+C${rowIndex}/60`,
            result: hours + minutes / 60,
          };
          excelRow.getCell('E').value = row.description;
          excelRow.getCell('D').numFmt = '0.00';
          excelRow.getCell('E').alignment = { wrapText: true, vertical: 'top' };
          const lineCount = Math.max(1, row.description.split('\n').length);
          excelRow.height = Math.min(180, 15 * lineCount);
          rowIndex += 1;
        }

        if (rows.length > 0) {
          const totalRow = sheet.getRow(rowIndex);
          totalRow.font = { bold: true };
          totalRow.getCell('A').value = 'Total';
          totalRow.getCell('B').value = { formula: `SUM(B2:B${rowIndex - 1})` };
          totalRow.getCell('C').value = { formula: `SUM(C2:C${rowIndex - 1})` };
          totalRow.getCell('D').value = { formula: `SUM(D2:D${rowIndex - 1})` };
          totalRow.getCell('D').numFmt = '0.00';
          totalRow.getCell('D').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'C6EFCE' },
          };
        }

        const buffer = (await workbook.xlsx.writeBuffer()) as ArrayBuffer;
        const content = Buffer.from(buffer).toString('base64');
        const dateSuffix =
          startDate && endDate ? `${startDate}_to_${endDate}` : getLocalDateString();
        const filename = `time-tracker-export-${dateSuffix}.xlsx`;
        return {
          filename,
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          content,
        };
      },
      timer_discard: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        try {
          const result = (await getStore(instanceId)).discardTimer();
          broadcast(ctx, {
            type: 'time-tracker:timer:discarded',
            instance_id: instanceId,
            timer_id: result.timerId,
          });
          return result;
        } catch (error) {
          handleStoreError(error);
        }
      },
      set_filter: async (args, ctx) => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const startDate = requireDateString(parsed['start_date'], 'start_date');
        const endDate = requireDateString(parsed['end_date'], 'end_date');
        const panelId = parseOptionalTrimmedString(parsed['panel_id'], 'panel_id');
        broadcast(
          ctx,
          {
            type: 'time-tracker:filter:set',
            start_date: startDate,
            end_date: endDate,
            instance_id: instanceId,
          },
          panelId && panelId.length > 0 ? panelId : '*',
        );
        return { ok: true };
      },
    },
    async initialize(dataDir, pluginConfig): Promise<void> {
      await mkdir(dataDir, { recursive: true });
      baseDataDir = dataDir;
      instances = resolvePluginInstances('time-tracker', pluginConfig);
      instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    },
    prepareGitSnapshot({ instanceId }): void {
      const store = stores.get(instanceId);
      if (!store) {
        return;
      }
      try {
        store.checkpoint();
      } catch (err) {
        console.warn(`[time-tracker] Failed to checkpoint WAL for instance "${instanceId}"`, err);
      }
    },
    async shutdown(): Promise<void> {
      for (const store of stores.values()) {
        store.close();
      }
      stores.clear();
      instances = [];
      instanceById.clear();
      baseDataDir = '';
    },
  };
}
