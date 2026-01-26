# List item keyboard move shortcuts

## Summary
Add keyboard shortcuts in the Lists panel to move a single focused/selected item up or down by one position, complementing the existing `t` (top) and `b` (bottom) shortcuts and matching existing reorder semantics.

## Goals
- Allow quick reorder of a list item without drag-and-drop.
- Keep behavior consistent with existing list keyboard shortcuts.
- Preserve the completion grouping (uncompleted before completed).

## Non-goals
- Moving multiple selected items as a block (unless explicitly requested).
- Changing list sorting behavior or adding new sort modes.
- Reordering across lists.

## Current behavior
- `ListPanelController.handleKeyboardEvent` supports:
  - Arrow keys to move selection.
  - `t` / `b` to move a single selected item to top/bottom (requires exactly one selected item).
  - `n` to add an item, `d` to delete, `p` to pin.
- `t` / `b` updates `position` to `0` / `Number.MAX_SAFE_INTEGER` and does not check the current sort mode.
- Drag-and-drop reorders items by updating `position` only when sorted by position, and blocks reordering across the completed/uncompleted boundary.
- `sortItems` groups completed items at the end (sorted separately), so reorders only affect the current completion group.

## Proposed behavior
- Add `w` to move the focused/selected item up one row and `s` to move down one row.
- Require exactly one selected item; if none selected, fall back to the focused row (same as `t`/`b` behavior).
- Constrain movement to the current completion group (do not cross between uncompleted and completed items), mirroring drag behavior.
- Keep parity with `t`/`b`: do not gate on sort mode; update `position` even if sorted by other columns.
- If movement is not possible (top/bottom boundary or no valid neighbor), no-op.

## Implementation notes
- Add a helper in `ListPanelController` (e.g. `moveFocusedItemByOffset(offset: -1 | 1)`).
- Use `currentSortedItems` to locate the item index and determine the target index.
- Guard when `currentSortState` is not `null`/`position`, or when a timeline field is active.
- Mirror drag reorder semantics:
  - Ensure the adjacent target is in the same completion group.
  - Call `updateListItem(listId, itemId, { position: targetIndex })`.
  - Use `recentUserItemUpdates` like the existing `t`/`b` and drag code.
- Consider extracting the reorder logic used in `ListPanelTableController` into a shared helper if needed.

## Tests
- `ListPanelController` tests:
  - `w`/`s` triggers `updateListItem` with expected position when sorted by position.
  - No action when multiple items are selected.
  - No action when sorted by non-position column or timeline view is active.
  - Boundary behavior at top/bottom of the completion group.

## Open questions
- Should we surface a status hint when the move is blocked at a boundary?
