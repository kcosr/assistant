# Notifications Panel

## Goal

Add a core bundled Notifications panel that lets the app receive, persist, display, and clear notifications from agents, tools, and external scripts.

## Design inputs

- `.review-inputs/notifications-panel/PLAN.md` — original product plan and locked decisions
- `.review-inputs/notifications-panel/design.html` — architecture diagrams, schema, and UI sketch
- `.review-inputs/notifications-panel/mock.html` — panel layout/density mock (referenced, not reviewed)

## Locked product decisions (carried forward)

- Notifications are created server-side only (tool, HTTP, CLI).
- Each notification: `id`, `title`, `body`, `createdAt`, `readAt | null`, `source`, `sessionId | null`, `tts`.
- Sorted newest-first; persist until explicitly cleared.
- Panel supports All/Unread filter and Card/Compact density toggles.
- Tapping an item toggles read/unread in either density mode.
- Compact view has a separate expand affordance (not overloading the main tap).
- Bulk actions (mark-all-read, clear-all) live in an overflow menu.
- Session-linked items show a resolved session title; dedicated tap target to open/focus session.
- `tts: true` is a request; Android honors only when device-side TTS gate is enabled.

## Review issues addressed

The original plan had several gaps that would block implementation. This rewrite addresses:

1. **No implementation sequencing** — now broken into ordered, dependency-aware phases.
2. **Operations pattern not used** — plan now uses manifest `operations` (auto-generates HTTP/CLI/tool surfaces) instead of bespoke REST routes.
3. **Toggle read/unread underspecified** — added explicit `toggle_read` operation.
4. **Session title resolution hand-waved** — server now resolves and includes `sessionTitle` in the record (panel is global, has no session context).
5. **New WebSocket message type underspecified** — detailed the protocol changes and noted `broadcastToAll` bypasses masks (so no mask changes needed for v1).
6. **No panel badge** — added unread-count badge on the panel tab via `setPanelMetadata`.
7. **"Files likely to change" too vague** — now lists exact files to create/modify.
8. **No pagination/limits** — added `limit`/`offset` to the list operation and a configurable max-notifications cap.
9. **Build pipeline not mentioned** — noted that the plugin follows existing esbuild/bundle patterns.
10. **TTS on web unspecified** — scoped TTS to Android-only for v1; web shows replay affordance as future placeholder.
11. **`broadcastToAll` bypasses session masks** — the original plan assumed masked subscription filtering for Android. `broadcastToAll` intentionally bypasses masks. For v1, notification events are infrequent and small enough to broadcast to all connected clients. A per-connection global message filter can be added later if needed.

## Notification schema

```typescript
type NotificationSource = 'tool' | 'http' | 'cli';

interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  createdAt: string;          // ISO timestamp
  readAt: string | null;      // null = unread
  source: NotificationSource;
  sessionId: string | null;
  sessionTitle: string | null; // resolved server-side at creation time
  tts: boolean;
}

interface CreateNotificationInput {
  title: string;
  body: string;
  sessionId?: string | null;
  tts?: boolean;
}

interface NotificationListResult {
  notifications: NotificationRecord[];
  total: number;               // total count (for pagination awareness)
}
```

**Change vs original:** Added `sessionTitle` field. The server resolves it from `SessionIndex` at creation time (using `session.name ?? session.attributes?.core?.autoTitle ?? session.lastSnippet ?? sessionId`). This avoids the global panel needing session context at render time.

**Why this works without a fetch:** `SessionIndex` is an in-memory cache (backed by a local JSON file) that is already loaded at server startup. Operation handlers receive it via `ctx.sessionIndex` (`ToolContext.sessionIndex`), and panel event handlers receive it via `PanelEventHandlerContext.sessionIndex`. Calling `sessionIndex.getSession(sessionId)` is a synchronous-style lookup against the in-memory map — no network fetch or subscription needed.

**Staleness trade-off:** The title is snapshotted at creation time. If the session is renamed later, the notification keeps the old title. This is acceptable for v1 — the title at notification time is contextually correct ("this is what the session was called when it notified you"). Re-resolving on render would add complexity and a coupling between the notifications panel and session state that can be deferred.

