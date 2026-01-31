# Global AQL Header Bar

## Status

Draft — January 2026

## Summary

Introduce a **window-level AQL-style query bar** centered in the app header
(top toolbar). The UI should **match the list AQL bar** (icons, layout,
affordances) while targeting **global scope fields** such as tags and
instance/profile. The query acts as a **first-pass filter** for global search
results and any panel content that opts in.

## Goals

- Provide a single, consistent global filter with AQL semantics.
- Match list AQL UX patterns (raw vs AQL toggle, apply, saved queries, errors).
- Target global fields: tags and instance/profile (primary), plus a small set of
  universally available fields.
- Keep per-panel filters (notes/lists/tag chips, AQL in lists) intact and local.
- Store state **per window** and persist across reloads.
- Reuse existing AQL parsing/eval logic where practical to reduce divergence.

## Non-goals

- Replace list AQL or per-panel raw search.
- Provide a full cross-collection query language (JQL-level complexity).
- Implement per-user sync for global queries (local per window only in v1).
- Support `ORDER BY` / `SHOW` in global queries (disallowed in v1).

## UX / UI

### Placement

- Centered input in the **main app header** (top toolbar), between the left
  controls group and right settings/actions.
- On narrow/mobile viewports, collapse to a single icon that opens a modal/popover
  with the full input and controls.

### Controls (match list AQL bar)

- Mode toggle: **Raw** vs **AQL** (mirrors list AQL behavior).
- Apply button (AQL mode only). Enter also applies.
- Clear button to remove the global filter.
- Saved query dropdown + save/delete (same iconography as list AQL).
- Inline error message on parse/validation failure.
- Active-state indicator (subtle pill/border in the header when a query is active).

### Behavior

- Raw mode: live-apply (text-only global filtering).
- AQL mode: **explicit apply only** (Apply button / Enter).
- Parse errors show inline and do **not** update the active global query.
- Clearing an applied AQL query should keep the "press Enter to clear" hint
  consistent with list AQL.
- Active global query is always visible and easy to clear.

## Global AQL Syntax (v1)

Reuse the **AQL grammar** to minimize new language surface area, but restrict
features for the global context (see below).

```
<expr>     := <term> ( (AND | OR) <term> )*
<term>     := NOT <term> | '(' <expr> ')' | <clause>
<clause>   := <field> <op> <value> | <field> IS EMPTY | <field> IS NOT EMPTY
<op>       := : | !: | ~ | !~ | = | != | IN
```

### Allowed features

- Boolean logic: `AND`, `OR`, `NOT`, parentheses.
- Operators: `:`, `!:`, `~`, `!~`, `=`, `!=`, `IN`.
- `IS EMPTY` / `IS NOT EMPTY` for text/boolean fields where it makes sense.

### Disallowed features

- `ORDER BY` and `SHOW` are **errors** in global AQL v1.
- Numeric/date comparison operators (`>`, `>=`, etc.) are not supported.

### Semantics

- `:` / `~` are case-insensitive contains.
- `!:` / `!~` are negated contains.
- `=` / `!=` are exact matches for text/boolean fields.
- `IN` accepts a comma-separated list.

## Fields (v1)

**Primary (requested):**
- `tag` (tag string match; `tags` accepted as an alias for consistency with list AQL)
- `instance` (instance id; `profile` accepted as an alias)

**First phase additions:**
- `favorite` (boolean) — for entities that support favorites.
- `pinned` (boolean) — maps to pinned tag or pinned attribute if available.
- `text` (pseudo-field) — maps to global text search (title/content snippets)
  when supported.

**Out of scope for v1 (possible later):**
- `updated` / `created` — cross-plugin timestamps are inconsistent today.
- `completed` — list item-only field.
- `ORDER BY` / `SHOW`.

## Integration Points

### Global search

- Translate supported clauses into search parameters where possible:
  - `tag` -> `tags[]`
  - `instance` / `profile` -> `instance`
  - `text` -> `q`
- If a clause cannot be translated, apply client-side filtering on aggregated
  results after search.

### Panels

Panels apply the active global query as a **first-pass filter** (no per-panel
scoping). The global query is published via a shared context key:

- Proposed context key: `global.query`
- Payload: parsed AQL AST + raw string + mode + applied state

Panels that already support local search continue to apply **local filters on top
of global** (global first, local second). Panels opt in to avoid forcing behavior
onto plugins that do not understand these fields yet.

### Relationship to global tag scope

If a window already exposes a tag-scope UI, the global AQL should **subsume** it.
Recommended approach:

1. Keep tag-scope UI, but derive its state from the global AQL when the query is
   limited to `tag` / `instance` clauses.
2. Global AQL is higher precedence. Tag-scope changes update the global query.

## Data Model

```ts
GlobalQueryState = {
  mode: 'raw' | 'aql',
  rawText: string,
  aqlText: string,
  appliedAql: string | null,
  parsed?: GlobalAqlQuery | null,
  lastValidAql?: string | null,
  savedQueries?: Array<{ id: string; name: string; query: string }>,
  selectedSavedQueryId?: string | null,
}
```

Persist per window (same strategy as other window-scoped UI state).

## Save / Load

- Saved queries are stored locally (per window) alongside other UI state.
- Selecting a saved query loads it into the input and applies it immediately.
- Save overwrites an existing selection or creates a new named query.
- Delete removes the saved query but does not clear the current input.

## Parsing + Validation Strategy

- Reuse the shared AQL parser but **restrict allowed fields** and features for
  global scope.
- Approach options:
  1. Add a new parse option to override the builtin field list (preferred).
  2. Parse normally, then **validate** the compiled AST against an allowlist of
     fields/operators and reject `ORDER BY`/`SHOW`.

## Validation and Error Handling

- Parse errors show inline in header (similar to list AQL error banner).
- Partial/invalid input does **not** change the active global scope.
- Switching modes preserves inputs but only one mode is active at a time.

## Files to Update

- `packages/web-client/public/index.html` (header markup for the global bar)
- `packages/web-client/public/styles.css` (header bar styling, responsive collapse)
- `packages/web-client/src/index.ts` (wire up controller + context publish)
- `packages/web-client/src/controllers/globalAqlHeaderController.ts` (new)
- `packages/web-client/src/utils/globalQueryStore.ts` (new window-scoped storage)
- `packages/shared/src/aql.ts` (parser options or allowlist support)
- `packages/web-client/src/controllers/globalAqlHeaderController.test.ts`
- `packages/shared/src/aql.test.ts` (parser allowlist / invalid feature tests)
- `docs/AQL.md` (user-facing global AQL docs)
- `CHANGELOG.md`

## Decisions

1. Raw mode supports `@tag` / `!@tag` shortcuts using the existing tag dropdown
   behavior.
2. Add a global shortcut to focus the header bar, default binding: `Ctrl+G`.
3. `instance` accepts multiple IDs (e.g., `instance IN (...)`) since AQL already
   supports `IN`.
4. Panels opting in for v1: lists, notes, and collection browser.
5. For `favorite` / `pinned`, unsupported entities are treated as
   **non-matching** for those clauses.

## Open Questions

None.
