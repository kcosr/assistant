# Global Tag Scope (Per-Window)

## Summary

Add a per-window global tag scope that limits which notes, lists, and list items
are visible in panels and global search. The scope supports include/exclude tags,
optionally includes lists with matching items, and can include untagged items
when include tags are set.

## Goals

- Provide a top-level, per-window tag filter that applies to notes, lists,
  list items, and global search.
- Support include + exclude tag lists.
- Allow lists to appear if any items match the scope (even if the list itself
  does not), when enabled.
- Allow untagged items to appear when include tags are set, when enabled.
- Ensure newly created notes, lists, and list items inherit included tags.

## Non-Goals

- Replace per-panel tag filters or AQL.
- Create a shared, cross-window global tag state (scope is per window).
- Provide a tags metadata system (see `docs/design/tags-plugin.md`).

## UX

Entry point: Settings dropdown → "Global tag scope…" dialog.

Dialog controls:
- Include tags (chips input)
- Exclude tags (chips input)
- Include lists with matching items (checkbox)
- Include untagged items (checkbox)

Copy:
"Applies to panels and search in this window. Included tags are added to new
notes, lists, and list items."

## Data Model

`GlobalTagScope` (client):

- `include: string[]`
- `exclude: string[]`
- `includeListsWithMatchingItems: boolean`
- `includeUntagged: boolean`

Persisted in `localStorage` using a window-scoped key:
`assistant:global-tag-scope:<windowId>`

Shared to panels via context:
`global.tagScope`

## Behavior

### Matching rules

When `include` is non-empty:
- Items must include all `include` tags.
- If `includeUntagged` is true, untagged items also pass the include test.

When `exclude` is non-empty:
- Any matching excluded tag hides the item.

### Lists

Lists are matched by list tags first. If a list does not match:
- If `includeListsWithMatchingItems` is true, the list may still appear if any
  list items match the global scope.
- List tags are treated as implicit tags for list items when applying the global
  scope inside the list panel.

### Notes

Notes are filtered by the global scope (tags only).

### List items

List items are filtered by the global scope before local filters and AQL.
List tags are treated as implicit tags for list items when applying the global
scope.

### Search

Global search includes `tags`, `excludeTags`, and `includeUntagged` when the
window scope is set. This is server-enforced by search providers.

### Defaults on create

When the scope includes tags, new notes, lists, and list items inherit the
`include` tags.

## Implementation Notes

- Client state stored in `packages/web-client/src/utils/globalTagScope.ts`.
- Global scope matching logic in
  `packages/web-client/src/utils/globalTagScopeFilter.ts`.
- Global scope dialog in
  `packages/web-client/src/controllers/globalTagScopeDialog.ts`.
- Lists/notes panels subscribe to `global.tagScope` and refresh on change.
- Lists support list-level fallback from item matches when enabled.
- Search service and providers accept `includeUntagged` when tags are present.

## Test Coverage

- Collection dropdown filter respects global scope and overrides.
- List panel filtering applies global scope even without local filters.
- List panel filtering includes untagged items when enabled.

## Open Questions

- Should `includeUntagged` apply when no include tags are set?
  (Current behavior: no; it only relaxes include-tag matching.)
- Should untagged lists be shown when include tags are set and
  `includeUntagged` is enabled? (Current behavior: list matches are tag-based;
  the toggle is about items.)
