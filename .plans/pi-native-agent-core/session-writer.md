# Session Writer — Rewrite Design

## Overview

The current `piSessionWriter.ts` (1,831 lines) is the most complex file in the migration. Its complexity comes from two sources:

1. **Dual message format translation** — converting `ChatCompletionMessage` (with `piSdkMessage` sidecar) to pi-compatible JSONL entries. This goes away entirely when messages are native pi-ai format.
2. **Incremental sync with signature-based alignment** — comparing persisted vs in-memory messages to append only what's new, handling replay drift, orphan tool results, etc. Much of this complexity exists because assistant's messages and pi's messages were two different formats that could drift apart.

With native pi-ai messages, the writer becomes much simpler: messages are already in the right format, so writing is just appending entries to JSONL.

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

## New Architecture

### Simple Append-Only Writer

Replace the 1,831-line writer with a straightforward append-only writer:

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

### No More Sync / Alignment

The current writer has elaborate sync logic because:
- Messages might be added to `chatMessages[]` in memory without being persisted
- The pi session file might already have entries from a previous run
- Signatures are computed to detect what's new

With agent-core, the event listener writes entries as they happen:
- `message_end` → `appendMessage(event.message)`
- `turn_start` → `appendCustom('assistant.turn_start', { turnId })`
- `turn_end` → `appendCustom('assistant.turn_end', { turnId, status })`
- Model change → `appendModelChange(provider, modelId)`

No diffing, no alignment, no signatures. Events arrive in order, entries are appended in order.

### Session Resume

On resume, the writer loads the existing JSONL file and reconstructs:
- `leafId` — the last entry's id (for parent chaining)
- Message count — for any bookkeeping
- The messages themselves → fed into `agent.replaceMessages()` as `AgentMessage[]`

Since messages are already in pi-ai format in the file, loading is trivial — just parse each `message` entry and collect them.

## Event-Driven Writing

The session writer is driven entirely by the `AgentEvent` listener:

```
AgentEvent               → Session Writer Action
──────────────────────────────────────────────────
turn_start               → appendCustom('assistant.turn_start', { turnId, trigger })
message_start (user)     → appendMessage(userMessage)
                           (or appendCustomMessage for agent/callback inputs)
message_end (assistant)  → appendMessage(assistantMessage)
message_end (toolResult) → appendMessage(toolResultMessage)
turn_end                 → appendCustom('assistant.turn_end', { turnId, status })
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

The new writer should be roughly **200-400 lines** — mostly the JSONL append mechanics, entry creation helpers, and session file initialization. Compare to 1,831 lines today.

## Compatibility

The output JSONL format matches coding-agent's `SessionManager`. This means:
- Pi CLI can open assistant sessions (same file format)
- Assistant can open pi CLI sessions (same message types)
- Custom entries (`assistant.turn_start`, etc.) are ignored by pi CLI (it skips unknown custom types)

## Open Questions

- [ ] Do we import `SessionManager` from coding-agent, or write our own minimal version? (Recommend: write our own — SessionManager has TUI, branching, and other logic we don't need)
- [ ] Session file location — keep current `~/.assistant/data/sessions/<id>/pi/` or align with pi CLI's `~/.pi/agent/sessions/`?
- [ ] Turn history manipulation (trim_before, trim_after, delete_turn) — reimplement or defer?
- [ ] How to handle model/thinking changes that happen between turns (user changes via UI)?
