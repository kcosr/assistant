# Session Writer — Rewrite Design

## Overview

The current `piSessionWriter.ts` (1,831 lines) is the most complex file in the migration. Its complexity comes from two sources:

1. **Dual message format translation** — converting `ChatCompletionMessage` (with `piSdkMessage` sidecar) to pi-compatible JSONL entries. This goes away entirely when messages are native pi-ai format.
2. **Incremental sync with signature-based alignment** — comparing persisted vs in-memory messages to append only what's new, handling replay drift, orphan tool results, etc. Much of this complexity exists because assistant's messages and pi's messages were two different formats that could drift apart.

With native pi-ai messages, some conversion logic disappears, but the writer is still not a trivial
append-only logger. It must preserve assistant-specific behaviors that the current app already uses:

- coding-agent-compatible entry chaining with `id` / `parentId`
- assistant-only `custom` / `custom_message` entries
- explicit assistant request boundaries
- turn-history editing
- projected replay compatibility for assistant's live/reconnect UI model

## Target: Align with Coding-Agent's SessionManager Format

The coding-agent's `SessionManager` uses an append-only JSONL file with these entry types:

| Entry Type | Purpose |
|---|---|
| `session` (header) | Session metadata: id, version, timestamp, cwd, parentSession |
| `message` | A message (user, assistant, toolResult, or custom types) |
| `thinking_level_change` | Thinking level switch |
| `model_change` | Model switch |
| `compaction` | Summary of compacted history |
| `branch_summary` | Summary from a branch |
| `custom` | Extension-specific data (not sent to LLM) |
| `custom_message` | Extension-injected message (sent to LLM context) |
| `label` | User bookmark on an entry |
| `session_info` | Session display name |

Each entry has `id`, `parentId` (for tree structure), and `timestamp`.

### What Assistant Adds

Assistant needs a few custom entries beyond what coding-agent uses:

- **Request boundaries** — `custom` entries with `customType: 'assistant.request_start'` and `'assistant.request_end'` for UI replay/grouping
- **Agent attribution metadata** — `custom` entries that attach `exchangeId`, source session/agent, and callback metadata to model-visible agent/callback inputs
- **Interaction lifecycle** — `custom` entries for requests/responses/updates/terminal interaction state
- **Orphan tool results** — `custom` entries for tool results that don't match a tool call (edge case)
- **Replay ordering metadata** — assistant-owned ordering data sufficient to reconstruct a stable
  per-session replay sequence / cursor model, including stable ordering for attachment/tool-result
  UI artifacts

These all fit within the existing `custom` / `custom_message` entry types — no format extension needed.

The target is the coding-agent-compatible file format and semantics, not necessarily importing
`SessionManager` directly.

## New Architecture

### Target Writer

Replace the 1,831-line writer with a smaller writer only after preserving these contracts:

- emit `message` entries for user / assistant / toolResult messages
- emit `custom` entries for attribution/correlation metadata and orphan tool-result markers
- emit `custom` entries for assistant-only events and request boundaries
- keep `model_change`, `thinking_level_change`, and `session_info`
- preserve `id` / `parentId` chaining so history editing still works

The simplified interface can still look like:

```typescript
class PiSessionWriter {
  private sessionFile: string;
  private leafId: string | null = null;
  private flushed = false;
  private entries: SessionEntry[] = [];

  // Initialize with session header
  async initSession(options: {
    sessionId: string;
    cwd: string;
    parentSession?: string;
  }): void

  // Append a message entry (user, assistant, toolResult)
  appendMessage(message: AgentMessage): string

  // Append model/thinking changes
  appendModelChange(provider: string, modelId: string): string
  appendThinkingLevelChange(level: string): string

  // Append assistant-owned metadata entries
  appendCustom(customType: string, data?: unknown): string

  // Flush to disk
  flush(): void
}
```

### Reduce Sync / Alignment, But Do Not Assume It Vanishes

The current writer has elaborate sync logic because:
- Messages might be added to `chatMessages[]` in memory without being persisted
- The pi session file might already have entries from a previous run
- Signatures are computed to detect what's new

