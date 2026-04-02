# Strip List — Files to Remove or Rewrite

This list reflects the end state, not the first implementation step. Several of these files are
still part of the active runtime and replay path today, so they should be removed only after the
new pi-native path is wired and parity-tested.

Total lines in files targeted for removal/rewrite: **~8,654 lines** (source only, excludes tests).

## 1. CLI Providers — Remove Entirely (after native cutover)

These implement the claude-cli, codex-cli, and pi-cli subprocess-based providers. Remove them only
after the native path is the default and parity-tested, then optionally re-add them later as
isolated sidecars.

| File | Lines | Purpose |
|---|---|---|
| `ws/claudeCliChat.ts` | 803 | Claude CLI subprocess driver |
| `ws/codexCliChat.ts` | 972 | Codex CLI subprocess driver |
| `ws/piCliChat.ts` | 717 | Pi CLI subprocess driver |
| `ws/cliCallbackFactory.ts` | 199 | Shared CLI tool call event adapter |
| `ws/cliRuntimeConfig.ts` | 52 | CLI runtime config resolution |
| `ws/cliEnv.ts` | 31 | CLI environment variable helpers |
| `ws/cliProcessRegistry.ts` | 81 | CLI process lifecycle tracking |
| `ws/cliToolCallRendezvous.ts` | 170 | CLI tool call request/response matching |
| `codexSessionStore.ts` | 148 | Codex session ID mapping persistence |

**Total: ~3,173 lines**

### Test files also removed:
- `ws/claudeCliChat.test.ts`
- `ws/codexCliChat.test.ts`
- `ws/piCliChat.test.ts`
- `ws/cliRuntimeConfig.test.ts`
- `ws/cliEnv.test.ts`
- `ws/cliToolCallRendezvous.test.ts`
- `ws/chatRunLifecycle.claudeCli.test.ts`
- `ws/chatRunLifecycle.codexCli.test.ts`
- `ws/chatRunLifecycle.piCli.test.ts`

### References to clean up:
- `chatRunCore.ts` — the `claude-cli`, `codex-cli`, `pi-cli` branches in `runChatCompletionCore()`
- `chatProcessor.ts` — CLI provider routing
- `ws/chatRunLifecycle.ts` — CLI provider wiring
- `sessionHub.ts` — codex session store references
- `envConfig.ts` — CLI-related env vars
- `agents.ts` — CLI provider type definitions
- `index.ts` — exports

## 2. Legacy TTS — Remove Entirely (after native cutover)

Server-side text-to-speech integration (ElevenLabs, OpenAI TTS). Replaced by separate voice adapter architecture.

| File | Lines | Purpose |
|---|---|---|
| `tts/backends.ts` | 2 | Re-export barrel |
| `tts/elevenLabsTtsBackend.ts` | 238 | ElevenLabs streaming TTS |
| `tts/openAiTtsBackend.ts` | 238 | OpenAI streaming TTS |
| `tts/sanitizeTtsText.ts` | 7 | Text sanitization for TTS |
| `tts/selectTtsBackendFactory.ts` | 62 | Backend selection factory |
| `tts/types.ts` | 15 | TTS type definitions |
| `elevenLabsTts.ts` | 406 | Legacy ElevenLabs integration |

**Total: ~968 lines**

### References to clean up:
- `chatRunCore.ts` — `createTtsSession()`, `ttsSession.appendText()` in stream handlers
- `ws/chatRunLifecycle.ts` — TTS session creation and finish
- `sessionHub.ts` — TTS backend factory reference
- `sessionMessages.ts` — `ttsBackendFactory` parameter
- `envConfig.ts` — ElevenLabs/OpenAI TTS config vars
- `ws/chatOutputCancelHandling.ts` — TTS session cleanup

## 3. Dual Message Format — Remove / Rewrite

The `ChatCompletionMessage` type and all translation plumbing between it and pi-ai native messages.

| File | Lines | Purpose |
|---|---|---|
| `chatCompletionTypes.ts` | 59 | `ChatCompletionMessage` type definition |
| `llm/piSdkProvider.ts` | 637 | `buildPiContext()`, `runPiSdkChatCompletionIteration()`, tool mapping, text signature encoding |
| `history/piSessionSync.ts` | 65 | `piSdkMessage` sidecar attachment logic |

