# Pi Turn Boundaries Phase Task Plan

Status: Draft for review

## Scope

This plan covers only the deterministic provenance foundation required for future turn-level history actions in Pi-backed sessions.

It does not include implementing the UI menu or destructive trim/delete behavior yet.

## Global Rules

- Prefer end-state design over transitional compatibility layers.
- Keep native Pi `message` entries unchanged in the first implementation.
- Persist explicit assistant-owned turn boundaries in Pi JSONL.
- Do not ship destructive turn-history actions until deterministic boundaries exist.
- Reject trim/delete for sessions that lack explicit turn markers.

## Phase 1: Contract Lock

Deliverables:

- lock custom Pi boundary entry shapes
- lock turn-end status semantics
- lock callback-turn policy
- lock `turnId` source and version field

Acceptance criteria:

- document `assistant.turn_start` contract
- document `assistant.turn_end` contract
- choose callback policy explicitly
- choose interrupted-turn policy explicitly
- specify that Pi boundary `turnId` and unified chat-event `turnId` are the same id
- specify marker versioning

## Phase 2: Writer Support

Deliverables:

- `PiSessionWriter` support for boundary entries
- ordered append behavior covered by tests
- crash-recovery behavior for unterminated final turns

Acceptance criteria:

- boundary entries are serialized through the existing per-session write queue
- normal completed turns write `turn_start` then `turn_end`
- interrupted turns write `turn_end(status="interrupted")`
- restarting after an unterminated final turn results in explicit interrupted closure before a new turn starts

## Phase 3: Lifecycle Integration

Deliverables:

- writer calls are integrated into the real run lifecycle
- unified chat-event `turn_start` / `turn_end` stay aligned with Pi boundary markers
- callback and cancel code paths use the locked contract

Acceptance criteria:

- `chatRunLifecycle.ts` and `chatProcessor.ts` emit Pi boundary writes at the same lifecycle points as unified turn events
- cancel/interruption path writes `turn_end(status="interrupted")`
- callback path follows the chosen callback-turn policy

## Phase 4: Replay Support

Deliverables:

- Pi replay honors explicit boundary markers
- replay falls back to heuristic boundaries only for older files
- mixed-mode replay rules are implemented explicitly

Acceptance criteria:

- new files replay with authoritative turn structure from explicit markers
- older files still replay successfully
- malformed markers do not crash replay
- mixed-mode files replay deterministically
- conflicts between Pi markers and heuristic turn inference resolve in favor of explicit markers

## Phase 5: Async Callback Closure

Deliverables:

- callback events no longer create ambiguous turn membership
- callback flow obeys the chosen callback-turn policy

Acceptance criteria:

- callback persistence includes deterministic turn structure
- callback replay is stable after restart

## Phase 6: Eligibility Gate For Future Trim/Delete

Deliverables:

- explicit server-side rule that destructive history actions require marked files

Acceptance criteria:

- marked files are eligible
- unmarked files are rejected with deterministic error semantics
- mixed-mode files are either rejected or restricted to fully marked spans only

## Verification Matrix

- `PiSessionWriter` unit tests
- `PiSessionHistoryProvider` unit tests
- callback-flow integration tests
- interrupted-run integration tests
- restart/replay verification from Pi JSONL
- crash-recovery tests
- mixed-mode replay tests
- rewrite-to-new-session verification when trim/delete is later implemented

## Section 9: Operator Checklist And Evidence Log Schema

For each phase record:

1. completion date
2. commit hash(es)
3. acceptance evidence
4. review run IDs and triage outcomes
5. go/no-go decision

Evidence log template:

```md
### Phase X

- Completion date:
- Commit hash(es):
- Acceptance evidence:
- Review run IDs:
- Triage:
- Go/No-Go:
```

## Milestone Commit Gate

Create a milestone commit after each completed phase only if:

- relevant tests pass
- accepted review findings are incorporated
- docs remain consistent with implementation state

## Risks

- async callback timing may not fit the original caller turn model
- interrupted runs may need explicit closure in more than one code path
- replay may currently depend on heuristic ordering in subtle ways
- mixed-mode replay may introduce boundary conflicts during rollout

## Recommended Execution Order

1. lock contract and callback policy
2. implement writer support
3. wire lifecycle integration
4. implement replay support
5. close callback ambiguity
6. add future eligibility gate
