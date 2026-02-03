# Session dropdown: clear, rename, and mobile sub-menu

## Goal

Add **clear history** and **rename** actions to the session dropdown in the chat panel, alongside the existing delete action. On mobile, present all three actions in a sub-menu since hover states don't work.

## Current state

### Server-side (all exists ✓)
- `SessionIndex.renameSession(sessionId, name)` — renames session
- `SessionIndex.clearSession(sessionId)` — clears history, keeps session
- `SessionHub.deleteSession(sessionId)` — deletes session

### Plugin API (all exists ✓)
- `POST /api/plugins/sessions/operations/update` with `{ sessionId, name }` — rename
- `POST /api/plugins/sessions/operations/clear` with `{ sessionId }` — clear
- `POST /api/plugins/sessions/operations/delete` with `{ sessionId }` — delete

### Client-side
- `SessionManager.clearSession(sessionId)` — exists ✓
- `SessionManager.deleteSession(sessionId)` — exists ✓
- `SessionManager.renameSession(sessionId)` — **missing** (needs to prompt for name + call update API)

### UI
- `panelSessionPicker.ts` — only delete button on hover, with confirmation flow
- **Missing:** clear button, rename button, mobile sub-menu

## Proposed UX

### Desktop (hover)

Each session row shows action icons on hover (right side):

```
┌────────────────────────────────────┐
│ 🔍 Search sessions...              │
├────────────────────────────────────┤
│ Sessions                           │
│ ┌────────────────────────────────┐ │
│ │ My coding session    ✏️ 🗑️ 🧹 │ │  ← icons appear on hover
│ └────────────────────────────────┘ │
│   Another session                  │
│   Old session                      │
└────────────────────────────────────┘
```

Icon order (left to right): **rename** (✏️), **delete** (🗑️), **clear** (🧹)

Each action has a confirmation state (like delete currently does):
- **Rename:** inline text input replaces label, confirm/cancel buttons
- **Delete:** "Delete?" label, confirm/cancel buttons (current behavior)
- **Clear:** "Clear history?" label, confirm/cancel buttons

### Mobile (sub-menu)

On mobile viewports, tapping a session row shows a sub-menu instead of selecting:

```
┌────────────────────────────────────┐
│ My coding session                  │
├────────────────────────────────────┤
│ ▶ Open                             │
│ ✏️ Rename                          │
│ 🧹 Clear history                   │
│ 🗑️ Delete                          │
└────────────────────────────────────┘
```

Detection: use `window.matchMedia('(hover: none)')` or viewport width check.

## Implementation

### 1. SessionManager: add renameSession

```ts
async renameSession(sessionId: string): Promise<void> {
  const newName = await this.options.dialogManager.showTextInputDialog({
    title: 'Rename Session',
    message: '',
    confirmText: 'Rename',
    placeholder: 'Session name',
    validate: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return 'Name cannot be empty';
      return null;
    },
  });

  if (!newName) return;

  try {
    const response = await apiFetch(sessionsOperationPath('update'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, name: newName.trim() }),
    });
    if (!response.ok) {
      this.options.setStatus('Failed to rename session');
      return;
    }
    await this.options.refreshSessions(this.options.getSelectedSessionId());
  } catch (err) {
    console.error('Failed to rename session', err);
    this.options.setStatus('Failed to rename session');
  }
}
```

### 2. panelSessionPicker.ts: add action buttons

Extend `SessionPickerOpenOptions`:
```ts
interface SessionPickerOpenOptions {
  // ... existing
  onClearSession?: (sessionId: string) => void;
  onRenameSession?: (sessionId: string) => void;
}
```

In `addItem()`, add clear and rename buttons alongside delete:
- Rename button: pencil icon, shows inline input on click
- Clear button: sweep/broom icon, shows "Clear history?" confirmation
- Delete button: trash icon (existing)

### 3. panelSessionPicker.ts: mobile sub-menu

Add mobile detection:
```ts
private isTouchDevice(): boolean {
  return window.matchMedia('(hover: none)').matches;
}
```

When `isTouchDevice()` is true:
- Don't show hover icons
- First tap on row opens a sub-menu anchored to the row
- Sub-menu has: Open, Rename, Clear history, Delete
- Second tap or sub-menu selection performs action

### 4. styles.css: new styles

```css
/* Action buttons (rename, clear) */
.session-picker-rename-btn,
.session-picker-clear-btn {
  /* Same base styles as .session-picker-delete-btn */
  display: none;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  /* ... */
}

.session-picker-item:hover .session-picker-rename-btn,
.session-picker-item:hover .session-picker-clear-btn,
.session-picker-item.focused .session-picker-rename-btn,
.session-picker-item.focused .session-picker-clear-btn {
  display: inline-flex;
}

/* Rename input state */
.session-picker-item.renaming .session-picker-item-normal {
  display: none;
}

.session-picker-item.renaming .session-picker-item-rename {
  display: flex;
}

.session-picker-rename-input {
  flex: 1;
  min-width: 0;
  padding: var(--spacing-xs);
  /* ... */
}

/* Mobile sub-menu */
.session-picker-submenu {
  position: absolute;
  /* ... similar to popover styles */
}

.session-picker-submenu-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  /* ... */
}
```

## Files to update

- `packages/web-client/src/controllers/sessionManager.ts` — add `renameSession` method
- `packages/web-client/src/controllers/panelSessionPicker.ts` — add action buttons, mobile sub-menu
- `packages/web-client/public/styles.css` — new action button and sub-menu styles
- `packages/web-client/src/utils/icons.ts` — add rename/clear icons if not present

## Test plan

- **Desktop:**
  - Hover session row → see rename, delete, clear icons
  - Click rename → inline input appears, enter name, confirm → session renamed
  - Click clear → "Clear history?" confirmation, confirm → history cleared, session remains
  - Click delete → "Delete?" confirmation (existing behavior)
  
- **Mobile:**
  - Tap session row → sub-menu appears with Open, Rename, Clear, Delete
  - Tap Open → selects session
  - Tap Rename → dialog appears, enter name → session renamed
  - Tap Clear → confirmation, confirm → history cleared
  - Tap Delete → confirmation, confirm → session deleted
  - Tap outside sub-menu → sub-menu closes

## Open questions

None — requirements are clear.
