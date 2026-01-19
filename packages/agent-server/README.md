# @assistant/agent-server

Node.js backend for the AI Assistant. Handles WebSocket connections, OpenAI integration, TTS, and tool hosting.

## Table of Contents

- [Running](#running)
- [Architecture](#architecture)
- [Source Layout (Backend)](#source-layout-backend)
- [Coding plugin tools](#coding-plugin-tools)
- [HTTP API](#http-api)
- [Key Components](#key-components)
- [Environment Variables](#environment-variables)
- [Files](#files)
- [Plugins](#plugins)
- [Configuration](#configuration)

## Running

```bash
# Build first
npm run build

# Set required environment variables
export OPENAI_API_KEY=sk-...
export OPENAI_CHAT_MODEL=gpt-4o

# Start server
npm run start
```

Server listens on `http://localhost:3000` (configurable via `PORT`).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Agent Server                             │
├──────────────────────────────────────────────────────────────┤
│  HTTP Server                                                  │
│  ├── GET /              → Serve web client (index.html)      │
│  ├── GET /client.js     → Serve bundled client JS            │
│  ├── POST /api/plugins/sessions/operations/list → List sessions │
│  ├── POST /api/plugins/sessions/operations/events → Get session event log │
│  ├── POST /api/plugins/sessions/operations/create → Create new session (agentId required) │
│  ├── POST /api/plugins/sessions/operations/update → Rename/pin session │
│  ├── POST /api/plugins/sessions/operations/update-attributes → Update session attributes │
│  ├── POST /external/sessions/:id/messages → Inject assistant (external) │
│  ├── POST /api/plugins/sessions/operations/clear → Clear session history │
│  ├── POST /api/plugins/sessions/operations/message → Send message (headless) │
│  ├── POST /api/plugins/agents/operations/list → List configured agents │
│  ├── POST /api/plugins/agents/operations/message → Send to agent │
│  ├── POST /api/plugins/sessions/operations/delete → Delete session │
│  ├── GET /preferences   → Get user UI preferences            │
│  ├── PATCH /preferences → Partially update preferences       │
│  ├── PUT /preferences   → Replace preferences entirely       │
│  ├── GET /api/plugins   → List plugin manifests              │
│  ├── GET /api/plugins/:id/settings → Get plugin settings     │
│  ├── PATCH /api/plugins/:id/settings → Patch plugin settings │
│  ├── PUT /api/plugins/:id/settings → Replace plugin settings │
│  ├── POST /api/plugins/panels/operations/list → List open panels │
│  ├── POST /api/plugins/panels/operations/selected → Get selected panels │
│  ├── POST /api/plugins/panels/operations/tree → Panel layout tree │
│  ├── POST /api/plugins/files/operations/workspace-list → List workspace entries │
│  ├── POST /api/plugins/files/operations/workspace-read → Preview file contents │
│  ├── POST /api/plugins/diff/operations/status → List diff entries │
│  ├── POST /api/plugins/diff/operations/workspace-repos → List repositories │
│  ├── POST /api/plugins/diff/operations/patch → Get diff patch │
├──────────────────────────────────────────────────────────────┤
│  WebSocket Server (/ws)                                       │
│  └── Session                                                  │
│      ├── Client protocol handling                             │
│      ├── OpenAI Chat Completions (streaming)                  │
│      ├── TTS Backend (OpenAI or ElevenLabs)                   │
│      └── Tool calls via MCP                                   │
├──────────────────────────────────────────────────────────────┤
│  Persistence                                                  │
│  ├── SessionIndex (sessions.jsonl)                            │
│  └── EventStore (sessions/<id>/events.jsonl)                  │
└──────────────────────────────────────────────────────────────┘
```

## Source Layout (Backend)

High-level map of `packages/agent-server/src/` after the backend refactor:

- `src/index.ts`: server boot + wiring (HTTP + WS + tool host + plugins)
- `src/http/`: HTTP server + route modules
  - `src/http/server.ts`: HTTP wiring + request helpers
  - `src/http/routes/`: route handlers by feature
- `src/ws/`: WebSocket session runtime + transport seams
  - `src/ws/session.ts`: thin WS wrapper around runtime
  - `src/ws/sessionRuntime.ts`: stateful session runtime (delegates to extracted helpers)
  - `src/ws/chatRunLifecycle.ts`: chat completion run loop (streaming + tool-call iterations)
  - `src/ws/clientMessageDispatch.ts`: JSON parse/validate + rate limiting + dispatch
  - `src/ws/helloHandling.ts`: hello/session bind flow + protocol validation
  - `src/ws/clientModesAndPingHandling.ts`: set_modes + ping/control helpers
  - `src/ws/chatOutputCancelHandling.ts`: output cancel behavior (barge-in, partial transcript)
  - `src/ws/toolCallHandling.ts`: tool-call execution + panel updates
  - `src/ws/wsTransport.ts`: `WsTransport` abstraction over `ws`
  - `src/ws/sessionConnection.ts`: minimal connection interface for `SessionHub`
- `src/tools.ts`: barrel exports + tool-host composition
  - `src/tools/mcpToolHost.ts`: MCP JSON-RPC-over-stdio client
  - `src/tools/scoping.ts`: allow/denylist + glob matching
  - `src/tools/chatCompletionMapping.ts`: OpenAI chat tool spec mapping
  - `src/tools/types.ts`: shared tool types
- `src/plugins/`: plugin registry + server plugin implementations
- `packages/plugins/`: packaged plugin sources compiled into `dist/plugins`
  - `packages/plugins/core/`: required plugin packages
    - `packages/plugins/core/agents/`: agent discovery + messaging operations
    - `packages/plugins/core/chat/`: chat panel bundle
    - `packages/plugins/core/panels/`: panel inventory + event operations
    - `packages/plugins/core/sessions/`: session operations
  - `packages/plugins/official/`: bundled first-party plugins
    - `packages/plugins/official/diff/`: diff review panel and operations bundle
    - `packages/plugins/official/files/`: file browser panel and workspace operations
    - `packages/plugins/official/lists/`: lists panel + operations plugin (includes list store helpers)
    - `packages/plugins/official/notes/`: notes panel + operations plugin (includes note store helpers)
    - `packages/plugins/official/time-tracker/`: time tracking panel and operations bundle
    - `packages/plugins/official/links/`: links operations plugin
    - `packages/plugins/official/terminal/`: terminal panel + operations plugin
    - `packages/plugins/official/url-fetch/`: URL fetch operations plugin
  - `packages/plugins/examples/`: sample plugins
    - `packages/plugins/examples/hello/`: sample panel plugin bundle
    - `packages/plugins/examples/session-info/`: session info panel + operations plugin
    - `packages/plugins/examples/ws-echo/`: WebSocket echo panel example
- `src/tts/`: TTS factories and streaming sessions
  - `src/tts/backends.ts`: barrel exports
  - `src/tts/openAiTtsBackend.ts`, `src/tts/elevenLabsTtsBackend.ts`: per-backend implementations
  - `src/tts/selectTtsBackendFactory.ts`: backend selection from env/config
- `src/sessionHub.ts`, `src/sessionIndex.ts`, `src/events/eventStore.ts`: core persistence + session coordination

## Coding plugin tools

The `coding` plugin provides tools for interacting with a session-scoped workspace:

- `bash` – run shell commands in the session workspace with streaming output and truncation via `truncateTail`.
- `read` – read text or image files with pagination and truncation handled by `truncateHead`.
- `write` – create or overwrite files, creating parent directories as needed.
- `edit` – apply precise text replacements to a file, returning a human-readable diff.
- `ls` – list directory contents (including dotfiles), sorted alphabetically, with a "/" suffix for directories.
- `find` – find files by glob pattern. Uses `fd` (`fd --glob --color=never --hidden --max-results <limit>`) when available, falling back to the Node.js `glob` package. The tool accepts `pattern` (required), `path` (search directory, default: workspace root), and `limit` (max results, default: 1000). Results are paths relative to the search directory and are truncated using the shared `truncateHead` helper when large.
- `grep` – search file contents for a pattern using ripgrep when available, with a Node.js fallback.

## HTTP API

All endpoints are relative to the server root (default `http://localhost:3000`). Request and response bodies are JSON unless noted.

### Plugin operations

Plugin HTTP surfaces are exposed at:

- `POST /api/plugins/<id>/operations/<operation-id>`

Use `GET /api/plugins` to discover plugin manifests and operation ids. Example calls:

- `POST /api/plugins/lists/operations/list`
- `POST /api/plugins/lists/operations/items-list`
- `POST /api/plugins/notes/operations/list`
- `POST /api/plugins/notes/operations/read`
- `POST /api/plugins/sessions/operations/list`
- `POST /api/plugins/agents/operations/message`

### Panel utilities

Panel inventory, selection, and layout are exposed via the panels plugin:

- `POST /api/plugins/panels/operations/list`
- `POST /api/plugins/panels/operations/selected`
- `POST /api/plugins/panels/operations/tree`

Panel layout management operations:

- `POST /api/plugins/panels/operations/open`
- `POST /api/plugins/panels/operations/close`
- `POST /api/plugins/panels/operations/remove`
- `POST /api/plugins/panels/operations/replace`
- `POST /api/plugins/panels/operations/move`
- `POST /api/plugins/panels/operations/toggle-split-view`
- `POST /api/plugins/panels/operations/close-split`

## Key Components

### Session & Multiplexed Connections

The WebSocket server supports **multiplexed connections** (protocol v2), allowing a single WebSocket to subscribe to multiple sessions simultaneously.

**Connection model:**

```
Client ────── WebSocket ────── Server
                │
                ├── Session A (subscribed)
                ├── Session B (subscribed)
                └── Session C (not subscribed)
```

**Protocol v2 hello:**

```typescript
{
  type: 'hello',
  protocolVersion: 2,
  subscriptions: ['session-a', 'session-b'],  // Sessions to subscribe to
}
```

**Subscription and control messages:**

- `subscribe` – Subscribe to a session's messages
- `unsubscribe` – Stop receiving messages from a session
- `set_session_model` – Update the selected model for a session (sessionId required)

**Key behaviors:**

- Switching sessions no longer requires reconnecting
- All session-specific server messages include `sessionId` field
- Clients can show activity indicators for background sessions
- `text_input` targets a specific session via `sessionId`

**Backward compatibility:** Protocol v1 clients (single session per connection) continue to work.

### SessionHub

Coordinates logical sessions across multiple WebSocket connections:

- Multiple clients can subscribe to the same sessionId
- Broadcasts responses to all subscribed clients
- Manages session lifecycle (create, delete)
- Tracks subscriptions bidirectionally (connection ↔ sessions)

### TTS Backends

Two TTS backends are supported:

**OpenAI TTS** (default)

- Uses `audio.speech.create` endpoint
- Buffers full response, then sends PCM frames
- Simpler but higher latency

**ElevenLabs TTS**

- WebSocket streaming API
- Sends audio chunks as they're generated
- Lower latency, true streaming

### Tool Hosts

The server supports two types of tools:

**Built-in Tools** (always available)

- No external process required; core-only tools are minimal

Panel tools are provided by the `panels` plugin (`panels_*`) when enabled. Agent coordination tools are provided by the `agents` plugin (`agents_*`).

#### panels_event

Send a custom event payload to a panel instance. Defaults to the current session; use `scope: "all"`
to broadcast to every connected client.

Parameters:

- `panelId` (string, required): panel instance id to target
- `panelType` (string, required): panel type id (for example `chat`)
- `payload` (any, required): JSON payload delivered to the panel
- `sessionId` (string, optional): session id to target (defaults to the current session)
- `scope` (`"session"` or `"all"`, optional): set to `"all"` to broadcast to all clients

Example (current session):

```json
{
  "panelId": "lists-1",
  "panelType": "lists",
  "payload": { "type": "panel_update", "refresh": true }
}
```

Example (broadcast):

```json
{ "panelId": "status-1", "panelType": "status", "payload": { "status": "busy" }, "scope": "all" }
```

#### panels_list

List the latest panel inventory snapshot from the connected client.

Parameters:

- `includeChat` (boolean, optional): include chat panels (default: false).
- `includeContext` (boolean, optional): include panel context when available (default: true).
- `includeLayout` (boolean, optional): include layout tree and header panel ids (default: false).

Example:

```json
{ "includeChat": true, "includeContext": true }
```

#### panels_selected

Return the currently selected non-chat panel and (optionally) the selected chat panel.

Parameters:

- `includeChat` (boolean, optional): include the selected chat panel when present.
- `includeContext` (boolean, optional): include panel context when available (default: true).
- `includeLayout` (boolean, optional): include layout tree and header panel ids.

Example:

```json
{ "includeContext": true }
```

#### panels_tree

Return the current panel layout tree.

Parameters:

- `includeChat` (boolean, optional): include chat panels (default: true).
- `includeContext` (boolean, optional): include panel context when available (default: true).
- `format` (`"json"`, `"text"`, or `"both"`, optional): output format (default: `"json"`).

Example:

```json
{ "format": "both", "includeChat": true }
```

#### panels_open

Open a panel in the workspace or header.

Requires an active websocket client for the target session.

Parameters:

- `panelType` (string, optional): panel type to open (default: `"empty"`).
- `targetPanelId` (string, optional): panel id to place relative to.
- `placement` (object, optional): `{ region: "left" | "right" | "top" | "bottom" | "center", size?: { width?: number, height?: number } }`.
- `focus` (boolean, optional): focus the panel (default: true).
- `pinToHeader` (boolean, optional): pin the panel to the header (default: false).
- `binding` (object, optional): `{ mode: "fixed" | "global", sessionId?: string }` (`sessionId` required for `fixed`).
- `sessionId` (string, optional): target session id (defaults to current session).

Example:

```json
{ "panelType": "notes", "placement": { "region": "right" } }
```

#### panels_close

Close a panel and replace it with an empty placeholder.

Parameters:

- `panelId` (string, required): panel instance id to close.
- `sessionId` (string, optional): target session id (defaults to current session).

#### panels_remove

Remove a panel from the layout.

Parameters:

- `panelId` (string, required): panel instance id to remove.
- `sessionId` (string, optional): target session id (defaults to current session).

#### panels_replace

Replace a panel instance with another panel type.

Parameters:

- `panelId` (string, required): panel instance id to replace.
- `panelType` (string, required): replacement panel type.
- `binding` (object, optional): `{ mode: "fixed" | "global", sessionId?: string }`.
- `sessionId` (string, optional): target session id (defaults to current session).

#### panels_move

Move a panel to a new placement.

Parameters:

- `panelId` (string, required): panel instance id to move.
- `placement` (object, required): placement definition.
- `targetPanelId` (string, optional): panel id to place relative to.
- `sessionId` (string, optional): target session id (defaults to current session).

#### panels_toggle-split-view

Toggle a split between split and tab modes.

Parameters:

- `splitId` (string, optional): split id to toggle.
- `panelId` (string, optional): panel id within the split to toggle.
- `sessionId` (string, optional): target session id (defaults to current session).

#### panels_close-split

Close a split, keeping the active/first panel.

Parameters:

- `splitId` (string, required): split id to close.
- `sessionId` (string, optional): target session id (defaults to current session).

**MCP Tool Host** (optional)

- Integration with MCP-compatible tool servers
- Spawns tool server as child process
- Communicates via JSON-RPC 2.0 over stdio
- Content-Length framing
- Implements MCP 2024-11-05 protocol (initialize handshake, tools/list, tools/call)

The `CompositeToolHost` aggregates tools from both sources, allowing the agent to use built-in and external tools together.

## Environment Variables

See root README for complete list.

### OpenAI (optional)

These are required only when using built-in OpenAI chat or TTS backends. The server can start without them; in that case OpenAI-based agents are disabled but CLI agents (Claude, Codex, Pi) continue to work.

- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL`

### TTS

- `TTS_BACKEND` - `openai` (default) or `elevenlabs`
- `TTS_VOICE` - Voice name/ID
- `OPENAI_TTS_MODEL` - OpenAI TTS model
- `ELEVENLABS_API_KEY`, `ELEVENLABS_TTS_VOICE_ID` - For ElevenLabs
- `ELEVENLABS_TTS_MODEL` - ElevenLabs model ID (default: `eleven_multilingual_v2`)

### Tools

- `MCP_TOOLS_ENABLED` - Explicit enable/disable for external MCP servers (`true`/`1` or `false`/`0`)

### Debug

- `DEBUG_CHAT_COMPLETIONS` - Log chat requests/responses to console

## Files

| File                       | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `src/index.ts`             | Main server, HTTP routes, WebSocket handling, Session class |
| `src/tools.ts`             | Tool host infrastructure (MCP, built-in, composite)         |
| `src/builtInTools.ts`      | Built-in tool helpers (agent coordination wiring)           |
| `src/events/eventStore.ts` | JSONL persistence for session ChatEvents                    |
| `src/elevenLabsTts.ts`     | ElevenLabs streaming TTS client                             |
| `src/modes.ts`             | Audio input mode types                                      |
| `src/audio.ts`             | Audio validation utilities                                  |
| `src/rateLimit.ts`         | Per-session rate limiting                                   |

## Plugins

If `plugins` is omitted or empty in `config.json`, no plugins are enabled. Add explicit entries for `sessions` and `agents` to keep the core UI working, plus `lists` and `notes` for data features (and any optional plugins you need).

### Git Versioning (Plugin Data)

Plugins can opt into periodic git snapshots of their data directories:

```json
{
  "plugins": {
    "notes": {
      "enabled": true,
      "gitVersioning": { "enabled": true, "intervalMinutes": 5 }
    }
  }
}
```

- One git repository is created per plugin instance directory.
- Snapshots run on the configured interval and set the local git author to "AI Assistant".
- SQLite WAL/SHM files are ignored; the time-tracker plugin checkpoints WAL before snapshots.
- Requires `git` available on the server `PATH`.

### Coding Plugin

The coding plugin provides tools for working with a session‑scoped workspace (files live under a per‑session directory on disk, or a shared workspace when configured). Tools are designed to be safe by default (no path traversal outside the workspace) and to truncate very large outputs.

| Tool    | Description                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------- |
| `bash`  | Run a bash command in the session workspace and return combined stdout/stderr (tail‑truncated). |
| `read`  | Read a text or image file from the session workspace with optional line offsets and limits.     |
| `write` | Write/overwrite a text file in the session workspace, creating parent directories as needed.    |
| `edit`  | Replace an exact, unique text span in a file and return a human‑readable diff.                  |
| `ls`    | List directory contents (including dotfiles), sorted alphabetically, with a "/" suffix for directories. |
| `find`  | Find files by glob pattern. Uses `fd` when available, falling back to Node.js glob.             |
| `grep`  | Search file contents for a pattern using ripgrep when available, with a Node.js fallback.       |

#### `grep`

Search file contents within the session workspace and return matching lines with file paths and line numbers. When `rg` (ripgrep) is available on `PATH`, the plugin executes:

- `rg --json --line-number --color=never --hidden`

and parses its JSON output. If ripgrep is not available, it falls back to a Node.js implementation that:

- Recursively walks the session workspace (or a subdirectory under it)
- Skips `.git` and `node_modules` directories
- Applies an optional glob filter to relative paths
- Matches using either a literal substring or a regular expression

**Parameters:**

- `pattern` (string, required): Pattern to search for. Interpreted as:
  - literal substring when `literal: true`
  - JavaScript regular expression when `literal` is absent/false
- `path` (string, optional): Directory or file to search, relative to the session workspace. Defaults to `"."` (the workspace root).
- `glob` (string, optional): Glob filter for files, e.g. `"*.ts"` or `"src/*.tsx"`.
  - When running with ripgrep, this is passed through as `--glob`.
  - In the Node.js fallback, a simple `*` / `?` glob is converted to a regular expression and applied to relative paths.
- `ignoreCase` (boolean, optional): Case‑insensitive search when `true`. Defaults to `false`.
- `literal` (boolean, optional): Treat `pattern` as a literal string instead of a regex when `true`. Defaults to `false`.
- `context` (number, optional): Number of lines of context before and after each match. Defaults to `0`.
- `limit` (number, optional): Maximum number of matches to return. Defaults to `100`.

**Result shape:**

```jsonc
{
  "content": "src/example.ts:12: const foo = 1; // match\nsrc/example.ts-11- // context line\n...",
  "details": {
    "matchLimitReached": 100, // present when the match limit was hit
    "truncation": {
      /* TruncationResult from truncate.ts */
    },
    "linesTruncated": true, // true if any individual line was truncated to 500 chars
  },
}
```

- Lines are formatted as:
  - `path:line: text` for the match line
  - `path-line- text` for context lines
- Individual lines longer than 500 characters are truncated with a `... [truncated]` suffix.
- The overall output is truncated using the shared `truncateHead` helper (50KB default), and a short notice block is appended when:
  - the match limit is reached,
  - the byte limit is hit, or
  - any lines were truncated.

### Lists Plugin

The lists plugin provides tools for managing lists and their items:

| Tool                       | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `lists_create`             | Create a new list                              |
| `lists_get`                | Get a list by ID                               |
| `lists_show`               | Display a list in the lists panel              |
| `lists_list`               | List all lists (optionally filtered by tags)   |
| `lists_update`             | Update list metadata                           |
| `lists_delete`             | Delete a list and all its items                |
| `lists_item_add`           | Add an item to a list                          |
| `lists_item_get`           | Get an item by ID or title                     |
| `lists_item_update`        | Update an item's fields                        |
| `lists_item_touch`         | Update an item's review/touch timestamp        |
| `lists_item_remove`        | Remove an item from a list                     |
| `lists_item_copy`          | Copy an item to a different list               |
| `lists_item_move`          | Move an item to a different list               |
| `lists_items_bulk_copy`    | Bulk copy items to a different list            |
| `lists_items_list`         | List items in a list                           |
| `lists_items_search`       | Search items by text                           |
| `lists_get_selected_items` | Get items currently selected by user in the UI |

Clearing list item fields:

- `lists_item_update` accepts `null` to clear built-in fields (`url`, `notes`, `tags`, `completed`, `touchedAt`).
- `lists_items_bulk_update_fields` accepts `customFields: null` to clear all custom fields, `customFields` keys with `null` to clear specific fields, and `touchedAt: null` to clear the touched timestamp.

#### `lists_get_selected_items`

This tool reads the selection state from the connected client's UI. Users can select items using:

- **Desktop**: Ctrl/Cmd+Click to toggle selection, Shift+Click for range selection
- **Mobile**: Long-press to toggle selection

The tool returns the selected item IDs and titles for the specified list.

**Parameters:**

- `listId` (required): ID of the list to get selected items from

**Returns:**

```json
{
  "listId": "shopping",
  "selectedItems": [
    { "id": "item-uuid-1", "title": "Milk" },
    { "id": "item-uuid-2", "title": "Bread" }
  ],
  "count": 2
}
```

Tags for lists and list items are normalized by the backend: tag values are lowercased, trimmed, and deduplicated. The assistant must not invent or change tags unless the user explicitly requests a tag update.

### Notes Plugin

The notes plugin provides tools for managing Markdown notes with YAML frontmatter:

- Note tags are stored in frontmatter and are normalized by the backend (lowercased, trimmed, and deduplicated), matching the behavior of the lists plugin.
- When filtering notes by tags (via tools or HTTP APIs), tag matching is case-insensitive and based on the normalized values.
- The assistant must only add, remove, or rename note tags when the user clearly asks for a tag-related change; it should not infer or modify tags on its own.
- Notes can be configured with multiple instances via `plugins.notes.instances` (default instance id `default`).
- Default instance data lives under `data/plugins/notes/default/`; additional instances use `data/plugins/notes/<instanceId>/`.
- Most operations accept an optional `instance_id` argument.

| Tool                  | Description                |
| --------------------- | -------------------------- |
| `notes_instance_list` | List configured instances  |
| `notes_list`          | List notes                 |
| `notes_read`          | Read a note                |
| `notes_show`          | Show a note in a panel     |
| `notes_write`         | Create or overwrite a note |
| `notes_rename`        | Rename a note              |
| `notes_move`          | Move a note to an instance |
| `notes_delete`        | Delete a note              |
| `notes_search`        | Search note contents       |
| `notes_tags_add`      | Add tags to a note         |
| `notes_tags_remove`   | Remove tags from a note    |

### Time Tracker Plugin

The time tracker plugin provides tools for tracking tasks, entries, and timers. It stores data in
SQLite under `data/plugins/time-tracker/default/time-tracker.db` for the default instance, with
additional instances stored under `data/plugins/time-tracker/<instanceId>/time-tracker.db`. The
active timer is persisted server-side across reloads. Most operations accept an optional
`instance_id` argument.

| Tool                         | Description                           |
| ---------------------------- | ------------------------------------- |
| `time_tracker_instance_list` | List configured instances             |
| `time_tracker_task_create`   | Create a task                         |
| `time_tracker_task_list`     | List or search tasks                  |
| `time_tracker_task_get`      | Get a task by id                      |
| `time_tracker_task_update`   | Update a task                         |
| `time_tracker_task_delete`   | Delete a task and its entries         |
| `time_tracker_entry_create`  | Create a time entry                   |
| `time_tracker_entry_list`    | List entries by range or task         |
| `time_tracker_entry_get`     | Get a time entry by id                |
| `time_tracker_entry_update`  | Update a time entry                   |
| `time_tracker_entry_delete`  | Delete a time entry                   |
| `time_tracker_timer_start`   | Start the active timer                |
| `time_tracker_timer_status`  | Get the active timer                  |
| `time_tracker_timer_stop`    | Stop the timer and create an entry    |
| `time_tracker_timer_discard` | Discard the active timer              |
| `time_tracker_set_filter`    | Set the time-tracker panel date range |

### Session Info Plugin

The session info plugin exposes a debug panel plus tools for writing a session-scoped label. The
label is stored under `sessionInfo.label` in session attributes and broadcast to connected clients.

| Tool                     | Description                                   |
| ------------------------ | --------------------------------------------- |
| `session_info_label_set` | Set the label shown in the Session Info panel |
| `session_info_label_get` | Read the current Session Info panel label     |

### Coding Plugin

The coding plugin provides tools for working with a session-scoped workspace on disk:

| Tool    | Description                                                                                                     |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| `bash`  | Execute a bash command in the workspace and stream combined stdout and stderr.                                  |
| `read`  | Read the contents of a file in the workspace, with truncation applied for large files.                          |
| `write` | Write content to a file in the workspace, creating parent directories if needed and overwriting existing files. |
| `edit`  | Edit a file by replacing an exact text match; the old text must be unique within the file.                      |
| `ls`    | List directory contents (including dotfiles), sorted alphabetically, with a “/” suffix for directories.         |

`ls` parameters:

- `path` (optional): Directory to list. Defaults to the workspace root for the current session.
- `limit` (optional): Maximum number of entries to return. Defaults to `500`. Output is truncated to approximately 50KB.

### Files Plugin

The files plugin provides a read-only file browser panel (`files`) for a configured workspace root.

**Configuration:**

```jsonc
{
  "plugins": {
    "files": { "enabled": true, "workspaceRoot": "/path/to/workspace" },
  },
}
```

`workspaceRoot` must be an absolute path.

**Operations (HTTP):**

- `POST /api/plugins/files/operations/workspace-list`
  - Body: `{ path?: string }`
  - Response: `{ root, rootName, rootIsRepo, path, entries, truncated }`
- `POST /api/plugins/files/operations/workspace-read`
  - Body: `{ path: string }`
  - Response: `{ path, content, truncated, binary }`

All file paths are resolved within `workspaceRoot`; traversal outside the root is rejected.

### Diff Plugin

The diff plugin provides a git diff panel (`diff`) for repositories within a configured workspace root. It requires `git` on the server and a valid repository under `plugins.diff.workspaceRoot`.

**Configuration:**

```jsonc
{
  "plugins": {
    "diff": { "enabled": true, "workspaceRoot": "/path/to/workspace" },
  },
}
```

The diff plugin supports instances; object entries can override the base config:

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

**Operations (HTTP):**

- `POST /api/plugins/diff/operations/instance_list`
- `POST /api/plugins/diff/operations/status`
- `POST /api/plugins/diff/operations/workspace-repos`
- `POST /api/plugins/diff/operations/patch`
- `POST /api/plugins/diff/operations/hunk`
- `POST /api/plugins/diff/operations/show`
- `POST /api/plugins/diff/operations/comments-list`
- `POST /api/plugins/diff/operations/comment-add`
- `POST /api/plugins/diff/operations/comment-update`
- `POST /api/plugins/diff/operations/comment-delete`
- `POST /api/plugins/diff/operations/stage`
- `POST /api/plugins/diff/operations/unstage`

Operations accept an optional `instance_id` (defaults to `default`) to target a specific instance.
Use `repoPath` to point to a directory or file inside a nested repository within the workspace root.

Diff review comments are stored per instance under `data/plugins/diff/<instance>/diff-comments.json`,
keyed by repository root and branch. Diff operations return an error for repositories in detached
HEAD state.

**Panel events:**

Panel events are emitted as `panel_event` messages:

- `panel_update` with `status_changed`, `status_error`, or comment updates.
- `diff_show` to focus a diff panel on a file/hunk.
- `diff_hunks_snapshot`, `diff_hunk_selected`, `diff_hunk_cleared` for selection state.
- `diff_watch_register`, `diff_watch_ping`, `diff_watch_unregister` for auto-refresh.

### Terminal Plugin

The terminal plugin provides a PTY-backed panel (`terminal`) for interactive shells and exposes tools for reading and writing terminal content. Source lives under `packages/plugins/official/terminal/`.

**Configuration:**

```jsonc
{
  "plugins": {
    "terminal": {
      "enabled": true,
      "shell": "/bin/bash",
      "debug": false,
    },
  },
}
```

**Operations (HTTP):**

- `POST /api/plugins/terminal/operations/write`
- `POST /api/plugins/terminal/operations/read-screen`

**Tools:**

| Tool                   | Description                                                                  |
| ---------------------- | ---------------------------------------------------------------------------- |
| `terminal_write`       | Write text to a terminal panel PTY (optionally target a specific `panelId`). |
| `terminal_read_screen` | Capture the visible terminal screen from a client panel (requires a client). |

`terminal_read_screen` requires at least one connected client with the target panel open.

### URL Fetch Plugin

The url-fetch plugin retrieves content from external URLs and can extract readable text or metadata.

**Configuration:**

```jsonc
{
  "plugins": {
    "url-fetch": { "enabled": true },
  },
}
```

**Operations (HTTP):**

- `POST /api/plugins/url-fetch/operations/fetch`

**Tools:**

| Tool              | Description                                                       |
| ----------------- | ----------------------------------------------------------------- |
| `url_fetch_fetch` | Fetch content from a URL (modes: `extracted`, `raw`, `metadata`). |

**Parameters:**

- `url` (string, required): URL to fetch.
- `mode` (string, optional): `extracted` (default), `raw`, or `metadata`.

### Links Plugin

The links plugin provides tools for opening URLs on connected clients (web, Android, or Capacitor mobile builds). Source lives under `packages/plugins/official/links/`.

**Operations (HTTP):**

- `POST /api/plugins/links/operations/open`

| Tool         | Description                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------- |
| `links_open` | Open a URL on the active client. Optionally rewrites Spotify web URLs to the `spotify:` URI scheme. |

#### `links_open`

Open a URL via a server broadcast so that clients can handle links using their native capabilities (for example, external browser or installed apps).

When invoked, the server sends an `open_url` message to subscribed clients for the current session:

```json
{
  "type": "open_url",
  "sessionId": "session-123",
  "url": "https://example.com"
}
```

On web, the client uses `window.open` (or the Capacitor Browser plugin when available) to open the URL. On Android, the native app uses an `ACTION_VIEW` intent to delegate to the appropriate application.

Spotify web URLs from `open.spotify.com` can be rewritten to the native `spotify:` URI scheme (for example, `https://open.spotify.com/track/123` → `spotify:track:123`) using plugin configuration.

**Parameters:**

- `url` (string, required): URL to open on the client.
- `raw` (boolean, optional): When `true`, disables URL rewriting and opens the URL exactly as provided. Defaults to `false`.

**Result shape:**

```jsonc
{
  "url": "spotify:track:12345", // final URL after any rewriting
}
```

**Configuration:**

The links plugin is configured under `plugins.links` in `config.json`:

```jsonc
{
  "plugins": {
    "links": {
      "enabled": true,
      "spotify": {
        "rewriteWebUrlsToUris": true,
      },
    },
  },
}
```

- `spotify.rewriteWebUrlsToUris` (boolean, optional, default `true`): When `true`, rewrites supported `open.spotify.com` URLs to `spotify:` URIs before broadcasting. When `false`, URLs are broadcast unchanged (unless `raw: true` is set per call).

## Configuration

External MCP servers are configured via the agent server `config.json` file using the `mcpServers` section. See `src/config.ts` and the root `data/config.example.json` for examples.

### Session Cache Configuration

The in-memory session cache used by `SessionHub` can be configured under the `sessions` section of `config.json`:

```jsonc
{
  "sessions": {
    // Maximum number of sessions to keep cached in memory at once.
    // Least-recently-used sessions are evicted first.
    // Sessions with active chat runs or connected clients are never evicted.
    "maxCached": 100,
  },
}
```

When `sessions.maxCached` is omitted, the server defaults to caching up to `100` sessions in memory.

### Agents Configuration

Agents are configured in `config.json` under `agents`. Each agent supports:

- `agentId`, `displayName`, `description`, optional `systemPrompt`
- `type` (default `"chat"`) to select agent runtime
  - `"chat"`: in-process chat completions (default behavior)
  - `"external"`: forwards user messages to `external.inputUrl` and accepts assistant messages via callback
  - `chat` (only for `type: "chat"` or when `type` is omitted)
  - `provider` (default `"openai"`): `"openai"`, `"claude-cli"`, `"codex-cli"`, `"pi-cli"`, or `"openai-compatible"`
  - `models` (optional array): allowed model ids for `"openai"` and CLI providers; first is default. For `"pi-cli"`, entries may be `provider/model` and are split into `--provider` + `--model`.
  - `thinking` (optional array): allowed thinking levels for `"pi-cli"` and `"codex-cli"`; first is default (Codex maps to `model_reasoning_effort`)
  - `config`:
    - for `provider: "claude-cli"`:
      - `workdir` (optional): working directory for the Claude CLI
      - `extraArgs` (optional array): additional CLI args (reserved flags are managed by the server and must not be included: `--output-format`, `--session-id`, `--resume`, `-p`, `--include-partial-messages`, `--verbose`)
    - for `provider: "codex-cli"`:
      - `workdir` (optional): working directory for the Codex CLI
      - `extraArgs` (optional array): additional CLI args (reserved flags are managed by the server and must not be included: `--json`, `resume`)
    - for `provider: "pi-cli"`:
      - `workdir` (optional): working directory for the Pi CLI
      - `extraArgs` (optional array): additional CLI args (reserved flags are managed by the server and must not be included: `--mode`, `--session`, `--session-dir`, `--continue`, `-p`; when `chat.models` is set, `--model` and `--provider` are also managed by the server; when `chat.thinking` is set, `--thinking` is also managed by the server)
    - for `provider: "openai-compatible"` (OpenAI-compatible HTTP APIs such as llama.cpp, vLLM, Ollama, Together, Groq, etc.):
      - `baseUrl` (required): base URL for the API, for example `http://localhost:8080/v1`
      - `apiKey` (optional): API key for the backend; if the value contains `${VARNAME}`, it will be substituted from `process.env.VARNAME`
      - `model` (required): model name to use for chat completions
      - `maxTokens` (optional): positive integer `max_tokens` limit for completions
      - `temperature` (optional): temperature to use for generation
      - `headers` (optional): object with custom HTTP headers to send with each request, for example `{"X-Custom-Auth": "token123"}`
  - For CLI providers (`"claude-cli"`, `"codex-cli"`, `"pi-cli"`), the agent server starts each CLI in its own POSIX process group and, on user cancel, sends a `SIGTERM` followed by a `SIGKILL` to that group. This ensures any subprocesses launched by the CLI (for example `bash` commands) are cleaned up when a chat run is aborted.
  - When `chat.models` is set for a CLI provider, `--model` is managed by the server and must not be included in `extraArgs`. For `"pi-cli"`, `--provider` is also managed by the server when `chat.models` is set, and `--thinking` is managed by the server when `chat.thinking` is set. For `"codex-cli"`, `model_reasoning_effort` is managed by the server when `chat.thinking` is set.
- `external` (only for `type: "external"`)
  - `inputUrl`: outbound HTTP endpoint that receives user input payloads
  - `callbackBaseUrl`: base URL for computing `callbackUrl` (path prefix allowed)
- `toolAllowlist` / `toolDenylist` glob patterns for tool scoping
- `toolExposure` (default `"tools"`): `"tools"`, `"skills"`, or `"mixed"`
  - `"tools"` exposes plugin operations as normal model tool calls
  - `"skills"` hides plugin tools and lists CLI skills instead (run via `bash`)
  - `"mixed"` exposes both; use `skillAllowlist` to choose which plugins are CLI-only
- `skillAllowlist` / `skillDenylist` glob patterns for plugin skills (matches plugin ids)
- `capabilityAllowlist` / `capabilityDenylist` glob patterns for tool capability scoping
- `agentAllowlist` / `agentDenylist` glob patterns controlling which other agents are visible/reachable from this agent (UI + `agents_*` tools)
- `uiVisible` (default true) to hide from built-in clients when false
- `apiExposed` (legacy, default false) previously opted into agent-specific HTTP tool endpoints; currently unused

Example:

```json
{
  "agents": [
    {
      "agentId": "reading-list",
      "displayName": "Reading List Manager",
      "description": "Manages reading lists.",
      "toolAllowlist": ["lists_*"],
      "toolDenylist": ["lists_delete"],
      "toolExposure": "mixed",
      "skillAllowlist": ["notes"],
      "capabilityAllowlist": ["lists.*"],
      "capabilityDenylist": ["lists.write"],
      "agentAllowlist": ["todo", "journal"]
    },
    {
      "agentId": "local-llama",
      "displayName": "Local LLaMA",
      "description": "Local LLaMA via an OpenAI-compatible endpoint.",
      "type": "chat",
      "chat": {
        "provider": "openai-compatible",
        "config": {
          "baseUrl": "http://localhost:8080/v1",
          "apiKey": "${LOCAL_LLM_KEY}",
          "model": "llama-3.1-70b",
          "maxTokens": 4096,
          "temperature": 0.7
        }
      }
    },
    {
      "agentId": "external-a",
      "displayName": "External Agent A",
      "description": "Async external agent via inputUrl",
      "type": "external",
      "external": {
        "inputUrl": "http://external.internal/v1/assistant/input",
        "callbackBaseUrl": "http://agent-server.internal"
      }
    },
    {
      "agentId": "claude-cli",
      "displayName": "Claude Code",
      "description": "Claude Code CLI agent.",
      "type": "chat",
      "chat": {
        "provider": "claude-cli",
        "config": {
          "workdir": "/path/to/workspace",
          "extraArgs": ["--model", "sonnet", "--dangerously-skip-permissions"]
        }
      }
    }
  ]
}
```

### External Agents: curl examples

The agent server forwards user messages to `external.inputUrl` as JSON (timeout 5s, no retries). Your external service/shim should expect a payload like:

```json
{
  "sessionId": "EXTERNAL-123",
  "agentId": "external-a",
  "callbackUrl": "http://agent-server.internal/external/sessions/EXTERNAL-123/messages",
  "message": {
    "type": "user",
    "text": "hello",
    "createdAt": "2025-12-12T00:00:00.000Z"
  }
}
```

To send an assistant reply back into a session, `POST` raw text (Markdown allowed) to the callback endpoint:

```bash
curl -sS -X POST \
  --data-binary @- \
  "http://agent-server.internal/external/sessions/EXTERNAL-123/messages" <<'MSG'
Here is a *Markdown* reply.

- One
- Two
MSG
```
