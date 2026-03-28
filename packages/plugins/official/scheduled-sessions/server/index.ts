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
    },
  };
}
