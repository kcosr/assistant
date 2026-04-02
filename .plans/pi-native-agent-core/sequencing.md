# Sequencing — Implementation Order

## Principles

- Each step should leave the codebase in a consistent state (may be non-functional for chat, but should compile)
- Steps are ordered by dependency — later steps build on earlier ones
- The greenfield pi-native module is built first, then old code is removed
- CLI/Codex providers are stripped early to reduce noise, added back later as sidecars

## Phase 1: Strip CLI Providers and Legacy TTS

**Goal**: Remove code that won't exist in the new architecture. Reduces noise for the rebuild.

### Step 1.1: Remove CLI provider implementations
- Delete `ws/claudeCliChat.ts`, `ws/codexCliChat.ts`, `ws/piCliChat.ts`
- Delete `ws/cliCallbackFactory.ts`, `ws/cliRuntimeConfig.ts`, `ws/cliEnv.ts`, `ws/cliProcessRegistry.ts`, `ws/cliToolCallRendezvous.ts`
- Delete `codexSessionStore.ts`
- Delete all associated test files
- Remove CLI branches from `chatRunCore.ts` `runChatCompletionCore()` (leave only `pi` branch)
- Remove CLI provider types from `agents.ts`
- Update `index.ts` exports
- **Test**: Project compiles. CLI providers are gone.

### Step 1.2: Remove legacy TTS
- Delete `tts/` directory
- Delete `elevenLabsTts.ts`
- Remove TTS wiring from `chatRunCore.ts` (`createTtsSession`, `ttsSession.appendText`)
- Remove TTS from `ws/chatRunLifecycle.ts`, `sessionHub.ts`, `sessionMessages.ts`
- Remove TTS env config from `envConfig.ts`
- **Test**: Project compiles. No TTS references remain.

## Phase 2: Add Dependencies

**Goal**: Make agent-core and coding-agent packages available.

### Step 2.1: Add package dependencies
- Add `@mariozechner/pi-agent-core` to `agent-server/package.json`
- Add `@mariozechner/pi-coding-agent` to `agent-server/package.json` (for coding tools and AuthStorage)
- **Test**: `npm install` succeeds, imports resolve.

## Phase 3: Build Pi-Native Chat Module

**Goal**: New greenfield module that handles chat using agent-core. Built alongside old code, not yet wired in.

### Step 3.1: Model resolution utility
- Extract `resolvePiSdkModel()` from `piSdkProvider.ts` into `llm/modelResolution.ts`
- Keep only model resolution logic, drop everything else (buildPiContext, runPiSdkChatCompletionIteration, tool mapping)
- **Test**: Import works, model resolution resolves provider/model strings.

### Step 3.2: Auth setup
- Import `AuthStorage` from `@mariozechner/pi-coding-agent`
- Create auth initialization that calls `AuthStorage.create()`
- Verify it reads `~/.pi/agent/auth.json` and resolves API keys
- **Test**: `authStorage.getApiKey('anthropic')` returns a key.

### Step 3.3: Coding tools
- Import `createReadTool`, `createWriteTool`, `createEditTool`, `createBashTool`, `createGrepTool`, `createFindTool`, `createLsTool` from `@mariozechner/pi-coding-agent`
- Create helper that builds coding `AgentTool[]` for a given `cwd`
- **Test**: Tools instantiate, have correct names/schemas.

### Step 3.4: Plugin tool generation
- Update `plugins/registry.ts` and `plugins/operations.ts` to generate `AgentTool` format
- Change handler signature: parsed params, structured return, signal parameter
- Handle schema conversion (TypeBox `Type.Unsafe()` or pass-through)
- Build `ToolContext` from closure-captured session state
- **Test**: Plugin tools generate as `AgentTool[]`, handlers execute.

### Step 3.5: Built-in tools
- Rewrite `voice_speak`, `voice_ask`, `attachment_send` as `AgentTool` implementations
- Rewrite `agents_message` as `AgentTool` that routes through SessionHub
- **Test**: Tools instantiate, basic execution works.

