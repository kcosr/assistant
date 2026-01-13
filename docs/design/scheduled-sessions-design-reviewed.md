# Scheduled Sessions

## Design Review Updates (Jan 2026)

This document has been lightly updated to resolve a few inconsistencies and cover important runtime edge cases:

- **Unified service constructor + state model**: one `ScheduledSessionServiceOptions` that includes `agentRegistry`, `logger`, and optional `broadcast`. `ScheduleState` owns `runningCount`, `nextRunAt`, and `lastRun` (no separate `running` map needed).
- **`Run Now` behavior clarified**: **respects** `maxConcurrent` by default; supports an optional `force` flag to bypass.
- **Timer edge cases covered**: handles negative delays and Node’s `setTimeout` maximum delay (~24.8 days) by “waking up” and re-scheduling.
- **Validation tightened**: `prompt` must be non-empty if provided; `id` uniqueness per agent and cron validity validated in schema refinement.
- **Status + lastRun bookkeeping**: `lastRun` and WebSocket payloads aligned with the HTTP response and UI needs.
- **Security note**: `preCheck` executes via a shell; explicitly documented as trusted-config-only.

---

## Overview

Scheduled sessions allow agents to run automatically based on cron expressions. Each agent can define multiple schedules that trigger CLI sessions with configured prompts, optional pre-check scripts, and concurrency controls.

## Goals

- Run agent sessions on cron schedules (e.g., daily at 9am, every 30 minutes)
- Support pre-check scripts that gate execution and provide dynamic prompt data
- Control concurrency per schedule (skip if previous run still active)
- Provide optional UI/API for runtime control (trigger, enable/disable)
- Comprehensive logging of schedule execution

## Non-Goals

- Catch-up/backfill for missed runs during server downtime
- Persistent state across restarts
- Complex workflow orchestration

## Config Schema

Schedules are defined under each agent in `config.json`:

```json
{
  "agents": [
    {
      "agentId": "repo-maintainer",
      "displayName": "Repo Maintainer",
      "description": "Maintains repository health",
      "chat": {
        "provider": "claude-cli",
        "config": {
          "workdir": "/home/kevin/myrepo",
          "extraArgs": ["--model", "sonnet", "--dangerously-skip-permissions"]
        }
      },
      "schedules": [
        {
          "id": "daily-review",
          "cron": "0 9 * * *",
          "prompt": "Review open PRs and issues. Summarize status.",
          "enabled": true,
          "maxConcurrent": 1
        },
        {
          "id": "hourly-deps-check",
          "cron": "0 * * * *",
          "preCheck": "/home/kevin/scripts/check-outdated-deps.sh",
          "prompt": "The following dependencies are outdated:",
          "enabled": true,
          "maxConcurrent": 1
        },
        {
          "id": "ci-monitor",
          "cron": "*/15 * * * *",
          "preCheck": "/home/kevin/scripts/check-ci-failures.sh",
          "enabled": true,
          "maxConcurrent": 1
        }
      ]
    }
  ]
}
```

### Schedule Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | string | yes | - | Unique identifier within the agent |
| `cron` | string | yes | - | 5-field cron expression |
| `prompt` | string | no | - | Static prompt text (must be non-empty if present) |
| `preCheck` | string | no | - | Command to run before session |
| `enabled` | boolean | no | `true` | Whether schedule is active (config default) |
| `maxConcurrent` | number | no | `1` | Max concurrent runs of this schedule |

> **Note on security**: `preCheck` is executed via a shell. This is acceptable for a trusted, local config file, but should not be exposed to untrusted users/inputs.

### Cron Expression Examples

| Expression | Description |
|------------|-------------|
| `*/5 * * * *` | Every 5 minutes |
| `*/30 * * * *` | Every 30 minutes |
| `0 */2 * * *` | Every 2 hours (on the hour) |
| `0 9 * * *` | Daily at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `0 0 * * 0` | Weekly on Sunday at midnight |

### Prompt Composition

The final prompt sent to the agent is composed as:

1. If `preCheck` is defined and exits 0, capture its stdout as `preCheckOutput`
2. If both `prompt` and `preCheckOutput` exist: `prompt + "\n\n" + preCheckOutput`
3. If only `prompt` exists: `prompt`
4. If only `preCheckOutput` exists: `preCheckOutput`
5. If neither exists: skip run (log warning)

### Pre-Check Script Contract

The `preCheck` command is executed via shell:

- **Exit code 0**: Proceed with session, stdout becomes `preCheckOutput`
- **Exit code non-zero**: Skip this run (logged as `skipped`, not an error)
- **Stderr**: Logged but not used in prompt
- **Timeout**: 30 seconds (configurable later if needed)

