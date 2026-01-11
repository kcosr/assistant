# Issue #586: Unified Chat Rendering + Transcript Replay

This document describes the end-to-end behavior introduced/refined for issue `#586` in `kcosr/assistant`:

- Real-time WebSocket rendering and transcript reconstruction produce (as close as possible) **identical DOM structures**.
- Tool calls, tool output, and interruption state persist across refresh.
- Agent-specific quirks (built-in/OpenAI streaming vs CLI agents) normalize into the same client-side rendering model.

It is intentionally implementation-oriented (file pointers, event shapes, edge cases), and complements `docs/design/chat-message-handling.md`.

---

## Table of Contents

- [Problem Statement (What “unified rendering” means)](#1-problem-statement-what-unified-rendering-means)
- [Data Model: Transcript Records](#2-data-model-transcript-records)
- [Backend: Emitting + Logging Events](#3-backend-emitting--logging-events)
- [Frontend: Shared Renderer (`MessageRenderer`)](#4-frontend-shared-renderer-messagerenderer)
- [Source files](#source-files)

## Source files

- `packages/agent-server/src/conversationStore.ts`
- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/ws/toolCallHandling.ts`
- `packages/agent-server/src/ws/chatOutputCancelHandling.ts`
- `packages/agent-server/src/http/routes/external.ts`
- `packages/web-client/src/controllers/messageRenderer.ts`
- `packages/web-client/src/utils/toolOutputRenderer.ts`

## 1) Problem Statement (What “unified rendering” means)

The UI has two ways of producing the chat DOM:

1. **Real-time**: the browser receives WebSocket messages and updates DOM incrementally.
2. **Replay (refresh)**: the browser fetches the session event log (`/api/plugins/sessions/operations/events`) and reconstructs the DOM.

Issue `#586` requires these paths to match:

- **Chronological order**: content appears in the same order it streamed.
- **Interleaving**: text before tools stays before tools (and vice‑versa).
- **Multiple tools**: all tool blocks persist; not only the final one.
- **Interrupted state**: interrupted styling + indicators persist after refresh.
- **Typing indicator**: doesn’t “pop” incorrectly due to replay differences.

---

## 2) Data Model: Transcript Records

### 2.1 Storage format

The backend stores a per-session transcript as JSONL:

- One file per session: `dataDir/transcripts/<sessionId>.jsonl`
- Each line is a JSON object with a `type` field.

The transcript is treated as the **source of truth** for refresh/replay.

### 2.2 Record categories

There are two categories of records in the wild:

#### A) Legacy (turn-based) records

These represent completed “turn objects” and were historically used by reconstruction:

- `user_message`
- `assistant_message`
- `tool_call`
- `tool_result`
- `agent_message` (receiver-side agent-to-agent exchange wrapper)
- `agent_callback` (sender-side async callback text)

#### B) Stream-event records (event-based transcript)

These represent the incremental stream and are replayed through the same renderer used for real-time:

- `text_delta`, `text_done`
- `thinking_start`, `thinking_delta`, `thinking_done`
- `tool_call_start`, `tool_output_delta`, `tool_result`
- `output_cancelled`

**Key difference:** stream-event records preserve _streaming order_, not just final aggregates.

### 2.3 Key fields

Relevant fields (not exhaustive):

- `timestamp`: ISO string; used for ordering.
- `responseId`: correlates assistant text/thinking segments to a response bubble.
- `callId`: correlates tool start/output/result for a single tool invocation.
- `agentExchangeId`: correlates system agent-to-agent exchanges into a single UI wrapper (real-time); replay has a conservative legacy fallback for now.

Backend record definitions live in:

- `packages/agent-server/src/conversationStore.ts`

---

## 3) Backend: Emitting + Logging Events

### 3.1 Built-in/OpenAI-streaming path (`chatRunLifecycle.ts`)

The built-in agent path uses `packages/agent-server/src/ws/chatRunLifecycle.ts`.

It:

- Emits `text_delta` over WS and logs `text_delta` to transcript.
- Emits `text_done` over WS and logs `text_done` + `assistant_message`.
- Emits tool lifecycle messages via `toolCallHandling.ts` and logs tool stream events.

### 3.2 CLI agents (Claude/Codex/Pi) via `chatProcessor.ts`

Some parts of the system (notably `agents_message` callback turns) run through:

- `packages/agent-server/src/chatProcessor.ts` (`processUserMessage`)

To support unified replay, this path now logs stream events too:

- `logTextDelta` during streaming callbacks
- `logTextDone` when complete
- `logThinkingStart/Delta/Done` when present
- `logToolCallStart` and `logToolResult` for tool lifecycle

This ensures that “assistant output that exists live via WS” is also present in the replayable event transcript.

### 3.3 Tool execution lifecycle (`toolCallHandling.ts`)

Tool streaming is handled in:

- `packages/agent-server/src/ws/toolCallHandling.ts`

It logs:

- `tool_call` (legacy)
- `tool_call_start` (stream-event)
- `tool_output_delta` (stream-event, repeated)
- `tool_result` (stream-event + legacy-compatible shape)

### 3.4 Cancellation (`chatOutputCancelHandling.ts`)

When the user cancels output (Escape), the server:

- Aborts the current run.
- Marks in-flight tools as interrupted (emits/logs `tool_result` with `error.code = 'tool_interrupted'`).
- Emits/logs `output_cancelled`.

See:

- `packages/agent-server/src/ws/chatOutputCancelHandling.ts`

### 3.5 External agent callbacks (HTTP)

External agents can post final assistant text via:

- `POST /external/sessions/:id/messages`
- Implemented in `packages/agent-server/src/http/routes/external.ts`

This route broadcasts `text_done` and logs:

- `assistant_message` (legacy)
- `text_done` (stream-event)

This avoids “reply visible live but missing on refresh” when replay is stream-event based.

---

## 4) Frontend: Shared Renderer (`MessageRenderer`)

### 4.1 Purpose

`MessageRenderer` is the shared rendering layer used by **both**:

- Real-time WebSocket messages
- Transcript replay (event transcript)

File:

- `packages/web-client/src/controllers/messageRenderer.ts`

It consumes a normalized event union (`RenderableEvent`) and mutates the chat DOM.

### 4.2 State tracking (in-memory)

`MessageRenderer` maintains maps so it can incrementally update the correct nodes:

- `responseElements: Map<responseId, bubble>`
- `toolOutputElements: Map<callId, toolBlock>`
- `thinkingElements: Map<responseId, thinkingEl>`
- `currentTextSegments: Map<responseId, segmentEl>`
- `needsNewSegment: Set<responseId>` (tool interleaving boundary)
- `pendingAgentCallbackBlocks: Map<responseId, toolBlock>` (async `agents_message`)

### 4.3 DOM invariants the renderer enforces

Within a single assistant bubble, the renderer aims to produce a stable structure:

1. Optional `.thinking-content` (inserted at the top).
2. One or more `.assistant-message-main` segments (stream text segments).
3. One or more `.tool-output-block` nodes (inserted in stream order).
4. Optional `.typing-indicator` appended at the end while “typing”.

Text/tool interleaving works by splitting text into multiple segments whenever a tool block occurs mid-stream:

- First text segment
- Tool block
- Second text segment (continues after tool)
- …and so on

### 4.4 Tool rendering utilities

Tool block creation and content updates are factored into utilities:

- `packages/web-client/src/utils/toolOutputRenderer.ts`
- `packages/web-client/src/utils/toolResultFormatting.ts`
- `packages/web-client/src/utils/toolTruncation.ts`

These handle:

- Pending tool state
- Success/error/interrupted styling
- Truncation metadata display
- Special-casing for `agents_message` (“Sent/Received” labeling, gold styling)

---

## 5) Real-time Flow (WebSocket → DOM)

### 5.1 When the user sends a message

`TextInputController` appends:

1. A user bubble
2. A **pending assistant bubble** with a typing indicator

File:

- `packages/web-client/src/controllers/textInputController.ts`

This pending bubble is crucial because tool events (`tool_call_start`, etc.) do **not** include `responseId`.

### 5.2 Streaming messages

`ServerMessageHandler` receives WS messages and delegates rendering to `MessageRenderer`:

- `packages/web-client/src/controllers/serverMessageHandler.ts`

`MessageRenderer` uses:

- `responseId` when available (text/thinking)
- “current pending assistant bubble” when `responseId` is absent (tool events)

### 5.3 Cancel (Escape) behavior

Escape triggers:

- `KeyboardNavigationController` → `cancelAllActiveOperations()`
- which calls `SpeechAudioController.cancelAllActiveOperations()`

Files:

- `packages/web-client/src/controllers/keyboardNavigationController.ts`
- `packages/web-client/src/controllers/speechAudioController.ts`

Historically, the client removed the pending assistant bubble on cancel whenever it was still marked typing, which could delete tool-only DOM (a tool block exists, but no text had arrived yet).

Now, the client only removes the pending bubble if it is **truly empty** (only a typing indicator, no tool blocks / no other content).

Test:

- `packages/web-client/src/controllers/speechAudioController.test.ts`

---

## 6) Transcript Replay Flow (Refresh → DOM)

### 6.1 Entry point

On refresh, the client loads the transcript via:

- `packages/web-client/src/controllers/sessionDataController.ts`

The endpoint returns `messages: Array<TranscriptRecord>`, which may contain legacy or stream-event records (or a mix).

### 6.2 Choosing replay strategy

Replay uses the stream-event renderer when:

- Stream-event records exist (`text_delta/text_done/thinking*/tool_call_start/tool_output_delta/tool_result/output_cancelled`)
- AND the transcript does **not** include `agent_message` exchange records (those still use legacy grouping for now)

If stream-event replay is not possible, the legacy reconstruction path is used.

### 6.3 Tool-only response boundary problem

Tool event records currently do not carry `responseId`. Real-time solves this by:

- creating a pending assistant bubble immediately after the user message is sent

Replay must do the same, otherwise tool blocks attach to “the last assistant bubble” and content shifts across turns.

So during replay:

- After each `user_message`, the code creates a pending assistant bubble and sets the typing indicator.
- Tool events attach to that pending bubble, matching real-time.

### 6.4 Mixed transcripts: `assistant_message` without stream text

Some server-side paths historically logged `assistant_message` but not stream-event text records.

To avoid “missing replies” during stream-event replay:

- Replay now renders `assistant_message` as `text_done` **only if** that `responseId` has no stream text (`text_delta/text_done`) in the transcript.

This avoids:

- Dropping content (when only legacy exists)
- Duplicating content (when both legacy and stream events exist)

Test coverage:

- `packages/web-client/src/controllers/sessionDataController.test.ts`

---

## 7) Async `agents_message` (Agent-to-agent calls)

`agents_message` is a tool that lets one session ask another agent to do work.

Important UI behaviors:

1. The tool call appears as a tool block in the caller’s assistant bubble.
2. If the call is async/queued, the tool block stays “pending” until a callback arrives.
3. When the callback arrives, it updates the tool block content (`agent_callback_result`).
4. The system then triggers a follow-up assistant turn in the caller session (so the primary agent can respond normally).

This involves multiple record/message types:

- `tool_result` for `agents_message` with `{ mode: 'async', status: 'queued'|'async', responseId }`
- `agent_callback_result` (WS) + `agent_callback` (transcript record)
- A subsequent assistant response in the caller session (now logged as stream-event text so it replays correctly)

Implementation:

- Tool: `packages/agent-server/src/builtInTools.ts`
- Callback turn execution: `packages/agent-server/src/chatProcessor.ts`
- Tool block update: `MessageRenderer` uses `pendingAgentCallbackBlocks`

---

## 8) Known Limitations / Future Improvements

1. **Tool events lack `responseId`**:
   - Current solution relies on a “pending assistant bubble” heuristic + user-message boundaries.
   - More robust long-term: add a server-side `turnId`/`responseId` onto tool events.

2. **Agent-to-agent receiver-side UI (`agent_message` exchanges)**:
   - Replay keeps a legacy path for these blocks because they rely on grouped rendering.
   - A future migration could represent them as stream events with an explicit wrapper context.

3. **Mixed transcript formats**:
   - Replay includes guardrails to avoid duplication, but old transcripts can still have edge cases.
   - Over time, once all server paths emit stream events, replay can rely primarily on the unified renderer.

---

## 9) Debugging / Verification Tips

### 9.1 Validate transcript contents

Look at the session’s transcript JSONL file on disk and check for:

- `tool_call_start`/`tool_result` pairs for each `callId`
- `text_delta` and `text_done` around the same `responseId`
- `output_cancelled` after a cancel

### 9.2 Common failure signatures

- Tool blocks “jumping” across turns after refresh:
  - Replay did not create a pending assistant bubble after `user_message`.
- Follow-up assistant reply missing after refresh (especially after async `agents_message`):
  - Server logged only `assistant_message` without `text_done`/`text_delta` for that response, and replay selected the stream-event path.
- Tool block disappears immediately on cancel but reappears after refresh:
  - Client removed the pending assistant bubble while it already contained a tool block.

---

## 10) Key Files (Quick Index)

Backend:

- `packages/agent-server/src/conversationStore.ts`
- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/agent-server/src/ws/toolCallHandling.ts`
- `packages/agent-server/src/ws/chatOutputCancelHandling.ts`
- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/builtInTools.ts`
- `packages/agent-server/src/http/routes/external.ts`

Frontend:

- `packages/web-client/src/controllers/messageRenderer.ts`
- `packages/web-client/src/controllers/serverMessageHandler.ts`
- `packages/web-client/src/controllers/sessionDataController.ts`
- `packages/web-client/src/controllers/textInputController.ts`
- `packages/web-client/src/controllers/speechAudioController.ts`
- `packages/web-client/src/utils/toolOutputRenderer.ts`
- `packages/web-client/src/utils/chatMessageRenderer.ts`

Tests (selected):

- `packages/web-client/src/controllers/messageRenderer.test.ts`
- `packages/web-client/src/controllers/sessionDataController.test.ts`
- `packages/web-client/src/controllers/speechAudioController.test.ts`
- `packages/agent-server/src/chatProcessor.test.ts`
- `packages/agent-server/src/httpExternalAgents.test.ts`
