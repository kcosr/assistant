# Android Capacitor lifecycle hooks for window slots + chat refresh

## Overview
- When the Android Capacitor app backgrounds or is closed, release the current window slot (window profile) so reopening doesn't wait for the lease timeout.
- On app resume/foreground, refresh open chat panels using the same logic as the chat refresh button (force transcript reload).
- Implementation lives in the `skills` subdirectory (`packages/web-client`).

## Motivation
- Window slot leases persist for 15 seconds; if the app is force-closed and reopened quickly, the prior slot still appears active and a new slot is chosen. Releasing the slot on background avoids the wait and preserves the expected layout/profile.
- Chat transcripts can be stale on resume; a targeted refresh keeps panels current without a full page reload.

## Proposed Solution
- Add an exported helper in `packages/web-client/src/utils/windowId.ts` to mark a slot inactive (release the active slot entry for the current owner), e.g., `deactivateWindowSlot(windowId: string)`.
- In Capacitor builds, treat window slots as single-instance: on startup reuse the last-used slot and persist/adopt a stable owner id across restarts so the previous slot is not temporarily shown as “in use”.
- Replace `enableAppReloadOnResume` with a lifecycle helper in `packages/web-client/src/utils/capacitor.ts`:
  - Register `App.addListener('appStateChange', ...)`.
  - When `isActive` becomes `false`, invoke an `onBackground` callback (release the window slot).
  - When `isActive` becomes `true` after a background transition, invoke `onResume`.
  - Add a `document.visibilitychange` fallback in case `appStateChange` doesn’t fire (guard against double refresh).
  - Keep no-op behavior when not in Capacitor Android.
- In `packages/web-client/src/index.ts`:
  - Replace `enableAppReloadOnResume()` with the new lifecycle helper (full page reload removed).
  - `onBackground`: call `deactivateWindowSlot(WINDOW_ID)` to clear the active slot immediately.
  - `onResume`: refresh sessions list/sidebar and force-refresh all bound chat panels:
    - `refreshSessions(...)` to update the sidebar.
    - `refreshOpenChatPanelTranscripts()` to loop over `getChatPanelSessionIds()` and run `loadSessionTranscript(sessionId, { force: true })` (matches the refresh button behavior).
  - Restart the window-slot heartbeat on resume to re-assert the active slot.

## Files to Update
- `packages/web-client/src/utils/windowId.ts` (export slot deactivation helper)
- `packages/web-client/src/utils/capacitor.ts` (appStateChange lifecycle helper)
- `packages/web-client/src/index.ts` (wire lifecycle callbacks, add refresh helper)
- `packages/web-client/src/utils/capacitor.test.ts` (add appStateChange test, if feasible)
- `packages/web-client/src/utils/windowId.test.ts` (test deactivation helper, if added)

## Implementation Steps
1. Add `deactivateWindowSlot` (or similar) export that removes the active slot entry for the current owner.
2. Implement a Capacitor lifecycle helper that accepts `onBackground`/`onResume` callbacks.
3. Add `refreshOpenChatPanelTranscripts()` that forces transcript reload for all bound chat panels.
4. Wire lifecycle callbacks in `index.ts` using `WINDOW_ID`.
5. Update tests or add new ones for the lifecycle and window slot deactivation helpers.

## Decisions
- Replace the existing full page reload on resume; use targeted refresh instead (reload currently doesn’t resolve stale data).
- Refresh **all** bound chat panels on resume.
- Refresh the sessions list/sidebar on resume via `refreshSessions`.

## Open Questions
- None.

## Alternatives Considered
- Keep `window.location.reload()` on resume: simple but heavy and resets the UI.
- Reduce the window slot lease timeout: still delays reopen and doesn't refresh chat content.
- Use `document.visibilitychange` instead of Capacitor lifecycle hooks: may be less reliable for full app background on Android.

## Out of Scope
- Native Android (Capacitor) plugin/MainActivity changes; stick to the JS `@capacitor/app` hooks for now.
- iOS lifecycle handling changes.
- Server-side panel inventory / window slot lease logic changes.
- Automatic session sync beyond transcript refresh.
