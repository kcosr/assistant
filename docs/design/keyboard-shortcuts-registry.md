# Keyboard shortcuts registry

## Summary
Introduce a unified shortcut registry that supports global and panel-scoped shortcuts, centralizes gating/priority rules, and provides a path to user-configurable keybindings. Panels register shortcuts through a shared API instead of ad-hoc document listeners.

## Decisions
- When a shortcut conflicts, panel-scoped actions win; global actions remain active as a fallback.
- Shortcuts should not fire inside inputs/contenteditable elements. Use consistent Escape handling for inputs (first Escape clears, second Escape blurs).
- Store keybindings per-device using the existing client preferences abstraction (localStorage-backed).
- No need for multi-binding per action in the initial design.

## Goals
- Centralize shortcut registration, gating, and conflict handling.
- Support multiple scopes (global, active panel, panel type, panel instance).
- Allow panels to register shortcuts without attaching their own `document` listeners.
- Enable future user-configurable keybindings via a single action registry.

## Non-goals
- Building the configuration UI (can be added later).
- Rewriting every existing shortcut immediately (incremental migration is fine).

## Current behavior
- Global shortcuts live in `KeyboardNavigationController` via `KeyboardShortcutRegistry` (document capture listener).
- Panel shortcuts are ad-hoc: each panel attaches a `document` listener and runs local gating.
- Overlays (command palette, modals) use their own listeners; preventing bleed-through requires manual propagation control.

## Proposed architecture

### 1) Shortcut action registry
A central registry of actions and bindings.

```
interface ShortcutAction {
  id: string;
  title: string;
  description?: string;
  scope: 'global' | 'activePanel' | 'panelType' | 'panelInstance';
  panelType?: string;
  panelId?: string;
  priority?: number; // higher wins when conflicts exist
  handler: (event: KeyboardEvent) => boolean | void;
}

interface ShortcutBinding {
  actionId: string;
  key: string; // normalized (lowercase)
  modifiers: ModifierKey[];
  cmdOrCtrl?: boolean;
  platform?: 'mac' | 'win' | 'linux' | 'all';
}
```

- Registry stores actions + bindings.
- One document-level capture listener resolves bindings and dispatches to the best action.

### 2) Gating rules
Unified gating before dispatch:
- Shortcuts disabled when `dialogManager.hasOpenDialog` or a blocking overlay is open.
- Editable targets (input/textarea/contenteditable) are blocked. Escape handling for inputs is managed separately (clear first, blur on second).
- Optional per-action gates (e.g., allow inside header popover).

### 3) Scope resolution order
When a keybinding matches, resolve actions in this order:
1. `panelInstance` (if a panel is active and action targets it)
2. `panelType` (if active panel matches)
3. `activePanel` (generic panel-scoped)
4. `global`

Within the same scope, highest `priority` wins; ties fall back to most recently registered. This keeps global shortcuts available, but panel scopes take precedence on conflicts.

### 4) Panel registration API
Expose a shared service to panels via `panel.services` context:

```
interface PanelShortcutService {
  register(action: ShortcutAction, bindings: ShortcutBinding[]): () => void;
}
```

- `register` returns an unsubscribe function (called on panel unmount).
- Panels register shortcuts with default scope `panelInstance` or `panelType`.
- Panel-specific gating (e.g., “only in browser mode”) is handled in the handler.

### 5) Global shortcuts
- Global actions continue to live in `KeyboardNavigationController` initially, but are registered via the new registry.
- Panel code can optionally register global shortcuts explicitly (useful for plugin-wide commands).

### 6) Configurable keybindings (future)
- Persist `ShortcutBinding` overrides in the client preferences store (localStorage, per-device).
- Registry merges defaults + overrides at startup.
- Provide a listing API for UI (action metadata + current bindings).

## Existing settings storage breakdown
- LocalStorage (web-client): UI-only preferences and per-device state, e.g. theme/fonts, panel layout, list/browser view & sort modes, command palette sort/group modes, list behaviors (insert-at-top, single-click selection, inline custom fields), tag colors, keyboard shortcuts enabled, auto-focus/auto-scroll, sidebar view mode.
- Plugin settings store (agent-server): per-plugin settings via `/api/plugins/:id/settings`, stored in `plugin-settings.json` under the server data directory and surfaced to panels via `plugin.settings.<id>` context.
- Tauri settings (desktop): backend URL persisted to disk for native builds.
-
Proposed usage: store keyboard bindings in client preferences (localStorage-backed) to keep this per-device and avoid new server config.

## Migration plan
1. Introduce registry in web-client with default gating + scope resolution.
2. Register existing global shortcuts through registry (no behavior change).
3. Add panel shortcut service and migrate one panel (lists/notes) to validate.
4. Later: expose bindings UI + persistence.

## Risks / edge cases
- Conflicts between global and panel shortcuts require clear priority rules.
- Capture-phase ordering with overlays (command palette) must still be respected; registry should honor “blocking overlays” list.

## Files to update
- `packages/web-client/src/utils/keyboardShortcuts.ts` (registry enhancements and scope resolution)
- `packages/web-client/src/controllers/keyboardNavigationController.ts` (register globals via new registry)
- `packages/web-client/src/utils/clientPreferences.ts` (bindings storage API + keys)
- `packages/web-client/src/controllers/panelHostController.ts` (expose panel shortcut service in context)
- `packages/plugins/official/lists/web/index.ts` (migrate panel shortcut registration)
- `packages/plugins/official/notes/web/index.ts` (migrate panel shortcut registration)
- `packages/web-client/src/controllers/commandPaletteController.ts` (ensure overlay gating list stays aligned)

## Open questions
- How should we name the client preference keys for bindings (single JSON blob vs per-action keys)?
