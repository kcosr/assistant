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
- [Implementation Plan](#implementation-plan)
- [Open Questions](#open-questions)

## Status

- POC complete in notes plugin (`panel-chrome-poc` branch)
- Ready for extraction to shared code

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
    <span class="panel-header-label">Notes</span>
    <div class="panel-chrome-instance" data-role="instance-actions">
      <div class="panel-chrome-instance-dropdown">
        <button class="panel-chrome-instance-trigger">...</button>
        <div class="panel-chrome-instance-menu">...</div>
      </div>
    </div>
  </div>
  
  <!-- Center: Plugin Controls -->
  <div class="panel-chrome-plugin-controls">
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

### Stage 2: Hide Title
```
[Plugin Controls...]  [<] [×]
```

### Stage 3: Wrap to Two Rows
```
[Title] [Instance▾]           [<] [×]
[Plugin Controls...]
```

### CSS Classes

```css
.panel-chrome-row.chrome-row-stage-1 .panel-chrome-instance { display: none; }
.panel-chrome-row.chrome-row-stage-2 .panel-chrome-instance,
.panel-chrome-row.chrome-row-stage-2 .panel-header-label { display: none; }
.panel-chrome-row.chrome-row-compact { /* two-row layout */ }
```

## Resize Detection

The chrome row uses JavaScript to detect when content doesn't fit and apply the appropriate collapse stage:

```typescript
const checkChromeRowFit = (): void => {
  // Remove all stages to measure natural widths
  chromeRow.classList.remove('chrome-row-stage-1', 'chrome-row-stage-2', 'chrome-row-compact');
  
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
  chromeRow.classList.add('chrome-row-stage-2');
  if (measure() <= rowWidth) return;
  
  chromeRow.classList.remove('chrome-row-stage-2');
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
- **Move, Reorder, Menu** - Hidden until toggle is clicked

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

The `panelWorkspaceController.ts` should:

1. Stop rendering the old overlay frame controls for panels with chrome row
2. Optionally render chrome row for plugins that opt-in
3. Wire up frame control actions (move, reorder, close) to workspace methods

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

### Plugin Integration API

Plugins provide their controls via a mount callback or slot:

```typescript
interface PanelChromeOptions {
  title: string;
  pluginControls?: HTMLElement | (() => HTMLElement);
  instanceId?: string;
  onInstanceChange?: (instanceId: string) => void;
}

// In plugin mount:
const chrome = new PanelChromeController(chromeRow, {
  title: 'Notes',
  pluginControls: createPluginControls(),
  instanceId: selectedInstanceId,
  onInstanceChange: setActiveInstance,
});
```

## Implementation Plan

### Phase 1: Extract Shared CSS

1. Move `.panel-chrome-*` styles from notes plugin to `web-client/public/styles.css`
2. Keep notes plugin working with shared styles
3. Verify no regressions

### Phase 2: Create Instance Dropdown Controller

1. Extract `InstanceDropdownController` class
2. Handle dropdown open/close, search, keyboard navigation
3. Provide callbacks for selection changes
4. Update notes plugin to use the controller

### Phase 3: Create Panel Chrome Controller

1. Extract `PanelChromeController` class
2. Handle chrome row rendering, resize detection, progressive collapse
3. Integrate instance dropdown controller
4. Wire up frame control actions
5. Update notes plugin to use the controller

### Phase 4: Workspace Controller Integration

1. Add option to suppress old overlay frame controls per panel
2. Wire up frame control actions (move, reorder, close) from chrome row
3. Consider rendering chrome row from workspace controller (optional)

### Phase 5: Update Other Plugins

1. **Time Tracker** - Add chrome row, move instance selector
2. **Lists** - Add chrome row, move instance selector
3. **Diff** - Add chrome row (no instance selector)
4. **Terminal** - Add chrome row (no instance selector)
5. **Files** - Add chrome row (no instance selector)

### Phase 6: Documentation

1. Update PLUGIN_SDK.md with chrome row integration guide
2. Add examples for custom plugin controls
3. Document progressive collapse behavior

## Open Questions

1. **Should workspace controller render chrome row?**
   - Pro: Consistent rendering, easier frame control wiring
   - Con: Less plugin flexibility, requires API for plugin controls

2. **How to handle plugins without instance support?**
   - Option A: Always show chrome row, just hide instance dropdown
   - Option B: Let plugins opt-out of chrome row entirely

3. **Menu button functionality**
   - What actions should the "..." menu contain?
   - Should it include hidden instance selector when in stage-1/stage-2?

4. **Move/Reorder button functionality**
   - Current POC just logs to console
   - Need to wire up to workspace controller drag initiation
   - Or convert to click-to-select-destination flow?

5. **Mobile-specific behavior**
   - Should frame controls be hidden entirely on mobile?
   - Should progressive collapse be more aggressive?
