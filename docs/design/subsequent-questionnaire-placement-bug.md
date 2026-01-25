# Subsequent Questionnaire Placement Bug

## Overview

**Issue**: When a second questionnaire is raised later in the conversation, it renders in place of the first one from earlier. Reported in pi-cli (agent using the web client).

## Investigation Summary

Performed thorough code review of `packages/web-client/src/controllers/chatRenderer.ts` focusing on `renderStandaloneInteraction` and related methods.

### Key Findings

1. **Questionnaire tracking uses unique identifiers**:
   - `interactionByToolCall`: Maps `toolCallId → interactionId`
   - `interactionElements`: Maps `interactionId → HTMLElement`
   - Each questionnaire with a different `toolCallId` gets its own entry

2. **Replacement logic is scoped to toolCallId**:
   ```typescript
   const existingId = this.interactionByToolCall.get(payload.toolCallId);
   if (existingId) {
     const existing = this.interactionElements.get(existingId);
     if (existing) {
       existing.remove();  // Only removes if SAME toolCallId
     }
   }
   ```
   This correctly removes old questionnaires only when a reprompt comes in (same toolCallId, different interactionId).

3. **Container logic creates separate containers per toolCallId**:
   - If `responseId` is set: Both questionnaires share an `.assistant-response` container (both appended)
   - If `responseId` is null: Each questionnaire gets its own container via `getOrCreateToolCallContainer`

### Test Results

Added two tests that both **pass**:

1. `renders multiple questionnaires in the same response without removing earlier ones` (via `replayEvents`)
2. `renders multiple questionnaires via handleNewEvent without removing earlier ones` (live events)

Both tests verify:
- Two questionnaires with different `toolCallId` values both remain in the DOM
- First questionnaire is marked complete (`interaction-complete` class)
- Second questionnaire remains active
- Both are visible and contain correct content

### Possible Bug Scenarios

Since tests pass, the bug may be one of these scenarios:

1. **Reprompt behavior (expected)**: If the second questionnaire is a validation reprompt (same `toolCallId`), the first questionnaire IS intentionally replaced. This is correct behavior per `questionnaire-tool.md` design.

2. **Identical toolCallId**: If the agent somehow sends two questionnaires with the same `toolCallId` (unusual but possible), the second would replace the first.

3. **CSS/visual issue**: Both elements exist in DOM but one is visually hidden due to viewport, scrolling, or overlay.

4. **History/replay timing**: Something specific about how events are persisted and replayed that isn't captured in unit tests.

## Recommendation

Need clarification to proceed:

1. **Is this actually a reprompt scenario?** The `questions_ask` tool has built-in validation that reprompts with the same `toolCallId`. This replacement is expected behavior.

2. **Can you reproduce and capture event data?** Enable debug mode (`localStorage.setItem('aiAssistantWsDebug', '1')`) and check console logs for:
   - `toolCallId` values for both questionnaires
   - `interactionId` values for both questionnaires
   - Logs showing "interaction placement" with `hasToolBlock` status

3. **Are both elements in the DOM?** Use browser devtools to check if both `.interaction-questionnaire` elements exist, or if only one is present.

## Files Updated

- `packages/web-client/src/controllers/chatRenderer.test.ts` — Added two tests for multiple questionnaire scenarios

## Files to Update (if bug is confirmed)

- `packages/web-client/src/controllers/chatRenderer.ts` — `renderStandaloneInteraction` method

## Open Questions

1. What are the exact `toolCallId` values for the first and second questionnaires? (If same, it's a reprompt)
2. In browser devtools, are both `.interaction-questionnaire` elements present in the DOM when the bug occurs?
3. What is the conversation flow that triggers this? (Two separate tool calls vs one tool call with reprompt)
