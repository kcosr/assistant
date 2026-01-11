# Notify Proxy Service

A standalone HTTP service that receives webhook callbacks from the agent server and forwards them as Android push notifications via Firebase Cloud Messaging (FCM).

This keeps the main agent server generic (no Firebase dependencies) while enabling push notifications through a separate, purpose-built service.

## Table of Contents

- [Architecture](#architecture)
- [Source files](#source-files)
- [Package Structure](#package-structure)
- [Configuration](#configuration)
- [API](#api)
- [Push Notification Format](#push-notification-format)
- [Implementation Details](#implementation-details)
- [Usage with Agent Server](#usage-with-agent-server)

## Architecture

```
Agent Server                                 Notify Proxy                    Android Device
     │                                            │                               │
     │  POST /api/plugins/sessions/operations/message                             │
     │  { sessionId, content, webhook: { url: proxy } }                           │
     │                               │                               │
     │ ─────── (agent runs) ───────> │                               │
     │                               │                               │
     │  POST /notify (completion)    │                               │
     │ ────────────────────────────> │                               │
     │                               │  FCM v1 API                   │
     │                               │ ────────────────────────────> │
     │                               │                               │  📱 Push!
```

## Source files

- `packages/notify-proxy/src/index.ts`
- `packages/notify-proxy/src/server.ts`
- `packages/notify-proxy/src/fcm.ts`
- `packages/notify-proxy/src/config.ts`

## Package Structure

```
packages/notify-proxy/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── index.ts          # Entry point, starts HTTP server
    ├── server.ts         # HTTP server setup
    ├── fcm.ts            # FCM v1 API client (based on push-cli)
    └── config.ts         # Environment/config handling
```

## Configuration

### Environment Variables

| Variable                   | Required | Description                                |
| -------------------------- | -------- | ------------------------------------------ |
| `FCM_SERVICE_ACCOUNT_PATH` | Yes      | Path to Firebase service account JSON file |
| `FCM_DEVICE_TOKEN`         | Yes      | Target device FCM token                    |
| `PORT`                     | No       | HTTP port (default: `3001`)                |
| `NOTIFY_SECRET`            | No       | Shared secret for webhook authentication   |

### Example

```bash
export FCM_SERVICE_ACCOUNT_PATH=/path/to/firebase-sa.json
export FCM_DEVICE_TOKEN="dISVvaGm..."
export PORT=3001
export NOTIFY_SECRET="my-secret-key"

node dist/index.js
```

## API

### `POST /notify`

Receives completion webhooks from the agent server and sends a push notification.

#### Request Body

```json
{
  "sessionId": "session-uuid",
  "sessionName": "My Agent Session",
  "responseId": "resp_abc123",
  "status": "complete",
  "toolCallCount": 3,
  "response": "Here is what I did...",
  "truncated": false,
  "durationMs": 4523
}
```

#### Headers (optional)

```text
Authorization: Bearer <NOTIFY_SECRET>
```

#### Response

```json
{
  "success": true,
  "message": "Push notification sent"
}
```

On FCM errors, the service logs the error and still returns HTTP 200:

```json
{
  "success": false,
  "message": "Failed to send push notification"
}
```

### `GET /health`

Health check endpoint.

```json
{
  "status": "ok",
  "fcmConfigured": true
}
```

## Push Notification Format

```text
Title: "AI Assistant"
Body: "[Session Name]: First 100–120 chars of response... (3 tools)"
```

For errors:

```text
Title: "AI Assistant - Error"
Body: "[Session Name]: Task failed - error message"
```

The exact body length is capped at ~150 characters to keep notifications readable on lock screens.

## Implementation Details

### FCM Client

The FCM client follows the same pattern as `packages/push-cli`:

- Loads the service account key on startup
- Uses a JWT-based OAuth 2.0 flow to obtain an access token
- Caches access tokens for ~1 hour to avoid unnecessary token requests
- Sends high-priority notifications on Android

### Notification Formatting

The notification formatter builds the title/body based on the webhook payload:

```ts
function formatNotification(payload: WebhookPayload): { title: string; body: string } {
  const sessionLabel = payload.sessionName || payload.sessionId.slice(0, 8);

  if (payload.status === 'error') {
    return {
      title: 'AI Assistant - Error',
      body: `[${sessionLabel}]: ${payload.error || 'Task failed'}`,
    };
  }

  const toolSuffix =
    payload.toolCallCount && payload.toolCallCount > 0 ? ` (${payload.toolCallCount} tools)` : '';

  const maxBodyLen = 150 - sessionLabel.length - toolSuffix.length - 5;
  const responsePreview =
    payload.response && payload.response.length > maxBodyLen
      ? `${payload.response.slice(0, maxBodyLen)}...`
      : (payload.response ?? '');

  return {
    title: 'AI Assistant',
    body: `[${sessionLabel}]: ${responsePreview}${toolSuffix}`,
  };
}
```

### Error Handling

- Logs FCM errors but returns HTTP 200 for `/notify` to avoid retries for transient FCM issues
- Returns HTTP 401 if `NOTIFY_SECRET` is configured but the `Authorization` header is missing or incorrect
- Returns HTTP 400 for malformed JSON or invalid payloads

## Usage with Agent Server

### 1. Build and start notify-proxy

```bash
cd packages/notify-proxy
npm run build

FCM_SERVICE_ACCOUNT_PATH=/path/to/key.json \
FCM_DEVICE_TOKEN="device-token" \
PORT=3001 \
NOTIFY_SECRET="my-secret" \
node dist/index.js
```

### 2. Send message with webhook from agent server

```bash
curl -X POST http://localhost:8080/api/plugins/sessions/operations/message \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "my-session",
    "content": "Run the daily report",
    "webhook": {
      "url": "http://localhost:3001/notify",
      "headers": {"Authorization": "Bearer my-secret"}
    }
  }'
```

### 3. Receive push notification

When the agent completes, a push notification is sent via FCM to the configured Android device.

## Notes

- This service only supports a single device token via `FCM_DEVICE_TOKEN`
- For multiple devices or token registration APIs, additional persistence (e.g. SQLite) will be needed
- The service intentionally avoids external framework dependencies and uses Node.js built-in `http`/`https` modules
