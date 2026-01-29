# Restore panel selection highlight on mobile

## Summary
Panel selection highlighting is currently suppressed on mobile by plugin-specific CSS overrides (lists and notes). Restore the desktop highlight behavior on mobile by removing those overrides so the global panel-frame styles apply.

## Current behavior
- Global styles (`packages/web-client/public/styles.css`) draw a visible border/outline for `.panel-frame.is-active` and `.panel-frame.is-chat-active`.
- The lists and notes plugins override these styles inside the mobile media query and remove outlines/shadows, effectively hiding the selection highlight on mobile.

## Proposed solution
- Remove the mobile overrides in the lists and notes plugin styles that nullify `.panel-frame.is-active` and related styles.
- Let the global panel-frame styles handle selection highlighting consistently across desktop and mobile.

## Files to update
- `packages/plugins/official/lists/web/styles.css`
- `packages/plugins/official/notes/web/styles.css`

## Decisions
- Use the same full selection highlight on mobile as desktop.
