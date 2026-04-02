# Events — Design Decisions

## Current Architecture

Assistant has two parallel event paths for the UI:

1. **ServerMessage (live)** — direct WebSocket messages (`ServerTextDeltaMessage`, `ServerThinkingStartMessage`, `ServerToolCallStartMessage`, etc.) sent to connected clients in real time during streaming.

2. **ChatEvent / EventStore (replay)** — structured `ChatEvent` records (`assistant_chunk`, `thinking_chunk`, `tool_call`, `tool_result`, `turn_end`, etc.) stored in an `EventStore` and also broadcast as `chat_event` WebSocket messages. Used for UI state recovery (reconnection, questionnaire state).

Both are emitted from the same stream handlers in `chatRunCore.ts`, meaning the frontend receives events twice in different formats.

This dual-path model also forces client-side replay reconciliation heuristics
(`packages/web-client/src/utils/chatEventReplayDedup.ts`) that compare payloads because live and
replayed events do not share a canonical sequence space.

## New Architecture

### Primary path: AgentEvent → ServerMessage

The `AgentEvent` listener translates agent-core events directly to `ServerMessage` types for WebSocket clients. This is the live streaming path and doesn't change conceptually — just the source changes from manual stream handling to agent-core events.

### Replay path: Session file projector

Replay/reconnect is reworked as part of this migration. The server projects the pi session JSONL
file into the same UI event model used by live updates, instead of reading `ChatEvent`s from
EventStore.

Consequences:

- the pi session file becomes the only durable replay source
- reconnect/reload uses replay projection from the session file
- questionnaire / interaction state is restored from persisted session entries
- `EventStore`, `PiSessionHistoryProvider` overlay merging, and `chat_event` replay can be removed
  instead of carried forward as migration scaffolding
- replay and live rendering use one canonical ordering model, so client-side attachment/tool-result
  reconciliation no longer depends on payload comparison heuristics

## Boundary Model

- Pi `AgentEvent` lifecycle is the source of truth for inner execution ordering:
  `message_*`, `turn_*`, and `tool_execution_*`
- Assistant persists outer UI request grouping in the same pi session file via custom entries such
  as `assistant.request_start` / `assistant.request_end`
- If a shared/imported pi session file lacks assistant request markers, replay synthesizes outer
  request groups from the native transcript so the session still renders in assistant
- Assistant also persists user-visible interaction lifecycle entries in the same session file so
  replay/restart can show pending, answered, reprompted, cancelled, timed-out, or aborted
  interaction state
- One outer assistant request may contain one or more native pi turns
- The UI should group by the outer request boundary, not assume one visible assistant response
  equals one pi turn

## Sequence / Cursor Model

Introduce a session-local replay sequence model for UI projection:

- every live UI event carries a monotonic `sequence`
- every replay response is resume-able via an opaque `cursor`
- `cursor` maps to the same per-session ordering space as `sequence`
- the client reconciles live and replayed events by sequence/cursor, not by payload hashing
- attachment bubbles, tool output blocks, interaction prompts, and final assistant chunks all come
  from that same projected sequence space

This replaces the current replay dedup hack in
`packages/web-client/src/utils/chatEventReplayDedup.ts`.

Design notes:

- the sequence space is session-local, not global
- the sequence space belongs to the projected UI stream, not raw `AgentEvent` ids or JSONL line
  numbers
- the session file must contain enough ordering information to reconstruct replay deterministically
- projector ordering should be derived from persisted entry order plus stable per-entry sub-event
  ordering so replay rebuilds the same attachment/tool/result layout the live client saw
- if history editing rewrites the session file, existing cursors can be invalidated and the client
  should reload the transcript from scratch
- an in-memory active-stream buffer is acceptable for reconnecting to not-yet-durable live events,
  but it is not a second persisted store

## Projected Transcript Contract

Define one assistant-owned projected transcript stream for replay and durable UI reconciliation.

Each projected event should carry:

