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

- `windows` → `panels_windows`
- `list` → `panels_list`
- `selected` → `panels_selected`
- `tree` → `panels_tree`
- `event` → `panels_event`
- `open` → `panels_open`
- `close` → `panels_close`
- `remove` → `panels_remove`
- `replace` → `panels_replace`
- `move` → `panels_move`
- `close-split` → `panels_close-split`

Panel command operations (open/close/remove/replace/move/close-split)
require an active websocket client for the target session.
If no session id is provided from HTTP/CLI, the command is broadcast to all
connected clients.
When multiple windows are active, pass `windowId` to target a specific window.

Layout-aware operations are pane-first:

- `panels_windows` lists the active window ids and each window's current selection state.
- `panels_list` / `panels_selected` / `panels_tree` can include `windowId` and expose `selectedPaneId`.
- Inventory items include `paneId`, `tabIndex`, and `tabCount`.
- `panels_open` uses:
  - `mode: "tab"` to add to a pane
  - `mode: "split"` plus `direction` to create a new split beside a pane
  - `mode: "header"` to pin to the header
- `panels_move` uses the same `mode` and target model.
- Targeting can use exactly one of `targetPaneId`, `targetPanelId`, or `afterPanelId`.
- `size` is only valid for split mode.

`tree` supports `format: "json" | "text" | "both"` (default: `json`).
`list` and `selected` accept `includeLayout` to include the layout tree and header panel ids.
`windows`, `list`, `selected`, and `tree` accept `windowId` to select a specific window when multiple are active.

HTTP endpoints are available under:

- `POST /api/plugins/panels/operations/windows`
- `POST /api/plugins/panels/operations/list`
- `POST /api/plugins/panels/operations/selected`
- `POST /api/plugins/panels/operations/tree`
- `POST /api/plugins/panels/operations/event`
- `POST /api/plugins/panels/operations/open`
- `POST /api/plugins/panels/operations/close`
- `POST /api/plugins/panels/operations/remove`
- `POST /api/plugins/panels/operations/replace`
- `POST /api/plugins/panels/operations/move`
- `POST /api/plugins/panels/operations/close-split`
