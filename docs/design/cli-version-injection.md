# CLI Version Injection

## Problem

Plugin CLIs currently report `unknown` when running `--version` because:
1. The manifest has a `version` field but `pluginRuntime.ts` doesn't pass it to yargs
2. The manifest version is manually maintained and often stale

## Solution

Inject the system version (from root `package.json`) at build time in `build-plugins.js`.

### Changes Required

**`scripts/build-plugins.js`:**

```javascript
// At top of file
const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const systemVersion = rootPkg.version;

// In buildCliBundle function
async function buildCliBundle(manifest, outputPath) {
  const cliManifest = { ...manifest, version: systemVersion };
  const contents = `
    import { runPluginCli } from './packages/assistant-cli/src/pluginRuntime';
    const manifest = ${JSON.stringify(cliManifest)};
    void runPluginCli({ manifest, pluginId: manifest.id });
  `;
  // ... rest unchanged
}
```

### Outcome

- All plugin CLIs report the system version (e.g., `0.8.0`)
- Version automatically updates on each release
- Single source of truth (root package.json)

## Dependencies

- Requires `pluginRuntime.ts` to actually use `manifest.version` in yargs (see companion task)
