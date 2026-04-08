# Mobile Web – Capacitor Build

This package contains the Capacitor scaffolding to build the AI Assistant web client (`packages/web-client/public`) as a native mobile application for Android and iOS.

## Table of Contents

- [Layout](#layout)
- [Source files](#source-files)
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Syncing Web Assets](#syncing-web-assets)
- [Build and Run](#build-and-run)
- [Android Patches](#android-patches)
- [Build Flavors](#build-flavors)
- [Notes](#notes)
- [Security Considerations](#security-considerations)

## Layout

- `mobile-web/` – Capacitor project root
- `mobile-web/android/` – Committed Android project source
- `mobile-web/ios/` – Generated iOS native project (not committed)
- `mobile-web/resources/` – Mobile icon sources for Capacitor asset generation

## Source files

- `packages/mobile-web/capacitor.config.json`
- `packages/mobile-web/scripts/patch-android-security.mjs`
- `packages/mobile-web/scripts/patch-android-fontscale.mjs`
- `packages/mobile-web/scripts/patch-android-share.mjs`
- `packages/mobile-web/scripts/patch-android-firebase.mjs`

## Prerequisites

### Android

- Node.js 18+ and npm
- Android Studio + Android SDK (SDK Platform + Build-Tools)
- Java JDK 17
- `ANDROID_HOME` configured and `platform-tools` on PATH (for `adb`)

### iOS

- macOS with Xcode installed
- CocoaPods (`sudo gem install cocoapods`)

## Initial Setup

First, build the web client:

```bash
cd packages/web-client
npm run build
```

Then set up the mobile project:

```bash
cd packages/mobile-web
npm install
```

### Android

The repository keeps `android/` as source. Restore it from git if it is missing or incomplete;
do not regenerate it during normal build or deploy flows.

### iOS

```bash
npm run ios:add       # generates ios/ (one-time)
```

## Syncing Web Assets

After changes to `packages/web-client/public`, sync them to the native project:

```bash
npm run android:sync
# or
npm run ios:sync
```

## Build and Run

### Android

```bash
# Debug APK
npm run android:build

# Install on connected device/emulator
npm run android:run

# Run Android unit tests from the source tree
npm run android:test

# Open in Android Studio
npm run android:open

# Release build
npm run android:build:release

# Environment diagnostics
npm run android:doctor
```

`android:test` is the preferred source-tree unit-test entrypoint because it runs
`android:sync` first, which regenerates Capacitor-managed files such as
`android/capacitor.settings.gradle` before invoking Gradle.

### iOS

```bash
# Open in Xcode
npm run ios:open

# Sync assets
npm run ios:sync
```

## Android Patches

The following patches are applied automatically on `android:sync`:

### Network Security Config (`patch-android-security.mjs`)

- Trusts system and user-installed CAs for self-signed certificate support
- Adds `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` permissions for microphone input
- Writes `res/xml/network_security_config.xml`
- Updates `AndroidManifest.xml` with `android:networkSecurityConfig`

### Font Scale (`patch-android-fontscale.mjs`)

- Sets WebView text zoom level for font sizing
- Patches `MainActivity.java` with onCreate override

### Share Intent (`patch-android-share.mjs`)

- Adds intent-filter to receive shared text content from other apps
- Shared content still opens the in-app destination modal:
  - **Chat Input** - Populates the chat input field
  - **New Note** - Creates a new note with the shared content
  - **Add to List** - Adds a new item to a selected list
  - **Fetch to List** - (Only shown when shared content contains a URL) Sends the URL to the agent with a prompt to fetch the page content and add it to a selected list
- On Android, the chat-based share actions (`Chat Input` and `Fetch to List`) prefer the configured
  native voice session and fall back to the normal session picker when no preferred session is set

### Firebase Config (`patch-android-firebase.mjs`)

- Copies `google-services.json` to `android/app/` for Firebase Cloud Messaging (FCM)
- Required for push notifications

### Native Voice Runtime

- The Android app includes a committed local Capacitor plugin, `AssistantNativeVoice`, and a foreground
  service, `AssistantVoiceRuntimeService`.
- The native runtime receives voice-mode config from the web layer, subscribes to the selected
  Assistant session over the main Assistant websocket for live `transcript_event` updates,
  consumes durable notifications from the notifications plugin over HTTP + `panel_event`
  updates, plays queued `voice_speak` / `voice_ask` / response work through `agent-voice-adapter`,
  and submits successful spoken replies back through the existing sessions message route.
- Android-native voice settings now include a client-side `TTS gain` slider for native playback,
  clamped to `25%`-`500%`, and applied as PCM software gain inside the Android player.
- Android-native recognition also plays positive/negative PCM cue tones on the same native media
  path for ready, success, timeout/no-speech, error, and manual-stop events, with an on/off toggle
  plus a `Recognition cue gain` slider clamped to `25%`-`500%`. Native voice settings also expose
  a `Startup pre-roll (ms)` slider clamped to `0`-`4096`, defaulting to `512`, which controls the
  silence prepended before recognition cue playback warms the media path.
- The persistent Android notification now also includes a native-only Bluetooth/headset media-button
  capture toggle. When enabled, the foreground service activates an Android `MediaSession` so
  supported Bluetooth/headset media button presses toggle the existing native start/stop voice flow
  based on runtime state. The toggle is persisted in native config and may compete with other media
  apps for headset button ownership while enabled.
- The same persistent Android notification also exposes compact icon actions for `Speak` or `Stop`
  depending on runtime state, the Bluetooth/headset media-button capture toggle, and a voice-mode
  cycle action for `Off`, `Tool`, or `Response`. `Off` leaves the foreground notification alive so
  the mode can be cycled back on without reopening the web UI, while the direct Speak/Stop action
  stays hidden when voice mode is disabled.
- The native voice runtime also keeps a rolling app-private event log at `files/voice-runtime.log`
  so random TTS/STT state issues can be inspected later over `adb`, even after the live logcat
  window has moved on. Retrieve it with:

```bash
# default flavor
adb -s <device> exec-out run-as com.assistant.app cat files/voice-runtime.log

# work flavor
adb -s <device> exec-out run-as com.assistant.work cat files/voice-runtime.log
```

  For immediate live tracing, `adb logcat -d | rg 'AssistantVoice(RuntimeService|Plugin|EventLog|MicStreamer)'`
  is still the fastest first pass.
- The recognition start cue is an arming cue that plays with a short native media preroll, fully
  drains, then waits a brief settle delay before native mic startup begins. The completion cue is
  deferred until recording has actually stopped, capture focus has been released, and a longer
  media-route settle delay has elapsed before the tone plays.
- A final native STT transcript of exactly `stop` is treated as a local stop command instead of
  being forwarded to the LLM. That path plays the same negative completion cue used for canceled
  or aborted recognition and leaves the runtime idle without surfacing an error.
- Session-linked voice notifications now drive a one-at-a-time Android-local queue. If the runtime
  is already alive, automatic `voice_speak`, `voice_ask`, and response-mode final replies queue
  behind the active local interaction instead of being dropped solely because the runtime was busy.
- Final assistant replies are persisted as one durable `session_attention` item per session, while
  `voice_speak` and `voice_ask` remain append-only notifications with explicit `voiceMode`
  metadata. Auto-listen-capable items carry a server-generated session activity sequence so stale
  queued asks can be invalidated before recognition begins.
- Durable session-linked notifications expose `Play` and `Speak` actions both from the Android
  system notification shade and from the in-app Notifications panel cards. Manual actions
  reconstruct fresh local queue items from the stored notification, jump ahead of automatic work,
  and discard interrupted automatic playback instead of requeueing it.
- Automatic voice admission remains local-only. If the Android runtime was not alive when a
  notification arrived, the notification stays durable for manual recovery later, but missed
  automatic playback is not replayed by default when the app comes back.
- Session changes, adapter URL changes, or explicit `Stop` still terminate the current playback or
  listening pass immediately, and `Stop` clears the current Android-local backlog.

**Configuration:**

Set the `WEBVIEW_TEXT_ZOOM` environment variable to customize the zoom level (default: 100):

```bash
# 120% zoom (larger text)
WEBVIEW_TEXT_ZOOM=120 npm run android:sync
```

Valid values are 50-300, where 100 is normal size.

## Icons

Capacitor app icons are generated from `resources/icon.svg` (copied from the desktop icon).
Run `npm run icons:generate` after updating the source. Icon generation runs automatically
as part of `android:add`, `android:sync`, `ios:add`, and `ios:sync`.

## Build Flavors

Flavors let you build multiple app instances with different identities and API
endpoints so they can be installed side-by-side on the same device.

Flavor definitions live in `flavors.json`:

```json
{
  "default": {
    "appId": "com.assistant.app",
    "appName": "Assistant",
    "apiHost": "https://assistant"
  },
  "work": {
    "appId": "com.assistant.work",
    "appName": "Assistant Work",
    "apiHost": "https://assistant/assistant-work"
  }
}
```

Each flavor specifies:

- **appId** – Android package name / iOS bundle ID (must differ for side-by-side installs)
- **appName** – Display name shown on the home screen
- **apiHost** – Build-time fallback written to `ASSISTANT_API_HOST` in the packaged web assets

### Applying a flavor

```bash
# See available flavors
npm run flavor

# Apply the default flavor
npm run flavor default
```

The committed Android sources stay on a shared namespace (`com.assistant.mobile`).
Flavor deploys stage a temporary Android build copy under the repo-level `.build/` directory,
apply the flavor there, and keep the tracked source tree untouched. Flavor builds vary the
installed application ID, display name, and API host at build time:

```bash
npm run flavor default
ASSISTANT_API_HOST='https://assistant' ASSISTANT_APP_ID='com.assistant.app' ASSISTANT_APP_NAME='Assistant' npm run android:build
```

For subsequent builds after the project already exists:

```bash
ASSISTANT_API_HOST='https://assistant/assistant-work' ASSISTANT_APP_ID='com.assistant.work' ASSISTANT_APP_NAME='Assistant Work' npm run android:build
```

### One-command deploy to all connected devices

```bash
# Build web client once, then build/install both default and work flavors
npm run android:deploy:flavors
```

This command:

- builds `@assistant/web-client`
- applies each flavor (`default`, `work`)
- builds debug APK
- installs on all connected `adb` devices
- launches each flavor app after install
- skips unresponsive devices after an adb probe/install timeout and reports them at the end
- restores `capacitor.config.json` to its original contents when finished

Optional:

```bash
# Deploy one flavor
npm run android:deploy:default

# Deploy the work flavor
npm run android:deploy:work

# Skip web rebuild if unchanged
npm run android:deploy:flavors -- --skip-web-build
```

### Adding a new flavor

Add an entry to `flavors.json` with a unique `appId`. For Firebase push
notifications, each flavor needs its own `google-services.json` from a
matching Firebase app registration.

## Notes

- Web assets are pulled from `../web-client/public` as configured in `capacitor.config.json`
- `ios/` and `node_modules/` are gitignored
- `android/` is a committed source tree. Build/deploy commands stage flavor-specific copies under the repo-level `.build/` directory so tracked sources stay untouched.
- If `android/` is missing or required native files are absent, restore the committed tree from git instead of regenerating it during deploy.
- If `ios/` is missing, run `npm run ios:add`
- Android back button closes overlays/modals first (command palette, panel launcher, session picker, header popovers, settings/layout dropdowns, context menus, modal panels, mobile sidebar, navigation modes). When nothing is open, it falls back to history back or exits the app.

## Security Considerations

### CORS

The agent-server reflects the request `Origin` header in CORS responses to allow cross-origin requests from the Capacitor app (`https://localhost`). This is suitable for internal/development use. For public deployments, consider implementing an origin allowlist.

### Network Security (Android)

The Android patch trusts user-installed CAs, which allows self-signed certificates to work when the CA is installed on the device. For stricter security, you can modify `patch-android-security.mjs` to trust only specific domains or system CAs.

### API Host

Mobile build commands patch the generated Capacitor asset copies (for example,
`android/app/src/main/assets/public/config.js` and `ios/App/App/public/config.js`) after sync.
They do not modify `packages/web-client/public/config.js`.
Set `ASSISTANT_API_HOST` to override the default `assistant` value.

On Android, the native app now shows a backend chooser on every cold start before the web client
connects. The chooser seeds one saved backend on first run:

- `Assistant` → `https://assistant`

The chooser selection wins for that launch and is persisted as the last used backend. The packaged
`ASSISTANT_API_HOST` value remains the fallback for non-Android builds and as a safety net if the
native launch bridge is unavailable.

Examples:

```bash
# Android emulator
ASSISTANT_API_HOST=10.0.2.2:3000 npm run android:sync

# Production host
ASSISTANT_API_HOST=https://assistant.example npm run ios:sync
```

If you need http/ws, set a full `http://` URL or `ASSISTANT_INSECURE=true` in the environment.
Re-run `android:sync` or `ios:sync` after changing the env vars.

### Firebase / Push Notifications

The `google-services.json` file is required for push notifications but is **not committed** to the repository (it's in `.gitignore`).

To set up push notifications:

1. Create a project at [Firebase Console](https://console.firebase.google.com)
2. Add an Android app for each installed flavor package you intend to use, such as `com.assistant.app` and `com.assistant.work`
3. Download `google-services.json` and place it in this directory (`packages/mobile-web/`)
4. Generate a service account key for the push CLI (see `packages/push-cli/README.md`)