Example pre-check script:

```bash
#!/bin/bash
# check-outdated-deps.sh
outdated=$(npm outdated --json 2>/dev/null)
if [ -z "$outdated" ] || [ "$outdated" = "{}" ]; then
  exit 1  # Nothing outdated, skip run
fi
echo "$outdated"
exit 0
```

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent Server                              │
│                                                                  │
│  ┌────────────────────┐      ┌─────────────────────────────┐   │
│  │ ScheduledSession   │      │ scheduled-sessions plugin   │   │
│  │ Service            │◄────►│ (optional)                  │   │
│  │                    │      │                             │   │
│  │ - Timer management │      │ - HTTP endpoints            │   │
│  │ - Cron parsing     │      │ - Tools                     │   │
│  │ - Concurrency      │      │ - Panel                     │   │
│  │ - Session spawning │      │                             │   │
│  └────────────────────┘      └─────────────────────────────┘   │
│            │                                                     │
│            ▼                                                     │
│  ┌────────────────────┐                                         │
│  │ CLI Providers      │                                         │
│  │ (claude, pi, codex)│                                         │
│  └────────────────────┘                                         │
└─────────────────────────────────────────────────────────────────┘
```

### ScheduledSessionService

Core service that manages schedule execution. Not a plugin.

```typescript
// packages/agent-server/src/scheduledSessions/scheduledSessionService.ts

import parser from 'cron-parser';
import { spawn } from 'node:child_process';

import type { AgentRegistry } from '../agents';
import type { Logger } from '../logger';
import type {
  PreCheckResult,
  ScheduleInfo,
  ScheduleState,
  ScheduleStatusEvent,
  TriggerResult,
} from './types';

export interface ScheduledSessionServiceOptions {
  agentRegistry: AgentRegistry;
  logger: Logger;
  broadcast?: (event: ScheduleStatusEvent) => void; // optional: core service can run without WS
}

export class ScheduledSessionService {
  private readonly schedules = new Map<string, ScheduleState>();
  private initialized = false;

  constructor(private readonly options: ScheduledSessionServiceOptions) {}

  async initialize(): Promise<void>;
  shutdown(): void;

  // Runtime control (used by plugin)
  listSchedules(): ScheduleInfo[];
  triggerRun(
    agentId: string,
    scheduleId: string,
    options?: { force?: boolean }
  ): Promise<TriggerResult>;
  setEnabled(agentId: string, scheduleId: string, enabled: boolean): void;
  clearEnabledOverride(agentId: string, scheduleId: string): void;

  // Internal
  private scheduleNext(key: string, state: ScheduleState): void;
  private async executeSchedule(
    key: string,
    state: ScheduleState,
    options?: { force?: boolean; manual?: boolean }
  ): Promise<void>;
  private async runPreCheck(command: string, workdir: string): Promise<PreCheckResult>;
  private async spawnSession(agentId: string, prompt: string): Promise<void>;
}
```

#### Key Methods

**`initialize()`**

Called on server startup:

1. Iterate all agents from registry
2. For each agent with `schedules`, create `ScheduleState` entries
3. Calculate next run time for each schedule
4. Set timers via `setTimeout`

```typescript
async initialize(): Promise<void> {
  if (this.initialized) return;
  this.initialized = true;

  const { agentRegistry, logger } = this.options;

  for (const agent of agentRegistry.listAgents()) {
    if (!agent.schedules?.length) continue;

    for (const schedule of agent.schedules) {
      const key = this.buildKey(agent.agentId, schedule.id);

      const state: ScheduleState = {
        agentId: agent.agentId,
        schedule,
        timer: null,
        runtimeEnabled: null,
        runningCount: 0,
        runningStartedAt: null,
        nextRunAt: null,
        lastRun: null,
      };

      this.schedules.set(key, state);

      if (this.isEnabled(state)) {
        this.scheduleNext(key, state);
      }

      logger.info(`[scheduled-sessions] Registered ${key}, cron: ${schedule.cron}`);
      this.broadcastStatus(key, state);
    }
  }
}
```

**`scheduleNext()`**

Calculate next run time and set timer.

Includes two important edge cases:

- **Negative delay**: clamp to 0 and run immediately.
- **Node setTimeout max**: `setTimeout` effectively maxes out at ~2,147,483,647ms (~24.8 days). For longer delays, set a “wake-up” timer and re-schedule.

```typescript
private static readonly MAX_TIMEOUT_MS = 2_147_483_647; // ~24.8 days

