# Persistent List Views

> **Status: Planned** — This feature is not yet implemented.

## Overview

Add persistent, named views for list data. A view stores a reusable query and can be selected by
the user or managed by an agent. Views should remain independent of workspace layout and panel
placement.

## Source files

Planned feature. Reference patterns:

- `packages/plugins/official/lists/server/index.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/notes/server/index.ts`
- `packages/plugins/official/notes/web/index.ts`

## Current state

- List filtering is currently represented by the active panel state.
- No persisted view storage or view-management operations are defined.
- This design does not change the existing list or note operation contracts.

## Goals

1. Persist named views across server restarts.
2. Allow users to switch between saved views.
3. Allow agents to create, update, list, and delete views through explicit operations.
4. Keep temporary filtering separate from saved view definitions.
5. Keep view state scoped to the list data it queries rather than to workspace layout.

## Non-goals

- Sharing views between users.
- View folders or categories.
- Replacing the existing list search and filter controls.
- Adding a second layout or panel persistence system.

## Data model

```typescript
interface SavedListView {
  id: string;
  name: string;
  query: ListViewQuery;
  createdAt: string;
  updatedAt: string;
}
```

`ListViewQuery` should contain only serializable list filters, such as tags, text, sort order,
and timeline fields. It must not contain panel ids, pane ids, session ids, or transient selection.

## Server design

The lists plugin should own view storage and operations. The eventual operation contract should
include:

- create a named view;
- update a view by id;
- list views for the current list scope;
- load a view's query without mutating unrelated panel state;
- delete a view by id.

Storage should use the plugin's existing data directory and include a schema version. Writes should
be atomic, and a malformed saved view should be skipped with a diagnostic rather than preventing
the lists plugin from starting.

## Client design

The list panel may offer a view selector near its existing filter controls. Loading a view replaces
the current list query and refreshes the visible items. Temporary search text, sort changes, and
selection should remain local to the current panel instance unless the user explicitly saves them.

The selector should support:

- loading a saved view;
- creating a view from the current query;
- renaming a view;
- deleting a view with confirmation;
- returning to an unsaved custom query.

## Agent and CLI design

Agent operations and the generated plugin CLI should call the same server operation handlers. CLI
commands should accept a list scope, view id or name, and a JSON query where appropriate. The CLI
must not reach into the lists database directly.

## Events

The lists plugin should emit panel-scoped events when a view is created, updated, loaded, or
deleted. Events should contain the view id and list scope, not the full list result set. Clients
refresh their own data after receiving an event.

## Testing

- Store round trips for create, update, list, load, and delete.
- Validation rejects malformed queries and missing names.
- Restart preserves saved views.
- A missing or malformed view does not prevent plugin startup.
- Client selector loads and deletes views without changing unrelated panel instances.
- Agent and CLI operations use the same validation and storage path.

## Open questions

1. Should a view be scoped to one list or support a multi-list query?
2. Should saved views include a default sort and timeline field?
3. Should loading a view update the URL or only panel-local state?
