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

## Architecture

### Target Design

```
User input → SessionHub → piNativeChat module
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
                         Event Listener
                         - → ServerMessage (WebSocket to UI)
                         - → Pi session file (persistence)
                         - → ChatEvent / EventStore (evaluate if still needed)
```

### Key Decisions

- Agent-core owns the loop, tool dispatch, and streaming
- Assistant owns event translation, session persistence, and UI transport
- No shared abstraction layer between pi-native and future CLI/Codex sidecars
- Tools implement `AgentTool` interface directly (no adapter wrappers)

## Phase 1: Strip

Remove before rebuilding. These are either replaced by agent-core or deferred to later sidecar work.

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
- **Auth flow** — `piAgentAuth.ts` (reuse via agent-core's `getApiKey` hook)
- **WebSocket transport** — `ServerMessage` types to UI clients
- **EventStore** — evaluate if still needed; keep for now
- **Built-in tools** — rewrite to `AgentTool` interface but keep functionality
- **System prompt building** — `systemPromptUpdater.ts`

## Phase 3: Rebuild on Agent-Core

### 3.1 Pi Native Chat Module (new, greenfield)

New module (e.g., `piNativeChat.ts`) that:
- Creates and manages an `Agent` instance from `@mariozechner/pi-agent-core`
- Configures model, thinking level, tools, system prompt
- Calls `agent.prompt()` for new messages, `agent.continue()` for resume
- Subscribes to `AgentEvent` stream for all downstream side effects

### 3.2 Tools → AgentTool

Rewrite assistant's tools to implement `AgentTool` directly:
- `execute(toolCallId, params, signal, onUpdate)` returning `AgentToolResult`
- Parsed params (not raw JSON string)
- Structured return type with `content` + `details`
- Interaction events (question elicitation) emitted as side effects from within `execute()`

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
| `turn_end` | context usage update, turn_end ChatEvent |
| `agent_end` | finalization |

### 3.4 Session Writer (simplified rewrite)

- Write pi-compatible JSONL session files
- Messages are already native pi-ai format — no conversion needed
- Custom entries for agent messages (`assistant.input` with `kind: 'agent_message'` / `kind: 'callback'`)
- Turn boundaries from agent-core's `turn_start` / `turn_end` events
- Target: dramatically smaller than current 1831-line `piSessionWriter.ts`

### 3.5 Session Replay / Resume

- Use `agent.continue()` / `agentLoopContinue` for session resume
- Load session file, reconstruct `AgentMessage[]`, set on agent context
- `convertToLlm` handles any custom message types

### 3.6 Auth

- Reuse `piAgentAuth.ts` logic via agent-core's `getApiKey` hook
- Same `~/.pi/agent/auth.json` + OAuth refresh flow
- `onPayload` for debug request logging

## Open Questions

- [ ] Do we still need EventStore/ChatEvent layer, or can AgentEvent replace it?
- [ ] Compaction: port from coding-agent later, or stub `transformContext` hook now?
- [ ] Session file format: match coding-agent's JSONL exactly, or allow assistant-specific extensions?
- [ ] How to handle interaction events (question elicitation) — side effects in `execute()` confirmed, but need to design the async response flow
- [ ] Agent exchange ID tagging — where exactly to attach in the new event flow

## Sequencing

1. Strip CLI providers and legacy TTS
2. Build new pi-native chat module with Agent instance
3. Rewrite tools to AgentTool interface
4. Build AgentEvent → ServerMessage adapter
5. Rewrite session writer for native messages
6. Wire into SessionHub routing
7. Test end-to-end
8. Remove old `chatRunCore.ts` and related dead code
9. (Later) Add CLI/Codex sidecars back as isolated modules
10. (Later) Port compaction from coding-agent
