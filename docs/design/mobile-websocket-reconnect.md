# Mobile WebSocket Resume Reconnect

## Problem
On mobile web and Capacitor builds, resuming from background can leave the client in a perpetual
"reconnecting" state. The reconnect timeout is scheduled while backgrounded and may not fire
promptly after resume, leaving the socket closed and no immediate reconnect attempt.

## Goals
- Ensure the client attempts an immediate reconnect when returning to the foreground or network
  connectivity is restored.
- Avoid reconnect churn when the socket is already healthy.

## Approach
- Add a `ConnectionManager.ensureConnected(reason)` helper that:
  - No-ops when the current socket is open.
  - Clears any pending reconnect timeout.
  - Initiates a fresh `connect()` when the socket is not open.
- Hook client lifecycle events to call `ensureConnected`:
  - `document.visibilitychange` when the page becomes visible.
  - `window.online` and `window.pageshow` (persisted) to handle network and back-forward cache.

## Tests
- Add unit tests for `ConnectionManager.ensureConnected` to verify:
  - No reconnect when the socket is open.
  - Pending reconnect timers are cleared and `connect()` is invoked when disconnected.

## Files to Update
- `packages/web-client/src/controllers/connectionManager.ts`
- `packages/web-client/src/controllers/connectionManager.test.ts`
- `packages/web-client/src/index.ts`
- `CHANGELOG.md`
- `docs/design/mobile-websocket-reconnect.md`
