# Mobile Voice Tool Mode Android Contract

## Scope

This document defines the Android-native-side contract for the tool-driven mobile voice model in
[mobile-voice-tool-mode.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode.md).

This contract covers:

- native runtime responsibilities
- bridge API expectations
- direct use of `agent-voice-adapter`
- direct observation of Assistant session events needed for background voice behavior
- durable notification ingestion used for queued voice admission and manual recovery

## Goals

- support background-capable voice behavior on Android
- keep playback and STT runtime in native code
- reuse existing `agent-voice-adapter` Android runtime ideas where practical
- avoid making the WebView responsible for real-time media lifecycle

## Runtime Ownership

The native Android service is the runtime owner for:

- `agent-voice-adapter` connection
- playback
- STT capture
- stop / barge-in behavior
- foreground-service lifetime
- background reconnect behavior

The web layer is not the runtime owner for these behaviors.

## Assistant Session Observation

To support background and locked-screen behavior, native should not depend on the WebView being
foregrounded to notice new voice prompts.

End-state model:

- native maintains websocket subscriptions for watched Assistant sessions
- native consumes the notifications plugin as the canonical server-originated ingress path for:
  - response-mode final assistant replies
  - `voice_speak`
  - `voice_ask`
- native listens for:
  - `panel_event` updates for the `notifications` panel
  - notification snapshot/list responses from the notifications HTTP operations
- native still observes session lifecycle state needed for session selection, stale-item validation,
  and spoken-submit routing

Native does not need a separate direct-autoplay path for ordinary assistant text replies in this
model. Response-mode playback is admitted through the notification-backed path.

## Prompt Eligibility Rules

Native should only auto-admit a notification-backed voice item when all of the following are true:

- native voice mode is enabled
- the notification is unread and voice-capable
- the notification kind matches the active audio mode:
  - `session_attention` for `Response`
  - append-only session-linked notifications for `Tool`
- the runtime is already alive and connected

If native is already speaking or listening:

- the new item is queued locally
- only one live item still executes at a time
- queued items survive temporary busy state only while the Android service remains alive

If the selected session changes during an active interaction:

- stop playback immediately
- stop recognition immediately
- discard any pending follow-up for the old session
- clear queued items that can no longer execute safely for that session

If the runtime is not alive when a notification arrives:

- the durable notification remains available
- automatic playback is not replayed later by default
- the user may recover manually from the notification's `Speaker` or `Mic` action

## Notification-backed Queue

Native now owns a one-at-a-time local queue of voice work items derived from durable notifications.

Queue rules:

- one item may execute at a time
- automatic items queue behind current local work when the runtime is already alive
- manual `Speaker` and `Mic` actions jump ahead and may interrupt current speech
- interrupted automatic audio work is discarded rather than requeued
- `Stop` cancels the current item and flushes the local backlog
- same-session `session_attention` items coalesce before execution
- deduplication prefers `sourceEventId` when present

For any item that could transition into recognition:

- automatic `speak_then_listen` items must validate against server-generated session activity
  ordering before mic start
- manual `Mic` recovery is intentionally looser and may proceed without that validation when needed

## Tool Runtime Mapping

### `voice_speak`

- admit a session-linked durable notification with `voiceMode = speak`
- play prompt text through `agent-voice-adapter` when the local queue worker reaches the item
- manual stop ends playback
- manual stop does not start recognition

### `voice_ask`

- admit a session-linked durable notification with `voiceMode = speak_then_listen`
- play prompt text through `agent-voice-adapter` when the local queue worker reaches the item
- after natural playback completion, start recognition only when `Auto-listen` is enabled and the
  queued item still passes pre-listen validation
- if the user manually interrupts playback, start recognition immediately only when
  `Auto-listen` is enabled
- while listening, manual stop cancels recognition

### `assistant_response`

- when `Audio Mode` is `Response`, create or update one durable `session_attention` notification
  per session and admit it through the same notification-backed queue path
- after natural playback completion, start recognition only when `Auto-listen` is enabled and the
  queued item still passes pre-listen validation
- if the user manually interrupts playback, start recognition immediately only when
  `Auto-listen` is enabled

## Spoken Submit Contract

When recognition succeeds for `voice_ask` or a manual native listen action:

- submit through Assistant:
  - `POST /api/plugins/sessions/operations/message`
- request shape:

```json
{
  "sessionId": "string",
  "content": "recognized speech",
  "mode": "async",
  "inputType": "audio",
  "durationMs": 4200
}
```

Native should carry forward `durationMs` from the `agent-voice-adapter` recognition result.

## Adapter Configuration

Native receives a single `voiceSettings` payload from the web layer.

Current fields:

- `audioMode`
- `autoListenEnabled`
- `voiceAdapterBaseUrl`
- `selectedMicDeviceId`
- `recognitionStartTimeoutMs`
- `recognitionCompletionTimeoutMs`
- `recognitionEndSilenceMs`
- `ttsGain`

`voiceAdapterBaseUrl` is sourced from that model.

Default:

- `https://assistant/agent-voice-adapter`

