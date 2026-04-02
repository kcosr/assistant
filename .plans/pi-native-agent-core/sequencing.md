# Sequencing — Implementation Order

## Principles

- Each step should leave the codebase in a consistent state
- Runtime parity comes before simplification
- The greenfield pi-native module is built first, then old code is removed
- Strip old providers only after the new native path is proven end-to-end

## Phase 1: Add Dependencies and Lock API Assumptions

**Goal**: make `pi-agent-core` / `pi-coding-agent` available and verify the plan against the real
APIs.

### Step 1.1: Add package dependencies

- Add `@mariozechner/pi-agent-core` to `agent-server/package.json`
- Add `@mariozechner/pi-coding-agent` to `agent-server/package.json`
- Test: `npm install` succeeds, imports resolve, and the server build still works with the added dependency tree.

### Step 1.2: Lock actual API assumptions

- Verify actual `Agent`, `AgentEvent`, `AgentTool`, `AuthStorage`, and coding-tool exports
- Document the mismatches that matter:
  - internal agent turn semantics vs assistant request semantics
  - `continue()` restrictions
  - `tool_execution_update` + `toolResult` message ordering
  - session-writer compatibility requirements
- Test: plan docs updated before implementation starts.

## Phase 2: Build Pi-Native Chat Module Behind Compatibility Adapters

**Goal**: build the new runtime without rewriting the whole replay/tool stack in one pass.

### Step 2.1: Model resolution utility

- Extract `resolvePiSdkModel()` from `piSdkProvider.ts` into `llm/modelResolution.ts`
- Keep only model resolution logic
- Test: import works and provider/model resolution matches current behavior.

### Step 2.2: Auth setup

- Import `AuthStorage` from `@mariozechner/pi-coding-agent`
- Create auth initialization that calls `AuthStorage.create()`
- Verify it reads `~/.pi/agent/auth.json` and resolves API keys
- Test: `authStorage.getApiKey(provider)` works for configured providers.

### Step 2.3: Compatibility tool adapter

- Keep the current tool-host path for the first cut
- Build an adapter that exposes scoped `ToolHost` tools as `AgentTool`s
- Preserve approvals, interactions, MCP/plugin loading, and nested chunk forwarding
- Test: existing built-in and plugin tools can execute through the adapter.

### Step 2.4: Optional coding-tool imports

- Import `createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`,
  `createGrepTool`, `createFindTool`, and `createLsTool` from `@mariozechner/pi-coding-agent`
- Validate whether using the exported package directly is acceptable in the server build/runtime
- Test: tools instantiate and the dependency surface is acceptable.

### Step 2.5: Pi-native chat module (core)

- Create new `piNativeChat.ts`
- Create `Agent` with model, thinking, tools, system prompt, `convertToLlm`, and `getApiKey`
- Implement an assistant request adapter on top of `AgentEvent`
- Keep emitting current `ChatEvent` and `ServerMessage` payloads
- Test: send a message and receive streamed text/thinking/tool updates with current client expectations.

### Step 2.6: Tool execution in the loop

- Wire tools into the `Agent`
- Verify tool calls execute and results feed back to the LLM
- Verify `tool_execution_start/update/end` and `toolResult` `message_start/message_end` events are mapped correctly
- Test: send a message that triggers tool use and verify the full loop.

### Step 2.7: Keep replay compatibility

- Continue emitting current `ChatEvent` sequences for EventStore
- Continue supporting `SessionHub.resolveChatMessages()` and `PiSessionHistoryProvider`
- Test: reconnect/reload shows the same transcript as before.

## Phase 3: Persistence Cutover

**Goal**: persist conversations to pi-compatible JSONL files without breaking current replay/history.

### Step 3.1: Compatibility-first session writer

- Either:
  - adapt the current writer to the new runtime, or
  - implement a new writer that preserves the same entry graph and assistant-specific entries
