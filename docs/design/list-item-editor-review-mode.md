# List item editor review mode

## Summary
Add a “review” mode to the list item edit dialog that presents item fields as a full-page report with markdown previews, while supporting inline edits per field without leaving the report layout. The default mode is controlled by a settings preference stored in localStorage.

## Goals
- Provide a full-page, report-like view for reviewing list items.
- Render markdown-capable fields (notes + markdown custom fields) as previews.
- Support inline, per-field editing within the review layout.
- Keep the current quick-edit form intact.
- Allow users to set a default edit mode via settings (persisted to localStorage).

## Non-goals
- Changing list item storage, validation, or custom field schemas.
- Adding new list item fields or backend changes.

## Current behavior
- The list item editor dialog is a compact modal with editable inputs for title, URL, notes, tags, pinned, and custom fields.
- Markdown support exists for custom fields (textarea) and notes rendering elsewhere, but the dialog is purely input-oriented.

## Proposal
- Add a two-mode toggle to the list item editor dialog: **Quick edit** (existing form) and **Review** (new report-style layout).
- The review layout is full-page (larger width + height), displaying:
  - Title, URL (as link), tags, pinned state
  - Notes rendered as markdown
  - Custom fields rendered as labeled values, with markdown previews where `markdown: true`
  - Optional metadata block (added/updated/touched/completed) if available on the item
- Provide an **Edit** button next to each field in review mode that toggles that field into an inline editor (input/textarea/select) within the review layout.
- Add a settings preference for the default edit mode (Quick edit vs Review), persisted to localStorage. Do not auto-remember the last-selected mode.

## UX flow
1. User opens Add/Edit Item.
2. Dialog shows the mode toggle and defaults to the user’s configured preference.
3. In Review mode, fields render as labeled display rows with per-field Edit buttons.
4. Clicking an Edit button toggles that field into an inline editor inside the review layout; the dialog Save button persists changes.

## Layout details
- Add a modifier class on the dialog for review mode (e.g. `.list-item-dialog--review`) to expand width/height and apply report-like spacing.
- Add a dedicated container for review content (e.g. `.list-item-review`), with sections:
  - Header (title + URL + tags + pinned)
  - Notes block (markdown)
  - Custom fields grid (label/value cards)
  - Metadata row (optional)
- Use existing `applyMarkdownToElement` for notes and markdown custom fields.
- Represent empty fields with a muted placeholder (e.g. “Not set”).

## Behavior details
- Mode toggle is shown for both add and edit dialogs.
- The dialog buttons remain consistent: Cancel + Save. In Review mode, Save persists any inline edits.
- Inline edit behavior:
  - Title/URL/Notes/Tags/Pinned/Custom fields each get an Edit button.
  - Clicking Edit replaces the display value with the corresponding input control, keeping label context.
  - For markdown fields, show the preview when not editing; switch to a textarea on edit.

## Accessibility
- Ensure the mode toggle is keyboard-focusable and uses `aria-pressed` or `aria-selected` semantics.
- Review sections should remain readable by screen readers (labels tied to values with `aria-labelledby`).

## Files to update
- `packages/web-client/src/controllers/listItemEditorDialog.ts`
- `packages/plugins/official/lists/web/styles.css`
- `packages/web-client/src/controllers/listItemEditorDialog.test.ts`