private scheduleNext(key: string, state: ScheduleState): void {
  const { logger } = this.options;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }

  if (!this.isEnabled(state)) {
    state.nextRunAt = null;
    this.broadcastStatus(key, state);
    return;
  }

  try {
    const expr = parser.parseExpression(state.schedule.cron);
    const next = expr.next().toDate();
    state.nextRunAt = next;

    const delayRaw = next.getTime() - Date.now();
    const delay = Math.max(0, delayRaw);

    logger.info(
      `[scheduled-sessions] ${key} next run at ${next.toISOString()} (in ${Math.round(delay / 1000)}s)`
    );

    // If delay is too large, wake up and recalc later.
    const timeoutMs = Math.min(delay, ScheduledSessionService.MAX_TIMEOUT_MS);

    state.timer = setTimeout(() => {
      if (delay > ScheduledSessionService.MAX_TIMEOUT_MS) {
        // Not time yet; recompute nextRunAt from "now".
        this.scheduleNext(key, state);
        return;
      }
      void this.executeSchedule(key, state);
    }, timeoutMs);

    this.broadcastStatus(key, state);
  } catch (err) {
    logger.error(`[scheduled-sessions] ${key} invalid cron: ${err}`);
    state.nextRunAt = null;
    this.broadcastStatus(key, state);
  }
}
```

**`executeSchedule()`**

Run a scheduled session:

```typescript
private async executeSchedule(
  key: string,
  state: ScheduleState,
  options?: { force?: boolean; manual?: boolean }
): Promise<void> {
  const { agentId, schedule } = state;
  const { logger } = this.options;

  // Schedule next run immediately (don't wait for this run to complete)
  // For manual runs, do not change the scheduled timer.
  if (!options?.manual) {
    this.scheduleNext(key, state);
  }

  // Check enabled (scheduled runs only). Manual runs can execute even if disabled.
  if (!options?.manual && !this.isEnabled(state)) {
    logger.info(`[scheduled-sessions] ${key} skipped: disabled`);
    this.recordLastRun(state, { result: 'skipped', skipReason: 'disabled' });
    this.broadcastStatus(key, state);
    return;
  }

  // Check concurrency unless forced
  if (!options?.force) {
    const limit = schedule.maxConcurrent ?? 1;
    if (state.runningCount >= limit) {
      logger.warn(
        `[scheduled-sessions] ${key} skipped: max concurrent (${limit}) reached`
      );
      this.recordLastRun(state, { result: 'skipped', skipReason: 'max_concurrent' });
      this.broadcastStatus(key, state);
      return;
    }
  }

  state.runningCount += 1;
  if (state.runningCount === 1) {
    state.runningStartedAt = new Date();
  }

  logger.info(`[scheduled-sessions] ${key} starting run (running=${state.runningCount})`);
  this.broadcastStatus(key, state);

  try {
    // Run pre-check if defined
    let preCheckOutput: string | null = null;
    if (schedule.preCheck) {
      const result = await this.runPreCheck(schedule.preCheck, this.getWorkdir(agentId));

      logger.info(
        `[scheduled-sessions] ${key} preCheck exited with code ${result.exitCode}`
      );

      if (result.exitCode !== 0) {
        logger.info(`[scheduled-sessions] ${key} skipped: preCheck returned non-zero`);
        this.recordLastRun(state, { result: 'skipped', skipReason: 'precheck_nonzero' });
        return;
      }

      preCheckOutput = result.stdout;
      if (preCheckOutput) {
        logger.debug(`[scheduled-sessions] ${key} preCheck output: ${preCheckOutput}`);
      }
    }

    // Compose prompt
    const prompt = this.composePrompt(schedule.prompt, preCheckOutput);
    if (!prompt) {
      logger.warn(`[scheduled-sessions] ${key} skipped: no prompt`);
      this.recordLastRun(state, { result: 'skipped', skipReason: 'no_prompt' });
      return;
    }

    logger.info(`[scheduled-sessions] ${key} running with prompt (${prompt.length} chars)`);

    // Spawn session
    await this.spawnSession(agentId, prompt);

    logger.info(`[scheduled-sessions] ${key} completed`);
    this.recordLastRun(state, { result: 'completed' });
  } catch (err) {
    logger.error(`[scheduled-sessions] ${key} failed: ${err}`);
    this.recordLastRun(state, { result: 'failed', error: String(err) });
  } finally {
    state.runningCount = Math.max(0, state.runningCount - 1);
    if (state.runningCount === 0) {
      state.runningStartedAt = null;
    }

    this.broadcastStatus(key, state);
  }
}
```

**`runPreCheck()`**

Execute pre-check command:

```typescript
private async runPreCheck(command: string, workdir: string): Promise<PreCheckResult> {
  const { logger } = this.options;

  return new Promise((resolve) => {
    const child = spawn(command, [], {
      shell: true,
      cwd: workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');

      // Optional: escalate if SIGTERM doesn't stop it quickly.
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref();

      logger.warn(`[scheduled-sessions] preCheck timeout after 30s: ${command}`);
      resolve({ exitCode: -1, stdout: '', stderr: 'timeout' });
    }, 30_000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: code ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: String(err),
      });
    });
  });
}
```

**`spawnSession()`**

Spawn the CLI session (output discarded):

```typescript
private async spawnSession(agentId: string, prompt: string): Promise<void> {
  const agent = this.options.agentRegistry.getAgent(agentId);
  if (!agent?.chat) throw new Error(`Agent ${agentId} has no chat config`);

  const provider = agent.chat.provider;
  const config = agent.chat.config as CliChatConfig | undefined;

  // Build command based on provider (respects wrapper config)
  const { command, args, env, cwd } = this.buildCliCommand(provider, config, prompt);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'ignore', 'ignore'], // discard output
      detached: false,
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`CLI exited with code ${code}`));
    });

    child.on('error', reject);
  });
}
```

> **Note**: Even if you discard stdout/stderr, consider logging a short error on non-zero exit codes and retaining the full details in server logs if you later choose to pipe output.

### Zod Schema Addition

Add to `config.ts`:

```typescript
const ScheduleConfigSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  cron: NonEmptyTrimmedStringSchema,
  prompt: NonEmptyTrimmedStringSchema.optional(),
  preCheck: NonEmptyTrimmedStringSchema.optional(),
  enabled: z.boolean().optional().default(true),
  maxConcurrent: z.number().int().min(1).optional().default(1),
});

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

