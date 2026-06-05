# Scheduled Sessions Plugin

Monitor and control cron-driven agent sessions. The core scheduler runs in the agent server; this plugin adds UI plus generated tools, HTTP operations, and CLI commands.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Panel](#panel)
- [Tools](#tools)
- [HTTP](#http)
- [CLI](#cli)

## Configuration

```jsonc
{
  "plugins": {
    "scheduled-sessions": { "enabled": true }
  }
}
```

Schedules are no longer defined on agents.
Schedules are stored in the plugin default instance data directory at
`data/plugins/scheduled-sessions/default/schedules.json`.
They are persisted immediately on create, update, delete, enable, and disable.

Pending one-shot session wake-ups are stored in the same plugin instance under
`data/plugins/scheduled-sessions/default/wakeups.json`.

Each schedule can also carry an optional `sessionConfig` block with:
- `model`
- `thinking`
- `workingDir`
- `skills`

The schedule title remains the top-level `sessionTitle` field; it is not part of `sessionConfig`.

These values are validated against the selected agent when the schedule is created or updated,
then revalidated again when the schedule runs. When `reuseSession` is enabled, the backing
session is created up front and reconciled from the schedule on later runs after edits.

Wake-ups target native Pi SDK sessions only. `wakeup-create`, `wakeup-list`, `wakeup-update`, and
`wakeup-cancel` operate on the current session context. A session can have multiple pending
wake-ups. When a wake-up fires while its target session is busy, the wake-up message is added to
the session message queue.

## Source files

- `packages/plugins/official/scheduled-sessions/manifest.json`
- `packages/plugins/official/scheduled-sessions/server/index.ts`
- `packages/plugins/official/scheduled-sessions/web/index.ts`
- `packages/plugins/official/scheduled-sessions/web/styles.css`

## Panel

- Panel type: `scheduled-sessions` (multi-instance, global scope).
- Shows pending wake-ups and schedules in a flat compact list with collapsed-by-default schedule details, a live title/session/message/agent filter, wake-up cancel controls, and schedule enable/disable plus run controls.
- Live updates via WebSocket events from the server.

## Tools

Tools are exposed when plugin tools are enabled:

- `scheduled_sessions_list`: list schedules and status.
- `scheduled_sessions_create`: create a runtime-managed schedule.
- `scheduled_sessions_update`: update an existing schedule.
- `scheduled_sessions_delete`: delete a schedule.
- `scheduled_sessions_run`: trigger a run by agentId + scheduleId.
- `scheduled_sessions_enable`: enable a schedule at runtime.
- `scheduled_sessions_disable`: disable a schedule at runtime.
- `scheduled_sessions_wakeup_list`: list pending session wake-ups for the current session.
- `scheduled_sessions_wakeup_create`: schedule a wake-up for the current session using `delaySeconds` or an absolute `runAt` ISO timestamp with a timezone offset or `Z` (for example `2026-06-03T08:56:00-05:00` or `2026-06-03T13:56:00Z`).
- `scheduled_sessions_wakeup_update`: update a pending wake-up for the current session by `wakeupId`.
- `scheduled_sessions_wakeup_cancel`: cancel a wake-up for the current session by `wakeupId`.

## HTTP

Endpoints:

- `POST /api/plugins/scheduled-sessions/operations/list`
- `POST /api/plugins/scheduled-sessions/operations/create`
- `POST /api/plugins/scheduled-sessions/operations/update`
- `POST /api/plugins/scheduled-sessions/operations/delete`
- `POST /api/plugins/scheduled-sessions/operations/run`
- `POST /api/plugins/scheduled-sessions/operations/enable`
- `POST /api/plugins/scheduled-sessions/operations/disable`
- `POST /api/plugins/scheduled-sessions/operations/wakeup-list`
- `POST /api/plugins/scheduled-sessions/operations/wakeup-create`
- `POST /api/plugins/scheduled-sessions/operations/wakeup-update`
- `POST /api/plugins/scheduled-sessions/operations/wakeup-cancel`

Responses use the standard generated plugin operations envelope:

```json
{
  "ok": true,
  "result": {}
}
```

## CLI

This plugin now participates in generated CLI output when plugin builds are run:

```bash
npm run build:plugins
./dist/skills/assistant-scheduled-sessions/assistant-scheduled-sessions-cli list
./dist/skills/assistant-scheduled-sessions/assistant-scheduled-sessions-cli create --agentId coding --cron "0 9 * * *" --prompt "Daily review"
```
