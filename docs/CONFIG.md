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
  - [Codex Threads](#codex-threads)
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
resolves credentials using its auth storage, registry configuration, and provider environment variables. For a complete list, see the
`@earendil-works/pi-ai` README.

### Server

| Variable          | Default  | Description                                                           |
| ----------------- | -------- | --------------------------------------------------------------------- |
| `PORT`            | `3000`   | HTTP/WebSocket server port                                            |
| `DATA_DIR`        | `./data` | Directory for session data (event logs, preferences, plugin settings) |
| `APP_CONFIG_PATH` | -        | Override config file location                                         |

### TTS

| Variable                | Default           | Description                                                                        |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| `TTS_BACKEND`           | `openai`          | TTS backend: `openai` or `elevenlabs`                                              |
| `OPENAI_TTS_MODEL`      | `gpt-4o-mini-tts` | OpenAI TTS model                                                                   |
| `TTS_VOICE`             | `alloy`           | Voice name for TTS output                                                          |
| `TTS_FRAME_DURATION_MS` | `250`             | PCM frame duration for TTS output; larger values reduce client scheduling overhead |
| `AUDIO_OUTPUT_SPEED`    | -                 | Playback speed multiplier (e.g., `1.2`)                                            |

OpenAI TTS requires `OPENAI_API_KEY`.

### Realtime voice (Android)

Realtime duplex voice reuses the same server-side OpenAI credential as TTS/chat:

| Variable                | Default            | Description                                                                                       |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| `OPENAI_API_KEY`        | -                  | **Required** for Realtime. Held only on the agent-server host; never sent to Android/web clients. |
| `OPENAI_REALTIME_MODEL` | `gpt-realtime-2.1` | Pinned Realtime model id (matches T3).                                                            |
| `OPENAI_REALTIME_VOICE` | `marin`            | OpenAI Realtime output voice (matches T3 default; female).                                        |

**Storage plan:** set `OPENAI_API_KEY` in the agent-server environment (systemd unit, shell profile, or secrets manager that injects env). Do not put the raw key in client apps, Capacitor assets, or committed `config.json`. Optional `${OPENAI_API_KEY}` substitution in `config.json` is fine for other agent fields; Realtime reads the env via `loadEnvConfig()` the same way OpenAI TTS does.

Capability probe: `GET /api/voice/capabilities` reports `agentRealtime.status` as `ready` or `not-configured`.

#### Realtime tool allowlist (`config.json`)

Realtime tool exposure is **explicit opt-in**. Configure under `voice.realtime`:

```json
{
  "voice": {
    "realtime": {
      "toolAllowlist": [
        "interaction_end",
        "lists_*",
        "web_search",
        "codex_threads_list",
        "codex_threads_find",
        "codex_threads_status",
        "codex_threads_messages"
      ],
      "toolDenylist": []
    }
  }
}
```

| Field           | Description                                                                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `toolAllowlist` | Glob patterns for tool names available on Realtime sessions. Missing or empty ⇒ **no** tools. Add `interaction_end` to let the voice agent end its call. |
| `toolDenylist`  | Optional globs removed after allowlist matching.                                                                                                         |
| `instructions`  | Optional system-instruction override for the Realtime model.                                                                                             |

Text agents use per-agent `toolAllowlist` / `toolDenylist` independently of this block.

#### Built-in `interaction_end` tool

`interaction_end` gives text and Realtime agents one shared way to honor requests such as
“we can stop now.” Add it to each text agent's `toolAllowlist` and to
`voice.realtime.toolAllowlist` where the behavior is wanted.

- Tell agents they must call the tool when the user asks to stop. A textual or spoken
  acknowledgment alone does not end the interaction.
- In a text-agent turn, the tool returns normally so the agent can complete its final response.
  Android correlates the tool call with that response and suppresses Auto Listen for that turn.
- In a Realtime session, the same tool ends the live call immediately. The voice agent should say
  any brief goodbye before calling it.
- The optional `reason` argument is a short diagnostic string such as `user_request` or `done`.

#### Built-in `web_search` tool

`web_search` is a **built-in** tool (not a plugin). It runs the local Grok CLI headless for live public web and X research.

| Item                   | Detail                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parameters             | `query` (required natural-language question), `continue` (optional bool to resume prior Grok session for this conversation)                                                                                       |
| Enable for text agents | Add `web_search` to the agent’s `toolAllowlist`                                                                                                                                                                   |
| Enable for Realtime    | Add `web_search` to `voice.realtime.toolAllowlist`                                                                                                                                                                |
| Host prerequisites     | `grok` on `PATH` (or `ASSISTANT_GROK_BIN`); Grok auth (`~/.grok/auth.json` and/or `XAI_API_KEY`); do not lock off `bypassPermissions` in Grok requirements; avoid untrusted Grok MCP servers for the service user |
| Not the same as        | Plugin `search_*` tools (in-app notes/lists search)                                                                                                                                                               |

Design: `docs/design/web-search-tool.md`.

#### Built-in Codex Threads tools

The `codex_threads_*` built-in tools use the local `codex-threads` CLI to inspect
and interact with a configured Codex app-server. They are individually
allowlisted for text agents and Realtime voice.

| Tool                     | Purpose                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `codex_threads_list`     | List bounded recently updated threads, including cwd/project and status.                                   |
| `codex_threads_find`     | Match a bounded recent candidate set by name, preview, and cwd metadata. It is not full transcript search. |
| `codex_threads_status`   | Load and inspect one thread and its active-turn state.                                                     |
| `codex_threads_messages` | Read a bounded recent user/assistant transcript.                                                           |
| `codex_threads_send`     | Start or queue a turn; optionally wait up to 120 seconds for bounded final text.                           |
| `codex_threads_steer`    | Add guidance to the exact currently active turn.                                                           |
| `codex_threads_create`   | Create, optionally name, and start a thread in an allowed cwd.                                             |
| `codex_threads_rename`   | Set a non-empty thread name.                                                                               |

The Realtime example exposes only read operations. Add write operation names
explicitly when voice-driven mutations are desired; Realtime does not apply
per-agent capability rules.

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

| Variable                      | Default  | Description                            |
| ----------------------------- | -------- | -------------------------------------- |
| `AUDIO_SAMPLE_RATE`           | `24000`  | Audio sample rate in Hz                |
| `AUDIO_INPUT_MODE`            | `manual` | Input mode: `server_vad` or `manual`   |
| `AUDIO_TRANSCRIPTION_ENABLED` | `false`  | Forward transcription events to client |

### Debug

| Variable                 | Default | Description                                                          |
| ------------------------ | ------- | -------------------------------------------------------------------- |
| `DEBUG_CHAT_COMPLETIONS` | `false` | Log Pi SDK request/response payloads (tools included, auth redacted) |
| `DEBUG_HTTP_REQUESTS`    | `false` | Log HTTP request details                                             |

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

| Key            | Type   | Description                                                     |
| -------------- | ------ | --------------------------------------------------------------- |
| `sessions`     | object | Session cache settings.                                         |
| `agents`       | array  | Agent persona definitions and chat provider config.             |
| `chatProfiles` | object | Named Pi model choices and per-model thinking levels. |
| `profiles`     | array  | Shared profile (instance) definitions for cross-plugin scoping. |
| `plugins`      | object | Plugin enablement and per-plugin config.                        |
| `mcpServers`   | array  | External MCP servers launched over stdio.                       |
| `codexThreads` | object | Host configuration for built-in `codex_threads_*` tools.        |

#### `sessions`

Controls session cache behavior.

```json
{ "sessions": { "maxCached": 100 } }
```

- `maxCached`: maximum number of sessions cached in memory

#### Codex Threads

```json
{
  "codexThreads": {
    "allowedServers": ["main", "work"],
    "binary": "codex-threads",
    "permissionMode": "app-server-default",
    "allowedCwdRoots": ["/path/to/workspaces"]
  }
}
```

| Field             | Default              | Description                                                                                                                                                    |
| ----------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `allowedServers`  | required             | Nonempty list of aliases from the host user's `codex-threads` config. Every tool call must select one of these aliases through its required `server` argument. |
| `binary`          | `codex-threads`      | Executable name or trusted host-configured path.                                                                                                               |
| `permissionMode`  | `app-server-default` | `app-server-default` passes `--no-yolo`; `full-access` deliberately uses the CLI's approval-policy-never/full-access behavior. Agents cannot override it.      |
| `allowedCwdRoots` | `[]`                 | Absolute roots permitted for `codex_threads_create`. With no roots, create is unavailable while other operations still work.                                   |

The host service user must have a working `codex-threads` configuration and a
reachable app-server for each allowed alias. Every operation requires a
model-visible `server` argument constrained to `allowedServers`. Calls use JSON output,
argument-array subprocess execution, hard time/output limits, and compact
result projections. Full-text CLI search is intentionally not exposed because
its time filtering can scan unbounded history; `codex_threads_find` searches a
fixed recent metadata candidate set instead.

`codex_threads_messages` accepts an optional exact `turnId` returned by
`codex_threads_send`. When present, the server scans the bounded recent-turn
window, filters to that turn, and only then applies the final message limit.
This lets asynchronous relay agents retrieve the response for the turn they
submitted without confusing it with newer thread activity.

Text agents opt in through `toolAllowlist` and may additionally scope
`codex_threads.read` versus `codex_threads.write` capabilities. Realtime opts in
independently through exact names or globs under `voice.realtime.toolAllowlist`.

#### `agents`

Defines agent personas and chat providers.

```json
{
  "chatProfiles": {
    "default": { "models": [{ "id": "anthropic/claude-sonnet-4-5" }] }
  },
  "agents": [
    {
      "agentId": "general",
      "chatProfile": "default",
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
    "notes": {
      "enabled": true,
      "instances": [
        "work",
        { "id": "personal", "label": "Personal" },
        { "id": "shared", "config": { "label": "Shared" } }
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

Plugins that execute code (like the coding plugin) run locally. `local.workspaceRoot` may use the
session-scoped macro `${session.workingDir}` so relative file paths and `bash` commands anchor to
the session picker’s working directory.

```json
{
  "plugins": {
    "coding": {
      "enabled": true,
      "mode": "local",
      "local": {
        "workspaceRoot": "/path/to/workspaces"
      }
    }
  }
}
```

| Field                 | Type   | Description                                                                                                                         |
| --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `mode`                | string | Execution mode. Only `local` is supported.                                                                                          |
| `local.workspaceRoot` | string | Root directory for local workspaces. `${session.workingDir}` resolves from `attributes.core.workingDir` for interactive tool calls. |

Notes:

- Coding tools now execute directly through the imported `@earendil-works/pi-coding-agent` local tool implementations.

##### Agents plugin tools (when enabled)

Agent coordination is provided by the `agents` plugin. Enable it in `config.json` and use the generated tools:

| Tool             | Description                                                                 |
| ---------------- | --------------------------------------------------------------------------- |
| `agents_message` | Send a message to another agent (sync or async) without switching sessions. |
| `agents_list`    | List configured agents for delegation or messaging.                         |

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
  "toolApprovals": {
    "required": ["bash", "write", "edit"]
  },
  "toolExposure": "skills",
  "skillAllowlist": ["notes"],
  "sessionWorkingDir": {
    "mode": "prompt",
    "roots": ["/path/to/workspaces"]
  },
  "skills": [
    { "root": "~/skills", "available": ["*"], "inline": ["my-critical-*"] },
    { "root": "worktrees/assistant/skills" }
  ],
  "capabilityAllowlist": ["*"],
  "agentAllowlist": ["*"],
  "uiVisible": true,
  "apiExposed": false
}
```

| Field                 | Type    | Description                                                                                                                                                                                                              |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agentId`             | string  | Unique id (used by tools and session routing).                                                                                                                                                                           |
| `displayName`         | string  | UI label.                                                                                                                                                                                                                |
| `description`         | string  | UI description and prompt context.                                                                                                                                                                                       |
| `type`                | string  | Agent type: `chat` (default) or `external`.                                                                                                                                                                              |
| `systemPrompt`        | string  | Optional custom prompt.                                                                                                                                                                                                  |
| `toolAllowlist`       | array   | Glob patterns for tool access.                                                                                                                                                                                           |
| `toolDenylist`        | array   | Glob patterns for tool denylist.                                                                                                                                                                                         |
| `toolApprovals`       | object  | Native Pi SDK tool approval policy. `required` contains tool-name glob patterns that must receive an interactive Approve response before execution.                                                                      |
| `toolExposure`        | string  | `tools`, `skills`, or `mixed`.                                                                                                                                                                                           |
| `skillAllowlist`      | array   | Plugin ids exposed as CLI skills.                                                                                                                                                                                        |
| `skillDenylist`       | array   | Plugin ids blocked from skill exposure.                                                                                                                                                                                  |
| `skills`              | array   | Instruction skills (filesystem `SKILL.md` discovery + Pi-style prompt inclusion).                                                                                                                                        |
| `capabilityAllowlist` | array   | Glob patterns for capability access.                                                                                                                                                                                     |
| `capabilityDenylist`  | array   | Glob patterns for capability denylist.                                                                                                                                                                                   |
| `agentAllowlist`      | array   | Glob patterns for agents this agent can delegate to.                                                                                                                                                                     |
| `agentDenylist`       | array   | Glob patterns for agents blocked from delegation.                                                                                                                                                                        |
| `sessionWorkingDir`   | object  | Optional working-directory policy for new sessions. Use `{ "mode": "fixed", "path": "/abs/path" }`, `{ "mode": "prompt", "roots": ["/abs/root"] }`, or `{ "mode": "none" }` to leave `core.workingDir` unset by default. |
| `uiVisible`           | boolean | Hide from built-in UI if `false`.                                                                                                                                                                                        |
| `apiExposed`          | boolean | Reserved for external API tools (currently unused).                                                                                                                                                                      |

#### Native tool approvals

`toolApprovals.required` accepts the same exact-name and `*` glob patterns used by the tool
allowlist. Every matching native Pi SDK tool call pauses before execution and appears above the
chat composer with **Deny** and **Approve** actions. For example, protect filesystem reads and
writes as well as shell commands:

```json
{
  "toolApprovals": {
    "required": ["bash", "read", "write", "edit", "find", "grep"]
  }
}
```

The exception settings below only skip approvals already required by `required`; they
do not restrict which tools or commands may run. Include `bash` in `required` (or a
matching glob) for `bashAllowPrefixes` to have an effect, and include `write` and/or
`edit` for `writeAllowDirectories` to affect those tools. Unmatched tools run without
approval regardless of these settings. If `required` is omitted or empty, the entire
approval policy, including its exceptions, is ignored.

To skip Bash approval for selected command prefixes, add `bashAllowPrefixes`:

```json
{
  "toolApprovals": {
    "required": ["bash", "find", "edit", "write"],
    "bashAllowPrefixes": ["agent-wrapper", "date"]
  }
}
```

Prefixes are literal, case-sensitive strings (not globs), trimmed when loading config.
Leading command whitespace is ignored. A prefix must end at the end of the command or
before whitespace or a shell operator (`;`, `&`, `|`, `<`, `>`), so `date`
matches `date -Iseconds` and `date|cat`, but not `datefoo`.
A match permits the **entire invocation**, including trailing pipes, chains, redirections,
and substitutions. This is a workflow guardrail, not a security boundary.
Commands with other beginnings (such as `env TZ=UTC date`) still require approval.
Exceptions apply only to the `bash` tool; other tools retain their approval policy.

Use `writeAllowDirectories` to skip approval for native `write` and `edit` calls:

```json
{
  "toolApprovals": {
    "required": ["bash", "find", "edit", "write"],
    "bashAllowPrefixes": ["agent-wrapper", "date"],
    "writeAllowDirectories": ["/tmp"]
  }
}
```

Directory entries must be absolute paths. Matching includes nested files, resolves
`..` segments, and checks directory boundaries (`/tmp-other` does not match `/tmp`).
Relative file paths resolve against the native tool's configured working directory.
Native path forms such as `~/file`, `@/tmp/file`, and `file:///tmp/file` are supported.
This is a lexical path check: symlinks are not resolved. Like Bash prefix exceptions,
it is a workflow guardrail. It does not exempt reads or Bash commands that write files.

The policy is enforced only for the native `pi` provider, whose tools execute through the
Assistant tool host. Configuration is rejected for CLI providers because their internal tool
execution cannot be intercepted by Assistant. Approval fails closed: if no connected client has
interactive tool prompts enabled, the matching tool returns an `interaction_unavailable` error
without running.

#### Working directory behavior

When `sessionWorkingDir` is set to `{ "mode": "prompt", "roots": [...] }`, the UI shows a
working directory picker for new sessions created with that agent. The options are the
immediate subdirectories of each configured root (all of which must be absolute paths).

When `sessionWorkingDir` is set to `{ "mode": "fixed", "path": "/abs/path" }`, new sessions
for that agent automatically use the fixed directory without prompting.

When `sessionWorkingDir` is set to `{ "mode": "none" }`, new sessions do not get a default
working directory from the agent. This is equivalent to omitting the field and makes the
intent explicit in config.

The selected or fixed directory is stored in `attributes.core.workingDir` and can be consumed
by other systems such as `${session.workingDir}` CLI macros and the coding plugin's local
workspace configuration.

#### Instruction skills (`skills`)

The `skills` field is for **instruction skills** discovered from `SKILL.md` files on disk and injected
into the agent's system prompt. This is separate from plugin/manifest-driven “CLI skills” controlled by
`toolExposure` + `skillAllowlist`.

Each entry is a “source”:

```jsonc
{
  "skills": [
    {
      "root": "~/skills",
      "available": ["*"],
      "inline": ["my-critical-*"],
    },
  ],
}
```

- `root`: directory to recursively scan for `SKILL.md`.
- `available`: glob patterns over skill `name` to include in `<available_skills>`.
- `inline`: glob patterns over skill `name` to inline as `<skill name="...">...</skill>`.
- If both `available` and `inline` are omitted for a source, it defaults to `available: ["*"]`.

#### Context files (`contextFiles`)

The `contextFiles` field injects ordinary UTF-8 text files into the agent's system prompt after
instruction skills. This is intended for static project context that should be loaded once at
startup and reused for later prompt rebuilds.

Each entry is a rooted source:

```jsonc
{
  "contextFiles": [
    {
      "root": "./context",
      "include": ["README.md", "product/overview.md", "product/policies/*.md", "shared/**/*.md"],
    },
  ],
}
```

- `root`: directory to search within. Relative roots resolve against the config file directory when
  the config is loaded.
- `include`: root-relative file paths or glob patterns. Matches are ordered by source order, then
  include-pattern order, then lexical path order within each pattern.
- Matches are restricted to files inside the declared root, even when symlinks are involved.
- Duplicate matches are kept only on the first match.
- Startup fails if a root is missing, unreadable, outside-root traversal is detected, an include
  pattern matches nothing, or a matched file is binary / invalid UTF-8.
- File contents are cached at startup. Changes on disk are not picked up until restart.

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

| Field                      | Type   | Description                                                   |
| -------------------------- | ------ | ------------------------------------------------------------- |
| `external.inputUrl`        | string | URL where messages are POSTed to the external agent.          |
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

| Provider     | CLI Tool | Description                                                    |
| ------------ | -------- | -------------------------------------------------------------- |
| `pi`         | -        | Pi SDK in-process chat (upstream providers configured via Pi). |
| `claude-cli` | `claude` | Anthropic Claude CLI with tool use.                            |
| `codex-cli`  | `codex`  | OpenAI Codex CLI with file editing and shell.                  |
| `pi-cli`     | `pi`     | Pi CLI agent.                                                  |

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

Scheduled sessions are no longer configured on agents. Use the `scheduled-sessions` plugin to
create and manage them dynamically. They are stored in the plugin data directory under
`data/plugins/scheduled-sessions/default/schedules.json`.

The same plugin also stores pending one-shot session wake-ups under
`data/plugins/scheduled-sessions/default/wakeups.json`. Wake-ups are limited to native Pi SDK
sessions (`chat.provider: "pi"`), target the current tool session for create/list/update/cancel
operations, and send the configured message back to that session at the requested time. If the
session is busy when the wake-up fires, the message is added to the existing per-session message
queue. A session can have up to 25 active wake-ups.

Global one-time reminders are stored alongside them under
`data/plugins/scheduled-sessions/default/reminders.json`. Reminders are not session-scoped and do
not start an agent turn. When due, they create an ordinary durable notification titled `Reminder`
with the reminder text as its body and TTS content, using one-way `speak` playback when standalone
notification playback is enabled. The Notifications plugin must be enabled before creating a
reminder. A maximum of 25 reminders can be pending globally.

Each persisted schedule record includes:

- `agentId`
- `scheduleId`
- `cron`
- optional `prompt`
- optional `preCheck`
- optional `sessionTitle`
- optional `sessionConfig`
  - optional `model`
  - optional `thinking`
  - optional `workingDir`
  - optional `skills`
- `enabled`
- `reuseSession` (defaults to `true`)
- `maxConcurrent`

Notes:

- Each schedule must define `prompt`, `preCheck`, or both.
- `sessionConfig` values are validated against the selected agent on create/update and
  revalidated when a scheduled run starts.
- `sessionTitle` stays a top-level schedule field; it is not part of scheduled `sessionConfig`.
- `preCheck` runs in the agent `chat.config.workdir` and uses the wrapper environment when configured.
- When `reuseSession` is `true`, scheduled runs reuse one backing session per `agentId + scheduleId`.
- Reused scheduled sessions are created up front and reconciled from the schedule on later runs
  after edits.
- When `reuseSession` is `false`, each run creates a fresh backing session.
- `maxConcurrent` only matters when `reuseSession` is `false`.
- Enable the `scheduled-sessions` plugin to create, edit, delete, run, and toggle schedules, and to
  list/create/update/cancel pending session wake-ups and global reminders.

Wake-up tools:

- `scheduled_sessions_wakeup_create`
  - `message`
  - exactly one of `runAt` or `delaySeconds`
  - `runAt` must be an absolute ISO timestamp with an explicit timezone offset or `Z`, for example
    `2026-06-03T08:56:00-05:00` or `2026-06-03T13:56:00Z`
- `scheduled_sessions_wakeup_update`
  - `wakeupId`
  - at least one of `message`, `runAt`, or `delaySeconds`
  - if a time is provided, provide exactly one of `runAt` or `delaySeconds`
- `scheduled_sessions_wakeup_cancel`
  - `wakeupId`
- `scheduled_sessions_wakeup_list`

Wake-up tools intentionally do not accept a `sessionId`; they use the current tool context.
`update` and `cancel` only operate on wake-ups belonging to the current session. In a session
context, `list` returns manageable current-session wake-ups with IDs and message details plus
read-only other-session wake-ups with only safe summary fields: `kind`, `scope`, `manageable`,
`runAt`, `status`, `summary`, false capabilities, and an `omitted` list for redacted fields. The
scheduled-sessions panel uses the same plugin operation without a session context to show all
wake-ups for administration.

On Android, one-shot wake replies follow the existing Thread audio mode and Auto-listen settings:
Response mode speaks then listens when Auto-listen is on, and Manual mode listens without automatic
speech. Disabling Auto-listen prevents automatic recognition. No voice tool or separate wake setting
is required. Each eligible connected Android device applies its own settings and notification-session
filter; wakes are not tied to the device that scheduled them. This requires the updated Android app
and backend. Recurring cron sessions do not receive this wake-specific recognition behavior.

Reminder tools:

- `scheduled_sessions_reminder_create`
  - `text`: content to display and speak when due, without “remind me” or scheduling language
  - exactly one of `runAt` or `delaySeconds`
  - `runAt` must be an absolute ISO timestamp with an explicit timezone offset or `Z`
- `scheduled_sessions_reminder_update`
  - `reminderId`
  - at least one of `text`, `runAt`, or `delaySeconds`
  - `runAt` and `delaySeconds` are mutually exclusive when changing the delivery time
- `scheduled_sessions_reminder_cancel`
  - `reminderId`
- `scheduled_sessions_reminder_list`

Reminder operations are global and do not require or accept a session id. The Scheduled Sessions
panel displays wake-ups and reminders together in a time-ordered One-shots section. After a
reminder fires, its delivered record appears in the Notifications panel and uses the existing
standalone notification playback settings.

#### `pi` Provider

Pi defines providers and models; Assistant selects them through named chat profiles.
The profile is shared by any agents referencing it, without per-agent model overrides.

```json
{
  "chatProfiles": {
    "local": {
      "models": [
        {
          "id": "local/model-a",
          "thinking": ["xhigh", "medium", "none"]
        },
        {
          "id": "remote/model-b",
          "thinking": ["none"]
        }
      ]
    }
  },
  "agents": [
    {
      "agentId": "assistant",
      "displayName": "Assistant",
      "chatProfile": "local",
      "chat": {
        "provider": "pi",
        "config": {
          "maxToolIterations": 100,
          "compaction": {
            "enabled": true,
            "reserveTokens": 16384,
            "keepRecentTokens": 20000
          }
        }
      }
    }
  ]
}
```

- `chatProfiles`: root object keyed by profile name; separate from plugin-instance `profiles`.
- `chatProfile`: agent reference to a named profile for in-process Pi chat.
- `models`: nonempty ordered profile list. Each `id` must be a full `provider/model` reference.
  The first entry is the default. Built-in and custom models use the same Pi registry lookup.
- `thinking`: optional model-specific allowed levels; the first is the default. Supported names
  are `none`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
  `none` becomes Pi's explicit off state. Choose levels the registry model actually supports;
  a profile does not add capabilities to a model. Omission defaults to off.
- `chat.config.maxToolIterations`: agent-specific maximum consecutive tool iterations (default 100).
- `chat.config.compaction`: agent-specific context compaction controls. Compaction defaults to
  enabled, with `reserveTokens: 16384` and `keepRecentTokens: 20000`. Manual compaction is
  available from chat request history; automatic compaction runs after completed Pi turns when
  usage exceeds `contextWindow - reserveTokens`.

Custom definitions belong in `~/.pi/agent/models.json` on the Assistant service host, under the
service user's Pi configuration directory. Pi's supported registry and authentication mechanisms
load built-in and custom models, resolve API keys and headers, and reuse/refresh credentials in
Pi's `auth.json`. The selected registry model supplies its URL, API type, input and reasoning
capabilities, `thinkingLevelMap`, compatibility/template settings, context window, and output limit.
Assistant does not synthesize a substitute model or parse a second provider-definition format.
Use short registry model display names; keep configuration parameters in their dedicated fields.
Restart Assistant after changing the configuration or registry definitions.

##### Shared request overrides

Sampling is configured separately from Assistant profiles in
`~/.pi/agent/request-overrides.json`. `PI_CODING_AGENT_DIR`, when set, selects the Pi agent
directory instead. The shared `@kcosr/pi-request-overrides` package supplies both a Pi extension
and Assistant's stream hook, so both consumers apply the same model-specific settings:

```json
{
  "models": {
    "local/model-a": {
      "sampling": {
        "temperature": 1.0,
        "top_p": 0.95,
        "top_k": 20,
        "min_p": 0.0,
        "presence_penalty": 0.0,
        "repeat_penalty": 1.0
      }
    }
  }
}
```

Only sampling overrides are implemented. The broader filename leaves room for future request
settings; headers are not currently accepted here. Provider URLs, authentication, headers, model
limits, reasoning mappings, and compatibility settings remain exclusively in Pi's registry.
Assistant profiles contain only model IDs and thinking choices. Omitted sampling values retain
SDK/server defaults; adding an override deliberately changes requests for that exact model.

Supported fields are `temperature` (0–2), `top_p` and `min_p` (0–1), `top_k` (nonnegative integer),
`presence_penalty` (-2–2), and `repeat_penalty` (positive). API compatibility is checked by the
shared package; unsupported overrides fail instead of being silently ignored.

Local Pi runtimes can discover the installed Pi extension. Remote or isolated runtimes that disable
extensions need explicit integration with the shared package. Merely placing the overrides file
on disk does not enable it in an extension-disabled runtime.

##### Reasoning transport

For models with template-controlled reasoning, enabling thinking alone may not select effort.
A registry definition exposing medium and xhigh needs
both a `thinkingLevelMap` admitting `medium` and `xhigh` and generic chat-template settings that
transmit Pi's selected effort as well as the thinking toggle. A literal `xhigh` template value or
`qwen-chat-template` toggle-only format cannot implement the profile's medium choice.

##### Migrating existing Pi agents

1. Back up Assistant's configuration and Pi's `models.json` before changing either.
2. Move each inline provider definition into Pi's registry, preserving that provider's endpoint,
   authentication, API, limits, headers, and capabilities. Do not share one provider's settings
   with another. Expand unqualified model IDs into `provider/model` references.
3. Create named `chatProfiles`, moving ordered model choices and model-specific thinking choices
   into each profile. Preserve the default ordering. Move active sampling overrides into the
   shared Pi `request-overrides.json` file, not into the profile. Back up that file before editing
   it if it already exists.
4. Set each affected agent's `chatProfile`. Remove Pi agent `chat.models`, `chat.thinking`, and
   obsolete `chat.config` provider/model fields, including `provider`, `api`, `baseUrl`, `apiKey`,
   `authHeader`, `headers`, `compat`, `contextWindow`, `maxTokens`, `reasoning`, `input`, `cost`,
   and `temperature`. Retain agent execution settings such as compaction and tool-iteration limits.
5. Verify both registry resolution and actual requests for every affected provider before deployment.

This is a configuration contract change; there is no silent inline-provider fallback. CLI agents
retain their existing `chat.models`, `chat.thinking`, and CLI-specific `chat.config` fields.

Preserve historical configuration backups and their restoration scripts unchanged. A script
that restores the old inline configuration is not a compatible configuration restore for this
implementation. Use it only with matching pre-migration application code, or copy
its values into the new registry/profile contract manually. A rollback of this migration should
restore matching application code and the newly backed-up configuration files together, including
`request-overrides.json` if the migration changed it.

Pi SDK sessions are mirrored to the Pi JSONL format so they can be resumed by the
pi-mono CLI. Sessions are written to:
`~/.pi/agent/sessions/<encoded-cwd>/*_<pi-session-id>.jsonl`.
The `cwd` comes from `attributes.core.workingDir` when available (otherwise the
server working directory).
Canceled runs still write partial assistant/tool entries so the pi-mono CLI can resume.
Pi-backed sessions always persist canonical Pi JSONL history for replay and reload. Compacted Pi
JSONL logs keep the full raw history on disk and add Pi-compatible `compaction` entries; future
model context is rebuilt as summary plus the recent kept messages.

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
        "path": "/opt/assistant/container/run.sh",
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
