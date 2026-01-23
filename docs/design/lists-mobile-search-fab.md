# Lists mobile search quick access button

## Summary
Add a floating search action to the lists panel on mobile/narrow viewports. The search button sits at the bottom-right (same styling as the existing add FAB), while the add (+) button moves up to make room. Tapping search focuses the shared search input.

## Goals
- Provide a one-tap search affordance on mobile/narrow screens for list items.
- Preserve existing add FAB behavior while repositioning it above the new search button.
- Reuse existing styles and icon conventions for a consistent look.

## Non-goals
- Changing search logic or filtering behavior.
- Adding new search commands or global search features.
- Desktop layout changes.

## Current behavior
- Lists panel renders a single floating add button (`.lists-fab-add`) that appears only in list mode when an active list is selected and the viewport is mobile/capacitor.
- Search is available via the shared search bar or the `f` keyboard shortcut.

## Proposed UI
- Add a second floating action button (FAB) for search:
  - Same size, colors, and hover/active styling as the add FAB.
  - Uses a magnifying glass icon (new `ICONS.search` entry or a local SVG).
  - Positioned at the current add FAB location (bottom-right).
- Move the add FAB upward by a fixed vertical offset (e.g., button size + gap) so both buttons stack vertically.

## Behavior
- Search FAB is visible under the same conditions as the add FAB:
  - `mode === 'list'`, `activeListId` set, and `(isCapacitor || isMobileViewport)`.
- Clicking the search FAB calls `sharedSearchController.focus(true)`.
- Clicking the add FAB continues to open the add item dialog.

## Implementation notes
- Template: add a new button (e.g., `data-role="lists-fab-search"`) alongside `lists-fab-add`.
- Mount: set icon via `ICONS.search` and wire click handler to focus the shared search input.
- Visibility logic: replace `updateFabVisibility` with a shared helper that toggles both FABs together.
- Styles: introduce `.lists-fab-search` with the same base styles as `.lists-fab-add` and add a modifier for the add button to offset it upward.
  - Example: `.lists-fab-add { bottom: calc(var(--spacing-lg) + var(--capacitor-nav-bar-height, 0px) + var(--lists-fab-stack-offset, 64px)); }`
  - `.lists-fab-search { bottom: calc(var(--spacing-lg) + var(--capacitor-nav-bar-height, 0px)); }`
  - Keep `position: fixed` inside the mobile media query to avoid scroll clipping.

## Tests
- Add a lists panel web test that clicking the search FAB focuses the shared search input.

## Open questions
- Should the search FAB appear in browser mode (for list search), or stay list-only for list-item search?