## Operations (manifest)

These replace the bespoke REST routes from the original plan. Each gets auto-generated HTTP, CLI, and tool surfaces.

| Operation ID | Summary | Key inputs | Capabilities |
|---|---|---|---|
| `create` | Create a notification | `title`, `body`, `sessionId?`, `tts?` | `notifications.write` |
| `list` | List notifications (newest-first) | `unreadOnly?`, `limit?`, `offset?` | `notifications.read` |
| `get` | Get a single notification | `id` | `notifications.read` |
| `toggle_read` | Toggle read/unread state | `id` | `notifications.write` |
| `mark_all_read` | Mark all notifications read | _(none)_ | `notifications.write` |
| `clear` | Delete one notification | `id` | `notifications.write` |
| `clear_all` | Delete all notifications | _(none)_ | `notifications.write` |

The `create` operation is the single server-side entry point. The three ingress adapters (tool, HTTP, CLI) all route through it, with `source` inferred from the calling surface context rather than passed by the caller.

## WebSocket events

New server message type: `notification_event` added to `SERVER_MESSAGE_TYPE_VALUES` in `packages/shared/src/protocol.ts`.

```typescript
// Addition to protocol.ts
interface ServerNotificationEventMessage {
  type: 'notification_event';
  event: 'created' | 'updated' | 'removed' | 'snapshot';
  notification?: NotificationRecord;   // for created/updated
  id?: string;                         // for removed
  notifications?: NotificationRecord[]; // for snapshot
}
```

**Broadcast mechanism:** Web panel communication uses `panel_event` with `panelType: 'notifications'` and a `notification_update` payload — identical to the established artifacts plugin pattern. This routes through the existing `ServerMessageHandler` and `panelHostController.dispatchPanelEvent()` pipeline without any changes to the web client message routing.

The `notification_event` server message type is defined in the protocol for future Android/native client use, where clients may want to subscribe to notifications at the WebSocket level rather than through panel events. For v1, all communication uses `panel_event`.

## Files to create

```
packages/plugins/core/notifications/
├── manifest.json                      # Plugin manifest with operations, panel def
├── server/
│   ├── index.ts                       # createPlugin(): operations + panelEventHandlers
│   ├── index.test.ts                  # Operation + event tests
│   ├── store.ts                       # NotificationsStore (file-based, like artifacts)
│   ├── store.test.ts                  # Storage tests
│   └── types.ts                       # NotificationRecord, CreateNotificationInput
└── web/
    ├── index.ts                       # Panel mount/unmount, event handling, DOM
    └── index.test.ts                  # Panel behavior tests
```

## Files to modify

| File | Change |
|---|---|
| `packages/shared/src/protocol.ts` | Add `'notification_event'` to `SERVER_MESSAGE_TYPE_VALUES`; add `ServerNotificationEventMessageSchema`; add to `ServerMessageSchema` union |
| `packages/agent-server/src/plugins/registry.ts` | Register core notifications plugin |
| `packages/agent-server/esbuild.plugins.mjs` (or equivalent) | Add notifications bundle entry point |

## Implementation phases

### Phase 1: Schema and storage

**Goal:** Notification records can be created, listed, read-toggled, and cleared in-memory and on disk. No UI, no WebSocket, no panel.

**Steps:**
1. Create `packages/plugins/core/notifications/server/types.ts` with `NotificationRecord`, `CreateNotificationInput`, `NotificationSource`, `NotificationListResult`.
2. Create `packages/plugins/core/notifications/server/store.ts`:
   - File-based persistence (JSON file in plugin `dataDir`), following the artifacts store pattern.
   - Methods: `insert(record)`, `list(opts)`, `get(id)`, `toggleRead(id)`, `markAllRead()`, `remove(id)`, `removeAll()`.
   - Enforce newest-first sort. Support `limit`/`offset` and `unreadOnly` filter.
   - Enforce a max-notifications cap (e.g., 500). On insert, prune oldest read notifications when exceeding the cap.
