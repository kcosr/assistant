# Interaction Container UI (Response-Independent Rendering)

## Overview

CLI/HTTP-triggered interactions (e.g., questionnaires) currently emit `interaction_request` events
without `turnId`/`responseId`. The web client renders standalone questionnaires only when a
`responseId` is present, so these interactions never appear in the UI. This design introduces a
**first-class interaction container** in the chat UI that is **not** tied to an assistant response
ID, enabling questionnaires to render for CLI/HTTP tool calls while preserving existing behavior
for normal chat tool calls.

## Problem Statement

- `interaction_request` events sent from HTTP/CLI paths lack `responseId` because there is no
  active chat completion run.
- The chat renderer currently uses `responseId` to place standalone questionnaire blocks, and
  returns early when it is missing.
- Result: tool call shows “running,” but the questionnaire UI never appears.

## Goals

- Render questionnaire interactions even when `responseId` and `turnId` are missing.
- Preserve the existing standalone questionnaire presentation for normal chat runs.
- Maintain reprompt behavior (replace previous interaction for the same tool call).
- Keep history replay deterministic.

## Non‑Goals

- Changing tool-call semantics or forcing HTTP/CLI to generate chat runs.
- Replacing the tool block UI with questionnaires in normal tool flows.
- Introducing a new server-side chat event type.

## Proposed Design

### 1) Interaction Containers (Client-Side)

Add a new client-side container type for **standalone interactions** that is not tied to a
response ID. When `interaction_request` has `presentation: 'questionnaire'` **and** `responseId`
is missing:

- Create (or reuse) an **interaction container** keyed by `toolCallId`.
- Insert it into the chat log (or within a synthetic turn container) at the time the event is
  processed, preserving chronological order in replay.
- Render the questionnaire inside this container using existing `createInteractionElement` logic.
- On reprompt, replace the existing interaction element for that tool call.

### 2) Placement and Ordering

To keep ordering consistent and avoid inventing server-side IDs:

- If `turnId` is present, attach the interaction container inside that turn.
- If `turnId` is missing, create a turn container using a deterministic fallback (e.g., `turnId`
  derived from the chat event id) so the interaction still groups cleanly in the DOM.
- The interaction container should appear **where the event is processed** in replay to preserve
  event order.

### 3) Interaction Lifecycle

- `interaction_request` → create interaction container + render form.
- `interaction_response` → update the interaction element to completed state (existing behavior).
- Reprompt (`interaction_request` with same toolCallId) replaces the existing interaction element
  in that container.

### 4) Tool Block Coexistence

The tool output block can remain “running” while the questionnaire is visible. This is consistent
with the current model where `requestInteraction()` pauses tool completion until the user responds.
Optionally, a follow-up can add a “Waiting for input” status or badge in the tool block.

## Rendering Rules

- `presentation: 'questionnaire'` with **responseId present** → current standalone behavior (attach
  to assistant response container).
- `presentation: 'questionnaire'` with **responseId missing** → new interaction container path.
- `presentation: 'tool'` or `interactionType: 'approval'` → unchanged.

## History Replay

Interaction containers are created deterministically from the event stream:

- Replay processes events in order and will insert the interaction container at the same point in
  the log.
- `interaction_response` events still target the interaction element by `interactionId`.

## Alternatives Considered

1) **Server-side synthetic responseId**: generates a responseId for HTTP/CLI tool calls.
   - Pros: reuses existing UI path.
   - Cons: invents response containers without real chat turns; could confuse transcript semantics.

2) **Render questionnaires inside tool blocks**: avoids standalone containers entirely.
   - Pros: simpler to implement.
   - Cons: changes the intended “standalone questionnaire” UX.

The proposed design keeps questionnaire UX intact and avoids server-side synthetic IDs.

## Files to Update

- `packages/web-client/src/controllers/chatRenderer.ts` (new interaction container handling)
- `packages/web-client/src/controllers/chatRenderer.test.ts` (new test for missing responseId)
- `packages/web-client/public/styles.css` (styles for interaction container, if needed)

## Open Questions

1) For missing `turnId`, should we attach interaction containers at the root level instead of
   creating a synthetic turn container?
2) Should the tool output block show a distinct “Waiting for input” status when a questionnaire is
   pending?
3) Do we want to persist an explicit container type in the event model long‑term, or keep it
   client‑only?
