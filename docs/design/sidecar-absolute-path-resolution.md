# Sidecar tool path resolution: honor absolute paths within workspace

## Overview
In sidecar mode, the coding toolchain (ls/read/grep/find/etc) currently mis-handles **workspace-qualified absolute paths** by treating them as **workspace-root-relative shorthands** (it strips the leading `/`).

When the workspace root is `/` and a tool call passes `/home/kevin/worktrees/assistant`, the resolver rewrites it and then fails the workspace check, leading to errors like:

```
Invalid path: access outside workspace is not allowed
```

## Root Cause
`resolvePathWithinSession()` in `packages/coding-executor/src/utils/pathUtils.ts` does:

```ts
if (path.isAbsolute(relativePath)) {
  relativePath = relativePath.slice(1);
}
return path.resolve(sessionRoot, relativePath);
```

So any absolute path becomes “relative to the workspace root”. This was likely intended to prevent escaping the workspace, but it unintentionally corrupts already-correct absolute paths that *are inside* the workspace root.

Additionally, the “inside workspace” check appends `path.sep` unconditionally. When the workspace root is `/`, it normalizes to `//`, which causes the `startsWith()` guard to reject otherwise-valid paths.

## Workaround (no code change)
Set `WORKSPACE_ROOT=/` in the sidecar environment and (for debugging only) comment out the "outside workspace" guard in `resolvePathWithinSession`.

This disables the sandbox check and allows absolute paths to resolve without the double-prefix issue, but it removes the safety boundary. Use only as a temporary workaround.

After the proposed fix lands, prefer setting `SIDECAR_ALLOW_OUTSIDE_WORKSPACE_ROOT=true` instead of editing code.

## Proposed Fix
Keep the existing behavior where a leading `/` can act as a *workspace-root-relative shorthand* (e.g. `/logs/output.log` -> `<workspaceRoot>/logs/output.log`), but **also** honor absolute paths that already point inside the workspace root (e.g. `/workspace/src/index.ts`).

Add an explicit escape hatch to disable the workspace boundary and treat absolute paths as literal filesystem paths when needed.

### Absolute path handling (default, safe)

1. If `requestedPath` is absolute:
   - Resolve it (`path.resolve(requestedPath)`).
   - If it is inside `sessionRoot`, **return it unchanged**.
   - Otherwise, treat it as a workspace-root-relative shorthand by stripping leading `/` characters and resolving relative to `sessionRoot`.
2. If `requestedPath` is relative, keep existing behavior.
3. Replace the `startsWith()`-based workspace boundary check with a `path.relative()`-based check so filesystem roots (like `/`) work without special-casing string prefixes.

### Allowing execution outside the workspace root (unsafe)

Add `allowOutsideWorkspaceRoot` as an option to the resolver/executor. When enabled:

- absolute paths are treated as literal filesystem paths
- the workspace boundary check is disabled

Pseudo-code:

```ts
const sessionRoot = path.resolve(options.workspaceRoot);
const allowOutside = options.allowOutsideWorkspaceRoot === true;
let requested = requestedPath.replace(/\\/g, '/');

if (!requested || requested === '.') {
  return sessionRoot;
}

if (requested === '/') {
  return allowOutside ? path.sep : sessionRoot;
}

if (path.isAbsolute(requested) && allowOutside) {
  const resolvedAbs = path.resolve(requested);
  return resolvedAbs;
}

if (path.isAbsolute(requested)) {
  const resolvedAbs = path.resolve(requested);
  if (isWithin(sessionRoot, resolvedAbs)) {
    return resolvedAbs;
  }
  requested = requested.replace(/^\/+/, '');
}

const resolved = path.resolve(sessionRoot, requested);
assertWithin(sessionRoot, resolved); // uses path.relative(), not startsWith()
return resolved;
```

## Test Plan
Update/add tests in `pathUtils.test.ts`:
- Absolute path inside root is accepted and preserved:
  - root=`/tmp/root`, requested=`/tmp/root/logs/output.log` → returns `/tmp/root/logs/output.log`
- Workspace-root-relative shorthand remains supported:
  - root=`/tmp/root`, requested=`/logs/output.log` → returns `/tmp/root/logs/output.log`
- Workspace root `/` does not reject valid absolute paths:
  - root=`/`, requested=`/home/kevin/worktrees/assistant` → allowed
- `allowOutsideWorkspaceRoot` disables the boundary check for absolute paths:
  - root=`/tmp/root`, requested=`/etc/passwd` → returns `/etc/passwd`

## Files to Update
- `packages/coding-executor/src/utils/pathUtils.ts`
- `packages/coding-executor/src/utils/pathUtils.test.ts`

## Notes / Follow-ups
- The compiled sidecar at `/opt/sidecar/server.js` uses `@assistant/coding-executor`; it should pick up the fix once rebuilt.
- After the resolver fix, re-validate the earlier `fd missing` symptom. It can be caused by a non-existent `cwd` from broken path mapping, not necessarily a missing `fd` binary.
