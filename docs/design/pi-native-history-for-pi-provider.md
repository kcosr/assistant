# Design: Pi-native history for provider `pi` (fast reload, minimal EventStore)

## Summary
Today, sessions that use the **Pi SDK provider** (`providerId: "pi"`) persist the full, verbose `ChatEvent` stream (chunks/deltas/tool streaming) into the assistant EventStore (`data/sessions/<sessionId>/events.jsonl`). On browser reload, replay reads that verbose file, which is slow.

In contrast, CLI-backed providers (`pi-cli`, `codex-cli`, `claude-cli`) do **not** persist the verbose event stream. Instead, reload is reconstructed from the provider’s **native session file**, and only a small set of overlay events (interactions) are persisted.

This design makes `providerId: "pi"` behave like the CLI providers:

1. **Realtime** remains unchanged (we still emit verbose `ChatEvent`s for streaming UX).
2. **Reload/history** is reconstructed from the **Pi session JSONL** in `~/.pi/agent/sessions/...`.
3. We write a small number of **assistant-specific events** into the Pi JSONL itself using Pi’s native extension slots (`custom` and `custom_message`), so reload does not depend on a second verbose log.

## Background / Current behavior (review of code)

### Where verbose events are persisted
- `packages/agent-server/src/events/eventStore.ts` → `SessionScopedEventStore`
  - If `HistoryProvider.shouldPersist()` returns `false`, the EventStore will persist **only overlay events**: `interaction_request`, `interaction_response`, `interaction_pending`.
  - Otherwise, it persists all chat events, including deltas.

### Why `providerId: "pi"` currently persists everything
- `packages/agent-server/src/index.ts` builds `HistoryProviderRegistry` with:
  - `new PiSessionHistoryProvider({ eventStore })`
- `packages/agent-server/src/history/historyProvider.ts`:
  - `PiSessionHistoryProvider.supports()` currently returns `providerId === "pi-cli"`.
  - For provider `"pi"`, the registry falls through to `EventStoreHistoryProvider` which has `shouldPersist() === true`.
  - Result: `SessionScopedEventStore` persists the full verbose event stream for `"pi"` sessions.

### Pi session mirroring exists but is not used for reload for `providerId: "pi"`
- `packages/agent-server/src/history/piSessionWriter.ts` mirrors session messages into Pi’s JSONL format under `~/.pi/agent/sessions/`.
- It is enabled by default: `appConfig.sessions.mirrorPiSessionHistory ?? true`.
- However, reload for `providerId: "pi"` does not read that file today.

### Important edge case: async agent callbacks
The app implements async cross-agent messaging (`agents_message`) using:
- `agent_callback` chat events emitted in the caller session (`builtInTools.ts`).
- A follow-up **callback turn** in the caller session where the callback payload is used as hidden input:
  - `processUserMessage(... agentMessageContext.logType = "callback")`.
  - In `chatProcessor.ts`, `logType === "callback"` skips writing the `user_message` ChatEvent (so the input is hidden), but the input still exists in `state.chatMessages` as a normal user message.

If we switch reload to Pi JSONL without additional handling, **callback input becomes visible** on reload (because it was persisted as a user message), and **agent_callback UI updates are lost** (because they are not represented in Pi message entries).

This design explicitly preserves callback behavior via Pi-native extension entries.

## Goals
- **G1: Fast reload** for `providerId: "pi"` by avoiding replay from verbose `events.jsonl`.
- **G2: Keep realtime streaming UX** unchanged (deltas still emitted live).
- **G3: Use Pi session JSONL as the canonical persisted replay source** for `providerId: "pi"`.
- **G4: Preserve assistant-specific semantics that are not encoded in Pi message entries**, especially:
  - async `agent_callback` updates
  - hidden callback-input turns (logType `"callback"`)
- **G5: Avoid maintaining separate assistant-specific history files.**

## Non-goals
- Implementing Pi’s full tree/branch semantics on the assistant side (we only need fast linear replay).
- Replacing the assistant’s EventStore entirely (we keep it for interactions and other providers).

## Proposed design

### 1) Make `PiSessionHistoryProvider` support providerId `"pi"`

File: `packages/agent-server/src/history/historyProvider.ts`

