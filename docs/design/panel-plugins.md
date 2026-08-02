# Panel Plugins and Flexible Layout

## Status

This document describes the current web and server plugin architecture. The panel workspace is
manifest-driven, and the layout host is independent of plugin content.

## Source files

- `packages/agent-server/src/plugins/registry.ts`
- `packages/agent-server/src/plugins/operations.ts`
- `packages/web-client/src/controllers/panelRegistry.ts`
- `packages/web-client/src/controllers/panelWorkspaceController.ts`
- `packages/web-client/src/controllers/panelHostController.ts`
- `packages/shared/src/panelProtocol.ts`
- `packages/plugins/core/`
- `packages/plugins/official/`

## Current model

The application has three cooperating layers:

1. **Core server** owns sessions, chat execution, tool execution, plugin lifecycle, capabilities,
   storage boundaries, and shared events.
2. **Core web shell** owns the layout tree, panel launcher, panel registry, panel host, keyboard
   navigation, and persistence of layout metadata.
3. **Plugins** own domain behavior, operations, panel UI, panel state, and plugin-specific data.

Panels are instances identified by a `panelId` and a manifest-declared `panelType`. A pane owns a
tab list, and splits arrange panes or nested splits. Plugins do not control layout structure.

## Plugin manifests

Every plugin has a `manifest.json` with a stable `id`, version, operation definitions, and optional
server and web surfaces. A panel-capable manifest declares its panel types and presentation
metadata.

The manifest is the source of truth for:

- plugin identity and version;
- enabled surfaces (server, web, tools, HTTP, and CLI);
- panel types and titles;
- capabilities required by operations and panels;
- dependencies and initialization order;
- plugin data-directory ownership;
- web bundle and stylesheet paths.

The server exposes loaded manifests through `GET /api/plugins`. The web client uses those manifests
for availability and metadata, then mounts the matching panel modules. A manifest without a loaded
panel module renders an unavailable-panel placeholder rather than silently disappearing.

## Plugin lifecycle

The server registry:

1. discovers plugin manifests from the configured plugin roots;
2. validates manifests and resolves dependencies;
3. creates one data directory per plugin instance;
4. applies capability and surface gating;
5. initializes enabled plugin runtimes;
6. registers operations, routes, event handlers, and shutdown hooks.

The web client:

1. loads the server manifest inventory;
2. registers built-in and bundled panel modules;
3. validates panel availability against capabilities;
4. creates panel instances through the workspace host;
5. mounts and unmounts modules as layout state changes.

Plugin shutdown must release timers, subscriptions, sockets, and other resources owned by the
plugin. Panel unmount must release DOM listeners and panel-local subscriptions.

## Panel host contract

The panel host provides:

- panel identity and manifest metadata;
- access to the current window, pane, and session binding;
- panel-local persistence;
- operation invocation through the server registry;
- panel-scoped events;
- focus, close, replace, split, tab, and selection actions;
- access to current panel context supplied by the client.

Panel modules own their rendering and domain state. They may request workspace operations through
the host, but they do not mutate the layout tree directly.

## Binding and scope

Each panel manifest declares whether instances are global or bound to a session. Binding is
explicit and is represented by:

```ts
type PanelBinding =
  | { mode: 'fixed'; sessionId: string }
  | { mode: 'global' };
```

Session-bound panels close or detach their session-specific state when the corresponding session is
deleted. Global panels remain available independently of the active chat session.

## Operations and capabilities

Operation manifests define the tool, HTTP, and CLI surfaces once. The server implementation
provides the operation handlers, while the registry applies capability and surface gating.

Capabilities should be narrow and attached to the operation or panel that needs them. Core
capabilities cover panel management and session/chat infrastructure. Plugin capabilities cover
their own domain operations.

The effective capability set is derived from enabled manifests and the current agent policy. Tool
allowlists and denylists are evaluated after capability checks. A denied capability must prevent
the associated operation from being exposed or executed.

## Events and context

Plugins communicate with their panels through panel-scoped events. The shared panel protocol
supports panel inventory, selection, binding, status, and layout metadata without requiring core to
understand plugin-specific state.

Each user message may include a client-generated context line containing the selected panel,
window, pane, tab group, and optional plugin-provided selection metadata. Headless callers can use
the panel operations to inspect the current window, tree, or selection.

## Assets and distribution

Plugin builds emit each plugin's manifest, server bundle, web bundle, styles, and generated CLI
entry points under the generated plugin distribution. The web client serves panel bundles through
the plugin asset path declared by the manifest.

Plugin source remains under `packages/plugins`. Generated output is disposable and must not be
treated as source configuration.

## Current plugin inventory

The current source inventory is:

- Core: `agents`, `chat`, `notifications`, `panels`, `sessions`.
- Official: `links`, `lists`, `notes`, `questions`, `scheduled-sessions`, `search`, `time-tracker`,
  `url-fetch`.

New panels should be added as a manifest-backed plugin and documented with its scope, capabilities,
operations, persistence, and panel behavior. Core should only change when the shared host or panel
protocol changes.

## Testing requirements

Plugin changes should cover:

- manifest validation and operation exposure;
- capability and surface gating;
- server initialization and shutdown;
- panel mount, unmount, and event handling;
- layout persistence and session binding when applicable;
- browser and native download/open behavior when a plugin produces a downloadable result.

The focused plugin and panel tests should run before a pull request. Full-suite failures caused by
test-runner resource limits should be rerun with constrained worker settings before being treated
as product regressions.
