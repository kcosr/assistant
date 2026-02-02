# Native Pi SDK chat provider

## Overview

Replace the OpenAI chat integration in assistant with the native Pi SDK integration
used by agent-hub. We add a Pi SDK provider that wraps `@mariozechner/pi-ai`
streaming and wire it into the agent server’s chat run loop so tool calls,
streaming deltas, and event logging continue to work. Upstream providers (OpenAI,
Anthropic, etc.) are configured and resolved inside Pi.

## Goals

- Use the Pi SDK (`@mariozechner/pi-ai`) for in-process chat completions.
- Preserve streaming deltas, tool call handling, and chat event logging.
- Keep assistant-owned model/thinking selection (per-agent + session overrides) and pass it through to Pi.
- Document configuration and defaults clearly.

## Non-Goals

- Replacing CLI providers (`claude-cli`, `codex-cli`, `pi-cli`).
- Changing tool system semantics or UI behavior beyond required event mapping.
- Replacing OpenAI TTS or STT (unless explicitly requested).

## Current State

- In-process chat completions use the Pi SDK via provider id `pi` (default).
- Tool call streaming and iteration logic are Pi SDK-based.
- CLI providers remain unchanged.
- The OpenAI SDK is retained only for TTS/STT.
- Pi SDK chat history is mirrored into the Pi session JSONL format so pi-mono CLI can resume sessions.

## Proposed Design

### Provider Type

- Provider id is `pi` and is the default when `chat.provider` is omitted.
- `openai` / `openai-compatible` are removed from assistant chat providers (Pi handles upstream).

### Config

Add `PiSdkChatConfig` (per-agent only), exposing the common connection settings:

- `provider` (string, optional; default provider for models without a prefix)
- `models` (string[], required unless provided by session)
- `thinking` (string[], optional; `off|minimal|low|medium|high|xhigh`)
- `apiKey?` (Pi provider API key override)
- `baseUrl?` (OpenAI-compatible or proxy endpoint handled by Pi)
- `headers?` (string map, optional)
- `timeoutMs?`
- `maxTokens?`
- `temperature?`
- `maxToolIterations?` (max tool iterations before aborting; default 100)

Config is per-agent only; assistant does not implement provider env lookup. The Pi
SDK reads provider API keys from environment variables (for example
`OPENAI_API_KEY`, `ANTHROPIC_OAUTH_TOKEN`/`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`,
`GROQ_API_KEY`, `MISTRAL_API_KEY`, `OPENROUTER_API_KEY`) when `apiKey` is not provided.

### Runtime Flow

Introduce a Pi SDK adapter similar to `SdkLlmProvider` in agent-hub:

1. Convert `state.chatMessages` (OpenAI-style) into Pi SDK `Context`:
   - System prompt → `context.systemPrompt`.
   - User/assistant text → Pi `messages` with `role: "user" | "assistant"`.
   - Tool calls → assistant `content` blocks with `toolCall` entries.
   - Tool results → `role: "toolResult"` with `toolCallId`, `toolName`, and text content.
2. Map tools into Pi SDK `context.tools` using the same JSON schema as today.
3. Stream with `streamSimple(model, context, options)` to pass Pi reasoning options.
   - Pi SDK emits `text_*`, `thinking_*`, and `toolcall_*` events.
   - On `text_delta`: emit `emitTextDelta` using an accumulated `textSoFar`.
   - On `thinking_start/delta/end`: emit `emitThinkingStart/Delta/Done`.
   - On `toolcall_end`: create a `ChatCompletionToolCallState`, emit `tool_call_start`, and
     emit a single `tool_input_chunk` with the full args JSON.
4. Return text + tool calls to the same iteration loop used by CLI providers so
   `handleChatToolCalls` and multi-step tool runs continue to work.

### Session History (pi-mono compatibility)

- Persist Pi SDK conversations to the same JSONL session format used by pi-mono.
- Entries include thinking/tool-call signatures so OpenAI Responses replays can resume without
  missing reasoning items.
- Aborted/canceled runs still sync the latest assistant/tool-call entries plus interrupted tool
  results so the pi-mono CLI can resume from partial turns.
- Sessions are written under `~/.pi/agent/sessions/<encoded-cwd>/*_<pi-session-id>.jsonl`.
- Mirroring is controlled by `sessions.mirrorPiSessionHistory` (default `true`).

### Model + Provider Mapping

- Model selection remains in assistant (agent config + session overrides); Pi does not run
  its own model resolver for assistant.
- Accept `models` entries in `provider/model` form.
- If a model entry includes a provider prefix, use that provider for resolution.
- If no prefix is present, fall back to the configured `PiSdkChatConfig.provider` (required in that case).
- Connection overrides (`apiKey`, `baseUrl`, `headers`) are only applied when the
  resolved provider matches `PiSdkChatConfig.provider`.

### Thinking Mapping

- Thinking selection remains in assistant (`chat.thinking` + session override).
- When `chat.thinking` is set, store the selected level in session summary.
- Convert thinking level to Pi SDK `reasoning` option:
  - `off` → omit `reasoning` (Pi defaults to reasoning disabled).
  - `minimal|low|medium|high|xhigh` → pass through to `streamSimple(..., { reasoning })`.

### Error Handling

- If the SDK result has `stopReason: "error"`, surface a `ChatRunError`.
- If the SDK result has `stopReason: "aborted"`, mark the run as aborted and return.
- Preserve current retry/abort behavior (no new retries introduced).

### Dependencies

- Add `@mariozechner/pi-ai` to `packages/agent-server/package.json`.
- Keep `openai` only for TTS/STT.

### Docs & Defaults

- Update `docs/CONFIG.md` with `pi` provider docs and examples.
- Update `docs/design/agents.md` provider list.
- Update `packages/agent-server/data/config.json` to use `pi` for the built-in Pi agent.

### Tests

- Adapter unit tests for message conversion + tool call mapping.
- Lifecycle tests covering streaming and tool calls for `pi`.
- Schema tests for config parsing and provider validation.

## Open Questions

None.
