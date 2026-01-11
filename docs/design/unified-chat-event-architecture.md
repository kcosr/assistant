# Unified Chat Event Architecture

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Problem Statement](#problem-statement)
- [Design Goals](#design-goals)
- [Event Schema](#event-schema)
- [Architecture](#architecture)
- [Migration Strategy](#migration-strategy)
- [File Structure](#file-structure)
- [Benefits](#benefits)
- [Open Questions](#open-questions)

## Overview

This document describes a refactoring of the chat message handling to use a single, unified event log as the source of truth for all chat interactions. This replaces the current dual-path system where real-time WebSocket messages and stored transcript entries have different structures and rendering paths.

## Source files

Reference implementations and related code paths:

- `packages/agent-server/src/conversationStore.ts`
- `packages/agent-server/src/sessionMessages.ts`
- `packages/agent-server/src/ws/chatRunLifecycle.ts`
- `packages/web-client/src/controllers/chatRenderer.ts`

## Problem Statement

The current architecture has several issues:

1. **Dual rendering paths**: `MessageRenderer` handles real-time events, `TranscriptReplayController` handles replay - different code, different bugs
2. **Inconsistent event storage**: Some events are logged to transcript, some aren't, some with different shapes
3. **Race conditions**: Async callbacks can arrive at awkward times, causing typing indicators to persist or responses to be lost
4. **Provider coupling**: OpenAI message format is intertwined with storage and rendering
5. **Hard to debug**: No single place to see "what happened in this conversation"

## Design Goals

1. **Single source of truth**: One event log per session, append-only
2. **Identical rendering**: Same code for real-time and replay
3. **Provider agnostic**: Normalize all providers to same event format
4. **Complete history**: Every discrete action is an event
5. **Debuggable**: Event log is human-readable, self-describing

## Event Schema

### Base Event Structure

```typescript
interface ChatEvent {
  id: string; // Unique event ID (UUID)
  timestamp: number; // Unix epoch milliseconds
  sessionId: string; // Session this event belongs to
  type: ChatEventType; // Discriminator

  // Linking IDs (optional, based on type)
  turnId?: string; // Groups events in one turn (user input → final response)
  responseId?: string; // Groups chunks of one assistant response

  // Type-specific payload
  payload: ChatEventPayload;
}
```

### Event Types

| Type                | Description                   | Key Payload Fields                                                 |
| ------------------- | ----------------------------- | ------------------------------------------------------------------ |
| `turn_start`        | A new turn begins             | `trigger: 'user' \| 'callback' \| 'system'`                        |
| `turn_end`          | Turn complete                 | -                                                                  |
| `user_message`      | User sent text                | `text`                                                             |
| `user_audio`        | User sent audio               | `transcription`, `durationMs`                                      |
| `assistant_chunk`   | Streaming text delta          | `text`                                                             |
| `assistant_done`    | Final assistant text          | `text`                                                             |
| `thinking_chunk`    | Thinking/reasoning delta      | `text`                                                             |
| `thinking_done`     | Thinking complete             | `text`                                                             |
| `tool_call`         | Assistant invokes tool        | `toolCallId`, `toolName`, `args`                                   |
| `tool_input_chunk`  | Streaming tool input delta    | `toolCallId`, `toolName`, `chunk`, `offset`                        |
| `tool_output_chunk` | Streaming tool output delta   | `toolCallId`, `chunk`, `stream?`                                   |
| `tool_result`       | Tool returns result           | `toolCallId`, `result`, `error?`                                   |
| `agent_message`     | Cross-agent message sent      | `messageId`, `targetAgentId`, `targetSessionId`, `message`, `wait` |
| `agent_callback`    | Async callback received       | `messageId`, `fromAgentId`, `fromSessionId`, `result`              |
| `agent_switch`      | Switched to different agent   | `fromAgentId`, `toAgentId`                                         |
| `interrupt`         | User cancelled or timeout     | `reason: 'user_cancel' \| 'timeout' \| 'error'`                    |
| `error`             | Something failed              | `code`, `message`                                                  |
| `audio_chunk`       | TTS audio data                | `data` (base64), `seq`                                             |
| `audio_done`        | TTS complete                  | `durationMs`                                                       |

### Linking IDs

| ID           | Scope         | Purpose                                   |
| ------------ | ------------- | ----------------------------------------- |
| `id`         | Global        | Unique event identifier                   |
| `turnId`     | Session       | Groups user input → processing → response |
| `responseId` | Turn          | Groups streaming chunks of one response   |
| `toolCallId` | Turn          | Links `tool_call` → `tool_result`         |
| `messageId`  | Cross-session | Links `agent_message` → `agent_callback`  |

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Event Store                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  session-abc.events.jsonl                                │    │
│  │  {"id":"e1","type":"user_message","payload":{...}}       │    │
│  │  {"id":"e2","type":"assistant_chunk","payload":{...}}    │    │
│  │  ...                                                      │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
           │
           │ append() / getEvents()
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Chat Processor                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   OpenAI     │  │  Claude CLI  │  │  Codex CLI   │          │
│  │  Normalizer  │  │  Normalizer  │  │  Normalizer  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                    │
│         └────────────────┴─────────────────┘                    │
│                           │                                      │
│                           ▼                                      │
│                    ChatEvent[]                                   │
│                           │                                      │
│         ┌─────────────────┼─────────────────┐                   │
│         ▼                 ▼                 ▼                   │
│   eventStore.append()  broadcast()   toOpenAIMessages()         │
└─────────────────────────────────────────────────────────────────┘
           │                 │
           │                 │ WebSocket
           ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Web Client                                │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    ChatRenderer                          │    │
│  │  renderEvent(event: ChatEvent) → DOM update              │    │
│  │  replayEvents(events: ChatEvent[]) → full DOM            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                           │                                      │
│                           ▼                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  <div class="turn" data-turn-id="t1">                    │    │
│  │    <div class="user-message" data-event-id="e1">...</div>│    │
│  │    <div class="assistant" data-response-id="r1">         │    │
│  │      <div class="tool-call" data-tool-call-id="tc1">     │    │
│  │      <div class="text" data-event-id="e5">...</div>      │    │
│  │    </div>                                                 │    │
│  │  </div>                                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Provider Normalizers

Each provider has a normalizer that converts provider-specific output to `ChatEvent[]`:

```typescript
interface ProviderNormalizer {
  normalize(chunk: unknown, context: NormalizerContext): ChatEvent[];
}

interface NormalizerContext {
  sessionId: string;
  turnId: string;
  responseId: string;
  generateEventId: () => string;
  timestamp: () => number;
}

// Example: OpenAI normalizer
class OpenAINormalizer implements ProviderNormalizer {
  normalize(chunk: OpenAI.ChatCompletionChunk, ctx: NormalizerContext): ChatEvent[] {
    const events: ChatEvent[] = [];

    for (const choice of chunk.choices) {
      if (choice.delta.content) {
        events.push({
          id: ctx.generateEventId(),
          timestamp: ctx.timestamp(),
          sessionId: ctx.sessionId,
          type: 'assistant_chunk',
          turnId: ctx.turnId,
          responseId: ctx.responseId,
          payload: { text: choice.delta.content },
        });
      }

      if (choice.delta.tool_calls) {
        // Handle tool calls...
      }
    }

    return events;
  }
}
```

### Event Store

```typescript
interface EventStore {
  // Append event (real-time)
  append(sessionId: string, event: ChatEvent): Promise<void>;

  // Batch append (for tool results, etc.)
  appendBatch(sessionId: string, events: ChatEvent[]): Promise<void>;

  // Load all events for a session
  getEvents(sessionId: string): Promise<ChatEvent[]>;

  // Load events after a cursor (pagination for long sessions)
  getEventsSince(sessionId: string, afterEventId: string): Promise<ChatEvent[]>;

  // Subscribe to new events (for WebSocket broadcast)
  subscribe(sessionId: string, callback: (event: ChatEvent) => void): () => void;
}
```

Storage format is JSONL (one event per line):

```
{"id":"e1","timestamp":1703001234567,"sessionId":"s1","type":"user_message","turnId":"t1","payload":{"text":"Hello"}}
{"id":"e2","timestamp":1703001234600,"sessionId":"s1","type":"assistant_chunk","turnId":"t1","responseId":"r1","payload":{"text":"Hi"}}
{"id":"e3","timestamp":1703001234650,"sessionId":"s1","type":"assistant_chunk","turnId":"t1","responseId":"r1","payload":{"text":" there!"}}
{"id":"e4","timestamp":1703001234700,"sessionId":"s1","type":"assistant_done","turnId":"t1","responseId":"r1","payload":{"text":"Hi there!"}}
{"id":"e5","timestamp":1703001234750,"sessionId":"s1","type":"turn_end","turnId":"t1","payload":{}}
```

### Projections

The event log is projected to different formats as needed:

```typescript
// For OpenAI API context
function toOpenAIMessages(events: ChatEvent[]): OpenAI.ChatCompletionMessage[] {
  const messages: OpenAI.ChatCompletionMessage[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'user_message':
        messages.push({ role: 'user', content: event.payload.text });
        break;
      case 'assistant_done':
        messages.push({ role: 'assistant', content: event.payload.text });
        break;
      case 'tool_call':
        // Append to last assistant message
        break;
      case 'tool_result':
        messages.push({ role: 'tool', tool_call_id: event.payload.toolCallId, content: event.payload.result });
        break;
      case 'agent_callback':
        // Inject as context
        messages.push({ role: 'user', content: `[Callback from ${event.payload.fromAgentId}]: ${event.payload.result}` });
        break;
      // Skip: assistant_chunk, thinking_*, audio_*, turn_*, etc.
    }
  }

  return messages;
}

// For Claude CLI prompt
function toClaudeCLIPrompt(events: ChatEvent[]): string { ... }

// For session summary (sidebar)
function toSessionSummary(events: ChatEvent[]): SessionSummary { ... }
```

### Client Renderer

Single renderer handles both real-time and replay:

```typescript
class ChatRenderer {
  private container: HTMLElement;
  private turnElements: Map<string, HTMLElement> = new Map();
  private responseElements: Map<string, HTMLElement> = new Map();

  // Used for both real-time and replay
  renderEvent(event: ChatEvent): void {
    switch (event.type) {
      case 'turn_start':
        this.createTurnContainer(event.turnId);
        break;

      case 'user_message':
        this.appendUserBubble(event);
        break;

      case 'assistant_chunk':
        this.appendOrUpdateAssistantText(event);
        break;

      case 'assistant_done':
        this.finalizeAssistantText(event);
        break;

      case 'tool_call':
        this.appendToolCallBlock(event);
        break;

      case 'tool_result':
        this.updateToolCallWithResult(event);
        break;

      case 'agent_message':
        this.appendAgentMessagePending(event);
        break;

      case 'agent_callback':
        this.resolveAgentMessage(event);
        break;

      case 'interrupt':
        this.appendInterruptIndicator(event);
        break;

      case 'turn_end':
        this.finalizeTurn(event.turnId);
        break;
    }
  }

  // Replay: render all events in order
  replayEvents(events: ChatEvent[]): void {
    this.clear();
    for (const event of events) {
      this.renderEvent(event);
    }
  }

  // Real-time: append and scroll
  handleNewEvent(event: ChatEvent): void {
    this.renderEvent(event);
    this.scrollToBottomIfNeeded();
  }
}
```

### DOM Structure with Data Attributes

```html
<div class="chat-log">
  <!-- Turn 1 -->
  <div class="turn" data-turn-id="t1">
    <div class="user-message" data-event-id="e1">What's the weather and fix the bug?</div>

    <div class="assistant-response" data-response-id="r1">
      <!-- Tool calls grouped -->
      <div class="tool-calls">
        <div class="tool-call" data-tool-call-id="tc1" data-event-id="e2">
          <div class="tool-name">get_weather</div>
          <div class="tool-args">{"city": "Austin"}</div>
          <div class="tool-result" data-event-id="e3">72°F, sunny</div>
        </div>
      </div>

      <!-- Agent messages grouped -->
      <div class="agent-messages">
        <div class="agent-message resolved" data-message-id="am1" data-event-id="e4">
          <div class="agent-name">code-agent</div>
          <div class="agent-result" data-event-id="e7">Fixed null pointer on line 42</div>
        </div>
      </div>

      <!-- Final text -->
      <div class="assistant-text" data-event-id="e8">
        It's 72°F in Austin. The code agent fixed the bug.
      </div>
    </div>
  </div>

  <!-- Turn 2 (from async callback) -->
  <div class="turn" data-turn-id="t2">...</div>
</div>
```

## Migration Strategy

### Phase 1: Event Schema & Store

- Define `ChatEvent` types in `packages/shared`
- Implement `EventStore` alongside existing `ConversationStore`
- Dual-write: log to both stores during transition

### Phase 2: Provider Normalizers

- Create normalizers for OpenAI, Claude CLI, Codex CLI
- Emit `ChatEvent[]` from chat processor
- Keep existing broadcast/logging as fallback

### Phase 3: Unified Renderer

- Build `ChatRenderer` that only uses `ChatEvent`
- Test with replay first (load from new store)
- Wire up for real-time

### Phase 4: Client Integration

- Replace `MessageRenderer` with `ChatRenderer`
- Remove `TranscriptReplayController`
- Single code path for all rendering

### Phase 5: Cleanup

- Remove old `ConversationStore` methods
- Remove old transcript format
- Migration tool for existing sessions

## File Structure

```
packages/shared/src/
  chatEvents.ts              # ChatEvent types, ChatEventType enum

packages/agent-server/src/
  events/
    eventStore.ts            # EventStore interface and implementation
    eventStore.test.ts
  normalizers/
    types.ts                 # ProviderNormalizer interface
    openaiNormalizer.ts      # OpenAI → ChatEvent
    claudeCliNormalizer.ts   # Claude CLI → ChatEvent
    codexCliNormalizer.ts    # Codex CLI → ChatEvent
    normalizers.test.ts
  projections/
    toOpenAIMessages.ts      # ChatEvent[] → OpenAI messages
    toClaudePrompt.ts        # ChatEvent[] → Claude CLI prompt
    projections.test.ts

packages/web-client/src/
  controllers/
    chatRenderer.ts          # Unified renderer
    chatRenderer.test.ts
```

## Benefits

1. **Reliability**: Same code path for real-time and replay eliminates entire classes of bugs
2. **Debuggability**: `cat session.events.jsonl` shows exactly what happened
3. **Flexibility**: Change rendering (grouping, styling) without touching event format
4. **Testability**: Pure functions for normalizers and projections
5. **Async correctness**: Events have IDs that link across turns - callbacks always find their target

## Open Questions

1. **Event compression**: Long sessions with many chunks - store every delta or compress?
2. **Audio events**: Include audio data in event log or store separately with references?
3. **Backward compatibility**: How long to support old transcript format?
4. **Event versioning**: How to handle schema changes over time?

---

Session: c6a713d8-c5df-4d76-b04c-8edee2d84c30 (pi)