- Keep request-level turn boundaries, assistant events, session info, and history-editing support
- Test: run a chat turn, verify JSONL is written correctly and current replay still works.

### Step 3.2: Session resume

- Load existing JSONL into `AgentMessage[]`
- Set on agent via `agent.replaceMessages()`
- Use `agent.prompt()` for the next user turn
- Reserve `agent.continue()` for retry / queued-message cases only
- Test: start a session, stop, resume, and verify conversation continues.

### Step 3.3: Define the parity gate explicitly

The cutover is blocked until these cases pass:

- event mapping
  - text deltas
  - thinking start/delta/end
  - toolcall input streaming
  - tool execution start/update/end
  - toolResult message persistence
- request semantics
  - one assistant request spanning multiple internal agent turns
  - assistant request finalization exactly once
- `agents_message`
  - sync mode
  - async mode
  - callback turn
  - nested chunk forwarding
- interruption
  - abort before output
  - abort after partial text
  - abort during tool execution
- persistence / replay
  - fresh session
  - resumed session
  - reconnect / replay
  - questionnaire / interaction recovery
  - turn-history editing
- session config changes
  - model change
  - thinking-level change

## Phase 4: Wire Into SessionHub

**Goal**: replace the old pi chat path with the new native module.

### Step 4.1: Route `provider === 'pi'` to new module

- Update `chatProcessor.ts` (or its replacement) to route `provider === 'pi'` to `piNativeChat`
- Wire session state, sessionHub, and EventStore connections
- Handle agent exchange ID tagging
- No long-lived dual routing or fallback path. Switch only after the parity gate passes.
- Test: end-to-end chat works through the normal UI flow, including `agents_message`, callbacks, interruption, and replay.

### Step 4.2: Context usage tracking

- Extract usage from `AssistantMessage` on `message_end` / request finalization
- Update session context usage via `sessionHub`
- Test: UI shows context usage percentage.

## Phase 5: Remove Old Code and Simplify

**Goal**: delete the old pi loop after the new path is stable.

### Step 5.1: Remove old pi loop infrastructure

- Delete `chatRunCore.ts`
- Delete `chatCompletionTypes.ts`
- Delete `llm/piSdkProvider.ts` loop code
- Delete `history/piSessionSync.ts`
- Delete or replace `history/piSessionWriter.ts` only after parity tests pass
- Delete or replace `history/piSessionReplay.ts` only after parity tests pass
- Delete `llm/piAgentAuth.ts`
- Test: project compiles and tests pass.

### Step 5.2: Simplify surviving files

- Simplify `sessionHub.ts`
- Simplify `agents.ts`
- Simplify `envConfig.ts`
- Simplify `sessionModel.ts`
- Update `chatProcessor.ts`
- Test: project compiles and full end-to-end chat works.

## Phase 6: Strip CLI Providers and Legacy TTS

**Goal**: remove code that is no longer needed after the native path is the default.

### Step 6.1: Remove CLI provider implementations

- Delete `ws/claudeCliChat.ts`, `ws/codexCliChat.ts`, `ws/piCliChat.ts`
- Delete `ws/cliCallbackFactory.ts`, `ws/cliRuntimeConfig.ts`, `ws/cliEnv.ts`,
  `ws/cliProcessRegistry.ts`, `ws/cliToolCallRendezvous.ts`
- Delete `codexSessionStore.ts`
- Delete associated tests
- Remove CLI provider types from `agents.ts`
- Update exports
- Test: project compiles and the native path remains stable.

### Step 6.2: Remove legacy TTS

- Delete `tts/` directory
- Delete `elevenLabsTts.ts`
- Remove TTS wiring from surviving runtime files
- Remove TTS env config from `envConfig.ts`
- Test: project compiles and no TTS references remain.

## Phase 7: Future Work

- Port compaction from coding-agent
- Add CLI/Codex sidecars back as isolated modules
- Remove EventStore once replay no longer depends on `ChatEvent`