Change:
- `PiSessionHistoryProvider.supports(providerId)` should return `true` for:
  - `"pi-cli"` (existing)
  - `"pi"` (new)

Keep:
- `PiSessionHistoryProvider.shouldPersist()` returns `false`.

Effect:
- For `providerId: "pi"`, `SessionScopedEventStore` will not persist chat events to the assistant EventStore (including overlays); Pi JSONL is the persistence source.
- Reload/history will be reconstructed from Pi JSONL (like `pi-cli`) without an EventStore merge step.

### 2) Extend Pi JSONL writing to include assistant extension entries

We will extend `PiSessionWriter` to support app-specific Pi-native extension entry types:

#### 2.1) Pi-native `custom` entries for “event” records (not in LLM context)

Add support for writing `type: "custom"` entries (Pi coding-agent’s `CustomEntry` concept).

We will reserve:
- `customType: "assistant.event"`
- `data: { chatEventType: string, payload: object, turnId?: string, responseId?: string }`

These entries are used for replay-only state (UI lifecycle and tool block updates) and **must not** participate in LLM context.

We will write `assistant.event` custom entries for:
- `agent_callback` (required to resolve `agents_message` tool blocks on reload)
- `interrupt` (best-effort cancellation marker on reload)
- Synthetic interrupted `tool_result` emitted by cancel handling (if needed for tool block completion)

#### 2.2) Pi-native `custom_message` entries for agent-attributed inputs (in LLM context)

We will use Pi’s `type: "custom_message"` entries (Pi coding-agent’s `CustomMessageEntry`) for **inputs that must be present in LLM context but need special replay semantics**.

Reserve:
- `customType: "assistant.input"`
- `display`:
  - `true` for agent-attributed visible inputs
  - `false` for hidden callback inputs (logType `"callback"`)
- `details: { kind: "agent" | "callback", fromAgentId?: string, fromSessionId?: string }`

Mapping intent:
- `kind: "agent"` → replay as `ChatEvent.user_message` with `{ text, fromAgentId, fromSessionId }`.
- `kind: "callback"` → replay as a non-rendered event that still enters context.

Implementation detail: to keep existing rendering logic unchanged, hidden callback inputs will be replayed as `ChatEvent.agent_message` (ChatRenderer skips rendering `agent_message`, but `buildChatMessagesFromEvents()` includes it in LLM context).

Note: `ChatEvent.agent_message` has a structured payload (`{ messageId, targetAgentId, targetSessionId, message, wait }`). For replay, we will synthesize those fields (e.g., `messageId` from the Pi entry id, `targetSessionId` = current session, `targetAgentId` = `"callback"`, `wait` = `false`) and set `message` to the callback input text.

### 3) Track message provenance in the in-memory message list

Problem: `PiSessionWriter.sync()` only sees `state.chatMessages: ChatCompletionMessage[]`, which currently has no metadata for:
- whether a user message originated from another agent
- whether a user message is a hidden callback input

Solution: extend `ChatCompletionMessage` with optional metadata (ignored by provider adapters).

File: `packages/agent-server/src/chatCompletionTypes.ts`

Add:
```ts
export interface ChatCompletionMessageMeta {
  source?: "user" | "agent" | "callback";
  fromAgentId?: string;
  fromSessionId?: string;
  visibility?: "visible" | "hidden";
}
```

Attach `meta?: ChatCompletionMessageMeta` to the `role: "user"` variant.

Then, in `packages/agent-server/src/chatProcessor.ts`, when creating the user message:
- normal user → no meta
- agent-attributed user → `meta.source = "agent"` + `fromAgentId/fromSessionId`
- callback input turn → `meta.source = "callback"`, `meta.visibility = "hidden"`, `fromAgentId/fromSessionId`

### 4) Update PiSessionWriter to persist user messages based on meta

File: `packages/agent-server/src/history/piSessionWriter.ts`

Modify the message loop in `sync()` for `message.role === "user"`:
- If `message.meta?.source === "agent"`:
  - write a Pi `custom_message` entry (`assistant.input`, display=true, details include fromAgentId/fromSessionId)
  - **do not** write a normal Pi `message` entry for this input (avoids duplicates)
