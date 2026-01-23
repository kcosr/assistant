---
name: plugins-guide
description: Best practices for working with plugins in the kcosr/assistant repository.
---

# Plugin Development Guide (General Best Practices)

This guide captures reusable patterns for building panel plugins: panel chrome, operations vs. WebSocket usage, binary endpoints, icons, CLI packaging, and cross‑platform behavior.

---

## 1. Panel Header Chrome (Standard Controls)

**All panels should render the standard chrome header** and let the shared `PanelChromeController` wire up controls. The header is built from three sections:

1. **Main** (title + optional instance dropdown)
2. **Plugin controls** (custom buttons)
3. **Frame controls** (toggle/move/reorder/menu/close)

### Required structure

```html
<div class="panel-header panel-chrome-row" data-role="chrome-row">
  <div class="panel-header-main">
    <span class="panel-header-label" data-role="chrome-title">Panel Title</span>
    <div class="panel-chrome-instance" data-role="instance-actions">
      <!-- Instance dropdown markup here -->
    </div>
  </div>
  <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls">
    <!-- plugin-specific buttons go here -->
  </div>
  <div class="panel-chrome-frame-controls" data-role="chrome-controls">
    <!-- standard move/reorder/menu/close buttons -->
  </div>
</div>
```

### Frame controls markup

Copy the structure from existing panels like **notes** or **scheduled-sessions** (includes toggle, move, reorder, menu, close). The `PanelChromeController` attaches handlers based on `data-action` attributes.

---

## 2. PanelChromeController Responsibilities

The controller:
- wires up frame controls
- manages responsive layout
- optionally wires up the instance dropdown

You must pass the instance dropdown container with:

```html
<div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">…</div>
```

Then initialize:

```ts
chromeController = new PanelChromeController({
  root: container,
  host,
  title: 'Panel Title',
  onInstanceChange: (instanceId) => {
    selectedInstanceId = instanceId;
    persistState();
    void refreshList();
  },
});
```

### Multi‑profile selection (shared profiles)

Instance IDs now map to **shared profiles** declared at the top level `profiles` config.
When you want multi‑profile selection in a panel, opt into it explicitly:

```ts
chromeController = new PanelChromeController({
  root: container,
  host,
  title: 'Notes',
  instanceSelectionMode: 'multi',
  onInstanceChange: (instanceIds) => {
    selectedInstanceIds = instanceIds;
    activeInstanceId = instanceIds[0] ?? 'default';
    persistState();
    void refreshList();
  },
});

chromeController.setInstances(instances, selectedInstanceIds);
```

**Context:** include both the active instance and the full selection:

```ts
host.setContext(contextKey, {
  instance_id: activeInstanceId,
  instance_ids: selectedInstanceIds,
  contextAttributes: {
    'instance-id': activeInstanceId,
    'instance-ids': selectedInstanceIds.join(','),
  },
});
```

Notes:
- `default` is always available (implicit).
- Non‑default instance ids must match a configured profile id.
- Items still belong to a single instance/profile (edits happen in one profile).

---

## 3. Icons and Header Dock

Panel icons shown in the **header dock** come from the **panel manifest**. The manifest `icon` value must match a key in `packages/web-client/src/utils/icons.ts`.

Example:

```json
"icon": "fileText"
```

If the icon name is invalid, the UI falls back to `panelGrid` (window/grid icon).

---

## 4. Operations vs WebSocket for CRUD

### Recommended pattern

Use **HTTP operations** for CRUD and **WebSocket events only for broadcast updates**:

- `list`, `create`, `update`, `delete` → **HTTP operations**
- real‑time updates → **WebSocket `panel_update`**

This avoids startup races when WebSocket isn’t ready yet (common on mobile).

### Generic helper

```ts
async function callOperation<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/plugins/<pluginId>/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as { ok: true; result: T } | { error: string };
  if (!response.ok || 'error' in payload) throw new Error(payload.error);
  return payload.result;
}
```

