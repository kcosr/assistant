# Diff Plugin

Git diff review panel backed by a workspace root on the server.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Panel](#panel)
- [Operations](#operations)
- [Panel Events](#panel-events)
- [Panel Context](#panel-context)

## Configuration

```jsonc
{
  "plugins": {
    "diff": {
      "enabled": true,
      "workspaceRoot": "/path/to/workspace",
    },
  },
}
```

`workspaceRoot` must be an absolute path; the diff panel can target repositories within it.

The diff plugin supports instances with per-instance config overrides:

```jsonc
{
  "plugins": {
    "diff": {
      "enabled": true,
      "workspaceRoot": "/path/to/workspace",
      "instances": [
        "work",
        { "id": "oss", "label": "Open Source", "workspaceRoot": "/path/to/oss" }
      ]
    }
  }
}
```

## Source files

- `packages/plugins/official/diff/manifest.json`
- `packages/plugins/official/diff/server/index.ts`
- `packages/plugins/official/diff/web/index.ts`

## Panel

- Panel type: `diff` (multi-instance, global scope).
- Targets working or staged changes for a selected repository path.
- Repository selection uses a workspace-root navigator; detached HEAD repos are hidden/blocked.

## Operations

Operations are defined in `manifest.json` and exposed via tools/HTTP/CLI when enabled.

HTTP endpoint format:

```
POST /api/plugins/diff/operations/<operationId>
```

Notable operations:

- `status`: list changed files for a repo/target.
- `instance_list`: list configured instances.
- `workspace-repos`: list repositories within the workspace root (repo picker source).
- `patch`: fetch a file diff patch.
- `hunk`: fetch a single hunk patch (requires `hunkHash` or `hunkIndex`).
- `show`: focus a panel on a file/hunk.
- `comment-add`, `comment-update`, `comment-delete`: manage diff review notes.
- `stage`, `unstage`: apply staging actions.

All operations accept an optional `instance_id` (defaults to `default`) to target a specific instance.
Review comments are stored per instance under `data/plugins/diff/<instance>/diff-comments.json`,
scoped to repository root and branch.
Detached HEAD repositories do not surface diffs or comments.

## Panel Events

The server emits panel events to update a targeted diff panel:

- `panel_update` actions:
  - `status_changed`: refresh file list.
  - `status_error`: display error.
  - `patch_changed`: refresh the active patch without altering the file list.
  - `comment_added`, `comment_updated`, `comment_deleted`: update review notes.
- `diff_show`: focus a diff panel on a path/hunk.

## Panel Context

When a diff is active, the panel publishes context attributes (panel context key):

```json
{
  "type": "diff",
  "id": "repo/path",
  "name": "repo/path",
  "contextAttributes": {
    "diff-repo": "repo/path",
    "diff-target": "working",
    "diff-path": "src/index.ts",
    "diff-path-absolute": "/path/to/workspace/repo/path/src/index.ts",
    "diff-hunk-hash": "abc123",
    "diff-hunk-index": "0",
    "diff-hunk-header": "@@ -1,2 +1,2 @@"
  }
}
```