- If `message.meta?.source === "callback" && message.meta.visibility === "hidden"`:
  - write a Pi `custom_message` entry (`assistant.input`, display=false, details include fromAgentId/fromSessionId)
  - **do not** write a normal Pi `message` entry (prevents callback input from appearing on reload)
- Else:
  - write normal Pi `message` entry as today.

Additionally, add an explicit API to append Pi `custom` entries:
- `PiSessionWriter.appendAssistantEvent({ summary, eventType, payload, turnId?, responseId? })`

Call sites:
- `packages/agent-server/src/builtInTools.ts` where `agent_callback` ChatEvent is emitted → also append `assistant.event`.
- `packages/agent-server/src/ws/chatOutputCancelHandling.ts` where `interrupt` and synthetic interrupted `tool_result` events are emitted → also append `assistant.event`.

This keeps the Pi JSONL replay-complete even when EventStore persistence is disabled for `providerId: "pi"`.

### 5) Extend Pi JSONL reader to project assistant extension entries back into ChatEvents

File: `packages/agent-server/src/history/historyProvider.ts`

Extend `buildChatEventsFromPiSession()`:

1) When `entry.type === "custom"` and `customType === "assistant.event"`:
- read `data.chatEventType` and `data.payload`
- emit a ChatEvent of that type
- apply `turnId/responseId` if present

2) When `entry.type === "custom_message"` and `customType === "assistant.input"`:
- if `details.kind === "agent"`:
  - emit `ChatEvent.user_message` with `{ text, fromAgentId, fromSessionId }`
- if `details.kind === "callback"`:
  - emit a non-rendered-but-contextual event:
    - `ChatEvent.agent_message` with a synthetic payload (validated shape)
    - `payload.message` is set to the callback input text (other required fields are synthetic; see note above)

If the entry is a third-party/custom Pi entry we don’t recognize, keep the current behavior (emit `custom_message` ChatEvent for display). When possible, use `customType` as the display label.

## Persistence policy

After this change:
- For `providerId: "pi"` and `"pi-cli"`:
  - `HistoryProvider.shouldPersist() === false`
  - Pi JSONL is the persisted replay source for provider history.
  - For `providerId: "pi"`, interaction overlay events are also mirrored into Pi JSONL (so replay does not merge EventStore overlays).

## Compatibility and migration
- Existing sessions:
  - `providerId: "pi"` sessions already have Pi JSONL written by `PiSessionWriter`.
  - After change, reload will start using those files.
- New entries (`custom`, `custom_message`) are additive.
- Reader remains lenient; unknown entries are ignored or rendered as generic custom messages.

## Pi session invariants / repair

Pi’s native session replayer expects every `toolResult` to reference a prior `toolCall` (same `toolCallId`). If the JSONL contains a `toolResult` without a matching `toolCall`, Pi-native tools may error while loading the session.

To keep mirrored sessions robust:
- Mirroring should never emit orphan `toolResult` entries; when encountered, prefer a non-breaking placeholder entry (custom entry) rather than writing an invalid tool result.
- For existing logs that already contain orphan tool results, use the repair helper:
  - `node scripts/repair-pi-session-jsonl.mjs <path-to-session.jsonl>`
  - `node scripts/repair-pi-session-jsonl.mjs <path-to-session.jsonl> --dry-run`

## Testing plan

### Unit tests
Add tests under `packages/agent-server/src/history/`:
- `piSessionWriter`:
  - writing `assistant.input` custom_message for agent + callback cases
  - callback input is not emitted as normal user message entry
  - `appendAssistantEvent()` writes `custom` entry and advances leafId without affecting messageCount
- `historyProvider`:
  - `assistant.event` → emits corresponding ChatEvent
  - `assistant.input(kind=agent)` → emits `user_message` with attribution
  - `assistant.input(kind=callback)` → emits `agent_message` and does not create visible user_message

### Integration tests
- `agents_message` async callback with caller provider = `pi`:
  - after completion and reload, tool block is resolved (agent_callback replay)
  - callback input does not appear as a visible user message

## Rollout / sequencing
1) Implement writer + reader support for `assistant.event` + `assistant.input`.
2) Enable `PiSessionHistoryProvider` for providerId `"pi"`.
3) Verify reload performance and callback semantics.
4) Mirror `interaction_*` into Pi JSONL and drop overlay merge for `"pi"` sessions.
