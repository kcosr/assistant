# Panel Plugins and Flexible Layout (Draft)

## Table of Contents

- [Status](#status)
- [Summary](#summary)
- [Source files](#source-files)
- [Background: Current State](#background-current-state)
- [Current Implementation Snapshot (v0.49)](#current-implementation-snapshot-v049)
- [Problems with the Current Model](#problems-with-the-current-model)
- [Terminology](#terminology)
- [Goals](#goals)
- [Non-Goals (Initial Iterations)](#non-goals-initial-iterations)
- [Design Principles](#design-principles)
- [Target Architecture](#target-architecture)
- [Panel Taxonomy (Draft)](#panel-taxonomy-draft)
- [Dev Tools Panels (Initial Targets)](#dev-tools-panels-initial-targets)
- [Plugin System Design](#plugin-system-design)
- [Panel System Design](#panel-system-design)
- [Session Association and Context](#session-association-and-context)
- [Code Editor Panel (Future Plugin)](#code-editor-panel-future-plugin)
- [Editor Bridge (Future)](#editor-bridge-future)
- [Error and Fallback Behavior](#error-and-fallback-behavior)
- [Layout Engine](#layout-engine)
- [URL and Deep Linking](#url-and-deep-linking)
- [User Experience and Interaction Model](#user-experience-and-interaction-model)
- [Keyboard and Commands](#keyboard-and-commands)
- [Backend Integration](#backend-integration)
- [Security and Permissions](#security-and-permissions)
- [Frontend Integration](#frontend-integration)
- [Cross-Panel Coordination](#cross-panel-coordination)
- [Detailed Protocol and API Spec](#detailed-protocol-and-api-spec)
- [Example Panel Designs](#example-panel-designs)
- [Repo and Package Refactor](#repo-and-package-refactor)
- [Supporting Separate Applications](#supporting-separate-applications)
- [File-Level Migration Map](#file-level-migration-map)
- [Layout Persistence and Migration](#layout-persistence-and-migration)
- [Migration Plan (No Backward Compatibility Required)](#migration-plan-no-backward-compatibility-required)
- [Detailed Implementation Plan (Task Breakdown)](#detailed-implementation-plan-task-breakdown)
- [Granular Phase Checklist](#granular-phase-checklist)
- [Near-Term Plan (Post v0.45)](#near-term-plan-post-v045)
- [Refactor Checklist (High-Level)](#refactor-checklist-high-level)
- [Suggested Commit Sequence (High-Level)](#suggested-commit-sequence-high-level)
- [Milestones and Acceptance Criteria](#milestones-and-acceptance-criteria)
- [Documentation Updates](#documentation-updates)
- [Cleanup / Next Steps](#cleanup--next-steps)
- [Testing Strategy](#testing-strategy)
- [Definition of Done](#definition-of-done)
- [Risks and Mitigations](#risks-and-mitigations)
- [Working Assumptions (Until Decided)](#working-assumptions-until-decided)
- [Open Questions](#open-questions)
- [Working Notes / Iteration Log](#working-notes--iteration-log)

## Status

- Draft v0.50 (living document; expect revisions)
- Scope: Web + server only. Android is out of scope and assumed removed.
- Backward compatibility is not required during the refactor; only the final state must be correct.
- Progress: Chat, artifacts, and sessions panels initialize their runtimes inside the panel modules (sessions still exposes DOM bindings for keyboard navigation). Files, diff, and terminal sample panels are available as plugin bundles. Legacy layout controllers removed; toolbar toggles replaced by panel launcher. Server exposes plugin manifests (`GET /api/plugins`), client loads them into panel context, and `panel_event` is plumbed through shared protocol, panel host (`sendEvent`), and the `panels_event` tool. Session attributes are persisted in the session index, exposed via `POST /api/plugins/sessions/operations/update-attributes`, and surfaced to panels through `getSessionContext`/`subscribeSessionContext`. Capability gating now scopes built-in tools and panel availability; plugin dependencies and per-plugin data directories are enforced; a panel-only artifacts plugin manifest exists.

## Summary

We want to split the app into a **core session/chat platform** plus **panel plugins** that can be arranged in arbitrary layouts. Panels are first-class plugin instances (chat, artifacts, diff, terminal, etc.) managed by a layout engine that supports splits, tab view, and multiple instances. The notes/tags/lists experience becomes a single plugin rather than a hard-coded mode of a fixed artifacts panel.

This design aims to:

- Cleanly separate core chat/session infrastructure from optional feature panels.
- Enable panel plugins that include both frontend UI and backend routes/tools.
- Allow alternate applications to be built on top of the same core packages.

## Source files

- `packages/agent-server/src/plugins/registry.ts`
- `packages/agent-server/src/plugins/operations.ts`
- `packages/shared/src/panelProtocol.ts`
- `packages/web-client/src/controllers/panelWorkspaceController.ts`
- `packages/web-client/src/controllers/panelRegistry.ts`
- `packages/web-client/src/utils/layoutTree.ts`

## Background: Current State

### Backend

- The backend already has a **plugin registry** for artifact types (lists, notes, etc.), but it is data-focused rather than UI-focused.
- Artifacts panel state (`ArtifactsPanelState`) is centralized and broadcast via `panel_event` payloads (`artifacts_state`) in the current architecture.
- View operations are handled by the artifacts plugin (`/api/plugins/artifacts/view` and `/api/plugins/artifacts/views`) and its `view_*` tools.
- Artifacts panel assumptions are baked into core tool descriptions, HTTP routes, and prompt guidance.

### Frontend

- The UI is built around a **fixed three-panel layout**: sidebar, chat, artifacts.
- `LayoutController` and `LayoutBindingsController` manage visibility, pane order, and a horizontal/vertical toggle.
- The artifacts panel contains multiple **modes** (browser, detail, view mode).
- The top toolbar assumes a fixed set of panel toggles and shortcuts.

### Documentation

- `docs/UI_SPEC.md` assumes a fixed three-panel layout and an artifacts panel with specific modes.
- Plugins like the calendar are specified as content for the artifacts panel, not as independent panels.

## Current Implementation Snapshot (v0.49)

- Panel workspace renders a persistent layout tree (splits with optional tab view), with per-panel state and metadata persisted via the host.
- Panel launcher replaces fixed toggles; panels are registered through `PanelRegistry`.
- Server plugin registry now supports dependencies, per-plugin data dirs, and manifest exposure via `/api/plugins`.
- Capability gating applies to built-in tools; panel availability is gated by both capabilities and panel types advertised by manifests (core panels are always allowed).
- Panel manifests are synced from server manifests when available (merged with built-in defaults).
- Artifacts is treated as a single panel concept; lists/notes remain server plugins.
- Core exposes per-plugin settings endpoints (`/api/plugins/:id/settings`) backed by a plugin settings store.
- Web client loads plugin settings on startup and exposes them via panel host context.
- Plugin manifests can advertise `web.bundlePath`/`web.stylesPath` and the web client loads those assets, exposing `window.ASSISTANT_PANEL_REGISTRY.registerPanel` for dynamic panel registration (placeholder panels remount when modules arrive).
- Session attribute patches validate the core namespace (`core.workingDir`, `core.activeBranch`, `core.lastActiveAt`).
- Artifacts view endpoints are now reachable under `/api/plugins/artifacts/view` and `/api/plugins/artifacts/views`.
- View tools (`view_set`, `view_get`, `view_create`, etc.) are provided by the artifacts plugin rather than built-in tools.
- Artifacts panel endpoints (`/api/plugins/artifacts/panel`) and related tools (`artifacts_show`, `artifacts_panel_show`) now live under the artifacts plugin.
- Artifact item endpoints (`/api/plugins/artifacts/items`, `/list`, `/note`, list item operations) are served by the artifacts plugin HTTP routes.
- Sample `hello`, `session-info`, `ws-echo`, and `terminal` panel plugin bundles are available under `/plugins/hello/`, `/plugins/session-info/`, `/plugins/ws-echo/`, and `/plugins/terminal/` and can be enabled via `config.json`.

## Problems with the Current Model

- Panel assumptions are hard-coded (exactly three panels, fixed positions).
- Artifact logic is mixed with core chat/session logic and layout state.
- No clean way to add new panels (diff, terminal, etc.) without overloading the artifacts panel.
- Frontend and backend plugin integration is ad-hoc (no shared panel contract).
- Layout is not user-configurable beyond simple toggles.

## Terminology

- **Artifacts plugin**: The plugin that owns notes, tags, lists, and views.

## Goals

1. **Panels are plugins**: Chat, artifacts, diff, terminal, etc. are independent panel plugins.
2. **Flexible layout**: Users can create any layout (dock, split, tab view), with more than three panels.
3. **Core isolation**: Core server/client own only session + chat plumbing, layout hosting, and plugin lifecycle.
4. **Unified front/back plugins**: Each plugin can provide server routes/tools plus a UI panel.
5. **Composable apps**: External apps can reuse core packages without artifacts-specific assumptions.

## Non-Goals (Initial Iterations)

- Sandboxed untrusted plugin execution (first iteration assumes trusted plugins).
- Remote plugin loading in production (optional later).
- Backward compatibility between intermediate milestones.

## Design Principles

- **Core minimalism**: Core should be unaware of artifacts/view semantics.
- **Panel independence**: Each panel owns its own state and UI.
- **Capability gating**: Plugins declare required capabilities; core mediates access.
- **Layout first**: Layout engine owns placement and persistence, not plugins.
- **Session fidelity**: Chat/session behavior must remain correct throughout.

## Target Architecture

### Core Server

Core owns:

- Session lifecycle, chat pipeline, tool execution, event bus.
- Plugin host (register tools, routes, websocket handlers, storage, hooks).
- Capabilities and scoping model for tools and data.

Core does **not** own:

- Artifacts panel state or view logic.
- UI-specific panel assumptions.

### Core Web Shell

Core owns:

- Layout engine and panel registry.
- Panel launcher UI (not fixed toggles).
- Panel host API for plugins (events, tools, persistence).

Core does **not** own:

- Artifact browser/view UI.
- Plugin-specific state machines.

### Plugin SDK (Shared)

- Shared types for panel manifests, server plugin definitions, and event envelopes.
- Helper utilities for registering tools, routes, and panel state.
- Versioned protocol constants and compatibility checks.
- Operation manifests define tools/HTTP/CLI once; manifest-level surfaces toggle exposure and server modules supply `operations` handlers.

### Panel Plugins

Each plugin can include:

- Backend integration: routes, tools, storage, background jobs.
- Frontend panel module: mount/unmount + event handlers.
- Shared protocol definitions for panel events and data.

## Panel Taxonomy (Draft)

Panels fall into a few broad categories to keep responsibilities clear and avoid mixing domain UX:

- **Core shell panels** (sessions, chat): always available, required for baseline app use.
- **Artifacts panels** (notes/lists/tags/views): multi-instance by default.
- **Dev tools panels** (terminal, file browser): session-scoped and bound to `core.workingDir` (diff is global and rooted at `plugins.diff.workspaceRoot`).
- **Utility panels** (settings/help/launcher): global, not tied to sessions.

Session-scoped dev tools panels are expected to:

- Require explicit capabilities (for example `terminal.exec`, `git.read`, `files.read`).
- Use panel-scoped WebSocket streams for interactive I/O (terminal).
- Default to fixed binding with explicit session selection (no implicit follow), and allow multi-instance.
- Close on session deletion in v1 (no detached terminals yet).

## Dev Tools Panels (Initial Targets)

- **Terminal panel**: PTY-backed shell session per `(sessionId, panelId)`; data streamed via `panel_event`.
- **File browser panel**: read-only directory tree rooted at `core.workingDir` (adds open-in-diff/terminal actions).
- **Diff panel**: render `git diff` in a global panel with rich formatting and per-file navigation.

### File Browser Panel (Implemented v1)

Goals:

- Provide a fast, collapsible tree view of the workspace root.
- Support a lightweight text preview for small files.

Rooting and binding:

- Resolve the root from the files plugin `workspaceRoot` configuration.
- If missing, render a disconnected state and surface the server error.
- Panel binding is global (no session selection).

Backend surface (files plugin, v2):

- `POST /api/plugins/files/operations/workspace-list` -> list directory entries.
- `POST /api/plugins/files/operations/workspace-read` -> truncated file preview.

Payload shape (example):

```json
{
  "root": "/workspaces/app",
  "rootName": "app",
  "rootIsRepo": true,
  "path": "src",
  "entries": [
    {
      "name": "index.ts",
      "path": "src/index.ts",
      "type": "file"
    }
  ],
  "truncated": false
}
```

Constraints:

- All paths are resolved within `workspaceRoot` (reject traversal outside the workspace).
- `workspaceRoot` must be an absolute path.
- Large directories are truncated (`truncated: true`).

Interop:

- The panel emits `files.selection` context for prompt/context providers.

### Diff Panel (Implemented v1)

Goals:

- Visualize working tree diffs with a file list + unified view.
- Provide per-file navigation and staging actions.
- Keep untracked changes visible in the list.

Targets:

- `working`: working tree vs HEAD (default).
- `staged`: staged vs HEAD.

Panel state is panel-local (repo path, target, selection).

Backend surface (diff plugin):

- `POST /api/plugins/diff/operations/status` -> changed file list.
- `POST /api/plugins/diff/operations/patch` -> unified patch for a file.
- `POST /api/plugins/diff/operations/hunk` -> unified patch for a specific hunk.

Capabilities:

- `git.read` for invoking read-only git commands.

Events and tools:

- Panel emits diff selection snapshot events and context attributes for chat.
- Panel handles `diff_show` events to focus a file or hunk.

Failure modes:

- Non-git workspace -> render a "no repository" state.
- Missing diff workspace root -> show disconnected state.
- If the repo lives under the workspace root, the panel can supply a `repoPath` to resolve the repo root.

## Plugin System Design

### Plugin Types

- **Server Plugin**: registers tools/routes/ws hooks and owns backend logic.
- **Panel Plugin**: provides UI for a panel instance and may depend on a server plugin.
- **Combined Plugin**: includes both server and panel parts (preferred for core features).

### Panel/Plugin Wiring (Current vs Target)

Current:

- Panel registry is statically wired in the web client build (chat, sessions, artifacts).
- Plugin manifests are fetched from `/api/plugins` and used for capability gating; matching panel manifests update local panel metadata.
- Plugin manifests can include `web.bundlePath`/`web.stylesPath`; the web client loads those assets and exposes `window.ASSISTANT_PANEL_REGISTRY.registerPanel` for dynamic panel registration.

Near-term (implemented):

- Built-in panel modules can be registered when their panel types appear in plugin manifests; manifests remain the source of truth for metadata.
- Panels advertised by manifests but missing a UI module render a placeholder panel instead of being silently dropped.

Target:

- `panels` in a plugin manifest advertise panel types and required capabilities.
- Web client uses manifests to discover panel types and load panel code (built-in or allowlisted bundle).
- Backend and frontend share a single plugin id; panel types are scoped under that id for assets and settings.

### Custom Plugin Workflow (Target)

1. **Server plugin** registers tools/routes and emits a manifest with capabilities and dependencies.
2. **Panel plugin** provides UI code that implements `PanelModule` and declares a panel manifest.
3. **Panel bundle** is built and referenced via `web.bundlePath` (plus optional `web.stylesPath`), and the bundle registers its panel module via `window.ASSISTANT_PANEL_REGISTRY.registerPanel`.
4. **Core** loads manifests, validates capabilities, and only mounts panels when all requirements are satisfied.
5. **Session attributes** provide the handshake surface between plugins and the core session/chat runtime.

### Prompt Contributions (Server)

- Plugins can register prompt section providers that contribute to the system prompt per session.
- Providers are scoped by capabilities and can use session attributes + tool availability.
- Example: the artifacts plugin injects available item summaries and view state; the diff plugin injects current diff context.

### Manifest Formats

#### Server Plugin Manifest (example)

```json
{
  "id": "artifacts",
  "version": "1.0.0",
  "provides": ["tools", "routes", "ws", "storage"],
  "capabilities": ["lists.read", "lists.write", "views.read", "views.write"]
}
```

#### Panel Plugin Manifest (example)

```json
{
  "id": "artifacts",
  "title": "Artifacts",
  "version": "1.0.0",
  "defaultPlacement": { "region": "right", "size": { "width": 420 } },
  "capabilities": ["lists.read", "views.read"]
}
```

#### Manifest Extension Fields (Draft)

Panel manifests may also include:

- `icon`: string id for the panel icon in the launcher/chrome.
- `description`: short panel description for the launcher.
- `multiInstance`: boolean (default true); if false, opening focuses existing instance.
- `defaultSessionBinding`: `fixed` | `global` (default `fixed` for session-scoped panels; use `global` for non-session panels).
- `minSize` / `maxSize`: width/height constraints for the layout engine.
- `defaultPinned`: boolean; if true, pin the panel to the header dock on first-run layouts.
- `panels`: optional list of panel types if one plugin ships multiple panels.

Server manifests may also include:

- `requiresCore`: semver range of supported core versions.
- `dependsOn`: list of plugin ids required for this plugin to load.
- `dataDir`: data storage root (default `data/plugins/<pluginId>`).
- `settingsSchema`: JSON schema for plugin settings.
- `migrations`: list of storage migration steps.

Web manifests may also include:

- `web.bundlePath`: URL or absolute path to the panel bundle (loaded as a script).
- `web.stylesPath`: URL or absolute path to optional panel styles.

#### Combined Plugin Manifest (preferred)

```json
{
  "id": "artifacts",
  "version": "1.0.0",
  "requiresCore": "^2.0.0",
  "panels": [
    {
      "type": "artifacts",
      "title": "Artifacts",
      "icon": "notebook",
      "multiInstance": false,
      "defaultSessionBinding": "fixed",
      "defaultPlacement": { "region": "right", "size": { "width": 420 } }
    }
  ],
  "web": {
    "bundlePath": "/plugins/artifacts/bundle.js",
    "stylesPath": "/plugins/artifacts/styles.css"
  },
  "server": {
    "provides": ["tools", "routes", "ws", "storage"],
    "dataDir": "data/plugins/artifacts"
  },
  "capabilities": ["lists.read", "lists.write", "views.read", "views.write"],
  "settingsSchema": {
    "type": "object",
    "properties": {
      "defaultViewId": { "type": "string" }
    }
  }
}
```

### Capabilities and Availability (Current Implementation)

- Core capabilities are always present (sessions, panels). Chat capabilities are provided by the chat plugin.
- Available capabilities = core + `manifest.capabilities` + `manifest.server.capabilities` across loaded plugins.
- Panel availability is gated by `panel.capabilities` and by panel types advertised in plugin manifests (core panel types are always allowed).
- Tool exposure is gated by tool capabilities + agent allow/deny lists.

### Dependencies (Current Implementation)

- `manifest.server.dependsOn` must be satisfied by enabled plugins (by id or name).
- Plugins that depend on lists/notes (e.g., artifacts) skip activation if dependencies are disabled.
- Dependencies are resolved before initialization; failures are logged and do not crash the server.

### Loading and Distribution

- **Built-in** plugins are bundled with the core server/client.
- **Local** plugins are loaded from disk (trusted) with an allowlist.
- **Remote** loading is out of scope initially but can reuse the same manifest format.
- **Panel bundles** referenced by `web.bundlePath`/`web.stylesPath` can be served from the core web client under `/plugins/...` or hosted externally.
- Core resolves `dependsOn` before activation and fails fast if dependencies are missing.

### Versioning and Compatibility

- Plugins declare a `version` and required core API version range.
- Core enforces compatibility at load time (fail fast if unsupported).

### Plugin Asset Delivery (Web)

- Built-in panel plugins are bundled into the core web client.
- Long-term: allow an allowlisted plugin bundle served from `/plugins/<pluginId>/bundle.js`.
- The host should refuse to mount a panel unless its manifest has been loaded and verified.

- Frontend panel bundles are served from the server at a predictable path:
  `/plugins/<pluginId>/bundle.js` (and optional CSS at `/plugins/<pluginId>/bundle.css`).
- Built-in plugins are bundled with `core-web`, but use the same manifest format.
- The panel registry can lazy-load plugin bundles on demand.

## Panel System Design

### Panel Instance Lifecycle

1. **Create**: layout engine requests a new panel instance from the registry.
2. **Mount**: plugin returns UI content and registers handlers.
3. **Run**: panel receives events and can issue tool calls.
4. **Persist**: panel state is saved via the host.
5. **Unmount**: panel removes event listeners and releases resources.

### Panel Lifecycle Hooks (Frontend)

```ts
interface PanelModule {
  mount(container: HTMLElement, host: PanelHost, init: PanelInitOptions): PanelHandle;
}

interface PanelHandle {
  onFocus?(): void;
  onBlur?(): void;
  onResize?(size: { width: number; height: number }): void;
  onVisibilityChange?(visible: boolean): void;
  onSessionChange?(ctx: SessionContext | null): void;
  unmount(): void;
}
```

Lifecycle hooks let the host inform panels about focus, resize, session, and visibility changes without hard-coding UI logic in core.

### Panel Host API (Frontend)

```ts
interface PanelHost {
  panelId(): string;
  getBinding(): PanelBinding;
  setBinding(binding: PanelBinding): void;
  onBindingChange(handler: (binding: PanelBinding) => void): () => void;
  sessionId(): string | null;
  sendToolCall(tool: string, args: unknown): Promise<unknown>;
  subscribe(topic: string, handler: (payload: unknown) => void): () => void;
  publish(topic: string, payload: unknown): void;
  setContext(key: string, value: unknown): void;
  getContext(key: string): unknown | null;
  subscribeContext(key: string, handler: (value: unknown) => void): () => void;
  persistPanelState(panelId: string, state: unknown): void;
  loadPanelState(panelId: string): unknown | null;
  openPanel(panelType: string, options?: PanelInitOptions): string;
  closePanel(panelId: string): void;
  movePanel(panelId: string, target: LayoutTarget): void;
  registerCommand(command: PanelCommand): () => void;
  registerToolbarSlot(slot: PanelToolbarSlot): () => void;
  setPanelTitle(title: string): void;
  setPanelBadge(badge: string | null): void;
  setPanelStatus(status: 'idle' | 'busy' | 'error'): void;
  getPluginSetting<T>(key: string): T | null;
  setPluginSetting<T>(key: string, value: T): void;
}
```

### Panel Init Options (Draft)

```ts
interface PanelInitOptions {
  binding?: PanelBinding;
  state?: unknown;
  focus?: boolean;
  placement?: LayoutTarget;
}
```

### Panel Contributions

Plugins can contribute:

- Commands (for command palette or shortcuts).
- Toolbar slots (panel-local and global).
- Context menus (panel-local only).
- Context providers for chat/tool message context (optional).

### Panel State Model

- Panel state is **owned by the plugin** and persisted via the host.
- Core should not interpret plugin state; it only stores and restores it.
- Panel state is keyed by panel instance id.

### Panel Metadata

- Panel metadata controls chrome details such as title overrides, badges, and status.
- Metadata is persisted alongside layout state but can be updated live via the host API.
- Metadata should remain lightweight; rich state belongs in panel state.

### Plugin Settings and Storage

- **Panel state** is per-instance UI state (tab selection, filters, selection).
- **Plugin settings** are global or per-session preferences (default view, sort mode).
- Core stores plugin settings separately from panel state, keyed by plugin id and versioned.
- Current implementation stores plugin settings in `data/plugin-settings.json` via `/api/plugins/:id/settings`.
- Server plugins store data under `data/plugins/<pluginId>/` with optional `sessions/<sessionId>/` subfolders.
- Plugins may ship migrations for stored data and settings; core executes them on startup.

## Session Association and Context

Panels can be **session-scoped** or **global**:

- **Session-scoped panel**: bound to a specific session id (chat, editor).
- **Global panel**: independent of a session (launcher, settings).

### Session Context API (Host)

Panels need structured access to session metadata and attributes:

```ts
interface SessionContext {
  sessionId: string;
  attributes: Record<string, unknown>;
}

interface PanelHost {
  getSessionContext(): SessionContext | null;
  updateSessionAttributes(patch: Record<string, unknown>): Promise<void>;
  subscribeSessionContext(handler: (ctx: SessionContext | null) => void): () => void;
}
```

Notes:

- For `fixed` bindings, `subscribeSessionContext` fires when the bound session changes or its attributes update.
- For `global` panels, `getSessionContext()` returns null.
- Session-scoped metadata like `workingDir` should live under namespaced session attributes (for example `core.workingDir`).

### Session Attribute Schema (Draft)

Session attributes are namespaced and owned by the session. Suggested schema:

```ts
interface SessionAttributes {
  core?: {
    workingDir?: string;
    activeBranch?: string;
    lastActiveAt?: string;
  };
  artifacts?: {
    activeItemId?: string;
    activeListId?: string;
    lastViewId?: string;
  };
  diff?: {
    lastTarget?: { path: string; base?: string };
  };
  editor?: {
    bridgeId?: string;
    lastOpenFile?: string;
  };
}
```

Rules:

- Plugins may only update their own namespace unless granted `sessions.write` with explicit approval.
- Core may prune unknown namespaces on schema migrations.

### Session Attribute Validation (Draft)

- Core validates that `SessionAttributes` is a plain object with string keys.
- Unknown namespaces are preserved by default in v1 (pruning is optional and must be explicit).
- `workingDir` must be an absolute path if present.
- `editor.bridgeId` must be a non-empty string if present.

### Session Attributes (Examples)

- `workingDir`: filesystem path for the session workspace
- `activeBranch`: current git branch (if applicable)
- `editorSocketId`: identifier for editor integration (if present)
- `lastDiffTarget`: last diff target for the session

Attributes are **owned by the session** and can be updated by plugins with appropriate capabilities.

### Capability Extensions (Session)

- `sessions.read`: read session attributes and metadata
- `sessions.write`: update session attributes (restricted)
- `editor.control`: control/modify editor state (high risk)

### Panel-Session Binding Model

Panels can bind to sessions in two modes:

1. **Fixed**: panel stores a `sessionId` and remains attached to that session (required for chat/artifacts/dev tools).
2. **Global**: panel is not session-scoped (settings, launcher, navigator).

Bindings are stored on the panel instance (`PanelBinding`) and persisted in the layout state. Panels do not follow a global "active session" automatically; binding is explicit. The panel host should expose a binding UI to pick a session (for fixed panels) and show a global/unbound state only for panels that support it.

### Panel WebSocket Handlers (Draft)

- Panel UI sends `panel_event` messages over the existing WebSocket connection.
- Plugins can register server-side panel event handlers keyed by `panelType`.
- Handler context includes `connectionId`, `panelId`, and resolved `sessionId` (nullable for global panels).
- Handlers may reply to the sender only, broadcast to the session, or broadcast globally.
- Multiple clients per session are supported by scoping state to `(connectionId, panelId)` when a panel is client-specific (for example, terminal or editor buffers).
- Core emits lifecycle payloads via `panel_event` so plugins can start/stop per-panel resources:
  - `panel_lifecycle` (`opened`/`closed`)
  - `panel_binding` (binding changed)
  - `panel_session_changed` (binding updated to a different session id)

## Code Editor Panel (Future Plugin)

Responsibilities:

- Render and edit files in the session workspace
- Show file tree and open buffers
- Coordinate with chat and diff panels

Backend:

- Provides file read/write endpoints (or tools)
- Optional live sync with external editor via bridge

Security:

- Requires `files.read` + `files.write`
- If remote editor control is enabled, requires `editor.control` with explicit user opt-in

## Editor Bridge (Future)

For advanced editor integration, an optional editor bridge can provide:

- Open file operations (open, reveal, focus)
- Apply patches or edits
- Provide cursor/selection context

Proposed bridge protocol (high-level):

```json
{ "type": "editor_open", "path": "src/app.ts", "line": 42, "column": 5 }
{ "type": "editor_patch", "path": "src/app.ts", "patch": "*** Begin Patch ... *** End Patch" }
```

Bridge connections are authenticated and tied to a session attribute (`editor.bridgeId`).

## Error and Fallback Behavior

- If a panel loses its session binding, it should display a \"disconnected\" state and allow rebinding.
- If a capability is denied, the panel should render an inline error and avoid retry loops.
- If panel state fails to persist, fall back to in-memory state and notify the user.

## Layout Engine

### Layout Tree

```ts
type LayoutNode =
  | {
      kind: 'split';
      splitId: string;
      direction: 'horizontal' | 'vertical';
      sizes: number[];
      children: LayoutNode[];
      viewMode?: 'split' | 'tabs';
      activeId?: string;
    }
  | { kind: 'panel'; panelId: string };
```

### Panel Instance

```ts
type PanelBinding = { mode: 'fixed'; sessionId: string } | { mode: 'global' };

interface PanelMetadata {
  title?: string;
  icon?: string;
  badge?: string;
  status?: 'idle' | 'busy' | 'error';
}

interface PanelInstance {
  panelId: string;
  panelType: string;
  binding?: PanelBinding;
  state?: unknown;
  meta?: PanelMetadata;
}
```

Panel types can opt out of multiple instances (`multiInstance: false`); the host should focus the existing instance instead of creating duplicates.

### Layout Persistence

```ts
interface LayoutPersistence {
  layout: LayoutNode;
  panels: Record<string, PanelInstance>;
}
```

### Layout Operations

- `openPanel(type, options)`
- `closePanel(panelId)`
- `splitPanel(panelId, direction)`
- `movePanel(panelId, target)`
- `setSplitViewMode(splitId, mode)` / `toggleSplitViewMode(splitId)`
- `activatePanel(panelId)`

### Constraints and Defaults

- Panels can declare default placement and size.
- Layout engine can enforce min widths/heights per panel type.
- Layout is global by default (not per-session) unless explicitly scoped.
- Default layout on first run should show a single empty placeholder panel; panels are available from the launcher.

## URL and Deep Linking

- v1 does not require URL synchronization of layout or panel state.
- Panels may optionally update the URL for shareable state (future).
- If URL sync is added later, it should be plugin-owned and opt-in.

## User Experience and Interaction Model

### Panel Launcher

- Replace fixed toolbar toggles with a launcher that lists available panel types.
- Launcher supports search and shows recent or pinned panels.
- Opening a panel respects the panel's default placement unless the user chooses otherwise.

### Panel Chrome

- Panels render inside a standardized frame that includes:
  - Title + icon
  - Close button
  - Panel-specific actions (from toolbar slots)
  - Optional tab strip if the parent split is in tab view

### Drag, Dock, Split, Tab

- Panels can be repositioned by dragging the panel header.
- Dragging over an edge creates a split preview.
- Dragging over another panel creates a tabbed split.
- Tabs can be reordered or detached (detaching creates a new split).

### Focus and Z-Order

- Clicking a panel gives it focus for keyboard shortcuts.
- Active tab gets focus; non-active tabs do not receive keystrokes.
- Panel focus is surfaced to the host for command routing.

### Persistence

- Layout and per-panel UI state persist between sessions.
- A \"Reset layout\" command restores defaults.

## Keyboard and Commands

Baseline commands (proposal):

- Open panel launcher: `Ctrl/Cmd + K` (or command palette if already present).
- Cycle panel focus: `Ctrl/Cmd + ]` / `Ctrl/Cmd + [`.
- Split panel: `Ctrl/Cmd + Shift + \\` (direction chosen by prompt or last split).
- Close panel: `Ctrl/Cmd + W` (panel-focused).
- Reset layout: command palette action.

Panel plugins may register additional shortcuts, scoped to the panel when focused.

## Backend Integration

### Panel Event Bus

- Replace `artifacts_panel_state` with panel-scoped events (artifacts now emits `panel_event` with `artifacts_state` payloads).
- Panel events are namespaced by panel id and type.

```ts
interface PanelEventEnvelope {
  type: 'panel_event';
  panelId: string;
  panelType: string;
  sessionId?: string;
  payload: unknown;
}
```

Routing notes:

- Server plugins can target events by `panelId` or broadcast to all panels of a given type.
- The host maintains an index of `panelType` + `binding` to support routing events to session-bound panels.

### Panel State Endpoints

- `GET /api/panels/:panelId/state`
- `POST /api/panels/:panelId/state`

Panel state is opaque to core and stored as JSON blobs keyed by panel id.

### Route Namespacing

- Plugin routes should be namespaced under `/api/plugins/<pluginId>/...` to avoid collisions.
- Core routes remain reserved for session/chat and plugin registry APIs.

### Tool Scoping and Capabilities

- Tools are registered per plugin and can declare capabilities.
- Core enforces tool access based on user settings and plugin declarations.
- A minimal capability set for v1 should be defined in the plugin SDK.
- Tool calls should include `panelId` and inferred `sessionId` for auditing and session scoping.

### Tool UI Hints (Draft)

Tools may include optional UI hints to open/focus panels or reveal items without hard-coding panel logic in core.

```json
{
  "name": "diff_show",
  "description": "Show a diff in the diff panel.",
  "panel": {
    "type": "diff",
    "action": "open",
    "binding": "fixed",
    "focus": true
  }
}
```

Notes:

- `binding: "fixed"` defaults to the caller's session unless the tool specifies a target session.

Legacy `artifact` metadata should be replaced with `panel` hints in the new architecture.

### Session Hooks

Plugins can subscribe to session lifecycle events (start, end, message) via hooks.

## Security and Permissions

- Plugins are trusted by default in v1 (built-in or allowlisted local plugins).
- Capabilities are enforced by core; plugins must declare required capabilities.
- High-risk capabilities (`terminal.exec`, `files.write`) require explicit user opt-in.
- Each tool call is tagged with plugin id for auditing.

## Frontend Integration

### Panel Launcher

- Replace fixed toolbar toggles with a launcher that opens panels by type.
- The launcher is a core shell feature, not plugin-specific.

### Plugin Communication

- Plugins communicate with the server via tool calls and panel-scoped events.
- Panel host abstracts WebSocket subscription details.

## Cross-Panel Coordination

Some behaviors require coordination between panels (for example, chat including artifacts context, or tools opening the artifacts panel). The host should provide:

- **Context Bus**: a shared key/value store for cross-panel context (e.g., `artifacts.active`, `artifacts.selection`).
  - Plugins can publish context updates.
  - Other panels can subscribe to context keys.
  - Context values are ephemeral and panel-owned; core does not interpret contents.
- **Panel Actions**: standardized actions such as `openPanel`, `focusPanel`, `revealItem`.
  - Example: artifacts plugin publishes `artifacts.active` and chat panel includes it as message context.
  - Example: a tool call requests `revealItem` in the artifacts panel.
- **Context Providers**: plugins can register providers that return structured context for chat/tool calls.
  - The chat panel queries providers at send time instead of hard-coding plugin logic.
  - Example: artifacts provider returns `{ type, id, name }` for the current selection; diff provider returns `{ paths, base }`.

This avoids hard-coding artifacts assumptions in core while still enabling cross-panel workflows.

Example (chat context):

```ts
host.setContext('artifacts.active', { type: 'list', id: 'tasks', name: 'Tasks' });
// Chat panel subscribes and renders a <context /> prefix when sending messages.
```

## Detailed Protocol and API Spec

### WebSocket Messages (Proposed)

#### Server to Client

```json
{ "type": "panel_event", "panelId": "p1", "panelType": "artifacts", "payload": { "kind": "state", "state": { ... } } }
{ "type": "panel_event", "panelId": "p1", "panelType": "artifacts", "payload": { "kind": "selection", "item": { ... } } }
```

#### Client to Server

```json
{ "type": "panel_event", "panelId": "p1", "panelType": "artifacts", "payload": { "kind": "set_state", "patch": { ... } } }
```

### REST Endpoints (Proposed)

- `GET /api/plugins` -> list plugin manifests and capabilities
- `GET /api/panels/:panelId/state` -> read panel state
- `POST /api/panels/:panelId/state` -> update panel state
- `POST /api/panels/:panelId/command` -> invoke panel-specific command (optional)

### Capability Set (v1)

- `panels.manage` (open/close/move panels)
- `chat.read` / `chat.write`
- `lists.read` / `lists.write`
- `notes.read` / `notes.write`
- `views.read` / `views.write`
- `sessions.read` / `sessions.write`
- `links.open` (open URLs on connected clients)
- `network.fetch` (fetch external URLs)
- `terminal.exec` (dangerous, opt-in)
- `git.read` (read-only git operations for diff panel)
- `files.read` (file browser panel)
- `files.write` (future file editing support)
- `editor.control` (dangerous, opt-in)

### Capability Matrix (Draft)

| Capability       | Description               | Typical Plugins    | Risk Level |
| ---------------- | ------------------------- | ------------------ | ---------- |
| `panels.manage`  | Create/move/close panels  | core-web           | Low        |
| `chat.read`      | Read chat transcript      | chat               | Low        |
| `chat.write`     | Post messages             | chat               | Low        |
| `lists.read`     | Read lists/items          | artifacts          | Medium     |
| `lists.write`    | Create/update lists/items | artifacts          | Medium     |
| `notes.read`     | Read notes                | artifacts          | Medium     |
| `notes.write`    | Create/update notes       | artifacts          | Medium     |
| `views.read`     | Read saved views          | artifacts          | Medium     |
| `views.write`    | Create/update views       | artifacts          | Medium     |
| `sessions.read`  | Read session attributes   | chat, diff, editor | Medium     |
| `sessions.write` | Update session attributes | chat, editor       | High       |
| `links.open`     | Open URLs on client       | links              | Low        |
| `network.fetch`  | Fetch external URLs       | url-fetch          | Medium     |
| `git.read`       | Read-only git operations  | diff               | Medium     |
| `files.read`     | Read workspace files      | files              | High       |
| `files.write`    | Write workspace files     | diff (optional)    | High       |
| `terminal.exec`  | Execute commands          | terminal           | Critical   |
| `editor.control` | Control external editor   | editor             | Critical   |

## Example Panel Designs

### Artifacts Panel Plugin (Notes/Tags/Lists)

Responsibilities:

- Unified browser for notes, tags, and lists
- Detail rendering for list/note items
- Views (cross-list filtered view)
- Tag management and filtering

Backend:

- Owns `/api/plugins/artifacts/view` and `/api/plugins/artifacts/views` endpoints
- Owns artifacts panel state (view query, selected item)
- Emits panel events: `artifacts_state`, `artifacts_selection`, `artifacts_view_updated`

Frontend:

- Maintains internal modes (browser/view/detail)
- Uses panel host persistence for UI state (e.g., column prefs)

### Chat Panel Plugin

Responsibilities:

- Chat transcript UI
- Input bar and message controls
- Session switching UI (or separate session panel plugin)

Backend:

- Uses core session/chat API and event stream

### Sessions Panel Plugin (Example)

Responsibilities:

- List agents and sessions
- Create/switch sessions
- Show session activity indicators

Backend:

- Uses core session index APIs
- Emits panel events for session selection changes

### File Browser Panel Plugin (Example)

Responsibilities:

- Render a collapsible tree rooted at the configured workspace root.
- Preview the selected file (text or binary placeholder).
- Emit `files.selection` context updates (including `type: file`) for prompt/context providers and panel interop.

Backend:

- Provides `POST /api/plugins/files/operations/workspace-list` and `POST /api/plugins/files/operations/workspace-read`.
- Enforces workspace scoping and capability checks (`files.read`).

Workspace context:

- Uses the files plugin `workspaceRoot` configuration to resolve file roots.

### Diff Panel Plugin (Example)

Responsibilities:

- Show changed files for the selected target (working, staged).
- Render unified diff patches for the selected file.

Backend:

- Provides `POST /api/plugins/diff/operations/status` and `POST /api/plugins/diff/operations/patch`.
- Enforces `git.read` capability and workspace scoping.

Workspace context:

- Uses `plugins.diff.workspaceRoot` to resolve file paths.
- Emits diff context attributes for prompt composition.

### Terminal Panel Plugin (Example)

Responsibilities:

- Embedded terminal UI backed by a PTY per panel instance.
- Stream input/output via panel WebSocket events.

Backend:

- Provides PTY lifecycle management and `terminal.exec` capability.
- Exposes tools such as `terminal_write` and `terminal_read_screen` for agent access.

## Repo and Package Refactor

Proposed structure (illustrative):

```
packages/
  core-server/
  core-web/
  plugin-sdk/
  panels/
    chat/
    artifacts/
    terminal/
    diff/
```

Mapping guidance:

- Move layout code into `core-web`.
- Move artifacts panel controllers into `panels/artifacts`.
- Move chat controllers into `panels/chat`.
- Extract shared types into `plugin-sdk`.
- Add a build step that emits per-panel bundles at `/plugins/<pluginId>/bundle.js`.

## Supporting Separate Applications

To enable alternate applications built on the core stack:

- `core-server` should be runnable standalone with a minimal default plugin set (chat + sessions panel).
- `core-web` should allow apps to register a custom panel list and hide built-in panels.
- `plugin-sdk` should be published or vendored for third-party plugins.
- Core should expose a stable API for session/chat so external shells can build their own UI.

## File-Level Migration Map

Backend candidates:

- `packages/agent-server/src/plugins/artifacts/panelStateStore.ts` -> artifacts plugin state store
- `packages/agent-server/src/plugins/artifacts/panelRoutes.ts` -> artifacts plugin routes
- `packages/agent-server/src/plugins/artifacts/viewRoutes.ts` -> artifacts plugin routes
- `packages/agent-server/src/viewQueryEngine.ts` -> artifacts plugin or shared sdk

Frontend candidates:

- `packages/web-client/src/controllers/panelWorkspaceController.ts` -> core layout engine
- `packages/web-client/src/controllers/panelHostController.ts` -> core layout bindings/lifecycle
- `packages/web-client/src/controllers/artifactPanelController.ts` -> artifacts panel plugin
- `packages/web-client/src/controllers/artifactsPanelStateController.ts` -> artifacts plugin state
- `packages/web-client/src/controllers/viewModeController.ts` -> artifacts plugin
- `packages/web-client/src/controllers/viewSelectorController.ts` -> artifacts plugin

Shared types:

- `packages/shared/src/protocol.ts` -> plugin-sdk protocol types

## Layout Persistence and Migration

- Store layout and panel state in a versioned schema.
- Provide a migration step that detects the legacy three-panel layout and converts it into the new layout tree.
- Store a `layoutVersion` in preferences; if missing, assume legacy and migrate.
- Provide a one-way migration (no backward compatibility required during refactor).

### Legacy Preference Mapping (Draft)

| Legacy Key                       | New Mapping                                             |
| -------------------------------- | ------------------------------------------------------- |
| `chatVisible`                    | Panel presence: `chat-1` in layout                      |
| `artifactPanelVisible`           | Panel presence: `artifacts-1` in layout                 |
| `layoutMode`                     | Split direction + sizes in layout tree                  |
| `paneOrder`                      | Panel order within split (tab order uses the same list) |
| `artifactPanelWidth/Height`      | Panel size metadata in layout persistence               |
| `aiAssistantArtifactSearchState` | Artifacts panel state (`search` field)                  |

### Example Layout Payload

```json
{
  "layoutVersion": 1,
  "layout": {
    "kind": "split",
    "splitId": "split-1",
    "direction": "horizontal",
    "sizes": [0.25, 0.75],
    "children": [
      { "kind": "panel", "panelId": "sessions-1" },
      {
        "kind": "split",
        "splitId": "split-2",
        "direction": "vertical",
        "sizes": [0.5, 0.5],
        "viewMode": "tabs",
        "activeId": "chat-1",
        "children": [
          { "kind": "panel", "panelId": "chat-1" },
          { "kind": "panel", "panelId": "artifacts-1" }
        ]
      }
    ]
  },
  "panels": {
    "sessions-1": {
      "panelId": "sessions-1",
      "panelType": "sessions",
      "binding": { "mode": "global" }
    },
    "chat-1": {
      "panelId": "chat-1",
      "panelType": "chat",
      "binding": { "mode": "fixed", "sessionId": "session-123" }
    },
    "artifacts-1": {
      "panelId": "artifacts-1",
      "panelType": "artifacts",
      "binding": { "mode": "fixed", "sessionId": "session-123" }
    }
  }
}
```

### Example Panel State (Artifacts)

```json
{
  "mode": "view",
  "view": {
    "id": "view-123",
    "query": { "where": { "field": "due", "op": "lt", "value": "today" } }
  },
  "selectedItem": { "sourceId": "list-a", "itemId": "a1" },
  "search": { "text": "priority", "includeTags": ["work"], "excludeTags": [] }
}
```

## Migration Plan (No Backward Compatibility Required)

### Phase 0: Prep

- Freeze feature work on panel UI during refactor.
- Identify panel-related controllers and server routes.
- Update this doc as source of truth.

### Phase 1: Layout Engine Scaffold

- Implement layout tree + renderer in the web client.
- Represent the current three-panel layout as a layout tree.
- Add persistence for layout and panel instances.
- Map old toggles to layout operations.

### Phase 2: Panel Registry + Host API

- Introduce `PanelRegistry` and `PanelHost`.
- Register a minimal built-in panel (dummy) to validate lifecycle.
- Replace fixed toolbar toggles with a panel launcher.

### Phase 3: Artifacts Plugin Extraction

- Move artifacts panel UI/state into `panels/artifacts`.
- Replace `ArtifactsPanelState` with panel-scoped state for artifacts.
- Move view handling under `/api/plugins/artifacts/view`.
- Update tool descriptions and prompt guidance.

### Phase 4: Chat Plugin Extraction

- Move chat UI into `panels/chat` plugin.
- Update session + message flows to go through panel host events.

### Phase 5: Remove Fixed Panel Assumptions

- Delete fixed layout modes, pane order toggles, and global artifact assumptions.
- Update docs (`docs/UI_SPEC.md`, artifacts specs) to new layout model.

### Phase 6: Plugin Loader + Capabilities

- Add backend and frontend plugin registry/loaders.
- Implement capability enforcement and tool scoping by plugin.

### Phase 7: Sample Plugins + SDK

- Create `diff` and/or `terminal` panel plugins.
- Add plugin SDK docs and example code.

## Detailed Implementation Plan (Task Breakdown)

### Core Server

1. Create `core-server` package skeleton.
2. Move session/chat pipeline into `core-server`.
3. Add plugin host interface and registry.
4. Migrate existing tool registry to plugin host.
5. Add panel state storage endpoints.
6. Implement capability gating.

### Core Web

1. Create `core-web` package skeleton.
2. Implement layout tree renderer and operations.
3. Implement panel registry and host API.
4. Add panel launcher UI.
5. Remove hard-coded three-panel assumptions.

### Plugins

1. Extract artifacts panel into `panels/artifacts`.
2. Extract chat panel into `panels/chat`.
3. Implement sample `diff` panel.
4. Implement sample `terminal` panel.

### Shared SDK

1. Define shared types and manifest formats.
2. Add helper utilities for plugin registration.
3. Document compatibility rules.

Initial implementation can live in `packages/shared/src/panelProtocol.ts` before extracting to a dedicated `plugin-sdk` package.

## Granular Phase Checklist

### Phase 1: Layout Engine Foundation

- Add layout state schema + versioning.
- Render split/tab nodes with placeholder panels.
- Add resize handles and drag/drop docking previews.
- Persist layout state and add "Reset layout" action.
- Migrate legacy layout preferences into the new tree.

### Phase 2: Panel Registry + Host

- Implement `PanelRegistry` with manifest metadata + multi-instance rules.
- Implement `PanelHost` with context bus + persistence + binding APIs.
- Add panel launcher UI and command palette integration.
- Add panel chrome (title, badges, binding indicator).

### Phase 3: Artifacts Plugin Extraction

- Move notes/tags/lists UI into `panels/artifacts`.
- Replace legacy artifacts panel state with plugin-managed artifacts panel state.
- Move `/api/plugins/artifacts/view` and view tools into the artifacts plugin server.
- Provide prompt sections + context provider for chat.

### Phase 4: Chat Plugin Extraction

- Move chat transcript + input bar into `panels/chat`.
- Replace chat-specific DOM wiring with panel host events.
- Update context collection to use context providers.

### Phase 5: Server Plugin Host + Capabilities

- Create plugin registry with manifest loading + dependency checks.
- Enforce capability gating for tools and routes.
- Add plugin data dirs and migrations.
- Replace artifacts panel WS messages with panel-scoped events.

### Phase 6: Sample Panels

- Implement file browser panel (read-only) using `files.read` capability.
- Implement diff panel (read-only) using `git.read` + `files.read` capabilities.
- Implement terminal panel using PTY bridge (opt-in `terminal.exec`).
- Validate binding behavior for session-scoped panels.

### Phase 7: Cleanup and Docs

- Remove legacy layout toggles and artifacts panel UI assumptions.
- Update UI spec, agent prompt docs, and plugin docs.
- Add tests for layout persistence, panel lifecycle, and prompt providers.

## Near-Term Plan (Post v0.45)

1. **Panel discovery from manifests**: allow the client to register panel types from server manifests (built-in mapping + dynamic bundles). [done]
2. **Plugin-scoped settings**: add a per-plugin settings store (server + client) with versioned migrations. [done]
3. **Session attribute contract**: formalize a minimal schema for `core.workingDir` and plugin namespaces. [done]
4. **Artifacts consolidation**: finish routing view APIs/tools under the artifacts plugin surface. [done]
5. **Plugin SDK docs**: publish a minimal "hello panel" example and manifest validator. [done]

## Refactor Checklist (High-Level)

- Remove `ArtifactsPanelState` from core server and web client.
- Replace artifacts panel WS messages with panel-scoped events.
- Replace fixed panel toggles with panel launcher.
- Replace layout toggles and pane order logic with layout engine operations.
- Ensure chat input and session switching are panel-owned.
- Update all tool descriptions and prompts to refer to plugins where applicable.

## Suggested Commit Sequence (High-Level)

1. Add layout engine scaffolding and persistence (no feature moves).
2. Add panel registry + launcher UI; wrap existing panels in adapters.
3. Introduce plugin host registry on the server (no feature moves).
4. Migrate artifacts panel (notes/tags/lists) to plugin structure.
5. Migrate chat panel to plugin structure.
6. Remove legacy layout toggles and artifacts panel assumptions.
7. Add capability gating and tool scoping by plugin.
8. Add sample plugins (diff/terminal) and SDK docs.

## Milestones and Acceptance Criteria

### Milestone 1: Layout Engine + Registry

Deliverables:

- Layout tree rendering with split and tab nodes.
- Panel registry + host API with a dummy panel plugin.
- Launcher UI replaces fixed toggles.

Acceptance:

- Panels can be opened, closed, and rearranged.
- Layout persists and restores on reload.

### Milestone 2: Artifacts Plugin

Deliverables:

- Notes/tags/lists UI moved into `panels/artifacts`.
- Panel-scoped state replaces `ArtifactsPanelState`.
- `/api/plugins/artifacts/view` and `/api/plugins/artifacts/views` moved into artifacts plugin backend.

Acceptance:

- Artifact browsing, view mode, and list detail work end-to-end.
- No core code references artifacts-specific state directly.

### Milestone 3: Chat Plugin

Deliverables:

- Chat UI moved into `panels/chat`.
- Chat panel communicates via panel host events.

Acceptance:

- Session chat works with panel focus and input handling intact.

### Milestone 4: Capability Model + Plugin Host

Deliverables:

- Capability gating for tools and routes.
- Plugin loading registry (built-in + local allowlist).

Acceptance:

- Plugins can be enabled/disabled; tools are scoped correctly.

### Milestone 5: SDK + Sample Plugins

Deliverables:

- Plugin SDK docs and types published.
- Diff and terminal sample panels working.

Acceptance:

- At least one non-artifacts panel plugin can be loaded and used.

## Documentation Updates

Planned updates:

- `docs/UI_SPEC.md`: replace fixed panel layout with layout engine and launcher model. [done]
- `docs/design/panel-layout-ui-spec.md`: new UI spec for panel layout and interactions. [done]
- `packages/agent-server/README.md`: document plugin host and panel endpoints. [done]
- `docs/design/*`: update artifacts-specific docs to reference artifacts plugin. [done]
- `docs/design/calendar-plugin.md`: migrate artifact routes/messages to panel plugin terminology. [done]
- `packages/shared/README.md`: document panel-scoped event types. [done]
- `docs/PLUGIN_SDK.md`: describe panel plugin registration and bundle workflow. [done]

### UI_SPEC Delta Summary (Planned)

- Replace fixed sidebar/chat/artifacts panels with a flexible layout model.
- Replace layout toggle and pane order controls with layout actions (split, tab, move).
- Replace artifacts panel modes with artifacts plugin state.
- Add panel launcher section and describe panel chrome (tab view, title, close).

## Cleanup / Next Steps

- Add a "panel unavailable" UX state when a panel type is listed but its bundle or server plugin is missing. (done)
- Validate plugin config at startup with clear, single-error messaging for missing dependencies or assets. (done)
- Document a reserved session attribute namespace convention (for example `attributes.plugins.<pluginId>.*`). (done)
- Add a core WebSocket plugin registration path for panel-specific streaming (terminal/diff/editor). (done)
- Add plugin-owned HTTP route registration (manifest/handler) so plugin endpoints live with plugins instead of core `http/routes/*` wiring. (done)
- Rename legacy artifacts localStorage keys now that backward compatibility is no longer required (see `docs/design/preferences.md`).

## Testing Strategy

- Unit tests for layout engine operations (split, move, tab, persist).
- Integration tests for plugin lifecycle (register, mount, unmount).
- Backend tests for plugin host routing and tool scoping.
- End-to-end test for artifacts plugin + layout persistence.
- Prompt provider tests for plugin-supplied system prompt sections.

## Definition of Done

- Core runs without any artifacts/view-specific assumptions.
- Panels can be opened/closed/rearranged beyond the original three-panel layout.
- Artifacts and chat are implemented as plugins and function correctly.
- Layout state persists and can be reset to defaults.
- Tool scoping respects plugin capabilities.
- Documentation updated (UI spec + plugin docs).

## Risks and Mitigations

- **Large refactor**: mitigate with phases and clear boundaries.
- **Layout regressions**: add focused layout tests early.
- **Tool scoping errors**: enforce capability checks in core.
- **Plugin drift**: use shared types in `plugin-sdk`.

## Working Assumptions (Until Decided)

- Layout persistence is stored client-side first (server sync optional later).
- Chat input bar remains part of the chat panel, not a separate plugin.
- Multiple instances of artifacts and terminal panels are allowed by default.

## Open Questions

1. Layout persistence: client-only for v1; consider server sync later.
2. Multiple chat panels: initially single-instance; revisit when chat UI is fully panelized.
3. Plugin version compatibility: semver with explicit core version range in manifest.
4. Minimal capability set: `chat.read/write`, `lists.read/write`, `notes.read/write`, `views.read/write`, `panels.manage`, `git.read`, `files.read`, `terminal.exec` (opt-in).
5. Shortcuts: panel-scoped by default, with explicit opt-in for global shortcuts.
6. Server sync: not required in v1.

## Working Notes / Iteration Log

- Draft v0.2: full architecture, layout model, migration plan, and backend/frontend contracts.
- Draft v0.3: expanded plugin system, layout engine details, panel contributions, and task breakdown.
- Draft v0.4: added protocol/API spec, capability list, and file-level migration map.
- Draft v0.5: added UX interactions, keyboard model, layout migration notes, and definition of done.
- Draft v0.6: added milestone acceptance criteria and documentation update plan.
- Draft v0.7: added panel layout UI spec document and referenced it in docs updates.
- Draft v0.8: added example layout payloads and panel state examples.
- Draft v0.9: added security/permissions and refactor checklist.
- Draft v0.10: added legacy notes to related design docs and introduced a dedicated panel layout UI spec.
- Draft v0.11: added repo refactor note for Android removal and updated calendar plugin UI spec reference.
- Draft v0.12: added sessions panel plugin example.
- Draft v0.13: added URL/deep linking section.
- Draft v0.14: added cross-panel coordination model (context bus + actions).
- Draft v0.15: added context bus methods to panel host API.
- Draft v0.16: added route namespacing guidance.
- Draft v0.17: added separate-application support notes.
- Draft v0.18: added default layout guidance.
- Draft v0.19: added cross-panel context example.
- Draft v0.20: collapsed open questions into initial decisions and updated UI spec.
- Draft v0.21: renamed artifacts plugin to artifacts (notes/tags/lists).
- Draft v0.22: aligned panel naming (artifacts) across UI specs.
- Draft v0.23: added terminology note for artifacts vs legacy artifacts.
- Draft v0.24: added suggested commit sequence.
- Draft v0.25: added capability matrix.
- Draft v0.26: added legacy preference mapping for layout migration.
- Draft v0.27: added plugin asset delivery guidance.
- Draft v0.28: added session association, session attributes API, and code editor plugin notes.
- Draft v0.29: added session attribute schema, panel-session binding model, and editor bridge notes.
- Draft v0.30: added session attribute validation and error/fallback behavior.
- Draft v0.31: aligned artifacts naming across CLI/server docs.
- Draft v0.32: added session attribute validation, editor bridge details, and artifacts naming alignment.
- Draft v0.33: added session binding UI hint and diff panel session context note.
- Draft v0.34: added session linkage to panel instances and example layout payload.
- Draft v0.35: added manifest extensions, panel lifecycle hooks, panel metadata/settings, and binding objects in layout state.
- Draft v0.36: added tool UI hints, prompt providers, routing notes, and a granular phase checklist.
- Draft v0.37: noted shared panel protocol types location in `packages/shared`.
- Draft v0.38: captured toolbar toggle removal in favor of the panel launcher.
- Draft v0.39: moved artifacts runtime initialization into the panel module.
- Draft v0.40: moved sessions runtime initialization into the panel module.
- Draft v0.41: removed legacy layout controllers and updated layout seams docs.
- Draft v0.42: added session attributes persistence, session context host API, and panel/session update wiring.
- Draft v0.43: added plugin manifest exposure, capability gating, placeholder panels, and plugin settings store.
- Draft v0.44: added dynamic panel bundle loading and `/plugins/...` asset delivery notes.
- Draft v0.45: added core session attribute typing + validation.
- Draft v0.46: routed artifacts view APIs under `/api/plugins/artifacts/*`.
- Draft v0.47: added a sample `hello` panel plugin bundle and config entry.
- Draft v0.50: added panel taxonomy + dev tools panel targets (terminal/diff/file browser).
- Draft v0.51: expanded file browser + diff panel specs and added `git.read` capability.
- Draft v0.52: aligned file/diff/terminal examples and capability notes with the current implementation.
- Draft v0.53: noted nested repo handling for the diff panel via `repoPath`.
