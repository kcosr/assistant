# Command Palette Sort/Group Modes

## Summary
Add configurable sort/group modes to command palette search results (for example, list items first), with a small control in the palette header and persisted preferences.

## Goals
- Let users change how search results are ordered and grouped.
- Support an "items first" mode for list items vs list titles/notes.
- Persist the chosen mode using existing preference storage.
- Keep the default behavior unchanged unless a user opts in.

## Non-goals
- Changing server-side search ranking algorithms.
- Adding new search result metadata fields in plugin providers (unless required to classify items reliably).
- Reworking the palette layout or keyboard navigation.

## Current Behavior
- Search results are returned by `/api/search` and already sorted by score (server-side) when available.
- `CommandPaletteController` renders results in the order received.
- No UI control exists to reorder or group results.

## Proposed Change
### UI
- Add a compact sort/group control in the command palette header next to the close button.
- Suggested UI: a small icon button that opens a menu with:
  - **Sort**: `Relevance` (default), `Items first`, `Plugin A-Z`
  - **Group**: `None` (default), `By plugin`, `By result type`
- Show/enable the control when the palette is displaying search results (global/query modes), including `/pinned`, tag-based searches, and empty-query title-only results (scope/profile selected with no query text).

### Result Classification
Introduce a lightweight client-side classifier to label each result:
- **List item**: `result.launch.panelType === 'lists'` and `payload.itemId` present.
- **List**: `result.launch.panelType === 'lists'` and `payload.itemId` absent.
- **Note**: `result.launch.panelType === 'notes'`.
- **Other**: everything else.

This enables "items first" sorting and "by result type" grouping without new API fields.

### Sorting/Grouping Behavior
- **Relevance**: keep server ordering (current behavior).
- **Items first**: stable partition by result type, with list items first, then lists, notes, and other results. Maintain server ordering within each partition.
- **Group by plugin**: insert small section headers for each `pluginId` (respecting the current sort mode within each group).
- **Group by result type**: insert section headers for `List items`, `Lists`, `Notes`, `Other`.

Within groups, preserve the active sort mode and keep the server order inside each partition (stable ordering). For example, with Items first, the items partition keeps the server-provided order rather than re-sorting by title.

### Persistence
Use the same storage mechanism as "insert new list items at the top": localStorage.

Suggested keys:
- `aiAssistantCommandPaletteSortMode`: `relevance | items | plugin`
- `aiAssistantCommandPaletteGroupMode`: `none | plugin | type`

## Implementation Notes
- Add UI elements in `packages/web-client/public/index.html` for the header button.
- Extend `CommandPaletteController` to:
  - Load persisted sort/group modes on attach/open.
  - Reorder results before rendering using the classifier.
  - Render optional group headers in the results list.
- Add menu handling (similar to the existing action menu) to update modes and re-render.
- Add CSS for the new header button and group headers in `packages/web-client/public/styles.css`.
- Add tests for:
  - Result classification and ordering.
  - Group header rendering.
  - Preference persistence (localStorage or preferences client).

## Open Questions
None.
