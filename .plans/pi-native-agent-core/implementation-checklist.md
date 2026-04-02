# Pi Native Agent Core — Implementation Checklist

This checklist turns the design docs into an execution plan. It is structured so multiple workers
can implement disjoint slices in parallel without fighting over ownership.

## Rules

- The target architecture is the only architecture. Do not add long-lived fallback paths.
- The pi session JSONL file is the only durable replay source.
- Outer assistant request groups are the visible/editable transcript unit.
- Imported/shared pi session files without assistant metadata must still load via synthesized
  request groups.
- `provider === 'pi'` does not switch until the parity gate passes.

## Global Done Criteria

- native pi runtime uses `@mariozechner/pi-agent-core`
- native tools use `AgentTool` directly
- replay/reconnect reads projected transcript events from the session file
- no EventStore/`chat_event` dependency remains on the pi-native path
- history edits work on outer request groups
- imported/shared pi logs without assistant metadata load and can be edited
- relevant tests pass

## Parallel Workstreams

These are the preferred parallel slices. Each slice should own the listed files/modules and avoid
editing other slices unless necessary.

### Workstream A: Runtime Core

Primary ownership:

- `packages/agent-server/src/piNativeChat.ts` or equivalent new module
- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/sessionHub.ts`
- `packages/agent-server/src/llm/modelResolution.ts`
- `packages/agent-server/src/llm/piAgentAuth.ts` replacement/removal path

Checklist:

- [ ] Add `@mariozechner/pi-agent-core` and `@mariozechner/pi-coding-agent`
- [ ] Extract model resolution from `piSdkProvider.ts`
- [ ] Add `AuthStorage`-based API key resolution
- [ ] Create session-scoped live `Agent` runtime
- [ ] Implement request adapter with stable `requestId` / `responseId`
- [ ] Support model/thinking changes at request boundaries
- [ ] Support `agent.replaceMessages()` resume flow
- [ ] Keep `transformContext` as no-op in the first cut
- [ ] Keep tool execution sequential in the first cut

Acceptance criteria:

- one live `Agent` per loaded session
- resumed sessions use `replaceMessages()` + `prompt()`
- cancel/abort finalizes exactly once
- model/thinking changes apply immediately when idle, otherwise next request

Tests:

- [ ] new-session request flow
- [ ] resumed-session request flow
- [ ] model change while idle
- [ ] model change during active request
- [ ] thinking change while idle/in-flight
- [ ] abort before output
- [ ] abort after partial output

### Workstream B: Tools And Generated Plugin Tools

Primary ownership:

- `packages/agent-server/src/builtInTools.ts`
- `packages/agent-server/src/plugins/operations.ts`
- `packages/agent-server/src/plugins/registry.ts`
- `packages/agent-server/src/plugins/types.ts`
- `packages/agent-server/src/tools.ts`
- `packages/agent-server/src/toolExposure.ts`
- `packages/agent-server/src/tools/mcpToolHost.ts`
- `packages/agent-server/src/tools/types.ts`

Checklist:

- [ ] Replace `ToolHost` runtime execution with native `AgentTool` registration
- [ ] Port built-in tools to `AgentTool`
- [ ] Import coding tools directly from `@mariozechner/pi-coding-agent`
- [ ] Generate one `AgentTool` per manifest operation
- [ ] Preserve generated tool naming/capabilities
- [ ] Wrap manifest schemas with `Type.Unsafe()`
- [ ] Preserve `coerceArgs()` / `validateArgs()` parity for generated tools
- [ ] Define deterministic generated-tool result shaping into `AgentToolResult`
- [ ] Narrow `ToolContext` toward the new runtime contract
- [ ] Remove `eventStore` / `baseToolHost` / `historyProvider` from the target tool contract
- [ ] Port MCP tools to native `AgentTool` wrappers
- [ ] Keep approvals/interactions/chunk forwarding working

Acceptance criteria:

- built-in, plugin, MCP, and coding tools all execute through native `AgentTool`
- generated manifest tools keep current input behavior
- richer outputs stay explicit; generic generated tools only emit deterministic textual content plus
  raw `details`
- no runtime `ToolHost` bridge remains on the target path

Tests:

- [ ] built-in tool execution coverage
- [ ] generated plugin tool naming/capabilities
- [ ] generated plugin arg coercion/validation parity
- [ ] generated plugin scalar/object result shaping
- [ ] MCP tool invocation through native wrapper
- [ ] `agents_message` sync/async/callback flow
- [ ] attachment tool result ownership by `requestId` + `toolCallId`

### Workstream C: Session Writer And History Editing

Primary ownership:

- `packages/agent-server/src/history/piSessionWriter.ts`
- `packages/agent-server/src/history/piSessionReplay.ts`
- `packages/agent-server/src/sessionHub.ts`
- attachment cleanup paths in `packages/agent-server/src/attachments/` and related callers

Checklist:

- [ ] Rewrite writer around native `AgentMessage` flow
- [ ] Persist `assistant.request_start` / `assistant.request_end`
- [ ] Persist interaction lifecycle entries
- [ ] Persist agent/callback attribution metadata separately from model-visible user messages
- [ ] Persist model/thinking change entries
- [ ] Preserve coding-agent-compatible entry graph
- [ ] Implement request-group-based history span collection
- [ ] Change history edits to use `requestId` as the anchor
- [ ] Support `trim_before`, `trim_after`, `delete_request`, `reset_session`
- [ ] Return dropped request ids for cleanup
- [ ] Associate attachments with `requestId` + `toolCallId`
- [ ] Materialize `assistant.request_*` entries when assistant rewrites imported logs

Acceptance criteria:

- assistant-authored sessions persist explicit request groups
- imported/shared pi logs without assistant metadata can be rewritten into explicit request groups
- history-edit operations map to visible transcript groups, not pi internal turns
- attachment cleanup follows dropped request groups deterministically

Tests:

- [ ] writer emits assistant request markers
- [ ] writer emits interaction lifecycle entries
- [ ] model/thinking change persistence
- [ ] `trim_before` on request groups
- [ ] `trim_after` on request groups
- [ ] `delete_request`
- [ ] `reset_session`
- [ ] attachment cleanup for dropped request groups
- [ ] imported/shared pi log rewrite materializes assistant request markers

### Workstream D: Replay Projection And Transcript API

Primary ownership:

- `packages/agent-server/src/history/historyProvider.ts` replacement/removal path
- replay/projector module(s) to be added
- `packages/shared/src/protocol.ts`
- any server replay route handlers

Checklist:

- [ ] Define projected transcript event schema on the wire
- [ ] Add `revision`, `sequence`, `cursor`, `requestId`, and stable entity ids
- [ ] Implement server replay projector from session JSONL
- [ ] Support synthesized request grouping for imported/shared pi logs
- [ ] Implement cursor invalidation on history rewrites
- [ ] Remove EventStore-based replay for pi-native sessions
- [ ] Remove payload-dedup-based reconciliation requirements
- [ ] Keep imported/shared logs replayable even without assistant metadata

Acceptance criteria:

- replay API returns projected transcript events from the session file only
- cursors are opaque and revision-aware
- stale cursors trigger reset/full replay
- synthesized request grouping is deterministic for imported/shared pi logs

Tests:

- [ ] full replay with no cursor
- [ ] incremental replay after cursor
- [ ] stale cursor after history rewrite returns reset
- [ ] imported/shared log with no assistant metadata replays with synthesized request groups
- [ ] attachment/tool/interactions project in stable sequence order

### Workstream E: Web Client And Transcript Rendering

Primary ownership:

- `packages/web-client/src/index.ts`
- `packages/web-client/src/controllers/serverMessageHandler.ts`
- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/sessionManager.ts`
- `packages/web-client/src/utils/chatEventReplayDedup.ts` removal path

