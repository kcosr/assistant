# PLAN

## Goal
Add a Notifications panel that lets the app receive, persist, display, and clear notifications from agents, tools, and external scripts.

The panel should support:
- server-side storage with read/unread state and metadata
- optional session linkage for agent-originated notifications
- session-linked notifications expose a dedicated open/focus action on the session label; if invoked, focus the chat if already open, otherwise open a new tab
- session-linked notifications should display the resolved session title instead of a raw session id when available, falling back to the id only when needed
- optional text-to-speech playback when a notification arrives
- Android can act as a gate for autoplay: per-notification TTS request is honored only when the Android-side TTS toggle is enabled
- a panel UI to browse, filter by all/unread, switch between compact/card views, mark read, and clear notifications
- tapping an item toggles that item's read/unread state in either view
- compact view should support a separate expand affordance for showing more detail without overloading the main tap action
- bulk actions such as mark-all-read and clear-all should live in an overflow/menu surface to avoid header clutter
- a narrow/tall panel layout with per-notification source icons and read/unread visual distinction
- notifications stay until cleared
- notifications are sorted newest-first

## Current findings
- The app already has a panel system with:
  - runtime panel registration in the web client
  - persisted panel layouts and inventory
  - `panel_event` WebSocket routing from client to server and back
  - server-side plugin `panelEventHandlers`
- The server also exposes plugin operations as tools and HTTP routes, which is a good fit for external notification creation and management.
- Panels can receive server-pushed events through `onEvent`, and panel UI can call `host.sendEvent(...)` back to the server.
- Existing plugins already use persistent server storage patterns and broadcast panel updates over websockets.
- The native Android client already relies on masked websocket subscriptions for selected event classes (for example TTS/response-related flows), so notifications likely need a distinct event class or maskable stream addition rather than relying only on generic panel-only updates.

## Proposed approach
1. Review the existing panel/plugin patterns for a durable, server-backed data surface.
2. Implement Notifications as a core bundled panel/module with its own server storage, tools, and HTTP endpoints.
3. Define the notification model and lifecycle:
   - id, title, body, timestamp
   - read/unread
   - internal source type (for example: tool, HTTP, CLI)
   - optional sessionId
   - optional TTS flag / payload
   - sort newest-first and keep notifications until cleared
4. Add server storage and operations for creating, listing, updating, clearing, and marking notifications read.
5. Add panel UI for listing notifications, clearing them, and opening linked sessions.
   - narrow/tall layout
   - grouped All/Unread and Card/Compact toggles
   - source icon per notification
   - inline TTS replay control when applicable
   - tap on an item toggles read/unread in both card and compact views
   - compact view has a separate expand affordance for showing more detail
   - session-linked items show a resolved session title in the label area, with raw id fallback only when no title is known
   - session navigation is a dedicated tap target on the session label/action rather than the whole item body
   - mark-all-read and clear-all are exposed via an overflow menu rather than permanent top-level buttons
   - read/unread styling rather than separate status labels
6. Add WebSocket updates so the panel stays live when notifications change.
   - likely introduce a dedicated notification event class rather than only panel-scoped `panel_event` updates
   - update masked websocket subscription support so Android/native clients can opt into notification events
7. Add tests for storage, operations, event delivery, masked subscription behavior, and panel behavior.

## Files likely to change
Likely scope:
- `packages/plugins/core/...` for the new notifications panel/module
- server storage/helpers for notification persistence
- tool/HTTP/CLI ingress definitions
- web panel implementation and styles
- any shared protocol types needed for notification payloads
- tests for server persistence, operations, and UI rendering

## Open questions
- None at the product level for the current planning pass.

## Design docs
- `design.html` — sequence, schema, websocket flow, and interface sketch for the notifications system
- `mock.html` — rough panel mock for layout/density/filter discussion

## Acceptance criteria
- Notifications can be created from the server and persisted across reloads.
- The panel shows unread/read state and basic metadata.
- Tapping an item toggles its read/unread state in either density mode.
- Compact view supports expanding an individual item for more detail.
- The panel supports mark-all-read and clear-all via an overflow/menu surface.
- Linked notifications expose a dedicated session-label/action tap target that can open/focus the related session/chat.
- Session-linked items show the resolved session title when available, with raw id fallback only when no title is known.
- Optional TTS behavior is supported by the model/UI.
- Live updates reach open panels without refresh, including for masked native notification subscriptions.
- Tests cover the storage, websocket delivery, and UI flow for the new panel.
