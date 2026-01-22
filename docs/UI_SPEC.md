# AI Assistant - Common UI Specification (Panel Layout)

This document defines the UI behavior and layout requirements for the web client using the **panel layout system**. The legacy fixed three-panel layout is deprecated; see `docs/design/panel-layout-ui-spec.md` for the detailed panel layout spec.

## Table of Contents

- [Scope](#scope)
- [Source files](#source-files)
- [High-Level Structure](#high-level-structure)
- [Top Bar](#top-bar)
- [Panel Workspace](#panel-workspace)
- [Toolbar](#toolbar)
- [Panel Launcher](#panel-launcher)
- [Keyboard Shortcuts (Default)](#keyboard-shortcuts-default)

## Scope

- Web client only.
- Mobile web builds reuse this UI.
- Native Android UI is out of scope; Capacitor builds add a share target modal on top of the web UI.
- Panels are plugin instances (chat, lists, notes, sessions, etc.).

## Source files

- `packages/web-client/src/controllers/panelWorkspaceController.ts`
- `packages/web-client/src/controllers/panelHostController.ts`
- `packages/web-client/src/controllers/panelLauncherController.ts`
- `packages/web-client/src/controllers/keyboardNavigationController.ts`
- `packages/web-client/src/utils/layoutTree.ts`

## High-Level Structure

The UI consists of:

1. **Top Bar**: global actions and status.
2. **Panel Workspace**: dock/split/tab layout hosting panels.
3. **Notifications** (optional): transient feedback.

## Top Bar

Required elements:

- **Panel Launcher**: open/manage panel types.
- **Command Palette**: search actions.
- **Connection Status**: current server connectivity.
- **Settings**: preferences and layout reset (theme + UI/code font selectors).
- **Header Panels**: pinned panel buttons that open a popover panel anchored in the toolbar.

### Header Panels (Pinned)

- Panels can be pinned/unpinned from the panel actions menu.
- Pinned panels are removed from the workspace layout and appear as toolbar buttons.
- Clicking a pinned button toggles a popover panel; click outside or press `Esc` to close.
- Unpinning restores the panel back to the workspace layout (tabbed with the active panel).

## Panel Workspace

### Default Layout

On first run:

- Chat panel in the center
- Chat panel includes its own message composer
- Sessions panel is available from the launcher (not opened by default)
- Lists and notes panels are available from the launcher (not opened by default)

Implementation notes (current):

- The workspace is rendered inside `#panel-workspace`.
- Panel toggles are no longer fixed in the toolbar; use the panel launcher and panel chrome.

### Panel Chrome

Each panel renders inside a standardized frame:

- Title + icon
- Optional title badge and status indicator
- Close button (replaces the panel with an empty placeholder; pinned panels close fully)
- Panel-specific actions (toolbar slots)
- Optional tab strip if the parent split is in tab view
- Session binding indicator for chat panels
- Panel actions menu (dock/tab/replace/remove) available on hover/focus
- Empty panel placeholders show a centered call-to-action to pick a panel

Binding indicator behavior:

- Chat panels show a session picker dropdown with search, keyboard navigation, and sections for Unbound (optional), Sessions, and New session
- Panels do not implicitly follow a global "active session"; chat binding is explicit
- Non-chat panels do not expose session binding controls

### Unavailable Panels

- If a panel type exists in the layout but its plugin or capabilities are missing, render a placeholder panel with a short explanation.
- Unavailable panels should still be closeable from the panel chrome.

### Layout Operations

- Split horizontally/vertically
- Tab panels together (split tab view)
- Drag to dock and tab (tabbing creates a tabbed split)
- Resize split panes
- Dock or tab panels via the panel actions menu
- Drag panels via the Move handle in the panel frame
- Use the Reorder handle to swap a panel within its parent split
- Drag tab headers to reorder tabs within a tabbed split
- Add new tabs from the tab header "+" button (opens the panel launcher scoped to the tabbed split)
- Split the active panel with a new panel from the panel actions menu (submenu for split placement).
- Toggle a split between split view and tab view (tab view is a display mode for the same tree).
- Resize handles appear between every adjacent pane in a split (supports more than two children).

### Focus Behavior

- Only the active panel receives keyboard events.
- Active tab within a tabbed split determines focus.
- Chat input lives inside each chat panel (no global input panel).
- Clicking a non-chat panel does not change the active panel unless `Shift` is held.
- `Shift` + click on a non-chat panel sets it active and highlights the frame.

## Toolbar

- Panels launcher button opens the panel picker.
- Layout presets dropdown gathers open panels into auto/column grids without closing them.
- Layout presets dropdown includes a replace action for the active panel.

## Panel Launcher

- Searchable list of available panel types.
- Search input filters by title/type/description.
- Shows which panels are already open (including open counts).
- Single-instance panels focus the existing instance instead of creating a new one.
- Multi-instance panels open additional instances via a "New" action.
- Multi-instance panels offer placement options (tab/split) relative to the active panel.
- Empty panel type is available in the picker.

## Keyboard Shortcuts (Default)

- Open launcher/command palette: `Ctrl/Cmd + K`
- Layout navigation mode: `Ctrl + Shift + Cmd + P` (macOS) / `Ctrl + Shift + Alt + P` (others) (arrows move between siblings, `Enter` descends or focuses, `Esc` ascends/exits, `1-9` select children, `0` cycles pages)
- Header panel navigation: `Ctrl + Shift + Cmd + H` (macOS) / `Ctrl + Shift + Alt + H` (others) (`1-9` toggle pinned header panels, `0` cycles pages, `Esc` exits)
- Cycle focus: `Ctrl/Cmd + ]` / `Ctrl/Cmd + [`
- Close panel: `Ctrl + Shift + Cmd + W` (macOS) / `Ctrl + Shift + Alt + W` (others) (panel-focused, replaces with an empty placeholder)
- Remove panel: `Ctrl + Shift + Cmd + X` (macOS) / `Ctrl + Shift + Alt + X` (others) (removes panel from layout)
- Reset layout: available in settings (and command palette when implemented)
- Reset panel state: clears persisted panel state without changing the layout

Panels can register additional shortcuts scoped to the focused panel.

## Panel-Specific Requirements

### Chat Panel

- Chat transcript UI with tool output rendering.
- Includes its own message composer (input, context toggle, brief toggle, mic).
- Voice capture auto-submits on recognition end (no spoken "submit" keyword).
- Mic button and media play/pause key cancel active output; subsequent press starts recording.
- Long-pressing the mic enables continuous listening and starts recording once the long-press threshold is reached.
- Supports code block copy controls and tool output collapse/expand.
- Contiguous tool calls render inside a collapsible group with count, latest call summary, and state; `agents_message` calls remain standalone.
- Chat panels are session-scoped but may be unbound; multiple chat panels may target the same session.

### Lists Panel

- Lists browser and list view live inside the panel.
- Search/filter controls live inside the panel.
- Lists panels are global (no session binding).
- Clicking a list item selects it when enabled in the Settings menu.
- List view supports keyboard navigation (arrow keys to move selection, Shift+Arrow to extend, Enter to edit, Space to toggle complete, `n` to add, `t`/`b` to move, `d` to delete, Esc to clear). `f` focuses the list search.

### Notes Panel

- Notes browser and note view live inside the panel.
- Shared search highlights matches in the active note; Enter advances to the next match and wraps.
- Markdown preview by default with an explicit edit mode.
- When multiple instances are configured, the header shows an instance selector that scopes notes.
- Notes panels are global (no session binding).

### Time Tracker Panel

- Track time against named tasks using timers and manual entries.
- Date range filters (today/week/month/custom) control the entry list and totals.
- Selecting a task filters the entry list to that task; no selection shows all tasks.
- Active timer persists across reloads and is shown in the panel until stopped or discarded.
- When multiple instances are configured, the header shows an instance selector that scopes tasks, entries, and timers.
- Time tracker panels are global (no session binding).

### Share Target Modal (Mobile Web)

- In Capacitor Android builds, receiving shared text shows a global modal for routing.
- Targets: Chat Input, New Note, Add to List.
- Chat Input prompts for session selection when no session is active.
- Notes and Lists open/focus their panels after creation.

### Sessions Panel

- Lists agents and sessions.
- Allows creating and switching sessions.
- Shows activity indicators per session.

### Workspace Navigator Panel

- Displays the current layout tree, including the root split and nested splits.
- Split rows provide split/tabs toggles plus add/close actions.
- Panel rows provide add/close actions; chat panels show session binding.
- Entries under inactive tabs are dimmed; clicking a panel row switches the active tab.
- Clicking a panel entry focuses it and activates its tabbed split.
- Indicates active panel focus.

### Workspace Switcher

- Toolbar button opens a modal Workspace navigator for quick switching.
- Selecting a panel focuses it and closes the modal.
- Modal uses the same split/tabs toggles and add/close actions as the navigator panel.
- Escape or clicking the backdrop closes the modal.

### Files Panel

- Browses the configured workspace root (files plugin `workspaceRoot`).
- Uses a collapsible tree browser and a read-only file preview pane.
- Indicates binary files and truncation in the preview.
- Emits selection context for file-focused actions.
- Operates as a global panel (no session binding).

### Diff Panel

- Shows git diffs for the configured diff workspace root or repo target.
- Supports working and staged comparisons (no range target).
- Sidebar lists only files with changes (derived from diff status), not a workspace tree.
- Repo picker navigates repositories under the workspace root; selection persists per panel.
- Instance selector appears when multiple diff instances are configured; selection persists per panel.
- Detached HEAD repositories are blocked from showing diffs.
- Header shows the current branch for the selected repository.
- When no file is selected, the main view shows a combined diff with per-file sections.
- Clicking empty space in the file list clears the selection and returns to the combined view.
- Operates as a global panel (no session binding).

## Persistence

- Layout and panel state persist across reloads.
- A "Reset layout" action restores defaults.
- Panel manifests may opt panels into header pinning by default via `defaultPinned`, applied when no saved layout is present.

## Accessibility

- Panel launcher and commands are keyboard accessible.
- Focus state is surfaced via ARIA.
- Active panels show a visible focus ring.
- Panel tabs are keyboard navigable.

## Deprecated Legacy Behaviors

- Fixed sidebar/chat/collection panels
- Layout toggle and pane order toggle
- Legacy collection modes owned by core

## References

- Panel layout spec: `docs/design/panel-layout-ui-spec.md`
- Panel plugin architecture: `docs/design/panel-plugins.md`
