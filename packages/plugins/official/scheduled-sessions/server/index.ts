import type { CombinedPluginManifest, SessionConfig } from '@assistant/shared';

import { parseSessionConfigInput } from '../../../../agent-server/src/sessionConfig';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import {
  ScheduleNotFoundError,
  ScheduleValidationError,
  type ScheduledSessionService,
} from '../../../../agent-server/src/scheduledSessions/scheduledSessionService';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

function asObject(value: unknown): Record<string, unknown> {
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

function parseOptionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new ToolError('invalid_arguments', `${field} must be a boolean`);
  }
  return value;
}

function parseOptionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolError('invalid_arguments', `${field} must be a finite number`);
  }
  return value;
}

function parseOptionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1
  ) {
    throw new ToolError('invalid_arguments', `${field} must be an integer >= 1`);
  }
  return value;
}

function parseRequiredSessionId(ctx: ToolContext): string {
  const sessionId = ctx.sessionId?.trim();
  if (!sessionId) {
    throw new ToolError('session_unavailable', 'Current session is not available');
  }
  return sessionId;
}

function parseWakeupRunAt(parsed: Record<string, unknown>): Date {
  const runAtRaw = parsed['runAt'];
  const delaySeconds = parseOptionalNumber(parsed['delaySeconds'], 'delaySeconds');
  const hasRunAt = runAtRaw !== undefined;
  const hasDelay = delaySeconds !== undefined;
  if (hasRunAt === hasDelay) {
    throw new ToolError('invalid_arguments', 'Provide exactly one of runAt or delaySeconds');
  }
  if (hasDelay) {
    if (delaySeconds <= 0) {
      throw new ToolError('invalid_arguments', 'delaySeconds must be greater than zero');
    }
    return new Date(Date.now() + Math.ceil(delaySeconds * 1000));
  }
  if (typeof runAtRaw !== 'string') {
    throw new ToolError(
      'invalid_arguments',
      'runAt must be an absolute ISO timestamp string with timezone offset or Z',
    );
  }
  const trimmedRunAt = runAtRaw.trim();
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmedRunAt)) {
    throw new ToolError(
      'invalid_arguments',
      'runAt must include a timezone offset or Z, for example 2026-06-03T08:56:00-05:00 or 2026-06-03T13:56:00Z',
    );
  }
  const runAt = new Date(trimmedRunAt);
  if (!Number.isFinite(runAt.getTime())) {
    throw new ToolError(
      'invalid_arguments',
      'runAt must be a valid absolute ISO timestamp string with timezone offset or Z',
    );
  }
  return runAt;
}

function parseOptionalWakeupRunAt(parsed: Record<string, unknown>): Date | undefined {
  const hasRunAt = parsed['runAt'] !== undefined;
  const hasDelay = parsed['delaySeconds'] !== undefined;
  if (!hasRunAt && !hasDelay) {
    return undefined;
  }
  return parseWakeupRunAt(parsed);
}

