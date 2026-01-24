# Panel navigation shortcuts

## Summary
Add panel-scoped shortcuts to enter layout and header navigation modes using `Ctrl+P` / `Ctrl+H`, while removing the old Ctrl/Alt/Shift chords.

## Goals
- Make panel navigation mode easy to activate from the active panel with a simple chord.
- Avoid interfering with text entry or modal/dialog focus.
- Support both layout navigation and header panel navigation modes across any panel.

## Non-goals
- Redesigning the panel navigation overlay or layout algorithm.
- Adding user-configurable shortcut bindings.

## Current behavior
- `KeyboardNavigationController` registers:
  - Layout navigation toggle: Ctrl+Shift+Alt+P (non-Mac) / Ctrl+Shift+Cmd+P (Mac).
  - Header navigation toggle: Ctrl+Shift+Alt+H (non-Mac) / Ctrl+Shift+Cmd+H (Mac).
- Navigation mode is global and uses an overlay with arrow-key movement.
- Default shortcuts are documented in `docs/design/panel-layout-ui-spec.md`.

## Proposed behavior
- Replace the existing chorded shortcuts with `Ctrl+P` / `Ctrl+H`:
  - `Ctrl+P` toggles layout navigation.
  - `Ctrl+H` toggles header panel navigation.
- While in a navigation mode, pressing the same shortcut exits; pressing the other switches modes.
- While in layout navigation, allow `A` or `S` for left and `D` for right in addition to arrow keys.
- While in header navigation, allow `A`/`D` (or left/right arrows) to cycle pinned header panels, `Enter` or `↓` to focus the selected header panel and exit nav mode.
- Scope these shortcuts so they only fire when:
  - No dialogs/menus are open (reuse overlay checks similar to Lists panel).
  - The event target is not an editable input/textarea/contenteditable.
  - Otherwise, allow from anywhere in the app (even if no panel is currently active).

## Implementation notes
- Extend `KeyboardNavigationController.registerShortcuts` to register `Ctrl+P` / `Ctrl+H`.
- Remove the existing Ctrl/Alt/Shift bindings to avoid conflicts.
- Add a gating helper (mirroring Lists panel `canHandlePanelShortcuts`) to avoid firing when:
  - Focus is inside inputs or contenteditable nodes.
  - The active panel is not selected/focused.
  - A modal/dialog/context menu is open.
- Use `panelWorkspace.getActivePanelId()` and `panelWorkspace.getPanelFrameElement()` to validate focus.
- Update `docs/design/panel-layout-ui-spec.md` to list the new shortcuts and remove the old chords.

## Tests
- Add tests for `KeyboardNavigationController` to verify:
  - Shortcuts toggle layout/header navigation when active panel is focused.
  - Shortcuts do not fire when the event target is editable.
  - Shortcuts do not fire when no active panel exists.

## Open questions
- Should we expose a UI hint for the new shortcuts (command palette help or panel chrome tooltip)?
