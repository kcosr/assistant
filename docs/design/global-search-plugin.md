# Global Search Plugin Wrapper

## Overview

Global search exists today as a **core service** (`SearchService`) with HTTP routes:

- `GET /api/search`
- `GET /api/search/scopes`

This document describes the **implemented plugin wrapper** that exposes global search via the standard plugin model (manifest → tools → CLI).

## Goals

- Provide a tool/CLI for global search that matches other plugins.
- Keep the existing `SearchService` logic and HTTP endpoints intact.
- Allow capabilities/visibility to be managed like other plugin tools.

## Non-goals

- Rebuilding the search engine.
- Changing how plugins implement `searchProvider`.

## Implementation

### 1) Expose `searchService` in ToolContext

Add `searchService?: SearchService` to `ToolContext` so plugin handlers can access it.

Touch points:
- `agent-server/src/tools/types.ts`
- `agent-server/src/http/server.ts` (http tool context)
- `agent-server/src/ws/toolCallHandling.ts` (session tool context)

### 2) Create a `search` plugin

**Manifest:** `packages/plugins/official/search/manifest.json`

Operations:

| Operation | Input | Output |
| --- | --- | --- |
| `search` | `query`, `profiles[]?`, `plugin?`, `instance?`, `limit?` | `SearchApiResponse` |
| `scopes` | none | `SearchableScope[]` |

### Profile semantics

- `profiles[]` matches instance IDs (profiles). Search scans all plugins that have any selected profile.
- `default` is just another profile; UI defaults should include it for global+profile views.
- `plugin` limits to a specific plugin id; `instance` targets a specific plugin instance.

Example operation config:

```json
{
  "id": "search",
  "summary": "Run global search across all plugins",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "profiles": { "type": "array", "items": { "type": "string" } },
      "plugin": { "type": "string" },
      "instance": { "type": "string" },
      "limit": { "type": "number" }
    },
    "required": ["query"]
  }
}
```

### 3) Plugin handler

Operations delegate to `ctx.searchService`:

```ts
const searchService = ctx.searchService;
if (!searchService) throw new ToolError('search_unavailable', 'Search service unavailable');
return searchService.search({ query, profiles, plugin, instance, limit });
```

## Why this is a new pattern

Search is cross-plugin by design (aggregates providers). A plugin wrapper keeps that behavior but **exposes it in the standard manifest/tool/CLI model**.

## Alternatives

1) **Skill-only CLI** calling `/api/search` (no plugin changes).
2) **Plugin with extra HTTP routes** that call `/api/search` (no tool/CLI integration).

## Source files

- `packages/agent-server/src/search/searchService.ts`
- `packages/agent-server/src/http/routes/search.ts`

## Source files (plugin)

- `packages/plugins/official/search/manifest.json`
- `packages/plugins/official/search/server/index.ts`

## Notes

- The wrapper uses `search.read` capability and exposes both `search` and `scopes` operations.
