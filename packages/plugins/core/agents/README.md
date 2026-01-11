# Agents Plugin

Core plugin providing agent discovery and cross-agent messaging.

## Table of Contents

- [Configuration](#configuration)
- [Source files](#source-files)
- [Operations](#operations)
- [Tools](#tools)
- [Usage](#usage)

## Configuration

Enable the plugin in `config.json`:

```json
{
  "plugins": {
    "agents": { "enabled": true }
  }
}
```

## Source files

- `packages/plugins/core/agents/manifest.json`
- `packages/plugins/core/agents/server/index.ts`

## Operations

### `agents_list`

List available agents for delegation or messaging.

**Parameters:**

- `includeAll` (boolean, optional): When true, return all visible agents (ignores allowlist/denylist filtering).

**HTTP:** `POST /api/plugins/agents/operations/list`

### `agents_message`

Send a message to another agent (sync or async) without switching sessions.

**Parameters:**

- `agentId` (string, required): ID of the target agent to message.
- `content` (string, required): Message content to send to the target agent.
- `session` (string, optional): Session resolution strategy:
  - `"latest"` - Use the agent's most recent session
  - `"create"` - Always create a new session
  - `"latest-or-create"` (default) - Use latest session or create if none exists
  - `<session-id>` - Use an explicit session ID
- `mode` (string, optional): `"sync"` to wait for a response, `"async"` to return immediately.
- `timeout` (number, optional): Timeout in seconds for sync mode (default: 300).

**HTTP:** `POST /api/plugins/agents/operations/message`

## Tools

| Tool             | Description                                      |
| ---------------- | ------------------------------------------------ |
| `agents_list`    | List available agents for delegation or messaging |
| `agents_message` | Send a message to another agent                  |

## Usage

### Listing agents

```bash
# CLI
./agents-cli list

# HTTP
curl -X POST http://localhost:3000/api/plugins/agents/operations/list \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Sending a message to another agent

```bash
# CLI (sync)
./agents-cli message --agentId notes --content "Create a note about project status"

# CLI (async)
./agents-cli message --agentId notes --content "Create a note" --mode async

# HTTP
curl -X POST http://localhost:3000/api/plugins/agents/operations/message \
  -H "Content-Type: application/json" \
  -d '{"agentId": "notes", "content": "Create a note about project status"}'
```
