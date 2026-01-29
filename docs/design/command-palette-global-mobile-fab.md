# Global command palette mobile FAB

## Summary
The mobile quick-search FAB currently exists only in the lists panel. Make a global floating command palette button that is always available on mobile, regardless of the active panel, and remove the lists-specific search FAB to avoid duplication.

## Current behavior
- Lists panel renders a floating search FAB (`.lists-fab-search`) on mobile and in Capacitor when an active list is selected.
- The FAB opens the command palette and is positioned bottom-right.
- Other panels do not show a comparable global search affordance.

## Proposed solution
- Add a global command palette FAB at the app shell level.
- Show it on mobile/narrow viewports and Capacitor Android, independent of the current panel.
- Wire it to the existing command palette open behavior.
- Remove the lists-specific search FAB and related visibility logic/tests.
- The global FAB is offset upward by default so the lists add button can occupy the primary bottom-right position.

### UI/behavior details
- Element: `<button id="command-palette-fab" class="command-palette-fab" ...>` in `packages/web-client/public/index.html`.
- Styling: reuse the lists FAB styling (size, color, shadow) but move to global `packages/web-client/public/styles.css`.
- Visibility: toggle based on viewport size or `isMobileViewport()`; hide when the command palette overlay is open.
- Position: fixed bottom-right with `--capacitor-nav-bar-height` offset.

### Implementation notes
- Add a small controller in `packages/web-client/src/index.ts` to:
  - Show/hide the FAB on resize.
  - Attach click to the same handler used by the toolbar command palette button.
- Remove `lists-fab-search` from the lists panel template and related logic in `packages/plugins/official/lists/web/index.ts`.
- Remove `lists-fab-search` styles and tests from the lists plugin.
- Keep the global FAB offset by default via CSS.

## Files to update
- `packages/web-client/public/index.html`
- `packages/web-client/public/styles.css`
- `packages/web-client/src/index.ts`
- `packages/plugins/official/lists/web/index.ts`
- `packages/plugins/official/lists/web/styles.css`
- `packages/plugins/official/lists/web/index.test.ts`

## Decisions
- Show the global FAB whenever `isMobileViewport()` is true or the app is running in Capacitor Android.
- Position matches the existing lists search FAB (bottom-right overlay).
