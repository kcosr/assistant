# Pi Native Agent Core Migration

## Overview

Migrate assistant's native Pi provider from a custom agent loop built on `@mariozechner/pi-ai` (`streamSimple`) to `@mariozechner/pi-agent-core`'s `Agent` class. This is a greenfield rebuild of the pi-native chat path — no backwards compatibility required, breaking changes accepted during migration.

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
                         - → ServerMessage (WebSocket to UI)
                         - → ChatEvent / EventStore (migration dependency)
                         - → Pi session file (target-format persistence)
                         - → Session/request state tracking
```

Important distinction: one assistant request from `SessionHub` is not the same as one
agent-core `turn`. `@mariozechner/pi-agent-core` emits `turn_start` / `turn_end` for each
assistant response cycle, including follow-up cycles after tool results and queued
steering/follow-up messages. The migration therefore needs a request-level adapter that groups
multiple internal agent turns under one assistant `responseId` / request lifecycle.

### Key Decisions

- Agent-core owns the loop, tool dispatch, and streaming
- Assistant owns event translation, session persistence, and UI transport
- Current live/replay contracts still constrain the initial cut. `sessionHub`,
  `HistoryProviderRegistry`, `EventStore`, and `buildChatMessagesFromEvents()` still expect
  canonical `ChatEvent` streams, but those are migration constraints rather than target-state goals.
- `Agent.continue()` is not the generic session-resume primitive. Normal resumed sessions load
  prior messages with `agent.replaceMessages()` and then use `agent.prompt()` for the next user
  input. `continue()` is only valid when the last message is not an assistant message.
- No supported dual-path or fallback architecture in the final design. If temporary internal
  adapters are used during migration, they are throwaway scaffolding and not part of the target
  contract.
- Tool migration can use thin internal adapters where unavoidable, but the target contract is
  native `AgentTool` implementations with agent-core hooks owning tool orchestration concerns.

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
- **EventStore** — migration dependency only; remove once replay no longer depends on `ChatEvent`
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
  - emit assistant `ChatEvent`s while that layer still exists
  - persist assistant request boundaries independently of agent-core internal turns
  - update session/request state for cancellation, accumulated text, and usage
  - finalize exactly once on `agent_end`, abort, or error

### 3.2 Tools → AgentTool

Phase this work:

1. Wrap the existing `ToolHost` / built-in / plugin tool plumbing behind `AgentTool`
   adapters so the new runtime can ship without rewriting the entire tool stack.
2. Rewrite high-value tools to native `AgentTool` implementations only after the new loop,
   replay, and persistence paths are stable.

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

### 3.4 Session Writer (simplified rewrite)

- End-state requirements:
  - preserve the coding-agent session-file entry graph (`id`, `parentId`, `custom`,
    `custom_message`, `session_info`, `model_change`, `thinking_level_change`)
  - preserve assistant-only entries used today (`assistant.turn_start`, `assistant.turn_end`,
    `assistant.event`, orphan tool-result handling)
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

### 3.6 Auth

- Use `AuthStorage` from `@mariozechner/pi-coding-agent` via agent-core's `getApiKey` hook
- Same `~/.pi/agent/auth.json` + OAuth refresh flow, with file-locked refresh handling
- `onPayload` for debug request logging

## Open Questions

- [ ] Do we still need EventStore/ChatEvent layer, or can AgentEvent replace it?
- [ ] Compaction: port from coding-agent later, or stub `transformContext` hook now?
- [ ] Session file format: match coding-agent's JSONL exactly, or allow assistant-specific extensions?
- [ ] How to handle interaction events (question elicitation) — side effects in `execute()` confirmed, but need to design the async response flow
- [ ] Agent exchange ID tagging — where exactly to attach in the new event flow
- [ ] Do we keep request-level turn boundaries based on current assistant semantics, or change the
  product contract to expose agent-core internal turns? Current UI/history code assumes the former.

## Sequencing

1. Add `pi-agent-core` and `pi-coding-agent` dependencies and verify the actual exported APIs
2. Build a new pi-native runtime with temporary internal adapters only where necessary:
   - agent-core loop
   - existing tool-host bridge
   - existing `ChatEvent` / EventStore emission
   - existing session writer or a target-format replacement
3. Prove parity for:
   - streaming text / thinking / tool updates
   - `agents_message` sync + async callbacks
   - interruption / partial persistence
   - replay / reconnect / questionnaire recovery
4. Route `provider === 'pi'` to the new path
5. Remove old `chatRunCore.ts` / `piSdkProvider.ts` loop code
6. Simplify tools, replay, and session writing after the runtime cutover is stable
7. Strip CLI providers / legacy TTS only after the native path is the default
8. (Later) Add CLI/Codex sidecars back as isolated modules
9. (Later) Port compaction from coding-agent
