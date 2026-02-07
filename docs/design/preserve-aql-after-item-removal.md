# Preserve active AQL filter after item removal refresh

## Overview
When a list has an active AQL filter and an item is removed, the list panel refreshes and incorrectly snaps back to the default saved AQL query.

Root cause: the list panel calls `setMode('list')` during reload, and `setMode` always reapplies the default saved query whenever one exists, even when already in list mode.

## Motivation
- Keep user-selected AQL context stable during item updates/removals.
- Prevent surprising query changes after delete/edit actions.
- Match expected behavior: active filter remains active unless the user changes it.

## Proposed Solution
1. Update list-mode transition logic so default saved AQL is only auto-applied when entering list mode from browser (or initial list open), not on in-place list refreshes while already in list mode.
2. Preserve current `aqlQueryText`/`aqlAppliedQueryText` during same-mode refreshes.
3. Keep existing behavior for switching between lists, where the target list’s default query may initialize list state.
4. Add regression test coverage for delete-triggered refresh with active AQL + default saved query.

## Implementation Steps
1. In `packages/plugins/official/lists/web/index.ts`:
   - Capture previous mode in `setMode`.
   - Gate default-query auto-apply logic so it does not run when `previousMode === 'list'`.
2. Add test in `packages/plugins/official/lists/web/index.test.ts`:
   - Start in list mode with active non-default AQL.
   - Simulate item removal refresh path.
   - Assert current AQL remains unchanged and is not replaced by default query.

## Alternatives Considered
- Reapply active query after each refresh (more state churn, unnecessary complexity).
- Disable default-query auto-apply entirely (would regress initial list-open UX).

## Out of Scope
- Any changes to AQL parser/query semantics.
- Changes to saved-query CRUD or default-query selection behavior.

## Files to Update
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/lists/web/index.test.ts`

## Open Questions
- None.