Checklist:

- [ ] Replace `chat_event` replay loading with projected transcript loading
- [ ] Apply replay by `revision` / `sequence` / `cursor`
- [ ] Remove payload-dedup logic
- [ ] Keep live rendering aligned with replay entity ownership
- [ ] Update transcript controls to operate on outer request groups
- [ ] Allow imported/shared logs with synthesized request groups to show usable history menus
- [ ] Trigger full reload on `session_history_changed` or replay reset
- [ ] Remove `chat_event` handling once the new transport is fully wired

Acceptance criteria:

- live and replayed transcript render the same structure
- attachment/tool/interactions reconcile by stable ids, not payload matching
- delete/reset transcript controls still operate on the visible boundary
- imported/shared logs remain usable in the UI

Tests:

- [ ] transcript load from projected replay API
- [ ] incremental replay after live buffering
- [ ] attachment bubble reconciliation across reconnect
- [ ] interaction replay after restart
- [ ] request-group history menu behavior
- [ ] `session_history_changed` forces clean reload

### Workstream F: Cutover And Removal

Primary ownership:

- `packages/agent-server/src/chatRunCore.ts`
- `packages/agent-server/src/llm/piSdkProvider.ts`
- `packages/agent-server/src/history/historyProvider.ts`
- `packages/agent-server/src/events/eventStore.ts`
- `packages/agent-server/src/events/chatEventUtils.ts`
- CLI/TTS files listed in `strip.md`

