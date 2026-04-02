# Agent Loop — Pi Native Chat Module Design

## Overview

A new module (e.g., `piNativeChat.ts`) replaces `chatRunCore.ts` as the entry point for all
pi-native chat. It owns an `Agent` instance from `@mariozechner/pi-agent-core`, subscribes to its
`AgentEvent` stream, and bridges to assistant's session hub, WebSocket clients, session writer, and
event store.

This module needs a request-level adapter. In agent-core, a single prompt can emit multiple
internal `turn_start` / `turn_end` cycles while tools execute and queued steering/follow-up
messages are drained. Assistant's current `turnId` / `responseId` model is closer to
"one user request", not "one internal assistant/tool loop iteration".

## Request Adapter

The request adapter is the assistant-owned boundary around `Agent`. Give it a concrete home
(`piNativeChat.ts` or adjacent module) and treat it as the single place that understands the
difference between:

- assistant requests
- agent-core internal turns
- session persistence
- live UI transport

Suggested responsibilities:

- start one assistant request with stable `{ responseId, assistantTurnId }`
- feed the initial prompt/callback into `Agent`
- translate `AgentEvent` to assistant `ServerMessage` / `ChatEvent`
- persist assistant request boundaries separately from agent-core internal turn boundaries
- own cancellation / accumulated text / finalization bookkeeping
- finalize exactly once on success, abort, or error

## Lifecycle

```
1. User sends message (or agent callback arrives)
2. SessionHub creates a request envelope (`responseId`, assistant-level `turnId`, cancel state)
3. piNativeChat configures Agent (model, thinking, tools, system prompt)
4. Calls `agent.prompt(userMessage)` for normal input
5. AgentEvent stream fires events, potentially across multiple internal turns
6. Request adapter translates to ServerMessages / ChatEvents / persistence writes
7. On `agent_end`, finalize the assistant request (context usage, request `turn_end`, cleanup)
```

## Agent Instance Management

### Per-Session Agent

Each logical session gets its own `Agent` instance. The agent holds:
- `state.messages` — the conversation history (`AgentMessage[]`, not necessarily only raw pi-ai messages)
- `state.model` — resolved pi-ai `Model`
- `state.thinkingLevel` — from session config
- `state.tools` — `AgentTool[]` instances
- `state.systemPrompt` — built from agent config + context files

### When to Create

- **New session**: create fresh `Agent`
- **Resume session**: create `Agent`, load prior messages into `AgentMessage[]`, set via `agent.replaceMessages()`

### Configuration

```typescript
const agent = new Agent({
  initialState: {
    systemPrompt,
    model: resolvedModel,        // from resolvePiSdkModel()
    thinkingLevel,               // from resolveSessionThinkingForRun()
    tools: agentTools,           // AgentTool[] implementations
    messages: [],                // or loaded from session replay
  },
  convertToLlm,                  // handle any custom message types
  getApiKey: async (provider) => {
    return resolvePiAgentAuthApiKey({ providerId: provider });
  },
  onPayload,                     // debug request logging (if enabled)
  sessionId,                     // for provider-side caching
});
```

Initial policy choices:

- `transformContext`: wire as a no-op / `undefined` initially, then replace with compaction later
- `steer()` / `followUp()`: do not expose new assistant features on top of these until the base
  migration is stable
- `toolExecution`: default to `sequential` in the first cut unless tool concurrency is proven safe

### Model Resolution

Keep `resolvePiSdkModel()` from `piSdkProvider.ts` — it resolves `"provider/model"` strings to pi-ai `Model` objects using the pi-ai registry. This is still needed. Move it to a utility file (e.g., `llm/modelResolution.ts`).

### Auth

Import `AuthStorage` from `@mariozechner/pi-coding-agent` and use it via agent-core's `getApiKey` hook:

```typescript
import { AuthStorage } from '@mariozechner/pi-coding-agent';

const authStorage = AuthStorage.create(); // reads ~/.pi/agent/auth.json

// In Agent config:
getApiKey: async (provider) => authStorage.getApiKey(provider)
```

This replaces assistant's custom `piAgentAuth.ts` with the coding-agent's more robust implementation:
- Reads the same `~/.pi/agent/auth.json` file
- Handles OAuth token refresh with file locking (prevents race conditions when multiple processes refresh simultaneously)
- Supports multiple providers (anthropic, openai-codex, etc.) each refreshed independently
- Falls back to environment variables
- We only use read + refresh — login/logout flows are not needed (those are for interactive CLI use)

## Event Listener

Subscribe to `AgentEvent` and dispatch side effects:

```typescript
agent.subscribe((event: AgentEvent) => {
  switch (event.type) {
    case 'message_update':
      handleMessageUpdate(event);
      break;
    case 'message_start':
      handleMessageStart(event);
      break;
    case 'message_end':
      handleMessageEnd(event);
      break;
    case 'tool_execution_start':
      handleToolStart(event);
      break;
    case 'tool_execution_update':
      handleToolUpdate(event);
      break;
    case 'tool_execution_end':
      handleToolEnd(event);
      break;
    case 'turn_start':
      handleTurnStart(event);
      break;
    case 'turn_end':
      handleTurnEnd(event);
      break;
    case 'agent_end':
      handleAgentEnd(event);
      break;
  }
});
```

### message_update Handler

This is the most complex handler. `message_update` wraps an `AssistantMessageEvent` which has a `.type` field indicating the sub-event:

