# Migration Review

This review checks the plan docs against the current assistant runtime and the actual APIs in
`../pi-mono`.

Applied decisions after the PI second pass:

- define a concrete request-adapter boundary in the plan
- keep the target end state single-path; no long-lived fallback/dual-routing design
- align session files with `~/.pi/agent/sessions/`
- keep turn-history editing in scope for the first cut
- add an explicit parity test matrix before switching `provider === 'pi'`
- keep agent-core tool execution sequential in the first cut unless concurrency is proven safe

## Main corrections

### 1. Agent-core turn semantics do not match assistant request semantics

`@mariozechner/pi-agent-core` emits `turn_start` / `turn_end` for each internal assistant cycle,
including tool-result follow-up cycles and queued steering/follow-up messages:

- `../pi-mono/packages/agent/src/agent-loop.ts`
- `../pi-mono/packages/agent/src/types.ts`

Assistant currently treats one `processUserMessage()` invocation as one outer request with one
assistant `responseId` / `turnId` envelope:

- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/ws/chatRunLifecycle.ts`

Implication: the migration needs a request-level adapter. Do not map agent-core turn events
directly to assistant request boundaries.

### 2. `agent.continue()` is not the generic resume primitive

Actual `Agent.continue()` only works when the last message is not an assistant message:

- `../pi-mono/packages/agent/src/agent.ts`

Normal session resume should be:

1. load prior messages
2. `agent.replaceMessages(messages)`
3. wait for next user input
4. `agent.prompt(nextUserInput)`

Reserve `continue()` for retry / queued-message cases.

### 3. Tool execution mapping is richer than the original plan assumed

Actual agent-core tool execution produces:

- `tool_execution_start`
- zero or more `tool_execution_update`
- `tool_execution_end`
- then `message_start` / `message_end` for the resulting `toolResult` message

References:

- `../pi-mono/packages/agent/src/agent-loop.ts`
- `../pi-mono/packages/agent/src/types.ts`

Implication: the event bridge and writer must handle both the execution events and the final
`toolResult` message if replay/persistence should stay compatible.

### 4. EventStore is still on the critical path

Today replay still depends on `ChatEvent` reconstruction:

- `packages/agent-server/src/sessionHub.ts`
- `packages/agent-server/src/sessionChatMessages.ts`
- `packages/agent-server/src/history/historyProvider.ts`

For `provider === 'pi'`, `PiSessionHistoryProvider` also merges overlay events while the Pi session
file is missing or being tailed. That means EventStore/overlay behavior cannot be dropped as part
of the loop migration alone.

### 5. Session-writer simplification was overstated

The current writer is complex partly because of dual-format translation, but it also still owns:

- coding-agent-compatible entry chaining (`id`, `parentId`)
- assistant-specific `custom` / `custom_message` entries
- explicit assistant request boundaries
- turn-history editing support
- provider attribute/session-file discovery

References:

- `packages/agent-server/src/history/piSessionWriter.ts`
- `packages/agent-server/src/sessionHub.ts`
- `../pi-mono/packages/coding-agent/src/core/session-manager.ts`

Implication: the target should be "smaller target-format writer", not "plain append-only JSONL
logger".

### 6. Tool migration should start with adapters, not a full rewrite

Current assistant tool execution still flows through `ToolHost`, `ToolContext`, approvals,
interactions, and plugin operation surfaces:

- `packages/agent-server/src/tools/types.ts`
- `packages/agent-server/src/ws/toolCallHandling.ts`
- `packages/agent-server/src/plugins/operations.ts`
- `packages/agent-server/src/builtInTools.ts`

Implication: a thin internal `AgentTool` adapter over the existing tool-host path is acceptable as
temporary scaffolding. It is not part of the target end-state contract.

### 7. Strip-first sequencing is too risky

The current runtime is still driven by:

- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/chatRunCore.ts`
- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/agent-server/src/ws/sessionRuntime.ts`

Removing CLI/TTS/shared infrastructure before the new native path is wired would increase risk
without shortening the critical path materially.

## Recommended migration order

1. Add `pi-agent-core` and `pi-coding-agent`, then lock actual API assumptions in the plan.
2. Build a new pi-native runtime with temporary internal adapters only where necessary:
   - existing tool host
   - existing ChatEvent/EventStore flow
   - existing session writer or a target-format replacement
3. Prove parity for streaming, tools, interruption, replay, and `agents_message`.
4. Route `provider === 'pi'` to the new path.
5. Remove old pi loop code.
6. Simplify tools/replay/writer after cutover.
7. Strip CLI/TTS only after the native path is stable.