// Add to RawAgentConfigSchema:
const RawAgentConfigSchema = z.object({
  // ... existing fields ...
  schedules: z.array(ScheduleConfigSchema).optional(),
}).superRefine((val, ctx) => {
  // Validate schedule IDs unique within agent + cron validity + prompt/preCheck presence.
  if (!val.schedules?.length) return;

  const seen = new Set<string>();
  for (const s of val.schedules) {
    if (seen.has(s.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedules'],
        message: `Duplicate schedule id "${s.id}" within agent "${val.agentId}"`,
      });
    }
    seen.add(s.id);

    if (!isValidCron5Field(s.cron)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedules', s.id, 'cron'],
        message: `Invalid 5-field cron expression: "${s.cron}"`,
      });
    }

    if (!s.prompt && !s.preCheck) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedules', s.id],
        message: `Schedule "${s.id}" must define "prompt", "preCheck", or both`,
      });
    }
  }
});
```

Validation:
- `id` must be unique within agent
- `cron` must be valid 5-field expression (validate with `cron-parser` or helper)
- Either `prompt` or `preCheck` must be defined (or both)

## Plugin: scheduled-sessions

Optional plugin providing HTTP API, tools, and panel.

### Plugin Config

```json
{
  "plugins": {
    "scheduled-sessions": {
      "enabled": true
    }
  }
}
```

### HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/scheduled-sessions` | List all schedules with status |
| `POST` | `/api/scheduled-sessions/:agentId/:scheduleId/run` | Trigger immediate run (optional `force`) |
| `POST` | `/api/scheduled-sessions/:agentId/:scheduleId/enable` | Enable schedule |
| `POST` | `/api/scheduled-sessions/:agentId/:scheduleId/disable` | Disable schedule (runtime hold) |

#### GET /api/scheduled-sessions

Response:

```json
{
  "schedules": [
    {
      "agentId": "repo-maintainer",
      "scheduleId": "daily-review",
      "cron": "0 9 * * *",
      "prompt": "Review open PRs...",
      "preCheck": null,
      "enabled": true,
      "runtimeEnabled": true,
      "status": "idle",
      "runningCount": 0,
      "runningStartedAt": null,
      "maxConcurrent": 1,
      "nextRun": "2026-01-12T09:00:00.000Z",
      "lastRun": null
    }
  ]
}
```

#### POST .../run

Request body (optional):

```json
{ "force": false }
```

Response:

```json
{
  "status": "started" | "skipped",
  "reason": "max_concurrent" | "disabled" | "no_prompt" | "precheck_nonzero" | null
}
```

#### POST .../enable, .../disable

Response:

```json
{
  "agentId": "repo-maintainer",
  "scheduleId": "daily-review",
  "enabled": true
}
```

### Tools

