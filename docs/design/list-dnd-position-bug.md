# List Drag-and-Drop Position Bug

## Overview

Dragging list items to reorder can jump the item to the wrong spot (often near the top) when completed items exist with low position values.

## Re-assessed root cause

`ListPanelTableController.reorderDraggedItem` calculates the new position from the visual index in `sortedItems`, but `sortedItems` is display order (uncompleted first, completed last). The server treats `position` as an index in the full list order (sorted by position/time) and reflows all items. When completed items have low positions, the visual index no longer matches the server position index.

Relevant code:
- Client: `packages/web-client/src/controllers/listPanelTableController.ts`
- Server: `packages/plugins/official/lists/server/positions.ts`

## Proposed fix

Keep the current "insert after target row" behavior, but compute `newPosition` from the target item's actual `position` value instead of the visual index. Also block in-list reordering when not sorted by position (show a disabled drop indicator) and always insert cross-list drops at position `0` (top). When dragging into a non-position sorted list, show a list-level overlay that reads "Insert at front."

Pseudo-code:

```ts
const draggedPosition = typeof draggedItem.position === 'number' ? draggedItem.position : draggedIndex;
const targetPosition = typeof targetItem.position === 'number' ? targetItem.position : targetIndex;
const newPosition = draggedPosition > targetPosition
  ? targetPosition + 1
  : targetPosition;
```

Use the indices only as a fallback when position is missing. The optimistic UI reorder can remain as-is.

## Test plan

- Add a test that reorders an uncompleted item when completed items have low positions and assert `updateListItem` receives a position derived from `targetItem.position` (not the visual index).
- Add a test for the opposite drag direction to validate the `+1` offset logic.

## Files to update

- `packages/web-client/src/controllers/listPanelTableController.ts`
- `packages/web-client/src/controllers/listPanelTableController.test.ts`
