# Status Bar Theme Sync Plan

## Goal
Make the Android native status bar icon/text appearance follow the web app's effective light/dark theme so status bar content stays readable for:
- initial app launch
- manual theme changes in Settings
- live OS theme changes while the app is using `auto`

## Current Findings

### Web theme source of truth
- Theme preferences are loaded and applied in `packages/web-client/src/index.ts`.
- `syncThemePreferences()` already centralizes all theme updates:
  - `init` on startup
  - `user` when the theme select changes
  - `system` when `watchSystemThemeChanges()` fires for `auto`
- `applyThemePreferences()` in `packages/web-client/src/utils/themeManager.ts` resolves the effective scheme and returns it as `detail.scheme`.
- `applyThemePreferences()` also emits `assistant:theme-updated`, but that event is currently informational only.

### Current Capacitor status bar behavior
- `packages/web-client/src/utils/capacitor.ts` has `configureStatusBar()`.
- That function currently:
  - applies Android CSS/layout shims
  - imports `@capacitor/status-bar`
  - unconditionally calls `StatusBar.setStyle({ style: Style.Dark })`
- Result: the status bar is configured once and never updated when the app theme changes.

### Native/plugin constraints
- `@capacitor/status-bar` is already installed for the mobile build.
- Capacitor's official docs define:
  - `Style.Dark` = light text/icons for dark backgrounds
  - `Style.Light` = dark text/icons for light backgrounds
- The same docs note that `backgroundColor` and `overlaysWebView` are ineffective on Android 16+, but `setStyle()` still applies. That matches this task: we only need icon/text style sync, not background control.

## Chosen Integration Point
Use `syncThemePreferences()` in `packages/web-client/src/index.ts` as the only place that tells the native layer about theme changes.

Why this is the best integration point:
- it already sees every meaningful theme transition
- it already has the resolved effective scheme, so the bridge does not need to re-implement theme resolution
- it covers startup and runtime changes with one path
- it keeps `themeManager.ts` platform-agnostic and keeps Capacitor-specific code in `capacitor.ts`
- it avoids making core behavior depend on a window-level custom event listener

The existing `assistant:theme-updated` event can remain for other consumers, but the status bar sync should be a direct call, not an event side effect.

## Proposed Data Flow
1. App startup loads saved theme preferences in `packages/web-client/src/index.ts`.
2. `syncThemePreferences('init')` calls `applyThemePreferences(...)`.
3. `applyThemePreferences(...)` returns `ThemeUpdateDetail`, including the resolved `scheme` (`light` or `dark`).
4. `syncThemePreferences(...)` immediately calls a Capacitor helper with that resolved scheme.
5. The Capacitor helper maps web scheme to native status bar style:
   - `dark` web scheme -> `Style.Dark`
   - `light` web scheme -> `Style.Light`
6. The helper calls `StatusBar.setStyle(...)` only when running on Capacitor Android.
7. The same path runs again for:
   - manual theme selection changes
   - `prefers-color-scheme` changes while `themeId === 'auto'`

## Implementation Design

### 1. Split static Android setup from dynamic style sync
Keep `configureStatusBar()` responsible for Android WebView/layout setup only:
- set `--capacitor-status-bar-height`
- set `--capacitor-nav-bar-height`
- add `.capacitor-android`
- enable keyboard visibility handling

Remove the hardcoded `StatusBar.setStyle({ style: Style.Dark })` from this startup-only setup.

### 2. Add a dedicated status bar theme bridge
Add a helper in `packages/web-client/src/utils/capacitor.ts`, for example:
- `syncStatusBarThemeForScheme(scheme: ThemeScheme, options?)`

Expected behavior:
- no-op outside Capacitor Android
- lazy-import `@capacitor/status-bar`
- map resolved scheme to Capacitor style enum
- swallow plugin/import failures like the other Capacitor helpers
- cache the last applied native style to avoid redundant bridge calls when:
  - fonts change without scheme changes
  - `auto` recalculates to the same scheme
  - startup/re-render paths repeat the same state

### 3. Call the bridge from the existing theme sync path
Update `packages/web-client/src/index.ts`:
- after `const detail = applyThemePreferences(...)`
- call `void syncStatusBarThemeForScheme(detail.scheme)`

