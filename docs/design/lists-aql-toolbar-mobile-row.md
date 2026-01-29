# Lists AQL toolbar mobile row

## Summary
On narrow/mobile viewports, the lists AQL toolbar competes with the search input in the shared search row, shrinking the input to unusable width. Stack the AQL toolbar on its own row on mobile so the search input stays full width while keeping the rest of the layout intact.

## Current behavior
- The lists panel injects AQL controls into the shared search bar as left controls (`.collection-search-row-left`).
- The shared search row is a flex container with wrapping, so on narrow widths the left controls and right controls squeeze the center search input.
- Result: the search input can collapse to ~1 character wide when AQL is enabled.

## Proposed solution
- Apply a mobile-only layout for the lists search row to put the left controls (AQL toolbar) on a separate row.
- Keep the search input and right controls on the first row, so the input can expand to full width.
- Ensure the AQL toolbar continues to wrap within its own row.

### Layout approach (CSS only)
- In `packages/plugins/official/lists/web/styles.css` under the mobile media query, override the search row to a two-row grid or reordered flex:
  - Row 1: center (search input) + right controls.
  - Row 2: left controls (AQL toolbar) spanning full width.
- Example grid approach:
  - `.lists-panel .collection-panel-search-row { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "center right" "left left"; row-gap: var(--spacing-xs); }`
  - `.lists-panel .collection-search-row-left { grid-area: left; }`
  - `.lists-panel .collection-search-row-center { grid-area: center; min-width: 0; }`
  - `.lists-panel .collection-search-row-right { grid-area: right; }`
- Alternatively, use flex ordering + `flex-basis: 100%` for the left controls in the mobile media query.

## Files to update
- `packages/plugins/official/lists/web/styles.css`

## Decisions
- Keep right controls on row 1 with the search input.
- Apply the stacked layout only to the lists panel.
