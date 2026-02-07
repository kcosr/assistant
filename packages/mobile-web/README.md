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
- [Notes](#notes)
- [Security Considerations](#security-considerations)

## Layout

- `mobile-web/` – Capacitor project root
- `mobile-web/android/` – Generated Android native project (not committed)
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

```bash
npm run android:add   # generates android/ (one-time)
```

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

# Open in Android Studio
npm run android:open

# Release build
npm run android:build:release

# Environment diagnostics
npm run android:doctor
```

### iOS

```bash
# Open in Xcode
npm run ios:open

# Sync assets
npm run ios:sync
```

## Android Patches

The following patches are applied automatically on `android:add` and `android:sync`:

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
- When content is shared to the app, a modal appears to select the destination:
  - **Chat Input** - Populates the chat input field
  - **New Note** - Creates a new note with the shared content
  - **Add to List** - Adds a new item to a selected list
  - **Fetch to List** - (Only shown when shared content contains a URL) Sends the URL to the agent with a prompt to fetch the page content and add it to a selected list

### Firebase Config (`patch-android-firebase.mjs`)

- Copies `google-services.json` to `android/app/` for Firebase Cloud Messaging (FCM)
- Required for push notifications

**Configuration:**

Set the `WEBVIEW_TEXT_ZOOM` environment variable to customize the zoom level (default: 100):

```bash
# 120% zoom (larger text)
WEBVIEW_TEXT_ZOOM=120 npm run android:add

# Or when syncing
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
- **apiHost** – Value written to `ASSISTANT_API_HOST` in the built `config.js`

### Applying a flavor

```bash
# See available flavors
npm run flavor

# Apply the "work" flavor
npm run flavor work
```

This updates `capacitor.config.json` with the flavor's `appId` and `appName`.
Since the `appId` determines the Android Java package structure, **you must
regenerate the native project** whenever the `appId` changes:

```bash
npm run flavor work
rm -rf android/
ASSISTANT_API_HOST='https://assistant/assistant-work' npm run android:add
```

For subsequent builds after the project already exists:

```bash
ASSISTANT_API_HOST='https://assistant/assistant-work' npm run android:build
```

### Adding a new flavor

Add an entry to `flavors.json` with a unique `appId`. For Firebase push
notifications, each flavor needs its own `google-services.json` from a
matching Firebase app registration.

## Notes

- Web assets are pulled from `../web-client/public` as configured in `capacitor.config.json`
- The generated `android/`, `ios/`, and `node_modules/` directories are gitignored
- If `android/` or `ios/` is missing, run the corresponding `:add` command first
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
2. Add an Android app with package name `com.assistant.app`
3. Download `google-services.json` and place it in this directory (`packages/mobile-web/`)
4. Generate a service account key for the push CLI (see `packages/push-cli/README.md`)
