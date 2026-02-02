# Cross-List Drag and Drop

## Overview

Enable dragging items from one list panel and dropping them onto another list panel to move items between lists.

## Current State

- **Within-list reordering**: Implemented via pointer/touch drag in `listPanelTableController.ts` (custom, not native HTML5 drag)
- **Move/Copy via menu**: Works via `items-bulk-move` and `items-bulk-copy` API operations
- **Drag payload**: Only `text/plain` item ID when a `DragEvent` exists; no structured multi-item payload
- **Selection**: Multi-select exists, but drag only reorders a single item today

## Design Decisions

| Decision | Choice |
|----------|--------|
| Default action | Move (not copy) |
| Drop position | Insert at dropped position |
| Multi-select drag | Dragging a selected row moves all selected items in visual order |
| Drop on empty/whitespace | Insert at top if empty; append if dropping below rows |
| Native drag fallback | Support `dataTransfer` when present; pointer/touch remains primary |
| Visual feedback | Existing `.drag-over` line indicator |
| Undo support | Not required |

## Implementation Plan

### 1. Track Structured Drag Payload (Pointer + Touch + Optional `dataTransfer`)

**File**: `packages/web-client/src/controllers/listPanelTableController.ts`

- Compute selected item IDs in visual order when drag starts.
- Store payload on the controller (`draggedListId`, `draggedItemIds`) for pointer/touch flows.
- When a `DragEvent` is available, also populate `dataTransfer`:

```typescript
e.dataTransfer.setData('application/x-list-items', JSON.stringify({
  sourceListId: listId,
  itemIds,
}));
```

For single-item drags, also set `application/x-list-item` and keep `text/plain` as a legacy fallback.

### 2. Tag Rows/Tables With List Metadata

Add the following attributes:
- `data-list-id` on the table and tbody
- `data-list-id`, `data-item-index`, `data-item-position` on each row

These allow cross-panel drop resolution without relying on controller state from the target list.

### 3. Resolve Cross-List Drop Targets

- Use `document.elementFromPoint()` to find the target row/list at drag end.
- If a row is targeted, use its index/position as the insert point.
- If dropping onto an empty list or whitespace, use position `0` for empty lists and append for non-empty lists.

### 4. Extend Bulk Move With Positions

**File**: `packages/web-client/src/controllers/listPanelController.ts`

Add `targetPosition` support to `bulkMoveItems` and include `position` in each move op
(`basePosition + index`) to preserve multi-item order on cross-list moves.

### 5. Wire Controller Communication

Expose an `onMoveItemsToList` callback in `ListPanelTableController` and have
`ListPanelController` call `bulkMoveItems` with `targetPosition` and `clearSelection`.

### 6. HTML Drag Fallback

Reuse existing `dragover`/`drop` handlers to parse `dataTransfer` payloads when present,
so native drag operations continue to work if added later.

### 7. Touch Support

Use the same drop-resolution helper for touch end events so cross-list moves work on mobile.

## Files to Modify

| File | Changes |
|------|---------|
| `listPanelTableController.ts` | Track drag payload, resolve cross-list drop targets, add list metadata attributes |
| `listPanelController.ts` | Add `onMoveItemsToList` handler and position-aware bulk move |

## Testing Scenarios

1. Drag single item from List A to List B - item moves to drop position
2. Drag with multi-select - all selected items move in visual order
3. Drag within same list - existing reorder behavior unchanged
4. Drag to empty list - item becomes first item
5. Drag onto list whitespace (below last row) - item appends to end
6. Touch drag between lists on mobile
7. Drag between lists in different panel columns

## API Considerations

✅ **Confirmed**: `items-bulk-move` already supports `position` parameter.

From `packages/plugins/official/lists/server/index.ts:994`:
```typescript
const position = op['position'];
// ...
const moved = await listsStore.moveItem(id, targetListId, position);
```

The operation format is:
```typescript
{
  operations: [
    { id: itemId, targetListId: targetListId, position: targetPosition }
  ]
}
```

For multi-item moves, supply consecutive positions (e.g., `targetPosition`, `targetPosition + 1`, ...).

No additional API work needed.