This gives one explicit path for:
- first render after preferences load
- user-initiated theme changes
- system dark/light changes in `auto`

### 4. Keep theme resolution in one place
Do not make the Capacitor helper inspect `localStorage`, `matchMedia`, or DOM attributes.

The helper should receive the resolved scheme from `applyThemePreferences(...)`. That keeps the native bridge dumb and prevents web/native theme logic from diverging.

## Task Breakdown

### Task 1: Add native sync helper
- File: `packages/web-client/src/utils/capacitor.ts`
- Add scheme-to-status-bar-style mapping helper.
- Add last-applied caching for the native style.
- Keep failure behavior silent/no-op outside Capacitor Android.

### Task 2: Refactor startup setup
- File: `packages/web-client/src/utils/capacitor.ts`
- Remove the unconditional startup `Style.Dark` call from `configureStatusBar()`.
- Leave the Android CSS/layout setup intact.

### Task 3: Wire theme updates to native sync
- File: `packages/web-client/src/index.ts`
- Call the new helper from `syncThemePreferences()` using `detail.scheme`.

### Task 4: Add unit coverage
- File: `packages/web-client/src/utils/capacitor.test.ts`
- Cover:
  - `dark` scheme maps to `Style.Dark`
  - `light` scheme maps to `Style.Light`
  - non-Android / non-Capacitor is a no-op
  - repeated same-scheme syncs do not call `setStyle` again
  - importer/plugin failures are swallowed

### Task 5: Validate on Android
- Manual verification on a Capacitor Android build:
  - launch with saved dark theme
  - launch with saved light theme
  - switch theme in Settings while app is open
  - use `auto`, then change device theme while app is foregrounded

## Edge Cases And Risks

### Startup mismatch window
- `configureStatusBar()` currently runs before theme preferences are applied in `main()`.
- After the refactor, the first correct native style will be applied from `syncThemePreferences('init')`.
- This should still happen very early, but there may be a brief mismatch during startup on light themes because the bridge call is async.
- If this flash is noticeable, a follow-up optimization is to move the initial theme preference load even earlier in `main()` so the first native sync happens as soon as possible.

### `auto` mode must track effective scheme, not stored theme id
- The native bridge must not receive `'auto'`.
- It must receive the resolved effective scheme from `applyThemePreferences(...)`.

### Font-only preference changes
- Changing UI/code font currently reuses `syncThemePreferences()`.
- Without caching, font changes would spam `StatusBar.setStyle(...)` even though the scheme did not change.
- The helper should dedupe by last applied native style.

### Android-only behavior
- This change should be a no-op on:
  - desktop web
  - mobile browser
  - non-Android Capacitor targets unless explicitly expanded later

### Status bar background is out of scope
- This plan only syncs icon/text contrast.
- Do not add background-color management as part of this change.
- Capacitor docs explicitly warn that `backgroundColor`/`overlaysWebView` do not behave the same on newer Android versions, so that would expand scope and platform risk.

### Existing theme attribute inconsistency
- The preload script in `packages/web-client/public/index.html` sets `data-theme-tone`.
- Runtime theme application sets `data-theme-scheme`.
- This is not required for the status bar fix because the bridge should use `detail.scheme` directly.
- Still, it is worth noting as a separate cleanup item because it shows two parallel representations of the same light/dark state.

## Files Expected To Change
- `packages/web-client/src/utils/capacitor.ts`
- `packages/web-client/src/utils/capacitor.test.ts`
- `packages/web-client/src/index.ts`
- `CHANGELOG.md`

## Out Of Scope
- status bar background color changes
- iOS-specific status bar theming work
- redesigning the broader theme bootstrap flow
- unifying `data-theme-tone` vs `data-theme-scheme` in this same task unless it becomes necessary during implementation

## Recommended Implementation Order
1. Add and test the new Capacitor status bar sync helper.
2. Remove the hardcoded startup style from `configureStatusBar()`.
3. Wire `syncThemePreferences()` to call the helper with `detail.scheme`.
4. Run focused web-client tests.
5. Verify behavior on Android manually.
