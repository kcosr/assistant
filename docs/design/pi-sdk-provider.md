# Native Pi SDK chat provider

## Overview

Replace the OpenAI chat integration in assistant with the native Pi SDK integration
used by agent-hub. We will add a Pi SDK provider that wraps `@mariozechner/pi-ai`
streaming (ported from `../omni-channel-suite/packages/hub/src/llm/sdkProvider.ts`) and wire it
into the agent server’s chat run loop so tool calls, streaming deltas, and event logging continue
to work. OpenAI-compatible providers will be configured inside Pi and accessed through the SDK.

## Goals

- Use the Pi SDK (`@mariozechner/pi-ai`) for in-process chat completions.
- Preserve streaming deltas, tool call handling, and chat event logging.
- Support per-agent model selection and session overrides.
- Document configuration and defaults clearly.

## Non-Goals

- Replacing CLI providers (`claude-cli`, `codex-cli`, `pi-cli`).
- Changing tool system semantics or UI behavior beyond required event mapping.
- Replacing OpenAI TTS or STT (unless explicitly requested).

## Current State

- In-process chat completions use the OpenAI SDK (`openai` / `openai-compatible`).
- Tool call streaming and iteration logic is OpenAI-specific.
- Default chat provider is `openai` when unspecified.
- Pi integration exists only via `pi-cli`.

## Proposed Design

### Provider Type

- Add a new provider id: `pi-sdk` (or `pi`) and make it the default when `chat.provider` is omitted.
- Extend provider unions and schemas in `AgentDefinition`, `config.ts`, and `sessionModel.ts`.
- Replace existing OpenAI chat provider wiring; `openai` / `openai-compatible` are removed
  from assistant chat providers (Pi acts as the API provider hub).

### Config

Add `PiSdkChatConfig` with defaults aligned to agent-hub (per-agent only), exposing
the common connection settings from the prior OpenAI flow:

- `provider` (string, default `pi`)
- `models` (string[], required unless provided by session)
- `thinking` (string[], optional; `off|minimal|low|medium|high|xhigh`)
- `apiKey?` (Pi provider API key)
- `baseUrl?` (OpenAI-compatible or proxy endpoint handled by Pi)
- `headers?` (string map, optional)
- `timeoutMs?`
- `maxTokens?`
- `temperature?`

Config is per-agent only; no environment defaults. Pi becomes the hub for upstream
provider configuration (OpenAI-compatible, etc.), but assistant exposes the common
connection settings above for parity with the previous OpenAI integration.

### Runtime Flow

Introduce a Pi SDK adapter similar to `SdkLlmProvider` in agent-hub:

1. Convert `state.chatMessages` (OpenAI-style) into Pi SDK `Context`:
   - System prompt → `context.systemPrompt`.
   - User/assistant text → Pi `messages` with `role: "user" | "assistant"`.
   - Tool calls → assistant `content` blocks with `toolCall` entries.
   - Tool results → `role: "toolResult"` with `toolCallId`, `toolName`, and text content.
2. Map tools into Pi SDK `context.tools` using the same JSON schema as today.
3. Stream with `streamSimple(model, context, options)` to pass Pi reasoning options.
   - On `text_delta`: emit `emitTextDelta`.
   - On `thinking_start/delta/end`: emit `emitThinkingStart/Delta/Done`.
   - On `toolcall_end`: create a `ChatCompletionToolCallState`, emit `tool_call_start`, and
     emit a single `tool_input_chunk` with the full args JSON.
4. Return text + tool calls to the same iteration loop used by OpenAI, so `handleChatToolCalls`
   and multi-step tool runs continue to work.

### Model + Provider Mapping

- Accept `models` entries in `provider/model` form (same as `pi-cli`).
- If a model entry includes a provider prefix, use that provider for resolution.
- If no prefix is present, fall back to the configured `provider`.
- The mapping mirrors pi-mono’s model resolver behavior (case-insensitive provider/model match).

### Thinking Mapping

