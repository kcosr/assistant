import manifestJson from '../manifest.json';

import type { CombinedPluginManifest } from '@assistant/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import {
  ScheduleNotFoundError,
  ScheduleValidationError,
} from '../../../../agent-server/src/scheduledSessions/scheduledSessionService';
import { createPlugin } from './index';

function createCtx(overrides?: Record<string, unknown>): ToolContext {
  return {
    sessionId: 'test-session',
    signal: new AbortController().signal,
    ...(overrides ?? {}),
  };
}

describe('scheduled-sessions plugin operations', () => {
  it('exposes runtime schedule management operations', () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });

    expect(plugin.operations).toBeDefined();
    expect(typeof plugin.operations?.list).toBe('function');
    expect(typeof plugin.operations?.create).toBe('function');
    expect(typeof plugin.operations?.update).toBe('function');
    expect(typeof plugin.operations?.delete).toBe('function');
    expect(typeof plugin.operations?.run).toBe('function');
    expect(typeof plugin.operations?.enable).toBe('function');
    expect(typeof plugin.operations?.disable).toBe('function');
  });

  it('returns schedules from the list operation', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const list = plugin.operations?.list;
    if (!list) {
      throw new Error('Expected list operation');
    }

    const result = await list(
      {},
      createCtx({
        scheduledSessionService: {
          listSchedules: vi.fn().mockReturnValue([{ scheduleId: 's1' }]),
        },
      }),
    );

    expect(result).toEqual({ schedules: [{ scheduleId: 's1' }] });
  });

  it('forwards create arguments to the scheduled session service', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.create;
    if (!create) {
      throw new Error('Expected create operation');
    }

    const createSchedule = vi.fn().mockReturnValue({ scheduleId: 'schedule-1' });
    const result = await create(
      {
        agentId: 'agent',
        cron: '0 9 * * *',
        prompt: 'Review',
        sessionTitle: 'Daily Review',
        sessionConfig: {
          model: 'gpt-5.4',
          workingDir: '/tmp/project',
        },
        reuseSession: false,
        maxConcurrent: 2,
      },
      createCtx({
        scheduledSessionService: {
          createSchedule,
        },
      }),
    );

    expect(createSchedule).toHaveBeenCalledWith('agent', {
      cron: '0 9 * * *',
      prompt: 'Review',
      sessionTitle: 'Daily Review',
      sessionConfig: {
        model: 'gpt-5.4',
        workingDir: '/tmp/project',
      },
      reuseSession: false,
      maxConcurrent: 2,
    });
    expect(result).toEqual({ scheduleId: 'schedule-1' });
  });

  it('maps validation errors to invalid_arguments', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.create;
    if (!create) {
      throw new Error('Expected create operation');
    }

    await expect(
      create(
        { agentId: 'agent', cron: '0 9 * * *' },
        createCtx({
          scheduledSessionService: {
            createSchedule: vi.fn(() => {
              throw new ScheduleValidationError('bad schedule');
            }),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'bad schedule',
    } satisfies Partial<ToolError>);
  });

  it('rejects sessionConfig.sessionTitle and requires top-level sessionTitle', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.create;
    if (!create) {
      throw new Error('Expected create operation');
    }

    await expect(
      create(
        {
          agentId: 'agent',
          cron: '0 9 * * *',
          sessionConfig: {
            sessionTitle: 'Wrong place',
          },
        },
        createCtx({
          scheduledSessionService: {
            createSchedule: vi.fn(),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'sessionConfig.sessionTitle is not supported here; use sessionTitle instead',
    } satisfies Partial<ToolError>);
  });

  it('maps missing schedules to schedule_not_found', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const remove = plugin.operations?.delete;
    if (!remove) {
      throw new Error('Expected delete operation');
    }

    await expect(
      remove(
        { agentId: 'agent', scheduleId: 'missing' },
        createCtx({
          scheduledSessionService: {
            deleteSchedule: vi.fn(() => {
              throw new ScheduleNotFoundError('Schedule not found: missing');
            }),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'schedule_not_found',
      message: 'Schedule not found: missing',
    } satisfies Partial<ToolError>);
  });
});
