# Async Questionnaire Mode

## Overview

This document defines an async-capable execution model for `questions_ask`.

The current questionnaire flow is tied to `requestInteraction()` waiting on an in-memory
interaction registry. That works for live submit / cancel / reprompt, but it does not support a
questionnaire remaining usable after the tool call times out or after the agent ends its turn.

The proposed model makes questionnaires durable session artifacts with two tool modes:

- `sync`: wait for a live response
- `async`: create a durable questionnaire request and return immediately

`async` is the default mode.

Implementation rollout note:

- The long-term target model is `async` by default
- The initial rollout should preserve current behavior by defaulting to `sync` until callers are
  audited or a feature flag enables the async default

## Goals

- Let agents ask structured questions without blocking the run by default
- Allow `sync` callers to downgrade to `async` on timeout
- Keep questionnaires usable in the UI after a turn ends
- Preserve provenance back to the original tool call
- Reuse the existing session event model and Pi custom-entry mirroring
- Deliver late questionnaire submissions back to the agent as a hidden follow-up turn

## Non-Goals

- Keeping the original timed-out tool call alive indefinitely
- Storing mutable questionnaire state in a separate ad hoc status file
- Encoding late questionnaire submissions as visible assistant messages
- Overloading ambient context metadata as the canonical storage format
- Automatic TTL-based expiration in the initial version

## Design Summary

Questionnaires become first-class durable session events.

For normal use, `questions_ask` in `async` mode:

1. Emits a questionnaire request event
2. Returns immediately to the agent with a pending result
3. Leaves the questionnaire rendered and answerable in the UI
4. On late submit, emits questionnaire submission events
5. Triggers a hidden follow-up turn so the agent can react to the answers

For `sync` mode:

1. The tool still uses the live interaction wait path
2. A live submit or cancel resolves the tool call normally
3. If the live wait times out and `onTimeout: "async"` is configured, the questionnaire becomes a
   durable async request and the tool returns a queued result

## Tool Contract

### Request

```ts
type QuestionsAskArgs = {
  prompt?: string;
  schema: QuestionnaireSchema;
  timeoutMs?: number;
  completedView?: {
    showInputs?: boolean;
    summaryTemplate?: string;
  };
  validate?: boolean;
  mode?: 'sync' | 'async';        // target default: 'async'; rollout may default to 'sync'
  onTimeout?: 'error' | 'async' | 'cancel';
  autoResume?: boolean;           // default: true
};
```

### Response

Async creation returns immediately:

```ts
{
  ok: true,
  pending: true,
  mode: 'async',
  questionnaireRequestId: string,
  toolCallId?: string,
  message: string
}
```

Synchronous completion returns the existing shape:

```ts
{
  ok: true,
  answers: Record<string, unknown>
}
```

Synchronous cancel returns the existing shape:

```ts
{
  ok: false,
  cancelled: true
}
```

Sync timeout with async fallback returns:

```ts
{
  ok: true,
  pending: true,
  mode: 'async',
  questionnaireRequestId: string,
  toolCallId?: string,
  message: string,
  convertedFromSync: true
}
```

## Identity And Provenance

Each questionnaire instance should preserve three ids:

- `questionnaireRequestId`: durable identity for the questionnaire lifecycle
- `toolCallId`: provenance back to the original `questions_ask` call
- `interactionId`: identity of the specific rendered live interaction instance

`questionnaireRequestId` is new and stable across the full lifecycle.

`toolCallId` is stable across reprompts and ties the request back to the originating tool call.

`interactionId` is ephemeral and may change when a live request is re-rendered or reprompted. It
must not be treated as the durable questionnaire identity.

## Event Model

Add questionnaire-specific chat events.

```ts
type QuestionnaireStatus =
  | 'pending'
  | 'submitted'
  | 'cancelled';

type QuestionnaireMode = 'sync' | 'async';
```

### `questionnaire_request`

Emitted when a durable questionnaire request is created.

```ts
{
  questionnaireRequestId: string;
  toolCallId: string;
  toolName: 'questions_ask';
  mode: 'sync' | 'async';
  prompt?: string;
  schema: QuestionnaireSchema;
  status: 'pending';
  createdAt: string;
  sourceInteractionId?: string;
  completedView?: {
    showInputs?: boolean;
    summaryTemplate?: string;
  };
}
```