When the adapter URL changes while voice mode is enabled:

- stop playback
- stop recognition
- disconnect from the old adapter endpoint
- reconnect to the new endpoint

When the selected microphone device changes while voice mode is enabled:

- persist the new device id in native config
- use system-default routing when the id is empty
- apply the preferred input device on the next capture session
- if the chosen device is unavailable, native may fall back to system-default routing

## Foreground Service

Native voice mode should run as a foreground service while enabled.

v1 requirements:

- persistent minimal notification
- public notification visibility so the persistent `Speak` / `Stop` controls are eligible to appear
  on the lock screen
- notification title should surface the runtime state directly, e.g. `Voice (Listening)`
- notification body should show the resolved preferred or active session title when available
- automatic reconnect while enabled
- service may start immediately when voice mode is enabled
- service should not arm prompt playback until it has valid selected-session state
- use a dedicated notification channel with public lock-screen visibility and default importance;
  migrate with a new channel id when notification behavior changes because channel presentation
  settings are sticky after first creation
- lock-screen visibility is the required success condition; starting microphone capture directly from
  `Speak` while the device remains fully locked may still vary by Android version and OEM policy
- durable session-linked notifications may expose `Speaker` and `Mic` actions that reconstruct a
  fresh local queue item from the stored notification context

## Bridge Contract

Recommended minimum web-to-native API:

### Config setters

- `setVoiceSettings({ settings })`
- `setSelectedSession({ selection: { panelId, sessionId } | null })`
- `setSessionTitles({ sessionTitles: Record<string, string> })`
- `setAssistantBaseUrl({ url: string })`

### User actions

- `stopCurrentInteraction()`
- `startManualListen({ sessionId?: string | null })`
- `listInputDevices()`

### Native-to-web events

- `stateChanged`
  - `disabled`
  - `connecting`
  - `idle`
  - `speaking`
  - `listening`
  - `error`
- `runtimeError`
  - message suitable for local foreground display only

The exact Capacitor plugin surface may differ, but these are the required semantics.

Recommended `setVoiceSettings` payload:

```json
{
  "settings": {
    "audioMode": "tool",
    "autoListenEnabled": true,
    "voiceAdapterBaseUrl": "https://assistant/agent-voice-adapter",
    "preferredVoiceSessionId": "session-123",
    "selectedMicDeviceId": "",
    "recognitionStartTimeoutMs": 30000,
    "recognitionCompletionTimeoutMs": 60000,
    "recognitionEndSilenceMs": 1200,
    "ttsGain": 1.0
  }
}
```

`startManualListen` semantics:

- when `sessionId` is provided, native should start manual listen for that explicit session
- when `sessionId` is omitted or empty, native should fall back to the persisted
  `preferredVoiceSessionId`
- notification `Speak` should use the fallback form

## Packaging Recommendation

Recommended v1 direction:

- keep the implementation in the Assistant repo
- create a committed native Android integration surface rather than depending on ad hoc generated
  edits only
- reuse runtime pieces from `agent-voice-adapter`

Practical touchpoints in the current repo:

- `packages/mobile-web/android/app/src/main/AndroidManifest.xml`
- `packages/mobile-web/android/app/src/main/java/com/assistant/mobile/MainActivity.java`
- `packages/mobile-web/android/variables.gradle`
- `packages/mobile-web/scripts/*`

Cross-repo references to reuse from `agent-voice-adapter`:

- `docs/direct-media-backend-contract.md`
- `android/app/src/main/java/com/agentvoiceadapter/android/VoiceAdapterService.kt`
- `android/app/src/main/java/com/agentvoiceadapter/android/MicPcmStreamer.kt`
- `android/app/src/main/java/com/agentvoiceadapter/android/PcmAudioPlayer.kt`
- `android/app/src/main/java/com/agentvoiceadapter/android/AdapterConfig.kt`

## Failure Handling

If the adapter is unavailable or recognition/playback fails:

- no shared session transcript error should be created
- native returns to idle or reconnecting state
- if the web UI is foregrounded, it may show a local-only error on the relevant speaker bubble or
  a lightweight transient status

## Verification

Minimum Android coverage:

- selected-session changes stop active playback/listening
- only newly arrived prompts for the selected session auto-play
- `voice_speak` manual stop does not enter recognition
- `voice_ask` manual stop during playback enters recognition
- `voice_ask` manual stop during recognition cancels recognition
- successful spoken submit includes `inputType: "audio"` and `durationMs`
- adapter URL changes reconnect native cleanly

## Ownership Suggestion

Safe Android write scope for one worker:

- `packages/mobile-web/android/app/src/main/AndroidManifest.xml`
- `packages/mobile-web/android/app/src/main/java/com/assistant/mobile/MainActivity.java`
- `packages/mobile-web/android/variables.gradle`
- `packages/mobile-web/scripts/*`
- any newly introduced committed native bridge/service files in `packages/mobile-web/android/app/src/main/java/...`

Cross-repo `agent-voice-adapter` files are references only in this phase and should not be edited
from the Assistant implementation worker.
