# PLAN

## Goal
Add a user-input shortcut for shell execution in assistant sessions:
- when a direct user message starts with `!`, treat the rest of the line (after trimming spaces immediately after `!`) as a shell command
- execute it on the server in the session working directory when available, otherwise fall back to the server process cwd
- persist the outcome in transcript history as tool events that replay after reload but are **excluded from LLM prompt/history**
- stream output in real-time using the existing tool execution pipeline
- render the result in chat as a dedicated terminal-style bubble with a terminal icon, `Terminal` heading, and markdown-rendered fenced code block output

## Agreed product decisions
- Show **only** the terminal result bubble; do **not** render the original `!command` as a normal user bubble.
- Support bang execution in:
  - websocket/manual chat input
  - `sessions.message` / API path
- Present output as a **single combined** code block (in the final result; streaming shows incremental output).
- Include the executed command in the bubble (for example `$ git status`).
- If `core.workingDir` is missing, **fall back to the server process cwd**.
- Non-zero exit codes should render as an **error-style** terminal bubble.
- Use the existing tool execution pipeline (streaming, broadcast, persistence) rather than `custom_message`.
- Suppress bang-command tool events from LLM replay by filtering on a reserved tool name prefix `_assistant_`.
- Tool events persist in both EventStore and Pi canonical transcript for full replay support.

## Current findings
- Direct user text entry reaches the server in two main paths:
  - websocket chat input: `packages/agent-server/src/ws/chatRunLifecycle.ts` (`handleTextInputWithChatCompletions`)
  - session operations API: `packages/agent-server/src/sessionMessages.ts` (`startSessionMessage`)
- LLM-visible history is built from `user_message`, `assistant_done`, `tool_call`, `tool_result`, etc. in:
  - `packages/agent-server/src/sessionChatMessages.ts`
  - `packages/agent-server/src/projections/toOpenAIMessages.ts`
- Existing precedent for LLM replay exclusion: `phase: 'commentary'` on `assistant_done` events is filtered by `isReplayableAssistantText()` in `toOpenAIMessages.ts`
- Tool execution pipeline already supports:
  - `tool_call_start` ServerMessage → immediate UI feedback (spinner/pending)
  - `tool_output_chunk` → transient streaming events (broadcast only, not persisted)
  - `tool_result` → final result (persisted + broadcast)
- Chat replay/rendering already supports dedicated special bubbles for tool-like UI patterns:
  - `voice_speak` / `voice_ask` — detected by tool name, custom bubble with icon
  - `attachment_send` — same pattern
  - renderer: `packages/web-client/src/controllers/chatRenderer.ts`
- The web client already has a terminal icon in `packages/web-client/src/utils/icons.ts`.
- Pi replay:
  - Tool events persist through `piSessionWriter.appendAssistantEvent()` and replay via `historyProvider.ts`
  - LLM suppression happens downstream in `sessionChatMessages.ts` / `toOpenAIMessages.ts`, so persistence and replay are unaffected

## Recommended architecture

### 1) Intercept bang commands before LLM execution
Add a shared helper in `agent-server` that:
- detects direct user input beginning with `!`
- extracts command text with this rule:
  - first character must be `!`
  - ignore spaces immediately after `!`
  - remainder must be non-empty
- explicitly applies only to direct user entry points, not internal callback/agent-message flows
- defines edge-case handling for:
  - `!` → reject / no-op with visible error bubble
  - `!   ` → reject / no-op with visible error bubble
  - `!!` → escape: send `!` + rest as a normal chat message to the LLM (e.g., `!!hello` → sends `!hello`)
  - multiline input → treat everything after the leading bang as the command string

