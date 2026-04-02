# Pi Native Agent Core Migration

## Overview

Migrate assistant's native Pi provider from a custom agent loop built on `@mariozechner/pi-ai` (`streamSimple`) to `@mariozechner/pi-agent-core`'s `Agent` class. This is a greenfield rebuild of the pi-native chat path — no backwards compatibility required, breaking changes accepted during migration.

Execution checklist: [implementation-checklist.md](/home/kevin/worktrees/assistant-pi-native-agent-core/.plans/pi-native-agent-core/implementation-checklist.md)

## Current State

Assistant's `agent-server` package has four chat provider paths sharing a common abstraction layer:

- **`pi`** — native in-process provider using `@mariozechner/pi-ai`'s `streamSimple`
- **`pi-cli`** — subprocess wrapper around the pi CLI
- **`claude-cli`** — subprocess wrapper around Claude Code CLI
- **`codex-cli`** — subprocess wrapper around Codex CLI

All four flow through `chatRunCore.ts` (1,238 lines) which implements a shared agent loop, stream event handling, tool dispatch, TTS integration, and debug logging. The native `pi` provider additionally uses `piSdkProvider.ts` (637 lines) for model resolution, context building, and streaming.

### Key Problems

1. **Duplicated agent loop**: Assistant reimplements the same agent loop pattern (stream LLM → check tool calls → execute → repeat) that `@mariozechner/pi-agent-core` already provides and battle-tests in the coding agent.

2. **Dual message format**: Assistant uses its own `ChatCompletionMessage` type internally, with a `piSdkMessage` sidecar field carrying the raw pi-ai `AssistantMessage`. Every message passes through `buildPiContext()` to translate back to pi-ai format for LLM calls, and `piSessionWriter.ts` (1,831 lines) reaches into the sidecar to extract provider/model/content details for persistence. This is the root of most complexity.

3. **Shared abstraction tax**: The four providers share stream handlers, tool callback factories, CLI runtime config, and session tracking code. This common layer adds complexity to every provider and makes the native `pi` path harder to evolve independently.

4. **Missing features**: No context compaction, no steering/follow-up message support, no `transformContext` hook, no `beforeToolCall`/`afterToolCall` hooks — all of which agent-core provides.

5. **Legacy TTS**: Server-side ElevenLabs/OpenAI TTS integration (~968 lines) is obsolete, replaced by a separate voice adapter architecture.

## Goals

- Eliminate duplicated agent loop, tool dispatch, and stream event handling code
- Use pi-ai native `Message`/`AssistantMessage` types as the primary message format (drop `ChatCompletionMessage` dual-format)
- Simplify session writing by working with native pi-ai messages directly
- Clean separation: pi-native path is the primary architecture; CLI/Codex agents become isolated sidecars added back later
- Gain access to agent-core features: steering, follow-up messages, parallel tool execution, `transformContext`, `beforeToolCall`/`afterToolCall` hooks
- Preserve these assistant capabilities in the target end state:
  - `agents_message` sync/async callback flow
  - reconnect/replay behavior
  - questionnaire / interaction recovery
  - turn-history editing and attachment cleanup

## Architecture

### Target Design

```
User input → SessionHub → piNativeChat request adapter
                              ↓
                         Agent (pi-agent-core)
                         - AgentTools (native interface)
                         - convertToLlm
                         - transformContext (future: compaction)
                         - getApiKey (auth.json / OAuth)
                         - onPayload (debug logging)
                              ↓
                         AgentEvent stream
                              ↓
                         Event Listener / request adapter
                         - → ServerMessage (live UI, with session sequence/cursor)
                         - → Pi session file (canonical persistence)
                         - → Replay projector (session file → UI events after cursor)
                         - → Session/request state tracking
```

Important distinction: one assistant request from `SessionHub` is not the same as one
agent-core `turn`. `@mariozechner/pi-agent-core` emits `turn_start` / `turn_end` for each
assistant response cycle, including follow-up cycles after tool results and queued
steering/follow-up messages. The migration therefore needs an outer request-group layer that can
span multiple native pi turns. That grouping should be persisted in the same session file rather
than inferred from a second replay store.

### Key Decisions

- Agent-core owns the loop, tool dispatch, and streaming
- Assistant owns event translation, session persistence, and UI transport
- The native runtime keeps one live `Agent` per loaded session. It is reused across turns, dropped
  on session eviction/process restart, and reconstructed from persisted messages via
  `agent.replaceMessages()` when the session is loaded again.
- Session-level model and thinking changes remain supported. They are persisted as explicit
  session-file changes and apply at request boundaries: immediately when idle, otherwise to the
  next request after the current run completes or is cancelled.
- Persist outer assistant request boundaries in the same pi JSONL file as explicit custom entries
  such as `assistant.request_start` / `assistant.request_end`. These provide UI/replay grouping for
  one user-visible request across one or more native pi turns.
- Imported/shared pi session files that do not contain assistant request metadata must still load.
  In that case, replay synthesizes coarse outer request groups from the native history rather than
  rejecting the transcript. This is an import-compatibility path, not a second runtime model.
