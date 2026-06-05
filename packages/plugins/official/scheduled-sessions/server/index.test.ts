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
    expect(typeof plugin.operations?.['wakeup-list']).toBe('function');
    expect(typeof plugin.operations?.['wakeup-create']).toBe('function');
    expect(typeof plugin.operations?.['wakeup-update']).toBe('function');
    expect(typeof plugin.operations?.['wakeup-cancel']).toBe('function');
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

  it('lists wake-ups for the current session', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const list = plugin.operations?.['wakeup-list'];
    if (!list) {
      throw new Error('Expected wakeup-list operation');
    }

    const listWakeupsForSession = vi.fn().mockResolvedValue([{ wakeupId: 'wakeup-1' }]);
    const result = await list(
      {},
      createCtx({
        sessionId: 'session-1',
        scheduledSessionService: {
          listWakeupsForSession,
        },
      }),
    );

    expect(listWakeupsForSession).toHaveBeenCalledWith('session-1');
    expect(result).toEqual({ wakeups: [{ wakeupId: 'wakeup-1' }] });
  });

  it('lists all wake-ups for the panel when no session context is present', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const list = plugin.operations?.['wakeup-list'];
    if (!list) {
      throw new Error('Expected wakeup-list operation');
    }

    const listWakeups = vi.fn().mockResolvedValue([{ wakeupId: 'wakeup-1' }]);
    const listWakeupsForSession = vi.fn();
    const result = await list(
      {},
      createCtx({
        sessionId: undefined,
        scheduledSessionService: {
          listWakeups,
          listWakeupsForSession,
        },
      }),
    );

    expect(listWakeups).toHaveBeenCalledWith();
    expect(listWakeupsForSession).not.toHaveBeenCalled();
    expect(result).toEqual({ wakeups: [{ wakeupId: 'wakeup-1' }] });
  });

  it('creates a wake-up for the current session using delaySeconds', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.['wakeup-create'];
    if (!create) {
      throw new Error('Expected wakeup-create operation');
    }

    const createWakeupForSession = vi.fn().mockResolvedValue({ wakeupId: 'wakeup-1' });
    const before = Date.now();
    const result = await create(
      {
        message: 'Check issue status',
        delaySeconds: 60,
      },
      createCtx({
        sessionId: 'session-1',
        scheduledSessionService: {
          createWakeupForSession,
        },
      }),
    );

    expect(createWakeupForSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: 'Check issue status',
      runAt: expect.any(Date),
    });
    const runAt = createWakeupForSession.mock.calls[0]?.[0]?.runAt as Date;
    expect(runAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(result).toEqual({ wakeupId: 'wakeup-1' });
  });

  it('creates a wake-up for the current session using runAt', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.['wakeup-create'];
    if (!create) {
      throw new Error('Expected wakeup-create operation');
    }

    const runAt = '2026-06-03T12:00:00.000Z';
    const createWakeupForSession = vi.fn().mockResolvedValue({ wakeupId: 'wakeup-1' });
    await create(
      {
        message: 'Check issue status',
        runAt,
      },
      createCtx({
        sessionId: 'session-1',
        scheduledSessionService: {
          createWakeupForSession,
        },
      }),
    );

    expect(createWakeupForSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: 'Check issue status',
      runAt: new Date(runAt),
    });
  });

  it('creates a wake-up using runAt with an explicit timezone offset', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.['wakeup-create'];
    if (!create) {
      throw new Error('Expected wakeup-create operation');
    }

    const runAt = '2026-06-03T08:56:00-05:00';
    const createWakeupForSession = vi.fn().mockResolvedValue({ wakeupId: 'wakeup-1' });
    await create(
      {
        message: 'Check issue status',
        runAt,
      },
      createCtx({
        sessionId: 'session-1',
        scheduledSessionService: {
          createWakeupForSession,
        },
      }),
    );

    expect(createWakeupForSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      message: 'Check issue status',
      runAt: new Date(runAt),
    });
  });

  it('rejects wake-up create without exactly one time input', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.['wakeup-create'];
    if (!create) {
      throw new Error('Expected wakeup-create operation');
    }

    await expect(
      create(
        {
          message: 'Check issue status',
        },
        createCtx({
          scheduledSessionService: {
            createWakeupForSession: vi.fn(),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Provide exactly one of runAt or delaySeconds',
    } satisfies Partial<ToolError>);
  });

  it('rejects wake-up runAt without a timezone offset', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const create = plugin.operations?.['wakeup-create'];
    if (!create) {
      throw new Error('Expected wakeup-create operation');
    }

    await expect(
      create(
        {
          message: 'Check issue status',
          runAt: '2026-06-03T08:56:00',
        },
        createCtx({
          scheduledSessionService: {
            createWakeupForSession: vi.fn(),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message:
        'runAt must include a timezone offset or Z, for example 2026-06-03T08:56:00-05:00 or 2026-06-03T13:56:00Z',
    } satisfies Partial<ToolError>);
  });

  it('updates a current-session wake-up by id', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const update = plugin.operations?.['wakeup-update'];
    if (!update) {
      throw new Error('Expected wakeup-update operation');
    }

    const updateWakeupForSession = vi.fn().mockResolvedValue({
      wakeupId: 'wakeup-1',
      message: 'Updated',
    });
    const result = await update(
      {
        wakeupId: 'wakeup-1',
        message: 'Updated',
        delaySeconds: 30,
      },
      createCtx({
        sessionId: 'session-1',
        scheduledSessionService: {
          updateWakeupForSession,
        },
      }),
    );

    expect(updateWakeupForSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      wakeupId: 'wakeup-1',
      message: 'Updated',
      runAt: expect.any(Date),
    });
    expect(result).toEqual({ wakeupId: 'wakeup-1', message: 'Updated' });
  });

  it('rejects wake-up update without changes', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const update = plugin.operations?.['wakeup-update'];
    if (!update) {
      throw new Error('Expected wakeup-update operation');
    }

    await expect(
      update(
        { wakeupId: 'wakeup-1' },
        createCtx({
          scheduledSessionService: {
            updateWakeupForSession: vi.fn(),
          },
        }),
      ),
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Provide message, runAt, or delaySeconds to update',
    } satisfies Partial<ToolError>);
  });

  it('cancels the current session wake-up by id', async () => {
    const plugin = createPlugin({
      manifest: manifestJson as CombinedPluginManifest,
    });
    const cancel = plugin.operations?.['wakeup-cancel'];
    if (!cancel) {
      throw new Error('Expected wakeup-cancel operation');
    }

    const cancelWakeupForSession = vi.fn().mockResolvedValue({
      cancelled: true,
      sessionId: 'session-1',
      wakeupId: 'wakeup-1',
    });
    const result = await cancel(
      { wakeupId: 'wakeup-1' },
      createCtx({
        sessionId: 'session-1',
        scheduledSessionService: {
          cancelWakeupForSession,
        },
      }),
    );

    expect(cancelWakeupForSession).toHaveBeenCalledWith('session-1', 'wakeup-1');
    expect(result).toEqual({
      cancelled: true,
      sessionId: 'session-1',
      wakeupId: 'wakeup-1',
    });
  });
});
