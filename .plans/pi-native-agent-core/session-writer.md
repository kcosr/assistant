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
- replay compatibility with the current `PiSessionHistoryProvider`

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

- **Turn boundaries** — `custom` entries with `customType: 'assistant.turn_start'` and `'assistant.turn_end'` for UI replay
- **Agent messages** — `custom_message` entries with `customType: 'assistant.input'` for inter-agent messages and callbacks (with `kind: 'agent_message'` or `kind: 'callback'` in details)
- **Orphan tool results** — `custom` entries for tool results that don't match a tool call (edge case)

These all fit within the existing `custom` / `custom_message` entry types — no format extension needed.

The target is the coding-agent-compatible file format and semantics, not necessarily importing
`SessionManager` directly.

## New Architecture

### Target Writer

Replace the 1,831-line writer with a smaller writer only after preserving these contracts:

- emit `message` entries for user / assistant / toolResult messages
- emit `custom_message` entries for assistant-attributed inputs and orphan tool-result markers
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

  // Append custom entries (turn boundaries, agent messages)
  appendCustom(customType: string, data?: unknown): string
  appendCustomMessage(customType: string, content: string, details?: unknown): string

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
- `turn_start` → `appendCustom('assistant.turn_start', { turnId })`
- `turn_end` → `appendCustom('assistant.turn_end', { turnId, status })`
- Model change → `appendModelChange(provider, modelId)`

However, there are two important caveats:

1. Agent-core `turn_start` / `turn_end` are internal loop turns, not assistant request boundaries.
   Assistant request boundaries must still be derived from request state.
2. If any temporary projection/shim is introduced during implementation, it is internal-only and
   removed before the migration is considered complete.

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
AgentEvent               → Session Writer Action
──────────────────────────────────────────────────
request_start            → appendCustom('assistant.turn_start', { turnId, trigger })
message_start (user)     → appendMessage(userMessage)
                           (or appendCustomMessage for agent/callback inputs)
message_end (assistant)  → appendMessage(assistantMessage)
message_end (toolResult) → appendMessage(toolResultMessage)
request_end              → appendCustom('assistant.turn_end', { turnId, status })
model change (external)  → appendModelChange(provider, modelId)
thinking change (ext.)   → appendThinkingLevelChange(level)
```

### Agent Message Custom Entries

When input comes from another agent (not a direct user message):

```typescript
// Instead of appendMessage for the user turn:
appendCustomMessage('assistant.input', content, {
  kind: 'agent_message',  // or 'callback'
  fromAgentId,
  fromSessionId,
});
```

This preserves the current behavior where agent messages are recorded as custom message entries with attribution metadata.

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
- Custom entries (`assistant.turn_start`, etc.) are ignored by pi CLI (it skips unknown custom types)

The migration also has to remain consumable by assistant's current replay stack until that stack is
rewritten. Today `SessionHub` still rebuilds `chatMessages` from `ChatEvent`s via
`buildChatMessagesFromEvents()`, and `PiSessionHistoryProvider` still parses the session JSONL back
into `ChatEvent`s for replay.

## Open Questions

- [ ] Do we import `SessionManager` from coding-agent, or write our own minimal version?
  Recommendation: write our own compatibility-focused version
- [x] Session file location — align with pi CLI's `~/.pi/agent/sessions/`
- [x] Turn history manipulation (trim_before, trim_after, delete_turn) — keep in scope for the first cut
- [ ] How to handle model/thinking changes that happen between turns (user changes via UI)?