3. Create `packages/plugins/core/notifications/server/store.test.ts` — unit tests for all store methods including cap enforcement and persistence.

### Phase 2: Server plugin and operations

**Goal:** Notifications can be created and managed via tool/HTTP/CLI. Live WebSocket events broadcast on mutations.

**Steps:**
1. Add `'notification_event'` to `SERVER_MESSAGE_TYPE_VALUES` in `packages/shared/src/protocol.ts`. Add `ServerNotificationEventMessageSchema` and include it in `ServerMessageSchema`.
2. Create `packages/plugins/core/notifications/manifest.json`:
   - `id: "notifications"`, `surfaces: { tool: true, http: true, cli: true }`
   - Panel: `type: "notifications"`, `title: "Notifications"`, `icon: "bell"`, `multiInstance: false`, `sessionScope: "global"`, `defaultSessionBinding: "global"`
   - Operations: `create`, `list`, `get`, `toggle_read`, `mark_all_read`, `clear`, `clear_all` (schemas per table above)
3. Create `packages/plugins/core/notifications/server/index.ts`:
   - `initialize(dataDir)`: instantiate `NotificationsStore`.
   - Operation handlers for each operation.
   - `create` handler: validate input, resolve `sessionTitle` from `ctx.sessionIndex` if `sessionId` is provided, insert into store, `ctx.sessionHub.broadcastToAll({ type: 'notification_event', event: 'created', notification })`, return record.
   - Mutation handlers (`toggle_read`, `mark_all_read`, `clear`, `clear_all`): update store, broadcast appropriate `notification_event`.
   - `panelEventHandlers['notifications']`: handle `{ type: 'request_snapshot' }` from panel on mount — respond with full notification list via `sendToClient`.
4. Register the plugin in `packages/agent-server/src/plugins/registry.ts`.
5. Create `packages/plugins/core/notifications/server/index.test.ts` — test operations and WebSocket broadcast behavior.

### Phase 3: Web panel

**Goal:** Functional notifications panel with all specified UX.

**Steps:**
1. Create `packages/plugins/core/notifications/web/index.ts`:
   - Register panel via `window.ASSISTANT_PANEL_REGISTRY.registerPanel('notifications', factory)`.
   - On mount: send `{ type: 'request_snapshot' }` via `host.sendEvent()` to get initial data.
   - State: notification list, filter (all/unread), density (card/compact), expanded item IDs (compact mode), overflow menu open.
   - Render: header with filter toggle + density toggle + overflow menu button.
   - `onEvent` handler: process `notification_event` messages (`created`/`updated`/`removed`/`snapshot`) and update local state.
2. Implement notification item rendering:
   - Source icon per notification (tool/http/cli icons).
   - Read/unread visual distinction via styling (e.g., unread has accent border/dot, read is muted).
   - Tap on item body: call `toggle_read` operation via `host.sendEvent({ type: 'toggle_read', id })`.
   - Card mode: show title, body preview, timestamp, source icon; if `sessionTitle`/`sessionId`, show session label with dedicated tap action.
   - Compact mode: show title, timestamp, source icon, expand chevron; expand chevron reveals body and session label.
   - Session label tap: use `host.openPanel('chat', { binding: { mode: 'fixed', sessionId }, focus: true })` or `host.activatePanel(existingPanelId)` by inspecting layout context.
   - TTS replay: if `tts: true`, show a subtle speaker icon. (v1: no web playback, visual indicator only.)
3. Implement overflow menu:
   - Mark all read: send `{ type: 'mark_all_read' }` via `host.sendEvent`.
   - Clear all: send `{ type: 'clear_all' }` via `host.sendEvent`.
4. Implement panel badge:
   - On every state update, compute unread count and call `host.setPanelMetadata({ badge: unreadCount > 0 ? String(unreadCount) : undefined })`.
5. Add build entry point for the notifications web bundle in the esbuild config.
6. Create `packages/plugins/core/notifications/web/index.test.ts` — test rendering, state transitions, and event handling.

### Phase 4: Integration and polish

**Goal:** End-to-end validation and edge cases.

