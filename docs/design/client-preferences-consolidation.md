# Client preferences consolidation

## Summary
Consolidate per-device UI preferences that are currently split across localStorage helpers into the shared `clientPreferences` abstraction, so shortcuts and other UI toggles are managed consistently.

## Goals
- Centralize per-device preferences in `clientPreferences`.
- Reduce duplicated localStorage key handling spread across controllers.
- Make it easier to expose settings in a unified UI later.

## Non-goals
- Migrating server-backed plugin settings.
- Changing preference semantics or defaults beyond moving storage.

## Current drift
- Some preferences are stored in `clientPreferences` (e.g., keyboard shortcuts enabled).
- Others use one-off localStorage helpers (theme, panel layout, command palette sort/group, list/browser view/sort modes, tag colors, etc.).

## Proposed approach
- Extend `clientPreferences` with additional getters/setters for all per-device UI prefs currently stored in one-off helpers.
- Keep existing helper modules but have them call into `clientPreferences` (or inline directly) to eliminate drift.
- Migrate comprehensively in one pass to avoid leaving standalone stores.

## Migration plan
1. Add preference keys + helpers in `clientPreferences` for shortcuts bindings (new) and all existing per-device prefs.
2. Update consumers to read/write through `clientPreferences`.
3. Remove or slim standalone localStorage helpers once they delegate to `clientPreferences`.

## Files to update
- `packages/web-client/src/index.ts`
- `packages/web-client/src/utils/clientPreferences.ts`
- `packages/web-client/src/utils/themeManager.ts`
- `packages/web-client/src/utils/panelLayoutStore.ts`
- `packages/web-client/src/controllers/commandPaletteController.ts`
- `packages/web-client/src/controllers/collectionBrowserController.ts`
- `packages/web-client/src/utils/tagColors.ts`
- `packages/web-client/src/controllers/listPanelController.ts`
- `packages/web-client/src/controllers/listPanelTableController.ts`
- `packages/web-client/src/controllers/agentSidebarController.ts`
- `packages/web-client/src/controllers/speechAudioController.ts`
- `packages/web-client/src/controllers/panelWorkspaceController.ts`
- `packages/web-client/src/controllers/panelHostController.ts`

## Open questions
- Are there any per-device preferences not listed above that also need consolidation into `clientPreferences`?
