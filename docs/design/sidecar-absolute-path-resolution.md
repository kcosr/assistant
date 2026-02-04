# Sidecar tool path resolution: honor absolute paths within workspace

## Overview
In sidecar mode, the coding toolchain (ls/read/grep/find/etc) currently mis-handles absolute paths by treating them as **workspace-relative** (it strips the leading `/`).

When the workspace root is `/` and a tool call passes `/home/kevin/worktrees/assistant`, the resolver rewrites it and then fails the workspace check, leading to errors like:

```
Invalid path: access outside workspace is not allowed
```

## Root Cause
`resolvePathWithinSession()` in `skills/packages/coding-executor/src/utils/pathUtils.ts` does:

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

## Proposed Fix
Change absolute-path handling to:

1. If `requestedPath` is absolute:
   - Resolve it (`path.resolve(requestedPath)`).
   - If it is inside `sessionRoot`, **return it unchanged**.
   - Otherwise, throw `Invalid path: access outside workspace is not allowed`.
2. If `requestedPath` is relative, keep existing behavior.
3. Normalize the workspace root in the guard so `/` stays `/` (not `//`).

Pseudo-code:

```ts
const sessionRoot = path.resolve(options.workspaceRoot);
const rootWithSep = sessionRoot === path.sep ? path.sep : sessionRoot + path.sep;
const requested = requestedPath.replace(/\\/g, '/');

if (path.isAbsolute(requested)) {
  const resolvedAbs = path.resolve(requested);
  assertWithin(rootWithSep, resolvedAbs);
  return resolvedAbs;
}

// existing relative-path behavior
const resolvedRel = path.resolve(sessionRoot, requested);
assertWithin(rootWithSep, resolvedRel);
return resolvedRel;
```

## Test Plan
Update/add tests in `pathUtils.test.ts`:
- Absolute path inside root is accepted and preserved:
  - root=`/tmp/root`, requested=`/tmp/root/logs/output.log` → returns `/tmp/root/logs/output.log`
- Absolute path outside root is rejected:
  - root=`/tmp/root`, requested=`/etc/passwd` → throws
- Workspace root `/` does not normalize to `//`:
  - root=`/`, requested=`/home/kevin/worktrees/assistant` → allowed if inside

## Files to Update
- `skills/packages/coding-executor/src/utils/pathUtils.ts`
- `skills/packages/coding-executor/src/utils/pathUtils.test.ts`

## Notes / Follow-ups
- The compiled sidecar at `/opt/sidecar/server.js` uses `@assistant/coding-executor`; it should pick up the fix once rebuilt.
- After the resolver fix, re-validate the earlier `fd missing` symptom. It can be caused by a non-existent `cwd` from broken path mapping, not necessarily a missing `fd` binary.