---

## 5. Extra HTTP Routes for Binary Files

Operations always return JSON. For binary endpoints (file download/preview), use **`extraHttpRoutes`** in the plugin module:

```ts
extraHttpRoutes: [
  async (_context, req, res, url, segments) => {
    if (req.method === 'GET' && segments[3] === 'files') {
      res.setHeader('Content-Disposition', 'inline; filename="..."');
      res.end(fileBuffer);
      return true;
    }
    return false;
  },
]
```

This is documented in `docs/PLUGIN_SDK.md`.

---

## 6. View vs Download Behavior

When serving files, support both:

- **View (inline)** — default
- **Download (attachment)** — via query param (e.g. `?download=1`)

This enables an “open in browser” action and a “download” action with the same endpoint.

---

## 7. API Base URL

When building URLs for fetch/open, use helpers in `web-client/src/utils/api.ts`:

- `apiFetch()` for relative API calls
- `getApiBaseUrl()` for full URLs when opening externally

This ensures URLs work in **Tauri**, **Capacitor**, and **web**.

---

## 8. Platform-Specific Open/Save

### Web
- `window.open(url, '_blank')` for view
- `<a download>` for download

### Tauri Desktop
- **View:** `plugin:shell|open`
- **Download:** native save dialog + backend command to write file

### Capacitor Mobile
- **View:** `@capacitor/browser`
- **Download:** `@capacitor/filesystem` + optional `@capacitor/share`

---

## 9. Custom CLI Bundling

Plugins can ship a custom CLI by placing `bin/cli.ts` in the plugin directory.

Build system compiles this file instead of auto‑generating a CLI from operations. Use this for:
- reading files (`--file`)
- custom args / processing
- client-side behaviors before calling the API

---

## 10. Theme Variables

Use shared theme variables:

- `--color-text-primary`
- `--color-text-secondary`
- `--color-bg-hover`
- `--color-bg-active`

Avoid custom fallbacks like `--text-primary` or `prefers-color-scheme` blocks.

---

## 11. Shared Dialog Styling Duplication

Some dialogs are rendered by shared web-client controllers but styled in multiple plugin bundles.
For example, list metadata dialog styles live in both:
- `packages/plugins/official/lists/web/styles.css`
- `packages/plugins/official/notes/web/styles.css`

When adjusting `.list-metadata-*` rules (or similar shared dialog styles), update both files to keep
Lists and Notes consistent.

---

## 12. Panel Context for Chat Input

Panels can provide context that is injected into user chat messages and shown in the
context preview above the input. Use the panel context key and include selection data.

### Required pattern

```ts
const contextKey = getPanelContextKey(host.panelId());
host.setContext(contextKey, {
  type: 'list', // or 'artifacts', 'note', etc.
  id: activeContainerId,
  name: activeContainerName,
  description: activeContainerDescription ?? '',
  selectedItemIds,
  selectedItems, // [{ id, title }]
  selectedItemCount: selectedItemIds.length,
  contextAttributes: {
    'instance-id': selectedInstanceId,
    // add custom attributes like 'selected-text' for text selections
  },
});
services.notifyContextAvailabilityChange();
```

### Notes

- `type`, `id`, and `name` are used to build the `<context ... />` line in chat.
- `selectedItemIds`/`selectedItems` populate selection context (e.g., list rows).
- `contextAttributes` is a key/value bag for extra metadata (keys should be kebab-case).
- Call `services.notifyContextAvailabilityChange()` after updates so the preview refreshes.
- Listen for `assistant:clear-context-selection` if you support selection clearing.

---

## 13. Recommended Panel Lifecycle

On mount:
- fetch instances via HTTP
- fetch initial list via HTTP
- subscribe to WebSocket updates

On visibility change:
- refresh list via HTTP

---

This guide is meant as a reusable checklist for future plugin work (operations + binary endpoints, panel chrome, icons, CLI, and cross‑platform behaviors).
