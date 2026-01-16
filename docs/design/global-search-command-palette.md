# Global Search & Command Palette Design

## Status

**Draft** - January 2026

## Table of Contents

1. [Summary](#summary)
2. [Background](#background)
3. [Goals](#goals)
4. [UX Design](#ux-design)
   - [Opening the Palette](#opening-the-palette)
   - [Input Modes](#input-modes)
   - [Staged Input Flow](#staged-input-flow)
   - [Search Results](#search-results)
   - [Launch Actions Menu](#launch-actions-menu)
5. [Query Syntax](#query-syntax)
6. [Backend Architecture](#backend-architecture)
   - [SearchProvider Interface](#searchprovider-interface)
   - [Search API Endpoint](#search-api-endpoint)
   - [Response Format](#response-format)
7. [Frontend Architecture](#frontend-architecture)
   - [Command Palette Component](#command-palette-component)
   - [State Machine](#state-machine)
   - [Keyboard Navigation](#keyboard-navigation)
8. [Plugin Integration](#plugin-integration)
   - [Notes Plugin](#notes-plugin)
   - [Lists Plugin](#lists-plugin)
9. [Future Considerations](#future-considerations)

---

## Summary

A global search and command palette that allows users to quickly find content across all plugins (notes, lists, etc.) and navigate to results. The palette supports:

- **Plain text search**: Instant global search across everything
- **Scoped search**: `/search notes work meeting` for targeted queries
- **Staged input**: Guided flow with `<placeholder>` prompts and Enter-to-skip
- **Flexible launch**: Open in workspace (default), open modal, or replace selected panel

---

## Background

### Problem

Users accumulate content across multiple plugins (notes, lists) and instances (work, personal). Finding specific items requires:

1. Opening the correct panel
2. Switching to the correct instance
3. Using that panel's search/filter UI

This is slow and requires knowing where content lives.

### Solution

A unified command palette (Cmd+K / Ctrl+K) that:

- Searches across all plugins and instances simultaneously
- Provides scoped search when users know where to look
- Offers flexible options for how/where to open results

---

## Goals

1. **Fast global search**: Plain text query searches everything instantly
2. **Scoped search**: `/search notes work meeting` for power users
3. **Discoverable**: Staged input with placeholders guides users
4. **Flexible launch**: Multiple options for where to open results
5. **Keyboard-first**: Full keyboard navigation, mouse optional
6. **Extensible**: Plugins opt-in via SearchProvider interface

---

## UX Design

### Opening the Palette

| Trigger | Action |
|---------|--------|
| `Cmd+K` / `Ctrl+K` | Open command palette |
| Click search icon | Open command palette |
| `Escape` | Close palette |

### Input Modes

The palette supports two input modes:

#### Plain Text Mode (Global Search)

Typing without `/` prefix triggers instant global search:

```
┌─────────────────────────────────────────────┐
│ meeting|                                    │
├─────────────────────────────────────────────┤
│ ▶ 📝 Meeting notes Q4 — notes:work          │
│   📋 Team meeting agenda — lists:work       │
│   📝 1:1 Meeting template — notes:default   │
└─────────────────────────────────────────────┘
```

#### Command Mode (Scoped Search)

Typing `/` enters command mode with staged input:

```
┌─────────────────────────────────────────────┐
│ /|                                          │
├─────────────────────────────────────────────┤
│ ▶ search — Search notes, lists, ...         │
└─────────────────────────────────────────────┘
```

For v1, `/search` is the only supported command. Additional commands remain future work.

### Staged Input Flow

The `/search` command uses staged input with placeholders. Each stage can be skipped with Enter (defaults to "all").

#### Stage 1: Command Selection

```
┌─────────────────────────────────────────────┐
│ /search|                                    │
├─────────────────────────────────────────────┤
│ ▶ search — Search notes, lists, ...         │
└─────────────────────────────────────────────┘
```

User types `/search` or selects from list.

#### Stage 2: Scope Selection

```
┌─────────────────────────────────────────────┐
│ /search <scope>|                            │
├─────────────────────────────────────────────┤
│ ▶ (all) — Search everything                 │
│   notes — Search notes                      │
│   lists — Search lists                      │
└─────────────────────────────────────────────┘
```

- **Enter**: Skip (search all scopes) → go to query stage
- **Type/Select**: Choose scope → go to instance stage

#### Stage 3: Instance Selection

Only shown if a specific scope was selected:

```
┌─────────────────────────────────────────────┐
│ /search notes <instance>|                   │
├─────────────────────────────────────────────┤
│ ▶ (all) — All instances                     │
│   default                                   │
│   work                                      │
│   personal                                  │
└─────────────────────────────────────────────┘
```

- **Enter**: Skip (search all instances) → go to query stage
- **Type/Select**: Choose instance → go to query stage

#### Stage 4: Query Input

```
┌─────────────────────────────────────────────┐
│ /search notes work <query>|                 │
├─────────────────────────────────────────────┤
│ Type to search work notes...                │
└─────────────────────────────────────────────┘
```

User types search query, results appear as they type.

#### Stage 5: Results

```
┌─────────────────────────────────────────────┐
│ /search notes work meeting|                 │
├─────────────────────────────────────────────┤
│ ▶ 📝 Meeting notes Q4                       │
│   📝 Weekly meeting agenda                  │
│   📝 Meeting template                       │
└─────────────────────────────────────────────┘
```

### Visual Placeholder Treatment

Placeholders are visually distinct from user input:

```
/search notes <instance>
              └─────────── dimmed, italic style

/search notes work <query>
                   └────── dimmed placeholder

/search notes work meeting
                   └────── normal text (user input)
```

CSS styling:
```css
.command-palette-placeholder {
  color: var(--text-muted);
  font-style: italic;
  opacity: 0.6;
}
```

### Search Results

Each result displays:

```
┌─────────────────────────────────────────────┐
│ 📝 Meeting notes Q4 — notes:work            │
│ │  └─ title          └─ plugin:instance     │
│ └─ icon (from plugin)                       │
├─────────────────────────────────────────────┤
│ ...discussed quarterly goals and...         │
│ └─ snippet (optional, from search match)    │
└─────────────────────────────────────────────┘
```

Result row structure:
- **Icon**: Plugin-specific (📝 for notes, 📋 for lists)
- **Title**: Item title/name
- **Location**: `plugin:instance` label
- **Snippet**: Optional matched text preview

### Launch Actions Menu

When user presses **Right Arrow** on a result, show action menu:

Default launch behavior:
- **Enter**: Open in workspace (new panel docked to the right)
- **Shift+Enter**: Replace selected panel (if one is selected). If no panel is selected, do nothing and keep the palette open.

#### With Panel Selected

```
┌─────────────────────────────────────────────┐
│ /search notes work meeting                  │
├─────────────────────────────────────────────┤
│   📝 Meeting notes Q4 — notes:work          │
│   ┌─────────────────────┐                   │
│   │ ▶ Replace           │                   │
│   │   Open workspace    │                   │
│   │   Open modal        │                   │
│   └─────────────────────┘                   │
└─────────────────────────────────────────────┘
```

#### Without Panel Selected

```
┌─────────────────────────────────────────────┐
│ /search notes work meeting                  │
├─────────────────────────────────────────────┤
│   📝 Meeting notes Q4 — notes:work          │
│   ┌─────────────────────┐                   │
│   │   Replace           │ ← greyed          │
│   │ ▶ Open workspace    │                   │
│   │   Open modal        │                   │
│   └─────────────────────┘                   │
└─────────────────────────────────────────────┘
```

#### Action Definitions

| Action | Behavior | Requires Selection |
|--------|----------|-------------------|
| **Replace** | Replace selected panel with new panel showing result | Yes |
| **Open workspace** | Add new panel docked to right of workspace | No |
| **Open modal** | Open result in a modal panel overlay | No |

---

## Query Syntax

### Grammar

```
input        = plain_query | command
plain_query  = <any text not starting with />
command      = "/" command_name args*

# Search command
/search [scope] [instance] query

scope        = "notes" | "lists" | ... (plugin IDs)
instance     = plugin instance ID (e.g., "work", "default")
query        = free-form search text
```

### Examples

| Input | Interpretation |
|-------|----------------|
| `meeting` | Global search for "meeting" |
| `/search` | Enter scoped search flow |
| `/search notes meeting` | Search all notes instances for "meeting" |
| `/search notes work meeting` | Search notes:work for "meeting" |
| `/search lists reading book` | Search lists:reading for "book" |

### Fast Path

Users can type the full command without pausing at stages:

```
/search notes work meeting
        │     │    └─ query
        │     └─ instance (exact match)
        └─ scope (exact match)
```

The parser greedily matches tokens:
1. After `/search`, next token matched against scope names
2. If scope matched, next token matched against that scope's instances
3. Remaining tokens are the query

If a token doesn't match (e.g., typo), the staged UI shows filtered options.

---

## Backend Architecture

### SearchProvider Interface

Plugins implement this interface to participate in global search:

```typescript
// packages/agent-server/src/plugins/types.ts

interface SearchProvider {
  /**
   * Search this plugin's content.
   * Called by the global search service.
   */
  search(query: string, options: SearchOptions): Promise<SearchResult[]>;
}

interface SearchOptions {
  /** Limit to specific instance, or undefined for all */
  instanceId?: string;
  /** Maximum results to return */
  limit?: number;
}

interface SearchResult {
  /** Unique identifier for this result */
  id: string;
  /** Display title */
  title: string;
  /** Optional subtitle (e.g., tags, parent list name) */
  subtitle?: string;
  /** Optional text snippet showing match context */
  snippet?: string;
  /** Relevance score (higher = more relevant) */
  score?: number;
  /** How to launch this result */
  launch: SearchResultLaunch;
}

interface SearchResultLaunch {
  /** Panel type to open */
  panelType: string;
  /** Event payload */
  payload: Record<string, unknown>;
}
```

### Search API Endpoint

```
GET /api/search
```

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | string | Yes | Search query |
| `scope` | string | No | Plugin ID to search (omit for all) |
| `instance` | string | No | Instance ID (omit for all instances) |
| `limit` | number | No | Max results per plugin (default: 10) |

#### Example Requests

```bash
# Global search
GET /api/search?q=meeting

# Scoped to notes plugin
GET /api/search?q=meeting&scope=notes

# Scoped to notes:work instance
GET /api/search?q=meeting&scope=notes&instance=work
```

### Response Format

```typescript
interface SearchApiResponse {
  results: SearchApiResult[];
  timing?: {
    totalMs: number;
    byPlugin?: Record<string, number>;
  };
}

interface SearchApiResult {
  /** Plugin that returned this result */
  pluginId: string;
  /** Instance within the plugin */
  instanceId: string;
  /** Result ID (unique within plugin+instance) */
  id: string;
  /** Display title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Optional match snippet */
  snippet?: string;
  /** Relevance score */
  score?: number;
  /** Launch configuration */
  launch: {
    panelType: string;
    payload: Record<string, unknown>;
  };
}
```

#### Example Response

```json
{
  "results": [
    {
      "pluginId": "notes",
      "instanceId": "work",
      "id": "meeting-notes-q4",
      "title": "Meeting notes Q4",
      "subtitle": "meetings, quarterly",
      "snippet": "...discussed quarterly goals and...",
      "score": 0.95,
      "launch": {
        "panelType": "notes",
        "payload": {
          "type": "notes_show",
          "instance_id": "work",
          "title": "Meeting notes Q4"
        }
      }
    },
    {
      "pluginId": "lists",
      "instanceId": "work",
      "id": "item-abc123",
      "title": "Team meeting agenda",
      "subtitle": "tasks list",
      "score": 0.82,
      "launch": {
        "panelType": "lists",
        "payload": {
          "type": "lists_show",
          "instance_id": "work",
          "listId": "tasks",
          "itemId": "abc123"
        }
      }
    }
  ],
  "timing": {
    "totalMs": 45,
    "byPlugin": {
      "notes": 23,
      "lists": 38
    }
  }
}
```

### Server Implementation

```typescript
// packages/agent-server/src/search/searchService.ts

interface SearchService {
  /**
   * Register a plugin's search provider
   */
  registerProvider(pluginId: string, provider: SearchProvider): void;

  /**
   * Execute a search across registered providers
   */
  search(options: GlobalSearchOptions): Promise<SearchApiResponse>;

  /**
   * Get list of searchable scopes (plugins with search providers)
   */
  getSearchableScopes(): SearchableScope[];
}

interface GlobalSearchOptions {
  query: string;
  scope?: string;      // plugin ID
  instance?: string;   // instance ID
  limit?: number;
}

interface SearchableScope {
  pluginId: string;
  label: string;
  instances: Array<{ id: string; label: string }>;
}
```

#### Search Execution Flow

```
1. Client calls GET /api/search?q=meeting&scope=notes

2. Server resolves which providers to query:
   - If scope specified: just that plugin
   - If no scope: all registered providers

3. Server calls provider.search() in parallel for each plugin

4. Server aggregates results:
   - Adds pluginId/instanceId to each result
   - Sorts by score (descending)
   - Applies per-plugin limit (no global cap by default)

5. Server returns aggregated response
```

---

## Frontend Architecture

### Command Palette Component

```typescript
// packages/web-client/src/controllers/commandPaletteController.ts

interface CommandPaletteController {
  /** Open the palette */
  open(): void;

  /** Close the palette */
  close(): void;

  /** Check if palette is open */
  isOpen(): boolean;

  /** Set the selected panel ID (for launch actions) */
  setSelectedPanelId(panelId: string | null): void;
}

interface CommandPaletteOptions {
  /** Container element for the palette */
  container: HTMLElement;

  /** Callback when a result is launched */
  onLaunch: (result: SearchApiResult, action: LaunchAction) => void;

  /** Get available scopes from server */
  fetchScopes: () => Promise<SearchableScope[]>;

  /** Execute search */
  fetchResults: (options: GlobalSearchOptions) => Promise<SearchApiResponse>;

  /** Get currently selected panel ID */
  getSelectedPanelId: () => string | null;
}

type LaunchAction =
  | { type: 'replace' }
  | { type: 'workspace' }
  | { type: 'modal' };
```

### State Machine

The palette operates as a state machine:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌──────────┐   type /   ┌──────────┐   Enter/   ┌──────────┐  │
│  │          │ ─────────▶ │          │  select    │          │  │
│  │  IDLE    │            │ COMMAND  │ ─────────▶ │  SCOPE   │  │
│  │          │ ◀───────── │          │            │          │  │
│  └──────────┘   Escape   └──────────┘            └──────────┘  │
│       │                                               │        │
│       │ type text                              Enter/ │        │
│       ▼                                       select  │        │
│  ┌──────────┐                                        ▼        │
│  │  GLOBAL  │                               ┌──────────┐      │
│  │  SEARCH  │                               │ INSTANCE │      │
│  │          │                               │          │      │
│  └──────────┘                               └──────────┘      │
│       │                                           │            │
│       │ Right arrow                        Enter/ │            │
│       ▼                                   select  │            │
│  ┌──────────┐                                    ▼            │
│  │  ACTION  │                             ┌──────────┐        │
│  │  MENU    │ ◀────────────────────────── │  QUERY   │        │
│  │          │       Right arrow on result │          │        │
│  └──────────┘                             └──────────┘        │
│       │                                                        │
│       │ select action                                          │
│       ▼                                                        │
│  ┌──────────┐                                                  │
│  │ EXECUTE  │ ─────────────────────────────────────────────▶ X │
│  └──────────┘                     close palette                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### States

| State | Description | Input Shows |
|-------|-------------|-------------|
| `IDLE` | Palette open, no input | Empty with hint |
| `GLOBAL_SEARCH` | Plain text entered | Query + results |
| `COMMAND` | `/` entered, selecting command | Command list |
| `SCOPE` | Command selected, selecting scope | `<scope>` placeholder + scope list |
| `INSTANCE` | Scope selected, selecting instance | `<instance>` placeholder + instance list |
| `QUERY` | Instance selected, entering query | `<query>` placeholder + results |
| `ACTION_MENU` | Result selected, choosing action | Action menu |
| `EXECUTE` | Action chosen, launching | — (closes) |

### Keyboard Navigation

| Key | IDLE | GLOBAL_SEARCH | SCOPE/INSTANCE | QUERY | ACTION_MENU |
|-----|------|---------------|----------------|-------|-------------|
| `↑` | — | Select prev result | Select prev option | Select prev result | Select prev action |
| `↓` | — | Select next result | Select next option | Select next result | Select next action |
| `Enter` | — | Open workspace (default) | Confirm selection | Open workspace (default) | Execute action |
| `→` | — | Open action menu | — | Open action menu | — |
| `←` | — | — | — | — | — |
| `Escape` | Close | Close | Go back / Close | Go back | Go back |
| `Backspace` | — | Delete char | Delete / Go back | Delete / Go back | Go back |
| Type | Start search | Update query | Filter options | Update query | — |

Shift+Enter:
- Replace selected panel if one is selected
- If no panel is selected, do nothing and keep the palette open

#### Backspace Behavior at Stage Boundaries

When backspace is pressed with cursor at the start of current stage input:

- **SCOPE stage** with empty input → Go back to COMMAND
- **INSTANCE stage** with empty input → Go back to SCOPE
- **QUERY stage** with empty input → Go back to INSTANCE

### Debouncing

Search requests are debounced to avoid excessive API calls:

```typescript
const SEARCH_DEBOUNCE_MS = 150;

// Debounce search as user types
const debouncedSearch = debounce(async (query: string) => {
  const results = await fetchResults({ query, scope, instance });
  renderResults(results);
}, SEARCH_DEBOUNCE_MS);
```

---

## Plugin Integration

### Notes Plugin

#### SearchProvider Implementation

```typescript
// packages/plugins/official/notes/server/index.ts

const searchProvider: SearchProvider = {
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const { instanceId, limit = 10 } = options;
    const instances = instanceId
      ? [instanceId]
      : Array.from(instanceById.keys());

    const allResults: SearchResult[] = [];

    for (const instId of instances) {
      const store = await getStore(instId);
      const notes = await store.search({
        query,
        limit,
      });

      for (const note of notes) {
        allResults.push({
          id: note.title,
          title: note.title,
          subtitle: note.tags?.join(', '),
          snippet: note.snippet,
          score: note.score,
          launch: {
            panelType: 'notes',
            payload: {
              type: 'notes_show',
              instance_id: instId,
              title: note.title,
            },
          },
        });
      }
    }

    // Sort by score descending
    allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return allResults.slice(0, limit);
  },
};
```

#### Panel Event Handler

The notes panel already handles `notes_show` events:

```typescript
// packages/plugins/official/notes/web/index.ts

onEvent: (event: PanelEventEnvelope) => {
  const payload = event.payload as Record<string, unknown>;
  if (payload?.type === 'notes_show') {
    const title = payload['title'] as string;
    void selectNote(title, { focus: true });
  }
};
```

### Lists Plugin

#### SearchProvider Implementation

```typescript
// packages/plugins/official/lists/server/index.ts

const searchProvider: SearchProvider = {
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    const { instanceId, limit = 10 } = options;
    const instances = instanceId
      ? [instanceId]
      : Array.from(instanceById.keys());

    const allResults: SearchResult[] = [];

    for (const instId of instances) {
      const store = await getStore(instId);

      // Search list items
      const items = await store.searchItems({
        query,
        limit,
      });

      for (const item of items) {
        const list = await store.getList(item.listId);
        allResults.push({
          id: item.id,
          title: item.title,
          subtitle: list?.name ?? item.listId,
          snippet: item.notes,
          score: item.score,
          launch: {
            panelType: 'lists',
            payload: {
              type: 'lists_show',
              instance_id: instId,
              listId: item.listId,
              itemId: item.id,
            },
          },
        });
      }
    }

    allResults.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    return allResults.slice(0, limit);
  },
};
```

#### Panel Event Handler Update

Extend `lists_show` to support item highlighting:

```typescript
// packages/plugins/official/lists/web/index.ts

onEvent: (event: PanelEventEnvelope) => {
  const payload = event.payload as Record<string, unknown>;
  if (payload?.type === 'lists_show') {
    const listId = payload['listId'] as string;
    const itemId = payload['itemId'] as string | undefined;

    void selectList(listId, { focus: true }).then(() => {
      if (itemId) {
        // Scroll to and highlight the item
        highlightItem(itemId);
      }
    });
  }
};
```

---

## Future Considerations

### Additional Commands

The command palette can support more commands beyond search:

```
/open <panelType> [instance]    → Open/focus a panel
/new note [instance]            → Create a new note
/new list [instance]            → Create a new list
/new session [agent]            → Create a new session
/settings                       → Open settings
/theme <name>                   → Switch theme
```

### Plugin Namespaces

Plugins could expose their own commands:

```
/notes add <instance> <title>   → Create note
/notes delete <instance> <title> → Delete note
/lists create <instance> <name>  → Create list
```

### Fuzzy Matching

Enhance search with fuzzy matching for typo tolerance:

```
meetng → matches "meeting"
```

### Recent/Frequent Results

Show recently accessed or frequently used items when palette opens with no query:

```
┌─────────────────────────────────────────────┐
│ |                                           │
├─────────────────────────────────────────────┤
│ Recent                                      │
│   📝 Meeting notes Q4 — notes:work          │
│   📋 Reading list — lists:personal          │
│                                             │
│ Type to search, or / for commands           │
└─────────────────────────────────────────────┘
```

### Keyboard Shortcut Customization

Allow users to customize the palette shortcut:

```json
{
  "shortcuts": {
    "commandPalette": "Cmd+K"
  }
}
```

### Search Indexing

For large datasets, implement server-side search indexing for better performance:

- Full-text index with stemming
- Incremental index updates
- Score boosting for titles vs content

---

## Implementation Checklist

### Phase 1: Backend Search Infrastructure

- [ ] Define `SearchProvider` interface in plugin types
- [ ] Create `SearchService` in agent-server
- [ ] Add `/api/search` HTTP endpoint
- [ ] Add `/api/search/scopes` endpoint for available scopes

### Phase 2: Plugin Integration

- [ ] Implement `SearchProvider` in notes plugin
- [ ] Implement `SearchProvider` in lists plugin
- [ ] Extend `lists_show` event to support `itemId`
- [ ] Register providers with SearchService during plugin init

### Phase 3: Frontend Command Palette

- [ ] Create `CommandPaletteController`
- [ ] Implement state machine for staged input
- [ ] Build palette UI component
- [ ] Add keyboard navigation
- [ ] Implement action menu

### Phase 4: Launch Integration

- [ ] Implement Replace action
- [ ] Implement Open workspace action
- [ ] Implement Open modal action
- [ ] Handle panel selection state

### Phase 5: Polish

- [ ] Add search debouncing
- [ ] Add loading states
- [ ] Add empty state messaging
- [ ] Add keyboard shortcut hints
- [ ] Test across browsers
