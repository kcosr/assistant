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
- Default view renders markdown; use **Edit** to modify a note.
- Browser mode supports arrow-key grid navigation with Enter to open a note; Escape returns to the
  browser view from note mode.
- Press **p** in browser mode to toggle pinned notes. Pinned notes show a pin icon and appear in the
  command palette via `/pinned`.
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
