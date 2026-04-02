# Events — Design Decisions

## Current Architecture

Assistant has two parallel event paths for the UI:

1. **ServerMessage (live)** — direct WebSocket messages (`ServerTextDeltaMessage`, `ServerThinkingStartMessage`, `ServerToolCallStartMessage`, etc.) sent to connected clients in real time during streaming.

2. **ChatEvent / EventStore (replay)** — structured `ChatEvent` records (`assistant_chunk`, `thinking_chunk`, `tool_call`, `tool_result`, `turn_end`, etc.) stored in an `EventStore` and also broadcast as `chat_event` WebSocket messages. Used for UI state recovery (reconnection, questionnaire state).

Both are emitted from the same stream handlers in `chatRunCore.ts`, meaning the frontend receives events twice in different formats.

## New Architecture

### Primary path: AgentEvent → ServerMessage

The `AgentEvent` listener translates agent-core events directly to `ServerMessage` types for WebSocket clients. This is the live streaming path and doesn't change conceptually — just the source changes from manual stream handling to agent-core events.

### Secondary path: EventStore (migration-only dependency)

The EventStore is kept as a thin pass-through. The same `AgentEvent` listener that emits `ServerMessage`s also creates `ChatEvent` records and appends them to EventStore.

This preserves:
- Client reconnection replay
- Questionnaire / interaction state recovery
- Any frontend code that depends on `ChatEvent` format
- `SessionHub` reconstruction of `chatMessages`
- `PiSessionHistoryProvider` fallback / overlay behavior while the native Pi session file is
  missing or still being tailed

### Why not remove EventStore now?

Removing EventStore would require reworking:

- frontend replay and questionnaire systems
- `SessionHub.resolveChatMessages()`
- `buildChatMessagesFromEvents()`
- `PiSessionHistoryProvider` overlay fallback / merge logic

That is a separate project from the loop migration. EventStore should not be treated as part of the
target architecture beyond the point where replay can read directly from the session history.

### Future direction

Long-term, the EventStore can be removed once:
- Frontend can replay from the pi session file directly (it contains all messages and custom entries)
- Frontend uses WebSocket `ServerMessage` stream for live updates (already does)
- Questionnaire state is reconstructed from session file custom entries instead of ChatEvent records

## Event Listener Responsibilities

The single `AgentEvent` listener handles all side effects:

```
AgentEvent
  ├── ServerMessage → WebSocket (live UI)
  ├── ChatEvent → EventStore (migration-only replay dependency)
  ├── Session writer → JSONL file (persistence)
  └── State tracking → activeChatRun updates
```

This is cleaner than the current architecture where these concerns are scattered across `chatRunCore.ts`, `chatTurnFinalization.ts`, `chatProcessor.ts`, and `chatEventUtils.ts`.

## Mapping Constraints

- `message_update` must preserve `AssistantMessageEvent` detail (`text_*`, `thinking_*`,
  `toolcall_*`) because assistant UI/rendering currently depends on phase/toolcall sequencing.
- Tool progress is not only `tool_execution_end`; `tool_execution_update` must continue to drive
  streamed tool output.
- `toolResult` messages arrive as `message_start` / `message_end` after `tool_execution_end`.
- Agent-core `turn_start` / `turn_end` are internal loop turns, so assistant request-level
  `turn_start` / `turn_end` ChatEvents should still be derived from the outer request state.
