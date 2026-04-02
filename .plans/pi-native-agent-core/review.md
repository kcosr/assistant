# Migration Review

This review checks the plan docs against the current assistant runtime and the actual APIs in
`../pi-mono`.

Applied decisions after the PI second pass:

- define a concrete request-adapter boundary in the plan
- keep the target end state single-path; no long-lived fallback/dual-routing design
- align session files with `~/.pi/agent/sessions/`
- keep one live `Agent` runtime per loaded session; rebuild from persisted messages after eviction/restart
- keep model/thinking changes supported with request-boundary semantics, plus explicit persisted
  change entries
- use direct imports from `@mariozechner/pi-coding-agent` as the long-term source of truth for
  coding tools
- keep session persistence assistant-owned rather than importing coding-agent `SessionManager`
- persist outer assistant request grouping in the same pi JSONL file instead of using a separate
  replay/correlation store
- persist all user-visible interaction lifecycle state in that same pi JSONL file as well
- use one durable cross-session `exchangeId` for each `agents_message` invocation while keeping
  normal per-session request groups
- keep `convertToLlm` assistant-local and minimal; model-visible callback/agent input should be
  normal `user` messages, not custom metadata messages
- use native `AgentTool` directly as the runtime contract; rewrite tool construction rather than
  keeping `ToolHost` as the first-cut execution bridge
- spell out generated plugin-operation migration details instead of treating plugins as one generic
  bucket: naming/capabilities, `Type.Unsafe()` schema wrapping, coercion parity, result shaping,
  and narrowed execution context
- move UI replay/reconnect onto the pi session file in the same migration instead of carrying
  EventStore forward
- add a session-local replay `sequence` plus resume `cursor` so the client reconciles live and
  replayed events without payload-based dedup hacks
- make that sequence/cursor ordering authoritative for attachment/tool-result reconciliation too,
  so the UI no longer rebuilds those bubbles via replay-time guesswork
- make history edits anchor on outer assistant request groups, not pi internal turns, so transcript
  controls operate on the same visible boundary the user sees
- keep a narrow import-compatibility path for shared pi/coding-agent logs that lack assistant
  request metadata: synthesize coarse request groups on replay, then materialize assistant request
  markers on rewrite
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

### 4. EventStore is still on the critical path today

Today replay still depends on `ChatEvent` reconstruction:

- `packages/agent-server/src/sessionHub.ts`
- `packages/agent-server/src/sessionChatMessages.ts`
- `packages/agent-server/src/history/historyProvider.ts`
- `packages/web-client/src/utils/chatEventReplayDedup.ts`
- `packages/web-client/src/controllers/chatRenderer.ts`

For `provider === 'pi'`, `PiSessionHistoryProvider` also merges overlay events while the Pi session
file is missing or being tailed. That means EventStore/overlay behavior cannot be dropped as part
of the loop migration alone.

Decision update: absorb the replay/UI rewrite into the main migration and remove this dependency
instead of preserving it as scaffolding. The new replay model also needs an explicit session-local
sequence/cursor so live updates, replay, and attachment/tool-result rendering all reconcile in one
ordering space.

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

### 6. Tool migration originally looked adapter-first

Current assistant tool execution still flows through `ToolHost`, `ToolContext`, approvals,
interactions, and plugin operation surfaces:

- `packages/agent-server/src/tools/types.ts`
- `packages/agent-server/src/ws/toolCallHandling.ts`
- `packages/agent-server/src/plugins/operations.ts`
- `packages/agent-server/src/builtInTools.ts`

Decision update: after deeper review, move directly to native `AgentTool` construction instead of
keeping `ToolHost` as the runtime bridge.

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
2. Build a new pi-native runtime, native `AgentTool` layer, session writer, replay projector, and
   client sequence/cursor reconciliation together.
3. Move reconnect/replay onto the pi session file with a session-local sequence/cursor model.
4. Prove parity for streaming, tools, interruption, replay, and `agents_message`.
5. Route `provider === 'pi'` to the new path.
6. Remove old pi loop code and EventStore-based replay.
7. Strip CLI/TTS only after the native path is stable.
