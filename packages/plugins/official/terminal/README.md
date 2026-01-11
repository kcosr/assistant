# Terminal Plugin

The terminal plugin provides PTY-backed terminal panels.
Each panel instance maps to a PTY keyed by its scope (`sessionId` or connection id) plus `panelId`
and streams input/output over `panel_event` WebSocket messages.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Panel Type](#panel-type)
- [Operations (HTTP)](#operations-http)
- [Tools](#tools)
- [WebSocket Payloads](#websocket-payloads)
- [Lifecycle](#lifecycle)

## Configuration

Enable the plugin in `config.json`:

```json
{
  "plugins": {
    "terminal": { "enabled": true }
  }
}
```

Optional settings:

- `plugins.terminal.shell` (string): override the shell executable (defaults to `$SHELL` or `bash`).
- `plugins.terminal.debug` (boolean): enable debug logging for panel events and PTY lifecycle.

## Source files

- `packages/plugins/official/terminal/manifest.json`
- `packages/plugins/official/terminal/server/index.ts`
- `packages/plugins/official/terminal/web/index.ts`

## Panel Type

- Panel type: `terminal`
- Capabilities: `terminal.exec`
- Default binding: `fixed` (session binding is optional; unbound panels are connection-scoped)

## Operations (HTTP)

- `POST /api/plugins/terminal/operations/write`
- `POST /api/plugins/terminal/operations/read-screen`

## Tools

The terminal plugin exposes two tools for agent-controlled terminal access:

- `terminal_write`: Write text to the terminal PTY.
  - Args: `text` (string, required), `panelId` (string, optional).
- `terminal_read_screen`: Read the visible terminal screen from the client panel.
  - Args: `panelId` (string, optional), `timeoutMs` (number, optional).
  - Requires a connected client with the target panel open; otherwise the request will time out.
  - If the panel is unbound, provide `panelId` to target the connection-scoped terminal.

## WebSocket Payloads

Client to server:

- `terminal_input` `{ text: string }` - data typed by the user.
- `terminal_resize` `{ cols: number, rows: number }` - terminal resize event.
- `terminal_snapshot_response` `{ requestId: string, snapshot: TerminalSnapshot }` - response to a snapshot request.
- `terminal_snapshot_error` `{ requestId: string, message: string }` - snapshot failure response.

Server to client:

- `terminal_output` `{ data: string }` - data emitted by the PTY.
- `terminal_status` `{ state: 'ready' | 'closed' | 'error', ... }`
  - `ready`: PTY started.
  - `closed`: PTY exited (`exitCode`/`signal` may be included).
  - `error`: startup failure with a message.
- `terminal_snapshot_request` `{ requestId: string }` - request the panel to capture a screen snapshot.

## Lifecycle

- PTY starts on `panel_lifecycle: opened`.
- PTY stops on `panel_lifecycle: closed` or `session_deleted`.
