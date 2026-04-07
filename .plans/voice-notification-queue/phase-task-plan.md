# Voice Notification Queue Phase Task Plan

Status: Draft for review

## Scope

This plan covers the design capture and implementation path for:

- a per-session final-response attention notification
- session-linked regular notifications with Android voice actions
- an Android-local one-at-a-time voice queue
- manual Android notification actions that can start local voice work later

This plan does not include:

- cross-device persistence of live voice execution
- desktop voice redesign
- a server-owned distributed voice scheduler

## Global Rules

- Keep TTS/STT execution client-driven and ephemeral.
- Keep durable notification history separate from live queue execution state.
- Treat final assistant response attention as a singleton per session.
- Use notifications as the canonical server-originated ingress path for Android queue admission.
- Prefer end-state contracts over temporary compatibility layers.
- Do not centralize pending recognition state across devices.
- Avoid making all notifications audio-bearing by default.

## Phase 1: Requirements And Contract Capture

Deliverables:

- lock the local-versus-durable ownership model
- lock the queue item kinds
- lock the singleton-versus-append-only notification split
- lock first-pass admission and manual recovery rules

Acceptance criteria:

- document that automatic queueing is local-only and runtime-dependent
- document that missed automatic voice does not replay by default later
- document that final assistant responses create or update one durable attention item per session
- document that singleton behavior is scoped to the notification class within the session, not the whole session
- document that any session-linked notification may expose Android `Speaker` and `Mic`
- document that automatic final-response speech appends behind active local voice work
- document that `voice_speak` is always `speak`
- document that final assistant responses and `voice_ask` share identical local execution semantics
- document that manual `Speaker` and `Mic` actions jump ahead
- document that `voice_ask` uses the same server-originated notification/event path as final responses
- document that automatic `voice_speak` uses the same server-originated notification/event path as final responses
- document that `session_attention` clears on reply or dismiss, not on playback
- document that reply-based clearing is driven server-side on accepted user message submission
- define required versus optional fields for the first-pass notification contract
- define the spoken text fallback order for Android playback
- document that `ttsText` is part of the notification contract as an optional spoken-text override
- document that auto-listen-capable items carry a server-generated session activity ordering marker

## Phase 2: Android Local Queue Design

Deliverables:

- define the local queue structure inside the Android runtime
- define queue admission, dequeue, cancellation, and invalidation rules
- define how the current executor consumes a head queue item

Acceptance criteria:

- current single-active runtime state is reframed as a queue worker
- only one live item executes at a time
- queued items can survive temporary busy state while the service remains alive
- prompt arrival no longer has to be dropped solely because the runtime was busy
- `Stop` behavior is defined as current-item cancel plus local-queue flush
- queue-jumping manual actions discard the interrupted automatic item rather than requeueing it
- `voice_speak` is treated as `speak`
- final assistant responses and `voice_ask` share the same `speak` versus `speak_then_listen` policy
- any item that can transition into `listen` has explicit pre-listen validation rules
- Android busy versus idle admission rules are explicit
- manual `Mic` validation is explicitly looser than automatic `speak_then_listen` validation

## Phase 3: Durable Notification Contract Expansion

Deliverables:

- define the durable contract for `session_attention`
- define the session-linked fields needed on regular notifications
- define correlation and deduplication requirements
- define manual Android notification actions and the metadata they need

Acceptance criteria:

- durable model distinguishes singleton final-response attention from append-only notifications
- durable contract includes an explicit singleton class indicator such as `kind = session_attention`
- record can identify its session and originating event
- record can optionally override spoken text independently from visual text
- tool-driven voice notifications do not require a new public tool parameter to provide spoken text
- durable contract can express `voiceMode = none | speak | speak_then_listen`
- record can support stale-item handling
- record can drive manual local voice restart without inventing distributed execution state
- explicit producer mappings exist for final response, `voice_speak`, `voice_ask`, and plain notifications
- any auto-listen-capable item carries a server-generated session ordering marker

