# Panel Workspace Redesign

## Summary

Redesign the panel workspace around three explicit concepts:

- `split`: arranges children horizontally or vertically
- `pane`: a visible area in the workspace
- `tab`: a panel instance within a pane

This replaces the current model where a split node can switch between `split` and `tabs` view modes.

The redesign goal is to make panel placement, nesting, and tabbing intuitive enough that users can predict the result of every action before they commit it.

## Problem

The current workspace model overloads `center` placement and `tabs` view mode:

- a split can be rendered either as panes or as tabs
- `center` sometimes means "add a tab"
- panel actions are labeled as if they act on a panel, but often mutate the nearest ancestor split
- drag-and-drop feedback is geometric, not semantic

This creates a mismatch between the user's mental model and the actual tree transform.

Example of the current failure:

1. Start with one panel `A`
2. Split right to create `A | B`
3. Try to make the right side tabbed

Users expect `A | (B,C tabs)`.

Today, the likely outcomes are:

- the whole `A | B` split becomes tabs, or
- the new panel is inserted into the ancestor split instead of the right side becoming a tab group

So the UI appears flexible, but the operations are not composable in a predictable way.

## Goals

- Make every visible area a pane with clear ownership
- Make tab groups explicit and always local to one pane
- Support arbitrary nesting of splits and panes
- Let users create layouts through direct manipulation without reasoning about tree internals
- Make drag/drop and menu actions describe the resulting layout explicitly
- Preserve flexibility for advanced users without requiring a separate "expert mode"

## Non-goals

- Reworking plugin internals or plugin content rendering
- Redesigning pinned header panels in the same phase
- Adding collaborative or per-device layout syncing

## Proposed Mental Model

Users should only need to think in these terms:

- "This is a pane"
- "This pane has one or more tabs"
- "These panes are split"

That means:

- every panel lives inside a pane
- every pane has a tab strip model, even if the strip is visually hidden when there is only one tab
- splits arrange panes or nested splits

The target example becomes straightforward:

1. Start with pane `[A]`
2. Split right: `[A] | [B]`
3. Add tab to right pane: `[A] | [B, C]`

## Proposed Data Model

Replace the current "split with optional `viewMode: tabs`" layout tree with explicit nodes:

```ts
type WorkspaceNode =
  | {
      kind: 'split';
      splitId: string;
      direction: 'horizontal' | 'vertical';
      sizes: number[];
      children: WorkspaceNode[];
    }
  | {
      kind: 'pane';
      paneId: string;
      activeTabId: string;
      tabs: PaneTab[];
    };

type PaneTab = {
  tabId: string;
  panelId: string;
};
```

Rules:

- `split.children` may contain `pane` or `split`
- `pane.tabs.length >= 1`
- a panel belongs to exactly one tab in exactly one pane
- active tab is tracked by `pane.activeTabId`, not by a split

## Core Operations

The workspace should expose explicit operations instead of overloading `center` placement:

- `splitPane(paneId, direction, newPanelType?)`
- `addTabToPane(paneId, panelType?)`
- `movePane(paneId, target, region)`
- `moveTab(tabId, targetPaneId, index?)`
- `convertTabToSplit(tabId, direction)`
- `closePane(paneId)`
- `closeTab(tabId)`

Important distinction:

- pane operations move a whole visible area
- tab operations move a single panel within or across panes

## Primary UI

Each pane header should expose first-class actions:

- `Add Tab`
- `Split`
- `Move Pane`
- `More`

### Pane header behavior

- `Add Tab` opens the panel launcher targeted to the current pane
- `Split` opens a direction picker: left, right, up, down
- dragging the pane header moves the whole pane
- dragging a tab moves that tab
- `More` contains secondary actions: rename, bind session, pin to header, close

### Tab strip behavior

- if a pane has one tab, the strip may be visually minimized or hidden
- if a pane has multiple tabs, tabs are always visible
- tabs are reorderable within the same pane
- dragging a tab over another pane can:
  - add as tab
  - split into a new pane relative to that target pane

## Drag and Drop

Drag/drop should present semantic targets, not just geometry.

When dragging a pane over another pane, show five labeled targets:

- `Split Left`
- `Split Right`
- `Split Up`
- `Split Down`
- `Merge as Tabs`

When dragging a tab:

- over a tab strip: show tab insertion marker
- over pane center: `Add as Tab`
- over pane edges: `Split Left/Right/Up/Down`

The overlay should display text labels directly in the drop zones.

This is a deliberate change from the current highlight-only overlay.

## Menu Redesign

Replace ambiguous menu actions:

- remove `Tab with workspace`
- remove panel-scoped `View as tabs`
- remove panel-scoped `Add panel tab...` phrasing that actually targets an ancestor split

Use explicit language instead:

- `Add tab to this pane...`
- `Split this pane right...`
- `Split this pane left...`
- `Move pane`
- `Move tab to another pane`
- `Convert pane tabs to split` only when a pane has multiple tabs

## Workspace Navigator

The navigator should become a real layout editor, not just an outline.

Represent the tree using explicit labels:

- `Split H`
- `Split V`
- `Pane`
- child tabs under each pane

Recommended actions:

- on split: add pane, change direction, remove split
- on pane: add tab, split, close pane
- on tab: activate, move, close

This provides a deterministic path for users who do not want to use drag-and-drop.

## Keyboard Model

Keep shortcuts, but align them to the new concepts.

Recommended defaults:

- `Ctrl+S` enter split placement for the active pane
- `Ctrl+T` add tab to the active pane
- `Ctrl+Shift+Arrow` move focus across panes
- `Ctrl+PageUp/PageDown` switch tabs in the active pane
- `Ctrl+Shift+PageUp/PageDown` move tab within pane

Keyboard overlays should say `Split pane` and `Add tab`, not `placement region` or `split view mode`.

## Migration

Saved layouts need a one-time migration from the current structure.

Mapping strategy:

- `panel` becomes `pane` with one tab
- `split` with no `viewMode` becomes `split`
- `split` with `viewMode: 'tabs'` becomes `pane`
  - each child subtree becomes a tab-bearing pane or is flattened according to these rules:
    - if the child is a `panel`, it becomes a tab directly
    - if the child is a `split`, preserve it by converting it into a nested pane layout for that tab only if needed

Recommended simplification:

- support migrating tab-mode splits only when each child resolves to a single panel
- if a legacy tab-view split contains nested splits, normalize it into multiple panes in split mode and log a migration warning

That keeps the runtime migration predictable.

## Implementation Phases

### Phase 1: Model and persistence

- add explicit `pane` node model alongside migration helpers
- update layout persistence load/save
- keep rendering behavior temporarily compatible

### Phase 2: Layout helpers

- replace `center` placement logic with explicit pane/tab operations
- add unit tests for:
  - split right then add tab to right pane
  - nested splits containing tabbed panes
  - moving tabs across panes

### Phase 3: Rendering

- render panes and tab strips explicitly
- remove `viewMode: 'tabs'` rendering path
- keep resize handles on split nodes only

### Phase 4: Interaction redesign

- replace current move/reorder/menu actions with pane-first controls
- implement semantic drag overlays with labels
- add tab dragging across panes

### Phase 5: Workspace navigator

- update navigator to show split/pane/tab hierarchy
- add explicit layout-editing actions

## Recommended First Slice

The best first implementation slice is:

1. introduce explicit `pane` nodes
2. implement `splitPane` and `addTabToPane`
3. rewire panel menu actions to those explicit operations
4. preserve current drag behavior temporarily

This gets the confusing menu-driven workflows fixed before the larger drag/drop redesign lands.

## Why This Is Better

- The user model becomes local and composable
- Pane-level and tab-level actions stop fighting each other
- The layout you are trying to build becomes an obvious operation
- The workspace navigator can finally describe the real structure truthfully
- Future features like saved pane groups or per-pane session bindings become easier

## Open Questions

- Should a single-tab pane always show a tab strip on desktop, or only when hovered/focused?
- Should closing the last tab in a pane remove the pane immediately, or replace it with an empty placeholder?
- Should drag targets prefer pane movement by default and require holding a modifier to drag only a tab from the active tab?