Checklist:

- [ ] route `provider === 'pi'` to the new path
- [ ] remove old pi loop code after parity passes
- [ ] remove EventStore replay dependency for pi-native sessions
- [ ] remove `chatEventReplayDedup.ts`
- [ ] simplify surviving session/runtime files
- [ ] remove CLI providers
- [ ] remove legacy TTS

Acceptance criteria:

- `provider === 'pi'` uses only the new native path
- old pi loop/replay code is deleted or dead-code-free
- CLI/TTS stripping does not regress the native path

Tests:

- [ ] end-to-end native pi path through the normal UI
- [ ] native replay/reconnect after cutover
- [ ] full test suite for touched packages

## Recommended Parallelization Order

Start these together:

1. Workstream A: Runtime Core
2. Workstream B: Tools And Generated Plugin Tools
3. Workstream D: Replay Projection And Transcript API

Start once A/B/D interfaces settle:

4. Workstream C: Session Writer And History Editing
5. Workstream E: Web Client And Transcript Rendering

Start last:

6. Workstream F: Cutover And Removal

## Interface Freeze Points

These should be treated as shared contracts before parallel work gets deep:

- projected transcript event schema
- replay API request/response shape
- request-group id and history-edit API contract
- generated plugin tool result-shaping contract
- narrowed `ToolContext` contract

### Frozen Contract A: Projected Transcript Event

Target wire type:

```ts
type ProjectedTranscriptEvent = {
  sessionId: string;
  revision: number;
  sequence: number;
  requestId: string;
  eventId: string;
  kind:
    | 'request_start'
    | 'request_end'
    | 'user_message'
    | 'assistant_message'
    | 'thinking'
    | 'tool_call'
    | 'tool_input'
    | 'tool_output'
    | 'tool_result'
    | 'interaction_request'
    | 'interaction_update'
    | 'interaction_response'
    | 'interrupt'
    | 'error';
  timestamp: string;
  messageId?: string;
  toolCallId?: string;
  interactionId?: string;
  exchangeId?: string;
  piTurnId?: string;
  payload: Record<string, unknown>;
};
```

Rules:

- `revision` and `sequence` are required on every replay event
- `requestId` is always the visible/editable transcript-group anchor
- `piTurnId` is diagnostic only and never the edit anchor
- stable renderer ownership comes from `requestId` plus `messageId` / `toolCallId` /
  `interactionId`

### Frozen Contract B: Replay API

Replace the current `sessions/operations/events` payload with a projected replay payload.

Request:

```ts
type SessionReplayRequest = {
  sessionId: string;
  afterCursor?: string;
  force?: boolean;
};
```

Response:

```ts
type SessionReplayResponse = {
  sessionId: string;
  revision: number;
  reset: boolean;
  nextCursor: string | null;
  events: ProjectedTranscriptEvent[];
};
```

Rules:

