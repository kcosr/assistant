# Chat model switch should not cancel active run

## Overview
Switching the selected model from the chat panel currently cancels any in-flight chat response for that session. This makes model selection feel destructive and interrupts users who are still reading or waiting on a response.

The fix is to treat model (and thinking) updates as **next-run configuration** changes: persist the new session settings immediately, but do not cancel an active run.

## Motivation
- Avoid unintentional interruption when users adjust model selection mid-response.
- Keep model picker behavior predictable: changes apply to the next prompt.
- Align with typical chat UX where in-flight generation continues unless the user explicitly presses cancel.

## Proposed Solution
1. Update server runtime handling of `set_session_model` so it no longer calls `cancelActiveRun` when `state.activeChatRun` exists.
2. Apply the same treatment to `set_session_thinking` for consistency (same current cancellation behavior).
3. Keep validation and persistence behavior unchanged:
   - validate session subscription and allowed values,
   - persist new model/thinking in session index,
   - update `state.summary`.
4. Update tests that currently assert cancellation on model change to assert **no abort** instead.
5. Add/adjust a thinking-change test similarly if needed to prevent regressions.

## Implementation Steps
1. Remove (or gate off) `cancelActiveRun` invocation in:
   - `handleSetSessionModel`
   - `handleSetSessionThinking`
2. Ensure no other cancellation path is triggered by these handlers.
3. Update unit tests in `subscriptionRuntime.test.ts`:
   - replace model-change cancellation expectation with no-cancel expectation,
   - verify model summary still updates.
4. Run relevant websocket/session runtime tests.

## Alternatives Considered
- **Keep cancellation behavior but prompt in UI first**: still disruptive and adds UX complexity.
- **Cancel only for some providers/models**: inconsistent and hard to explain.
- **Delay persistence until run completes**: complicates state management and user feedback.

## Out of Scope
- UI affordance changes (e.g., “applies next message” helper text).
- Any change to explicit user-triggered output cancel behavior.

## Files to update
- `packages/agent-server/src/ws/sessionRuntime.ts`
  - Stop cancelling active runs in model/thinking update handlers.
- `packages/agent-server/src/ws/subscriptionRuntime.test.ts`
  - Update tests to verify no active-run cancellation on model/thinking changes.

## Open Questions
- None.
