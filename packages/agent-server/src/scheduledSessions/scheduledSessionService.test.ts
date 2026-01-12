import { EventEmitter } from 'node:events';
import os from 'node:os';
import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { AgentRegistry } from '../agents';
import { ScheduledSessionService } from './scheduledSessionService';

type SpawnResult = {
  exitCode: number;
  stdout?: string;
  stderr?: string;
  defer?: boolean;
};

type SpawnCall = {
  command: string;
  args: string[];
};

function createSpawnStub(results: SpawnResult[]) {
  const calls: SpawnCall[] = [];
  const pending: Array<{ child: EventEmitter; result: SpawnResult }> = [];

  const spawnFn = ((command: string, args: string[]) => {
    const result = results.shift() ?? { exitCode: 0 };
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => void;
    };

    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn();

    calls.push({ command, args });

    if (result.defer) {
      pending.push({ child, result });
      return child as unknown;
    }

    process.nextTick(() => {
      if (result.stdout) {
        child.stdout.write(result.stdout);
      }
      if (result.stderr) {
        child.stderr.write(result.stderr);
      }
      child.stdout.end();
      child.stderr.end();
      child.emit('close', result.exitCode);
    });

    return child as unknown;
  }) as unknown as typeof import('node:child_process').spawn;

  const resolvePending = () => {
    for (const item of pending.splice(0, pending.length)) {
      item.child.emit('close', item.result.exitCode);
    }
  };

  return { spawnFn, calls, resolvePending };
}

function createService(
  scheduleOverrides: Partial<{
    id: string;
    cron: string;
    prompt?: string | null;
    preCheck?: string | null;
    enabled?: boolean;
    maxConcurrent?: number;
  }> = {},
  spawnFn?: typeof import('node:child_process').spawn,
) {
  const resolvedPrompt =
    scheduleOverrides.prompt === null
      ? undefined
      : scheduleOverrides.prompt ?? 'Review open PRs';
  const resolvedPreCheck =
    scheduleOverrides.preCheck === null ? undefined : scheduleOverrides.preCheck;

  const schedule = {
    id: scheduleOverrides.id ?? 'daily-review',
    cron: scheduleOverrides.cron ?? '0 9 * * *',
    enabled: scheduleOverrides.enabled ?? false,
    maxConcurrent: scheduleOverrides.maxConcurrent ?? 1,
    ...(resolvedPrompt ? { prompt: resolvedPrompt } : {}),
    ...(resolvedPreCheck ? { preCheck: resolvedPreCheck } : {}),
  };

  const registry = new AgentRegistry([
    {
      agentId: 'agent',
      displayName: 'Agent',
      description: 'Test agent',
      chat: {
        provider: 'codex-cli',
        config: { workdir: '/tmp' },
      },
      schedules: [schedule],
    },
  ]);

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const service = new ScheduledSessionService({
    agentRegistry: registry,
    logger,
    dataDir: os.tmpdir(),
    ...(spawnFn ? { spawnFn } : {}),
  });

  return { service, schedule };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('ScheduledSessionService', () => {
  it('skips runs that exceed max concurrency', async () => {
    const spawn = createSpawnStub([{ exitCode: 0, defer: true }]);
    const { service } = createService({ maxConcurrent: 1 }, spawn.spawnFn);

    await service.initialize();

    const first = await service.triggerRun('agent', 'daily-review');
    expect(first.status).toBe('started');

    await tick();

    const second = await service.triggerRun('agent', 'daily-review');
    expect(second).toEqual({ status: 'skipped', reason: 'max_concurrent' });

    spawn.resolvePending();
    service.shutdown();
  });

  it('composes prompt with pre-check output', async () => {
    const spawn = createSpawnStub([
      { exitCode: 0, stdout: 'deps: updated' },
      { exitCode: 0 },
    ]);
    const { service } = createService(
      { prompt: 'Review deps', preCheck: 'check-deps.sh' },
      spawn.spawnFn,
    );

    await service.initialize();

    await service.triggerRun('agent', 'daily-review');
    await tick();

    expect(spawn.calls).toHaveLength(2);
    const cliCall = spawn.calls[1];
    if (!cliCall) {
      throw new Error('Expected CLI spawn call');
    }
    const promptArg = cliCall.args[cliCall.args.length - 1];
    expect(promptArg).toBe('Review deps\n\ndeps: updated');

    service.shutdown();
  });

  it('runs manually even when schedule is disabled', async () => {
    const spawn = createSpawnStub([{ exitCode: 0 }]);
    const { service } = createService({ enabled: false }, spawn.spawnFn);

    await service.initialize();

    const result = await service.triggerRun('agent', 'daily-review');
    expect(result.status).toBe('started');

    await tick();
    expect(spawn.calls).toHaveLength(1);

    service.shutdown();
  });

  it('skips runs without prompt or pre-check', async () => {
    const spawn = createSpawnStub([]);
    const { service } = createService({ prompt: null, preCheck: null }, spawn.spawnFn);

    await service.initialize();

    const result = await service.triggerRun('agent', 'daily-review');
    expect(result).toEqual({ status: 'skipped', reason: 'no_prompt' });
    expect(spawn.calls).toHaveLength(0);

    service.shutdown();
  });
});
