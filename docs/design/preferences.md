# Preferences Architecture

This document describes how user preferences are stored and managed across the AI Assistant application.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Server-Side Preferences](#server-side-preferences)
- [Client-Side Preferences](#client-side-preferences)
- [Panel Layout State](#panel-layout-state)
- [Client-Side Preferences Client](#client-side-preferences-client)

## Overview

Preferences are stored in two locations:

1. **Server-side** (`/preferences` endpoint) - Persistent, synced across devices
2. **Client-side** (`localStorage`) - Device-local, ephemeral UI state

## Source files

- `packages/agent-server/src/preferences/preferencesStore.ts`
- `packages/agent-server/src/httpPreferences.ts`
- `packages/web-client/src/utils/listColumnPreferences.ts`

## Server-Side Preferences

Server preferences are stored in a JSON file and accessed via the `/preferences` HTTP endpoint.

### Endpoints

| Method  | Path           | Description                |
| ------- | -------------- | -------------------------- |
| `GET`   | `/preferences` | Retrieve all preferences   |
| `PATCH` | `/preferences` | Deep-merge partial updates |
| `PUT`   | `/preferences` | Replace all preferences    |

### Schema

```typescript
interface Preferences {
  // Global tag color assignments
  tagColors?: Record<string, string>;

  // Legacy per-list column preferences (still supported)
  listColumns?: Record<ListId, ListColumnPreferences>;

  // Per-list view preferences (new structure)
  listViewPrefs?: Record<ListId, ListViewPreferences>;

  // Global default settings
  globalDefaults?: GlobalDefaults;
}

interface ListColumnPreferences {
  [columnKey: string]: ListColumnConfig;
}

interface ListColumnConfig {
  width?: number; // Column width in pixels
  visibility?: ColumnVisibility;
}

type ColumnVisibility =
  | 'always-show' // Always display this column
  | 'show-with-data' // Show only if any row has data (default)
  | 'hide-in-compact'; // Hide in compact view, show in expanded

interface ListViewPreferences {
  columns?: ListColumnPreferences; // Column-specific settings
  sortState?: SortState; // Current sort configuration
  timelineField?: string | null; // Active timeline field key, or null if disabled
}

interface SortState {
  column: string; // Column key to sort by
  direction: 'asc' | 'desc';
}

interface GlobalDefaults {
  listCompactView?: boolean;
  defaultSort?: string;
  [key: string]: string | boolean | undefined;
}
```

### Deep Merge Behavior

`PATCH /preferences` performs a deep merge:

```javascript
// Existing state
{
  listViewPrefs: {
    "list-1": { sortState: { column: "title", direction: "asc" } }
  }
}

// PATCH payload
{
  listViewPrefs: {
    "list-1": { timelineField: "due-date" }
  }
}

// Result (merged, not replaced)
{
  listViewPrefs: {
    "list-1": {
      sortState: { column: "title", direction: "asc" },
      timelineField: "due-date"
    }
  }
}
```

### Validation

The server validates all incoming preferences using Zod schemas. Invalid payloads return `400 Bad Request`.

## Client-Side Preferences

### localStorage Keys

Legacy naming note: keys containing `artifact` are retained from the previous architecture and now
refer to artifacts UI state. They can be renamed in a later cleanup once migration support is
defined.

| Key                              | Description                         | Structure                                 |
| -------------------------------- | ----------------------------------- | ----------------------------------------- |
| `aiAssistantPanelLayout`         | Panel layout state (new)            | `LayoutPersistence`                       |
| `aiAssistantPanelLayoutVersion`  | Layout schema version (new)         | `number`                                  |
| `aiAssistantTheme`               | Theme id (auto/light/dark/preset)   | `string`                                  |
| `aiAssistantUIFont`              | UI font stack                       | `string`                                  |
| `aiAssistantCodeFont`            | Code/terminal font stack            | `string`                                  |
| `aiAssistantArtifactSearchState` | Artifacts search state (legacy key) | `{ query: string, filters: TagFilter[] }` |
| `aiAssistantSidebarViewMode`     | Sidebar view mode (legacy)          | `'sessions' \| 'artifacts'`               |
| `artifactBrowserViewMode`        | Artifacts browser mode (legacy)     | `'list' \| 'grid'`                        |
| `artifactBrowserSortMode`        | Artifacts sort mode (legacy)        | `'alpha' \| 'updated'`                    |
| `sidebarVisible`                 | Sidebar visibility (legacy)         | `'true' \| 'false'`                       |
| `chatVisible`                    | Chat visibility (legacy)            | `'true' \| 'false'`                       |
| `inputBarVisible`                | Input bar visibility (legacy)       | `'true' \| 'false'`                       |
| `layoutMode`                     | Desktop layout mode (legacy)        | `'default' \| 'wide'`                     |
| `paneOrder`                      | Pane arrangement (legacy)           | `'chat-first' \| 'artifact-first'`        |
| `mobileShowBoth`                 | Mobile dual-pane mode (legacy)      | `'true' \| 'false'`                       |
| `sidebarWidth`                   | Sidebar width (legacy)              | `'<number>px'`                            |
| `aiAssistantArtifactPanelOpen`   | Artifacts panel open (legacy)       | `'true' \| 'false'`                       |

### Search State Structure

```typescript
interface ArtifactsSearchState {
  query: string; // Text search query
  filters: TagFilter[]; // Active tag filters in order
}

interface TagFilter {
  mode: 'include' | 'exclude';
  tag: string;
}
```

**Note:** The artifacts search state is **global**, not per-list. The same search/filter state persists when switching between different lists/notes.

## Panel Layout State

The layout engine persists a `LayoutPersistence` payload (see `docs/design/panel-plugins.md`):

```typescript
interface LayoutPersistence {
  layout: LayoutNode;
  panels: Record<string, PanelInstance>;
}
```

The client stores the serialized `LayoutPersistence` object in `aiAssistantPanelLayout` along with the `aiAssistantPanelLayoutVersion` schema version. Legacy layout keys are migrated into this structure during the refactor.

## Client-Side Preferences Client

The `ListColumnPreferencesClient` class manages server preferences with optimistic updates.

### Behavior

1. **Load on startup**: `load()` fetches current preferences from server
2. **Optimistic updates**: Changes are applied locally immediately
3. **Async persistence**: Changes are PATCHed to server in background
4. **Failure tolerance**: If PATCH fails, local state remains (no rollback)

### Example Flow

```typescript
// 1. User changes sort order
client.updateSortState('list-123', { column: 'title', direction: 'desc' });

// 2. Local state updated immediately (UI reflects change)
// 3. PATCH request sent to server (async, fire-and-forget)
// 4. If PATCH fails, local state persists until next load()
```

### API

```typescript
class ListColumnPreferencesClient {
  // Load all preferences from server
  async load(): Promise<void>;

  // Column preferences
  getListPreferences(listId: string): ListColumnPreferences | null;
  getColumnConfig(listId: string, columnKey: string): ListColumnConfig | null;
  async updateColumn(
    listId: string,
    columnKey: string,
    patch: Partial<ListColumnConfig>,
  ): Promise<void>;

  // Sort state
  getSortState(listId: string): SortState | null;
  async updateSortState(listId: string, sortState: SortState | null): Promise<void>;

  // Timeline field
  getTimelineField(listId: string): string | null;
  async updateTimelineField(listId: string, timelineField: string | null): Promise<void>;
}
```

## What Is Stored Where

### Per-List Settings (Server)

| Setting           | Storage Location                            | Persists Across Devices |
| ----------------- | ------------------------------------------- | ----------------------- |
| Column widths     | `listColumns[listId][columnKey].width`      | ✅ Yes                  |
| Column visibility | `listColumns[listId][columnKey].visibility` | ✅ Yes                  |
| Sort state        | `listViewPrefs[listId].sortState`           | ✅ Yes                  |
| Timeline field    | `listViewPrefs[listId].timelineField`       | ✅ Yes                  |

### Global Settings (Server)

| Setting    | Storage Location     | Persists Across Devices |
| ---------- | -------------------- | ----------------------- |
| Tag colors | `tagColors[tagName]` | ✅ Yes                  |

### UI State (Client localStorage)

| Setting            | Storage Location                         | Persists Across Devices |
| ------------------ | ---------------------------------------- | ----------------------- |
| Layout state       | `aiAssistantPanelLayout`                 | ❌ No                   |
| Theme              | `aiAssistantTheme`                       | ❌ No                   |
| UI font            | `aiAssistantUIFont`                      | ❌ No                   |
| Code/terminal font | `aiAssistantCodeFont`                    | ❌ No                   |
| Search query       | `aiAssistantArtifactSearchState.query`   | ❌ No (legacy)          |
| Tag filters        | `aiAssistantArtifactSearchState.filters` | ❌ No (legacy)          |
| Sidebar visibility | `sidebarVisible`                         | ❌ No                   |
| Legacy layout      | `layoutMode`, `paneOrder`                | ❌ No (legacy)          |

### Not Persisted

| Setting                      | Notes                          |
| ---------------------------- | ------------------------------ |
| Compact/expanded view toggle | Resets to compact on page load |
| Scroll position              | Ephemeral                      |
| Dialog state                 | Ephemeral                      |

## Migration Notes

### listColumns → listViewPrefs

The `listColumns` structure stores only column-specific settings. The newer `listViewPrefs` structure can store columns plus list-level settings like sort and timeline.

Both structures are supported:

- `listColumns` is checked for backward compatibility
- `listViewPrefs.columns` takes precedence if present
- New writes go to the appropriate structure based on what's being updated

### Legacy Layout → Panel Layout

The new panel layout system persists its own layout tree. During migration:

- Legacy layout keys (`layoutMode`, `paneOrder`, `chatVisible`, `aiAssistantArtifactPanelOpen`, etc.) are mapped into a `LayoutPersistence` payload.
- The migrated payload is stored in `aiAssistantPanelLayout` with a version in `aiAssistantPanelLayoutVersion`.
- After migration, legacy keys are considered deprecated and should no longer be updated.

See `docs/design/panel-plugins.md` for the mapping table.

## Error Handling

### Server Errors

- **Network failures**: Local state preserved, changes lost on next `load()`
- **Validation errors (400)**: Request rejected, local state may be inconsistent
- **Server errors (500)**: Same as network failures

### localStorage Errors

- **QuotaExceeded**: Silently ignored, state not persisted
- **SecurityError**: Silently ignored (e.g., private browsing)