**Steps:**
1. Integration test: create notification via tool operation, verify it appears in panel, toggle read, clear, verify WebSocket events fire correctly.
2. Verify session title resolution: create notification with `sessionId`, confirm `sessionTitle` is populated. Create with invalid/missing session, confirm graceful fallback to `sessionId`.
3. Verify session navigation: tap session label on a notification, confirm it opens/focuses the correct chat panel.
4. Verify panel badge: confirm unread count updates on create, toggle, mark-all-read, clear.
5. Verify persistence: create notifications, restart server, confirm they survive reload.
6. Verify cap enforcement: insert notifications beyond the cap, confirm oldest read entries are pruned.
7. Update `CHANGELOG.md` under `## [Unreleased]` with the new feature.

## Open questions

- **Notification cap value**: 500 is a reasonable default. Should this be configurable via plugin config?
- **Session title staleness**: Resolved — accept staleness for v1. See schema section for rationale.

## Deferred items

Items from the original product plan that are not yet implemented. The `notification_event` protocol type and `tts` schema field are in place as forward-compatible hooks.

### TTS playback (not wired)

The original plan specified:
- Optional text-to-speech playback when a notification arrives
- Android acts as a gate: per-notification TTS request honored only when the Android-side TTS toggle is enabled
- Inline TTS replay control in the panel UI

**Current state:** The `tts` boolean field is stored in the notification record and a speaker icon renders in the panel for `tts: true` items, but nothing plays on any platform. The icon has no click handler.

**To complete:**
- **Web:** Add a Web Speech API or server-side TTS integration triggered by `tts: true` on `created` events. Needs a client-side setting to enable/disable.
- **Android:** Wire the native voice session socket to subscribe to notification events and check the device-side TTS gate before speaking.
- **Replay:** Add a click handler to the speaker icon that re-speaks the notification title/body.

### Android/native background delivery (not wired)

The original plan specified:
- A dedicated `notification_event` WebSocket message type (distinct from `panel_event`)
- Updated masked WebSocket subscription support so Android/native clients can explicitly opt into notification events
- The sequence diagram showed Android receiving `notification_created` events via hub broadcast

**Current state:** The `notification_event` type is defined in the shared protocol (`packages/shared/src/protocol.ts`) but is not used for delivery. All panel communication uses `panel_event` with `panelType: 'notifications'`, which routes through the existing panel event pipeline. Android's native voice socket subscribes only to `transcript_event` with specific masks — it does not receive notification events.

**Key constraint:** `broadcastToAll` bypasses per-session subscription masks, so connected clients would receive `panel_event` broadcasts regardless of masks. However, if the Android WebView or native socket is disconnected (app backgrounded/killed), nothing is delivered.

**To complete:**
- Option A: Have the server emit both `panel_event` (for web panels) and `notification_event` (for native clients) on mutations. Add a native-side WebSocket connection or background service that subscribes to `notification_event`.
- Option B: Integrate with FCM/APNs for out-of-band push delivery when the app is not connected, using the server as the push origin.
- Either way, the Android voice session socket protocol (`AssistantVoiceSessionSocketProtocol.java`) needs to add `notification_event` to its `serverMessageTypes` mask, or use a separate connection without masks.

### Notification cap configurability

The store enforces a 500-notification cap with oldest-read pruning. Whether this should be configurable via plugin config (e.g., `plugins.notifications.maxNotifications`) is an open question.

## Acceptance criteria

- Notifications can be created via tool, HTTP, and CLI operations and persist across server restarts.
- The panel shows unread/read state with visual styling distinction and supports All/Unread filtering.
- Tapping an item toggles its read/unread state in either Card or Compact view.
- Compact view supports expanding an item via a dedicated affordance.
- Mark-all-read and clear-all are available via overflow menu.
- Session-linked notifications show a resolved session title and have a dedicated tap target that opens/focuses the related chat.
- Panel tab shows an unread-count badge.
- Live updates reach open panels without refresh via `panel_event` WebSocket messages.
- A max-notifications cap prevents unbounded growth.
- Tests cover storage, operations, WebSocket delivery, and panel behavior.