**Total: ~761 lines**

### What happens to each:
- `chatCompletionTypes.ts` — **deleted**. Replaced by pi-ai native `Message` / `AgentMessage` types.
- `piSdkProvider.ts` — **mostly deleted**. Model resolution (`resolvePiSdkModel`) may be kept or moved. `buildPiContext()` and `runPiSdkChatCompletionIteration()` are replaced by agent-core's loop. Tool mapping replaced by native `AgentTool`. Text signature helpers may be kept if still needed.
- `piSessionSync.ts` — **deleted**. No more sidecar attachment needed when messages are native.

Migration note: if a temporary internal projection from assistant state into
`ChatCompletionMessage` is needed while implementation is in flight, treat it as throwaway
scaffolding and remove it before the migration is considered complete.

### Files with `ChatCompletionMessage` references that need updating:
- `chatProcessor.ts`
- `chatRunCore.ts`
- `builtInTools.ts`
- `sessionChatMessages.ts`
- `sessionMessages.ts`
- `sessionHub.ts`
- `ws/chatRunLifecycle.ts`
- `ws/chatCompletionStreaming.ts`
- `ws/toolCallHandling.ts`
- `ws/multiplexedConnection.ts`
- `ws/sessionRuntime.ts`
- `projections/toOpenAIMessages.ts`
- `history/piSessionWriter.ts`
- `history/piSessionReplay.ts`

## 4. Shared Chat Run Infrastructure — Rewrite

These files implement the current shared agent loop and stream handling. Replaced by the new pi-native module built on agent-core.

| File | Lines | Purpose |
|---|---|---|
| `chatRunCore.ts` | 1,238 | Agent loop, stream handlers, all provider dispatch, TTS wiring, debug logging |
| `chatProcessor.ts` | 881 | Turn orchestration, tool call handling, finalization |

**Total: ~2,119 lines**

### What happens:
- `chatRunCore.ts` — **deleted**. Replaced by new pi-native chat module using `Agent` from agent-core.
- `chatProcessor.ts` — **heavily rewritten**. Turn orchestration logic survives in simplified form, but the provider dispatch, stream handling, and tool call loop are all replaced.

Do not delete these files before the new path covers:
- current ServerMessage payloads
- current ChatEvent payloads
- interruption / partial persistence
- `agents_message` sync + async callbacks

## 5. Session History — Rewrite

| File | Lines | Purpose |
|---|---|---|
| `history/piSessionWriter.ts` | 1,831 | Writes pi-compatible session JSONL files |
| `history/piSessionReplay.ts` | 683 | Replays session files for resume |

**Total: ~2,514 lines**

### What happens:
- `piSessionWriter.ts` — **rewritten or adapted**, but it still has to preserve entry chaining,
  assistant-specific custom entries, and history editing.
- `piSessionReplay.ts` — **rewritten**. Normal session resume should load messages into
  `agent.replaceMessages()` and use `agent.prompt()` for the next user turn. `continue()` is not
  the generic resume primitive.

## 6. Files That Survive With Modifications

These files reference stripped code and need targeted cleanup, but are not themselves removed:

- `envConfig.ts` — remove TTS and CLI env vars
- `agents.ts` — remove CLI provider types, simplify to pi-native only
- `sessionHub.ts` — remove TTS factory, codex store, CLI session tracking
- `ws/chatRunLifecycle.ts` — rewrite to use new pi-native module
- `ws/toolCallHandling.ts` — adapt to `AgentTool` interface
- `ws/sessionRuntime.ts` — remove CLI provider references
- `builtInTools.ts` — rewrite tools to `AgentTool` interface
- `sessionMessages.ts` — remove TTS, simplify message handling
- `sessionChatMessages.ts` — adapt to native message types
- `index.ts` — update exports

Additional files that are currently still on the replay critical path and should not be removed
early:

- `history/historyProvider.ts`
- `events/chatEventUtils.ts`

## Summary

| Category | Lines removed/rewritten |
|---|---|
| CLI providers | ~3,173 |
| Legacy TTS | ~968 |
| Dual message format | ~761 |
| Shared chat run infra | ~2,119 |
| Session history | ~2,514 |
| **Total** | **~9,535** |

This does not count test files or the modifications needed in surviving files.
