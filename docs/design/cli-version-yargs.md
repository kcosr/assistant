# CLI Version in Yargs

## Problem

`pluginRuntime.ts` creates yargs parsers for plugin CLIs but doesn't call `.version()`, so `--version` returns `unknown` even though the manifest contains a version field.

## Solution

Add `.version(manifest.version)` to the yargs chain in `pluginRuntime.ts`.

### Changes Required

**`packages/assistant-cli/src/pluginRuntime.ts`:**

```typescript
const parser = yargs(options.argv ?? hideBin(process.argv))
  .scriptName(`${pluginId}-cli`)
  .version(manifest.version ?? 'unknown')  // <-- Add this line
  .usage('Usage: $0 <command> [options]')
  // ... rest unchanged
```

### Outcome

- `sessions-cli --version` returns `0.8.0` (or whatever version is in manifest)
- Works with existing manifest version or injected system version

## Dependencies

- For best results, combine with build-time version injection (see companion task)
- Without injection, will show whatever is in `manifest.version`
