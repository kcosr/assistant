# Favorites attribute + command palette entry

## Summary

Add a first-class `favorite` boolean on lists and notes (not list items). Expose it in the list/note add+edit dialogs, display a heart icon for favorited items in the collection browser UI, and add a `/favorites` command palette entry that surfaces favorites across lists and notes.

## Goals

- Allow lists and notes to be marked/unmarked as favorites via the add/edit dialogs.
- Persist favorites as explicit metadata (not tags) for lists and notes.
- Show a small heart icon in the browser UI for favorited lists/notes.
- Provide `/favorites` in the command palette to show favorited lists/notes.

## Non-goals

- Favorites for list items.
- Additional keyboard shortcuts for favorites (beyond the add/edit dialogs).
- Changing pin behavior or tag-based filtering.

## Data model

- Lists: add optional `favorite?: boolean` on `ListDefinition` and persist in `lists.json`.
- Notes: add optional `favorite?: boolean` on `NoteMetadata` and persist in note frontmatter.
- Client: include `favorite?: boolean` on list/note summary types and `CollectionItemSummary`.

## UX

- List metadata dialog: add a “Favorite” checkbox (near the existing “Pinned” checkbox).
- Note editor: add a “Favorite” checkbox (near the existing “Pinned” checkbox).
- Collection browser: render a small heart icon before the item title when `favorite` is true.

## Command palette

- Add command option `Favorites` with description “Show favorite notes and lists.”
- Map `/favorites` to a search query token (e.g., `favorite:true`).
- Update lists + notes search providers to treat the `favorite:true` query as a special filter and return only favorited lists/notes.

## Implementation notes

- Lists server
  - Parse `favorite` in `create`/`update` operations.
  - Store/update `favorite` in `ListsStore.createList`/`updateList` (preserve when not provided).
  - Extend list search provider to handle `favorite:true` by returning favorite lists only.
- Notes server
  - Extend `NoteMetadata` to include `favorite`.
  - Update frontmatter parsing/serialization to read/write `favorite`.
  - Accept `favorite` in `write` operation; preserve existing when not provided.
  - Extend note search provider to handle `favorite:true` by returning favorite notes only.
- Web client
  - Add `favorite?: boolean` to list/note summary types and `CollectionItemSummary`.
  - Update list metadata dialog payload/initial data and include a Favorite checkbox.
  - Update note editor save payload to include `favorite`.
  - Add a heart icon to `ICONS` and render in `CollectionBrowserController` when `favorite` is true.
  - Add styles for `.collection-browser-item-favorite` in lists/notes styles.
  - Add `/favorites` command option handling in `CommandPaletteController`.

## Tests

- `packages/web-client/src/controllers/listMetadataDialog.test.ts`: verify favorite checkbox is included in payload.
- `packages/plugins/official/notes/server/store.test.ts`: verify favorite is serialized in frontmatter and preserved on read/write.
- `packages/plugins/official/lists/server/store.test.ts`: verify favorite persists on create/update.
- `packages/web-client/src/controllers/commandPaletteController.test.ts`: verify `/favorites` routes to the favorites query.

## Files to update

- `packages/plugins/official/lists/server/types.ts`
- `packages/plugins/official/lists/server/store.ts`
- `packages/plugins/official/lists/server/index.ts`
- `packages/plugins/official/notes/server/types.ts`
- `packages/plugins/official/notes/server/frontmatter.ts`
- `packages/plugins/official/notes/server/store.ts`
- `packages/plugins/official/notes/server/index.ts`
- `packages/web-client/src/controllers/listMetadataDialog.ts`
- `packages/web-client/src/controllers/listMetadataDialog.test.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/notes/web/index.ts`
- `packages/web-client/src/controllers/collectionTypes.ts`
- `packages/web-client/src/controllers/collectionBrowserController.ts`
- `packages/web-client/src/utils/icons.ts`
- `packages/web-client/src/controllers/commandPaletteController.ts`
- `packages/web-client/src/controllers/commandPaletteController.test.ts`
- `packages/plugins/official/lists/web/styles.css`
- `packages/plugins/official/notes/web/styles.css`
- `packages/plugins/official/lists/README.md`
- `packages/plugins/official/notes/README.md`
- `CHANGELOG.md`

## Open questions

- None.
