# Time Tracker Plugin

Track time against named tasks with timers, manual entries, and date filters.

## Table of Contents

- [Panel](#panel)
- [Source files](#source-files)
- [Storage](#storage)
- [Operations](#operations)
- [Panel Events](#panel-events)
- [Panel Context](#panel-context)

## Panel

- Panel type: `time-tracker` (multi-instance, global scope).
- Timer state is stored server-side and persists across reloads.
- Instance selection comes from config (`plugins.time-tracker.instances`); the default instance id is `default`.

## Source files

- `packages/plugins/official/time-tracker/manifest.json`
- `packages/plugins/official/time-tracker/server/index.ts`
- `packages/plugins/official/time-tracker/web/index.ts`

## Storage

- Default instance SQLite database: `data/plugins/time-tracker/default/time-tracker.db`
- Additional instances: `data/plugins/time-tracker/<instanceId>/time-tracker.db`
- Schema versioning via `schema_migrations`.
- PRAGMAs on open: `foreign_keys = ON`, `journal_mode = WAL`.

## Operations

Operations are defined in `manifest.json` and exposed via tools/HTTP/CLI when enabled.

HTTP endpoint format:

```
POST /api/plugins/time-tracker/operations/<operationId>
```

Notable operations:

- `instance_list`
- `task_create`, `task_list`, `task_get`, `task_update`, `task_delete`
- `entry_create`, `entry_list`, `entry_get`, `entry_update`, `entry_delete`
- `timer_start`, `timer_status`, `timer_stop`, `timer_discard`
- `set_filter` (broadcasts a panel range update)

All operations accept an optional `instance_id` (defaults to `default`).

## Panel Events

The server broadcasts panel events to keep time tracker panels in sync:

- `time-tracker:task:created` `{ task }`
- `time-tracker:task:updated` `{ task }`
- `time-tracker:task:deleted` `{ id }`
- `time-tracker:entry:created` `{ entry }`
- `time-tracker:entry:updated` `{ entry }`
- `time-tracker:entry:deleted` `{ id }`
- `time-tracker:timer:started` `{ timer }`
- `time-tracker:timer:stopped` `{ timer_id, entry }`
- `time-tracker:timer:discarded` `{ timer_id }`
- `time-tracker:filter:set` `{ start_date, end_date }`

Each event payload also includes `instance_id`.

Events are delivered over the session WebSocket as `panel_event` messages.

## Panel Context

When the time tracker panel is active, it sets context for chat messages:

```
{
  "type": "time-tracker",
  "id": "<task id or instance id>",
  "name": "<task name or 'Time Tracker'>",
  "instance_id": "<instance id>",
  "task_id": "<selected task id or null>",
  "task_name": "<selected task name or null>",
  "contextAttributes": {
    "instance-id": "<instance id>",
    "task-id": "<task id if selected>",
    "task-name": "<task name if selected>"
  }
}
```

The `contextAttributes` are included in the chat context line when sending messages with panel context enabled (e.g., `instance-id="default"`, `task-name="Project X"`).
