# Async Questionnaire Mode Implementation Plan

## Scope

Implement the reviewed async questionnaire design in safe, testable slices without breaking the
current synchronous questionnaire flow during rollout.

Reference design:

- `docs/design/questionnaire-async-mode.md`

## Rollout Strategy

Use a migration-safe rollout:

1. Add the new protocol and persistence model behind explicit `mode: 'async'`
2. Keep the existing sync default during the initial rollout
3. Audit callers and agent prompts
4. Flip the default to `async` only after the async path is proven

## Phase 1: Event And Protocol Foundations

### Goals

- Define durable questionnaire lifecycle events
- Define client-to-server async questionnaire action messages
- Keep changes additive

### Work

1. Extend shared chat event schemas with:
   - `questionnaire_request`
   - `questionnaire_submission`
   - `questionnaire_reprompt`
   - `questionnaire_update`
2. Extend shared protocol schemas with:
   - `questionnaire_submit`
   - `questionnaire_cancel`
3. Add event payload types and validation in `packages/shared`
4. Add basic fixture tests for schema validation and serialization

### Verification

- Shared schema tests pass
- New event payloads round-trip through validation
- Protocol messages reject malformed questionnaire ids or payloads

## Phase 2: Server Persistence And Replay

### Goals

- Persist questionnaire lifecycle through the existing session event architecture
- Mirror questionnaire events into Pi session custom entries
- Reconstruct questionnaire events during replay

### Work

1. Extend `SessionScopedEventStore` to treat questionnaire lifecycle events as supplemental events
   that must persist for Pi-backed sessions
2. Mirror those events into Pi session JSONL through `appendAssistantEvent`
3. Extend Pi history replay to reconstruct questionnaire lifecycle events from mirrored
   `assistant.event` entries
4. Extend non-Pi event-store replay to include the new events as ordinary session events

### Verification

- Event store tests cover questionnaire event append and replay
- Pi history tests cover questionnaire events mirrored into and reconstructed from Pi JSONL
- Reconnect or reload reproduces pending questionnaires from persisted history

## Phase 3: Tool Contract Extension

### Goals

- Add `mode`, `onTimeout`, and `autoResume` to `questions_ask`
- Preserve current sync behavior when async mode is not selected during rollout

### Work

1. Extend `QuestionsAskArgs` parsing and manifest schema
2. Implement `mode: 'async'` create-and-return behavior
3. Keep current live `requestInteraction()` flow for `mode: 'sync'`
4. Implement `onTimeout: 'async'` conversion from sync wait to durable async questionnaire
5. Return explicit pending metadata including `questionnaireRequestId`

### Verification

- Existing sync plugin tests still pass
- New tests cover:
  - async immediate return
  - sync submit
  - sync cancel
  - sync timeout to async conversion

## Phase 4: Async Submission Handlers

### Goals

- Accept async questionnaire actions independently of `InteractionRegistry`
- Reuse server-side validation rules for async submissions

### Work

1. Add WebSocket handling for:
   - `questionnaire_submit`
   - `questionnaire_cancel`
2. Resolve the current questionnaire state by replaying lifecycle events for the
   `questionnaireRequestId`
3. Reject actions against terminal questionnaires
4. On submit:
   - validate answers server-side
   - emit `questionnaire_submission` on success
   - emit `questionnaire_reprompt` on validation failure
5. On cancel:
   - emit `questionnaire_update`

### Verification

- Valid async submit produces a submission event
- Invalid async submit produces reprompt state with field errors and preserved values
- Cancel transitions the questionnaire to terminal state
- Double-submit after terminal state is rejected

## Phase 5: Client Rendering And Interaction

### Goals

- Render durable pending questionnaires outside the live sync wait path
- Keep the UI consistent across live sync and durable async flows

### Work

1. Teach the chat renderer to render questionnaire lifecycle events as durable questionnaire blocks
2. Add client-side state reduction keyed by `questionnaireRequestId`
3. Submit async questionnaire actions through the new protocol messages
4. Preserve server-provided validation errors and reprompt state in the UI
5. Keep completed questionnaires read-only
6. Preserve questionnaire visibility across reconnects and replay

