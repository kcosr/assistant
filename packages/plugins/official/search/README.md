# Search Plugin

Global search wrapper that exposes the core search service as standard plugin operations and tools.

## Overview

- Provides `search` and `scopes` operations (HTTP, tool, CLI).
- Delegates to the core `SearchService`.
- Useful for agent/tool usage and CLI access to global search.

## Operations

### `search`

Search across all registered search providers.

Parameters:
- `query` (string, required)
- `profiles` (string[], optional): profile/instance ids to include
- `plugin` (string, optional): limit to a specific plugin id
- `scope` (string, optional): deprecated alias for `plugin`
- `instance` (string, optional): limit to a specific instance id
- `limit` (number, optional): max results

### `scopes`

List searchable plugin scopes and instances.

## CLI

Build plugins to generate the `search-cli` binary:

```
npm run build:plugins
```

Use `ASSISTANT_URL` (or `assistant.config.json`) to point at the server:

```
ASSISTANT_URL=http://localhost:3000 dist/plugins/search/bin/search-cli search --query "meeting" --profiles work --plugin notes
```

## Source files

- `packages/plugins/official/search/manifest.json`
- `packages/plugins/official/search/server/index.ts`