function parseOptionalNullableString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string or null`);
  }
  return value;
}

function parseOptionalSessionConfig(value: unknown): SessionConfig | null | undefined {
  try {
    return parseSessionConfigInput({
      value,
      allowNull: true,
      allowSessionTitle: false,
    });
  } catch (err) {
    throw new ToolError(
      'invalid_arguments',
      err instanceof Error ? err.message : 'Invalid sessionConfig',
    );
  }
}

function requireService(ctx: ToolContext): ScheduledSessionService {
  const service = ctx.scheduledSessionService;
  if (!service) {
    throw new ToolError(
      'scheduled_sessions_unavailable',
      'Scheduled session service is not available',
    );
  }
  return service;
}

function wrapServiceError(err: unknown): never {
  if (err instanceof ToolError) {
    throw err;
  }
  if (err instanceof ScheduleValidationError) {
    throw new ToolError('invalid_arguments', err.message);
  }
  if (err instanceof ScheduleNotFoundError) {
    const code = err.message.startsWith('Agent not found:')
      ? 'agent_not_found'
      : err.message.startsWith('Session not found:')
        ? 'session_not_found'
        : err.message.startsWith('Wake-up not found:')
          ? 'wakeup_not_found'
          : 'schedule_not_found';
    throw new ToolError(code, err.message);
  }
  throw err;
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      list: async (_args, ctx) => {
        return { schedules: requireService(ctx).listSchedules() };
      },
      create: async (args, ctx) => {
        const parsed = asObject(args);
        const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
        const cron = requireNonEmptyString(parsed['cron'], 'cron');
        const prompt = parseOptionalNullableString(parsed['prompt'], 'prompt');
        const preCheck = parseOptionalNullableString(parsed['preCheck'], 'preCheck');
        const sessionTitle = parseOptionalNullableString(parsed['sessionTitle'], 'sessionTitle');
        const enabled = parseOptionalBoolean(parsed['enabled'], 'enabled');
        const reuseSession = parseOptionalBoolean(parsed['reuseSession'], 'reuseSession');
        const maxConcurrent = parseOptionalInteger(parsed['maxConcurrent'], 'maxConcurrent');
        const sessionConfig = parseOptionalSessionConfig(parsed['sessionConfig']);

        try {
          return await requireService(ctx).createSchedule(agentId, {
            cron,
            ...(prompt !== undefined ? { prompt: prompt ?? undefined } : {}),
            ...(preCheck !== undefined ? { preCheck: preCheck ?? undefined } : {}),
            ...(sessionTitle !== undefined ? { sessionTitle: sessionTitle ?? undefined } : {}),
            ...(enabled !== undefined ? { enabled } : {}),
            ...(reuseSession !== undefined ? { reuseSession } : {}),
            ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
            ...(sessionConfig !== undefined && sessionConfig !== null ? { sessionConfig } : {}),
          });
        } catch (err) {
          wrapServiceError(err);
        }
      },
      update: async (args, ctx) => {
        const parsed = asObject(args);
        const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
        const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
        const cron = parsed['cron'] !== undefined ? requireNonEmptyString(parsed['cron'], 'cron') : undefined;
        const prompt = parseOptionalNullableString(parsed['prompt'], 'prompt');
        const preCheck = parseOptionalNullableString(parsed['preCheck'], 'preCheck');
        const sessionTitle = parseOptionalNullableString(parsed['sessionTitle'], 'sessionTitle');
        const enabled = parseOptionalBoolean(parsed['enabled'], 'enabled');
        const reuseSession = parseOptionalBoolean(parsed['reuseSession'], 'reuseSession');
        const maxConcurrent = parseOptionalInteger(parsed['maxConcurrent'], 'maxConcurrent');
        const sessionConfig = parseOptionalSessionConfig(parsed['sessionConfig']);

        try {
          return await requireService(ctx).updateSchedule(agentId, scheduleId, {
            ...(cron !== undefined ? { cron } : {}),
            ...(prompt !== undefined ? { prompt } : {}),
            ...(preCheck !== undefined ? { preCheck } : {}),
            ...(sessionTitle !== undefined ? { sessionTitle } : {}),
            ...(enabled !== undefined ? { enabled } : {}),
            ...(reuseSession !== undefined ? { reuseSession } : {}),
            ...(maxConcurrent !== undefined ? { maxConcurrent } : {}),
            ...(sessionConfig !== undefined ? { sessionConfig } : {}),
          });
        } catch (err) {
          wrapServiceError(err);
        }
      },
      delete: async (args, ctx) => {
        const parsed = asObject(args);
        const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
        const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
        try {
          return await requireService(ctx).deleteSchedule(agentId, scheduleId);
        } catch (err) {
          wrapServiceError(err);
        }
      },
      run: async (args, ctx) => {
        const parsed = asObject(args);
        const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
        const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
        const force = parseOptionalBoolean(parsed['force'], 'force');
        try {
          return requireService(ctx).triggerRun(agentId, scheduleId, { force });
        } catch (err) {
          wrapServiceError(err);
        }
      },
      enable: async (args, ctx) => {
        const parsed = asObject(args);
        const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
        const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
        try {
          await requireService(ctx).setEnabled(agentId, scheduleId, true);
          return { agentId, scheduleId, enabled: true };
        } catch (err) {
          wrapServiceError(err);
        }
      },
      disable: async (args, ctx) => {
        const parsed = asObject(args);
        const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
        const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
        try {
          await requireService(ctx).setEnabled(agentId, scheduleId, false);
          return { agentId, scheduleId, enabled: false };
        } catch (err) {
          wrapServiceError(err);
        }
      },
      'wakeup-list': async (_args, ctx) => {
        const sessionId = ctx.sessionId?.trim();
        const wakeups = sessionId
          ? await requireService(ctx).listWakeupsForSession(sessionId)
          : await requireService(ctx).listWakeups();
        return { wakeups };
      },
      'wakeup-create': async (args, ctx) => {
        const parsed = asObject(args);
        const message = requireNonEmptyString(parsed['message'], 'message');
        const runAt = parseWakeupRunAt(parsed);
        try {
          return await requireService(ctx).createWakeupForSession({
            sessionId: parseRequiredSessionId(ctx),
            message,
            runAt,
          });
        } catch (err) {
          wrapServiceError(err);
        }
      },
      'wakeup-update': async (args, ctx) => {
        const parsed = asObject(args);
        const wakeupId = requireNonEmptyString(parsed['wakeupId'], 'wakeupId');
        const message =
          parsed['message'] !== undefined
            ? requireNonEmptyString(parsed['message'], 'message')
            : undefined;
        const runAt = parseOptionalWakeupRunAt(parsed);
        if (message === undefined && runAt === undefined) {
          throw new ToolError(
            'invalid_arguments',
            'Provide message, runAt, or delaySeconds to update',
          );
        }
        try {
          return await requireService(ctx).updateWakeupForSession({
            sessionId: parseRequiredSessionId(ctx),
            wakeupId,
            ...(message !== undefined ? { message } : {}),
            ...(runAt !== undefined ? { runAt } : {}),
          });
        } catch (err) {
          wrapServiceError(err);
        }
      },
      'wakeup-cancel': async (_args, ctx) => {
        const parsed = asObject(_args);
        const wakeupId = requireNonEmptyString(parsed['wakeupId'], 'wakeupId');
        try {
          return await requireService(ctx).cancelWakeupForSession(
            parseRequiredSessionId(ctx),
            wakeupId,
          );
        } catch (err) {
          wrapServiceError(err);
        }
      },
    },
  };
}