Use that helper from:
- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/agent-server/src/sessionMessages.ts`

This keeps the command out of `processUserMessage()` entirely, so it never enters `state.chatMessages` and never reaches any provider.

### 2) Execute shell command via tool pipeline with streaming
Use a reserved tool name `_assistant_shell` (prefix `_assistant_` marks it as internal/non-LLM).

Execution flow:
1. **Emit `tool_call_start`** ServerMessage immediately → client shows spinner
2. **Spawn shell process** using `child_process.spawn()`:
   - shell wrapper: `/bin/sh -c` (non-login shell for speed; no `-l` flag)
   - cwd resolution:
     - `state.summary.attributes?.core?.workingDir` when present
     - otherwise `process.cwd()`
   - capture combined stdout/stderr
3. **Stream output** via `tool_output_chunk` transient events → client sees live output
4. **Emit `tool_call` ChatEvent** (persisted) with tool name `_assistant_shell` and args `{ command, cwd }`
5. **Emit `tool_result` ChatEvent** (persisted) with combined output, exit code, truncation/timeout metadata

Required runtime protections:
- configurable execution timeout with kill-on-timeout behavior
- output size limits enforced **during streaming** (not just on the final result) — stop reading from the process and kill it once the limit is hit, to prevent client memory exhaustion from unbounded `tool_output_chunk` events
- truncation note appended to output when limit is reached
- cleanup on abort/disconnect where practical
- clear failure path for spawn/timeout/kill errors

Why dedicated helper instead of reusing coding tool internals:
- avoids coupling this feature to coding plugin/tool availability
- avoids tool-call semantics for a user-side control path
- gives direct control over timeout/truncation/combined-output behavior

### 3) Suppress from LLM replay by tool name prefix
In both LLM history assembly paths, filter out tool events with tool names starting with `_assistant_`:

**`packages/agent-server/src/sessionChatMessages.ts`** — in `buildChatMessagesFromEvents()`:
- `tool_call` case: if `payload.toolName.startsWith('_assistant_')`, add `toolCallId` to a `suppressedToolCallIds` Set and skip
- `tool_result` case: if `payload.toolCallId` is in `suppressedToolCallIds`, skip (do **not** rely on `toolName` here since `ToolResultPayloadSchema` has `toolName` as optional — an orphaned `role: 'tool'` message without a matching call would crash the LLM completion request)

**`packages/agent-server/src/projections/toOpenAIMessages.ts`** — in `toOpenAIMessages()`:
- Same `suppressedToolCallIds` Set pattern

This follows the precedent set by `isReplayableAssistantText()` filtering `phase: 'commentary'` events, and mirrors the existing `interruptedResponseIds` filtering pattern already used in `buildChatMessagesFromEvents()`.

The `_assistant_` prefix is intentionally generic — future internal tool-like events (e.g., system diagnostics, session management actions) can reuse the same suppression mechanism without additional filtering logic.

### 4) Persist to transcript for replay
No special handling needed — tool events already flow through:
- **EventStore**: `eventStore.append()` in `appendAndBroadcastChatEvents()`
- **Pi canonical transcript**: `piSessionWriter.appendAssistantEvent()` with custom type `assistant.tool_call` / `assistant.tool_result`

Both paths persist `_assistant_shell` events identically to any other tool event. The suppression filter only applies in `sessionChatMessages.ts` / `toOpenAIMessages.ts` when building LLM prompt messages.

On session reload, `historyProvider.ts` projects these events into `ProjectedTranscriptEvent` objects with `chatEventType: 'tool_call'` / `'tool_result'`, which the renderer picks up normally.

### 5) Render as dedicated terminal bubble
In `packages/web-client/src/controllers/chatRenderer.ts`:
- detect `_assistant_shell` tool name (same pattern as `VOICE_TOOL_NAMES` / `ATTACHMENT_TOOL_NAME`)
- exclude `_assistant_shell` from `isGroupableToolCall()` to prevent duplicate rendering as both a grouped tool call and a terminal bubble
- render a dedicated bubble:
  - terminal icon from `packages/web-client/src/utils/icons.ts`
  - heading text: `Terminal`
  - body: markdown content containing fenced code block with command and output
  - error styling when exit code is non-zero or execution timed out
- for streaming: handle `tool_output_chunk` events for `_assistant_shell` with incremental text append (same as existing tool output streaming, just with terminal styling)

### 6) Replay strategy
Tool events for `_assistant_shell` persist and replay through both storage backends:
- **EventStore-backed sessions**: standard `tool_call` + `tool_result` events
- **Pi canonical replay path**: persisted via `appendAssistantEvent()`, projected via `historyProvider.ts`

The LLM suppression is purely at the message-assembly layer, so replay rendering is unaffected.

No special `historyProvider.ts` changes needed unless tests reveal a gap.

## Review feedback incorporated
Main changes from review rounds:
- **Switched from `custom_message` to tool pipeline** — gets streaming, spinner, multi-user broadcast for free
- **LLM suppression via `_assistant_` tool name prefix** — minimal code change, follows existing `commentary` phase pattern
- **Non-login shell** (`/bin/sh -c` not `/bin/sh -lc`) — avoids profile loading latency and side effects
- **Timeout / abort / cleanup** handling as required runtime protections
- **Output truncation** as a required part of the design
- **Scoped interception** — only direct user entry points, not internal callback/agent-message flows
- **Pi replay validated by design** — tool events persist normally; suppression is downstream

Gemini review findings incorporated:
- **`toolCallId` Set for suppression** — `tool_result` events filtered by `toolCallId` membership instead of `toolName` (which is optional on `ToolResultPayload` and could produce orphaned `role: 'tool'` messages that crash LLM completions)
- **`!!` escape mechanism** — `!!` now sends the remainder as a normal chat message prefixed with `!`, so users can still type literal `!`-prefixed text to the LLM
- **Exclude from `isGroupableToolCall()`** — prevents `_assistant_shell` from rendering as both a grouped tool call and a terminal bubble
- **Streaming-phase truncation** — output size limit enforced during `tool_output_chunk` streaming, not just on the final result, to prevent client memory exhaustion

## Files likely to change
- `packages/agent-server/src/ws/chatRunLifecycle.ts` — bang command interception
- `packages/agent-server/src/sessionMessages.ts` — bang command interception (API path)
- `packages/agent-server/src/sessionChatMessages.ts` — `_assistant_` prefix suppression filter
- `packages/agent-server/src/projections/toOpenAIMessages.ts` — `_assistant_` prefix suppression filter
- `packages/shared/src/chatEvents.ts` — no schema changes needed (tool name is already a string field)
- `packages/web-client/src/controllers/chatRenderer.ts` — terminal bubble rendering
- new helper files:
  - `packages/agent-server/src/shell/executeSessionShellCommand.ts` — shell spawn, timeout, truncation
  - `packages/agent-server/src/sessionBangCommands.ts` — bang detection, command extraction, tool event emission
- tests:
  - `packages/agent-server/src/__tests__/sessionBangCommands.test.ts`
  - `packages/agent-server/src/__tests__/shellExecution.test.ts`
  - `packages/agent-server/src/__tests__/sessionChatMessages.test.ts` (suppression filter)
  - `packages/web-client/src/controllers/chatRenderer.test.ts` (terminal bubble)

## Acceptance criteria
- Sending `!pwd` through websocket chat input runs a shell command server-side with live streaming output
- Sending `!pwd` through `sessions.message` / API also runs the shell command server-side
- Client sees a spinner/pending state immediately when a bang command is submitted
- Output streams to the client in real-time as the command produces it
- Other users watching the same session via websocket see the same streaming output
- Internal callback / agent-message flows are **not** intercepted
- Command execution uses `core.workingDir` when present and falls back to server cwd when absent
- The original `!command` does not enter LLM-visible conversation history and does not render as a normal user bubble
- `_assistant_shell` tool events are persisted to both EventStore and Pi canonical transcript
- `_assistant_shell` tool events are excluded from `buildChatMessagesFromEvents()` and `toOpenAIMessages()` output
- The result renders as a dedicated terminal bubble with terminal icon + `Terminal` heading
- Bubble body shows the command and combined output in markdown code block format
- Non-zero exit codes render as an error-style terminal bubble
- Execution timeout is enforced and timed-out commands render clearly
- Large output is truncated deterministically and truncation is indicated in the rendered bubble
- Session reload replays terminal bubbles correctly from both EventStore and Pi transcript
- Automated tests cover: bang detection/extraction, interception scope, shell execution (timeout, truncation, exit codes), LLM suppression filtering, persistence/replay, and UI rendering
