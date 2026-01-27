# Android back button navigation (Capacitor)

## Summary
Handle Android hardware back button presses in Capacitor builds by mirroring existing Escape-key behavior: close the topmost overlay/modal and only fall back to default system behavior when nothing else is open.

## Goals
- Provide intuitive, layered back navigation on Android (close overlays before exiting).
- Reuse existing controller behavior (Escape key handling) where possible.
- Keep behavior consistent across mobile panels (command palette, panel launcher, dialogs, etc.).

## Non-goals
- Redesigning modal/overlay UX or adding new navigation stacks.
- Implementing in-app route history beyond existing panels/overlays.

## Current behavior
- No explicit back button handler; in Capacitor, back either exits the app or does nothing depending on OS defaults.
- Escape key handling is implemented per component:
  - Command palette, panel launcher, session picker, header popover, and modals listen for Escape and close themselves.
  - `KeyboardNavigationController` Escape shortcut cancels active operations and closes the mobile sessions panel.
  - `PanelWorkspaceController` blocks modal Escape when other overlays are open (command palette, panel launcher, session picker, header popover, etc.).

## Proposed behavior
- Register a Capacitor `backButton` listener on Android.
- When pressed, run a handler that closes the topmost open UI in a consistent priority order.
- If nothing is handled, fall back to Capacitor/system default behavior (exit app or history back).

### Priority order (first match wins)
1. Share target modal (`#share-target-modal.visible`)
2. Confirm/text dialogs (`DialogManager`)
3. Command palette (controller or `.command-palette-overlay.open`)
4. Panel launcher (`PanelLauncherController`)
5. Session picker popover (`SessionPickerController`)
6. Header panel popover (`PanelWorkspaceController`)
7. Settings/layout dropdowns (`SettingsDropdownController`)
8. Workspace switcher overlay (`.workspace-switcher-overlay.open`)
9. Context menu (`ContextMenuManager`)
10. Panel modal (`.panel-modal-overlay.open`, close active modal panel)
11. Mobile sidebar sessions panel (mobile viewport + `panelWorkspace.isPanelTypeOpen('sessions')`)
12. Navigation modes (layout/header/split placement)
13. Default: if `canGoBack`, `window.history.back()`; otherwise `App.exitApp()`

## Implementation notes
- Add `setupBackButtonHandler` to `packages/web-client/src/utils/capacitor.ts`:
  - Guard with `isCapacitorAndroid()`.
  - Dynamically import `@capacitor/app` and register `App.addListener('backButton', ...)`.
  - Invoke a provided handler and only fall through when it returns `false`.
  - Use `canGoBack` to decide between `window.history.back()` and `App.exitApp()`.
- Wire `setupBackButtonHandler` in `packages/web-client/src/index.ts` after controllers are initialized so the handler can access:
  - `commandPaletteController`, `panelLauncherController`, `sessionPickerController`
  - `panelWorkspace`, `keyboardNavigationController`, `dialogManager`, `contextMenuManager`
- Add small public helpers where needed:
  - `PanelLauncherController.isOpen()` (or check `launcher.classList.contains('open')`).
  - `SessionPickerController.isOpen()` (or check for `.session-picker-popover`).
  - `KeyboardNavigationController.cancelNavigationModes()` to stop layout/header/split modes.
  - `DialogManager.closeOpenDialog()` to properly close confirm/text dialogs and reset `hasOpenDialog`.
  - `shareTargetController.closeShareModal()` / `isShareModalVisible()` to clear state and hide the modal.
- For panel modals, if a modal overlay is open, close the active modal panel via `panelWorkspace.closePanel(activePanelId)` (modal panel is focused when opened).
- Keep the priority order aligned with `PanelWorkspaceController.isModalEscapeBlocked()` so overlays close before modal panels.
- Update Escape behavior so pinned/modal chat panels close without canceling active chat operations.

## Tests
- Add unit coverage for the back button handler (mock `@capacitor/app` and verify priority order/handled fallback).
- Add tests for `KeyboardNavigationController.cancelNavigationModes()` if introduced.

## Files to update
| File | Change |
| --- | --- |
| `packages/web-client/src/utils/capacitor.ts` | Add `setupBackButtonHandler()` and dynamic import for `@capacitor/app`. |
| `packages/web-client/src/index.ts` | Wire the back button handler after controller setup. |
| `packages/web-client/src/controllers/keyboardNavigationController.ts` | Add `cancelNavigationModes()` (public) for back handling. |
| `packages/web-client/src/controllers/panelLauncherController.ts` | Expose `isOpen()` or similar state check. |
| `packages/web-client/src/controllers/panelSessionPicker.ts` | Expose `isOpen()` or `hasActiveMenu()`. |
| `packages/web-client/src/controllers/dialogManager.ts` | Add `closeOpenDialog()` to close dialogs safely. |
| `packages/web-client/src/controllers/shareTargetController.ts` | Export `closeShareModal()` / `isShareModalVisible()`. |
| `packages/web-client/src/controllers/settingsDropdown.ts` | Expose open/close helpers for back handling. |
| `packages/web-client/src/controllers/contextMenu.ts` | Expose open-state check for back handling. |
| `packages/mobile-web/package.json` | Add `@capacitor/app` dependency. |

## Open questions
- None.
