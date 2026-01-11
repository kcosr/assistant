# Panel Tool Approvals (Draft)

## Table of Contents

- [Goal](#goal)
- [Scope](#scope)
- [Source files](#source-files)
- [UX](#ux)
- [Behavior](#behavior)
- [Data flow (proposed)](#data-flow-proposed)
- [Storage keys (proposed)](#storage-keys-proposed)

## Goal

Provide explicit, user-visible approval for tool calls that target a specific panel.

## Scope

- Only tool calls that include a `panelId` are gated.
- Approvals are panel-scoped ("any tool for this panel") and stored in-memory.
- Non-panel tool calls bypass this approval layer.

## Source files

Planned implementation (no current code references).

## UX

- When a panel-targeting tool call is received, auto-activate the panel's tab (if hidden).
- Show a bottom-edge overlay on the target panel with:
  - Tool name
  - Target panel: type, title, id
  - Session label/id (originating session)
  - Brief args summary
- Actions:
  - Approve once
  - Approve for session
  - Approve for all
  - Deny

## Behavior

- Approvals are remembered in-memory only (cleared on reload).
- If a decision is denied, the tool call is rejected and the agent receives the error.

## Data flow (proposed)

1. Agent server emits `tool_call_pending` with tool name, args, session id, target panel id.
2. Client shows panel overlay and awaits user decision.
3. Client responds with approve/deny (+ scope).
4. Server continues tool execution or rejects the call.

## Storage keys (proposed)

- `scope = once | session | global`
- `panelId` required
- If scope is `session`, key by `{ panelId, sessionId }`
- If scope is `global`, key by `{ panelId }`
