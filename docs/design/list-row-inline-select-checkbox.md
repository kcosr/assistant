# Inline editing for select/checkbox custom fields in list rows

## Summary
Allow list rows to render editable controls for `select` and `checkbox` custom fields so users can change values without opening the edit dialog. Gate the behavior behind a global settings toggle (default on).

## Goals
- Inline edit `select` and `checkbox` custom fields directly in the list table.
- Preserve row selection, drag, and double-click behaviors.
- Use the same update semantics as the edit dialog (send `null` to clear values).

## Non-goals
- Inline editing for text, number, date, time, or datetime fields.
- Bulk editing or multi-row editing UI.
- Changing sorting/search behavior.

## Current behavior
- `ListPanelTableController` renders custom fields as plain text via `formatCustomFieldValue`.
- Editing custom fields requires opening the list item editor dialog.

## Proposed UI
- For `checkbox` fields: render a checkbox input in the cell.
- For `select` fields: render a select dropdown with a placeholder ("Select…") and options from the field definition.
- Reuse existing form classes (`list-item-form-checkbox`, `list-item-form-select`) and add a small inline modifier class if needed for sizing in table cells.
- Add a global settings checkbox near the other list options to toggle inline editing (default enabled).

## Data/update behavior
- On change, call `updateListItem(listId, itemId, { customFields: { [key]: valueOrNull } })`.
  - Checkbox unchecked -> `null`.
  - Select empty -> `null`.
- Optionally guard against double-submit by disabling the control while the update is in flight.
- Rely on the existing list update broadcast to re-render rows and sort/order if needed.

## Rendering changes
- Update `ListPanelTableController.buildItemRow` to branch on `field.type`:
  - `checkbox`: render `<input type="checkbox">` with current value.
  - `select`: render `<select>` with options and current value.
  - Fallback to existing text rendering for other types.
- Ensure inline controls do not trigger row selection or double-click edit:
  - `shouldIgnoreRowSelection` already ignores inputs/selects; add `stopPropagation()` on control clicks if needed.

## Styles
- Add table-cell friendly styles for inline controls (e.g., full-width select, reduced padding for checkbox) in `packages/plugins/official/lists/web/styles.css`.
- If inline styling differs from dialog styling, introduce modifier classes like `.list-item-inline-select`/`.list-item-inline-checkbox`.

## Tests
- Add `ListPanelTableController` tests to assert:
  - Checkbox and select fields render interactive controls.
  - Changes call `updateListItem` with correct `customFields` payload (including `null` for clear).
- Add a regression test ensuring inline control interaction does not toggle row selection.

## Open questions
- Should inline editing be disabled for completed items or still allowed with muted styling?
- Do we need optimistic UI rollback if `updateListItem` returns `false`?
