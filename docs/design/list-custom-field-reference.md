# Reference custom field type

## Summary
Add a new list custom field type (`ref`) that stores a reference to another panel item (notes, lists). Provide a picker UI to select targets, render the value as a clickable link, and support inline edit in list rows.

## Goals
- Introduce a `ref` custom field type in list metadata.
- Allow assigning a reference via a picker in the list item editor.
- Render references in the list table as a label + link that opens the target panel/item.
- Support inline edit (assign/clear) from the list view when inline editing is enabled.
- Define a stable reference shape for storing the target in `customFields`.

## Non-goals
- Multi-value references (arrays) or relationship graphs.
- Cross-workspace/remote references.
- Automatic back-links or referential integrity enforcement.
- Full-text search over target content (only labels/IDs).

## Current behavior
- Custom fields support only primitive types (text/number/date/time/datetime/select/checkbox).
- List item editor renders inputs based on field type; list table renders text/markdown or inline select/checkbox.
- No way to link a list item to a note or list with navigation UI.

## Proposal

### Data model
- Extend `ListCustomFieldType` with `ref`.
- Reference values are stored as **objects** in `ListItem.customFields`:
  ```ts
  type ListItemPanelReference = {
    kind: 'panel';
    panelType: string; // e.g. "notes", "lists"
    id: string; // note title or list id
    instanceId?: string; // defaults to active instance if omitted
    label?: string; // resolved display label (optional cache)
  };
  ```
- Provide helpers to `parseReference(value)` (type guard + normalization) and `formatReference(ref)` (display label).

### UI changes

**List metadata dialog**
- Add `Reference` to the type dropdown.
- v1 has no target restrictions; references can target notes/lists.

**List item editor dialog**
- For `ref` fields, replace the text input with:
  - A compact read-only display of the selected target (label + type badge).
  - “Select” button to open a reference picker.
  - “Clear” button to remove the reference.
- (Optional) Provide an “Advanced” view to edit the raw object as JSON.

**List view (table)**
- Render `ref` values as a pill/link:
  - Primary click opens the referenced panel/item in a modal panel.
  - Secondary “edit” icon opens the picker (clear/edit).
- Inline edit should update `customFields` with the reference object (or `null` to clear).

### Reference picker
- Reuse `CollectionBrowserController` inside a dialog for note/list selection.
- Selection returns a `ListItemPanelReference` object.

### Navigation
- Use modal panels for navigation when clicking a reference in the list view.
- Expose `openModalPanel` on `PanelHost` (wiring through to `PanelWorkspaceController.openModalPanel`).
- After opening/activating the modal panel, send an event to focus the referenced item:
  - Notes: `notes_show` with `{ title, instance_id }`
  - Lists (list itself): `lists_show` with `{ listId, instance_id }`
- If the target panel is already open, activate it before sending the event.

### Sorting + visibility + search
- Treat `ref` as text for sorting/visibility checks.
- For display/search/sort, prefer the resolved label; fallback to panelType/id.
- AQL (if enabled) treats `ref` fields as text (`:` / `=` match against label or id).

## Broken references
- References are soft pointers with no automatic lifecycle updates.
- If the target cannot be resolved at render time, show a broken state (e.g., “Missing” badge) and keep the stored object intact.
- Provide actions to relink (picker) or clear the reference.
- Notes are keyed by title today, so renames will break references; list ids are stable but instance moves can break.

## Implementation notes
- Add `ref` to `normalizeListCustomFields` and to `ListCustomFieldType` unions (web + server).
- Extend `formatCustomFieldValue` and list rendering to parse/format reference values.
- Provide a small reference resolution cache (id → label) using existing collection data.

## Tests
- List metadata dialog: `Reference` type persists in payload.
- List item editor: selecting a reference stores the encoded value; clearing sends `null`.
- List table: renders a link and invokes navigation handler.
- Inline edit: picker updates custom field value and disables during async save.

## Files to update
- `packages/plugins/official/lists/server/types.ts`
- `packages/web-client/src/controllers/listCustomFields.ts`
- `packages/web-client/src/controllers/listMetadataDialog.ts`
- `packages/web-client/src/controllers/listItemEditorDialog.ts`
- `packages/web-client/src/controllers/listPanelTableController.ts`
- `packages/web-client/src/utils/listColumnVisibility.ts`
- `packages/web-client/src/utils/listSorting.ts`
- `packages/shared/src/aql.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/lists/web/styles.css`

## Open questions
None.
