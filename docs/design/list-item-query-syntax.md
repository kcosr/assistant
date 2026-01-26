# AQL (List Item Query Syntax)

## Status

**Draft** - January 2026

## Summary

Introduce AQL, a lightweight query language for list item search (field filters, boolean logic, order by, and field visibility). Provide a toggle to switch between raw search and AQL with validation feedback. AQL state is stored in panel state (client-local) for now; saved AQL will be server-side later.

## Problem

List search is currently limited to:
- Plain text substring match across title/notes/url/custom field text
- Tag filtering via `@tag` and `!@tag`

There is no way to target specific fields (e.g., `status:ready`, `completed:true`, `priority>=2`), compose boolean logic with parentheses, or express ordering/field visibility via the query itself.

## Goals

- Allow users to filter list items by specific fields with AQL (AND/OR/NOT + parentheses).
- Support `ORDER BY` and field visibility overrides while AQL is active.
- Provide a toggle between raw search and AQL, with validation feedback in AQL mode.
- Keep raw search live-apply behavior; AQL requires explicit apply.
- Store query state per panel instance (client-local), consistent with other list UI state.

## Non-goals

- Server-side or cross-device syncing of queries (deferred).
- Full JQL feature parity (functions, complex type coercion, etc.).
- Cross-list queries or multi-list aggregation.
- Column header filter UI (deferred).
- AQL in browser mode (disabled in v1).

## Proposed Solution

### AQL language (v1)

AQL is a query string with boolean logic, parentheses, and field operators, plus `ORDER BY` and a `SHOW` clause for column visibility overrides.

```
<expr>     := <term> ( (AND | OR) <term> )*
<term>     := NOT <term> | '(' <expr> ')' | <clause>
<clause>   := <field> <op> <value> | <field> IS EMPTY | <field> IS NOT EMPTY
<op>       := : | !: | = | != | > | >= | < | <= | IN
<value>    := quoted | unquoted
<orderBy>  := ORDER BY <field> (ASC|DESC)? ( , <field> (ASC|DESC)? )*
<show>     := SHOW <field> ( , <field> )*
```

Semantics:
- `:` means case-insensitive substring match for text fields.
- `=` / `!=` are exact match for text/select/checkbox values.
- `!:` is shorthand for `NOT <field> : <value>` (not-contains).
- `>`, `>=`, `<`, `<=` apply to number/date/datetime fields.
- `IN` matches membership in a list of values (e.g., `status IN ("ready","blocked")`).
- `IS EMPTY` / `IS NOT EMPTY` are supported for any field.
- Negation uses `NOT` (e.g., `NOT title : "foo"`).
- In AQL mode, the query is structured only (no free-text fallback).

Fields (v1):
- Built-in: `title`, `notes`, `url`, `tag`, `added`, `updated`, `touched`, `completed`, `position`.
- Custom fields: use their label or key directly (e.g., `priority`, `status`), assuming labels are unique; collisions produce validation errors.

Tag behavior:
- In AQL mode, tags are expressed as `tag = "foo"` / `tag IN (...)`.
- `@tag` chips are not used in AQL mode.

### AQL UI/UX

- **Mode toggle** in the search bar to switch between Raw search and AQL.
- **AQL validation** runs on Enter/Apply and displays an inline error message after submission.
- **Apply** (or Enter) is required to run AQL; raw search remains live.
- **AQL is the source of truth** while active:
  - UI sort changes update the `ORDER BY` clause.
  - UI column visibility/order changes update the `SHOW` clause.
  - `SHOW` controls both visibility and the column order while AQL is active.
  - Saved queries can be overwritten with confirmation when saving changes.
- **Browser mode**: AQL is disabled. If AQL mode is selected while in browser view, show a hint and keep the list search in raw mode.
- **Saved queries**:
  - Saved AQL is stored server-side per list + instance.
  - One query can be marked as the default view; it auto-applies when the list opens.

### Filtering flow

Raw search mode:
1. Keep existing behavior (substring match + @tag include/exclude).
2. Live-apply on input.

AQL mode:
1. Parse and validate the AQL string.
2. Apply filters only when the user presses Enter or clicks Apply.
3. Evaluate items with boolean clauses and operator semantics.
4. Apply `ORDER BY` and `SHOW` overrides while the query is active.

### Data locality

- All list view preferences (column visibility/widths, sort, timeline, focus marker) and AQL state live in **panel state**.
- `/preferences` is not used for list UI state (stubs remain for future use).
- Saved AQL queries are stored server-side per list + instance.

### Saved AQL

Saved AQL is stored server-side per list + instance with name + query string, and one query can
be marked as the default view. The list panel loads saved queries on list load.

## Files to Update

- `packages/web-client/src/controllers/listPanelController.ts`
- `packages/web-client/src/controllers/collectionPanelSearchController.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/lists/web/styles.css`
- `packages/shared/src/aql.ts`
- `packages/web-client/src/controllers/listPanelController.test.ts`
- `packages/plugins/official/lists/web/index.test.ts`
- `CHANGELOG.md`
- `docs/` (user-facing docs for AQL)

## Decisions

1. `SHOW` affects both column visibility **and order**.
2. Natural language dates are deferred for v1.
3. Support `!=` and allow `!:` as shorthand for NOT-contains.
4. Saved AQL later is scoped per list + instance.
5. Apply UX: explicit Apply button plus Enter.

## Open questions

None.
