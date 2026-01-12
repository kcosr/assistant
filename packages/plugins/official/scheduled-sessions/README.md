# Scheduled Sessions Plugin

Monitor and control cron-driven agent sessions. The core scheduler runs in the agent server; this plugin adds UI, tools, and HTTP endpoints.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Panel](#panel)
- [Tools](#tools)
- [HTTP](#http)

## Configuration

```jsonc
{
  "plugins": {
    "scheduled-sessions": { "enabled": true }
  }
}
```

Schedules are defined on agents. See `docs/CONFIG.md` for the `schedules` schema.

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
- `scheduled_sessions_run`: trigger a run by agentId + scheduleId.
- `scheduled_sessions_enable`: enable a schedule at runtime.
- `scheduled_sessions_disable`: disable a schedule at runtime.

## HTTP

Endpoints:

- `GET /api/scheduled-sessions`: list schedules.
- `POST /api/scheduled-sessions/:agentId/:scheduleId/run`: trigger run (body: `{ "force": false }`).
- `POST /api/scheduled-sessions/:agentId/:scheduleId/enable`: enable schedule.
- `POST /api/scheduled-sessions/:agentId/:scheduleId/disable`: disable schedule.
