# Sessions Plugin

Core plugin providing session lifecycle and messaging operations.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Operations](#operations)
- [Tools](#tools)

## Configuration

Enable the plugin in `config.json`:

```json
{
  "plugins": {
    "sessions": { "enabled": true }
  }
}
```

## Source files

- `packages/plugins/core/sessions/manifest.json`
- `packages/plugins/core/sessions/server/index.ts`

## Operations

### `sessions_list`

List all sessions.

**HTTP:** `POST /api/plugins/sessions/operations/list`

### `sessions_create`

Create a new session for an agent.

**Parameters:**

- `agentId` (string, required): Agent id for the new session.
- `sessionId` (string, optional): Optional session id (required for external agents).
- `sessionConfig` (object, optional): Session configuration constrained by the selected agent.
  - `model` (string, optional): Allowed session model override.
  - `thinking` (string, optional): Allowed thinking override.
  - `workingDir` (string, optional): Absolute working directory for the new session.
  - `skills` (string[], optional): Selected skill ids allowed by the agent.
  - `sessionTitle` (string, optional): Explicit session title for the new session.

**HTTP:** `POST /api/plugins/sessions/operations/create` (returns 201 on success)

### `sessions_update`

Rename, pin, or replace editable session configuration for a session.

**Parameters:**

- `sessionId` (string, required): Session id.
- `name` (string | null, optional): New session name (null clears).
- `pinnedAt` (string | null, optional): Pinned timestamp ISO string (null clears).
- `sessionConfig` (object, optional): Full replacement for editable session config fields.
  - `model` (string, optional): Allowed session model override.
  - `thinking` (string, optional): Allowed thinking override.
  - `workingDir` (string, optional): Absolute working directory for the session.
  - `skills` (string[], optional): Selected skill ids allowed by the agent.
  - `sessionTitle` (string, optional): Explicit session title for the session.

When `sessionConfig` is provided, editable session config fields are replaced from that object:
- omitted `model` / `thinking` clear those overrides back to agent defaults
- omitted `workingDir` / `skills` clear the stored session-scoped values
- omitted `sessionTitle` clears the explicit session name

**HTTP:** `POST /api/plugins/sessions/operations/update`

### `sessions_update-attributes`

Patch session attributes.

**Parameters:**

- `sessionId` (string, required): Session id.
- `patch` (object, optional): Attribute patch object.
- `attributes` (object, optional): Alias for patch.

**HTTP:** `POST /api/plugins/sessions/operations/update-attributes`

### `sessions_events`

Fetch session events (chat history).

**Parameters:**

- `sessionId` (string, required): Session id.
- `after` (string, optional): Optional event id to fetch events after.

**HTTP:** `POST /api/plugins/sessions/operations/events`

### `sessions_message`

Send a message to a session (headless/programmatic usage).

**Parameters:**

- `sessionId` (string, required): Session id.
- `content` (string, required): User message content.
- `mode` (string, optional): `"sync"` or `"async"` (default: async).
- `timeout` (number, optional): Timeout in seconds for sync mode.
- `webhook` (object, optional): Webhook config for async mode.

**HTTP:** `POST /api/plugins/sessions/operations/message`

### `sessions_clear`

Clear session history.

**Parameters:**

- `sessionId` (string, required): Session id.

**HTTP:** `POST /api/plugins/sessions/operations/clear`

### `sessions_delete`

Delete a session.

**Parameters:**

- `sessionId` (string, required): Session id.

**HTTP:** `POST /api/plugins/sessions/operations/delete`

## Tools

| Tool                          | Description                 |
| ----------------------------- | --------------------------- |
| `sessions_list`               | List all sessions           |
| `sessions_create`             | Create a new session        |
| `sessions_update`             | Rename, pin, or update session config |
| `sessions_update-attributes`  | Patch session attributes    |
| `sessions_events`             | Fetch session events        |
| `sessions_message`            | Send a message to a session |
| `sessions_clear`              | Clear session history       |
| `sessions_delete`             | Delete a session            |
