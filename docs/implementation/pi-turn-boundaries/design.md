# Pi Turn Boundaries In Pi Session JSONL

Status: Draft for review

## Purpose

Define a deterministic, Pi-file-native turn model that would make future history operations safe for Pi-backed sessions, including:

- trim history before a selected turn
- trim history after a selected turn
- delete a selected turn
- reset transcript history
- later, fork from a selected turn

The goal is not client replay only. The goal is to make changes to the actual Pi-backed history used for future agent runs.

## Problem Statement

The client now has a real turn grouping model. Each rendered `.turn` groups the user message, assistant output, tool calls, tool results, interactions, and related assistant-owned events for one conversation step.

That creates a natural place in the UI for turn actions. However, those UI turns do not currently map deterministically back to exact regions of the Pi session JSONL.

Current state:

- We can deterministically resolve a session to its Pi session file.
- We cannot deterministically resolve a clicked UI turn to an exact Pi entry span suitable for destructive history edits.
- Replay currently reconstructs unified chat events from Pi JSONL using message flow and assistant-owned custom entries.
- Some turn ids are synthesized during replay instead of being persisted as authoritative Pi-file structure.

Because of that, destructive history operations would currently require inference. That is not acceptable for operations that change future model context.

## Goals

- Make turn boundaries deterministic inside the Pi session JSONL itself.
- Keep the source of truth self-contained in the Pi session file.
- Avoid fuzzy matching between UI turns and Pi rows.
- Preserve Pi native `message` schema in the first version.
- Support future destructive history operations without depending on assistant-only sidecar state.
- Preserve the system prompt behavior by continuing to regenerate it from session/agent configuration rather than storing it as a normal transcript turn.

## Non-Goals

- Implement the turn actions now.
- Support deterministic turn trimming for older Pi files that lack turn markers.
- Redesign all replay logic across all providers.
- Modify third-party Pi message semantics unless proven necessary.
- Solve branch/fork semantics in this phase.

## Current Baseline

### Session-to-file mapping

We already have deterministic session-to-Pi-file mapping through provider attributes and Pi replay lookup:

- [`packages/agent-server/src/history/piSessionWriter.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/history/piSessionWriter.ts)
- [`packages/agent-server/src/history/piSessionReplay.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/history/piSessionReplay.ts)
- [`packages/agent-server/src/history/historyProvider.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/history/historyProvider.ts)

### What is stored in Pi JSONL today

We currently write:

- native Pi `message` entries for normal user / assistant / tool-result messages
- `custom_message` entries for assistant-owned special inputs such as:
  - `assistant.input`
  - `assistant.orphan_tool_result`
- `custom` entries for assistant-owned event overlays:
  - `assistant.event`
- `session_info` entries for mirrored session names

### What is missing

- No explicit `assistant.turn_start`
- No explicit `assistant.turn_end`
- No authoritative persisted mapping from a logical turn to a Pi entry range
- No closure rule for async callback events relative to turn boundaries
- No explicit interrupted turn closure in Pi JSONL

## Key Decisions

### 1. Use Pi-file-native boundary markers

Persist explicit assistant-owned turn markers inside the Pi session JSONL:

- `customType: "assistant.turn_start"`
- `customType: "assistant.turn_end"`

These are written as Pi `custom` entries.

They are the authoritative turn structure for future history edits.

### 2. Do not modify native Pi `message` entries in v1

The first version should leave native Pi `message` entries unchanged.

Reasoning:

- lower compatibility risk with existing Pi tooling
- lower implementation scope
- enough structure for deterministic trimming if boundaries are enforced correctly

### 3. Keep assistant-owned overlay events inside the same turn envelope

Assistant-owned events that already persist as `assistant.event` remain in the Pi file and conceptually belong to the active turn.

This includes things like:

- `agent_callback`
- `interaction_request`
- `interaction_response`
- interrupted `assistant_done`
- `interrupt`

### 4. Boundary markers must be strong enough to stand on their own

A boundary-only design is acceptable only if we enforce these invariants:

- within a session, entries are serialized in order
- once `assistant.turn_end` is written for turn `T`, no later entry may belong to turn `T`
- async agent callbacks must either:
  - carry the original caller turn id and be written before that turn closes, or
  - intentionally create a new callback turn of their own
- interrupted runs must still get a turn-closing boundary

### 5. Prefer rewrite-to-new-session for destructive edits

Future trim/delete operations should prefer:

- read existing Pi file
- locate kept turn spans using explicit boundaries
- write a new Pi session file containing only the kept history
- repoint the assistant session’s provider attributes to the new Pi session id/file

Do not mutate the existing Pi append-chain in place unless there is a compelling reason.

This is safer and deterministic.

## Proposed Pi JSONL Contract

### Turn start

Pi `custom` entry:

```json
{
  "type": "custom",
  "customType": "assistant.turn_start",
  "data": {
    "v": 1,
    "turnId": "turn_123",
    "trigger": "user"
  }
}
```

Required fields:

- `v`
- `turnId`
- `trigger`

Allowed trigger values:

- `user`
- `callback`

For v1, `system` is explicitly out of scope for Pi boundary markers. If a future server flow needs non-user, non-callback turns, it must extend the contract deliberately rather than reusing an undefined trigger value.

### Turn end

Pi `custom` entry:

```json
{
  "type": "custom",
  "customType": "assistant.turn_end",
  "data": {
    "v": 1,
    "turnId": "turn_123",
    "status": "completed"
  }
}
```

Required fields:

- `v`
- `turnId`
- `status`

Allowed status values for v1:

- `completed`
- `interrupted`

Optional future values:

- `superseded`
- `forked`

### Existing assistant event entries

Keep existing `assistant.event` entries. They remain the storage vehicle for assistant-owned overlay events.

For boundary-based determinism, these events must obey the boundary envelope:

- they occur after the corresponding `assistant.turn_start`
- they occur before the corresponding `assistant.turn_end`

### Turn id source

For Pi-backed sessions, the Pi boundary `turnId` must be the authoritative turn id for that logical turn.

Rules:

- the Pi boundary `turnId` and the unified chat-event `turnId` must be the same value
- the server should generate the id once at logical turn start
- replay should preserve that same id back to the client

Do not introduce separate Pi-only and event-store-only turn-id spaces.

## Service / Module Design

### Writer changes

Primary file:

- [`packages/agent-server/src/history/piSessionWriter.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/history/piSessionWriter.ts)

