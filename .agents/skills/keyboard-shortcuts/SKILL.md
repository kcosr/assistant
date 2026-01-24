---
name: keyboard-shortcuts
description: How keyboard shortcuts are wired globally and per-panel in this repo.
---

# Keyboard Shortcuts

## Global shortcuts (app-level)
- Register with `KeyboardNavigationController` via `KeyboardShortcutRegistry`.
- Registry attaches a single `document` `keydown` listener (capture phase) and dispatches by key.
- Handlers should guard on:
  - `isKeyboardShortcutsEnabled()`
  - `dialogManager.hasOpenDialog === false`
  - not inside inputs/contenteditable (use `isEditableTarget` pattern)
- Examples: panel navigation (Ctrl+P / Ctrl+H), command palette (Cmd/Ctrl+K), panel cycling.

## Panel/plugin shortcuts (panel-scoped)
- There is no shared panel shortcut registry yet.
- Each panel/plugin typically attaches a `document.addEventListener('keydown', ..., true)` and uses local gating.
- Common gating checks (see lists/notes plugins):
  - panel visible
  - no dialogs/overlays (`hasBlockingOverlay` style checks)
  - panel selected (via `panel.active` context) or the target is inside a panel modal/popover
  - not editable targets (inputs/textareas/contenteditable)
  - no open context menus or dropdowns
- When a panel handles an event, call `preventDefault()` and `stopPropagation()`.

## Panel focus awareness
- Panels subscribe to `panel.active` context and cache `isPanelSelected`.
- This is the de-facto signal for whether panel shortcuts should run.

## Other global listeners to be aware of
- `CommandPaletteController` attaches a `keydown` listener while open and consumes keys like Escape.
- `PanelWorkspaceController` listens for Escape to close modal panels, but blocks when certain overlays are open.

## When adding new shortcuts
- Prefer global shortcuts for true app-level actions.
- For panel behavior, follow the panel keydown gating pattern used in lists/notes.
- Avoid stealing keys from text inputs; always check editable targets.