- When `chat.thinking` is set, store the selected level in session summary.
- Convert thinking level to Pi SDK `reasoning` option:
  - `off` → omit `reasoning` (Pi defaults to reasoning disabled).
  - `minimal|low|medium|high|xhigh` → pass through to `streamSimple(..., { reasoning })`.

### Error Handling

- If the SDK result has `stopReason: "error"` or `"aborted"`, throw `ChatRunError`.
- Preserve current retry/abort behavior (no new retries introduced).

### Dependencies

- Add `@mariozechner/pi-ai` to `packages/agent-server/package.json`.
- Keep `openai` only if still required for TTS/STT.

### Docs & Defaults

- Update `docs/CONFIG.md` with `pi-sdk` provider docs and examples.
- Update `docs/design/agents.md` provider list.
- Update `packages/agent-server/data/config.json` to use `pi-sdk` for the built-in Pi agent.

### Tests

- New adapter unit tests for message conversion + tool call mapping.
- New lifecycle tests covering streaming and tool calls for `pi-sdk`.
- Schema tests for config parsing and provider validation.

## Files to Update

- `packages/agent-server/src/chatRunCore.ts`
- `packages/agent-server/src/ws/chatCompletionStreaming.ts` (or new Pi SDK runner file)
- `packages/agent-server/src/agents.ts`
- `packages/agent-server/src/config.ts`
- `packages/agent-server/src/sessionModel.ts`
- `packages/agent-server/src/envConfig.ts`
- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/sessionMessages.ts`
- `packages/agent-server/src/ws/multiplexedConnection.ts`
- `packages/agent-server/package.json`
- `packages/agent-server/data/config.json`
- `docs/CONFIG.md`
- `docs/design/agents.md`
- new: `packages/agent-server/src/llm/piSdkProvider.ts`
- tests under `packages/agent-server/src/**/__tests__` or adjacent test files

## Open Questions

None.

## Future Considerations

- **pi-coding-agent mode (headless)**: Consider integrating `@mariozechner/pi-coding-agent`
  `createAgentSession()` to leverage Pi’s built-in tools (`read`, `bash`, `edit`, `write`, etc.),
  tool registry, and extension system without the TUI. This would require mapping agent events to
  assistant UI/logs and deciding whether to replace or merge assistant tools (MCP/plugins) with
  Pi’s built-ins.
- **Tool strategy**: In a coding-agent mode, choose between:
  - Replace assistant tools with Pi built-ins for a consistent tool UX, or
  - Merge Pi built-ins + assistant MCP tools via `customTools`.
- **Session storage**: Decide whether to adopt Pi’s session manager/storage or adapt it to
  assistant’s session model and event log.

## Feedback

### ✅ Strengths

1. **Clear goals and scope** - The document cleanly separates in-scope (Pi SDK integration) from out-of-scope (CLI providers, TTS/STT).

2. **Good runtime flow overview** - The message conversion steps are well documented (OpenAI messages → Pi SDK Context).

3. **Comprehensive file list** - All relevant files are identified for modification.

### ⚠️ Issues & Concerns

#### 1. Missing Provider Type in Schema

The design says to add `pi-sdk` or `pi` provider, but the current `ChatProviderSchema` in `config.ts` only includes:

```typescript
const ChatProviderSchema = z.enum([
  'openai',
  'claude-cli',
  'codex-cli',
  'pi-cli',
  'openai-compatible',
]);
```

The design should explicitly specify:
- What happens to existing `openai` and `openai-compatible` providers? The doc says "removed" but doesn't specify migration path.
- If `pi` becomes the default, existing configs with `provider: "openai"` will break.

#### 2. Config Schema Mismatch

The proposed `PiSdkChatConfig` has:

```
- provider (string, default pi)
- model (string, required unless provided by session)
- apiKey?
- baseUrl?
- timeoutMs?
```

But the current pattern (see `OpenAiCompatibleChatConfig`) uses `models: string[]` (plural), not `model`. This inconsistency will cause confusion. Recommend aligning with the existing pattern:

```typescript
interface PiSdkChatConfig {
  models?: string[];  // Not "model"
  thinking?: string[];
  timeoutMs?: number;
  // apiKey/baseUrl should be configured in Pi itself, not here
}
```

#### 3. Missing Environment Config Handling

The design says "Config is per-agent only; no environment defaults" but:
- Current `envConfig.ts` handles `OPENAI_API_KEY` and `OPENAI_CHAT_MODEL` environment variables
- If Pi SDK becomes default, what environment variables are needed?
- Should document `PI_*` environment variables or reference Pi's own config

#### 4. Incomplete Tool Call Handling

The design mentions mapping tools to Pi SDK format but doesn't address:
- The current `handleChatToolCalls` expects `ChatCompletionToolCallState[]` (OpenAI format)
- The design says "Return text + tool calls to the same iteration loop" but doesn't explain the mapping from Pi SDK tool call format back to OpenAI format
- The `createCliToolCallbacks` pattern used for CLI providers might be more appropriate

#### 5. Missing `sessionMessages.ts` Conversion Details

Listed in files to update but no details on what changes are needed. Currently chat messages are in OpenAI format (`ChatCompletionMessage[]`). Need to clarify:
- Will state store Pi format or OpenAI format?
- Who converts between formats and when?

#### 6. Error Handling Gap

The design mentions `stopReason: "error"` but doesn't address:
- Rate limit handling (Pi SDK specific)
- Context window overflow
- API timeouts
- How to preserve existing retry behavior without "new retries introduced"

#### 7. Missing Stream Handler Integration

The `createChatRunStreamHandlers` in `chatRunCore.ts` is tightly coupled to the output adapter. Need to specify:
- How Pi SDK `text_delta` maps to `emitTextDelta` signature `(deltaText, textSoFar)`
- Pi SDK streaming likely has different event structure than documented

### 🔧 Suggested Improvements

#### 1. Add Migration Section

```markdown
## Migration Path
- Existing `openai` configs will work unchanged (Pi wraps OpenAI)
- `openai-compatible` becomes a Pi provider configuration
- Add deprecation warnings for direct OpenAI config
```

#### 2. Add Detailed Message Mapping

```markdown
### Message Conversion (OpenAI → Pi SDK)

