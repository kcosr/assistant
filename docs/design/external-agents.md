# External Agents (Async Connector) — Design

> Note: References to artifact content/context reflect the legacy model. In the panel plugin
> architecture, these map to artifact item context providers. Item HTTP routes now live under
> `/api/plugins/artifacts/*`.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Goals](#goals)
- [Non-goals (v1)](#non-goals-v1)
- [Current State (Today)](#current-state-today)
- [Proposed Model](#proposed-model)
- [API/Flow Diagrams](#apiflow-diagrams)
- [Server Responsibilities (External Runtime)](#server-responsibilities-external-runtime)
- [Web UI Responsibilities](#web-ui-responsibilities)
- [Config Shape (Draft)](#config-shape-draft)
- [Future Extensions](#future-extensions)

## Overview

This document proposes a new agent runtime kind: **external agents**.

External agents do not use OpenAI (or any in-process LLM provider) to produce assistant messages. Instead:

- The web UI creates/attaches a session using a **user-provided session ID** (an “external session ID”).
- User chat input is forwarded to a configured **inputUrl** (an HTTP endpoint we control the contract for).
- Assistant messages arrive **asynchronously** and are injected into the session via a new **callback URL** (an inbound HTTP endpoint on the agent server).

This enables integrating an out-of-process agent system while keeping the AI Assistant UI as the front-end.

## Source files

- `packages/agent-server/src/externalAgents.ts`
- `packages/agent-server/src/http/routes/external.ts`
- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/agent-server/src/chatProcessor.ts`

## Goals

- Support a new agent kind that:
  - forwards user input to `inputUrl`,
  - receives assistant output asynchronously,
  - displays messages in the UI as if they were produced by an in-process agent.
- Use a user-provided `sessionId` (shared between UI/CLI/external system).
- Avoid any “create session” outbound API calls in v1 (the external system can manage mapping/workflow externally).
- Keep the design forward-compatible with:
  - additional external agents (multiple shims),
  - additional in-process chat providers (non-OpenAI).

## Non-goals (v1)

- No artifact item content attachment or tool forwarding (can be added later).
- No auth/ACLs for the inbound injection endpoint (internal network assumption for now).
- No streaming assistant output back to the browser.

## Current State (Today)

- Agents are configuration templates (`AgentDefinition`) with prompts and tool scoping, but there is no runtime “agent type”.
- Sessions are local and are typically created with server-generated UUIDs.
- User chat input is handled by the in-process OpenAI-backed runtime and assistant messages stream back over WebSocket.

## Proposed Model

### Agent types

Introduce a discriminant on agent definitions:

- `type: "chat"` (default; current behavior)
- `type: "external"` (new)

This keeps future “non-OpenAI chat providers” under `"chat"` (as provider configuration) without mixing them with the async external workflow.

### Session IDs

For external agents, the session ID is **entered by the user** and becomes the session ID used everywhere:

- Web UI attaches via WS `hello { sessionId }`
- HTTP endpoints use `/api/plugins/sessions/operations/*` (sessionId is passed in the JSON body)
- The external system uses the same ID (no separate mapping required in v1)

This implies server-side validation constraints (URL-safe, length bounds, uniqueness, etc.).

## API/Flow Diagrams

### High-level architecture

```
                         (internal network; no auth in v1)

┌───────────────────────────────┐
│ Web Client (browser)           │
│  - WS: /ws                     │
│  - HTTP: /api/plugins/sessions/operations/* │
└───────────────┬───────────────┘
                │ WS hello(sessionId)
                │ WS user_message(text)
                ▼
┌──────────────────────────────────────────────────────────────┐
│ Agent Server                                                   │
│  - SessionIndex + ConversationStore                            │
│  - ExternalAgent runtime                                       │
│      • forwards user input to inputUrl                         │
│      • accepts inbound assistant messages                       │
└───────────────┬───────────────────────────────────────────────┘
                │ POST user input (our contract)
                ▼
┌───────────────────────────────┐
│ inputUrl (per external agent)  │
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│ External system                │
└───────────────┬───────────────┘
                │ POST callbackUrl (raw text)
                ▼
┌───────────────────────────────┐
│ Agent Server → WS broadcast    │
└───────────────────────────────┘
```

### Sequence: create/attach external session (user enters ID)

```
User         Web UI                 Agent Server
 |            |                        |
 | enter ID   |                        |
 |----------->| POST /api/plugins/sessions/operations/create |
 |            | { agentId, sessionId } |
 |            |----------------------->|
 |            | 201 { ok: true, result: { sessionId, ... } } |
 |            |<-----------------------|
 |            | WS connect + hello     |
 |            | { sessionId }          |
 |            |----------------------->|
 |            | session_ready(...)     |
 |            |<-----------------------|
```

### Sequence: user sends chat message (forward to inputUrl; no streaming back)

```
User         Web UI                  Agent Server              inputUrl
 |            |                         |                         |
 | type msg   | WS user_message         |                         |
 |----------->|------------------------>|                         |
 |            |                         | persist user message     |
 |            |                         |------------------------>|
 |            |                         | POST inputUrl           |
 |            |                         | { sessionId, text, ... }|
 |            |                         |<------------------------|
 |            |                         | 200 { ok:true }         |
 |            | (no assistant stream)   |                         |
```

### Sequence: external agent sends assistant message back (callback inject)

```
External system                Agent Server                               Web UI
        |                         |                                        |
        | produce assistant text  |                                        |
        | POST callbackUrl        |                                        |
        | (raw text body)         |                                        |
        |------------------------>| persist assistant + broadcast over WS   |
        |                         |--------------------------------------->|
        |                         | 200 { ok:true }                        |
        |<------------------------| render assistant (+ optional TTS)       |
```

## Server Responsibilities (External Runtime)

### 1) Session creation/attach with user-provided ID

Extend the session creation path so clients can specify the session ID:

- `POST /api/plugins/sessions/operations/create`
  - Body: `{ agentId: string, sessionId?: string }`
  - For `type: "external"` agents, `sessionId` is required by the UI flow.
  - Behavior:
    - If session does not exist: create it with that ID and set `agentId`.
    - If session exists with same agentId: treat as attach (idempotent).
    - If session exists with different agentId: reject (avoid cross-wiring).
    - If session is deleted: “revive” (idempotent attach).

Validation (recommended):

- Non-empty, trimmed.
- Length limit (e.g. ≤ 128).
- URL-safe character set: `[A-Za-z0-9_-]`.

### 2) Forward user input to inputUrl

When a session is associated with an external agent:

- On WS `user_message`:
  - persist the user message as normal (conversation log)
  - asynchronously `POST` to `inputUrl` with our standard payload (timeout 5s, no retries)
  - do not attempt to run an in-process LLM completion

Proposed input payload (v1, draft):

```json
{
  "sessionId": "EXTERNAL-123",
  "agentId": "external-agent-a",
  "callbackUrl": "http://agent-server.internal/external/sessions/EXTERNAL-123/messages",
  "message": {
    "type": "user",
    "text": "hello",
    "createdAt": "2025-12-12T00:00:00.000Z"
  }
}
```

Notes:

- If the external system needs its own internal IDs, it can map from `sessionId` to those IDs.
- Error handling (v1): if `inputUrl` returns non-2xx (or times out), inject an error message into the chat.

### 3) Accept assistant output injection (new inbound endpoint)

Add a new HTTP endpoint that appends an assistant message to a session and broadcasts it to connected clients:

- `POST /external/sessions/:sessionId/messages`
  - Body (v1): raw text (may contain Markdown)
  - Behavior:
    - Ensure the session exists and is not deleted.
    - Append an assistant message to the conversation store (modality `text`).
    - Broadcast an assistant message to connected clients (reuse the existing message path so Markdown + optional TTS work).
    - Return `200 OK` (no JSON body required).

Example curl heredoc (v1):

```bash
curl -sS -X POST \
  "http://agent-server.internal/external/sessions/EXTERNAL-123/messages" \
  --data-binary @- <<'MSG'
Here is a *Markdown* reply.

- One
- Two
MSG
```

## Web UI Responsibilities

### External session creation UX

For external agents, “New session” should prompt for an ID (or provide an “Attach” action):

- Pick an external agent.
- User enters external session ID.
- UI calls `POST /api/plugins/sessions/operations/create { agentId, sessionId }`.
- UI switches to that session and connects WS with `hello { sessionId }`.

### Chat UX for async agents

External agents will not stream assistant responses; UX options:

- After sending user input, append an italic status line (same style as the “Interrupted” indicator), for example: “Sent to external agent”.
- Remove the status line when the next assistant message arrives (or replace it with an error line if forwarding fails).

## Config Shape (Draft)

Agents gain a `type` and (for external agents) an `inputUrl` plus a `callbackBaseUrl`.

```json
{
  "agentId": "external-agent-a",
  "displayName": "External Agent A",
  "description": "Async external agent via inputUrl",
  "type": "external",
  "external": {
    "inputUrl": "http://external.internal/v1/assistant/input",
    "callbackBaseUrl": "http://agent-server.internal"
  }
}
```

No create-session URL is required in v1.

## Future Extensions

### Send active item pointer/content (legacy artifact naming)

Later we may add an opt-in UI toggle: “Send active item content with messages”.

If enabled, the forwarded payload could include:

- `activeArtifact: { type, id, name? }`
- `activeArtifactContent: <full artifact JSON>` (legacy name; for example, full note content)

This would require defining:

- size/limits for content payloads,
- redaction rules (if needed),
- content refresh policy (send only on change vs every message).

### External session discovery/attach

Add a dedicated endpoint to “attach” a session ID (or validate it exists externally via shim), and improve UX around conflicts.

### Auth and transport hardening

- Require a shared token for `POST /external/sessions/:id/messages`.
- Add structured audit logs for injected messages.
