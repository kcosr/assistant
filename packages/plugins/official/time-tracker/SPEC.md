# Time Tracker Plugin - Specification

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Out of Scope (for now)](#out-of-scope-for-now)
- [Data Model](#data-model)
- [Panel Layout](#panel-layout)
- [UI Components](#ui-components)
- [Duration Handling](#duration-handling)
- [Agent Tools / CLI](#agent-tools--cli)
- [Storage](#storage)
- [WebSocket / Panel Events](#websocket--panel-events)
- [Error Handling](#error-handling)

## Overview

A simple time tracking plugin with named tasks, timer support, and date range filtering. Designed for keyboard-first usage with agent/CLI integration. Supports multiple configured instances; each instance has its own tasks, entries, and active timer. The default instance id is `default`.

## Source files

- `packages/plugins/official/time-tracker/manifest.json`
- `packages/plugins/official/time-tracker/server/index.ts`
- `packages/plugins/official/time-tracker/server/store.ts`
- `packages/plugins/official/time-tracker/web/index.ts`

## Out of Scope (for now)

- Tags on tasks/entries
- Reports (saving snapshots of time periods)
- Multi-user / authentication
- Pause/resume timer (only start/stop/discard)

## Data Model

Data is scoped per instance; each instance has its own task list, entries, and active timer.

### Task

| Field         | Type          | Description                         |
| ------------- | ------------- | ----------------------------------- |
| `id`          | uuid          | Primary key                         |
| `name`        | string        | Required, unique (case-insensitive) |
| `description` | string        | Optional, default empty             |
| `created_at`  | ISO timestamp |                                     |
| `updated_at`  | ISO timestamp | Updated on any modification         |

- Deleting a task cascades to delete all its entries
- Task `updated_at` is updated when: task is edited, entry is added/modified/deleted for that task

### Entry

| Field              | Type          | Description                             |
| ------------------ | ------------- | --------------------------------------- |
| `id`               | uuid          | Primary key                             |
| `task_id`          | uuid          | References task (CASCADE delete)        |
| `entry_date`       | YYYY-MM-DD    | The "work day" for this entry           |
| `duration_minutes` | integer       | >= 1                                    |
| `reported`         | boolean       | Whether the entry is reported           |
| `note`             | string        | Optional, default empty                 |
| `entry_type`       | enum          | 'manual' \| 'timer'                     |
| `start_time`       | ISO timestamp | Only for timer entries, NULL for manual |
| `end_time`         | ISO timestamp | Only for timer entries, NULL for manual |
| `created_at`       | ISO timestamp |                                         |
| `updated_at`       | ISO timestamp | Default sort field                      |

- Both timer and manual entries display identically in the UI (no visual distinction)
- Entry list default sort: `updated_at` DESC

### Active Timer (singleton per instance - max one at a time)

| Field                 | Type          | Description                      |
| --------------------- | ------------- | -------------------------------- |
| `id`                  | uuid          | Primary key                      |
| `task_id`             | uuid          | References task (CASCADE delete) |
| `entry_date`          | YYYY-MM-DD    | Captured at timer start          |
| `accumulated_seconds` | integer       | Persisted elapsed time           |
| `last_resumed_at`     | ISO timestamp | For calculating current elapsed  |
| `created_at`          | ISO timestamp | When timer was started           |

- Timer persists across browser/panel close
- Only one active timer allowed at any time
- Timer duration = `accumulated_seconds + (now - last_resumed_at)`

## Panel Layout

### Plugin Manifest

```json
{
  "id": "time-tracker",
  "panels": [
    {
      "type": "time-tracker",
      "title": "Time Tracker",
      "multiInstance": true,
      "defaultSessionBinding": "global",
      "sessionScope": "global"
    }
  ]
}
```

### Two-Zone Layout (Option B)

```
┌─────────────────────────────────────────────┐
│               TRACK TIME                    │
│  ┌───────────────────────────────────────┐  │
│  │ [Search or create task...          ▼] │  │
│  └───────────────────────────────────────┘  │
│  ┌─────────────────┐  ┌─────────────────┐   │
│  │ ⏱ Start Timer   │  │ + Add 0:30 ▼   │   │
│  └─────────────────┘  └─────────────────┘   │
│  Note: [optional note for entry...      ]   │
├─────────────────────────────────────────────┤
│ ENTRIES  [Today] [Week] [Month] [📅 Range]  │
├─────────────────────────────────────────────┤
│ ┌─ Jan 7 ──────────────────────────── 2:15 │
│ │  Project X        1:30        [Edit][✕]  │
│ │  Bug fixes        0:45        [Edit][✕]  │
│ ├─ Jan 6 ──────────────────────────── 2:00 │
│ │  Meetings         2:00        [Edit][✕]  │
│ └──────────────────────────────────────────│
│                              Total: 4:15    │
└─────────────────────────────────────────────┘
```

## UI Components

### Instance Selector

- Shown in the panel header when multiple instances are configured.
- Selecting an instance switches the scoped task list, entries, and active timer.
- Default instance id is `default` and remains available even when additional instances are configured.

### Task Dropdown (Fuzzy Search)

**Behavior:**

- Text input with dropdown
- As user types, shows matching tasks
- Fuzzy matching on task `name` (substring, case-insensitive)
- Results sorted by task `updated_at` DESC (most recently modified first)
- Top option always: "➕ Create new task..." (even when no search text)
- Keyboard: Arrow keys to navigate, Enter to select, Escape to close

**"Create new task" flow:**

1. User selects "➕ Create new task..."
2. Modal opens with fields: Name (required), Description (optional)
3. On save: task created, modal closes, new task selected in dropdown

**Empty state:**

- If no tasks exist, dropdown shows only "➕ Create new task..."

### Track Zone States

**State 1: No task selected**

```
┌─────────────────────────────────────────────┐
│  [Search or create task...              ▼]  │
│                                             │
│  (Select a task to start tracking)          │
└─────────────────────────────────────────────┘
```

**State 2: Task selected, no timer running**

```
┌─────────────────────────────────────────────┐
│  [Project X ▼] (change task)      [Edit 📝] │
│  ┌─────────────────┐  ┌─────────────────┐   │
│  │ ⏱ Start Timer   │  │ + Add [0:30▼]  │   │
│  └─────────────────┘  └─────────────────┘   │
│  Note: [optional note...                ]   │
└─────────────────────────────────────────────┘
```

- Edit button opens task edit modal
- Duration dropdown: common values (0:15, 0:30, 0:45, 1:00, 1:30, 2:00) + "Custom..." option
- "Custom..." opens input for arbitrary duration

**State 3: Timer running**

```
┌─────────────────────────────────────────────┐
│  ⏱ Project X                    01:23:45   │
│                                             │
│  [Stop & Save]  [Discard]                   │
│  Note: [optional note...                ]   │
└─────────────────────────────────────────────┘
```

- Timer display updates every second
- Note can be entered while timer is running
- "Stop & Save" immediately logs the entry and returns to State 2

### Date Range Picker

**Preset buttons:**
| Preset | Range |
|--------|-------|
| Today | Current date only (`today` to `today`) |
| Week | Monday to Sunday of current week |
| Month | 1st to last day of current month |

- Presets are relative to current date at time of click
- Active preset is visually highlighted

**Custom range:**

- Click the date range display (e.g., "Jan 1 - Jan 7") to open calendar popup
- Calendar popup appears inside panel (not a global modal)
- Click a date to set start, click another to set end
- Or click-drag to select range
- "Apply" / "Cancel" buttons in popup
- Clicking outside popup cancels

### Entry List

**Grouping:**

- Entries grouped by `entry_date` (descending - newest dates first)
- Each group header: date + daily total duration
- Within each group: entries sorted by `updated_at` DESC
- If a task is selected, only entries for that task are shown; otherwise all tasks appear

**Entry row:**

```
│  Task Name          1:30        [Edit][✕]  │
│  Note preview if present...                 │
```

- Task name (clickable? → could open task edit, or just show tooltip)
- Duration in h:mm format
- Edit button → opens entry edit modal
- Delete button (✕) → confirmation dialog, then delete

**Range total:**

- Bottom of list shows total duration for current date range filter
- Total reflects the selected task if one is active

**Empty state:**

- "No entries for this period" message

### Edit Modal (Task)

```
┌─────────────────────────────────────────────┐
│  Edit Task                            [✕]  │
├─────────────────────────────────────────────┤
│  Name:                                      │
│  [____________________________________]     │
│                                             │
│  Description:                               │
│  [____________________________________]     │
│  [____________________________________]     │
│                                             │
│  [Delete Task]              [Cancel] [Save] │
└─────────────────────────────────────────────┘
```

- Delete Task → confirmation: "Delete task and all X entries?"
- Name is required, shows error if empty or duplicate

### Edit Modal (Entry)

```
┌─────────────────────────────────────────────┐
│  Edit Entry                           [✕]  │
├─────────────────────────────────────────────┤
│  Task: [Project X                      ▼]   │
│                                             │
│  Date: [2026-01-07                    📅]   │
│                                             │
│  Duration: [1:30                        ]   │
│                                             │
│  Note:                                      │
│  [____________________________________]     │
│                                             │
│  [Delete Entry]             [Cancel] [Save] │
└─────────────────────────────────────────────┘
```

- Task dropdown allows moving entry to different task
- Date picker for changing entry date
- Duration input (accepts multiple formats, see below)
- Delete Entry → confirmation: "Delete this entry?"

### Delete Confirmations

All delete actions show a confirmation dialog:

- Task: "Delete 'Task Name' and all 5 entries? [Cancel] [Delete]"
- Entry: "Delete this 1:30 entry from Jan 7? [Cancel] [Delete]"

## Duration Handling

### API / Storage

- Always `duration_minutes` as integer (minimum 1)
- Timer stop: `duration_minutes = max(1, ceil(elapsed_seconds / 60))`

### UI Display

- Formatted as "1h 30m" for 90 minutes, "45m" for 45 minutes, "2h" for 120 minutes
- Timer display shows "01:23:45" (hh:mm:ss) while running

### UI Input

- Text field accepts user-friendly formats, parsed to minutes client-side before API call
- Examples (all → 90 minutes): `1:30`, `90`, `90m`, `1.5h`, `1h30m`, `1h 30m`
- Invalid input shows error, doesn't submit

## Agent Tools / CLI

Plugin ID: `time-tracker`

### Operations

All operations accept an optional `instance_id` (defaults to `default`).

| Operation       | Description           | Parameters                                                                                                         |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `instance_list` | List instances        | (none)                                                                                                             |
| `task_create`   | Create a task         | `name` (required), `description` (optional)                                                                        |
| `task_list`     | List/search tasks     | `query` (optional, fuzzy search)                                                                                   |
| `task_get`      | Get single task       | `id` (required)                                                                                                    |
| `task_update`   | Update a task         | `id` (required), `name`, `description`                                                                             |
| `task_delete`   | Delete task + entries | `id` (required)                                                                                                    |
| `entry_create`  | Log a time entry      | `task_id` (required), `duration_minutes` (required), `entry_date` (optional, defaults to today), `note` (optional), `reported` (optional) |
| `entry_list`    | Query entries         | `start_date`, `end_date`, `task_id`, `include_reported` (all optional)                                              |
| `entry_get`     | Get single entry      | `id` (required)                                                                                                    |
| `entry_update`  | Update an entry       | `id` (required), `task_id`, `duration_minutes`, `entry_date`, `note`, `reported`                                   |
| `entry_delete`  | Delete an entry       | `id` (required)                                                                                                    |
| `timer_start`   | Start timer           | `task_id` (required), `entry_date` (optional, defaults to today)                                                   |
| `timer_status`  | Get active timer      | (none)                                                                                                             |
| `timer_stop`    | Stop timer → entry    | `note` (optional)                                                                                                  |
| `timer_discard` | Discard timer         | (none)                                                                                                             |
| `set_filter`    | Set panel date range  | `start_date` (required), `end_date` (required), `panel_id` (optional, all panels if omitted)                       |
| `export_xlsx`   | Export XLSX           | `rows` (required), `start_date`/`end_date` (optional)                                                              |

## Export (XLSX)

- Export is initiated from the time-tracker panel and respects the current view filters (instance, task, date range, and "Show reported").
- The export dialog shows a summary and offers to mark exported entries as reported (default on).
- The XLSX file includes columns: Item, Hours, Minutes, Hours (Decimal), Description (multi-line notes).
- Column widths are fixed for Item (80) and Description (160).
- A totals row with formulas is appended, and the Hours (Decimal) total cell is highlighted green.

### CLI Examples

```bash
# Create a task
time-tracker-cli task_create --name "Project X" --description "Main project"

# List configured instances
time-tracker-cli instance_list

# Log time
time-tracker-cli entry_create --task_id abc123 --duration_minutes 90 --note "Fixed bug"

# Log time to a specific instance
time-tracker-cli entry_create --instance_id work --task_id abc123 --duration_minutes 90

# Query this month's time
time-tracker-cli entry_list --start_date 2026-01-01 --end_date 2026-01-31

# Start timer
time-tracker-cli timer_start --task_id abc123

# Set panel filter (agent can say "show me this month")
time-tracker-cli set_filter --start_date 2026-01-01 --end_date 2026-01-31
```

## Storage

- Default instance SQLite database: `data/plugins/time-tracker/default/time-tracker.db`
- Additional instances: `data/plugins/time-tracker/<instanceId>/time-tracker.db`
- Pragmas on open:
  - `PRAGMA foreign_keys = ON`
  - `PRAGMA journal_mode = WAL`

### Schema

```sql
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_tasks_updated_at ON tasks(updated_at DESC);
CREATE INDEX idx_tasks_name ON tasks(name COLLATE NOCASE);

CREATE TABLE entries (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    entry_date TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 1),
    reported INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    entry_type TEXT NOT NULL CHECK (entry_type IN ('manual', 'timer')),
    start_time TEXT,
    end_time TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
        (entry_type = 'manual' AND start_time IS NULL AND end_time IS NULL)
        OR
        (entry_type = 'timer' AND start_time IS NOT NULL AND end_time IS NOT NULL)
    )
);

CREATE INDEX idx_entries_task_id ON entries(task_id);
CREATE INDEX idx_entries_entry_date ON entries(entry_date);
CREATE INDEX idx_entries_updated_at ON entries(updated_at DESC);

CREATE TABLE active_timer (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    entry_date TEXT NOT NULL,
    accumulated_seconds INTEGER NOT NULL DEFAULT 0,
    last_resumed_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
-- Only one timer allowed (enforced by having only one row possible)
```

## WebSocket / Panel Events

### Server → Panel Events

Each event payload includes `instance_id`.

| Event                          | Payload                    | Description                  |
| ------------------------------ | -------------------------- | ---------------------------- |
| `time-tracker:task:created`    | `{ task }`                 | Task was created             |
| `time-tracker:task:updated`    | `{ task }`                 | Task was modified            |
| `time-tracker:task:deleted`    | `{ id }`                   | Task was deleted             |
| `time-tracker:entry:created`   | `{ entry }`                | Entry was created            |
| `time-tracker:entry:updated`   | `{ entry }`                | Entry was modified           |
| `time-tracker:entry:deleted`   | `{ id }`                   | Entry was deleted            |
| `time-tracker:timer:started`   | `{ timer }`                | Timer started                |
| `time-tracker:timer:stopped`   | `{ timer_id, entry }`      | Timer stopped, entry created |
| `time-tracker:timer:discarded` | `{ timer_id }`             | Timer discarded              |
| `time-tracker:filter:set`      | `{ start_date, end_date }` | Agent set filter             |

### Panel → Server Events

Panel uses HTTP operations (POST to `/api/plugins/time-tracker/operations/<op>`) rather than WebSocket for mutations. WebSocket is receive-only for real-time updates.

## Error Handling

### API Errors

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Task name is required"
  }
}
```

Common error codes:

- `VALIDATION_ERROR` - Invalid input
- `NOT_FOUND` - Task/entry doesn't exist
- `DUPLICATE_NAME` - Task name already exists
- `TIMER_ALREADY_ACTIVE` - Tried to start timer when one is running
- `NO_ACTIVE_TIMER` - Tried to stop/discard when no timer

### UI Error Display

- Inline error messages in forms
- Toast notifications for operation failures