| OpenAI Format | Pi SDK Format |
|---------------|---------------|
| `role: "system"` | `context.systemPrompt` |
| `role: "user"` | `messages[].role = "user"` |
| `role: "assistant"` | `messages[].role = "assistant"` |
| `role: "tool"` | `role: "toolResult"` |
| `tool_calls[]` | `content[].toolCall` |
```

#### 3. Add Thinking Support

Current codebase supports `thinking` for `pi-cli` and `codex-cli`. Design should specify:
- Does Pi SDK expose thinking/reasoning?
- How to map `emitThinkingStart/Delta/Done` handlers?

#### 4. Add Test Strategy

The tests section is vague. Suggest:

```markdown
### Tests
1. Unit: `piSdkProvider.test.ts`
   - Message conversion (all message types)
   - Tool schema mapping
   - Error mapping to ChatRunError
2. Integration: `chatRunCore.test.ts`
   - Add `pi-sdk` provider cases alongside existing openai tests
3. E2E: Add pi-sdk agent to test config
```

#### 5. Consider Hybrid Approach

Instead of removing `openai`/`openai-compatible`:
- Keep them as aliases that internally use Pi SDK
- Less disruptive migration
- Pi SDK handles the actual API calls

### 📋 Files Missing from Update List

1. `packages/agent-server/src/chatCompletionTypes.ts` - May need updates for Pi-specific types
2. `packages/agent-server/src/history/providerAttributes.ts` - Provider attribute storage for `pi-sdk`
3. `packages/agent-server/src/ws/cliCallbackFactory.ts` - If using similar callback pattern
4. `packages/agent-server/data/agents.json` - Default agent config update

### Summary

The design captures the high-level intent but needs more detail on:
1. **Schema changes** - Align with existing patterns (`models[]` vs `model`)
2. **Migration path** - How existing configs transition
3. **Message format conversion** - Bidirectional mapping details
4. **Error handling** - Specific error types and recovery
5. **Test coverage** - Concrete test cases
