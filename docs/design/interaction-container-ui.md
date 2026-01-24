# Interaction Container UI (Tool-Call Anchored Rendering)

## Overview

CLI/HTTP-triggered tool calls and interactions (approvals/questionnaires) can arrive without a
`responseId`/`turnId`. The current chat renderer relies on `responseId` to place tool blocks and
standalone questionnaires, so those interactions never appear in the UI. This design anchors
rendering to the **toolCallId** when `responseId` is missing, ensuring CLI/HTTP tool calls and
questionnaires look identical to built-in agent flows without inventing synthetic response IDs.

## Problem Statement

- `tool_call`/`interaction_request` events from CLI/HTTP paths lack `responseId` because there is
  no active chat completion run.
- The renderer currently returns early for tool calls without `responseId`, and standalone
  questionnaires only render when a response container exists.
- Result: tool calls stall at “running,” and questionnaires never appear in the UI.

## Goals

- Render tool blocks and interactions even when `responseId`/`turnId` are missing.
- Keep the same UI/UX for tool approvals and questionnaires as built-in agents.
- Preserve reprompt behavior (replace previous interaction for the same tool call).
- Keep history replay deterministic without inventing server-side response IDs.

## Non‑Goals

- Generating synthetic `responseId` values on the server.
- Changing tool-call semantics or enforcing chat-run creation for CLI/HTTP tools.
- Replacing the standalone questionnaire UI with tool-block rendering.

## Proposed Design

### 1) Tool-Call Containers (Client-Side)

Introduce a **tool-call container** keyed by `toolCallId` for response-less events:

- If `responseId` is present → use the existing assistant response container (current behavior).
- If `responseId` is missing → create a `tool-call-only` container under the current turn and
  store it by `toolCallId`.
- Tool blocks are appended to the tool-call container via the existing tool-call grouping logic.

This preserves the familiar layout (assistant response container + tool group) while allowing
CLI/HTTP tool calls to render without a response ID.

### 2) Interaction Rendering (Questionnaire + Approval)

- **Questionnaire (presentation: `questionnaire`)**
  - With `responseId`: render as a standalone interaction in the assistant response container
    (unchanged).
  - Without `responseId`: render as a standalone interaction in the tool-call container for the
    same `toolCallId`.
  - Reprompt replaces the prior interaction element for that tool call (unchanged).

- **Approval (presentation: `tool`)**
  - Attach to the tool block as today.
  - Because tool blocks now render without `responseId`, approvals work for CLI/HTTP tool calls
    as well.

### 3) Ordering and Replay

- If `turnId` is missing, a deterministic fallback (event id) is used to create a turn container.
- Tool-call containers are inserted at the point the event is processed, preserving event order
  during replay.
- Tool calls that receive **approvals** or **questionnaires** are treated as standalone blocks:
  they are ungrouped (or prevent grouping) so the interaction stays visually distinct and does
  not collapse into adjacent tool-call groups.

### 4) CLI/HTTP Tool-Call Rendezvous (Server-Side)

CLI agents invoke plugins via a shell tool call (for example, `bash`), while the plugin HTTP
request generates a new `callId`. To keep questionnaires attached to the originating tool block,
the server now:

- Records CLI tool calls (callId + args) in a short-lived per-session queue.
- When an HTTP interaction request arrives, waits briefly (~1s) for a matching CLI tool call.
- Scores candidates using plugin/tool tokens, with a `bash` fallback if no score matches.
- Reuses the matched CLI `callId` and carries forward the tool call’s `turnId`/`responseId` so
  replay can anchor approvals/questionnaires to the correct assistant response.

This keeps CLI questionnaires visually identical to built-in agent flows without requiring a
synthetic response id.

## ResponseId Semantics

`responseId` remains useful for grouping assistant text/thinking with tool calls in normal chat
runs. For CLI/HTTP flows, there is no native response ID, so the renderer uses `toolCallId` as the
primary anchor instead of synthesizing OpenAI-specific identifiers.

## Alternatives Considered

1) **Server-side synthetic responseId**
   - Pros: reuses existing response container logic.
   - Cons: introduces fake response containers and leaks provider-specific semantics into the
     session layer.

2) **Render questionnaires inside tool blocks**
   - Pros: simpler to implement.
   - Cons: changes the intended standalone questionnaire UX.

The proposed design keeps the UI consistent across built-in and CLI/HTTP agents without adding
synthetic response IDs.

## Files to Update

- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/chatRenderer.test.ts`
- `packages/agent-server/src/plugins/operations.ts`
- `packages/agent-server/src/sessionHub.ts`
- `packages/agent-server/src/ws/cliCallbackFactory.ts`
- `packages/agent-server/src/ws/cliToolCallRendezvous.ts`
- `packages/agent-server/src/ws/cliToolCallRendezvous.test.ts`
- `packages/web-client/public/styles.css` (only if a `tool-call-only` container needs styling)

## Open Questions

1) Do we want a subtle “Waiting for input” status on tool blocks when a questionnaire is pending?
2) Should `tool-call-only` containers have any visual affordance to distinguish CLI/HTTP tool calls?