Add methods equivalent to:

- `appendTurnStart({ summary, turnId, trigger, updateAttributes? })`
- `appendTurnEnd({ summary, turnId, status, updateAttributes? })`

These should use the existing per-session write queue so order remains serialized.

The writer should also track whether the persisted session file currently has an open turn boundary so it can:

- reject illegal nested starts
- detect an unterminated turn from an already-existing file
- recover deterministically on the next append

### Replay changes

Primary file:

- [`packages/agent-server/src/history/historyProvider.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/history/historyProvider.ts)

Replay should:

- treat `assistant.turn_start` as authoritative `turn_start`
- treat `assistant.turn_end` as authoritative `turn_end`
- stop inventing turn boundaries for Pi-backed sessions when explicit markers are present
- continue replaying native Pi messages and existing `assistant.event` entries inside the current turn
- preserve the same `turnId` carried by the Pi boundary markers back to the client

Fallback behavior for older files is allowed in replay only:

- if no explicit turn markers exist, retain current heuristic replay behavior

Mixed-mode files are also possible during rollout or after partial rewrites. Replay must handle these explicitly:

- if a contiguous region is covered by explicit markers, those markers are authoritative for that region
- unmarked earlier or later regions may still use heuristic replay
- replay must not merge marked and unmarked regions into a single inferred turn

This preserves old history readability while keeping new files deterministic.

### Chat run lifecycle changes

Primary files:

- [`packages/agent-server/src/ws/chatRunLifecycle.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/ws/chatRunLifecycle.ts)
- [`packages/agent-server/src/chatProcessor.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/chatProcessor.ts)
- [`packages/agent-server/src/ws/chatOutputCancelHandling.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/ws/chatOutputCancelHandling.ts)

Rules:

- start a Pi turn with `assistant.turn_start` when the logical turn begins
- always close a Pi turn with `assistant.turn_end`
- canceled / interrupted runs must emit `assistant.turn_end(status="interrupted")`
- the Pi boundary write and the unified `turn_start` / `turn_end` chat events must be emitted from the same lifecycle points and with the same `turnId`

### Async callback changes

Primary file:

