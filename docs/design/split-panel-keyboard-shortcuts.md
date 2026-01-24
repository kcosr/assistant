# Split panel keyboard shortcuts

## Summary
Introduce a keyboard shortcut (`Ctrl + S`) to split the active panel by selecting a placement (top/bottom/left/right) with the existing drag-style highlight overlay, then insert an empty placeholder panel in that region.

## Context
- Panel splitting exists in the panel menu under “Split with new panel...”.
- Dragging a panel shows a dock overlay highlight based on the drop region.
- `Ctrl + S` is currently bound to focus the sidebar and will be reassigned.

## Proposed UX
- `Ctrl + S` enters **split placement mode** for the active panel. If there is no active panel, do nothing.
- An overlay appears on the active panel, using the existing drag highlight style to show the region.
- Default region is **bottom**.
- Keys:
  - Arrow keys or `W/A/S/D` change the target region.
  - `Enter` confirms and inserts an empty placeholder panel in that region.
  - `Esc` cancels and removes the overlay.

## Implementation sketch
- Add a new split-placement state to `KeyboardNavigationController` similar to layout/header navigation modes.
- Register `Ctrl + S` in `registerShortcuts()` and remove the existing focus-sidebar binding.
- Reuse `computeHighlightRect()` and overlay styling from panel drag, or add a small helper in `PanelWorkspaceController` to create/manage a split overlay for keyboard usage.
- On confirm, call `panelWorkspace.openPanel('empty', { placement: { region }, targetPanelId, focus: true })`.
- Ensure the mode is gated by `isKeyboardShortcutsEnabled`, no open dialogs, and not inside terminal/editor inputs.

## Files to update
- `packages/web-client/src/controllers/keyboardNavigationController.ts`
- `packages/web-client/src/controllers/keyboardNavigationController.test.ts`
- `docs/design/panel-layout-ui-spec.md`
- `docs/UI_SPEC.md`
