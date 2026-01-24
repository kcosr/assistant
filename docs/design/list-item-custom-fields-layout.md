# Compact layout for list item custom fields

## Summary
Tighten the list item add/edit modal by laying out custom fields in a responsive grid and aligning controls consistently, reducing vertical scrolling while keeping the UI readable.

## Goals
- Reduce vertical space used by custom fields in the list item editor dialog.
- Keep labels and inputs aligned and scannable.
- Preserve existing data/submit behavior and accessibility.

## Non-goals
- Changes to custom field types, validation, or storage.
- Reworking the non-custom-field portions of the dialog.
- Adding new settings or configuration options.

## Current behavior
- Custom fields render as a single-column stack under "Custom fields."
- Each field is a label with the input nested inside, producing tall rows.

## Proposal
- Render the custom fields container as a responsive grid (2 columns on wider dialogs, 1 column on small screens).
- Keep label + input vertically stacked within each field card, but allow fields to sit side-by-side.
- Treat long-form fields (markdown textareas) as full-width rows spanning all columns.
- For checkbox fields, use a more compact inline layout (checkbox and label on one line).

## Layout details
- `.list-item-custom-fields` becomes `display: grid` with `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))`.
- `.list-item-custom-field-row` remains a grid item with a smaller vertical gap.
- Add modifier classes:
  - `.list-item-custom-field-row--wide` for markdown text areas to span all columns.
  - `.list-item-custom-field-row--checkbox` for inline checkbox alignment.
- Collapse to a single column at mobile widths (reuse existing 768px breakpoint).

## Implementation notes
- Update `ListItemEditorDialog.createCustomFieldsSection` to apply row modifier classes based on field type.
- Consider moving checkbox label text outside the input for clean inline alignment, while keeping `label[for]` association.
- Ensure selectors in `listItemEditorDialog.test.ts` still find inputs inside `.list-item-custom-field-row`.

## Tests
- Update or add a UI rendering test to verify:
  - Grid modifier classes are applied by type.
  - Markdown custom fields are marked as full-width.
  - Checkbox rows render inline (input + label).

## Files to update
- `packages/web-client/src/controllers/listItemEditorDialog.ts`
- `packages/plugins/official/lists/web/styles.css`
- `packages/web-client/src/controllers/listItemEditorDialog.test.ts`

## Open questions
- Do we want any other field types to opt into full-width layout beyond markdown text?