## Phase 4: Ingress And Routing Policy

Deliverables:

- define which sources may create durable notifications
- define which sources may directly enqueue local queue items
- define when one event may do both
- define the removal path for legacy direct final-response queue admission

Acceptance criteria:

- explicit policy exists for:
  - notifications plugin calls
  - `voice_speak`
  - `voice_ask`
  - response-mode final answers
- duplicate local enqueue paths are addressed explicitly
- first-pass policy is small enough to implement without ambiguous overlap
- final assistant responses and notification-created voice work each have one canonical admission source
- final assistant responses no longer rely on a parallel direct Android autoplay ingress path
- `voice_speak` and `voice_ask` no longer rely on parallel direct Android autoplay ingress paths
- clear-on-user-reply and dismiss behavior are assigned to concrete server hooks

## Phase 5: Android Notification Action Recovery

Deliverables:

- define Android notification actions for missed or deferred voice work
- define how actions reconstruct fresh local queue items
- define action behavior when the runtime is disconnected or disabled

Acceptance criteria:

- user can manually start a fresh local voice action from a durable notification
- actions use stored notification/session context rather than current foreground selection
- actions do not imply server-owned live queue persistence
- first-pass Android actions are locked as `Speaker` and `Mic`
- manual actions are allowed to preempt current speech
- manual actions discard interrupted automatic audio work

## Phase 6: Staleness And Ask Safety

Deliverables:

- define stale-ask invalidation rules
- define supersession behavior
- define what happens when a queued ask becomes invalid before execution

Acceptance criteria:

- stale `ask` items do not silently submit recognition to the wrong conversational context
- invalidation sources are explicitly documented
- first-pass invalidation uses server-generated session ordering rather than time-based expiration

## Phase 7: Verification Plan

Deliverables:

- define the test matrix for Android runtime, notification storage, and ingress policy
- define end-to-end validation scenarios

Acceptance criteria:

- tests cover queue admission while busy
- tests cover manual recovery from a durable notification
- tests cover deduplication when the same source may appear through multiple paths
- tests cover stale ask handling
- tests cover response-mode auto-listen behavior through the notification-backed path

## Questions To Resolve With Product Direction

No remaining product-direction blockers are currently open in this plan.

## First-Pass Implementation Slices

1. Expand notification schema and storage for `kind`, `voiceMode`, and optional `ttsText`.
2. Add `session_attention` upsert behavior and server-side clear-on-user-reply hook.
3. Route final assistant responses, `voice_speak`, and `voice_ask` through canonical notification events with explicit producer mappings.
4. Replace Android direct final-response autoplay admission with notification-event-driven queue admission.
5. Add Android local queue support for automatic `speak` and `speak_then_listen` items, busy/idle admission, and manual `Speaker` / `Mic` preemption.
6. Add Android spoken-text resolution logic: `ttsText`, then `body`, then `title + body`.
7. Implement and test pre-listen validation for any item that reaches `listen`, using server-generated session ordering.

## Verification Matrix

- notifications server schema and storage tests
- Android runtime queue unit tests
- Android notification action tests
- deduplication and correlation tests
- end-to-end Android validation for:
  - runtime alive at arrival
  - runtime busy at arrival
  - runtime closed at arrival, manual recovery later
  - per-session singleton replacement on new final answer
  - manual action interrupting current speech
  - queue flush on `Stop`
  - stale ask invalidation

## Operator Checklist And Evidence Log Schema

For each phase record:

1. completion date
2. commit hash(es)
3. acceptance evidence
4. review notes
5. go/no-go decision

Evidence log template:

```md
### Phase X

- Completion date:
- Commit hash(es):
- Acceptance evidence:
- Review notes:
- Go/No-Go:
```

## Recommended Execution Order

1. lock requirements and contract direction
2. lock Android local queue semantics
3. expand durable notification contract
4. choose ingress routing policy
5. define Android notification recovery actions
6. lock stale-ask safety rules
7. implement with tests