- initial transcript load omits `afterCursor`
- incremental replay uses `afterCursor`
- `nextCursor` is opaque and server-generated
- stale cursor or rewritten history returns `reset: true` and a fresh transcript slice for the
  current revision
- the current `after` event-id contract is removed for the pi-native replay path

### Frozen Contract C: History Edit API

The current sessions plugin `history-edit` operation changes from turn-id anchoring to request-id
anchoring.

Request:

```ts
type SessionHistoryEditRequest = {
  sessionId: string;
  action: 'trim_before' | 'trim_after' | 'delete_request';
  requestId: string;
};
```

Response:

```ts
type SessionHistoryEditResponse = {
  sessionId: string;
  action: 'trim_before' | 'trim_after' | 'delete_request';
  requestId: string;
  changed: boolean;
  updatedAt: string;
  revision: number;
};
```

Clear/reset stays a separate operation:

```ts
type SessionClearResponse = {
  sessionId: string;
  cleared: true;
  updatedAt: string;
  revision: number;
};
```

Rules:

- UI copy may still say "Delete Turn", but the protocol field is `requestId`
- request-edit operations target outer request groups only
- clear/reset deletes all request groups in the session
- any successful rewrite increments `revision`

### Frozen Contract D: Imported/Shared Pi Log Grouping

If a pi/coding-agent session file has no `assistant.request_*` metadata:

- synthesize one coarse request group per user message plus following native history
- generate deterministic synthetic `requestId`s from stable imported boundaries
- allow replay and history-edit operations against those synthetic request groups
- once assistant rewrites the transcript, persist explicit `assistant.request_*` markers

### Frozen Contract E: Generated Plugin Tool Result Shaping

For manifest-generated plugin operation tools:

```ts
type GeneratedPluginToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: unknown;
};
```

Rules:

- `details` is the raw operation result
- `content` is derived deterministically:
  - string → same string
  - number / boolean / null → JSON stringification
  - object / array → stable JSON stringification
- richer artifact semantics are out of scope for generic generated tools

### Frozen Contract F: Narrowed ToolContext

Target fields that generated/native tools may rely on:

- `signal`
- `sessionId`
- `toolCallId`
- `requestId`
- `sessionHub`
- `sessionIndex`
- `agentRegistry`
- `envConfig`
- `scheduledSessionService`
- `searchService`
- `requestInteraction`
- `approvals`
- `interaction`
- `onUpdate`
- `forwardChunksTo`

Fields that should not be depended on in the target design:

- `eventStore`
- `historyProvider`
- `baseToolHost`
- `turnId` as the primary visible transcript anchor

### Frozen Contract G: Session Plugin Operation Changes

The `packages/plugins/core/sessions` operation surface should converge to:

- `events`
  - request: `SessionReplayRequest`
  - response: `SessionReplayResponse`
- `history-edit`
  - request: `SessionHistoryEditRequest`
  - response: `SessionHistoryEditResponse`
- `clear`
  - response includes `revision`

Client callers that need to be updated:

- `packages/web-client/src/index.ts`
- `packages/web-client/src/controllers/sessionManager.ts`
- any transcript reload logic reacting to `session_history_changed`

## Blockers

The cutover is blocked until all of these are true:

- projected replay contract is implemented end-to-end
- request-group history editing is working
- `agents_message` parity is demonstrated
- imported/shared pi logs load without assistant metadata
- attachment/tool/interactions reconcile correctly across live/replay
- parity tests pass

## Suggested Milestones

### Milestone 1: Native Runtime Skeleton

- dependencies land
- model/auth/runtime skeleton exists
- native `AgentTool` registration path exists

### Milestone 2: Durable Replay Spine

- writer persists request groups
- projector emits revision/sequence/cursor stream
- client can render replay from projected events

### Milestone 3: Tool And Interaction Parity

- built-ins/plugins/MCP/coding tools work
- `agents_message` and interactions are durable and replayable

### Milestone 4: History Editing And Import Compatibility

- request-group editing works
- imported/shared pi logs load with synthesized groups
- rewrites materialize assistant request markers

### Milestone 5: Cutover

- `provider === 'pi'` switched
- old pi loop/EventStore replay removed