- Persist all user-visible interaction lifecycle state in the same pi JSONL file. In-memory waiter
  state is only for the live blocked tool execution; replay/restart visibility must come from
  durable session-file entries, not a separate interaction store.
- Rework UI replay/reconnect in the same migration. The pi session file becomes the only durable
  replay source; EventStore/ChatEvent are removed rather than carried as a temporary second source
  of truth.
- Introduce a session-local replay `sequence` plus resume `cursor` for projected UI events. The
  client reconciles live and replayed events by sequence/cursor rather than payload-based dedup.
- History edits operate on outer assistant request groups (`requestId`), not pi internal turns.
  Replay cursors are invalidated by any transcript rewrite that changes those request-group spans.
- `Agent.continue()` is not the generic session-resume primitive. Normal resumed sessions load
  prior messages with `agent.replaceMessages()` and then use `agent.prompt()` for the next user
  input. `continue()` is only valid when the last message is not an assistant message.
- No supported dual-path or fallback architecture in the final design. If temporary internal
  adapters are used during migration, they are throwaway scaffolding and not part of the target
  contract.
- Tool migration can use thin internal adapters where unavoidable, but the target contract is
  native `AgentTool` implementations with agent-core hooks owning tool orchestration concerns.
- Session persistence remains assistant-owned. The writer targets a coding-agent-compatible
  session-file format where needed, but assistant does not import coding-agent `SessionManager` as
  a core runtime dependency.

## Phase 1: Strip (End State)

These are the pieces that disappear in the end state. Do not remove them before the new pi-native
path is wired and parity-tested.

### Remove Entirely

- **CLI providers**: `pi-cli`, `claude-cli`, `codex-cli` and all wiring
  - `ws/claudeCliChat.ts`
  - `ws/codexCliChat.ts`
  - `ws/piCliChat.ts`
  - `ws/cliCallbackFactory.ts`
  - `ws/cliRuntimeConfig.ts`
  - `codexSessionStore.ts`
- **Legacy TTS**: ElevenLabs/OpenAI server-side TTS
  - `elevenLabsTts.ts`
  - `tts/` directory
  - TTS wiring in `chatRunCore.ts` and `chatRunLifecycle.ts`
- **Dual message format plumbing**
  - `ChatCompletionMessage` type (replaced by pi-ai native messages)
  - `chatCompletionTypes.ts`
  - `buildPiContext()` in `piSdkProvider.ts` (no longer needed when messages are native)
  - `piSdkMessage` sidecar attachment logic in `piSessionSync.ts`
- **Shared stream handlers**
  - `createChatRunStreamHandlers()` in `chatRunCore.ts`
  - `chatRunCore.ts` itself (replaced by new pi-native module)
- **Iteration limit logic** (agent-core manages its own loop)

### Remove and Add Back Later (as isolated sidecars)

- Claude CLI agent support
- Codex CLI agent support
- Pi CLI agent support
- Codex API protocol support

## Phase 2: Keep

- **SessionHub** — multi-session orchestration, WebSocket routing, session state
- **Session index** — session listing, metadata
- **Agent exchange / inter-agent messaging** — `agentExchangeId`, callback routing
- **Auth data source** — `~/.pi/agent/auth.json` via `AuthStorage`
- **WebSocket transport** — `ServerMessage` types to UI clients
- **Built-in tools** — rewrite to `AgentTool` interface but keep functionality
- **System prompt building** — `systemPromptUpdater.ts`

## Phase 3: Rebuild on Agent-Core

### 3.1 Pi Native Chat Module (new, greenfield)

New module (e.g., `piNativeChat.ts`) that:
- Creates and manages an `Agent` instance from `@mariozechner/pi-agent-core`
- Configures model, thinking level, tools, system prompt
- Calls `agent.prompt()` for new messages
- Uses `agent.replaceMessages()` to restore prior state
- Uses `agent.continue()` only for retry / queued-message scenarios
- Subscribes to `AgentEvent` stream for all downstream side effects

Request-adapter contract:
- Input: `{ sessionId, requestId/responseId, assistantTurnId, source, text|callbackPayload }`
- Output responsibilities:
  - map agent-core events to assistant `ServerMessage`s
  - persist assistant request boundaries independently of agent-core internal turns
  - assign session-local replay `sequence` / `cursor` values for live and replay projection
  - update session/request state for cancellation, accumulated text, and usage
  - finalize exactly once on `agent_end`, abort, or error

### 3.2 Tools → AgentTool

Move directly to native `AgentTool` construction:

1. Rewrite built-in, plugin, MCP, and coding-tool registration so the runtime exposes scoped
   `AgentTool`s directly.
2. Reuse existing assistant business logic through assistant-local closure/context helpers where
   needed, but do not keep `ToolHost` as a runtime execution bridge.

The runtime contract still needs:
- `execute(toolCallId, params, signal, onUpdate)` returning `AgentToolResult`
- Parsed params for native tools
- Structured return type with `content` + `details`
- Streaming tool updates via `onUpdate`
- Interaction side effects from within `execute()`

