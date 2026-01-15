# Panel Chrome Row Design

## Table of Contents

- [Status](#status)
- [Summary](#summary)
- [Background](#background)
- [POC Implementation](#poc-implementation)
- [Chrome Row Structure](#chrome-row-structure)
- [Progressive Collapse](#progressive-collapse)
- [Resize Detection](#resize-detection)
- [Instance Dropdown](#instance-dropdown)
- [Frame Controls](#frame-controls)
- [Proposed Architecture](#proposed-architecture)
- [Plugin Integration](#plugin-integration)
- [Implementation Notes](#implementation-notes)
- [Decisions](#decisions)

## Status

- Shared `PanelChromeController` + `InstanceDropdownController` extracted to web client
- Chrome row in all built-in panels (chat, navigator, sessions sidebar, empty, placeholder),
  official plugin panels, and example panels (session-info, hello, ws-echo)

## Summary

This design introduces a **panel chrome row** - a unified header row that combines:

1. **Panel title** - identifies the panel type
2. **Instance selector** - dropdown to switch between plugin instances (if supported)
3. **Plugin controls** - plugin-specific UI elements (mode toggles, dropdowns, etc.)
4. **Frame controls** - workspace-level actions (move, reorder, menu, close)

The chrome row replaces the previous approach where frame controls were absolutely-positioned overlays that could cover plugin header content. It also standardizes instance selection UI across plugins.

## Background

### Problem

The existing panel frame controls (Move, Reorder, Close) are rendered as an absolutely-positioned overlay in the top-right corner of each panel. This causes several issues:

1. **Overlap** - Frame controls can cover plugin-specific header controls (instance selectors, action buttons)
2. **Inconsistent instance UI** - Each plugin implements its own instance selector with varying styles
3. **Space inefficiency** - Plugins duplicate header structure that could be shared
4. **Mobile issues** - Overlay controls don't adapt well to narrow viewports

### Goals

- Eliminate overlap between frame controls and plugin controls
- Standardize instance selector UI and behavior
- Provide consistent panel header structure across all plugins
- Support responsive layouts that adapt to available space
- Maintain plugin flexibility for custom controls

## POC Implementation

The POC is implemented in the notes plugin on the `panel-chrome-poc` branch:

- `packages/plugins/official/notes/web/index.ts` - Template and JavaScript logic
- `packages/plugins/official/notes/web/styles.css` - CSS styles

### Key Commits

1. `d8ced89` - Initial chrome row with instance selector and frame controls
2. `9695ac6` - Add title, hide old frame overlay
3. `6dd96ec` - Unified header row with plugin controls slot
4. `c00179e` - Add menu button, center plugin controls
5. `37d2cf4` - Progressive collapse, resizable dropdown, chevron toggle

## Chrome Row Structure

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Title] [Instance▾]   [Plugin Controls...]              [<] [×]         │
│                                                          │    │         │
│                                                     toggle  close       │
│                                                     (expand to show     │
│                                                      move/reorder/menu) │
└──────────────────────────────────────────────────────────────────────────┘
```

### CSS Grid Layout

The chrome row uses CSS Grid with three columns:

```css
.panel-chrome-row.panel-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--spacing-sm);
}
```

- **Left column (`auto`)** - Title + instance selector, sized to content
- **Center column (`1fr`)** - Plugin controls, fills available space
- **Right column (`auto`)** - Frame controls, sized to content

### HTML Structure

```html
<div class="panel-header panel-chrome-row" data-role="chrome-row">
  <!-- Left: Title + Instance -->
  <div class="panel-header-main">
    <span class="panel-header-label" data-role="chrome-title">Notes</span>
    <div class="panel-chrome-instance" data-role="instance-actions">
      <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
        <button class="panel-chrome-instance-trigger">...</button>
        <div class="panel-chrome-instance-menu">...</div>
      </div>
    </div>
  </div>
  
  <!-- Center: Plugin Controls -->
  <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls">
    <!-- Plugin-specific controls injected here -->
  </div>
  
  <!-- Right: Frame Controls -->
  <div class="panel-chrome-frame-controls" data-role="chrome-controls">
    <button class="panel-chrome-toggle" data-action="toggle">◀</button>
    <div class="panel-chrome-frame-buttons">
      <button data-action="move">...</button>
      <button data-action="reorder">...</button>
      <button data-action="menu">...</button>
    </div>
    <button class="panel-chrome-close" data-action="close">×</button>
  </div>
</div>
```

## Progressive Collapse

When the panel becomes too narrow to fit all controls, the chrome row progressively collapses in stages:

### Stage 1: Hide Instance Selector
```
[Title]  [Plugin Controls...]  [<] [×]
```

### Stage 2: Wrap to Two Rows
```
[Title] [Instance▾]           [<] [×]
[Plugin Controls...]
```

### CSS Classes

```css
.panel-chrome-row.chrome-row-stage-1 .panel-chrome-instance { display: none; }
.panel-chrome-row.chrome-row-compact { /* two-row layout */ }
```

## Resize Detection

The chrome row uses JavaScript to detect when content doesn't fit and apply the appropriate collapse stage:

```typescript
const checkChromeRowFit = (): void => {
  // Remove all stages to measure natural widths
  chromeRow.classList.remove('chrome-row-stage-1', 'chrome-row-compact');
  
  const rowWidth = chromeRow.clientWidth;
  const buffer = 40;
  
  const measure = () => {
    const mainWidth = chromeMain.scrollWidth;
    const pluginWidth = chromePluginControls.scrollWidth;
    const frameWidth = chromeFrameControls.scrollWidth;
    return mainWidth + pluginWidth + frameWidth + buffer;
  };
  
  // Try each stage progressively
  if (measure() <= rowWidth) return;
  
  chromeRow.classList.add('chrome-row-stage-1');
  if (measure() <= rowWidth) return;
  
  chromeRow.classList.remove('chrome-row-stage-1');
  chromeRow.classList.add('chrome-row-compact');
};
```

### Triggers

The fit check is triggered by:

1. **ResizeObserver** on the chrome row element
2. **Initial load** with multiple timing checks (immediate, rAF, 50ms, 200ms)
3. **Visibility change** for mobile support
4. **Selection change** when dropdown content changes width
5. **Frame controls expand/collapse**

To avoid layout jitter while dragging or resizing, the controller keeps a
`layoutState` and applies **hysteresis** (default 16px) when expanding back to a
less compact mode. Expansion happens one step at a time (compact -> stage-1 ->
default), and resize observations are coalesced via `requestAnimationFrame`.

## Instance Dropdown

The instance selector is a custom dropdown (not a native `<select>`) with:

- **Search input** - Filter instances by name
- **Keyboard navigation** - Arrow keys, Enter to select, Escape to close
- **Selected state** - Visual indicator for current instance
- **Auto-sizing** - Grows to fit content, shrinks when space is tight

### Dropdown Structure

```html
<div class="panel-chrome-instance-dropdown">
  <button class="panel-chrome-instance-trigger">
    <span class="panel-chrome-instance-trigger-text">Default</span>
    <svg><!-- chevron --></svg>
  </button>
  <div class="panel-chrome-instance-menu">
    <input type="text" placeholder="Search instances..." />
    <div class="panel-chrome-instance-list">
      <!-- items rendered dynamically -->
    </div>
  </div>
</div>
```

### Visibility

The instance dropdown is only shown when the plugin has multiple instances (`instances.length > 1`).

## Frame Controls

Frame controls are collapsed behind a toggle button to save space:

### Default State
```
[<] [×]
```

### Expanded State
```
[>] [Move] [Reorder] [Menu] [×]
```

- **Toggle (`<`/`>`)** - Chevron that rotates 180° when expanded
- **Close (`×`)** - Always visible for quick access
- **Move, Reorder, Menu** - Hidden until toggle is clicked; wired to workspace drag/reorder and panel menu

### Click Outside

Clicking outside the frame controls collapses them automatically.

## Proposed Architecture

### Shared Components

Extract to `packages/web-client/src/`:

1. **`controllers/panelChromeController.ts`**
   - Manages chrome row rendering and state
   - Handles resize detection and progressive collapse
   - Coordinates instance dropdown

2. **`controllers/instanceDropdownController.ts`**
   - Reusable instance selector dropdown
   - Search, keyboard navigation, selection

3. **CSS in `public/styles.css`**
   - `.panel-chrome-row` and related classes
   - `.panel-chrome-instance-*` dropdown styles
   - Progressive collapse stages

### Workspace Controller Integration

The workspace controller continues to own menu/drag/reorder logic, while panels render the chrome row:

1. Legacy overlay frame controls are removed; panels render chrome row controls directly
2. `PanelChromeController` calls workspace APIs for move/reorder/menu/close
3. Focus detection treats `.panel-chrome-row` as chrome interaction

### Plugin Manifest

Plugins declare instance support in their manifest (already exists):

```json
{
  "type": "notes",
  "instances": {
    "enabled": true,
    "defaultId": "default"
  }
}
```

### Plugin Integration

Plugins render the chrome row markup and instantiate the controller to wire up frame actions and
instance selection.

```html
<div class="panel-header panel-chrome-row" data-role="chrome-row">
  <div class="panel-header-main">
    <span class="panel-header-label" data-role="chrome-title">Notes</span>
    <div class="panel-chrome-instance" data-role="instance-actions">
      <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
        <!-- instance dropdown template -->
      </div>
    </div>
  </div>
  <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls">
    <!-- plugin-specific controls -->
  </div>
  <div class="panel-chrome-frame-controls" data-role="chrome-controls">
    <!-- frame controls -->
  </div>
</div>
```

```typescript
const chromeController = new PanelChromeController({
  root,
  host,
  title: 'Notes',
  onInstanceChange: (instanceId) => setActiveInstance(instanceId),
});

chromeController.setInstances(instances, selectedInstanceId);
```

## Implementation Notes

- Shared chrome styles live in `packages/web-client/public/styles.css`.
- Controllers live in `packages/web-client/src/controllers/panelChromeController.ts` and
  `packages/web-client/src/controllers/instanceDropdownController.ts`.
- Chrome row integrated in all built-in panels (chat, navigator, sessions sidebar, empty,
  placeholder), official plugin panels, and example panels (session-info, hello, ws-echo).
- `PanelChromeController` wires move/reorder/menu/close to workspace APIs; legacy overlay controls
  are removed.

## Decisions

1. **Chrome row ownership** - Panels render chrome row markup; workspace owns behavior via APIs.
2. **Panels without instances** - Always render chrome row; instance dropdown is hidden when unused.
3. **Menu button behavior** - Uses the existing workspace panel menu (pin, dock, split, etc.).
4. **Progressive collapse** - Hide instance selector first; then wrap to two rows while keeping title.
