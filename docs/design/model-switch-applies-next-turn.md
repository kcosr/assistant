# Model switch should apply on next turn (without cancelling active response)

## Overview
Changing the chat model from the chat panel currently cancels any active run in the same session. This is disruptive when a user adjusts settings while a response is still streaming.

Proposed behavior: persist the newly selected model immediately, but do **not** cancel the in-flight response. The change should take effect on the next user turn.

## Motivation
- Prevent accidental interruption of active responses.
- Match user expectations for model dropdown behavior.
- Keep explicit cancellation as a separate user action.

## Proposed Solution
1. In `handleSetSessionModel`, remove active-run cancellation during model updates.
2. Keep existing validation and authorization checks unchanged:
   - session subscription validation,
   - allowed model validation for selected agent,
   - persistence via `sessionIndex.setSessionModel(...)`.
3. Keep updating `state.summary` after persistence, so the UI reflects the selected model immediately.
4. Update runtime tests to verify model updates do not abort active runs.

## Implementation Steps
1. Update `packages/agent-server/src/ws/sessionRuntime.ts`:
   - remove (or guard out) `cancelActiveRun(...)` call in `handleSetSessionModel`.
2. Update `packages/agent-server/src/ws/subscriptionRuntime.test.ts`:
   - replace the current model-change cancellation assertion with a no-cancel assertion,
   - keep/extend assertions that model persistence still occurs.
3. Run websocket runtime tests for the session runtime path.

## Alternatives Considered
- Keep cancellation behavior and add UI warning: still interrupts active work.
- Delay applying model until run completion: introduces extra pending-state complexity.

## Out of Scope
- Changing `set_session_thinking` behavior (can be handled separately if desired).
- Any UI copy or tooltip updates.

## Files to Update
- `packages/agent-server/src/ws/sessionRuntime.ts`
- `packages/agent-server/src/ws/subscriptionRuntime.test.ts`

## Open Questions
- None.
