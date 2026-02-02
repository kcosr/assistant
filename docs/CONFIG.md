# config.json Reference

This document describes the application configuration file used by the agent server. It is based on the runtime schema in `packages/agent-server/src/config.ts` and the example at `data/config.example.json`.

## Table of Contents

- [Source files](#source-files)
- [Environment variables](#environment-variables)
  - [Provider API keys (Pi SDK)](#provider-api-keys-pi-sdk)
  - [Server](#server)
  - [TTS](#tts)
  - [ElevenLabs TTS](#elevenlabs-tts)
  - [MCP Tools](#mcp-tools)
  - [Rate Limits](#rate-limits)
  - [Audio](#audio)
  - [Debug](#debug)
- [Application configuration (config.json)](#application-configuration-configjson)
  - [Location and Loading](#location-and-loading)
  - [Environment Variable Substitution](#environment-variable-substitution)
  - [Top-Level Keys](#top-level-keys)
  - [Agents](#agents)
- [Security Notes](#security-notes)
- [Full Example](#full-example)

## Source files

- `packages/agent-server/src/config.ts`
- `data/config.example.json`

## Environment variables

### Provider API keys (Pi SDK)

Pi SDK chat uses provider-specific environment variables. Common examples include:

- OpenAI: `OPENAI_API_KEY`
- Anthropic: `ANTHROPIC_OAUTH_TOKEN` (preferred) or `ANTHROPIC_API_KEY`
- Google Gemini: `GEMINI_API_KEY`
- Groq: `GROQ_API_KEY`
- Mistral: `MISTRAL_API_KEY`
- OpenRouter: `OPENROUTER_API_KEY`
- XAI: `XAI_API_KEY`
- Cerebras: `CEREBRAS_API_KEY`
- Minimax: `MINIMAX_API_KEY`
- Minimax (CN): `MINIMAX_CN_API_KEY`
- ZAI: `ZAI_API_KEY`
- Vercel AI Gateway: `AI_GATEWAY_API_KEY`
- OpenCode: `OPENCODE_API_KEY`
- Azure OpenAI: `AZURE_OPENAI_API_KEY` (with `AZURE_OPENAI_BASE_URL`/`AZURE_OPENAI_RESOURCE_NAME`)

The assistant does not resolve these itself; it passes requests to the Pi SDK, which
reads the provider environment variables directly. For a complete list, see the
`@mariozechner/pi-ai` README.

### Server

| Variable          | Default  | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `PORT`            | `3000`   | HTTP/WebSocket server port                  |
| `DATA_DIR`        | `./data` | Directory for session data (event logs, preferences, plugin settings) |
| `APP_CONFIG_PATH` | -        | Override config file location               |

### TTS

| Variable             | Default           | Description                           |
| -------------------- | ----------------- | ------------------------------------- |
| `TTS_BACKEND`        | `openai`          | TTS backend: `openai` or `elevenlabs` |
| `OPENAI_TTS_MODEL`   | `gpt-4o-mini-tts` | OpenAI TTS model                      |
| `TTS_VOICE`          | `alloy`           | Voice name for TTS output             |
| `TTS_FRAME_DURATION_MS` | `250`         | PCM frame duration for TTS output; larger values reduce client scheduling overhead |
| `AUDIO_OUTPUT_SPEED` | -                 | Playback speed multiplier (e.g., `1.2`) |

OpenAI TTS requires `OPENAI_API_KEY`.

### ElevenLabs TTS

Used when `TTS_BACKEND=elevenlabs`.

| Variable                  | Default                     | Description                    |
| ------------------------- | --------------------------- | ------------------------------ |
| `ELEVENLABS_API_KEY`      | -                           | ElevenLabs API key (required)  |
| `ELEVENLABS_TTS_VOICE_ID` | -                           | ElevenLabs voice ID (required) |
| `ELEVENLABS_TTS_MODEL`    | `eleven_multilingual_v2`    | ElevenLabs model ID            |
| `ELEVENLABS_TTS_BASE_URL` | `https://api.elevenlabs.io` | API base URL                   |

### MCP Tools

| Variable            | Default | Description                                                                  |
| ------------------- | ------- | ---------------------------------------------------------------------------- |
| `MCP_TOOLS_ENABLED` | auto    | Explicit enable/disable for external MCP servers (`true`/`1` or `false`/`0`) |

External MCP servers are configured in `config.json` under `mcpServers`.

### Rate Limits

Per session, 1-minute sliding window.

| Variable                     | Default   | Description                    |
| ---------------------------- | --------- | ------------------------------ |
| `MAX_MESSAGES_PER_MINUTE`    | `60`      | Max client messages per minute |
| `MAX_AUDIO_BYTES_PER_MINUTE` | `2000000` | Max audio bytes per minute     |
| `MAX_TOOL_CALLS_PER_MINUTE`  | `30`      | Max tool calls per minute      |

### Audio

| Variable                      | Default  | Description                          |
| ----------------------------- | -------- | ------------------------------------ |
| `AUDIO_SAMPLE_RATE`           | `24000`  | Audio sample rate in Hz              |
| `AUDIO_INPUT_MODE`            | `manual` | Input mode: `server_vad` or `manual` |
| `AUDIO_TRANSCRIPTION_ENABLED` | `false`  | Forward transcription events to client |

### Debug

| Variable                 | Default | Description                            |
| ------------------------ | ------- | -------------------------------------- |
| `DEBUG_CHAT_COMPLETIONS` | `false` | Log Pi SDK request/response payloads (tools included, auth redacted) |
| `DEBUG_HTTP_REQUESTS`    | `false` | Log HTTP request details               |

## Application configuration (config.json)

### Location and Loading

The agent server loads configuration from:

- `${DATA_DIR}/config.json` by default
- `APP_CONFIG_PATH` when set (absolute or relative path)

Environment defaults such as `DATA_DIR` are described above.

### Environment Variable Substitution

`config.json` supports `${VARNAME}` substitution in all string values. This is useful for:

- Paths that depend on home directory: `"workspaceRoot": "${HOME}/workspaces"`
- API keys and secrets: `"apiKey": "${LOCAL_LLM_KEY}"`
- Runtime-specific paths: `"socketPath": "${XDG_RUNTIME_DIR}/podman/podman.sock"`

If the environment variable is missing, the placeholder is replaced with an empty string.

Examples:

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "local": {
        "workspaceRoot": "${HOME}/coding-workspaces"
      }
    }
  },
  "agents": [
    {
      "agentId": "claude-cli",
      "displayName": "Claude",
      "description": "Claude via CLI",
      "chat": {
        "provider": "claude-cli",
        "config": {
          "workdir": "${HOME}/projects",
          "wrapper": {
            "path": "${HOME}/bin/claude-wrapper.sh"
          }
        }
      }
    }
  ],
  "mcpServers": [
    {
      "command": "${HOME}/bin/mcp-server",
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  ]
}
```

### Top-Level Keys

| Key | Type | Description |
| --- | ---- | ----------- |
| `sessions` | object | Session cache settings. |
| `agents` | array | Agent persona definitions and chat provider config. |
| `profiles` | array | Shared profile (instance) definitions for cross-plugin scoping. |
| `plugins` | object | Plugin enablement and per-plugin config. |
| `mcpServers` | array | External MCP servers launched over stdio. |

#### `sessions`

Controls session cache behavior.

```json
{ "sessions": { "maxCached": 100, "mirrorPiSessionHistory": true } }
```

- `maxCached`: maximum number of sessions cached in memory
- `mirrorPiSessionHistory`: when `true`, Pi SDK sessions are mirrored to Pi JSONL history
  files for pi-mono CLI resume (default: `true`)

#### `agents`

Defines agent personas and chat providers.

```json
{
  "agents": [
    {
      "agentId": "general",
      "displayName": "General Assistant",
      "description": "A helpful assistant.",
      "systemPrompt": "You are a helpful assistant.",
      "toolAllowlist": ["*"],
      "chat": {
        "provider": "pi"
      }
    }
  ]
}
```

See the **Agents** section below for the full schema and provider-specific config.

#### `profiles`

Defines shared profile identifiers that can be reused across plugin instances. Instance ids must
match an entry in this list (the built-in `default` profile is always available).

```json
{
  "profiles": [
    { "id": "default", "label": "Global" },
    { "id": "work", "label": "Work" },
    { "id": "personal", "label": "Personal" }
  ]
}
```

Use these ids in plugin instance configuration:

```json
{
  "profiles": [{ "id": "default" }, { "id": "work" }],
  "plugins": {
    "notes": { "enabled": true, "instances": ["default", "work"] }
  }
}
```

#### `plugins`

Enable or configure server plugins.

```json
{
  "plugins": {
    "sessions": { "enabled": true },
    "agents": { "enabled": true },
    "scheduled-sessions": { "enabled": true },
    "lists": { "enabled": true },
    "notes": { "enabled": true },
    "questions": { "enabled": true },
    "url-fetch": { "enabled": true }
  }
}
```

Many plugins accept additional settings. See each plugin README for details.

Plugins that support multiple data instances can also define `instances`:

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

- Instance entries can be strings or objects. Object entries may include `label` and plugin-specific
  overrides (either inline or under `config`):

```json
{
  "plugins": {
    "diff": {
      "enabled": true,
      "workspaceRoot": "/path/to/workspace",
      "instances": [
        "work",
        { "id": "oss", "label": "Open Source", "workspaceRoot": "/path/to/oss" },
        { "id": "client", "config": { "workspaceRoot": "/path/to/client" } }
      ]
    }
  }
}
```

- Instance ids are lowercased slugs (`[a-z0-9_-]`).
- The default instance id is always `default` and cannot be renamed or removed.

Plugins can opt into automatic git snapshots of their data directories using `gitVersioning`:

```json
{
  "plugins": {
    "notes": {
      "enabled": true,
      "gitVersioning": {
        "enabled": true,
        "intervalMinutes": 5
      }
    }
  }
}
```

- One git repository is created per plugin instance directory.
- Snapshots are committed on the configured interval and use a local "AI Assistant" git author.
- Requires `git` available on the server `PATH`.

##### Execution Mode (Coding Plugins)

Plugins that execute code (like the coding/terminal plugin) can run in `local` or `container` mode:

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "mode": "container",
      "local": {
        "workspaceRoot": "/path/to/workspaces",
        "sharedWorkspace": false
      },
      "container": {
        "runtime": "docker",
        "image": "assistant-sandbox:latest",
        "socketPath": "/var/run/docker.sock",
        "workspaceVolume": "assistant-workspaces",
        "sharedWorkspace": false,
        "resources": {
          "memory": "4g",
          "cpus": 2
        }
      }
    }
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `mode` | string | Execution mode: `local` or `container`. |
| `local.workspaceRoot` | string | Root directory for local workspaces. |
| `local.sharedWorkspace` | boolean | If `true`, all sessions share one workspace. |
| `container.runtime` | string | Container runtime: `docker` or `podman`. |
| `container.image` | string | Container image to use. |
| `container.socketPath` | string | Path to container runtime socket. |
| `container.socketDir` | string | Directory for container communication sockets. |
| `container.workspaceVolume` | string | Named volume for persistent workspaces. |
| `container.sharedWorkspace` | boolean | If `true`, all sessions share one workspace. |
| `container.resources.memory` | string | Memory limit (e.g., `4g`). |
| `container.resources.cpus` | number | CPU limit. |

##### Agents plugin tools (when enabled)

Agent coordination is provided by the `agents` plugin. Enable it in `config.json` and use the generated tools:

| Tool | Description |
| --- | --- |
| `agents_message` | Send a message to another agent (sync or async) without switching sessions. |
| `agents_list` | List configured agents for delegation or messaging. |

Terminology: users may say "agent" to refer to a configured assistant persona (for example, "journal agent" or "todo agent").

#### `mcpServers`

Defines external MCP tool servers (Model Context Protocol) launched over stdio.

```json
{
  "mcpServers": [
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  ]
}
```

- `name`: optional display name
- `command`: executable to launch
- `args`: optional arguments list
- `env`: optional environment map (supports `${ENV}` substitution)

### Agents

#### Common Fields

```json
{
  "agentId": "notes",
  "displayName": "Notes",
  "description": "Manages notes.",
  "systemPrompt": "You are a notes assistant.",
  "type": "chat",
  "toolAllowlist": ["notes_*"],
  "toolDenylist": [],
  "toolExposure": "skills",
  "skillAllowlist": ["notes"],
  "capabilityAllowlist": ["*"],
  "agentAllowlist": ["*"],
  "uiVisible": true,
  "apiExposed": false
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `agentId` | string | Unique id (used by tools and session routing). |
| `displayName` | string | UI label. |
| `description` | string | UI description and prompt context. |
| `type` | string | Agent type: `chat` (default) or `external`. |
| `systemPrompt` | string | Optional custom prompt. |
| `toolAllowlist` | array | Glob patterns for tool access. |
| `toolDenylist` | array | Glob patterns for tool denylist. |
| `toolExposure` | string | `tools`, `skills`, or `mixed`. |
| `skillAllowlist` | array | Plugin ids exposed as CLI skills. |
| `skillDenylist` | array | Plugin ids blocked from skill exposure. |
| `capabilityAllowlist` | array | Glob patterns for capability access. |
| `capabilityDenylist` | array | Glob patterns for capability denylist. |
| `agentAllowlist` | array | Glob patterns for agents this agent can delegate to. |
| `agentDenylist` | array | Glob patterns for agents blocked from delegation. |
| `uiVisible` | boolean | Hide from built-in UI if `false`. |
| `apiExposed` | boolean | Reserved for external API tools (currently unused). |
| `schedules` | array | Optional scheduled session definitions (CLI providers only). |

#### External Agents

When `type` is `external`, the agent forwards messages to an external HTTP endpoint instead of
using a local chat provider. This is useful for integrating with external AI services or
custom agent implementations.

```json
{
  "agentId": "external-example",
  "displayName": "External Agent",
  "description": "An external agent implementation.",
  "type": "external",
  "external": {
    "inputUrl": "http://external.internal/v1/assistant/input",
    "callbackBaseUrl": "http://agent-server.internal"
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `external.inputUrl` | string | URL where messages are POSTed to the external agent. |
| `external.callbackBaseUrl` | string | Base URL the external agent uses to call back with responses. |

External agents receive messages via POST and respond asynchronously via callbacks. See
`docs/design/external-agents.md` for the full protocol specification.

#### `chat` Provider Selection

```json
{
  "chat": {
    "provider": "claude-cli",
    "config": {
      "workdir": "/path/to/workspace",
      "extraArgs": ["--model", "sonnet"]
    }
  }
}
```

Supported providers:

- `pi` (default)
- `claude-cli`
- `codex-cli`
- `pi-cli`

| Provider | CLI Tool | Description |
| --- | --- | --- |
| `pi` | - | Pi SDK in-process chat (upstream providers configured via Pi). |
| `claude-cli` | `claude` | Anthropic Claude CLI with tool use. |
| `codex-cli` | `codex` | OpenAI Codex CLI with file editing and shell. |
| `pi-cli` | `pi` | Pi CLI agent. |

#### CLI provider example

```json
{
  "agents": [
    {
      "agentId": "claude-cli",
      "displayName": "Claude",
      "description": "Claude via CLI",
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

#### Scheduled sessions

Scheduled sessions run cron-driven CLI sessions. They only work with CLI providers
(`claude-cli`, `codex-cli`, `pi-cli`).

```json
{
  "agents": [
    {
      "agentId": "repo-maintainer",
      "displayName": "Repo Maintainer",
      "chat": {
        "provider": "codex-cli",
        "config": { "workdir": "/path/to/repo" }
      },
      "schedules": [
        {
          "id": "daily-review",
          "cron": "0 9 * * *",
          "sessionTitle": "Daily Repo Review",
          "prompt": "Review open PRs and issues. Summarize status.",
          "enabled": true,
          "maxConcurrent": 1
        },
        {
          "id": "deps-check",
          "cron": "0 * * * *",
          "preCheck": "/path/to/check-outdated-deps.sh",
          "prompt": "The following dependencies are outdated:",
          "enabled": true,
          "maxConcurrent": 1
        }
      ]
    }
  ]
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `id` | string | - | Unique identifier within the agent. |
| `cron` | string | - | 5-field cron expression. Invalid cron values prevent startup. |
| `prompt` | string | - | Optional static prompt text (must be non-empty if provided). |
| `preCheck` | string | - | Optional shell command to run before the session. |
| `sessionTitle` | string | - | Optional static auto title; when omitted a default scheduled name with timestamp is used. |
| `enabled` | boolean | `true` | Whether the schedule is active by default. |
| `maxConcurrent` | number | `1` | Max concurrent runs allowed for the schedule. |

Notes:
- Each schedule must define `prompt`, `preCheck`, or both. If the combined prompt is empty after trimming, the run is skipped.
- `preCheck` runs in the agent `chat.config.workdir` and uses the wrapper environment when configured. Non-zero exit codes skip the run; stdout is appended to `prompt` with a blank line.
- Scheduled runs create or reuse a session tagged `scheduledSession` (`agentId` + `scheduleId`) and update `attributes.core.autoTitle` on every run (using `sessionTitle` or the default timestamped name).
- Manual renames in the UI are preserved; clearing the name falls back to the latest auto title.
- `enabled: false` disables automatic runs; manual runs via the scheduled-sessions plugin/API ignore `enabled` but still respect `maxConcurrent` unless `force` is set.
- Enable the `scheduled-sessions` plugin to view status, toggle schedules, and trigger runs.

#### `pi` Provider

```json
{
  "chat": {
    "provider": "pi",
    "models": ["anthropic/claude-sonnet-4-5", "openai-codex/gpt-5.2-codex"],
    "thinking": ["off", "low", "medium", "high", "xhigh"],
    "config": {
      "provider": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "baseUrl": "https://api.anthropic.com",
      "maxTokens": 4096,
      "temperature": 0.7,
      "maxToolIterations": 100,
      "headers": {
        "X-Request-Source": "assistant"
      }
    }
  }
}
```

- `models`: optional list of allowed model ids (first is default). Entries may be `provider/model`.
- `thinking`: optional list of allowed thinking levels (first is default). Selected level is passed
  to the Pi SDK reasoning option; use `off` to disable reasoning.
- `config.provider`: default provider used when a model omits a prefix (required if any model omits a prefix).
- `config.apiKey`, `config.baseUrl`, `config.headers`: optional connection overrides applied when
  the resolved provider matches `config.provider`.
- `config.maxTokens`, `config.temperature`, `config.timeoutMs`: optional Pi SDK request overrides.
- `config.maxToolIterations`: max consecutive tool iterations before aborting with an error
  (default: 100).

Pi SDK sessions are mirrored to the Pi JSONL format so they can be resumed by the
pi-mono CLI. Sessions are written to:
`~/.pi/agent/sessions/<encoded-cwd>/*_<pi-session-id>.jsonl`.
The `cwd` comes from `attributes.core.workingDir` when available (otherwise the
server working directory).
Canceled runs still write partial assistant/tool entries so the pi-mono CLI can resume.
Disable mirroring by setting `sessions.mirrorPiSessionHistory` to `false`.

#### CLI Providers (`claude-cli`, `codex-cli`, `pi-cli`)

All CLI providers share the same config shape:

```json
{
  "chat": {
    "provider": "pi-cli",
    "models": ["anthropic/claude-sonnet-4-5", "openai-codex/gpt-5.2-codex"],
    "thinking": ["off", "low", "medium", "high", "xhigh"],
    "config": {
      "wrapper": {
        "path": "/home/kevin/devtools/container/run.sh",
        "env": {
          "PERSISTENT": "1",
          "PROXY": "1",
          "CONTAINER_NAME": "assistant"
        }
      }
    }
  }
}
```

- `models`: optional list of allowed model ids for CLI providers (first is default). For `pi-cli`, entries may be `provider/model` and are split into `--provider` + `--model`. When set, do not include `--model` in `extraArgs` (and for `pi-cli`, do not include `--provider`).
- `thinking`: optional list of allowed thinking levels for `pi-cli` and `codex-cli` (first is default). For `codex-cli`, the selected level maps to `--config model_reasoning_effort=<level>`. When set, do not include `--thinking` in `extraArgs` (pi) or `model_reasoning_effort` overrides in `extraArgs` (codex).
- `workdir`: optional working directory for the CLI process
- `extraArgs`: optional extra CLI flags (reserved flags are managed by the server)
- `wrapper.path`: optional wrapper executable used to run the CLI (for containerized runs)
- `wrapper.env`: optional environment map for the wrapper (supports `${ENV}` substitution)

For `pi-cli`, history is read from the default Pi sessions directory:
`~/.pi/agent/sessions/<encoded-cwd>/*_<pi-session-id>.jsonl`. The `cwd` comes from the Pi
session header, so set `workdir` if you need a stable path across runs. No extra config
is required.

For `claude-cli`, history is read from the default Claude projects directory:
`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`. The CLI defaults to the user home
directory when `workdir` is not set, so history typically lands under
`~/.claude/projects/-home-<user>`. Set `workdir` if you need Claude history under a
different path. No extra config is required.

For `codex-cli`, history is read from the default Codex sessions directory:
`~/.codex/sessions/<yyyy>/<mm>/<dd>/...-<codex-session-id>.jsonl`. The session id is
emitted by the CLI and tracked automatically; no extra config is required.

Reserved flags (must not be in `extraArgs`):

- `claude-cli`: `--output-format`, `--session-id`, `--resume`, `-p`, `--include-partial-messages`, `--verbose`
- `codex-cli`: `--json`, `resume`
- `pi-cli`: `--mode`, `--session`, `--session-dir`, `--continue`, `-p`

When `chat.models` is set for a CLI provider, `--model` is managed by the server and must not be included in `extraArgs`. For `pi-cli`, `--provider` is also managed by the server when `chat.models` is set, and `--thinking` is managed by the server when `chat.thinking` is set. For `codex-cli`, `model_reasoning_effort` is managed by the server when `chat.thinking` is set.

## Security Notes

- Store API keys in environment variables or a secure secrets manager; avoid committing them to `config.json`.
- Limit `wrapper.path` usage to trusted scripts or containers because the wrapper runs as the server user.
- MCP server commands run as the server user and inherit `env` settings, so review each command and token scope.

## Full Example

See `data/config.example.json` for a complete working example including plugins and agents.
