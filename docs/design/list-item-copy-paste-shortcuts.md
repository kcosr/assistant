# List item copy/paste shortcuts

## Summary
Add Cmd/Ctrl + X/C/V shortcuts in the Lists panel to cut/copy/paste list items between lists
within the app. The internal buffer is in-memory (no persistence) and times out after a short
period. External paste targets receive the same human-readable list item block used for drag
export.

## Goals
- Support copy/cut/paste between different lists in the Lists panel.
- Keep cut non-destructive unless pasted within the app.
- Reuse the same list item export block as cross-app drag for clipboard text.
- Time out internal clipboard state to avoid stale operations.

## Non-goals
- Persisting clipboard state across app restarts.
- Pasting into non-list panels.
- Cross-instance list moves (future work).

## Behavior
- Cmd/Ctrl+C: store in-app buffer as `copy` and write plain text to system clipboard.
- Cmd/Ctrl+X: store in-app buffer as `cut` and write plain text to system clipboard.
- Cmd/Ctrl+V:
  - if buffer is empty or expired -> status "Nothing to paste".
  - if target list is the same as source -> no-op.
  - if instance_id differs -> status "Paste only works within the same instance".
  - copy -> `items-bulk-copy` into target list.
  - cut -> `items-bulk-move` into target list, then clear buffer.

## Buffer
- Stored in memory at the list panel controller module scope.
- Replaced by any new cut/copy.
- Auto-clears after ~60 seconds.

## Files to update
- `packages/web-client/src/controllers/listPanelController.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/web-client/src/controllers/listPanelController.test.ts`
- `packages/plugins/official/lists/README.md`
- `CHANGELOG.md`

## Open questions
- None (implementation follows existing devtools item).
