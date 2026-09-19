# Notes Plugin

Markdown notes with tags, search, and a dedicated notes panel.

## Table of Contents

- [Panel](#panel)
- [Source files](#source-files)
- [Operations](#operations)
- [Panel Events](#panel-events)
- [Panel Context](#panel-context)
- [Text Selection for Context](#text-selection-for-context)

## Panel

- Panel type: `notes` (multi-instance, global scope).
- Instance selection comes from config (`plugins.notes.instances`); the default instance id is `default`.
- When multiple instances are selected, the note editor includes a Profile selector; new notes
  default to the `default` instance when it is part of the selection.
- Notes support an optional Description field, shown under the title and editable in the note editor.
- Default view renders markdown; use **Edit** to modify a note.
- Browser mode supports arrow-key grid navigation with Enter to open a note; Escape returns to the
  browser view from note mode.
- Press **p** in browser mode to toggle pinned notes. Pinned notes show a pin icon and appear in the
  command palette via `/pinned`.
- Favorite notes from the editor; favorites show a heart icon and appear in the command palette via
  `/favorites`.
- Default instance data lives under `data/plugins/notes/default/`; additional instances use
  `data/plugins/notes/<instanceId>/`.

## Source files

- `packages/plugins/official/notes/manifest.json`
- `packages/plugins/official/notes/server/index.ts`
- `packages/plugins/official/notes/web/index.ts`

## Operations

Operations are defined in `manifest.json` and exposed via tools/HTTP/CLI when enabled.
The `show` operation requires a `panelId` and targets a specific notes panel.
All operations accept an optional `instance_id` (defaults to `default`), and `instance_list` reports
configured instances.
Use `rename` to change a note title within an instance, or `move` to move a note between instances;
provide `target_instance_id` and optionally `overwrite`.

### Appending

Use `append` (`notes_append`) to add text to an existing note without reading or
replacing its current contents:

```json
{ "title": "Journal", "text": "\n\n## Update\nFinished the first draft." }
```

Text is concatenated exactly; include any desired spaces or newlines. The operation
preserves metadata, uses the same mutation lock as other note edits, and returns
metadata with the new `revision`. An optional `expectedRevision` rejects an append
when the note has changed since that revision. Without it, the text is appended to
the latest content. Missing notes return `note_not_found`; append never creates a
note. Empty text is a no-op that returns the current revision. Retrying a successful
append duplicates its text; after an uncertain response, read before retrying.

### Patching and revisions

`read` returns an opaque `revision` with the note content. `patch` applies a batch of
exact replacements to that revision:

```json
{
  "title": "Project notes",
  "expectedRevision": "<revision from read>",
  "edits": [{ "oldText": "Status: planned", "newText": "Status: in progress" }]
}
```

Each `oldText` must be nonempty and occur exactly once in the original body.
Whitespace is significant. Edits must not overlap, and all matches are resolved
before any replacement is applied. Empty `newText` deletes a passage; to insert
text, include a unique existing passage in both old and new text. Batches contain
1–100 edits and either all succeed or leave the note unchanged. Tags, description,
favorite status, and creation time are preserved. Successful mutations return the
new revision, allowing another edit without rereading unchanged content.

`write` still creates notes and replaces full content. Omit `expectedRevision` only
when creating a new note; replacing an existing note requires its current revision.
A stale or missing revision on replacement returns `note_conflict`. Read the note
again and reconcile your changes instead of blindly retrying with a newer token.
`rename` and `move` also accept an optional source `expectedRevision`.

The editor sends the revision it loaded. A conflicting save keeps the draft visible
and reports the conflict. Review/copy the draft before canceling and reopening the
latest note. No attribution or revision history is stored. Revisions are derived
from file contents, so existing notes need no migration. Mutations are serialized
within the Assistant process and file contents are replaced atomically; external
programs writing files directly do not participate in that locking.

HTTP endpoint format:

```
POST /api/plugins/notes/operations/<operationId>
```

## Panel Events

The server emits panel events to keep notes panels in sync:

- `notes_show`: target a specific panel to open a note.
  - Payload: `{ type: "notes_show", title: string, instance_id?: string }`
- `panel_update`: broadcast to all notes panels after create/update/delete/tag changes.
  - Payload: `{ type: "panel_update", title: string, instance_id?: string, action: "note_updated" | "note_deleted" | "note_tags_updated", note?: NoteMetadata }`

Events are delivered over the session WebSocket as `panel_event` messages.

## Panel Context

When a note is active, the panel sets context with the selected note metadata:

```
{
  "type": "note",
  "id": "<note title>",
  "title": "<note title>",
  "instance_id": "<instance id>",
  "tags": ["..."],
  "created": "<timestamp>",
  "updated": "<timestamp>",
  "contextAttributes": {
    "instance-id": "<instance id>",
    "selected-text": "<selected text if any>"
  }
}
```

The `contextAttributes` are included in the chat context line when sending messages with panel context enabled (e.g., `instance-id="default"` or `instance-id="plans"`).

## Text Selection for Context

You can select text within a note to include it as context when sending messages to the LLM:

1. **Select text**: Hold **Shift** and drag to select text in the note content.
2. **Visual indicator**: An outline appears around the note content, and a preview box shows above the chat input displaying the selected text.
3. **Send message**: When you send a message with panel context enabled, the selected text is included in the context line as `selected-text="..."`.
4. **Clear selection**: Click the × button in the preview box, click in the note content without holding Shift, or send a message (selection clears automatically after sending).

The selected text is preserved even when you click elsewhere (e.g., the chat input), allowing you to compose your message while keeping the selection.