```typescript
const tools: ToolDefinition[] = [
  {
    name: 'scheduled_sessions_list',
    description: 'List all scheduled sessions with their status',
    parameters: {},
  },
  {
    name: 'scheduled_sessions_run',
    description: 'Trigger an immediate run of a scheduled session',
    parameters: {
      agentId: { type: 'string', required: true },
      scheduleId: { type: 'string', required: true },
      force: { type: 'boolean', required: false },
    },
  },
  {
    name: 'scheduled_sessions_enable',
    description: 'Enable a scheduled session',
    parameters: {
      agentId: { type: 'string', required: true },
      scheduleId: { type: 'string', required: true },
    },
  },
  {
    name: 'scheduled_sessions_disable',
    description: 'Disable a scheduled session (put on hold)',
    parameters: {
      agentId: { type: 'string', required: true },
      scheduleId: { type: 'string', required: true },
    },
  },
];
```

### Panel

The panel provides real-time status of all scheduled sessions via WebSocket updates.

#### Panel Header

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Scheduled Sessions                                      [↻ Refresh]        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3 schedules  •  1 running  •  1 disabled                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Schedule List (Expanded View)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ▼ repo-maintainer                                              2 schedules │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ● daily-review                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Cron      0 9 * * *  (Daily at 9:00 AM)                            │   │
│  │  Next      Mon Jan 12, 9:00 AM  (in 12h 57m)                        │   │
│  │  Status    Idle                                                      │   │
│  │  Last Run  Sun Jan 11, 9:00 AM  ✓ completed                         │   │
│  │                                                                      │   │
│  │  Prompt    Review open PRs and issues. Summarize status.            │   │
│  │                                                                      │   │
│  │  [▶ Run Now]  [⏸ Disable]                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ○ hourly-deps-check                                            RUNNING    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Cron      0 * * * *  (Every hour)                                  │   │
│  │  Next      Sun Jan 11, 9:00 PM  (in 57m)                            │   │
│  │  Status    Running (1/1)  ██████████░░░░░░░░░░ 2m 34s               │   │
│  │  Last Run  Sun Jan 11, 7:00 PM  ✓ completed                         │   │
│  │                                                                      │   │
│  │  PreCheck  /home/kevin/scripts/check-outdated-deps.sh               │   │
│  │  Prompt    The following dependencies are outdated:                 │   │
│  │                                                                      │   │
│  │  [▶ Run Now]  [⏸ Disable]                     (disabled while running) │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│ ▼ ci-agent                                                     1 schedule  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ◌ ci-monitor                                                   DISABLED   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Cron      */15 * * * *  (Every 15 minutes)                         │   │
│  │  Next      —                                                         │   │
│  │  Status    Disabled                                                  │   │
│  │  Last Run  Sun Jan 11, 6:45 PM  ✗ failed (exit code 1)              │   │
│  │                                                                      │   │
│  │  PreCheck  /home/kevin/scripts/check-ci-failures.sh                 │   │
│  │                                                                      │   │
│  │  [▶ Run Now]  [▶ Enable]                                            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Compact View (Collapsed)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Scheduled Sessions                                      [↻]                 │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3 schedules  •  1 running  •  1 disabled                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ ● repo-maintainer/daily-review      0 9 * * *       in 12h   Idle     [▶]  │
│ ○ repo-maintainer/hourly-deps       0 * * * *       in 57m   Running  [▶]  │
│ ◌ ci-agent/ci-monitor               */15 * * * *    —        Disabled [▶]  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Status Indicators

| Icon | Meaning |
|------|---------|
| ● | Enabled, idle (green) |
| ○ | Running (blue, animated pulse) |
| ◌ | Disabled (gray) |
| ✓ | Last run succeeded |
| ✗ | Last run failed |
| ⊘ | Last run skipped (preCheck/concurrency/etc.) |

#### Real-Time Updates

The panel subscribes to WebSocket events for live updates:

```typescript
// Server → Client events
{
  type: 'scheduled_session:status',
  payload: {
    agentId: string;
    scheduleId: string;
    status: 'idle' | 'running' | 'disabled';
    runningCount: number;
    runningStartedAt: string | null;  // ISO timestamp, for elapsed time display
    nextRun: string | null;           // ISO timestamp
    lastRun: {
      timestamp: string;
      result: 'completed' | 'failed' | 'skipped';
      error?: string;       // short message for UI
      skipReason?: string;
    } | null;
  }
}

// Emitted on:
// - Schedule starts running
// - Schedule completes/fails/skips
// - Schedule enabled/disabled
// - Next run time recalculated
```

#### Actions