```typescript
function handleMessageUpdate(event: MessageUpdateEvent) {
  const streamEvent = event.assistantMessageEvent;

  switch (streamEvent.type) {
    case 'text_delta':
      // → ServerTextDeltaMessage to WebSocket
      // → ChatEvent assistant_chunk to EventStore
      // → update activeChatRun.accumulatedText
      break;

    case 'thinking_start':
      // → ServerThinkingStartMessage
      break;

    case 'thinking_delta':
      // → ServerThinkingDeltaMessage
      // → ChatEvent thinking_chunk
      break;

    case 'thinking_end':
      // → ServerThinkingDoneMessage
      // → ChatEvent thinking_done
      break;

    case 'toolcall_start':
      // buffer tool call info (id, name)
      break;

    case 'toolcall_delta':
      // → emitToolInputChunkEvent (for real-time UI)
      break;

    case 'toolcall_end':
      // → ServerToolCallStartMessage with final args
      break;

    // text_start, text_end — no action needed
  }
}
```

Do not assume `message_update` alone covers tool result persistence. Tool results are emitted as:

- `tool_execution_start`
- zero or more `tool_execution_update`
- `tool_execution_end`
- `message_start` / `message_end` for the resulting `toolResult` message

That final `toolResult` message must be handled if the session file / replay path wants the same
message graph as coding-agent.

### message_end Handler

```typescript
function handleMessageEnd(event: MessageEndEvent) {
  if (event.message.role === 'assistant') {
    // Capture AssistantMessage for:
    // - session writer (persist to JSONL)
    // - context usage tracking
    // - text signature / phase extraction
  }
}
```

### turn_end Handler

```typescript
function handleTurnEnd(event: TurnEndEvent) {
  // Internal agent-core turn ended (assistant response + tool results)
  // Do not map this 1:1 to assistant request boundaries without an adapter
}
```

### agent_end Handler

```typescript
function handleAgentEnd(event: AgentEndEvent) {
  // Finalize: emit assistant_done, turn_end events
  // Clean up activeChatRun state
  // Flush session writer
}
```

## Session State — Simplified `activeChatRun`

The current `activeChatRun` on `LogicalSessionState` tracks many things. With agent-core, most are handled by the agent itself. Simplified:

```typescript
activeChatRun?: {
  turnId: string;
  responseId: string;
  agent: Agent;                    // the agent-core instance
  agentExchangeId?: string;        // for inter-agent messaging
  accumulatedText: string;         // for partial save on interrupt
  outputStarted: boolean;          // for cancel semantics
  outputCancelled?: boolean;       // user-initiated cancel
  terminalEventsFinalized?: boolean;
};
```

Removed:
- `abortController` — agent-core manages its own; call `agent.abort()`
- `ttsSession` — removed entirely
- `textStartedAt` — can derive from first text_delta event if needed
- `activeToolCalls` — only removable once interrupt / replay behavior can be reproduced from
  `state.pendingToolCalls` plus streamed tool events

## Abort / Cancel

- User cancels output → call `agent.abort()`
- Agent-core handles abort propagation to the stream and tool executions
- `agent_end` event fires with error/aborted stop reason
- Event listener emits interrupt ChatEvent and cleans up

## Errors / Retries

- Treat retry behavior as assistant-owned policy, not something inferred automatically from the raw
  agent-core stream.
- Preserve current assistant behavior for:
  - partial persistence on abort/error
  - user-visible error finalization
  - retry / re-prompt decisions
- Do not introduce long-lived fallback routing to the old loop. If the new path cannot satisfy the
  cutover gate, the migration is not ready to switch.

## convertToLlm

Initially simple — if we only have standard pi-ai messages:

```typescript
function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.filter(
    m => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult'
  );
}
```

Later, if we add custom message types (compaction summaries, agent messages), this is where they get translated — same pattern as coding-agent's `messages.ts`.

This is also the escape hatch for keeping assistant-only custom messages during migration while
still presenting valid provider input to pi-ai.

## Entry Points

### New Chat Turn

```typescript
async function handlePiNativeChat(options: {
  sessionId: string;
  state: LogicalSessionState;
  text: string;
  responseId: string;
  turnId: string;
  agent: AgentDefinition;
  sessionHub: SessionHub;
  agentExchangeId?: string;
}) {
  const piAgent = getOrCreateAgent(options);
  // ... configure event listener ...
  await piAgent.prompt(text);
}
```

### Resume / Continue

```typescript
async function handlePiNativeResume(options: {
  sessionId: string;
  state: LogicalSessionState;
  sessionHub: SessionHub;
}) {
  const piAgent = getOrCreateAgent(options);
  piAgent.replaceMessages(loadMessagesForSession(options));
  // Normal resumed conversations use prompt() for the next user input.
  // continue() is only valid when the last message is not assistant.
}
```

## What This Replaces

| Old | New |
|---|---|
| `chatRunCore.ts` `runChatCompletionCore()` | `handlePiNativeChat()` |
| `runPiSdkChatCompletionIteration()` | Agent-core's internal `streamAssistantResponse()` |
| `createChatRunStreamHandlers()` | `agent.subscribe()` event listener |
| `buildPiContext()` | `convertToLlm` hook |
| Tool iteration while loop | Agent-core's `runLoop()` |
| `chatProcessor.ts` provider dispatch | Direct routing to pi-native module |
| `resolvePiSdkModel()` | Kept, moved to `llm/modelResolution.ts` |
| `resolvePiAgentAuthApiKey()` | Replaced by `AuthStorage.getApiKey()` via `getApiKey` hook |

## Open Questions

- [ ] Do we create one Agent instance per session and keep it alive, or create fresh per turn?
- [ ] How to handle model/thinking changes mid-session (user switches model via UI)?
- [ ] Where does the Agent instance live — on `LogicalSessionState`, or in a separate map?
- [ ] Should `convertToLlm` handle text signature / phase logic, or does that stay in the event listener?
- [ ] Which assistant-level events continue to be derived from request state instead of raw
  agent-core turn events?
