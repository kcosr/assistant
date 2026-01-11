# Push Notification CLI

A standalone CLI tool to send push notifications to the AI Assistant mobile app via Firebase Cloud Messaging (FCM).

## Table of Contents

- [Setup](#setup)
- [Source files](#source-files)
- [Usage](#usage)
- [Options](#options)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)
- [Revoking a Service Account Key](#revoking-a-service-account-key)

## Source files

- `packages/push-cli/src/index.ts`

## Setup

### 1. Firebase Service Account Key

You need a service account key JSON file from Firebase to authenticate with FCM.

**To generate a new key:**

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project (e.g., `assistant-9753a`)
3. Click the **gear icon** → **Project settings**
4. Go to the **Service accounts** tab
5. Click **Generate new private key**
6. Download the JSON file and save it (e.g., `firebase-sa.json`)

**Important:** Keep this file secure. Don't commit it to git. It's already in `.gitignore`.

### 2. Get the Device Token

The mobile app displays the FCM device token on first launch (in a modal with a copy button).

**To get the token:**

1. Build and install the app on your device
2. On first launch, a modal appears with the FCM token
3. Tap **Copy Token** to copy it to your clipboard

**When does the token change?**

- App reinstall → new token
- App data cleared → new token
- App restored on a new device → new token
- Google Play Services refresh → rare, but possible

For the same install on the same device, the token typically stays the same for weeks/months.

### 3. Build the CLI

```bash
cd packages/push-cli
npm install
npm run build
```

## Usage

```bash
node dist/index.js <service-account.json> <device-token> <title> <body>
```

**Example:**

```bash
node dist/index.js ./firebase-sa.json "dISVvaGmTZa..." "Hello" "This is a test notification"
```

## Options

The CLI sends high-priority notifications by default to help bypass battery saver and doze mode.

## Troubleshooting

### Notification not received

1. **Battery saver mode** - Android may delay or drop notifications. Try disabling battery saver or exempting the app.

2. **App not installed** - The token is only valid for devices where the app is installed.

3. **Token expired/invalid** - If you get an error about invalid token, get a fresh token from the app.

4. **No internet** - Device needs internet connectivity to receive notifications.

### Token expired

Tokens can expire if:

- The app was uninstalled
- App data was cleared
- Google Play Services rotated the token

**Solution:** Reinstall/reopen the app to get a new token from the modal.

### Service account key issues

If you get authentication errors:

1. Make sure the JSON file is valid
2. Verify the project ID matches your Firebase project
3. Try generating a new key from Firebase Console

## Architecture

```
push-cli (this tool)
    │
    │ HTTPS POST with service account JWT auth
    ▼
Firebase Cloud Messaging (fcm.googleapis.com)
    │
    │ Push via Google Play Services
    ▼
AI Assistant App (receives notification)
```

The CLI:

1. Loads the service account key
2. Creates a JWT and exchanges it for an access token
3. Sends the notification via FCM v1 API
4. FCM delivers to the device

## Revoking a Service Account Key

If a key is compromised:

1. Go to Firebase Console → Project settings → Service accounts
2. Click the **X** next to the key to revoke it
3. Generate a new key

Old keys will immediately stop working.
