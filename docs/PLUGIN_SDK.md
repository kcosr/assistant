# Plugin SDK (Draft)

This document describes the current workflow for building panel plugins that integrate with the core server and web client. It is intentionally minimal and will evolve as the plugin SDK is extracted into its own package.

## Table of Contents

- [Scope](#scope)
- [How it works](#how-it-works)
- [Source files](#source-files)
- [Plugin directories and resolution](#plugin-directories-and-resolution)
- [Packaged layout (runtime)](#packaged-layout-runtime)
- [Source layout (repo)](#source-layout-repo)
- [Quick Start (Hello Panel)](#quick-start-hello-panel)
- [Manifest basics](#manifest-basics)
  - [Panel Manifest Properties](#panel-manifest-properties)
- [Operations (Tools + HTTP + CLI)](#operations-tools--http--cli)
- [Server module (optional)](#server-module-optional)
- [Plugin Instances (Config)](#plugin-instances-config)
- [Plugin Lifecycle Hooks](#plugin-lifecycle-hooks)
  - [Plugin Instances](#plugin-instances)
- [Skills Docs](#skills-docs)
- [Agent Tool Exposure (Tools vs Skills)](#agent-tool-exposure-tools-vs-skills)
- [Build and install](#build-and-install)
  - [Using generated CLIs and skills bundles](#using-generated-clis-and-skills-bundles)
- [Notes](#notes)
- [Combined Manifest Example](#combined-manifest-example)
- [Panel Bundle Registration](#panel-bundle-registration)
  - [Panel Init Options](#panel-init-options)
  - [Panel Handle (Lifecycle Callbacks)](#panel-handle-lifecycle-callbacks)
  - [Panel Chrome Row](#panel-chrome-row)
  - [Core Services Context](#core-services-context)
- [Panel Context](#panel-context)
- [Panel Host API (Essentials)](#panel-host-api-essentials)
  - [Panel Metadata](#panel-metadata)
  - [Panel State Persistence](#panel-state-persistence)
- [Session Attributes](#session-attributes)
- [Manifest Validation](#manifest-validation)
- [Panel WebSocket Events](#panel-websocket-events)
  - [Event Flow Overview](#event-flow-overview)
  - [Sending Events from Panels](#sending-events-from-panels-client--server)
  - [Receiving Events in Panels](#receiving-events-in-panels-server--client)
  - [Handling Events on the Server](#handling-events-on-the-server)
  - [Complete Example: Real-time Counter](#complete-example-real-time-counter)
- [Plugin Settings](#plugin-settings)
- [Current Constraints](#current-constraints)
- [References](#references)

## Scope

- Panel plugins can include backend logic (tools/routes/storage) and frontend UI bundles.
- The core server exposes plugin manifests at `GET /api/plugins`.
- The web client loads panel bundles declared in plugin manifests and exposes a global registration API.

## How it works

1. Plugin manifests are discovered and validated by the server.
2. The server exposes manifests and operations via HTTP and tool surfaces.
3. The web client fetches manifests and loads panel bundles.
4. Bundles register panels using the global panel registry.
5. Skills bundles are generated from manifest operations for CLI use.

## Source files

- `packages/agent-server/src/plugins/registry.ts`
- `packages/agent-server/src/plugins/operations.ts`
- `packages/agent-server/src/skills.ts`
- `packages/shared/src/panelProtocol.ts`
- `packages/assistant-cli/src/pluginRuntime.ts`
- `packages/web-client/src/utils/pluginBundleLoader.ts`

## Plugin directories and resolution

At runtime the server loads enabled plugin packages from:

- `dist/plugins/<pluginId>`

You can override the path per plugin with `plugins.<pluginId>.source.path` in `config.json`.
Relative paths resolve against the config file directory. The path should point at a
packaged plugin root (with `manifest.json`, `server.js`, and `public/` assets). For local
development, run `npm run build:plugins` and rely on `dist/plugins/<pluginId>` (the default),
or point `source.path` at that output directory.

## Packaged layout (runtime)

```
dist/plugins/<pluginId>/
  manifest.json
  server.js               # optional
  SKILL.md                # generated CLI skills doc
  public/
    bundle.js
    styles.css            # optional
    skill.md              # generated CLI skills doc (served)
  bin/
    <pluginId>-cli         # optional (auto-generated from operations if not provided)
```

## Source layout (repo)

```
packages/plugins/<group>/<pluginId>/
  manifest.json
  skill-extra.md           # optional (manual content appended to SKILL.md)
  server/
    index.ts               # optional
  web/
    index.ts
    styles.css             # optional
  public/                  # optional extra assets
  bin/                     # optional CLI bundle (skips auto-generation)
```

Plugin packages are grouped under:

- `packages/plugins/core/` (required)
- `packages/plugins/official/` (first-party bundled)
- `packages/plugins/examples/` (samples)

## Quick Start (Hello Panel)

1. **Create a plugin package** under `packages/plugins/<group>/<pluginId>` with `manifest.json`.
2. **Build a panel bundle** from `packages/plugins/<group>/<pluginId>/web/index.ts`.
3. **Register the panel module** in the bundle with `window.ASSISTANT_PANEL_REGISTRY.registerPanel`.
4. **Run `npm run build:plugins`** to emit `dist/plugins/<pluginId>/public/bundle.js`.
5. **Enable the plugin** in `config.json` (if the plugin has server-side behavior).

### Built-in Panel Bundles

Plugin packages under `packages/plugins/` (for example `core/`, `official/`, `examples/`) are
bundled into `dist/plugins/<pluginId>/public`
by `npm run build:plugins`. Some core panels are still bundled from
`packages/web-client/src/plugins/` into `packages/web-client/public/plugins/` by
`npm run bundle` (which runs `npm run bundle:plugins`).

This repo ships core plugins (`agents`, `sessions`, `panels`), official plugins (`artifacts`,
`diff`, `files`, `links`, `lists`, `notes`, `questions`, `terminal`, `time-tracker`, `url-fetch`),
and examples (`hello`, `session-info`).
Enable them with:

```json
{
  "plugins": {
    "diff": { "enabled": true },
    "lists": { "enabled": true },
    "notes": { "enabled": true },
    "terminal": { "enabled": true },
    "links": { "enabled": true },
    "url-fetch": { "enabled": true },
    "hello": { "enabled": true },
    "session-info": { "enabled": true }
  }
}
```

The `session-info` plugin also registers `session_info_label_set` and `session_info_label_get` tools
to write and read the session label stored in `sessionInfo.label`.

## Manifest basics

Minimal `manifest.json` for a panel-only plugin:

```json
{
  "id": "hello",
  "version": "0.1.0",
  "panels": [
    {
      "type": "hello",
      "title": "Hello",
      "description": "Sample plugin panel.",
      "multiInstance": true,
      "defaultSessionBinding": "global",
      "sessionScope": "global",
      "defaultPlacement": { "region": "right", "size": { "width": 320 } }
    }
  ],
  "web": {
    "bundlePath": "/plugins/hello/bundle.js",
    "stylesPath": "/plugins/hello/styles.css"
  }
}
```

- `id` must match the plugin directory name (the `<pluginId>` segment) and the config key.
- `description` populates the generated skills frontmatter when skills are enabled.

### Panel Manifest Properties

Each entry in the `panels` array supports these properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `string` | ✓ | Unique panel type identifier. Must match the type used in `registerPanel()`. |
| `title` | `string` | ✓ | Display title shown in panel headers and launcher. |
| `icon` | `string` | | Icon name (e.g., `"list"`, `"file"`, `"terminal"`). See available icons in the codebase. |
| `description` | `string` | | Brief description shown in the panel launcher. |
| `multiInstance` | `boolean` | | If `true`, multiple instances of this panel can be opened. Default: `false`. |
| `defaultSessionBinding` | `"fixed" \| "global"` | | Initial session binding mode. `"fixed"` binds to a specific session; `"global"` is session-independent. |
| `sessionScope` | `"required" \| "optional" \| "global"` | | Session requirement: `"required"` requires a bound session, `"optional"` works with or without, `"global"` ignores sessions. |
| `defaultPlacement` | `PanelPlacement` | | Where to place new panels (e.g., `{ region: "right", size: { width: 320 } }`). |
| `defaultPinned` | `boolean` | | If `true`, panel is pinned to the header dock on first-run layouts. |
| `minSize` | `{ width?, height? }` | | Minimum panel dimensions in pixels. |
| `maxSize` | `{ width?, height? }` | | Maximum panel dimensions in pixels. |
| `capabilities` | `string[]` | | Capability tokens required for this panel to be available. |

## Operations (Tools + HTTP + CLI)

Plugins can define `operations` in the manifest. Each operation includes an input schema and
optional capability metadata. Surfaces (`tool`, `http`, `cli`) are enabled at the manifest
level and apply to all operations. The server generates tool + HTTP surfaces from these
entries, and plugin modules provide handlers via an `operations` map.

Generated tools are included in built-in agent tool lists (subject to tool/capability
allowlist scoping). HTTP routes are served under:

```
POST /api/plugins/<pluginId>/operations/<operationId>
```

Example (trimmed):

```json
{
  "id": "lists",
  "version": "0.1.0",
  "server": { "provides": ["lists"] },
  "surfaces": { "tool": true, "http": true, "cli": false },
  "operations": [
    {
      "id": "create",
      "summary": "Create a list.",
      "inputSchema": {
        "type": "object",
        "properties": { "id": { "type": "string" }, "name": { "type": "string" } },
        "required": ["id", "name"]
      }
    }
  ]
}
```

Handlers live in the server module export; see [Server module (optional)](#server-module-optional).

Tool names are generated as `<pluginId>_<operationId>` with hyphens normalized to underscores.

Session-scoped operations can be invoked over HTTP by sending an `x-session-id` header (or
`sessionId` query param), which sets the tool context session id. The auto-generated CLI
passes this via `--session-id`.

## Server module (optional)

If your plugin needs server-side behavior, ship `server.js` (or `server/index.ts` before build)
that exports `createPlugin` (or a default export) returning a plugin module object:

```js
module.exports = {
  createPlugin() {
    return {
      operations: {},
      panelEventHandlers: {},
      async initialize() {},
    };
  },
};
```

When `manifest.json` includes `operations`, the server generates tools + HTTP routes and uses the
`operations` map for handlers. Legacy `tools` and `httpRoutes` are ignored for plugins that declare
operations. CLI bundles call the same routes and can pass `--session-id` for session-scoped tools.

### Extra HTTP Routes

Plugins using operations can still define additional HTTP routes for endpoints that need raw
response handling (such as binary file downloads). Use `extraHttpRoutes` in the module export:

```ts
export function createPlugin(): PluginModule {
  return {
    operations: { /* ... */ },
    extraHttpRoutes: [
      async (context, req, res, url, segments, helpers) => {
        if (req.method === 'GET' && segments[3] === 'files') {
          // Serve binary file
          res.setHeader('Content-Type', 'application/octet-stream');
          res.end(fileBuffer);
          return true;
        }
        return false;
      },
    ],
  };
}
```

`extraHttpRoutes` are processed alongside operations-generated routes. Use them for binary
endpoints that can't return JSON responses.

## Plugin Instances (Config)

Plugins can optionally scope their data into multiple instances using configuration. Instance
support is configuration-only and separate from panel `multiInstance` (which controls how many
panel tabs can be opened).

Configuration is provided under `plugins.<pluginId>.instances` as an array of instance ids or
objects with labels:

```json
{
  "plugins": {
    "time-tracker": {
      "enabled": true,
      "instances": ["work", { "id": "personal", "label": "Personal" }]
    }
  }
}
```

When `profiles` are defined at the top level of `config.json`, instance ids must match one of the
profile ids (the built-in `default` profile is always available). This enables shared, cross-plugin
scoping labels such as `work` or `personal`.

## Plugin Lifecycle Hooks

Server plugins can provide optional lifecycle hooks in their module export:

- `initialize(dataDir, pluginConfig)`: called once with the plugin data directory and optional
  per-plugin configuration from `config.json`.
- `shutdown()`: called during server shutdown for graceful cleanup.
- `prepareGitSnapshot({ instanceId })`: called before git versioning snapshots so plugins can flush
  data to disk (for example, checkpointing SQLite WAL files before committing).
- `onSessionDeleted(sessionId)`: called when a session is deleted, allowing plugins to clean up
  session-specific data.

Example:

```ts
export function createPlugin(): PluginModule {
  return {
    async initialize(dataDir, pluginConfig) {
      // Set up database, load config, etc.
    },
    async shutdown() {
      // Close connections, flush buffers
    },
    prepareGitSnapshot({ instanceId }) {
      // Checkpoint SQLite WAL, flush pending writes
      db.pragma('wal_checkpoint(TRUNCATE)');
    },
    async onSessionDeleted(sessionId) {
      // Clean up session-specific data
      await db.run('DELETE FROM session_data WHERE session_id = ?', sessionId);
    },
  };
}
```

### Plugin Instances

- Instance ids are lowercased slugs (`[a-z0-9_-]`).
- The default instance id is always `default` and cannot be renamed or removed.
- Default instance data lives in `data/plugins/<pluginId>/default/`.
- Additional instances store data under `data/plugins/<pluginId>/<instanceId>/`.

Plugins that support instances should accept an optional `instance_id` in their operations,
include `instance_id` in panel events, and expose an `instance_list` operation that returns
`[{ id, label }]` for configured instances.

## Skills Docs

Each plugin can include a `skill-extra.md` file (optional) alongside `manifest.json`.
During `npm run build:plugins`, the build generates a `SKILL.md` file containing YAML
frontmatter plus CLI usage, commands, and options (each command maps to a tool when
tools are enabled). The optional extra file is appended under the `## Extra` section.
Frontmatter includes `metadata.author` and `metadata.version`, sourced from the root
`package.json`.
Generated outputs:

- `dist/plugins/<pluginId>/SKILL.md`
- `dist/plugins/<pluginId>/public/skill.md` (served at `/plugins/<pluginId>/skill.md`)
- `dist/skills/<pluginId>/SKILL.md` (plus `<pluginId>-cli` when CLI exists)

To suppress automatic export to `dist/skills` (and `--skills-dir` outputs), set:

```json
{
  "skills": { "autoExport": false }
}
```

Passing `--skills <pluginId>` still forces export for that plugin.

Skills bundles are flat: `SKILL.md` and `<pluginId>-cli` sit in the same directory
(no `bin/` directory).

Use `manifest.description` to populate the frontmatter description.

Exporting skills bundles to Codex:

```sh
npm run build:plugins -- --skills-dir ~/.codex/skills
```

Or copy the default bundle manually:

```sh
cp -R dist/skills/session-info ~/.codex/skills/
```

## Agent Tool Exposure (Tools vs Skills)

Built-in agents can expose plugin operations as model tools or as CLI skills. Configure
this per agent via `toolExposure`:

- `toolExposure: "tools"` (default): plugin operations appear as tool calls.
- `toolExposure: "skills"`: plugin tools are hidden; the system prompt lists CLI skills with
  `SKILL.md` and `<pluginId>-cli` paths (run via `bash`).
- `toolExposure: "mixed"`: plugin tools are shown except for plugins matched by `skillAllowlist`,
  which are exposed as CLI-only skills.

`skillAllowlist` and `skillDenylist` accept glob patterns matching plugin ids. Skills rely on
`dist/skills/<pluginId>/SKILL.md` (or extra `--skills-dir` outputs).

## Build and install

Built-ins (repo):

- `npm run build:plugins` emits `dist/plugins/<pluginId>/...`.
  - If `surfaces.cli` and `surfaces.http` are enabled and `bin/` is not provided, the
    build emits `dist/plugins/<pluginId>/bin/<pluginId>-cli`.
  - Add `--skills-dir <path>` (repeatable) to emit skills bundles into extra directories
    (see [Skills Docs](#skills-docs)).

Third-party (external):

1. Build the web bundle to `public/bundle.js` (IIFE).
2. Build server code to `server.js` (if needed).
3. Place the plugin under a folder and point `source.path` at it (or copy into
   `dist/plugins/<pluginId>`).
4. Enable it in `config.json`:

```json
{
  "plugins": {
    "hello": { "enabled": true }
  }
}
```

Optional override:

```json
{
  "plugins": {
    "hello": {
      "enabled": true,
      "source": { "path": "./plugins/hello" }
    }
  }
}
```

### Using generated CLIs and skills bundles

Each plugin can expose operations over HTTP and (optionally) via a generated CLI. Running `npm run build:plugins` emits:

```bash
# Build plugin bundles + skills
npm install && npm run build:plugins

# Configure CLI base URL
export ASSISTANT_URL=http://localhost:3000
```

Each plugin output goes to:

```bash
dist/skills/<pluginId>/
  SKILL.md
  <pluginId>-cli
```

Quick example:

```bash
./dist/skills/notes/notes-cli list
```

Generated CLIs support `--version`, which reports the core version from the root `package.json`.

You can also copy the `dist/skills/<pluginId>/` directory into external agent skill roots (for example `~/.codex/skills/`). To write skills into a custom directory during build, run:

```bash
npm run build:plugins -- --skills-dir ~/.codex/skills
```

## Notes

- Plugin assets are served from `/plugins/<pluginId>/...`.
- Plugin data is stored under `data/plugins/<pluginId>/` by default.
- When `skill-extra.md` exists, it is appended under `## Extra` in the generated `SKILL.md`
  (see [Skills Docs](#skills-docs)).

## Combined Manifest Example

```ts
import type { CombinedPluginManifest } from '@assistant/shared';

export const HELLO_PLUGIN_MANIFEST: CombinedPluginManifest = {
  id: 'hello',
  version: '0.1.0',
  panels: [
    {
      type: 'hello',
      title: 'Hello Panel',
      icon: 'sparkle',
      multiInstance: true,
      defaultSessionBinding: 'global',
      defaultPlacement: { region: 'right', size: { width: 360 } },
      defaultPinned: false,
    },
  ],
  web: {
    bundlePath: '/plugins/hello/bundle.js',
    stylesPath: '/plugins/hello/styles.css',
  },
  server: {
    provides: [],
    capabilities: [],
  },
  capabilities: [],
};
```

Notes:

- `panels[].type` must match the panel type you register in the bundle.
- `panels[].defaultPinned` pins the panel to the header dock on first-run layouts (when no saved layout exists).
- `web.bundlePath`/`web.stylesPath` can be absolute URLs or server-relative paths.
- Packaged plugin assets in `dist/plugins/<pluginId>/public` are served at `/plugins/<pluginId>/...`.
  Legacy assets under `packages/web-client/public/plugins/<pluginId>/` are still served when no
  packaged plugin overrides them.

## Panel Bundle Registration

Panel bundles are loaded as classic scripts (not ES modules). Your bundle should register itself via the global registry:

```js
(function () {
  if (!window.ASSISTANT_PANEL_REGISTRY) {
    return;
  }

  window.ASSISTANT_PANEL_REGISTRY.registerPanel('hello', () => ({
    mount(container, host, init) {
      container.innerHTML = '';
      const body = document.createElement('div');
      body.className = 'panel-body';
      body.textContent = 'Hello from a plugin panel!';
      container.appendChild(body);

      return {
        onSessionChange(sessionId) {
          body.dataset['sessionId'] = sessionId ?? '';
        },
        unmount() {
          container.innerHTML = '';
        },
      };
    },
  }));
})();
```

### Panel Init Options

The `init` parameter passed to `mount()` contains initialization options:

| Property | Type | Description |
|----------|------|-------------|
| `binding` | `PanelBinding \| undefined` | Initial session binding (if the panel is session-bound). |
| `state` | `unknown \| undefined` | Previously persisted state from `persistPanelState()`. |
| `focus` | `boolean \| undefined` | Whether the panel should receive focus on mount. |

Example using init options:

```ts
mount(container, host, init) {
  // Restore previously persisted state
  if (init?.state && typeof init.state === 'object') {
    const saved = init.state as { selectedId?: string };
    if (saved.selectedId) {
      selectItem(saved.selectedId);
    }
  }

  // Auto-focus if requested
  if (init?.focus) {
    requestAnimationFrame(() => {
      container.querySelector('input')?.focus();
    });
  }

  // ...
}
```

### Panel Handle (Lifecycle Callbacks)

The object returned from `mount()` is the panel handle. It provides optional lifecycle callbacks
that the host invokes at appropriate times:

| Callback | Description |
|----------|-------------|
| `onFocus()` | Called when the panel gains focus (user clicks or tabs into it). |
| `onBlur()` | Called when the panel loses focus. |
| `onResize(size)` | Called when the panel container is resized. Receives `{ width, height }`. |
| `onVisibilityChange(visible)` | Called when the panel becomes visible or hidden (e.g., tab switching). |
| `onSessionChange(sessionId)` | Called when the bound session changes. Receives the new session id or `null`. |
| `onEvent(event)` | Called when the panel receives a WebSocket event from the server. |
| `unmount()` | **Required.** Called when the panel is closed. Clean up event listeners and DOM. |

Example with all callbacks:

```ts
mount(container, host, init) {
  // ... setup code ...

  return {
    onFocus() {
      container.classList.add('focused');
    },
    onBlur() {
      container.classList.remove('focused');
    },
    onResize({ width, height }) {
      // Adjust layout for new size
      if (width < 400) {
        container.classList.add('compact');
      } else {
        container.classList.remove('compact');
      }
    },
    onVisibilityChange(visible) {
      if (visible) {
        // Resume animations, refresh data
      } else {
        // Pause expensive operations
      }
    },
    onSessionChange(sessionId) {
      // Reload data for new session
      if (sessionId) {
        loadSessionData(sessionId);
      } else {
        clearData();
      }
    },
    onEvent(event) {
      // Handle server-pushed events
      if (event.payload?.type === 'data_updated') {
        refreshList();
      }
    },
    unmount() {
      // Clean up
      clearInterval(refreshTimer);
      container.innerHTML = '';
    },
  };
}
```

### Panel Chrome Row

Use the shared chrome row to keep panel headers consistent and to expose workspace controls
(move, reorder, menu, close) without overlapping plugin UI.

Basic markup (trimmed):

```html
<div class="panel-header panel-chrome-row" data-role="chrome-row">
  <div class="panel-header-main">
    <span class="panel-header-label" data-role="chrome-title">Panel Title</span>
    <div class="panel-chrome-instance" data-role="instance-actions">
      <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
        <!-- trigger + menu + search + list -->
      </div>
    </div>
  </div>
  <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls">
    <!-- plugin-specific controls -->
  </div>
  <div class="panel-chrome-frame-controls" data-role="chrome-controls">
    <!-- toggle/move/reorder/menu/close buttons -->
  </div>
</div>
```

Initialize the controller in `mount()`:

```ts
const chrome = new PanelChromeController({
  root,
  host,
  title: 'Notes',
  onInstanceChange: (instanceIds) => setActiveInstance(instanceIds[0] ?? 'default'),
});

chrome.setInstances(instances, selectedInstanceIds);
```

If your panel does not support instances, omit the instance dropdown markup and the controller
will hide the slot automatically.

For multi‑profile selection, opt in explicitly:

```ts
const chrome = new PanelChromeController({
  root,
  host,
  title: 'Notes',
  instanceSelectionMode: 'multi',
  onInstanceChange: (instanceIds) => {
    selectedInstanceIds = instanceIds;
    activeInstanceId = instanceIds[0] ?? 'default';
  },
});

chrome.setInstances(instances, selectedInstanceIds);
```

### Core Services Context

The host may expose shared UI services to panel plugins via `host.getContext('core.services')`.
This is optional, but allows plugins to reuse core dialog/context menu instances and input focus helpers.
Current keys include:

- `dialogManager`
- `contextMenuManager`
- `listColumnPreferencesClient`
- `keyboardShortcuts` (register panel-scoped shortcuts; returns an unsubscribe function; use
  `allowWhenDisabled` on a shortcut to handle keys even when global shortcuts are disabled, e.g.
  Escape to close a modal)
- `focusInput()`
- `setStatus(text)`
- `isMobileViewport()`
- `notifyContextAvailabilityChange()`

Chat panels can also read `host.getContext('core.chat')` to access:

- `getRuntimeOptions()` (shared chat runtime dependencies)
- `registerChatPanel({ runtime, dom, host })` (wire chat panels into core routing)

## Panel Context

Panels can publish context to the host so chat input and panel inventory can include
the current selection without hard-coding plugin details in the UI. Use the shared
context key helper and keep the payload a small object (or `null` when nothing is
selected):

```ts
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';

const contextKey = getPanelContextKey(host.panelId());
host.setContext(contextKey, {
  type: 'list',
  id: 'my-list',
  name: 'My List',
  description: 'Optional description',
  selectedItemIds: ['item-1', 'item-2'],
  selectedItems: [{ id: 'item-1', title: 'First item' }],
  instance_id: 'default',
  instance_ids: ['default', 'work'],
  contextAttributes: {
    'instance-id': 'default',
    'instance-ids': 'default,work',
  },
});
```

The workspace aggregates panel context into `panel.context` and `panel_inventory` so
tools like `panels_list --includeContext` can see it. The chat context line includes
`type`, `id`, `name`, `description`, `selection`, and `selection-titles` when present.
If your panel is not an artifact-like surface, you can still publish custom context
keys, but keep them compact and stable.

## Panel Host API (Essentials)

The panel host provided to `mount` exposes these methods:

### Identity & Binding

| Method | Description |
|--------|-------------|
| `panelId()` | Returns this panel instance's unique id. |
| `getBinding()` | Returns the current session binding, or `null` if unbound. |
| `setBinding(binding)` | Updates the session binding. Pass `null` to unbind. |
| `onBindingChange(handler)` | Subscribe to binding changes. Returns an unsubscribe function. |

### Context & State

| Method | Description |
|--------|-------------|
| `setContext(key, value)` | Publish a value to the shared context store. |
| `getContext(key)` | Read a value from the context store. |
| `subscribeContext(key, handler)` | Subscribe to context changes. Handler receives current value immediately if set. Returns unsubscribe function. |
| `persistPanelState(state)` | Save panel UI state to localStorage (survives page reloads). |
| `loadPanelState()` | Load previously persisted state, or `null` if none. |

### Session

| Method | Description |
|--------|-------------|
| `getSessionContext()` | Returns session context (attributes, id) for bound session, or `null`. |
| `subscribeSessionContext(handler)` | Subscribe to session context changes. Returns unsubscribe function. |
| `updateSessionAttributes(patch)` | Update session attributes (async). Use `attributes.plugins.<pluginId>.*` namespace. |

### Events

| Method | Description |
|--------|-------------|
| `sendEvent(payload, options?)` | Send a WebSocket event to the server. Options: `{ sessionId?: string }`. |

### Panel Metadata

| Method | Description |
|--------|-------------|
| `setPanelMetadata(meta)` | Update panel display metadata (shown in header/tabs). |

The `meta` object supports:

```ts
interface PanelMetadata {
  title?: string;   // Override panel title
  icon?: string;    // Override panel icon
  badge?: string;   // Show a badge (e.g., unread count)
  status?: 'idle' | 'busy' | 'error';  // Status indicator
}
```

Example:

```ts
// Show busy state
host.setPanelMetadata({ status: 'busy' });

// Update title with item count
host.setPanelMetadata({ title: `Tasks (${count})`, status: 'idle' });

// Show badge for notifications
host.setPanelMetadata({ badge: '3' });
```

### Panel Management

| Method | Description |
|--------|-------------|
| `openPanel(panelType, options?)` | Open a new panel. Returns the new panel id, or `null` if failed. |
| `closePanel(panelId)` | Close a panel by id. |
| `activatePanel(panelId)` | Bring a panel to front (useful for tabbed layouts). |
| `movePanel(panelId, placement, targetPanelId?)` | Move a panel to a new location. |

### Layout (Optional)

These methods may not be available in all contexts:

| Method | Description |
|--------|-------------|
| `openPanelLauncher(options?)` | Open the panel launcher UI. |
| `toggleSplitViewMode(splitId)` | Toggle between split and tabbed view modes. |
| `closeSplit(splitId)` | Close a split container, keeping one child. |

### Session Attributes

Use `getSessionContext()` to read session attributes such as `attributes.core.workingDir`.
`subscribeContext` handlers receive the current value immediately if one has been set.

Session attributes are namespaced. Core reserves `attributes.core.*`; plugins should store data under
`attributes.plugins.<pluginId>.*` to avoid collisions.

### Panel State Persistence

Panels can persist UI state across page reloads using `persistPanelState(state)` and
`loadPanelState()`. This is useful for restoring selections, view modes, scroll positions,
or other ephemeral UI state that should survive browser refreshes.

**Storage**: Panel state is stored in localStorage as part of the panel layout. Each panel
instance has its own state keyed by panel id. State is automatically cleaned up when panels
are closed.

**Usage**:

```ts
// On mount, restore previous state
const stored = host.loadPanelState();
if (stored && typeof stored === 'object') {
  const data = stored as Record<string, unknown>;
  if (typeof data.selectedItemId === 'string') {
    selectItem(data.selectedItemId);
  }
  if (typeof data.viewMode === 'string') {
    setViewMode(data.viewMode);
  }
}

// When state changes, persist it
function onSelectionChange(itemId: string) {
  selectItem(itemId);
  host.persistPanelState({
    selectedItemId: itemId,
    viewMode: currentViewMode,
  });
}
```

**Best practices**:

- Keep persisted state minimal (ids, modes, flags) rather than full data objects.
- Always validate loaded state since it may be stale or from an older version.
- Call `persistPanelState()` when meaningful state changes occur, not on every interaction.
- State is per-panel-instance; different instances of the same panel type have separate state.

## Session Attributes

Core-managed attributes are optional and may be absent:

- `attributes.core.workingDir`: absolute path to the session workspace.
- `attributes.core.activeBranch`: active git branch name (when available).
- `attributes.core.lastActiveAt`: ISO timestamp for last activity (reserved for core use).

Plugins should treat these values as best-effort hints and handle missing values gracefully.

## Manifest Validation

Plugin authors can validate manifests with the shared schema:

```ts
import { CombinedPluginManifestSchema } from '@assistant/shared';

const result = CombinedPluginManifestSchema.safeParse(manifest);
if (!result.success) {
  console.error('Invalid manifest', result.error.format());
}
```

The server also validates manifests at startup and reports any schema errors in the plugin
configuration warnings.

## Panel WebSocket Events

Panels and server plugins can communicate bidirectionally via WebSocket events. This enables
real-time features like terminal I/O, live updates, and push notifications.

### Event Flow Overview

```
┌─────────────────┐                              ┌─────────────────┐
│   Panel (Web)   │                              │  Server Plugin  │
│                 │                              │                 │
│  host.sendEvent │  ──── panel_event ────────▶  │ panelEventHandler│
│    (payload)    │                              │                 │
│                 │                              │                 │
│    onEvent()    │  ◀──── panel_event ────────  │  ctx.sendToClient│
│                 │                              │  ctx.sendToSession│
└─────────────────┘                              └─────────────────┘
```

### Sending Events from Panels (Client → Server)

Use `host.sendEvent(payload, options?)` to send events to the server:

```ts
// Send a simple event
host.sendEvent({ type: 'button_clicked', itemId: '123' });

// Send to a specific session (for session-bound panels)
host.sendEvent(
  { type: 'data_updated', data: newData },
  { sessionId: currentSessionId }
);
```

### Receiving Events in Panels (Server → Client)

Implement the `onEvent` callback in your panel handle to receive server events:

```ts
mount(container, host, init) {
  // ... setup ...

  return {
    onEvent(event) {
      // event is a PanelEventEnvelope
      const payload = event.payload as { type?: string };
      
      switch (payload?.type) {
        case 'data_updated':
          refreshList();
          break;
        case 'status_changed':
          updateStatus(payload.status);
          break;
      }
    },
    unmount() { /* ... */ },
  };
}
```

The `PanelEventEnvelope` structure:

```ts
interface PanelEventEnvelope {
  type: 'panel_event';
  panelId: string;
  panelType: string;
  sessionId?: string;
  payload: unknown;
}
```

### Handling Events on the Server

Register `panelEventHandlers` in your server plugin module, keyed by panel type:

```ts
export function createPlugin(): PluginModule {
  return {
    panelEventHandlers: {
      'my-panel': async (event, ctx) => {
        const payload = event.payload as { type?: string };
        
        if (payload?.type === 'fetch_data') {
          const data = await fetchData();
          
          // Respond to the sender
          ctx.sendToClient({
            type: 'panel_event',
            panelId: event.panelId,
            panelType: event.panelType,
            payload: { type: 'data_response', data },
            ...(ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
          });
        }
      },
    },
  };
}
```

### Handler Context Methods

The handler context (`ctx`) provides these methods for sending responses:

| Method | Description |
|--------|-------------|
| `ctx.sendToClient(message)` | Send to the originating client connection only. |
| `ctx.sendToSession(sessionId, message)` | Broadcast to all clients in a session. |
| `ctx.sendToAll(message)` | Broadcast to all connected clients. |

### Routing Guidance

- Include `sessionId` in the message when broadcasting to session-bound panels.
- Omit `sessionId` to target unbound/global panels.
- Use `sessionId: "*"` to broadcast to all panels of a type regardless of binding.

### Lifecycle Events

Core automatically emits these lifecycle events to panel handlers (not broadcast to clients):

- `{ type: 'panel_lifecycle', state: 'opened' | 'closed', binding }`
- `{ type: 'panel_binding', binding }`
- `{ type: 'panel_session_changed', previousSessionId, sessionId }`

### Complete Example: Real-time Counter

**Panel (web/index.ts):**

```ts
mount(container, host, init) {
  let count = 0;
  const display = document.createElement('div');
  const button = document.createElement('button');
  button.textContent = 'Increment';
  
  button.onclick = () => {
    host.sendEvent({ type: 'increment' });
  };
  
  container.append(display, button);
  
  return {
    onEvent(event) {
      const payload = event.payload as { type?: string; count?: number };
      if (payload?.type === 'count_updated') {
        count = payload.count ?? 0;
        display.textContent = `Count: ${count}`;
      }
    },
    unmount() {
      container.innerHTML = '';
    },
  };
}
```

**Server (server/index.ts):**

```ts
let count = 0;

export function createPlugin(): PluginModule {
  return {
    panelEventHandlers: {
      counter: async (event, ctx) => {
        const payload = event.payload as { type?: string };
        
        if (payload?.type === 'increment') {
          count++;
          
          // Broadcast new count to all counter panels
          ctx.sendToAll({
            type: 'panel_event',
            panelId: event.panelId,
            panelType: 'counter',
            payload: { type: 'count_updated', count },
          });
        }
      },
    },
  };
}
```

## Plugin Settings

Plugins can define a settings schema in their manifest and expose configurable options to users.

### Manifest Schema

Add `settingsSchema` to your server manifest to define available settings:

```json
{
  "id": "my-plugin",
  "server": {
    "provides": ["my-plugin"],
    "settingsSchema": {
      "type": "object",
      "properties": {
        "theme": {
          "type": "string",
          "description": "Color theme",
          "enum": ["light", "dark", "auto"]
        },
        "refreshInterval": {
          "type": "number",
          "description": "Refresh interval in seconds"
        }
      }
    }
  }
}
```

### Server API

- `GET /api/plugins/<pluginId>/settings` - Read current settings
- `PATCH /api/plugins/<pluginId>/settings` - Update settings (partial)
- `PUT /api/plugins/<pluginId>/settings` - Replace all settings

### Accessing Settings in Panels

Panels can read settings via the context API:

```ts
// Get settings for a specific plugin
const settings = host.getContext('plugin.settings.my-plugin') as MySettings | null;

// Subscribe to settings changes
host.subscribeContext('plugin.settings.my-plugin', (settings) => {
  applySettings(settings as MySettings);
});

// Get all plugin settings (map of pluginId → settings)
const allSettings = host.getContext('plugins.settings') as Record<string, unknown>;
```

## Current Constraints

- Bundles are trusted and run without sandboxing.
- Panels are registered at runtime; manifests remain the source of truth for metadata.
- Dynamic plugin loading from disk is not implemented yet; built-in plugins must be wired into the server registry.

## References

- `docs/design/panel-plugins.md` for architecture and migration plan.
- `packages/shared/src/panelProtocol.ts` for manifest and panel protocol types.
- `packages/web-client/src/controllers/panelRegistry.ts` for panel module interfaces.
