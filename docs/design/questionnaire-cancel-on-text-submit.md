# Cancel Pending Interactions on Text Submit

## Problem

When a questionnaire or approval overlay is displayed and the user submits text via the chat input, the system gets into an out-of-sync state:

1. The questionnaire remains visually pending on the client
2. The server still has an interaction waiting for a response
3. The new text input is processed, but the stale interaction causes confusion

This creates a poor user experience where things appear "stuck".

## Desired Behavior

When the user submits text while a questionnaire or approval is displayed:
1. **Cancel all pending interactions** (questionnaires and approvals) before sending the text
2. Mark them as cancelled in the UI
3. Send cancel responses to the server (fire-and-forget)
4. Then send the text input normally

This matches user intent - submitting text implies abandoning the pending interaction flow.

## Current Architecture

### Client Side

- **ChatRenderer** (`packages/web-client/src/controllers/chatRenderer.ts`):
  - Tracks pending interactions via `pendingInteractionToolCalls` Set
  - Stores interaction elements via `interactionElements` Map
  - Maps toolCallId → interactionId via `interactionByToolCall` Map
  - Has `sendInteractionResponse` callback to notify server

- **TextInputController** (`packages/web-client/src/controllers/textInputController.ts`):
  - Handles form submission via `sendUserText()`
  - No awareness of pending questionnaires

- **interactionRenderer** (`packages/web-client/src/utils/interactionRenderer.ts`):
  - `applyInteractionResponse()` with `action: 'cancel'` marks interaction complete

### Server Side

- Server waits for interaction responses on pending requests
- Receives `tool_interaction_response` messages with `action: 'cancel'` or `action: 'submit'`
- If no response comes and text is sent, the interaction remains orphaned

## Solution

### 1. Add method to ChatRenderer to cancel pending interactions

```typescript
// In ChatRenderer class
cancelPendingInteractions(): Array<{
  sessionId: string;
  toolCallId: string;
  interactionId: string;
}> {
  const cancelled: Array<{...}> = [];
  
  for (const toolCallId of this.pendingInteractionToolCalls) {
    const interactionId = this.interactionByToolCall.get(toolCallId);
    const element = interactionId ? this.interactionElements.get(interactionId) : null;
    
    if (element && interactionId) {
      const sessionId = element.dataset['sessionId'];
      if (sessionId) {
        // Mark as cancelled in UI
        applyInteractionResponse(element, {
          toolCallId,
          interactionId,
          action: 'cancel',
          reason: 'User sent new message',
        });
        
        cancelled.push({ sessionId, toolCallId, interactionId });
      }
    }
  }
  
  this.pendingInteractionToolCalls.clear();
  return cancelled;
}
```

### 2. Add callback option to ChatRenderer

Add a new option to `ChatRendererOptions`:
```typescript
onCancelPendingQuestionnaires?: () => void;
```

### 3. Wire up in input runtime

In `TextInputController` options, add:
```typescript
cancelPendingInteractions?: () => void;
```

Before sending text in `sendUserText()`:
```typescript
sendUserText(rawText: string): void {
  // ... validation ...
  
  // Cancel any pending interactions first (fire-and-forget)
  this.options.cancelPendingInteractions?.();
  
  // Then send the text
  // ... existing logic ...
}
```

### 4. Connect the pieces in chatPanelServices or main setup

When creating the input runtime, pass a callback that:
1. Calls `chatRenderer.cancelPendingInteractions()`
2. The method internally sends cancel responses to the server via the existing `sendInteractionResponse` callback

## Files to Update

1. `packages/web-client/src/controllers/chatRenderer.ts`
   - Add `cancelPendingInteractions()` method that cancels all pending interactions and sends responses

2. `packages/web-client/src/controllers/textInputController.ts`
   - Add `cancelPendingInteractions` option
   - Call it before sending text in `sendUserText()`

3. `packages/web-client/src/panels/input/runtime.ts`
   - Wire up the callback from chat runtime to text input controller

4. `packages/web-client/src/utils/chatPanelServices.ts` or equivalent setup
   - Connect chatRenderer's cancel method to input runtime

5. `packages/web-client/src/controllers/chatRenderer.test.ts`
   - Add tests for the new cancel behavior

## Alternatives Considered

**Block text input while interaction is pending**: Rejected because it creates friction for users who want to ignore an interaction and continue chatting.

**Wait for server acknowledgment before sending text**: Rejected for simplicity. Fire-and-forget approach means a tiny race window but simpler implementation and better UX (no delay).

## Open Questions

None - scope confirmed to include both questionnaires and approvals.
