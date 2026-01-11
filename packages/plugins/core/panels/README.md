# Panels Plugin

The panels plugin exposes operations for listing panel instances, reading the
selected panel, querying the layout tree, and sending panel commands/events to
the web client.

## Table of Contents

- [Enable](#enable)
- [Source files](#source-files)
- [Operations](#operations)

## Enable

```json
{
  "plugins": {
    "panels": { "enabled": true }
  }
}
```

## Source files

- `packages/plugins/core/panels/manifest.json`
- `packages/plugins/core/panels/server/index.ts`

## Operations

- `list` → `panels_list`
- `selected` → `panels_selected`
- `tree` → `panels_tree`
- `event` → `panels_event`
- `open` → `panels_open`
- `close` → `panels_close`
- `remove` → `panels_remove`
- `replace` → `panels_replace`
- `move` → `panels_move`
- `toggle-split-view` → `panels_toggle-split-view`
- `close-split` → `panels_close-split`

Panel command operations (open/close/remove/replace/move/toggle/close-split)
require an active websocket client for the target session.
If no session id is provided from HTTP/CLI, the command is broadcast to all
connected clients.

Placement objects use `region` (left/right/top/bottom/center) with optional
`size` overrides. `position` is accepted as an alias for `region`.

`tree` supports `format: "json" | "text" | "both"` (default: `json`).
`list` and `selected` accept `includeLayout` to include the layout tree and header panel ids.

HTTP endpoints are available under:

- `POST /api/plugins/panels/operations/list`
- `POST /api/plugins/panels/operations/selected`
- `POST /api/plugins/panels/operations/tree`
- `POST /api/plugins/panels/operations/event`
- `POST /api/plugins/panels/operations/open`
- `POST /api/plugins/panels/operations/close`
- `POST /api/plugins/panels/operations/remove`
- `POST /api/plugins/panels/operations/replace`
- `POST /api/plugins/panels/operations/move`
- `POST /api/plugins/panels/operations/toggle-split-view`
- `POST /api/plugins/panels/operations/close-split`