With agent-core, the event listener can write entries as they happen:
- `message_end` → `appendMessage(event.message)`
- `request_start` → `appendCustom('assistant.request_start', { requestId, trigger })`
- `request_end` → `appendCustom('assistant.request_end', { requestId, status })`
- Model change → `appendModelChange(provider, modelId)`

However, there are two important caveats:

1. Agent-core `turn_start` / `turn_end` are internal loop turns, not assistant request boundaries.
   Assistant request boundaries must still be derived from request state.
2. If any temporary projection/shim is introduced during implementation, it is internal-only and
   removed before the migration is considered complete.

### Interaction Entries

User-visible interaction state should also be written as explicit custom entries, for example:

- `assistant.interaction_request`
- `assistant.interaction_response`
- `assistant.interaction_update`
- `assistant.interaction_terminal`

These entries make interaction state visible after reconnect/restart without requiring a second
durable store. They should carry stable ids (`interactionId`, `toolCallId`, `requestId`) and a
clear status/outcome payload.

### Session Resume

On resume, the writer loads the existing JSONL file and reconstructs:
- `leafId` — the last entry's id (for parent chaining)
- Message count — for any bookkeeping
- The messages themselves → fed into `agent.replaceMessages()` as `AgentMessage[]`

Do not treat resume as `agent.continue()` by default. The normal flow is:

1. reconstruct messages
2. `agent.replaceMessages(messages)`
3. wait for the next user input
4. call `agent.prompt(nextUserMessage)`

## Event-Driven Writing

The session writer is driven by the request adapter plus the `AgentEvent` listener:

```
AgentEvent / request state → Session Writer Action
──────────────────────────────────────────────────
request_start            → appendCustom('assistant.request_start', { requestId, trigger })
message_start (user)     → appendMessage(userMessage)
message_end (assistant)  → appendMessage(assistantMessage)
message_end (toolResult) → appendMessage(toolResultMessage)
interaction lifecycle    → appendCustom('assistant.interaction_*', {...})
request_end              → appendCustom('assistant.request_end', { requestId, status })
model change (external)  → appendModelChange(provider, modelId)
thinking change (ext.)   → appendThinkingLevelChange(level)
```

### Agent Message Persistence

When input comes from another agent (not a direct user message):

```typescript
// Persist the actual model-visible input as a normal user message:
appendMessage(agentAttributedUserMessage);

// Persist attribution and cross-session correlation separately:
appendCustom('assistant.agent_input', {
  kind: 'agent_message', // or 'callback'
  exchangeId,
  fromAgentId,
  fromSessionId,
  sourceRequestId,
});
```

This keeps conversational input in the standard message stream while keeping attribution and
cross-session correlation out of LLM context.

### Agent Exchange Correlation

For `agents_message`, persist one durable cross-session `exchangeId` per invocation:

- caller request has its own `requestId`
- target session processes the incoming message inside its own `requestId`
- any callback back to the caller runs inside a later caller `requestId`
- `exchangeId` links those request groups across sessions

This keeps request grouping local to each session while still making the full inter-agent exchange
replayable and inspectable from persisted history alone.

## What Gets Deleted

From the current `piSessionWriter.ts`, all of these are no longer needed:

- `signatureFromChatCompletionMessage()` and all signature computation (~150 lines)
- `resolveMessageSyncAlignment()` and sync logic (~200 lines)
- `ChatCompletionMessage` → pi-ai message conversion (~200 lines)
- `buildPiContext`-style message building
- `piSdkMessage` extraction and handling
- Turn boundary detection from message patterns (now explicit from events)
- `ensureSessionState()` state reconciliation (~150 lines)

## Estimated Size

The steady-state writer should still be materially smaller than the current implementation, but
expect more than just "JSONL append mechanics" because compatibility responsibilities remain.

## Compatibility

The output JSONL format matches coding-agent's `SessionManager`. This means:
- Pi CLI can open assistant sessions (same file format)
- Assistant can open pi CLI sessions (same message types)
- Custom entries (`assistant.request_start`, `assistant.agent_input`, etc.) are ignored by pi CLI
  (it skips unknown custom types)

Imported/shared compatibility rule:

- assistant must be able to open a pi/coding-agent session file even when it contains none of the
  assistant-owned custom metadata
- in that case, outer request groups are synthesized during replay/projection from native message
  history
- this synthesized grouping may be coarser than an assistant-authored session, but it must be
  stable and editable in the UI
- if assistant later rewrites the imported history, it should materialize explicit
  `assistant.request_*` entries into the rewritten file

Current-state note: assistant's existing replay stack still rebuilds `chatMessages` from
`ChatEvent`s via `buildChatMessagesFromEvents()`, and `PiSessionHistoryProvider` still parses the
session JSONL back into `ChatEvent`s for replay.

Decision update: remove that replay stack in the same migration. The session file is the durable
replay source, and the UI reconnect path should read a projected event stream from it directly.

## Request Boundaries

Persist outer assistant request grouping in the same session file using assistant-owned custom
entries, for example:

- `assistant.request_start`
- `assistant.request_end`

These entries should:

- carry a stable `requestId`
- define the outer user-visible request envelope for replay/UI grouping
- allow one request to contain multiple native pi turns
- record terminal outcome explicitly (`completed`, `aborted`, `error`)

Pi-native `turn_start` / `turn_end` remain the canonical inner execution history. The writer should
not collapse multiple pi turns into a fake single turn just to match the current UI.

## History Edit Anchor

Turn-history editing should move from internal pi turn spans to outer assistant request spans.

Implementation rule:

- collect editable spans from `assistant.request_start` / `assistant.request_end`
- use `requestId` as the persisted and API-visible history-edit anchor
- do not use pi internal `turnId` for delete/trim operations

Requested operations:

- `trim_before(requestId)` keeps the anchor request and removes everything before it
- `trim_after(requestId)` removes the anchor request and everything after it
- `delete_request(requestId)` removes only the anchor request
- `reset_session()` removes all request groups

This matches the visible UI boundary where the delete controls live.

If the UI still uses the word "turn" in copy, that is presentation only. The runtime and file
format should treat the editable unit as an outer request group.

Fallback for imported/shared logs:

- if `assistant.request_*` markers are absent, build editable request spans by grouping one user
  input plus all following native pi turns/messages/tool results until the next user input or end
  of transcript
- synthetic request spans should be deterministic so replay and history-edit menus stay stable
- once an imported transcript is rewritten by assistant, persist explicit request markers and stop
  relying on synthesis for that session

### Attachment Cleanup

Attachments and similar tool-owned artifacts should be associated with the owning `requestId` and
`toolCallId`.

History rewrites should therefore return dropped `requestId`s for cleanup, not only dropped
internal pi turn ids. Attachment cleanup should delete any stored attachment whose owner request was
removed.

## Replay Sequence / Cursor

Replay needs an explicit ordering model for client reconciliation.

Requirements:

- projected UI events carry a monotonic per-session `sequence`
- replay requests resume after an opaque `cursor`
- the session file stores enough metadata to reconstruct this ordering deterministically
- the client must not rely on payload-based dedup to merge live and replayed events
- attachment/tool-result rendering must reconcile from the same projected ordering model, not from
  replay-time payload inspection

Design note:

- exact wire encoding is flexible (`sequence` integer plus opaque `cursor` is sufficient)
- `sequence` belongs to the projected UI stream rather than raw entry ids; projector ordering can
  derive from persisted entry order plus a stable sub-event order within each entry/request group
- `cursor` should encode session revision as well as sequence so history rewrites can invalidate old
  cursors cleanly
- history-editing rewrites may invalidate cursors; when that happens the client should do a full
  transcript reload instead of attempting partial merge

## Open Questions

- [x] Writer ownership — keep an assistant-owned writer that targets the compatible session-file
  format; do not import coding-agent `SessionManager`
- [x] Session file location — align with pi CLI's `~/.pi/agent/sessions/`
- [x] Request-group history manipulation (`trim_before`, `trim_after`, `delete_request`,
  `reset_session`) — keep in scope for the first cut
- [x] Model/thinking changes between turns — persist explicit `model_change` /
  `thinking_level_change` entries and apply them at request boundaries
