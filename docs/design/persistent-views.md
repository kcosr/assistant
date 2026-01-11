# Persistent Multiple Views

> **Status: Planned** — This feature is not yet implemented.

> Note: This document assumes the artifacts panel plugin; views are owned by the artifacts plugin in the panel architecture.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Current State](#current-state)
- [Goals](#goals)
- [Non-Goals (for initial implementation)](#non-goals-for-initial-implementation)
- [Data Model](#data-model)
- [Server Changes](#server-changes)
- [CLI Changes](#cli-changes)
- [Web Client Changes](#web-client-changes)
- [WebSocket Messages](#websocket-messages)
- [Migration](#migration)
- [Implementation Order](#implementation-order)
- [Testing](#testing)
- [Open Questions](#open-questions)
- [Resolved Decisions](#resolved-decisions)

## Overview

Add support for persistent, named views that can be created by agents and selected by users from a dropdown in the artifacts panel. Views are cross-list filtered item collections that persist across server restarts.

## Source files

Planned feature. Reference patterns:

- `packages/plugins/official/lists/server/index.ts`
- `packages/plugins/official/notes/server/index.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/notes/web/index.ts`

## Current State

- Single ephemeral view stored in `InMemoryArtifactsPanelStateStore`
- View has a `query` (ViewQuery) and optional `name`
- Views are lost on server restart
- No way to switch between multiple saved views
- Search/tag filters in view mode currently affect the view query directly

## Goals

1. **Persistent view storage**: Views survive server restarts
2. **Multiple named views**: Users can switch between saved views
3. **Agent management**: Agents can create, update, and delete views via tools
4. **CLI support**: `artifacts-cli` commands for view CRUD
5. **View selector UI**: Dropdown to pick from saved views (similar to artifact item selector)
6. **Local filtering**: Search/tag filters in view mode filter locally, not modifying the saved view query
7. **Delete capability**: Users can delete views via UI

## Non-Goals (for initial implementation)

- User-created views via UI (agents create views for now)
- View sharing/permissions
- View folders/categories

## Data Model

### SavedView

```typescript
interface SavedView {
  id: string; // Unique identifier (UUID)
  name: string | null; // null = "Custom" slot (single, gets overwritten)
  query: ViewQuery; // The view query definition
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
```

**Naming rules:**

- `name: null` → displayed as "Custom" in UI, single slot that gets overwritten
- `name: string` → named view, unique, persists until explicitly deleted
- Renaming a Custom view (null → string) promotes it to a permanent named view

### ViewsStore

Similar to `ListsStore` and `NotesStore`, persists views to JSON file.

```typescript
class ViewsStore {
  constructor(filePath: string);

  // CRUD operations
  async create(params: { name: string; query: ViewQuery }): Promise<SavedView>;
  async get(id: string): Promise<SavedView | undefined>;
  async getByName(name: string): Promise<SavedView | undefined>;
  async list(): Promise<SavedView[]>;
  async update(id: string, params: { name?: string; query?: ViewQuery }): Promise<SavedView>;
  async delete(id: string): Promise<void>;
  async deleteByName(name: string): Promise<void>;
}
```

Storage location: `${dataDir}/views/views.json`

## Server Changes

### Artifacts Plugin (Views)

Views are owned by the artifacts plugin rather than a standalone views plugin. The shared
`ViewsStore` lives under `packages/agent-server/src/views/` and is accessed by the artifacts
plugin tools/routes.

### HTTP Routes

| Method | Path                                    | Description                    |
| ------ | --------------------------------------- | ------------------------------ |
| GET    | `/api/plugins/artifacts/views`          | List all saved views           |
| GET    | `/api/plugins/artifacts/views/:id`      | Get view by ID                 |
| POST   | `/api/plugins/artifacts/views`          | Create new view                |
| PATCH  | `/api/plugins/artifacts/views/:id`      | Update view                    |
| DELETE | `/api/plugins/artifacts/views/:id`      | Delete view                    |
| POST   | `/api/plugins/artifacts/views/:id/load` | Load view into artifacts panel |

The active view endpoints live at `/api/plugins/artifacts/view` with saved views under `/api/plugins/artifacts/views`.

### Artifacts Plugin Tools

View tools are exposed by the artifacts plugin (for example, in
`packages/agent-server/src/plugins/artifacts/viewTools.ts`):

1. **`view_create`** - Create a new saved view
   - Parameters: `name` (string, optional), `query` (ViewQuery, required)
   - If `name` omitted: creates/overwrites the "Custom" slot
   - If `name` provided: fails if a view with that name already exists
   - Returns: Created view with id

2. **`view_update`** - Update an existing view
   - Parameters: `id` or `name` (one required), `newName?`, `query?`
   - Can rename a view (including promoting "Custom" to a named view)
   - Returns: Updated view

3. **`view_delete`** - Delete a saved view
   - Parameters: `id` or `name` (one required)
   - Use `name: "Custom"` to delete the unnamed slot
   - Returns: `{ ok: true }`

4. **`view_list`** - List all saved views
   - Parameters: none
   - Returns: Array of view summaries (Custom view shows `name: null`)

5. **`view_load`** - Load a saved view into the artifacts panel
   - Parameters: `id` or `name` (one required)
   - Use `name: "Custom"` to load the unnamed slot
   - Returns: View details and sets artifacts panel to view mode

Existing `view_set` continues to work for ephemeral/ad-hoc views (not persisted).

### Artifacts Panel State

Modify `ArtifactsPanelState.view` to optionally reference a saved view:

```typescript
interface ViewState {
  query: ViewQuery;
  name?: string;
  savedViewId?: string; // NEW: Reference to persisted view
}
```

When `savedViewId` is present, the view was loaded from storage. Local search/tag filtering creates a transient modified query without updating the saved view.

## CLI Changes

New `artifacts-cli view` command group:

```bash
# List all saved views
artifacts-cli view ls

# Show view details
artifacts-cli view show --id <id>
artifacts-cli view show --name "View Name"
artifacts-cli view show --name Custom          # Show the unnamed slot

# Create view (agents typically do this, but CLI can too)
artifacts-cli view create --query '{"tags":{"include":["urgent"]}}'
# → Creates/overwrites "Custom" slot

artifacts-cli view create --name "Urgent Items" --query '{"tags":{"include":["urgent"]}}'
# → Creates named view (fails if name exists)

# Update view
artifacts-cli view update --id <id> --name "New Name"
artifacts-cli view update --name "Old Name" --query '{"tags":{"include":["priority"]}}'
artifacts-cli view update --name Custom --name "Promoted View"
# → Renames Custom to a permanent named view

# Delete view
artifacts-cli view delete --id <id>
artifacts-cli view delete --name "View Name"
artifacts-cli view delete --name Custom        # Delete the unnamed slot

# Load view into artifacts panel
artifacts-cli view load --id <id>
artifacts-cli view load --name "View Name"
artifacts-cli view load --name Custom          # Load the unnamed slot
```

## Web Client Changes

### View Mode Controller

Modify `ViewModeController` to:

1. Support local filtering that doesn't modify the saved view
2. Track whether current view is saved or ephemeral
3. Handle view deletion

### View Selector Dropdown

Create a new dropdown component (similar to artifacts dropdown) for view selection:

```
packages/web-client/src/controllers/
  viewSelectorDropdown.ts      - Dropdown controller
  viewSelectorListRenderer.ts  - List rendering
```

Location: In the artifacts panel header, replacing/augmenting the current view tab area or shown when the View tab is selected.

UI behavior:

- Show dropdown with list of saved views
- Search/filter views by name
- Click to load view
- Empty state: "No saved views. Ask an agent to create one."

### View Header with Edit/Delete

When in view mode with a saved view loaded:

- Show view name prominently (or "Custom" for unnamed)
- Add rename button (pencil icon) - opens inline edit or dialog
- Add delete button (trash icon) - confirm before deleting

**Rename flow:**

1. User clicks pencil icon next to view name
2. Name becomes editable (inline or dialog)
3. User enters new name and confirms
4. Calls `view_update --id <id> --name "New Name"`
5. If renaming "Custom", it becomes a permanent named view

### Local Filtering

When the user types in the search box or applies tag filters while viewing a saved view:

- Apply filters locally to the loaded items
- Do NOT modify the saved view's query
- Show indicator that local filters are active
- "Clear filters" resets to the saved view's original results

This differs from the current behavior where search modifies the view query.

## WebSocket Messages

Add new message type for view list updates:

```typescript
interface ServerViewsUpdatedMessage {
  type: 'views_updated';
  views: SavedView[]; // Full list of views
}
```

Broadcast when views are created/updated/deleted.

## Migration

No migration needed - this is purely additive. Existing ephemeral views continue to work.

## Implementation Order

1. **Phase 1: Backend Storage**
   - Create `ViewsStore` class
   - Create views plugin
   - Add HTTP routes

2. **Phase 2: Agent Tools**
   - Add `view_create`, `view_update`, `view_delete`, `view_list`, `view_load` tools
   - Update `view_set` to optionally save

3. **Phase 3: CLI**
   - Add `artifacts-cli view` command group

4. **Phase 4: Web Client**
   - Add view selector dropdown
   - Modify view mode for local filtering
   - Add delete button

## Testing

- Unit tests for `ViewsStore`
- Integration tests for HTTP routes
- Tool handler tests
- CLI command tests
- E2E tests for view selection UI

## Open Questions

1. **View limits**: Should we limit number of saved views?
   - Proposal: No limit initially, add if needed

2. **View ordering**: How to order views in the dropdown?
   - Proposal: "Custom" first (if exists), then alphabetical by name

## Resolved Decisions

1. **View naming**: Required for `view_create` (saved views). Optional for `view_set` (ephemeral views displayed as "Custom").

2. **Name conflicts**: `view_create` with existing name fails. Use `view_update` to rename.

3. **UI Save button**: Prompts user for a name before saving.

4. **Search behavior in view mode**: Local filtering only, doesn't modify saved view query. Tag filtering also local (disconnected from saved view).

5. **Date macros**: View queries support dynamic date macros that resolve at query time for date/datetime fields:
   - `today`, `yesterday`, `tomorrow` - relative to current date
   - `+Nd`, `-Nd` - N days from today (e.g., `+7d`, `-3d`)
   - `now` - current datetime (datetime fields) or today's date (date fields)
   - `dow`, `dow+N`, `dow-N` - day-of-week names (e.g., "Sunday") for string fields (including in `values` arrays)

   Example: `{ "field": "due", "op": "between", "values": ["today", "+7d"] }` always shows items due in the next 7 days.
