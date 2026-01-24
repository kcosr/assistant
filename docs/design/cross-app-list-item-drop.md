# Support cross-app drop target for list items

## Summary
Enable dragging list items out of the Lists panel into external applications by exporting a
human-readable payload via `DataTransfer`. The payload should list items at the top level, with
list context (list name, list id, instance id) repeated per item so it can scale to multi-list
drags later. Internal drag-and-drop (reorder / cross-list move) must continue to use the existing
custom MIME types.

## Goals
- Provide external apps a useful payload when list items are dragged out of the app.
- Include list context and item details using the same terminology users/agents see in the Lists
  CLI (listId, itemId, instance_id).
- Preserve existing internal drag behaviors for reordering and cross-list moves.
- Support single-item and multi-item drag selections.

## Non-goals
- Accepting drops from external apps into lists.
- Changing list reorder/move behavior or touch drag handling.
- Redesigning list selection UI.

## Current behavior
- Dragging list rows sets `application/x-list-items` (and `application/x-list-item` for single
  item) plus `text/plain` containing the primary item id.
- Internal drop handling uses the custom MIME types and stored drag state.
- External drop targets only receive the item id as plain text, which is not useful.

## Proposed behavior
When a drag starts from a list row, add export data for external apps:

- `text/plain`: a human-readable block containing top-level items, each with list context +
  selected item details.
- `text/html` (optional but recommended): the same content as HTML for richer drop targets.

The internal drag MIME types (`application/x-list-items`, `application/x-list-item`) remain
unchanged and are still used for list-to-list moves.

## Implementation sketch
1. Add an optional callback to `ListPanelTableControllerOptions` to provide external drag
   content:
   - Example signature:
     - `getExternalDragData?: (params: { listId: string; primaryItemId: string; itemIds: string[] }) => { plainText?: string; html?: string; custom?: Record<string, string> } | null`
2. In `ListPanelTableController`, call this callback during `dragstart` (after setting internal
   types) and `setData` for any provided payloads.
3. In `ListPanelController`, implement the callback by:
   - Resolving selected items (title/url/notes) from `currentData`.
   - Building a human-readable payload with the same terminology the Lists CLI uses, rendered
     as individual item blocks (no shared heading/count):
     - `plugin: lists`
     - `itemId: <id>`
       - `title: <title>`
       - `notes: <notes>` (if present)
       - `url: <url>` (if present)
       - `listId: <listId>`
       - `listName: <list name>` (if present)
       - `instance_id: <instance_id>`
     - (blank line between items)
   - Producing plain text and (optionally) HTML summaries for the selected items.
4. In `lists/web/index.ts`, expose list/instance context (list name/id + instance_id) to the
   list panel controller for use in drag exports.

## Edge cases
- Multi-select drag should include all selected item titles (ordered as displayed).
- Items with no title should be omitted from the item list.
- Do not truncate notes; include full notes when present.
- When list metadata is unavailable (no active list), fall back to a simple text summary
  without list/instance fields.

## Tests
- Add/update unit tests to verify `ListPanelTableController` sets external drag data when
  the callback is provided.
- Add a unit test for the list panel controller drag builder to ensure the payload contains
  per-item list/instance fields and item details with correct terminology.

## Files to update
- `packages/web-client/src/controllers/listPanelTableController.ts`
- `packages/web-client/src/controllers/listPanelController.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/web-client/src/utils/chatMessageRenderer.ts` (only if helpers are factored)
- `packages/web-client/src/controllers/listPanelTableController.test.ts`
- `packages/web-client/src/controllers/listPanelController.test.ts`
- `packages/plugins/official/lists/README.md`

## Open questions
- None (format confirmed: human-readable list context + item details; omit missing fields;
  no truncation; no `text/uri-list`).
