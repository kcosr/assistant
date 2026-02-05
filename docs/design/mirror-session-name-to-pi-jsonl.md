# Mirror assistant session rename into Pi session JSONL

## Overview
When a session is renamed in the assistant UI (Sessions → Rename), persist the new session name into the mirrored **Pi session JSONL** (the `~/.pi/agent/sessions/<encoded-cwd>/*_<pi-session-id>.jsonl` file) so pi-mono’s session picker/search can find the session by that name.

pi-mono stores the session display name as a `session_info` entry:
```jsonl
{"type":"session_info","id":"...","parentId":"...","timestamp":"...","name":"Refactor auth module"}
```
The assistant already mirrors Pi SDK chat history into the pi-mono JSONL format via `PiSessionWriter`, but it does not currently write `session_info` entries.

## Motivation
- Assistant sessions can already be named (`/api/plugins/sessions/operations/update` → `SessionIndex.renameSession`).
- Pi SDK sessions are mirrored to pi-mono JSONL so they can be resumed via pi-mono CLI.
- Without mirroring session names into the JSONL, pi-mono cannot search/filter by human-friendly session name (it falls back to first message and message contents).

## Proposed Solution
### 1) Extend `PiSessionWriter` to support `session_info` entries
Add a new Pi JSONL entry type mirroring pi-mono’s `SessionInfoEntry`:
- `type: "session_info"`
- `id: string` (existing `generateEntryId()`)
- `parentId: string | null` (current leaf)
- `timestamp: string`
- `name: string` (trimmed; allow empty string for “clear name” semantics)

Add a new method (name TBD) on `PiSessionWriter`, e.g.:
- `appendSessionInfo({ summary, name, updateAttributes? })`

Behavior:
- Call `ensureSessionState()` to resolve/create the Pi session id + cwd mapping and locate the JSONL file.
- Create and queue an entry that advances the Pi session leaf (`state.leafId = entry.id`).
- If the Pi session file has not been flushed yet (no assistant output written), store the entry in `state.pendingEntries` so it will be included when the file is first created.
- If already flushed, append immediately.

This mirrors pi-mono’s append-only semantics (renames create additional `session_info` entries; the latest non-empty name is the active name).

### 2) On assistant session rename, write `session_info` into Pi JSONL (when applicable)
The rename request is handled by the Sessions core plugin:
- `skills/packages/plugins/core/sessions/server/index.ts` operation `update` → `sessionIndex.renameSession()`

After a successful rename, if:
- Pi mirroring is enabled (`SessionHub` has a `PiSessionWriter`), and
- the target session is a Pi SDK-backed session (see “Open questions” for detection specifics),

then call the new `PiSessionWriter.appendSessionInfo(...)` to record the name into the Pi JSONL.

### 3) Name clearing semantics
Assistant supports clearing a name by sending `name: null`.

pi-mono does not have a dedicated “clear” operation; it just reads the latest `session_info` where `entry.name` is truthy.

So, when assistant clears the name (`null`), write a `session_info` entry with `name: ""` to ensure the most recent entry clears the effective name in pi-mono.

## Files to update
- `skills/packages/agent-server/src/history/piSessionWriter.ts`
  - Add `PiSessionInfoEntry` type
  - Add `appendSessionInfo(...)` (or similar) method
  - Include `session_info` in loadExisting state parsing if needed (not strictly required for leaf tracking, but useful if we later want to avoid duplicate writes)
- `skills/packages/plugins/core/sessions/server/index.ts`
  - After `renameSession`, mirror the name into Pi JSONL when the session is Pi-backed
- Tests:
  - `skills/packages/agent-server/src/history/piSessionWriter.test.ts` (new test cases for session_info)
  - `skills/packages/plugins/core/sessions/server/index.test.ts` (or new test) to ensure rename triggers writer call (may require mocking `sessionHub.getPiSessionWriter()`)

## Implementation Steps
1. Add `PiSessionInfoEntry` to `PiSessionWriter` and implement `appendSessionInfo`.
2. Ensure `appendSessionInfo` respects the “pending until assistant exists” flush behavior.
3. Wire session rename → `appendSessionInfo` in Sessions plugin operation `update`.
4. Add tests for:
   - appending session_info on a flushed file
   - appending session_info before flush (pendingEntries)
   - clear-name behavior (`name: ""`)
5. Manual verification:
   - start a Pi provider session, rename it in assistant
   - confirm `~/.pi/agent/sessions/...jsonl` contains `session_info` entries
   - confirm `pi -r` (or session picker) can search by that name

## Decisions
- Mirror session names **only for Pi SDK provider sessions** (`agent.chat.provider === "pi"`).
- If the Pi session JSONL does not exist yet, still record the rename by storing the `session_info` entry in `PiSessionWriter` pending state until the first flush.
- Renames are **append-only** (multiple renames create multiple `session_info` entries), matching pi-mono semantics.

## Open Questions
- None

## Alternatives Considered
- Store the name in assistant-only metadata and try to teach pi-mono to read it.
  - Rejected: the whole goal is to make the existing pi-mono session tooling/search work.
- Rewrite the Pi JSONL file in-place to update a single name field.
  - Rejected: pi-mono’s format is append-only; rewriting increases corruption risk.

## Out of Scope
- Retroactively migrating names for existing Pi JSONL sessions (could be added later).
- Mirroring pin status or other assistant session metadata into Pi JSONL.