| Action | Behavior |
|--------|----------|
| **Run Now** | Triggers immediate run (respects `maxConcurrent` by default; optional `force`) |
| **Disable** | Puts schedule on hold (cancels pending timer) |
| **Enable** | Resumes schedule (calculates next run) |
| **Refresh** | Re-fetches all schedule status from server |

#### Expand/Collapse

- Click agent row to expand/collapse all schedules under it
- Click schedule row to expand/collapse details
- State persisted in localStorage

#### Implementation Notes

- **Human-readable cron**: Use `cronstrue` library to convert cron expressions to descriptions like "At 09:00 AM" or "Every 15 minutes"
- **Elapsed time**: Track `startedAt` timestamp for running schedules, display as "2m 34s elapsed"
- **Error display**: Show short error messages in UI (e.g., "exit code 1"), full details in server logs
- **lastRun state**: Stored in-memory only, resets on server restart (acceptable for MVP)
- **WebSocket events**: Use existing plugin WebSocket broadcast mechanism (see notes plugin pattern)

## Logging

All logs prefixed with `[scheduled-sessions]`:

### Initialization

```
[scheduled-sessions] Registered repo-maintainer:daily-review, cron: 0 9 * * *
[scheduled-sessions] repo-maintainer:daily-review next run at 2026-01-12T09:00:00.000Z (in 46800s)
```

### Schedule Execution

```
[scheduled-sessions] repo-maintainer:daily-review starting run (running=1)
[scheduled-sessions] repo-maintainer:daily-review preCheck exited with code 0
[scheduled-sessions] repo-maintainer:daily-review running with prompt (156 chars)
[scheduled-sessions] repo-maintainer:daily-review completed
```

### Skip Conditions

```
[scheduled-sessions] repo-maintainer:daily-review skipped: max concurrent (1) reached
[scheduled-sessions] repo-maintainer:daily-review skipped: preCheck returned non-zero
[scheduled-sessions] repo-maintainer:daily-review skipped: no prompt
[scheduled-sessions] repo-maintainer:daily-review skipped: disabled
```

### Errors

```
[scheduled-sessions] repo-maintainer:daily-review invalid cron: Error: Invalid cron expression
[scheduled-sessions] repo-maintainer:daily-review failed: Error: CLI exited with code 1
[scheduled-sessions] preCheck timeout after 30s: /home/kevin/scripts/check-ci-failures.sh
```

## Dependencies

Add to `packages/agent-server/package.json`:

```json
{
  "dependencies": {
    "cron-parser": "^4.9.0",
    "cronstrue": "^2.50.0"
  }
}
```

Run `npm install` from the monorepo root.

## File Structure

```
packages/agent-server/src/
├── scheduledSessions/
│   ├── index.ts                      # Re-exports
│   ├── scheduledSessionService.ts    # Core service
│   ├── scheduledSessionService.test.ts
│   ├── types.ts                      # All type definitions
│   └── cronUtils.ts                  # Cron parsing helpers
├── plugins/
│   └── scheduled-sessions/
│       ├── index.ts                  # Plugin entry point
│       ├── plugin.ts                 # Plugin implementation
│       ├── httpRoutes.ts             # HTTP endpoint handlers
│       └── tools.ts                  # Tool definitions
└── config.ts                         # Add ScheduleConfigSchema
```

## Reference Files

Study these existing files for patterns to follow:

| File | Why |
|------|-----|
| `packages/agent-server/src/gitVersioning/gitVersioningService.ts` | Timer-based service pattern, initialization, shutdown |
| `packages/agent-server/src/config.ts` | Zod schema definitions, config loading |
| `packages/agent-server/src/agents.ts` | `AgentDefinition` interface, `AgentRegistry` class |
| `packages/agent-server/src/index.ts` | Service initialization and wiring |
| `packages/agent-server/src/plugins/notes/plugin.ts` | Plugin structure, WebSocket broadcasts |
| `packages/agent-server/src/ws/` | WebSocket event broadcasting |

## Complete Type Definitions

Create `packages/agent-server/src/scheduledSessions/types.ts`:

```typescript
export interface ScheduleConfig {
  id: string;
  cron: string;
  prompt?: string;
  preCheck?: string;
  enabled: boolean;
  maxConcurrent: number;
}

export interface ScheduleState {
  agentId: string;
  schedule: ScheduleConfig;
  timer: NodeJS.Timeout | null;
  runtimeEnabled: boolean | null;  // null = use config value
  runningCount: number;
  runningStartedAt: Date | null;
  nextRunAt: Date | null;
  lastRun: LastRunInfo | null;
}

export interface LastRunInfo {
  timestamp: Date;
  result: 'completed' | 'failed' | 'skipped';
  error?: string;
  skipReason?: 'disabled' | 'no_prompt' | 'max_concurrent' | 'precheck_nonzero' | string;
}

export interface PreCheckResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ScheduleInfo {
  agentId: string;
  scheduleId: string;
  cron: string;
  cronDescription: string;  // from cronstrue
  prompt?: string;
  preCheck?: string;
  enabled: boolean;          // config value
  runtimeEnabled: boolean;   // effective value
  status: 'idle' | 'running' | 'disabled';
  runningCount: number;
  runningStartedAt: string | null;
  maxConcurrent: number;
  nextRun: string | null;
  lastRun: {
    timestamp: string;
    result: 'completed' | 'failed' | 'skipped';
    error?: string;
    skipReason?: string;
  } | null;
}

export interface TriggerResult {
  status: 'started' | 'skipped';
  reason?: 'disabled' | 'no_prompt' | 'max_concurrent' | 'precheck_nonzero' | null;
}

// WebSocket event payload
export interface ScheduleStatusEvent {
  type: 'scheduled_session:status';
  payload: ScheduleInfo;
}
```

## Service Initialization

In `packages/agent-server/src/index.ts`, add initialization after `AgentRegistry` is created:

```typescript
import { ScheduledSessionService } from './scheduledSessions';

// After agentRegistry is created:
const scheduledSessionService = new ScheduledSessionService({
  agentRegistry,
  logger,
  broadcast: (event) => {
    // Use existing WebSocket broadcast mechanism
    // See how notes plugin broadcasts events
    wsServer.broadcast(event);
  },
});

// During server startup:
await scheduledSessionService.initialize();

// During shutdown:
scheduledSessionService.shutdown();
```

## Plugin Registration

The plugin must implement the `ToolPlugin` interface. Register it in the plugin loader:

```typescript
// packages/agent-server/src/plugins/scheduled-sessions/plugin.ts
import type { ToolPlugin } from '../types';

export function createScheduledSessionsPlugin(
  scheduledSessionService: ScheduledSessionService
): ToolPlugin {
  return {
    id: 'scheduled-sessions',

    getTools() {
      return [
        // ... tool definitions
      ];
    },

    async executeTool(name: string, args: Record<string, unknown>) {
      switch (name) {
        case 'scheduled_sessions_list':
          return scheduledSessionService.listSchedules();
        case 'scheduled_sessions_run':
          return scheduledSessionService.triggerRun(
            args.agentId as string,
            args.scheduleId as string,
            { force: Boolean(args.force) }
          );
        // ... other tools
      }
    },

    registerRoutes(router: Router) {
      // GET /api/scheduled-sessions
      // POST /api/scheduled-sessions/:agentId/:scheduleId/run
      // POST /api/scheduled-sessions/:agentId/:scheduleId/enable
      // POST /api/scheduled-sessions/:agentId/:scheduleId/disable
    },
  };
}
```

## Implementation Checklist

### Phase 1: Core Service

- [ ] **1.1** Add `cron-parser` and `cronstrue` to `packages/agent-server/package.json`
- [ ] **1.2** Run `npm install` from monorepo root
- [ ] **1.3** Create `packages/agent-server/src/scheduledSessions/types.ts` with all type definitions
- [ ] **1.4** Create `packages/agent-server/src/scheduledSessions/cronUtils.ts`:
  - [ ] `parseNextRun(cron: string): Date` - uses cron-parser
  - [ ] `describeCron(cron: string): string` - uses cronstrue
  - [ ] `isValidCron5Field(cron: string): boolean` - validation helper
- [ ] **1.5** Add `ScheduleConfigSchema` to `packages/agent-server/src/config.ts` (with refinement)
- [ ] **1.6** Add `schedules?: ScheduleConfig[]` to `AgentDefinition` in `packages/agent-server/src/agents.ts`
- [ ] **1.7** Update `AgentConfigSchema` transform in `config.ts` to pass through schedules
- [ ] **1.8** Create `packages/agent-server/src/scheduledSessions/scheduledSessionService.ts`:
  - [ ] Constructor with `AgentRegistry`, `Logger`, optional `broadcast`
  - [ ] `initialize()` - iterate agents, register schedules, start timers
  - [ ] `shutdown()` - clear all timers
  - [ ] `buildKey(agentId, scheduleId)` - returns `"agentId:scheduleId"`
  - [ ] `isEnabled(state)` - checks runtimeEnabled ?? config enabled
  - [ ] `scheduleNext(key, state)` - calculate next run, set setTimeout (handles MAX_TIMEOUT)
  - [ ] `executeSchedule(key, state)` - run preCheck, compose prompt, spawn CLI
  - [ ] `runPreCheck(command, workdir)` - spawn shell, capture output, 30s timeout
  - [ ] `composePrompt(prompt, preCheckOutput)` - combine with `\n\n`
  - [ ] `spawnSession(agentId, prompt)` - spawn CLI (reuse existing CLI spawning logic)
  - [ ] `listSchedules()` - return all ScheduleInfo
  - [ ] `triggerRun(agentId, scheduleId, { force })` - immediate run (force optional)
  - [ ] `setEnabled(agentId, scheduleId, enabled)` - runtime override
  - [ ] `clearEnabledOverride(agentId, scheduleId)` - back to config default
  - [ ] `broadcastStatus(key, state)` - emit WebSocket event (if broadcast provided)
