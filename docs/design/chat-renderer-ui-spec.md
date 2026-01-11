# ChatRenderer UI Specification

This document specifies the UI behaviors that ChatRenderer must implement to replace the old MessageRenderer.

## Table of Contents

- [Core Principles](#core-principles)
- [Source files](#source-files)
- [Message Types](#message-types)
- [Tool Blocks](#tool-blocks)
- [Agent Messages (agents_message)](#agent-messages-agents_message)
- [Thinking Blocks](#thinking-blocks)
- [Typing Indicator](#typing-indicator)
- [Interrupts](#interrupts)
- [Errors](#errors)
- [Event-to-DOM Mapping](#event-to-dom-mapping)
- [Data Attributes](#data-attributes)
- [Replay vs Real-time](#replay-vs-real-time)
- [Implementation Notes](#implementation-notes)

## Core Principles

1. **Event-driven** - DOM is a pure function of ChatEvent[]
2. **No optimistic UI** - User messages rendered from events, not on submit
3. **In-place updates** - Tool results and callbacks update existing blocks
4. **Streaming** - Show content as it arrives (text, tool args, tool output)

---

## Source files

- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/panels/chat/runtime.ts`

## Message Types

### User Message

Rendered from `user_message` event.

```html
<div class="message user" data-event-id="e1">
  <div class="message-avatar">U</div>
  <div class="message-content">User's message text</div>
</div>
```

- No optimistic rendering - wait for event from server
- Strip context lines if present (lines starting with `[Context:`)

### Assistant Message

Rendered from `assistant_chunk` / `assistant_done` events.

```html
<div class="message assistant" data-response-id="r1" data-event-id="e5">
  <!-- Markdown-rendered content -->
</div>
```

- Stream text as `assistant_chunk` events arrive
- Apply markdown formatting
- Finalize on `assistant_done`

### User Audio Message

Rendered from `user_audio` event.

```html
<div class="message user user-audio" data-event-id="e1">
  <div class="message-avatar">U</div>
  <div class="message-content">Transcribed text</div>
</div>
```

---

## Tool Blocks

Rendered from `tool_call` / `tool_result` events.

### Structure

```html
<div class="tool-output-block" data-tool-call-id="tc1" data-event-id="e2">
  <button class="tool-output-header" aria-expanded="false">
    <div class="tool-output-header-main">
      <span class="tool-output-toggle">▶</span>
      <span class="tool-output-name">tool_name</span>
      <span class="tool-output-summary">summary of args</span>
    </div>
    <span class="tool-output-status">Running...</span>
  </button>

  <div class="tool-output-body">
    <div class="tool-output-input">
      <!-- Tool arguments, collapsible -->
    </div>
    <div class="tool-output-result">
      <!-- Tool result, markdown/code formatted -->
    </div>
  </div>
</div>
```

### States

| State           | Status Text         | Styling                   |
| --------------- | ------------------- | ------------------------- |
| Streaming input | "Preparing..."      | Args streaming in         |
| Running         | "Running..."        | Waiting for result        |
| Success         | (none or checkmark) | Normal styling            |
| Error           | "Error"             | Red accent, error message |
| Interrupted     | "Interrupted"       | Yellow/warning accent     |

### Behavior

1. **On `tool_call` event**: Create block, stream args as they arrive
2. **Args complete**: Show "Running..." status
3. **On `tool_result` event**: Update block with result, clear status
4. **Expand/collapse**: Click header to toggle body visibility
5. **Default**: Collapsed (user preference can override)

### Multiple Tool Calls

Each tool call is a separate block. They appear in order received.

```html
<div class="tool-output-block" data-tool-call-id="tc1">...</div>
<div class="tool-output-block" data-tool-call-id="tc2">...</div>
<div class="tool-output-block" data-tool-call-id="tc3">...</div>
```

---

## Agent Messages (agents_message)

Rendered from `agent_message` / `agent_callback` events.

### Sync Mode (wait: true)

Agent A calls agent B and waits. Agent B's entire processing is nested inside the tool block.

```html
<div class="tool-output-block agent-exchange" data-message-id="am1" data-event-id="e2">
  <button class="tool-output-header">
    <span class="tool-output-toggle">▶</span>
    <span class="tool-output-name">code-agent</span>
    <span class="tool-output-status">Processing...</span>
  </button>

  <div class="tool-output-body">
    <div class="tool-output-input">Message sent to agent</div>

    <!-- Nested: Agent B's work -->
    <div class="agent-processing">
      <div class="tool-output-block" data-tool-call-id="tc-nested-1">
        <!-- Agent B's tool call -->
      </div>
      <div class="tool-output-block" data-tool-call-id="tc-nested-2">
        <!-- Agent B's another tool call -->
      </div>
      <div class="agent-response">Agent B's text response</div>
    </div>

    <div class="tool-output-result">Final result returned to agent A</div>
  </div>
</div>
```

### Async Mode (wait: false)

Agent A calls agent B and continues. Callback updates the block in-place later.

**Initial state (waiting):**

```html
<div class="tool-output-block agent-exchange pending" data-message-id="am1">
  <button class="tool-output-header">
    <span class="tool-output-name">code-agent</span>
    <span class="tool-output-status">Waiting for response...</span>
  </button>
  <div class="tool-output-body">
    <div class="tool-output-input">Message sent to agent</div>
    <div class="tool-output-result"></div>
  </div>
</div>
```

**After callback arrives:**

```html
<div class="tool-output-block agent-exchange resolved" data-message-id="am1">
  <button class="tool-output-header">
    <span class="tool-output-name">code-agent</span>
    <!-- status cleared -->
  </button>
  <div class="tool-output-body">
    <div class="tool-output-input">Message sent to agent</div>

    <!-- Nested: Agent B's work (if visible) -->
    <div class="agent-processing">...</div>

    <div class="tool-output-result">Result from agent B</div>
  </div>
</div>
```

**Key behavior:**

- Block is created when `agent_message` event arrives
- Block shows "Waiting for response..." status
- When `agent_callback` event arrives, find block by `messageId` and update in-place
- Block may be further up in chat - do NOT scroll to it
- After callback, agent A processes and its response appears at bottom of chat

---

## Thinking Blocks

Rendered from `thinking_chunk` / `thinking_done` events.

```html
<div class="thinking-block" data-response-id="r1">
  <button class="thinking-header">
    <span class="thinking-toggle">▶</span>
    <span>Thinking</span>
  </button>
  <div class="thinking-content">Thinking text streams here...</div>
</div>
```

- Collapsible, default based on user preference
- Stream text as `thinking_chunk` events arrive
- Finalize on `thinking_done`

---

## Typing Indicator

Per-session indicator shown at bottom of chat.

### When to Show

| Event             | Action       |
| ----------------- | ------------ |
| `assistant_chunk` | Show         |
| `thinking_chunk`  | Show         |
| `tool_call`       | Show         |
| Tool executing    | Keep showing |
| `assistant_done`  | Hide         |
| `turn_end`        | Hide         |
| `interrupt`       | Hide         |
| `error`           | Hide         |

### Behavior

- Always at bottom of chat (after all messages)
- One indicator per session
- Show during tool execution (indicates agent is working)
- Animate (e.g., pulsing dots)

---

## Interrupts

Rendered from `interrupt` event.

### Behavior

1. **Capture partial content** - Whatever text/tool output was generated, keep it
2. **Mark as interrupted** - Add visual indicator
3. **Hide typing indicator**

### For Tool Calls

```html
<div class="tool-output-block interrupted" data-tool-call-id="tc1">
  <button class="tool-output-header">
    <span class="tool-output-name">long_running_tool</span>
    <span class="tool-output-status">Interrupted</span>
  </button>
  <div class="tool-output-body">
    <div class="tool-output-input">...</div>
    <div class="tool-output-result">Partial output if any...</div>
  </div>
</div>
```

### For Assistant Response

```html
<div class="message assistant interrupted" data-response-id="r1">
  Partial response text...
  <span class="interrupted-indicator">⚠️ Interrupted</span>
</div>
```

---

## Errors

Rendered from `error` event.

```html
<div class="message error" data-event-id="e10">
  <div class="error-message">Error message here</div>
</div>
```

---

## Event-to-DOM Mapping

| Event Type        | Action                                                 |
| ----------------- | ------------------------------------------------------ |
| `turn_start`      | Create turn container (optional grouping)              |
| `turn_end`        | Finalize turn, hide typing                             |
| `user_message`    | Append user bubble                                     |
| `user_audio`      | Append user bubble with audio class                    |
| `assistant_chunk` | Append/update assistant bubble, show typing            |
| `assistant_done`  | Finalize assistant bubble, hide typing                 |
| `thinking_chunk`  | Append/update thinking block                           |
| `thinking_done`   | Finalize thinking block                                |
| `tool_call`       | Create tool block, stream args                         |
| `tool_result`     | Update tool block with result                          |
| `agent_message`   | Create agent exchange block                            |
| `agent_callback`  | Update agent exchange block by messageId               |
| `interrupt`       | Mark current response/tool as interrupted, hide typing |
| `error`           | Append error message, hide typing                      |

---

## Data Attributes

All rendered elements should have data attributes for lookup:

| Attribute           | Purpose                              |
| ------------------- | ------------------------------------ |
| `data-event-id`     | Links to source ChatEvent            |
| `data-turn-id`      | Groups events in a turn              |
| `data-response-id`  | Groups streaming chunks              |
| `data-tool-call-id` | Links tool_call → tool_result        |
| `data-message-id`   | Links agent_message → agent_callback |

---

## Replay vs Real-time

### Replay (page load)

```typescript
const { result } = await fetch(`/api/plugins/sessions/operations/events`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId: id }),
}).then((r) => r.json());
const events = result?.events ?? [];
chatRenderer.replayEvents(events);
```

- Render all events in order
- No typing indicator (already complete)
- All blocks show final state

### Real-time (WebSocket)

```typescript
socket.on('chat_event', (msg) => {
  chatRenderer.handleNewEvent(msg.event);
});
```

- Append/update DOM incrementally
- Show typing indicator during processing
- Streaming updates

### Same renderEvent() function

Both paths use the same `renderEvent(event)` function. The only difference:

- Replay: calls it in a loop, no typing indicator
- Real-time: calls it on each WebSocket message, manages typing indicator

---

## Implementation Notes

### Reuse Existing Utilities

- `toolOutputRenderer.ts` - Use for tool block structure
- `chatMessageRenderer.ts` - Use `appendMessage()` for bubbles
- `markdown.ts` - Use for assistant text formatting

### Remove from Old System

After ChatRenderer is working:

- `MessageRenderer` class
- `TranscriptReplayController` class
- Optimistic UI in `TextInputController`
- Legacy `/sessions/:id/messages` endpoint (removed; use `/api/plugins/sessions/operations/message`)

---

Session: c6a713d8-c5df-4d76-b04c-8edee2d84c30 (pi)
