import type { CombinedPluginManifest } from '@assistant/shared';

import type { HttpRouteHandler } from '../../../../agent-server/src/http/types';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type { ScheduledSessionService } from '../../../../agent-server/src/scheduledSessions/scheduledSessionService';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type RunRequestBody = {
  force?: boolean;
};

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

function requireService(ctx: ToolContext): ScheduledSessionService {
  const service = ctx.scheduledSessionService;
  if (!service) {
    throw new ToolError('scheduled_sessions_unavailable', 'Scheduled session service is not available');
  }
  return service;
}

function isScheduleNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  return (err as { name?: string }).name === 'ScheduleNotFoundError';
}

function parseRunBody(value: unknown): RunRequestBody {
  if (!value) {
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Request body must be an object');
  }
  const raw = value as Record<string, unknown>;
  if (raw['force'] !== undefined && typeof raw['force'] !== 'boolean') {
    throw new Error('force must be a boolean');
  }
  return {
    ...(raw['force'] !== undefined ? { force: raw['force'] as boolean } : {}),
  };
}

function normalizePathSegment(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return decodeURIComponent(value).trim();
}

const httpRoutes: HttpRouteHandler[] = [async (context, req, _res, _url, segments, helpers) => {
  if (segments.length < 2 || segments[0] !== 'api' || segments[1] !== 'scheduled-sessions') {
    return false;
  }

  const { sendJson, readJsonBody } = helpers;
  const service = context.scheduledSessionService;
  if (!service) {
    sendJson(503, { error: 'Scheduled session service is not available' });
    return true;
  }

  const agentId = normalizePathSegment(segments[2]);
  const scheduleId = normalizePathSegment(segments[3]);
  const action = normalizePathSegment(segments[4]);

  if (req.method === 'GET' && segments.length === 2) {
    sendJson(200, { schedules: service.listSchedules() });
    return true;
  }

  if (req.method === 'POST' && segments.length === 5 && action === 'run') {
    let body: RunRequestBody = {};
    if (req.headers['content-type']?.includes('application/json')) {
      const parsed = await readJsonBody();
      if (!parsed) {
        return true;
      }
      try {
        body = parseRunBody(parsed);
      } catch (err) {
        sendJson(400, { error: (err as Error).message || 'Invalid request body' });
        return true;
      }
    }

    if (!agentId || !scheduleId) {
      sendJson(400, { error: 'agentId and scheduleId are required' });
      return true;
    }

    try {
      const result = await service.triggerRun(agentId, scheduleId, { force: body.force });
      sendJson(200, result);
      return true;
    } catch (err) {
      if (isScheduleNotFoundError(err)) {
        const message = err instanceof Error ? err.message : 'Schedule not found';
        sendJson(404, { error: message });
        return true;
      }
      sendJson(500, { error: 'Failed to trigger scheduled session' });
      return true;
    }
  }

  if (req.method === 'POST' && segments.length === 5 && action === 'enable') {
    if (!agentId || !scheduleId) {
      sendJson(400, { error: 'agentId and scheduleId are required' });
      return true;
    }
    try {
      service.setEnabled(agentId, scheduleId, true);
      sendJson(200, { agentId, scheduleId, enabled: true });
      return true;
    } catch (err) {
      if (isScheduleNotFoundError(err)) {
        const message = err instanceof Error ? err.message : 'Schedule not found';
        sendJson(404, { error: message });
        return true;
      }
      sendJson(500, { error: 'Failed to enable scheduled session' });
      return true;
    }
  }

  if (req.method === 'POST' && segments.length === 5 && action === 'disable') {
    if (!agentId || !scheduleId) {
      sendJson(400, { error: 'agentId and scheduleId are required' });
      return true;
    }
    try {
      service.setEnabled(agentId, scheduleId, false);
      sendJson(200, { agentId, scheduleId, enabled: false });
      return true;
    } catch (err) {
      if (isScheduleNotFoundError(err)) {
        const message = err instanceof Error ? err.message : 'Schedule not found';
        sendJson(404, { error: message });
        return true;
      }
      sendJson(500, { error: 'Failed to disable scheduled session' });
      return true;
    }
  }

  sendJson(404, { error: 'Not found' });
  return true;
}];

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    tools: [
      {
        name: 'scheduled_sessions_list',
        description: 'List all scheduled sessions with status information.',
        inputSchema: { type: 'object', properties: {} },
        capabilities: ['scheduled-sessions.read'],
        handler: async (_args, ctx) => requireService(ctx).listSchedules(),
      },
      {
        name: 'scheduled_sessions_run',
        description: 'Trigger an immediate run of a scheduled session.',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent id for the schedule.' },
            scheduleId: { type: 'string', description: 'Schedule id within the agent.' },
            force: { type: 'boolean', description: 'Bypass max concurrency limits.' },
          },
          required: ['agentId', 'scheduleId'],
        },
        capabilities: ['scheduled-sessions.write'],
        handler: async (args, ctx) => {
          const parsed = asObject(args);
          const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
          const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
          const force = parseOptionalBoolean(parsed['force'], 'force');
          return requireService(ctx).triggerRun(agentId, scheduleId, { force });
        },
      },
      {
        name: 'scheduled_sessions_enable',
        description: 'Enable a scheduled session at runtime.',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent id for the schedule.' },
            scheduleId: { type: 'string', description: 'Schedule id within the agent.' },
          },
          required: ['agentId', 'scheduleId'],
        },
        capabilities: ['scheduled-sessions.write'],
        handler: async (args, ctx) => {
          const parsed = asObject(args);
          const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
          const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
          requireService(ctx).setEnabled(agentId, scheduleId, true);
          return { agentId, scheduleId, enabled: true };
        },
      },
      {
        name: 'scheduled_sessions_disable',
        description: 'Disable a scheduled session at runtime.',
        inputSchema: {
          type: 'object',
          properties: {
            agentId: { type: 'string', description: 'Agent id for the schedule.' },
            scheduleId: { type: 'string', description: 'Schedule id within the agent.' },
          },
          required: ['agentId', 'scheduleId'],
        },
        capabilities: ['scheduled-sessions.write'],
        handler: async (args, ctx) => {
          const parsed = asObject(args);
          const agentId = requireNonEmptyString(parsed['agentId'], 'agentId');
          const scheduleId = requireNonEmptyString(parsed['scheduleId'], 'scheduleId');
          requireService(ctx).setEnabled(agentId, scheduleId, false);
          return { agentId, scheduleId, enabled: false };
        },
      },
    ],
    httpRoutes,
  };
}