### Verification

- Pending async questionnaires render after turn end
- Invalid async submits show field errors and preserved values
- Completed questionnaires render read-only
- Replay restores the correct questionnaire state

## Phase 6: Hidden Follow-Up Turn Wiring

### Goals

- Trigger an agent-visible hidden follow-up turn after valid async submission
- Avoid visible user bubbles for callback-style questionnaire submissions
- Queue follow-up turns if the session is already active

### Work

1. Add questionnaire-specific hidden follow-up turn entry point
2. Generate model-facing questionnaire submission projection text from structured submission events
3. Start the follow-up turn immediately if the session is idle
4. Queue the follow-up turn if the session already has an active run
5. Respect `autoResume: false` by suppressing automatic follow-up turns
6. Persist enough metadata to retry follow-up processing if the callback run fails

### Verification

- Valid submission triggers follow-up turn when `autoResume !== false`
- `autoResume: false` persists submission without follow-up turn
- Submission during an active run queues follow-up work instead of interrupting
- Follow-up prompt is hidden from ordinary visible chat rendering

## Phase 7: Prompt And Agent Contract Updates

### Goals

- Make sure agents can use async questionnaires intentionally
- Avoid breaking existing assumptions in prompts or tool usage guidance

### Work

1. Update plugin README and skill guidance for `questions_ask`
2. Document:
   - sync versus async semantics
   - timeout conversion behavior
   - callback/follow-up behavior
3. Audit internal tool guidance or prompts that assume questionnaire answers are returned
   immediately

### Verification

- Documentation reflects actual behavior
- Examples cover both sync and async usage
- No stale guidance implies that the tool always blocks for answers

## Phase 8: Rollout Flip To Async Default

### Goals

- Change the default only after the async path is proven

### Work

1. Audit current `questions_ask` call sites and agent usage patterns
2. Decide whether to:
   - flip the default globally, or
   - keep sync default in code and make async the preferred documented mode
3. If flipping the default:
   - update manifest docs
   - update skill guidance
   - add migration notes

### Verification

- Call sites continue to behave as intended
- Regression tests cover omitted `mode`
- Rollout notes are explicit

## Suggested File Touchpoints

- `packages/shared/src/chatEvents.ts`
- `packages/shared/src/protocol.ts`
- `packages/agent-server/src/ws/sessionRuntime.ts`
- `packages/agent-server/src/ws/toolCallHandling.ts`
- `packages/agent-server/src/events/eventStore.ts`
- `packages/agent-server/src/history/piSessionWriter.ts`
- `packages/agent-server/src/history/historyProvider.ts`
- `packages/plugins/official/questions/server/index.ts`
- `packages/plugins/official/questions/manifest.json`
- `packages/plugins/official/questions/README.md`
- `packages/web-client/src/index.ts`
- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/utils/interactionRenderer.ts`

## Test Matrix

- Shared schema validation
- Questions plugin unit tests
- Session runtime protocol tests
- Event store persistence tests
- Pi replay tests
- Chat renderer state-reduction tests
- End-to-end async questionnaire lifecycle tests

Critical scenarios:

- async request returns immediately
- sync request still blocks normally
- sync timeout converts to async
- invalid async submission reprompts
- reconnect restores pending questionnaire
- late submission queues follow-up while another run is active
- `autoResume: false` suppresses follow-up turn
- Pi-backed session replays questionnaire lifecycle correctly

## Recommended Implementation Order

1. Shared schemas and protocol messages
2. Server persistence and replay
3. Questions plugin contract extension
4. Async submission handlers
5. Client rendering and submission flow
6. Hidden follow-up turn wiring
7. Docs and rollout gating

## Exit Criteria

The feature is ready for broader rollout when:

- async questionnaires persist and replay correctly
- sync behavior remains stable
- late submissions reliably trigger hidden follow-up turns
- Pi-backed sessions preserve questionnaire lifecycle without a new store
- the test matrix passes for both sync and async paths