### `questionnaire_update`

Emitted for status changes that do not carry final answers.

```ts
{
  questionnaireRequestId: string;
  toolCallId: string;
  status: 'cancelled';
  updatedAt: string;
  reason?: string;
}
```

### `questionnaire_submission`

Emitted when answers are submitted.

```ts
{
  questionnaireRequestId: string;
  toolCallId: string;
  status: 'submitted';
  submittedAt: string;
  interactionId?: string;
  answers: Record<string, unknown>;
}
```

### `questionnaire_reprompt`

Emitted when an async submission fails validation and the questionnaire remains open.

```ts
{
  questionnaireRequestId: string;
  toolCallId: string;
  status: 'pending';
  updatedAt: string;
  errorSummary: string;
  fieldErrors: Record<string, string>;
  initialValues: Record<string, unknown>;
}
```

## Lifecycle

### Async Mode

1. Tool validates arguments and generates `questionnaireRequestId`
2. Server emits `questionnaire_request`
3. Tool returns `{ pending: true, mode: 'async', questionnaireRequestId, ... }`
4. UI renders the questionnaire as a pending durable block
5. User later submits or cancels through the async questionnaire submission endpoint
6. Server validates the submission using the same server-side questionnaire validation rules as the
   sync path
7. Valid submit emits `questionnaire_submission`
8. Invalid submit emits `questionnaire_reprompt` and the questionnaire remains pending
9. Cancel emits `questionnaire_update`
10. If a valid submit succeeds and `autoResume !== false`, server triggers a hidden follow-up turn

### Sync Mode

1. Tool uses the existing live `requestInteraction()` flow
2. Live submit resolves immediately
3. Validation failures reprompt as they do today
4. Timeout handling depends on `onTimeout`

Timeout behavior:

- `error`: current timeout error behavior
- `cancel`: resolve as cancelled
- `async`: emit `questionnaire_request`, return queued result, keep UI block live

### `autoResume: false`

When `autoResume` is `false`:

1. The questionnaire lifecycle still persists normally
2. Valid submissions still emit `questionnaire_submission`
3. The UI still marks the questionnaire completed
4. No hidden follow-up turn is triggered automatically

This allows workflows where the questionnaire is a durable collection surface but the agent should
not resume until the user explicitly sends another visible message.

## Client Submission Protocol

Async questionnaires cannot rely on the existing `tool_interaction_response` wait path because the
original tool call may already be complete.

Add a dedicated client-to-server protocol for durable questionnaire actions:

```ts
type ClientQuestionnaireActionMessage =
  | {
      type: 'questionnaire_submit';
      sessionId: string;
      questionnaireRequestId: string;
      answers: Record<string, unknown>;
    }
  | {
      type: 'questionnaire_cancel';
      sessionId: string;
      questionnaireRequestId: string;
      reason?: string;
    };
```

The server handles these messages against the durable questionnaire state, not against
`InteractionRegistry`.

## Storage Model

Do not introduce a brand-new questionnaire state file initially.

Persist questionnaire lifecycle through the existing session event path:

- non-Pi sessions: `sessions/<sessionId>/events.jsonl`
- Pi sessions: mirror questionnaire events into the Pi session JSONL as `assistant.event` custom
  entries, the same way interaction overlay events are mirrored today

Current architecture already supports:

- provider-neutral session events in `events.jsonl`
- Pi-specific custom event mirroring for supplemental events
- history reconstruction from Pi custom entries

Questionnaire events should extend that model rather than bypass it.

For Pi-backed sessions, questionnaire lifecycle events should be mirrored into the Pi session JSONL
as `assistant.event` custom entries, just like `interaction_request`, `interaction_response`,
`interaction_pending`, and `agent_callback` are today.

## State Reconstruction

Pending questionnaires are reconstructed by replaying questionnaire lifecycle events in timestamp
order.

Reduction rules:

1. `questionnaire_request` creates a pending record
2. `questionnaire_submission` marks the record submitted and stores answers
3. `questionnaire_reprompt` keeps the record pending and updates validation UI state
4. `questionnaire_update` with `cancelled` closes the record