### 3.3 AgentEvent → ServerMessage Adapter

Event listener that translates agent-core events to assistant's UI protocol:

| AgentEvent | ServerMessage |
|---|---|
| `message_update` (text_delta) | `ServerTextDeltaMessage` |
| `message_update` (thinking_start) | `ServerThinkingStartMessage` |
| `message_update` (thinking_delta) | `ServerThinkingDeltaMessage` |
| `message_update` (thinking_end) | `ServerThinkingDoneMessage` |
| `message_update` (toolcall_start) | (buffer tool info) |
| `message_update` (toolcall_delta) | tool input chunk event |
| `message_update` (toolcall_end) | `ServerToolCallStartMessage` |
| `message_end` | capture AssistantMessage for session writer |
| `tool_execution_start` | tool call event |
| `tool_execution_update` | tool output chunk event |
| `tool_execution_end` | tool result event |
| `turn_end` | internal turn bookkeeping; do not map directly to assistant request `turn_end` |
| `agent_end` | finalization |

Additional requirements:
- every live UI event carries a session-local comparable `sequence`
- every replay request uses an opaque `cursor` derived from that sequence space
- replay projection must emit the same ordering model as live updates so the client can reconcile by
  sequence instead of payload hashing
- attachment bubbles, tool output blocks, and interaction UI artifacts must all be assigned stable
  positions in that same projected ordering model

### 3.4 Session Writer (simplified rewrite)

- End-state requirements:
  - preserve the coding-agent session-file entry graph (`id`, `parentId`, `custom`,
    `custom_message`, `session_info`, `model_change`, `thinking_level_change`)
  - preserve assistant-owned entries needed for request grouping, interaction state, attribution,
    orphan tool-result handling, and history editing
  - keep turn-history editing support
- Do not map assistant request boundaries directly from agent-core `turn_start` / `turn_end`;
  those are internal assistant/tool cycles, not user-request boundaries.
- Any temporary projection or shim used during implementation is internal-only and removed before
  the migration is considered done.

### 3.5 Session Replay / Resume

- Load session file, reconstruct `AgentMessage[]`, and set them via `agent.replaceMessages()`
- For a normal resumed conversation, call `agent.prompt()` with the next user message
- Reserve `agent.continue()` for retry / queued-message scenarios where the last message is not
  an assistant message
- `convertToLlm` handles any custom message types that remain in assistant state
- Replay/reconnect reads projected UI events from the same session file after a per-session cursor
- Remove payload-based replay dedup; client reconciliation is by session-local sequence/cursor
- History-edit operations (`trim_before`, `trim_after`, request deletion, reset session) target the
  outer `requestId` grouping used by the UI, not pi internal turns

### 3.6 Auth

- Use `AuthStorage` from `@mariozechner/pi-coding-agent` via agent-core's `getApiKey` hook
- Same `~/.pi/agent/auth.json` + OAuth refresh flow, with file-locked refresh handling
- `onPayload` for debug request logging

## Open Questions

- [x] Replay source — remove EventStore/ChatEvent from the target design and move UI replay onto
  the pi session file in the same migration
- [ ] Compaction: port from coding-agent later, or stub `transformContext` hook now?
- [x] Session file format — keep coding-agent-compatible JSONL semantics and use standard
  `custom` / `custom_message` entries for assistant-specific state rather than inventing a second
  format
- [x] Interaction model — persist all user-visible interaction state in the pi session file; sync
  waits may block in memory while live, but async completion/resume happens via durable entries and
  a later normal request rather than reviving a blocked promise after restart
- [x] Agent exchange model — use a durable cross-session `exchangeId` for each `agents_message`
  invocation; persist it in the same pi session file while keeping normal per-session request
  groups
- [x] `convertToLlm` model — keep an assistant-local minimal converter; prefer standard `user`
  messages for model-visible callback/agent input and keep metadata-only custom entries out of LLM
  context
- [x] Boundary model — persist outer assistant request groups for UI semantics while preserving raw
  pi turns as the canonical inner execution history

## Sequencing

1. Add `pi-agent-core` and `pi-coding-agent` dependencies and verify the actual exported APIs
2. Build a new pi-native runtime with temporary internal helpers only where necessary:
   - agent-core loop
   - native `AgentTool` construction
   - target-format session writer
   - replay projector + sequence/cursor model
3. Prove parity for:
   - streaming text / thinking / tool updates
   - `agents_message` sync + async callbacks
   - interruption / partial persistence
   - replay / reconnect / questionnaire recovery
4. Route `provider === 'pi'` to the new path together with the new replay/UI recovery model
5. Remove old `chatRunCore.ts` / `piSdkProvider.ts` loop code and EventStore-based replay
6. Simplify tools and session writing after the runtime cutover is stable
7. Strip CLI providers / legacy TTS only after the native path is the default
8. (Later) Add CLI/Codex sidecars back as isolated modules
9. (Later) Port compaction from coding-agent
