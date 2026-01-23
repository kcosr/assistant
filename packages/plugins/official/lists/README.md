# Lists Plugin

List management with a dedicated lists panel, list item CRUD, tags, and browser previews.

## Table of Contents

- [Overview](#overview)
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
- Select and checkbox custom fields can be edited inline from list rows without opening the edit
  dialog (toggle in settings, default on).
- Browser mode supports arrow-key grid navigation with Enter to open a list; Escape returns to the
  browser view from list mode.
- Press **p** in browser mode to toggle pinned lists, or in list view to toggle pinned list items.
  Pinned entries show a pin icon and appear in the command palette via `/pinned`.
- Column headers stick while scrolling list items.
- Column widths can be resized per panel and persist for the panel session.
- Capacitor Android builds and narrow viewports show floating add/search buttons in list view; search opens the command palette.
- Custom fields can be reordered in the list metadata dialog.

All operations accept an optional `instance_id` (defaults to `default`), and `instance_list` reports
configured instances.

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
