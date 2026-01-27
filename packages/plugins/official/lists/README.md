# Lists Plugin

List management with a dedicated lists panel, list item CRUD, tags, and browser previews.

## Table of Contents

- [Overview](#overview)
- [AQL Search](#aql-search)
- [Source files](#source-files)
- [Web UI Architecture](#web-ui-architecture)
- [UI Composition Diagram](#ui-composition-diagram)
- [Data and Event Flow](#data-and-event-flow)
- [Panel Updates](#panel-updates)
- [Panel Context](#panel-context)
- [Sharing with Notes](#sharing-with-notes)

## Overview

The lists plugin is a thin orchestration layer that wires shared web-client controllers
(collection search, dropdowns, browser) to list-specific detail rendering and server
operations.

- Panel type: `lists` (multi-instance, global scope).
- Instance selection comes from config (`plugins.lists.instances`); the default instance id is
  `default`.
- When multiple instances are selected, the list metadata dialog includes a Profile selector and
  uses the `move` operation to relocate lists between instances.
- Default instance data lives under `data/plugins/lists/default/`; additional instances use
  `data/plugins/lists/<instanceId>/`.
- Server operations: defined in `manifest.json` and implemented in `server/index.ts`.
- Web UI: implemented in `web/index.ts` using shared controllers from `packages/web-client/src`.
- Drag within a list to reorder, or drag selected items across list panels to move them to the
  drop position.
- Dragging list items to external apps provides a plain-text item block (list metadata + item
  details) for easy paste.
- Select and checkbox custom fields can be edited inline from list rows without opening the edit
  dialog (toggle in settings, default on).
- Reference custom fields let list items link to notes or lists via a picker; list rows render
  clickable references.
- Cmd/Ctrl+C/X/V support copy/cut/paste of selected list items between lists; external paste
  uses the same plain-text item block.
- The lists dropdown includes a quick-add (+) action to add an item to a list without switching views.
- Browser mode supports arrow-key grid navigation with Enter to open a list; Escape returns to the
  browser view from list mode.
- Press **p** in browser mode to toggle pinned lists, or in list view to toggle pinned list items.
  Pinned entries show a pin icon and appear in the command palette via `/pinned`.
- Favorite lists from the add/edit dialog; favorites show a heart icon and appear in the command
  palette via `/favorites`.
- Column headers stick while scrolling list items.
- Column widths can be resized per panel and persist for the panel session.
- AQL mode provides structured list-item queries with filters, boolean logic, `ORDER BY`, and `SHOW` for column visibility/order.
- List item single-click behavior is configurable (none, select, open edit modal, open edit modal in review mode) via settings.
- Capacitor Android builds and narrow viewports show floating add/search buttons in list view; search opens the command palette.
- Custom fields can be reordered in the list metadata dialog.
- List item editor supports Edit and Review modes; Review shows a report-style view with markdown previews and inline edit buttons, and the default mode is configurable in settings.

All operations accept an optional `instance_id` (defaults to `default`), and `instance_list` reports
configured instances.

## AQL Search

AQL is a structured query mode for list items. Toggle **AQL** in the search bar (list mode only),
then press Enter or **Apply** to run the query. Raw search mode still applies live as you type.
Saved queries are stored per list + instance and can be loaded from the Saved dropdown. You can
mark one saved query as the default view for a list.
Server-side AQL evaluation is available via the `items-aql` tool/CLI command, and `aql-apply`
can target a specific lists panel to apply a query.

Syntax highlights:

- Boolean logic: `AND`, `OR`, `NOT`, parentheses.
- Operators: `:`, `!:`, `=`, `!=`, `>`, `>=`, `<`, `<=`, `IN`.
- Empty checks: `IS EMPTY`, `IS NOT EMPTY`.
- Ordering: `ORDER BY updated DESC, priority ASC`.
- Column visibility/order: `SHOW title, status, priority`.

Fields:

- Built-ins: `title`, `notes`, `url`, `tag`, `added`, `updated`, `touched`, `completed`, `position`.
- Custom fields: reference by key or label (labels must be unique).

Examples:

```
status = "Ready" AND NOT title : "wip"
```

```
priority >= 2 AND tag IN (urgent, "needs-review")
ORDER BY updated DESC
SHOW title, status, priority
```

## Source files

- `packages/plugins/official/lists/manifest.json`
- `packages/plugins/official/lists/server/index.ts`
- `packages/plugins/official/lists/web/index.ts`

## Web UI Architecture

The lists panel is assembled in `packages/plugins/official/lists/web/index.ts` from shared controllers:

- Shared UI controllers:
  - `packages/web-client/src/controllers/collectionPanelSearchController.ts`
  - `packages/web-client/src/controllers/collectionDropdown.ts`
  - `packages/web-client/src/controllers/collectionBrowserController.ts`
  - `packages/web-client/src/controllers/collectionPanelBody.ts`
- List detail controller:
  - `packages/web-client/src/controllers/listPanelController.ts`

List detail rendering uses list-specific sub-controllers:

- `packages/web-client/src/controllers/listPanelHeaderRenderer.ts`
- `packages/web-client/src/controllers/listPanelTableController.ts`
- `packages/web-client/src/controllers/listItemMenuController.ts`
- `packages/web-client/src/controllers/listItemEditorDialog.ts`

Shared utilities and styling:

- `packages/web-client/src/utils/listColumnPreferences.ts`
- `packages/web-client/src/utils/listColumnVisibility.ts`
- `packages/web-client/src/utils/listSorting.ts`
- `packages/web-client/src/utils/tagColors.ts`
- `packages/web-client/src/utils/collectionSearchKeyboard.ts`
- `packages/plugins/official/lists/web/styles.css`

Panel host services are injected via:

- `packages/web-client/src/utils/panelServices.ts`

## UI Composition Diagram

```
Lists panel (packages/plugins/official/lists/web/index.ts)
|
|-- CollectionPanelSearchController
|-- CollectionDropdownController
|-- CollectionBrowserController
|-- CollectionPanelBodyManager
`-- ListPanelController
    |-- ListPanelHeaderRenderer
    |-- ListPanelTableController
    |-- ListItemMenuController
    `-- ListItemEditorDialog
```

## Data and Event Flow

```
[User action] -> ListPanelController / Browser / Dropdown
    |
    | callOperation("list" | "get" | "items-list" | "update" ...)
    v
POST /api/plugins/lists/operations/<operationId>
    |
    | ListsStore (CRUD + normalize tags + list item ordering)
    v
sessionHub.broadcastToAll(panel_event: panel_update)
    |
    v
lists web panel handlePanelUpdate() -> update dropdown, browser, list detail
```

## Panel Updates

The server broadcasts panel updates to keep all lists panels in sync:

- `lists_show`: target a specific panel to open a list.
  - Payload: `{ type: "lists_show", listId: string, instance_id?: string }`
- `panel_update`
  - Payload includes:
    - `instance_id`
    - `listId`
    - `action`: `list_created` | `list_updated` | `list_deleted` | `item_added` | `item_updated` | `item_removed`
    - `list` (optional)
    - `item` (optional)
    - `itemId` (optional)
    - `refresh` (optional)

The lists panel uses these updates to refresh list metadata, invalidate previews, or
apply incremental item updates.

## Panel Context

When a list is active, the panel sets context with list metadata and selection:

```
{
  "type": "list",
  "id": "<list id>",
  "name": "<list name>",
  "instance_id": "<instance id>",
  "description": "<description>",
  "tags": ["..."],
  "selectedItemIds": ["..."],
  "selectedItems": [{"id": "...", "title": "..."}],
  "selectedItemCount": 0,
  "contextAttributes": {
    "instance-id": "<instance id>"
  }
}
```

## Sharing with Notes

Notes can reuse the same shared controllers by swapping list detail rendering with a
note detail/editor view:

- Keep:
  - `CollectionPanelSearchController`
  - `CollectionDropdownController`
  - `CollectionBrowserController`
  - `CollectionPanelBodyManager`
- Replace:
  - `ListPanelController` -> notes detail/editor renderer

Because the shared controllers communicate using `CollectionItemSummary` and
`CollectionReference`, any plugin that can provide item lists and previews can plug
into the same UI framework.
