# Interaction Pending State (First-Class)

## Overview

Interactive tools (approvals/questionnaires) require a temporary “pending user input” state. Today
the client infers that state from chat events (e.g., `interaction_request` and `interaction_response`)
to hide typing indicators, but this is fragile across transports and replay. This design proposes
a first-class pending state event so clients can render consistent UI behavior.

## Goals

- Provide an explicit, transport-agnostic signal that an interaction is awaiting user input.
- Keep typing indicators and session status accurate without relying on event ordering heuristics.
- Preserve behavior across live events and history replay.

## Non‑Goals

- Changing interaction payloads or the questionnaire schema.
- Altering tool call rendering/placement logic.

## Decisions

- Emit `interaction_pending` as a **chat event** (not a separate session status message).
- Emit for **all interaction types** (approvals + questionnaires).
- Track pending state **per tool call**; clients suppress typing if *any* pending interaction exists.

## Proposed Design

### Event

Introduce a new chat event type:

```
type: 'interaction_pending'
payload: {
  toolCallId: string;
  toolName: string;
  pending: boolean; // true when waiting for input, false when resolved/cancelled/timeout
  presentation?: 'tool' | 'questionnaire';
}
```

### Server Behavior

- Emit `interaction_pending: true` immediately before broadcasting `interaction_request`.
- Emit `interaction_pending: false` when the interaction resolves (submit/approve/deny/cancel) or
  times out.
- Include the event in history/event store so replay reconstructs the pending state.

### Client Behavior

- When `pending: true`, suppress typing indicators for the session and mark the chat panel
  status as idle (waiting for user input).
- When `pending: false`, resume normal typing indicator behavior.
- Do not infer pending state from `interaction_request/response` once this event is supported.

## Alternatives Considered

1) **Keep inference only**
   - Simple, but fragile to ordering and inconsistent across replay.
2) **Session status API**
   - Similar outcome but requires separate channel; a dedicated chat event is simpler and
     keeps state consistent with chat history.

## Files to Update

- `packages/shared/src/chatEvents.ts` (new event type + schema)
- `packages/agent-server/src/events/chatEventUtils.ts` (emit helper)
- `packages/agent-server/src/ws/toolCallHandling.ts` (emit pending state)
- `packages/agent-server/src/events/eventStore.ts` (include in overlay/history if needed)
- `packages/agent-server/src/history/historyProvider.ts` (ensure replay includes new event)
- `packages/web-client/src/controllers/serverMessageHandler.ts` (use explicit pending state)
- `packages/web-client/src/controllers/chatRenderer.ts` (optional: remove inference-only logic)
- `packages/web-client/src/controllers/chatRenderer.test.ts`
- `packages/web-client/src/controllers/serverMessageHandler*.test.ts`
- `CHANGELOG.md`

## Open Questions

1) Should the pending event include the current `interactionId` for debugging, or keep the payload
   minimal?