- [ ] **1.9** Create `packages/agent-server/src/scheduledSessions/index.ts` - re-export service and types
- [ ] **1.10** Wire up service in `packages/agent-server/src/index.ts`:
  - [ ] Import service
  - [ ] Create instance after AgentRegistry
  - [ ] Call `initialize()` during startup
  - [ ] Call `shutdown()` during graceful shutdown
- [ ] **1.11** Add tests in `scheduledSessionService.test.ts`:
  - [ ] Mock cron-parser to control timing
  - [ ] Test schedule registration
  - [ ] Test preCheck execution (exit 0, exit non-zero, timeout)
  - [ ] Test prompt composition
  - [ ] Test concurrency limiting (for scheduled + manual runs)
  - [ ] Test enable/disable
  - [ ] Test triggerRun respects maxConcurrent by default + supports `force`

### Phase 2: Plugin

- [ ] **2.1** Create `packages/agent-server/src/plugins/scheduled-sessions/` directory
- [ ] **2.2** Create `tools.ts` with tool definitions
- [ ] **2.3** Create `httpRoutes.ts` with route handlers
- [ ] **2.4** Create `plugin.ts` implementing `ToolPlugin` interface
- [ ] **2.5** Create `index.ts` re-exporting plugin factory
- [ ] **2.6** Register plugin in plugin loader (see how other plugins are registered)
- [ ] **2.7** Add plugin config schema if needed
- [ ] **2.8** Add tests

### Phase 3: UI Panel

- [ ] **3.1** Create panel component (location TBD based on UI architecture)
- [ ] **3.2** Implement compact list view
- [ ] **3.3** Implement expanded detail view
- [ ] **3.4** Add WebSocket subscription for `scheduled_session:status` events
- [ ] **3.5** Implement Run Now / Enable / Disable buttons
- [ ] **3.6** Add expand/collapse with localStorage persistence
- [ ] **3.7** Add elapsed time display (calculate from `runningStartedAt`)

## Wrapper Support

Scheduled sessions **will** respect the `wrapper` config for containerized runs.

When implementing `spawnSession()`, look at existing CLI spawning code in `chatRunCore.ts` for how wrapper commands are constructed. The pattern is:

```typescript
if (config.wrapper) {
  // Spawn wrapper.path with wrapper.env, passing CLI as argument
} else {
  // Spawn CLI directly
}
```

## Timezone

Cron expressions use **server local time**. The `cron-parser` library defaults to the system timezone. No explicit timezone configuration is needed initially.

> **UI note**: `nextRun` is returned as an ISO timestamp (UTC via `toISOString()`), which is unambiguous; the UI should render it in the user’s locale/timezone.

## Testing Strategy

For timer-based code:

```typescript
// Mock cron-parser to return controlled next times
vi.mock('cron-parser', () => ({
  parseExpression: vi.fn(() => ({
    next: () => ({ toDate: () => new Date(Date.now() + 1000) })
  }))
}));

// Use vi.useFakeTimers() to control setTimeout
vi.useFakeTimers();
// ... setup ...
vi.advanceTimersByTime(1000);
// ... assert schedule executed ...
```

## Future Enhancements (Deferred)

### Notification System

A lightweight notification system for real-time alerts:

- Bell icon in UI header with badge count
- WebSocket-based push notifications
- Notification types: `scheduled_session_start`, `_complete`, `_failed`, `_skipped`
- Dismiss individual or clear all

### Session Tagging

Tag scheduled sessions with metadata (`source: "scheduled"`, `scheduleId`) using the existing `SessionAttributes` system. Would allow filtering scheduled vs manual sessions.

### Webhooks

External webhook integration for schedule events:

```json
{
  "webhooks": [
    {
      "url": "https://example.com/webhook",
      "events": ["scheduled_session_failed"],
      "secret": "${WEBHOOK_SECRET}"
    }
  ]
}
```
