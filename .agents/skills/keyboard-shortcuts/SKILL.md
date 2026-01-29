---
name: keyboard-shortcuts
description: How keyboard shortcuts are wired globally and per-panel in this repo.
---

# Keyboard Shortcuts

## Overview (registry + services)
- Registry implementation: `packages/web-client/src/utils/keyboardShortcuts.ts`.
- Registry is created in `packages/web-client/src/index.ts` and wired with:
  - `isEnabled()` (respects the keyboard shortcuts preference + open dialogs)
  - `getActivePanel()` (for scope resolution)
  - binding overrides (from local storage via `clientPreferences`)
- Core panel services expose `services.keyboardShortcuts.register(...)` so plugins can register panel-scoped shortcuts.

## Global shortcuts (app-level)
- Register in `KeyboardNavigationController` via `KeyboardShortcutRegistry.register(...)`.
- Registry attaches a single `document` `keydown` listener (capture phase) and dispatches by key.
- Handlers should still guard on editable targets (e.g., `isEditableTarget` pattern in `KeyboardNavigationController`).
- Examples: panel navigation (Ctrl+P / Ctrl+H), command palette (Cmd/Ctrl+K), panel cycling.
- Split placement uses `Ctrl+S` (see `split-panel` shortcut in `KeyboardNavigationController`).

## Focus history shortcuts
- Focus history is tracked in `PanelWorkspaceController` and persisted in local storage (`aiAssistantPanelFocusHistory`).
- `Ctrl+A/C/D/F/L/N/T` focus the last-used artifacts/chat/diff/files/lists/notes/time-tracker panel.
- If none exist, the shortcut opens a modal panel of that type.

## Panel/plugin shortcuts (panel-scoped)
- Use `services.keyboardShortcuts.register(...)` from the panel module (see lists/notes/time-tracker).
- Set scope explicitly:
  - `scope: 'panelType'` + `panelType` for a shared binding across all instances of a panel.
  - `scope: 'panelInstance'` + `panelId` for instance-specific bindings.
- Always provide a stable `bindingId` to support user-configurable overrides (defaults to `id` if omitted).
- If a handler consumes the event, call `event.preventDefault()` and `event.stopPropagation()` before returning `true`.

## Panel focus awareness
- Panels subscribe to `panel.active` context and cache `isPanelSelected`.
- This is the de-facto signal for whether panel shortcuts should run.

## Other global listeners to be aware of
- `CommandPaletteController` attaches a `keydown` listener while open and consumes keys like Escape.
- `PanelWorkspaceController` listens for Escape to close modal panels, but blocks when certain overlays are open.

## Common options on `KeyboardShortcut`
- `allowShift`: match even when Shift is pressed but not part of the modifiers.
- `allowWhenDisabled`: allow handling even when global shortcuts are disabled (useful for dialogs).
- `priority`: resolve conflicts within the same scope.
- `platform`: restrict to `mac`, `win`, `linux`, or `all`.

## When adding new shortcuts
- Prefer global shortcuts for true app-level actions.
- For panel behavior, register through `services.keyboardShortcuts` so bindings can be overridden later.
- Avoid stealing keys from text inputs; always check editable targets before acting.
