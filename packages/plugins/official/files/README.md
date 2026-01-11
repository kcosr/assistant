# Files Plugin

Read-only file browser for the configured workspace root.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Panel](#panel)
- [Operations](#operations)

## Configuration

```jsonc
{
  "plugins": {
    "files": {
      "enabled": true,
      "workspaceRoot": "/path/to/workspace",
    },
  },
}
```

`workspaceRoot` must be an absolute path. The panel reads files relative to this root.

## Source files

- `packages/plugins/official/files/manifest.json`
- `packages/plugins/official/files/server/index.ts`
- `packages/plugins/official/files/web/index.ts`

## Panel

- Panel type: `files` (multi-instance, global scope).
- Displays a collapsible workspace tree and a read-only file preview.
- Publishes `files.selection` context with `{ path, type: "file" }` when a file is selected.

## Operations

Operations are defined in `manifest.json` and exposed via tools/HTTP/CLI when enabled.

HTTP endpoint format:

```
POST /api/plugins/files/operations/<operationId>
```

Notable operations:

- `workspace-list`: list entries under a workspace directory.
- `workspace-read`: read a file under the workspace root (text only; binary files are flagged).
