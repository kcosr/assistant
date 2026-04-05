# Panel Layout UI Specification (Draft)

> This document describes the current panel layout system.
> For the proposed replacement model that separates splits, panes, and tabs,
> see [Panel Workspace Redesign](panel-workspace-redesign.md).

## Table of Contents

- [Scope](#scope)
- [Source files](#source-files)
- [Overview](#overview)
- [Layout and Shell](#layout-and-shell)
- [Panel Workspace](#panel-workspace)
- [Panel Launcher](#panel-launcher)
- [Drag and Dock](#drag-and-dock)
- [Panel Context Menu](#panel-context-menu)
- [Focus and Input](#focus-and-input)
- [Keyboard Shortcuts (Default)](#keyboard-shortcuts-default)
- [Persistence](#persistence)
- [Chat Panel Requirements](#chat-panel-requirements)
- [Artifacts Panel Requirements](#artifacts-panel-requirements)
- [Accessibility](#accessibility)
- [Open Questions](#open-questions)

## Scope

- Applies to web client only.
- Android is removed and out of scope.
- This spec describes the **panel-based layout system** and user interactions for plugin panels.

## Source files

- `packages/web-client/src/controllers/panelWorkspaceController.ts`
- `packages/web-client/src/controllers/panelHostController.ts`
- `packages/web-client/src/controllers/panelLauncherController.ts`
- `packages/web-client/src/controllers/panelRegistry.ts`
- `packages/web-client/src/utils/layoutTree.ts`

## Overview

The UI is built around a **panel workspace** that can contain any number of panels. Panels are plugin instances (chat, artifacts, diff, terminal, etc.) arranged in **panes**. Panes may be split against each other, and each pane owns its own tab strip. The shell provides a panel launcher and global commands; panels provide their own UI and tool integrations.

## Layout and Shell

### Global Shell

- **Top Bar**: contains global actions and status.
- **Workspace**: the panel layout area (nested splits containing pane-local tab groups).
- **Status Area** (optional): transient notifications and connection status.

The shell does not assume fixed panel positions. Panels are arranged dynamically via the layout engine.

Default layout on first run:

- Single empty placeholder panel
- Panels are available from the launcher (not opened by default)

### Top Bar

Required items:

- **Panel Launcher**: open and manage panel types.
- **Command Palette**: search commands (panel and global).
- **Connection Status**: indicator of server connectivity.
- **Settings**: user preferences and layout reset.

Optional items:

- Global search or quick actions (future).

## Panel Workspace

### Panel Types

Panels are plugin-defined. Core provides only the workspace and host API. Default bundles include:

- **Chat Panel** (core): chat transcript + input bar.
- **Artifacts Panel** (plugin): notes/tags/lists browser, views, details.
- **Sessions Panel** (plugin): list of sessions and agents.

Other examples:

- **File Browser Panel** (plugin)
- **Diff Panel** (plugin)
- **Terminal Panel** (plugin)

### Panel Chrome

Each panel renders in a standardized frame with:

- **Title + icon**
- **Title badge + status indicator** (optional)
- **Close button**
- **Panel actions** (slots contributed by plugin)
- **Pane tab strip**
- **Session binding indicator** (for session-scoped panels; shows the bound session or global/unbound)
- **Panel actions menu** for panel-specific actions

Binding indicator behavior:

- Click opens a session picker to select a specific session for the panel.
- Panels do not implicitly follow a global "active session"; binding is explicit.
- Panels that support global/unbound binding show a non-interactive indicator or a clear action.

### Panes, Tabs, and Splits

- Splits and panes are distinct layout nodes.
- Split nodes arrange child panes or nested splits horizontally or vertically.
- Pane nodes own their tab lists directly.
- Each tab shows the panel title.
- Tab order follows the pane's `tabs` order.
- Dragging a tab within its own tab strip reorders tabs in that pane.
- Dragging a tab out of its pane docks that tab into a split edge or tabs it into another pane, without moving the rest of the source pane.
- Dragging the only tab in a pane moves that pane's content and leaves an `empty` placeholder panel behind in the source pane so the area remains in place.

### Resizing

- Split panes can be resized via drag handles.
- Panels may declare min width/height constraints.

## Panel Launcher

The panel launcher is the primary entry point for opening panels.

Behavior:

- Shows a searchable list of panel types.
- Includes a search input to filter by panel name, type, or description.
- Indicates which panel types are already open (including open counts).
- Supports pinned panel types.
- Opening a panel uses its default placement unless a placement is chosen (launcher "Place" menu or pane-local add-tab flow).
- Default placement size hints (width/height) are used when creating a split.
- Single-instance panels focus the existing instance instead of opening a new one.
- Multi-instance panels use a "New" action to open additional instances.
- Multi-instance panels expose a "Place" menu to open as a tab with the active panel or split in a direction.
- Opening from a pane tab header "+" button opens as a new tab in that pane.
- Pane-local actions whose placement is already known use a compact in-pane picker instead of the full launcher with placement controls.
- The top-row `+` button also uses that compact picker to add a tab to the active pane.
- Compact in-pane picker rows submit directly without per-row add buttons, and the compact header shows the current action (`Add Tab`, `Split Right`, `Replace Panel`, and so on).
- Inline panel replacement uses the same compact in-pane picker instead of the full global launcher.
- Empty placeholder panes use an explicit `Replace panel` action and open that same compact replace picker.
- While the compact picker is open, background panel shortcuts are suspended so `Up`, `Down`, `Enter`, and `Esc` stay scoped to the picker.
- Compact pickers keep a search/filter input visible at the top, and filtering does not break arrow-key or enter selection.

## Drag and Dock

Panels can be repositioned by dragging their header:

- **Dock**: drop on workspace edges to create a split.
- **Tab**: drop on another pane or tab to add the panel into that pane's tab strip.
- **Split preview** shows where the panel will land.
- **Reorder**: a dedicated reorder handle swaps the panel within its parent split.

Tabs can also be repositioned by dragging their tab title:

- **Reorder in pane**: drag within the same tab strip.
- **Detach to split**: drag to a pane edge to split just that tab out into its own pane.
- **Move across panes**: drop on another pane or its tab strip to move that tab there.
- **Move lone pane tab**: drag the only tab in a pane to move that pane while leaving an `empty` placeholder behind in the source pane.

Initial implementation notes:

- Dragging uses a Move handle in the panel frame controls.
- Drop zones are inferred from cursor position over the workspace or a panel frame.
- Reorder drag stays scoped to the parent split and does not dock.

Panel actions menu (initial behavior):

- Split with new panel (submenu).
- Move to left/right/top/bottom pane within the workspace.
- Add tab here (opens the compact picker targeted to the current pane).
- Close panel.

## Panel Context Menu

Right-clicking (or long-pressing) a panel header should expose:

- Split with new panel (submenu)
- Move to new tabbed split (planned)
- Close panel / Close other panels
- Reset panel state (plugin-defined, optional)

## Focus and Input

- The active panel receives keyboard focus.
- The active tab determines focus within tabbed splits.
- The active panel frame shows a visible focus ring.
- Global shortcuts should not interfere with panel-local shortcuts.

## Keyboard Shortcuts (Default)

- **Open launcher / command palette**: `Ctrl/Cmd + K`
- **Layout navigation mode**: `Ctrl + P` (arrows move between siblings, `A/S` = left, `D` = right, `Enter` descends or focuses, `Esc` ascends/exits, `1-9` select children, `0` cycles pages)
- **Header panel navigation**: `Ctrl + H` (left/right or `A`/`D` cycles pinned header panels, `Enter` or `↓` focuses selected header panel, `1-9` toggle, `0` cycles pages, `Esc` exits)
- **Cycle panel focus**: `Ctrl/Cmd + ]` / `Ctrl/Cmd + [`
- **Split panel**: `Ctrl + S` (active panel only; arrows/WASD choose region, `Enter` opens the compact picker for that region, `Esc` cancels)
- **Move panel**: `Ctrl + M` (active panel only; arrows/WASD first choose the target panel, `Enter` switches to placement, arrows/WASD or `C` choose `left/right/top/bottom/center`, `Enter` confirms, `Esc` backs out/cancels)
- **Focus last panel by type**: `Ctrl + A` artifacts, `Ctrl + C` chat, `Ctrl + D` diff, `Ctrl + F` files, `Ctrl + L` lists, `Ctrl + N` notes
- **Add tab to active pane**: `Ctrl + T` (opens the compact picker targeted to the active pane)
- **Close panel**: `Ctrl + Shift + Cmd + W` (macOS) / `Ctrl + Shift + Alt + W` (others) (replaces with empty placeholder)
- **Close/remove panel**: `Ctrl + X` (active panel; replaces with empty placeholder, or removes if already empty)
- **Remove panel**: `Ctrl + Shift + Cmd + X` (macOS) / `Ctrl + Shift + Alt + X` (others)
- **Reset layout**: command palette action

Panel plugins may register additional shortcuts scoped to the focused panel.

## Persistence

- Layout and panel state persist across reloads.
- Users can reset the layout to default from settings.

## Chat Panel Requirements

- Contains the input bar and chat log.
- Supports code block copy actions and tool output rendering.
- Shows connection and status indicators.
- Selecting or creating a chat panel does not automatically move focus into the composer.
- Creating a new unbound chat panel opens the session picker automatically so the user can bind it immediately.

## Artifacts Panel Requirements

- Contains browser, view mode, and detail mode within the plugin.
- Uses panel-local search and filter UI.
- Does not rely on global layout state.

## Accessibility

- All panel actions must be keyboard accessible.
- Panel focus and active tab are announced via ARIA attributes.
- Launcher and command palette are fully keyboard navigable.

## Open Questions

- Should layout persistence be local-only or synced across devices?
- How are panel defaults chosen when multiple panels are opened quickly?
- Should the panel launcher also manage active layouts (presets)?