- `sessionId`
- `revision` — monotonic session history revision
- `sequence` — monotonic order within that `(sessionId, revision)`
- `requestId` — the outer assistant request-group id and history-edit anchor
- `eventId` — opaque unique id for this projected event
- `kind` — assistant-owned projected event type
- `timestamp`
- optional stable entity ids when applicable:
  - `messageId`
  - `toolCallId`
  - `interactionId`
  - `exchangeId`
  - `piTurnId` for diagnostics only, never for history-edit anchoring

Recommended projected event kinds:

- `request_start`
- `request_end`
- `user_message`
- `assistant_message`
- `thinking`
- `tool_call`
- `tool_input`
- `tool_output`
- `tool_result`
- `interaction_request`
- `interaction_update`
- `interaction_response`
- `interrupt`
- `error`

Design constraints:

- replay projection is built from durable session-file state
- live transport may still use more granular streaming messages for immediacy, but those messages
  must target the same stable renderer entities keyed by `requestId` / `messageId` / `toolCallId`
  / `interactionId`
- sequence/cursor reconciliation applies to the durable projected transcript stream
- not-yet-durable live deltas may be buffered in memory while the process is alive, but are not the
  source of truth after restart

## Replay API Contract

Replay should use an explicit cursor protocol rather than payload dedup.

Suggested response shape:

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

- initial load uses no cursor and returns the full projected transcript with `reset: true`
- incremental replay uses `afterCursor`
- `nextCursor` is opaque and server-issued; clients must not inspect or synthesize it
- if the supplied cursor is for an older revision, the server returns `reset: true` and a fresh
  projection for the current revision
- history rewrites, reset-session, or any transcript-topology rewrite must increment `revision`

## History Edit Boundary

History edits should target the outer assistant request group, not pi internal turns.

That means:

- the visible transcript control in the UI attaches to `requestId`
- `trim_before` drops all request groups before the anchor request
- `trim_after` drops the anchor request and everything after it
- `delete_request` drops only the anchor request
- `reset_session` removes all request groups in the session

UI copy can still say "Delete Turn" if desired, but the protocol/storage anchor should be
`requestId` to avoid conflating visible request groups with pi internal `turn_*` events.

For imported/shared pi session files without assistant request metadata:

- synthesize request groups projection-side from the native transcript
- assign deterministic synthetic `requestId`s derived from stable imported entry boundaries
- allow history editing against those synthetic request groups
- once assistant rewrites that history, persist explicit `assistant.request_*` markers so future
  loads no longer depend on synthesis

## Attachment / Tool Ownership

Attachment bubbles and other tool-owned UI artifacts should reconcile by stable ownership, not by
payload inspection.

Rules:

- attachment/tool artifacts belong to the outer `requestId`
- the primary stable renderer key for tool-owned artifacts is `toolCallId`
- attachment metadata should also carry `requestId` so history rewrites can remove dropped
  attachments deterministically
- replay projection must place those artifacts by `(revision, sequence)` and update them by stable
  ids rather than by matching payload content

## Event Listener Responsibilities

The single `AgentEvent` listener handles all side effects:

```
AgentEvent
  ├── ServerMessage → WebSocket (live UI, with sequence/cursor)
  ├── Session writer → JSONL file (persistence)
  ├── Replay projector → projected UI events after cursor
  └── State tracking → activeChatRun updates
```

This is cleaner than the current architecture where these concerns are scattered across `chatRunCore.ts`, `chatTurnFinalization.ts`, `chatProcessor.ts`, and `chatEventUtils.ts`.

## Mapping Constraints

- `message_update` must preserve `AssistantMessageEvent` detail (`text_*`, `thinking_*`,
  `toolcall_*`) because assistant UI/rendering currently depends on phase/toolcall sequencing.
- Tool progress is not only `tool_execution_end`; `tool_execution_update` must continue to drive
  streamed tool output.
- `toolResult` messages arrive as `message_start` / `message_end` after `tool_execution_end`.
- Agent-core `turn_start` / `turn_end` remain the canonical inner turn history.
- Assistant outer request grouping should be persisted separately in the same session file rather
  than replacing or flattening pi turns.
- live and replay projection must share the same ordering model so attachment bubbles, tool output,
  and request grouping reconcile cleanly in the client
