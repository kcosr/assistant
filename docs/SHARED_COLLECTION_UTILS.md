# Shared Collection + Tag Utilities

This guide summarizes the shared UI and tag utilities used by the lists and notes
plugins. Use these to keep collection-style panels consistent.

## Table of Contents

- [Source files](#source-files)
- [Shared UI Controllers (Web Client)](#shared-ui-controllers-web-client)
- [Tag Handling](#tag-handling)
- [Shared List Utilities](#shared-list-utilities)
- [Example: Reusing the Collection Controllers](#example-reusing-the-collection-controllers)
- [When to Use These Helpers](#when-to-use-these-helpers)

## Source files

- `packages/web-client/src/controllers/collectionPanelSearchController.ts`
- `packages/web-client/src/controllers/collectionDropdown.ts`
- `packages/web-client/src/controllers/collectionBrowserController.ts`
- `packages/web-client/src/controllers/collectionPanelBody.ts`
- `packages/shared/src/tags.ts`

## Shared UI Controllers (Web Client)

These live under `packages/web-client/src/controllers/` and can be reused by any
plugin that provides collection lists and item previews.

- `collectionPanelSearchController.ts`
  - Manages the shared search input, tag filter pills, and tag suggestions.
  - Persisted tag filters are stored in localStorage.
- `collectionDropdown.ts`
  - Renders the collection list dropdown + keyboard navigation.
  - Exposes the tag filter controller and tags container.
- `collectionBrowserController.ts`
  - Renders the browser/list view with tag chips and item previews.
  - Handles filtering (text + tags), keyboard navigation, and item focus.
- `collectionPanelBody.ts`
  - Shared layout manager for search + dropdown + browser sections.

### Collection Types

Shared types are defined in `packages/web-client/src/controllers/collectionTypes.ts`:

```ts
type CollectionReference = { type: string; id: string };
type CollectionItemSummary = { type: string; id: string; name: string; tags?: string[]; updatedAt?: string };
```

Any plugin using the shared controllers should provide these shapes for collections
and list items.

## Tag Handling

### Server-side tag normalization

Use `packages/shared/src/tags.ts` in server stores:

- `normalizeTags(tags?: string[])`: lowercases + trims + dedupes.
- `matchesTags({ valueTags, filterTags, tagMatch })`: `all` vs `any` matching.
- `TagMatchMode`: `'all' | 'any'`.

### Web tag colors + chips

Use `packages/web-client/src/utils/tagColors.ts` for consistent tag styling:

- `normalizeTag(tag: string)`: lowercases + trims.
- `applyTagColorToElement(el, tag)`: sets CSS vars for colored tag pills.
- `applyTagColorsInTree(root)`: apply tag colors across a DOM subtree.

## Shared List Utilities

These are commonly reused in list-style views:

- `packages/web-client/src/utils/listSorting.ts`
  - Column sort type + sorting helpers.
- `packages/web-client/src/utils/listColumnPreferences.ts`
  - Per-user column visibility preferences.
- `packages/web-client/src/utils/listColumnVisibility.ts`
  - Column visibility filtering and tag column heuristics.
- `packages/web-client/src/utils/collectionSearchKeyboard.ts`
  - Shared keyboard bindings for search + tag filters.

## Example: Reusing the Collection Controllers

High-level wiring (similar to the lists plugin):

1. Create the shared search + dropdown UI with `CollectionPanelSearchController`.
2. Use `CollectionDropdownController` to load collections and handle selection.
3. Use `CollectionBrowserController` to render preview rows and tags.
4. Route selection into your panel-specific detail view.

The lists plugin (`packages/plugins/official/lists/web/index.ts`) is the reference example.

## When to Use These Helpers

- Use shared controllers when your panel has: a collection list, search, and a browser view.
- Use shared tag utilities whenever you render tag chips or accept tag filters.
- If your panel is a simple single-item view, you likely do not need the collection stack.
