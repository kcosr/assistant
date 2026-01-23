# Custom field markdown rendering

## Summary
Add an optional `markdown` flag on text custom fields. When enabled, list rows render that field as markdown and show the same overflow preview popup used by notes.

## Goals
- Let list creators mark text custom fields as markdown-capable.
- Render markdown in list rows for those fields.
- Reuse the existing notes overflow popup behavior.

## Non-goals
- No new markdown editing UI beyond the existing text inputs.
- No changes to sorting/search semantics for custom fields.

## Data model
- Extend `ListCustomFieldDefinition` with optional `markdown?: boolean`.
- Persist this flag in list metadata (server store already passes through custom fields).
- Parse/normalize the flag in the lists web client.

## UI changes
- In the list metadata dialog, show a "Render as markdown" checkbox when `type === 'text'`.
- Hide/disable the checkbox for non-text types. When type changes away from text, clear the flag.

## Rendering changes
- In `ListPanelTableController`, detect `field.type === 'text' && field.markdown === true`.
- Render markdown using `applyMarkdownToElement` in the cell (similar to notes).
- Reuse the notes overflow logic (fade + hover trigger + popup) with the same popup UI.
- Keep `formatCustomFieldValue` for search indexing/visibility decisions (use raw text).

## Styles
- Add styles for the markdown checkbox row in list metadata dialog.
- If new classes are introduced for custom markdown cells, extend the existing notes styles to cover them; otherwise reuse the notes classes directly.

## Tests
- Update list metadata dialog tests to assert markdown flag persists in `customFields` payload.
- Add a list panel table test verifying markdown rendering in a custom text field (e.g., heading becomes `<h1>`).

## Open questions
- Should the markdown checkbox be exposed for multi-line text fields only (if we add them later)?
