# Chat Message & Tool Call Handling

This document describes the architecture for chat messages, tool calls, cancellation, and agent-to-agent messaging across the frontend and backend.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Backend Architecture](#backend-architecture)
- [WebSocket Message Types](#websocket-message-types)
- [Frontend Architecture](#frontend-architecture)
- [Agent-to-Agent Messaging](#agent-to-agent-messaging)
- [Current Issues & Refactoring Opportunities](#current-issues--refactoring-opportunities)
- [Real-Time UI vs Transcript Reconstruction](#real-time-ui-vs-transcript-reconstruction)
- [Testing Checklist](#testing-checklist)
- [Current Architecture (Post-Refactor)](#current-architecture-post-refactor)

## Overview

The system supports multiple chat backends:

- **Built-in agents**: OpenAI-compatible API (GPT-4, etc.)
- **Claude CLI**: Anthropic's Claude via CLI subprocess
- **Codex CLI**: OpenAI Codex via CLI subprocess
- **Pi CLI**: Pi coding agent via CLI subprocess

Each backend has different streaming behaviors, tool call formats, and lifecycle management, but they share common WebSocket message types and UI handling.

## Source files

- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/agent-server/src/ws/toolCallHandling.ts`
- `packages/agent-server/src/ws/chatOutputCancelHandling.ts`
- `packages/web-client/src/controllers/serverMessageHandler.ts`

---

## Backend Architecture

### Entry Point: `chatRunLifecycle.ts`

The main orchestrator that:

1. Creates `activeChatRun` state with `responseId`, `abortController`, `accumulatedText`, `textStartedAt`
2. Routes to appropriate handler based on agent type
3. Manages common post-processing (TTS, logging, chatMessages array)

```typescript
interface ActiveChatRun {
  responseId: string;
  abortController: AbortController;
  accumulatedText: string; // Text accumulated during streaming
  textStartedAt?: string; // Timestamp of first text delta (for ordering)
  activeToolCalls?: Map<string, { callId; toolName; argsJson }>;
  ttsSession?: TtsStreamingSession;
  agentExchangeId?: string; // For agent-to-agent exchanges
  audioTruncatedAtMs?: number;
  outputCancelled?: boolean;
}
```

### Agent-Specific Handlers

| Handler  | File                           | Streaming Model                             |
| -------- | ------------------------------ | ------------------------------------------- |
| Built-in | `chatRunLifecycle.ts` (inline) | OpenAI streaming chunks                     |
| Claude   | `claudeCliChat.ts`             | `text_delta` events, `tool_use` blocks      |
| Codex    | `codexCliChat.ts`              | `item.completed` with full text (no deltas) |
| Pi       | `piCliChat.ts`                 | `text_delta` events, `tool_use` blocks      |

#### Common Callbacks

Each CLI handler accepts:

```typescript
{
  onTextDelta: (delta: string, fullTextSoFar: string) => void;
  onThinkingStart?: () => void;
  onThinkingDelta?: (delta: string) => void;
  onThinkingDone?: (fullText: string) => void;
  onToolCall?: (call: ToolCallInfo) => Promise<ToolResultInfo>;
  abortSignal: AbortSignal;
}
```

### Tool Call Handling: `toolCallHandling.ts`

Shared logic for all agent types:

1. Receives tool calls from streaming response
2. Broadcasts `tool_call_start` to clients
3. Executes tool via `executeToolCall()`
4. Streams `tool_output_delta` for incremental output
5. Broadcasts `tool_result` with final result/error
6. Tracks active calls in `run.activeToolCalls` for interrupt handling

### Cancellation: `chatOutputCancelHandling.ts`

When user presses Escape:

1. Sets `run.outputCancelled = true`
2. Aborts the `abortController`
3. Logs partial `accumulatedText` as interrupted assistant message (using `textStartedAt` for proper ordering)
4. For each active tool call:
   - Logs `tool_interrupted` error
   - Adds tool result to `chatMessages` (prevents OpenAI API errors)
   - Broadcasts `tool_result` with error
5. Broadcasts `output_cancelled`

---

## WebSocket Message Types

### Server → Client

| Message Type        | Description                                |
| ------------------- | ------------------------------------------ |
| `text_delta`        | Incremental text chunk                     |
| `text_done`         | Final complete text                        |
| `thinking_start`    | Extended thinking began                    |
| `thinking_delta`    | Thinking text chunk                        |
| `thinking_done`     | Thinking complete with full text           |
| `tool_call_start`   | Tool execution starting                    |
| `tool_output_delta` | Incremental tool output                    |
| `tool_result`       | Tool completed (success/error/interrupted) |
| `output_cancelled`  | Response was cancelled by user             |

### Tool Result States

```typescript
interface ServerToolResultMessage {
  type: 'tool_result';
  callId: string;
  toolName: string;
  ok: boolean;
  result?: string; // Present on success
  error?: {
    // Present on failure
    code: string; // 'tool_error', 'tool_interrupted', 'rate_limit_tools'
    message: string;
  };
}
```

---

## Frontend Architecture

### Entry Point: `serverMessageHandler.ts`

Central handler for all WebSocket messages. Maintains state:

- `responseElements`: Map of responseId → bubble element
- `responseTexts`: Map of responseId → accumulated text
- `toolOutputElements`: Map of callId → tool block element
- `thinkingElements`: Map of responseId → thinking element
- `pendingAssistantBubble`: Current incomplete bubble

### Message Flow

```
text_delta → Create/update bubble, append text, show typing indicator
           → Keep typing indicator visible throughout

thinking_start → Create thinking element in bubble
thinking_delta → Update thinking element text
thinking_done → Finalize thinking text

tool_call_start → Create tool block, append to bubble
                → Move typing indicator to end of bubble
tool_output_delta → Append to tool block output
tool_result → Update tool block state (success/error/interrupted)
            → Apply styling based on state

text_done → Finalize bubble, remove typing indicator
          → Clear pending state

output_cancelled → Remove typing indicators
                 → Preserve bubbles with content (tool blocks, text)
                 → Show "Interrupted" indicator
```

### Tool Block States & Styling

| State          | Class             | Visual                                       |
| -------------- | ----------------- | -------------------------------------------- |
| Pending        | `.pending`        | Grey, pulsing border                         |
| Success        | `.success`        | Green checkmark                              |
| Error          | `.error`          | Red exclamation                              |
| Interrupted    | `.interrupted`    | Yellow/amber, dashed border, "⚠ Interrupted" |
| Truncated      | `.truncated`      | Warning icon                                 |
| Agent Callback | `.agent-callback` | Gold accent color                            |

---

## Agent-to-Agent Messaging

### Flow

1. **Sender agent** calls `agents_message` tool
2. Tool creates/finds target session, queues message if busy
3. Target agent processes message, generates response
4. Response triggers callback to sender via `agentExchangeId`

### Key Components

- `builtInTools.ts`: `agents_message` implementation
- `agentExchangeId`: Correlates request/response in UI
- Queued messages: Stored until target agent is available

### UI Representation

Agent exchanges appear as expandable blocks showing:

- Input message from calling agent
- Tool calls made during processing
- Final response text

---

## Current Issues & Refactoring Opportunities

### Code Duplication

The CLI handlers (`claudeCliChat.ts`, `codexCliChat.ts`, `piCliChat.ts`) share significant logic:

- Process spawning and stdio handling
- Abort signal handling
- Tool call tracking for interrupts
- Text accumulation

**Opportunity**: Extract common `CliAgentRunner` class:

```typescript
abstract class CliAgentRunner {
  protected spawn(): ChildProcess;
  protected handleAbort(): void;
  protected trackToolCall(call): void;
  protected handleInterrupt(): void;
  abstract parseOutput(line: string): ParsedEvent;
}
```

### Inconsistent Tool Result Handling

Different paths for tool results:

- Built-in: Direct in `chatRunLifecycle.ts`
- CLI agents: Via `onToolCall` callback in CLI handlers
- Interrupted: Via `chatOutputCancelHandling.ts`

**Opportunity**: Unify through `toolCallHandling.ts`:

- All tool results flow through single path
- Consistent error extraction and formatting
- Single place for logging and broadcasting

### State Management

`activeChatRun` has grown organically. Consider:

```typescript
interface ChatRunState {
  core: { responseId; abortController };
  text: { accumulated; startedAt; segments };
  tools: { active: Map; completed: Set };
  tts?: TtsState;
  agentExchange?: AgentExchangeState;
}
```

### Frontend Simplification

`serverMessageHandler.ts` is large (~1600 lines). Consider splitting:

- `TextStreamHandler`: text_delta, text_done
- `ThinkingHandler`: thinking\_\* messages
- `ToolCallHandler`: tool\_\* messages
- `CancellationHandler`: output_cancelled

---

## Real-Time UI vs Transcript Reconstruction

The frontend has two distinct rendering paths that must produce identical results:

### Real-Time Rendering (WebSocket)

Handled by `serverMessageHandler.ts`. Builds UI incrementally as messages arrive:

```
User sends message
  → Create pending assistant bubble with typing indicator

text_delta arrives
  → Append text to bubble, track in responseTexts map
  → textStartedAt captured on backend for ordering

thinking_start/delta/done
  → Create/update thinking element in bubble
  → Typing indicator preserved throughout

tool_call_start
  → Create pending tool block, append to bubble
  → Move typing indicator to end
  → Track in toolOutputElements map

tool_output_delta
  → Append to tool block output area

tool_result
  → Update tool block state (success/error/interrupted)
  → Apply appropriate styling class

text_done
  → Finalize bubble, remove typing indicator
  → Apply markdown rendering

output_cancelled
  → Remove typing indicators
  → Preserve content (tool blocks, partial text)
  → Show "Interrupted" indicator
```

### Transcript Reconstruction (Page Load/Session Switch)

Handled by `chatRenderer.ts` → `replayEvents()` using the unified event log.

**Reconstruction flow:**

1. Fetch `/api/plugins/sessions/operations/events`
2. Clear chat log
3. Replay `ChatEvent[]` in order through the same renderer used for live events
4. Render the empty-session hint when no events exist

### Current Gaps (Real-Time vs Reconstruction)

| Feature             | Real-Time                       | Reconstruction              | Gap                           |
| ------------------- | ------------------------------- | --------------------------- | ----------------------------- |
| Interrupted text    | Shows "Interrupted" indicator   | ❌ No indicator             | Need to persist/render        |
| Interrupted tools   | Yellow styling, "⚠ Interrupted" | ✅ Works (error.code check) | OK                            |
| Tool block ordering | Correct (streaming order)       | Depends on timestamps       | Timestamp collisions possible |
| Thinking blocks     | Full support                    | ✅ Works                    | OK                            |
| Agent exchanges     | Full support                    | ✅ Works                    | OK                            |

### Required: Persist Interrupted State

Cancellation now emits an `interrupt` chat event, but reconstruction still does not render an indicator.

**Backend** (`events/eventStore.ts`):

```typescript
const interruptEvent = {
  type: 'interrupt',
  payload: { reason: 'user_cancel' },
};
```

**Frontend fix needed** (`sessionDataController.ts`):

```typescript
case 'assistant_message': {
  // ... create bubble, attach tool blocks, render text ...

  // ADD: Show interrupted indicator if flagged
  if (record.interrupted) {
    this.options.appendInterruptedIndicator(bubble);
  }
  break;
}
```

### Ordering Guarantees

**Backend**: Records sorted by `timestamp` in `getSessionTranscript()`:

```typescript
sorted.sort((a, b) => {
  const aTime = new Date(a.timestamp).getTime();
  const bTime = new Date(b.timestamp).getTime();
  if (aTime === bTime) return 0; // Unstable for equal timestamps!
  return aTime - bTime;
});
```

**Issue**: When cancelled, text and tool_call may have same-millisecond timestamps, causing unstable ordering.

**Fix applied**: `textStartedAt` captures timestamp when text streaming begins, used for interrupted assistant_message logging to ensure text comes before tool_calls.

### Refactoring Opportunity: Unified Renderer

Both paths could share rendering logic:

```typescript
interface RenderableMessage {
  type: 'user' | 'assistant' | 'agent_exchange';
  text: string;
  thinking?: string;
  toolCalls?: ToolCallRender[];
  interrupted?: boolean;
  agentLabel?: string;
}

class MessageRenderer {
  render(msg: RenderableMessage): HTMLElement;
  renderToolBlock(call: ToolCallRender): HTMLElement;
  applyInterruptedState(el: HTMLElement): void;
}
```

This would:

- Ensure visual consistency between real-time and reconstruction
- Single place to update styling/structure
- Easier testing of rendering logic

---

## Testing Checklist

When modifying chat/tool handling, verify:

### Real-Time Behavior

1. **Normal flow**: Message → tool calls → response
2. **Cancel during text**: Partial text preserved, "Interrupted" shown
3. **Cancel during tool**: Tool block shows interrupted state (yellow), no backend errors
4. **Typing indicator**: Visible throughout thinking/tool phases, removed on text_done/cancel
5. **Agent-to-agent**: Messages queued, callbacks work
6. **All agent types**: Built-in, Claude, Codex, Pi behave consistently

### Reconstruction (Reload) Behavior

7. **Reload after cancel**: Correct ordering (text before tools)
8. **Interrupted text**: "Interrupted" indicator shown after reload
9. **Interrupted tools**: Yellow styling preserved after reload
10. **Tool block attachment**: Tools appear inside correct assistant bubble
11. **Agent exchanges**: Properly reconstructed with nested tool blocks

---

## Current Architecture (Post-Refactor)

### Unified Rendering via MessageRenderer

The `MessageRenderer` class (`packages/web-client/src/controllers/messageRenderer.ts`) provides a single rendering implementation used by both paths:

```typescript
class MessageRenderer {
  // Handle a single event (real-time streaming)
  handleEvent(event: RenderableEvent): void;
}
```

**Real-time path**: `serverMessageHandler.ts` creates a `MessageRenderer` instance and calls `handleEvent()` for each WebSocket message.

**Reconstruction path**: `sessionDataController.ts` creates a `MessageRenderer` instance and iterates through sorted transcript records, calling `handleEvent()` for each.

### Event Types

Both paths now use the same event types:

```typescript
type RenderableEvent =
  | { type: 'text_delta'; responseId: string; delta: string; ... }
  | { type: 'text_done'; responseId: string; text: string; ... }
  | { type: 'thinking_start'; responseId: string; ... }
  | { type: 'thinking_delta'; responseId: string; delta: string; ... }
  | { type: 'thinking_done'; responseId: string; text: string; ... }
  | { type: 'tool_call_start'; callId: string; toolName: string; arguments: string; ... }
  | { type: 'tool_output_delta'; callId: string; toolName: string; delta: string; ... }
  | { type: 'tool_result'; callId: string; toolName: string; ok: boolean; ... }
  | { type: 'output_cancelled'; responseId?: string; ... }
  | { type: 'agent_callback_result'; responseId: string; result: string; ... };
```

### Backend Event Logging

The `eventStore` now logs granular events with accurate timestamps:

- `text_delta` / `text_done` - Text streaming
- `thinking_start` / `thinking_delta` / `thinking_done` - Extended thinking
- `tool_call_start` / `tool_output_delta` / `tool_result` - Tool execution
- `output_cancelled` - User cancellation

Event log reconstruction sorts by timestamp, then by file order for ties, ensuring deterministic ordering that matches real-time streaming.

### Key Benefits

1. **Identical DOM**: Real-time and reconstruction produce the same structure
2. **Chronological order**: Elements appear in streaming order
3. **Consistent interruption handling**: Tool blocks preserve interrupted state after reload
4. **Single source of truth**: The event log is authoritative; reconstruction replays it

### Known Limitations

- Agent-to-agent receiver-side blocks (`agent_message` records) still use legacy reconstruction path
- These will be migrated in a future update
