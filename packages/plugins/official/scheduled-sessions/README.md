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

Each schedule can also carry an optional `sessionConfig` block with:
- `model`
- `thinking`
- `workingDir`
- `skills`

The schedule title remains the top-level `sessionTitle` field; it is not part of `sessionConfig`.

These values are validated against the selected agent when the schedule is created or updated,
then revalidated again when the schedule runs. When `reuseSession` is enabled, the backing
session is created up front and reconciled from the schedule on later runs after edits.

## Source files

- `packages/plugins/official/scheduled-sessions/manifest.json`
- `packages/plugins/official/scheduled-sessions/server/index.ts`
- `packages/plugins/official/scheduled-sessions/web/index.ts`
- `packages/plugins/official/scheduled-sessions/web/styles.css`

## Panel

- Panel type: `scheduled-sessions` (multi-instance, global scope).
- Shows schedule status by agent with enable/disable and run controls.
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

## HTTP

Endpoints:

- `POST /api/plugins/scheduled-sessions/operations/list`
- `POST /api/plugins/scheduled-sessions/operations/create`
- `POST /api/plugins/scheduled-sessions/operations/update`
- `POST /api/plugins/scheduled-sessions/operations/delete`
- `POST /api/plugins/scheduled-sessions/operations/run`
- `POST /api/plugins/scheduled-sessions/operations/enable`
- `POST /api/plugins/scheduled-sessions/operations/disable`

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