- [`packages/agent-server/src/builtInTools.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/builtInTools.ts)

This is the main open issue for boundary-only design.

Current problem:

- `agent_callback` persistence can occur later than the original caller turn
- current Pi persistence path does not carry a caller-side `turnId`

Required design choice:

Option A:
- callback is part of the original caller turn
- caller turn remains open until callback is persisted

Option B:
- callback always starts a new callback turn
- the hidden callback input and callback result live inside that new turn

Recommendation:

- use Option B

Reasoning:

- avoids long-lived open turns across async work
- makes callback timing deterministic
- better matches actual chronology
- avoids coupling callback completion to the lifecycle of the original caller turn

Under Option B, callback turns are real turns in both places:

- Pi JSONL boundary markers
- unified replayed chat events

That keeps the Pi file and client turn model aligned.

If we choose Option B, then the callback flow should write:

1. `assistant.turn_start(trigger="callback")`
2. existing callback-related custom/native entries
3. `assistant.turn_end(status="completed")`

### Session clear / future trim integration

Primary file:

- [`packages/agent-server/src/sessionHub.ts`](/home/kevin/worktrees/assistant/packages/agent-server/src/sessionHub.ts)

Future history actions should be centralized here, because full clear already lives there and session-level provider state updates belong there.

## Error Semantics

### Writer invariants

Reject or log hard errors when:

- `assistant.turn_end` is requested without an open turn
- a new `assistant.turn_start` is requested while another turn is still open, unless the previous turn is auto-closed with explicit `interrupted`
- a callback event is written without a deterministic turn policy

### Crash / partial-write recovery

The process can die after `assistant.turn_start` is written and before `assistant.turn_end` is written.

Recovery rules:

- on startup or first append for a session, the writer may detect an unterminated final turn in the existing Pi file
- if detected, the writer should treat that turn as implicitly interrupted and append `assistant.turn_end(status="interrupted")` before writing a new turn
- replay may also surface an unterminated final turn as interrupted if it has not yet been repaired

Do not silently continue appending new turn content into an old unterminated turn.

### Replay invariants

Replay should be resilient but explicit:

- unmatched `assistant.turn_end` should be ignored with logging
- unterminated final turns may be surfaced as implicitly interrupted in replay only
- malformed turn marker payloads should not crash replay

### Trim eligibility rules for future feature work

Future destructive history edits should be rejected if:

- the target Pi session file has no explicit turn markers
- the file contains malformed or overlapping marker pairs
- the session is actively running

## Migration Strategy

### Existing sessions

Existing Pi files do not have boundary markers.

Policy:

- old files remain replayable through current heuristics
- new deterministic trim/delete actions should be unavailable for those sessions until the session history is rewritten into the new marked format
- mixed-mode files are replayable, but destructive turn-history actions should only operate on fully marked regions or on rewritten fully marked files

### New sessions

After implementation:

- every new Pi-backed turn writes explicit boundaries
- future destructive actions become available for those sessions

### Optional future migration

If we later want broad coverage, add a rewrite tool that:

- reads old Pi history
- reconstructs best-effort turns
- emits a new Pi session file with explicit markers

This is out of scope for the first implementation.

## Test Strategy

### Unit tests

Add or update tests for:

- `PiSessionWriter`
  - writes `assistant.turn_start`
  - writes `assistant.turn_end`
  - persists marker version field
  - preserves append ordering through `writeQueue`
  - closes interrupted turns explicitly
  - repairs an unterminated final turn before starting a new one
- `PiSessionHistoryProvider`
  - replays explicit boundaries as authoritative turn events
  - prefers explicit markers over heuristic boundaries when both are present
  - tolerates malformed marker entries without crashing
  - handles mixed-mode files with both marked and unmarked regions
- async callback flow
  - callback creates its own callback turn if Option B is chosen
- cancellation flow
  - aborted runs persist `assistant.turn_end(status="interrupted")`

### Integration tests

Add end-to-end coverage for:

- normal user turn with tools and final assistant output
- interaction request/response inside a turn
- async callback turn
- interrupted run
- replay from Pi JSONL after process restart
- crash recovery where the file ends after `assistant.turn_start`

### Future trim tests

When trim/delete is implemented, add tests for:

- trim before a selected turn
- trim after a selected turn
- delete selected turn
- reset history
- refusal when the file lacks explicit turn markers

## Acceptance Criteria

- New Pi-backed sessions write explicit `assistant.turn_start` and `assistant.turn_end` markers.
- Pi replay for new files uses those markers as authoritative turn structure.
- Interrupted runs receive explicit interrupted turn closure.
- Async callback flow no longer leaves turn membership ambiguous.
- Mixed-mode replay is deterministic during rollout.
- Native Pi `message` schema remains unchanged in v1.
- Future destructive history features can rely on Pi-file-native turn boundaries instead of fuzzy matching.

## Recommended Direction

Implement the deterministic foundation first:

1. explicit Pi turn boundary markers
2. interrupted turn closure
3. callback-turn policy
4. replay support for explicit boundaries

Do not implement turn trimming until those are in place.
