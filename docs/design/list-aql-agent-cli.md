# Lists AQL for Agents (lists-cli)

## Status

Draft - January 2026

## Summary

Extend lists-cli and agent tooling to support AQL queries and optional panel application. This adds
server-side AQL evaluation so agents can run structured queries over list items, and introduces a
panel event (or lists op) to apply AQL in an active lists panel.

## Problem

Agents can only run text search (`items-search`) today, and AQL parsing/evaluation exists only in
the web client. There is no agent-friendly way to execute AQL or apply a query to a lists panel
via CLI or tools.

## Goals

- Allow agents/CLI to evaluate AQL on list items (per list + instance).
- Provide a CLI workflow to load/save AQL (existing server ops) and run AQL queries.
- Support applying an AQL query to a lists panel via a panel event or lists operation.
- Keep AQL syntax consistent between client and server.

## Non-goals

- Full cross-list AQL (v1).
- Query optimization beyond basic filtering/sorting.
- Replacing existing raw-text search or tag search.

## Proposed Solution

### Shared AQL module

1. Extract AQL parsing/evaluation/sort helpers into `packages/shared/src/aql/`.
2. Define shared AQL types + a minimal `AqlItem` (title/notes/url/tags/customFields/timestamps/position/completed).
3. Rewire web + server to import from shared, ensuring identical validation behavior.

### Server-side AQL evaluation

1. Move AQL parsing/evaluation into a shared module (e.g., `packages/shared/src/aql/`).
2. Reuse the same implementation in web and server (web imports from shared).
3. Add a lists operation, e.g. `items-aql`, that accepts:
   - `listId` (required)
   - `query` (AQL string, required)
   - `limit` (optional)
   - `instance_id` (optional)
4. Apply `WHERE` + `ORDER BY` server-side. `SHOW` is ignored (or used for projection if desired).

### CLI surface (lists-cli)

Add commands to the lists CLI skill:
- `aql` / `items-aql` (run a query and print results)
- `aql-apply` (apply query to a lists panel)
- `aql-save` / `aql-list` / `aql-delete` / `aql-default` (wrap existing server ops)

### Apply AQL to a panel

Two options:
- **Panel event**: `panels_event` with payload `{ type: "lists_aql_apply", listId, instance_id, query }`
  handled by the lists panel, which switches to AQL mode, sets the query, and applies.
- **Lists op**: `lists_aql_apply` that wraps a broadcast to a given panel id.

### UX behavior for apply

- When applied, lists panel switches to AQL mode (if not already) and runs the query.
- If a saved query name exists for the same string, select it in the Saved dropdown.
- If the query is invalid, show an inline error and do not apply.

## Decisions

- `items-aql` requires `listId` (no cross-list queries in v1).
- `SHOW` is parsed/validated but ignored for server-side projection.
- `aql-apply` requires `panelId` and targets that specific lists panel.
- CLI accepts raw AQL strings only (saved query name/id resolution is out of scope for v1).
- Server-side validation uses the shared AQL module (including ambiguous field checks).

## Files to update

- `packages/shared/src/` (new shared AQL module)
- `packages/plugins/official/lists/server/index.ts`
- `packages/plugins/official/lists/manifest.json`
- `packages/plugins/official/lists/server/store.ts` (if needed for query projection)
- `packages/plugins/official/lists/web/index.ts` (handle `lists_aql_apply`)
- `packages/plugins/core/panels/manifest.json` (if adding new panel event wiring helpers)
- `packages/agent-server/README.md` (document lists-cli AQL commands)
- `packages/plugins/official/lists/README.md`
- Tests:
  - `packages/plugins/official/lists/server/index.test.ts`
  - `packages/plugins/official/lists/server/store.test.ts`
  - `packages/shared/src/...` (AQL unit tests)
