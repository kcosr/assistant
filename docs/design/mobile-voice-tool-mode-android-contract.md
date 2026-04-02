# Mobile Voice Tool Mode Android Contract

## Scope

This document defines the Android-native-side contract for the tool-driven mobile voice model in
[mobile-voice-tool-mode.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode.md).

This contract covers:

- native runtime responsibilities
- bridge API expectations
- direct use of `agent-voice-adapter`
- direct observation of Assistant session events needed for background voice behavior

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

Recommended v1 model:

- native maintains a websocket subscription for the currently selected session
- native only cares about:
  - `tool_call`
  - `tool_result`
  - specifically for `voice_speak` and `voice_ask`

Native does not need to parse ordinary assistant text replies in this model.

## Prompt Eligibility Rules

Native should only auto-play a prompt when all of the following are true:

- native voice mode is enabled
- the prompt belongs to the currently selected session
- the prompt is newly observed while that session is selected
- native is currently idle

If native is already speaking or listening:

- the new prompt is not played
- the new prompt is not queued
- the transcript still contains it for later visual inspection

If the selected session changes during an active interaction:

- stop playback immediately
- stop recognition immediately
- discard any pending follow-up for the old session

## Tool Runtime Mapping

### `voice_speak`

- play prompt text through `agent-voice-adapter`
- manual stop ends playback
- manual stop does not start recognition

### `voice_ask`

- play prompt text through `agent-voice-adapter`
- after natural playback completion, start recognition only when `Auto-listen` is enabled
- if the user manually interrupts playback, start recognition immediately only when
  `Auto-listen` is enabled
- while listening, manual stop cancels recognition

### `assistant_response`

- when `Audio Mode` is `Response`, play the final assistant response through `agent-voice-adapter`
- after natural playback completion, start recognition only when `Auto-listen` is enabled
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
    "recognitionEndSilenceMs": 1200
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