This keeps storage append-only and avoids a mutable sidecar status file.

If lookup becomes too expensive later, add a derived index as an optimization, not as the source
of truth.

The initial version should not introduce automatic expiration. A questionnaire remains pending
until submission, cancellation, or session deletion.

## Hidden Follow-Up Turn

Late questionnaire submissions should not be injected as visible assistant text.

Instead, when `autoResume !== false`, the server should trigger a hidden follow-up turn whose input
is machine-readable questionnaire submission metadata.

Hidden means:

- the submission is persisted as structured questionnaire lifecycle events
- the follow-up turn is persisted in provider history
- the follow-up input is not rendered as a normal visible user message bubble

This is analogous to the current callback-style hidden turn behavior used for async agent messaging,
but it should be a questionnaire-specific callback path rather than an `agent_callback` event.

Suggested hidden callback text:

```xml
<questionnaire-response
  questionnaire-request-id="qr_123"
  tool-call-id="call_abc"
  interaction-id="iq_456"
  tool="questions_ask"
  submitted-at="2026-03-29T18:22:00Z"
  answers-json="{&quot;name&quot;:&quot;Ada&quot;,&quot;role&quot;:&quot;dev&quot;}" />
```

This should be treated as hidden user-side callback input, not assistant text and not ambient
context metadata.

The canonical stored representation remains the structured questionnaire events. The XML snippet is
only the prompt projection consumed by the agent turn.

## Follow-Up Turn Scheduling

If the session is idle when a valid async submission arrives, the server should start the hidden
follow-up turn immediately.

If the session already has an active run, the hidden follow-up turn should be queued and executed
after the active run completes. Questionnaire submissions must not interrupt an active run by
default.

If the hidden follow-up turn fails, the submission event remains persisted. The server may retry the
follow-up turn later, but the questionnaire itself must not revert back to pending.

## UI Behavior

- Async questionnaires render as normal questionnaire blocks
- Pending async questionnaires remain usable after the originating turn ends
- Completed questionnaires render read-only
- Reconnect and replay must restore pending questionnaires from persisted events
- If a sync questionnaire downgrades to async on timeout, the UI should keep the same visible block
  when possible, but the durable record is keyed by `questionnaireRequestId`
- Invalid async submissions should show field-level validation errors and preserved inputs without
  creating a follow-up turn

## Server Changes

1. Extend `questions_ask` args with `mode`, `onTimeout`, and `autoResume`
2. Add questionnaire lifecycle ChatEvent types and schemas
3. Add async questionnaire submission handlers for `questionnaire_submit` and `questionnaire_cancel`
4. Teach `SessionScopedEventStore` to persist and mirror questionnaire events for Pi sessions
5. Teach Pi history replay to reconstruct questionnaire events from mirrored `assistant.event`
   entries
6. Add a follow-up turn entry point for questionnaire submissions, parallel to the hidden callback
   pattern already used for async agent messaging

## Testing

Add coverage for:

- async mode returns immediately and leaves a durable questionnaire
- sync mode still works unchanged for live submit / cancel / reprompt
- sync timeout with `onTimeout: "async"` converts to a durable async questionnaire
- reconnect restores pending questionnaire blocks
- Pi-backed sessions replay questionnaire lifecycle correctly from mirrored custom entries
- late submission triggers a hidden follow-up turn with correct provenance ids
- `autoResume: false` persists submission without creating a follow-up turn
- invalid async submission emits `questionnaire_reprompt` with preserved values and field errors
- concurrent async questionnaires in one session remain distinct by `questionnaireRequestId`
- submission during an active run queues the follow-up turn instead of interrupting
- cancelled questionnaires no longer accept submission
- double-submit or replayed submit attempts are rejected once the questionnaire is terminal

## Recommendation

Adopt async questionnaires as the target model and use the existing event architecture as the
persistence layer.

The only new durable identity should be `questionnaireRequestId`.

Build questionnaire lifecycle as first-class events, mirror them into Pi custom entries, and send
late submissions back to the agent through a hidden follow-up turn.

For rollout safety, keep the existing sync default until caller behavior is audited, then flip the
default to async once the new path is established.