### Step 3.6: Pi-native chat module (core)
- Create new `piNativeChat.ts` module
- Create `Agent` instance with model, thinking, tools, system prompt, `convertToLlm`, `getApiKey`
- Implement `AgentEvent` listener with:
  - `ServerMessage` emission to WebSocket
  - `ChatEvent` emission to EventStore
  - State tracking (`accumulatedText`, `outputStarted`)
- Implement `handlePiNativeChat()` entry point (new turn)
- Implement abort via `agent.abort()`
- **Test**: Send a message, receive streamed text back via WebSocket.

### Step 3.7: Tool execution in the loop
- Wire tools into the Agent instance
- Verify tool calls execute and results feed back to LLM
- Verify tool lifecycle events (`tool_execution_start/update/end`) emit correct ServerMessages
- **Test**: Send a message that triggers tool use, verify full loop works.

## Phase 4: Session Writer

**Goal**: Persist conversations to pi-compatible JSONL files.

### Step 4.1: New session writer
- Implement simplified append-only JSONL writer
- Entry types: session header, message, model_change, thinking_level_change, custom, custom_message
- Event-driven: write entries from AgentEvent listener
- Handle agent message custom entries (`assistant.input` with agent/callback metadata)
- Handle turn boundary custom entries (`assistant.turn_start`, `assistant.turn_end`)
- **Test**: Run a chat turn, verify JSONL file is written with correct entries. Verify pi CLI can open the file.

### Step 4.2: Session resume
- Load existing JSONL session file into `AgentMessage[]`
- Set on agent via `agent.replaceMessages()`
- Use `agent.prompt()` for the next turn (agent-core handles the context)
- **Test**: Start a session, stop, resume, verify conversation continues.

## Phase 5: Wire Into SessionHub

**Goal**: Replace the old chat path with the new pi-native module.

### Step 5.1: Route pi provider to new module
- Update `chatProcessor.ts` (or its replacement) to route `provider === 'pi'` to `piNativeChat`
- Wire session state, sessionHub, eventStore connections
- Handle agent exchange ID tagging
- **Test**: End-to-end chat works through the normal UI flow.

### Step 5.2: Context usage tracking
- Extract usage from `AssistantMessage` on `message_end` / `turn_end`
- Update session context usage via sessionHub
- **Test**: UI shows context usage percentage.

## Phase 6: Remove Old Code

**Goal**: Delete everything replaced by the new pi-native module.

### Step 6.1: Remove old chat infrastructure
- Delete `chatRunCore.ts`
- Delete `chatCompletionTypes.ts`
- Delete `llm/piSdkProvider.ts` (model resolution already extracted)
- Delete `history/piSessionSync.ts`
- Delete `history/piSessionWriter.ts` (replaced by new writer)
- Delete `history/piSessionReplay.ts` (replaced by new resume logic)
- Delete `llm/piAgentAuth.ts` (replaced by AuthStorage import)
- Remove `ChatCompletionMessage` references from all surviving files
- **Test**: Project compiles. All tests pass.

### Step 6.2: Clean up surviving files
- Simplify `sessionHub.ts` — remove CLI session tracking, old TTS factory, codex store
- Simplify `agents.ts` — remove CLI provider types
- Simplify `envConfig.ts` — remove CLI and TTS config
- Simplify `sessionModel.ts` — remove CLI-specific resolution
- Update `chatProcessor.ts` — remove old provider dispatch
- **Test**: Project compiles. Full end-to-end chat works.

## Phase 7: Future Work (not part of this migration)

- Port compaction from coding-agent (implement `transformContext` hook)
- Add CLI/Codex agents back as isolated sidecars
- Remove EventStore once frontend can work with session file + WebSocket directly
- Implement steering/follow-up message support for advanced workflows
