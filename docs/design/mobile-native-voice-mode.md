# Mobile Native Voice Mode

## Overview

Assistant mobile is a Capacitor app with a web UI and a generated native Android shell. For voice,
the current `agent-voice-adapter` backend is optimized for a different control model:

- some external caller submits `POST /api/turn`
- a voice client plays TTS for that turn
- the same turn may optionally hand off into recognition
- the caller may block waiting for the recognition result

That model is appropriate when the agent or CLI is outside the client and needs a turn-bounded
request/response flow.

Assistant mobile is different:

- the client already owns the chat lifecycle
- the client decides whether to speak assistant output
- the client can initiate speech capture directly from UI
- recognized text can be submitted as an ordinary assistant message

Because of that, Assistant should not treat voice as "tool-driven turns" by default. It should use
a client-driven native voice runtime, with the turn-based API retained only for legacy and external
callers.

## Goals

- Keep Assistant mobile as a Capacitor app, but move voice runtime behavior into native Android
  code.
- Reuse as much of the existing `agent-voice-adapter` Android runtime as possible.
- Remove the requirement that normal assistant voice playback be initiated by a turn-aware tool.
- Allow the UI to:
  - auto-speak assistant responses when audio responses are enabled
  - start capture directly from the mic button
  - stop TTS and optionally barge into capture
  - keep browser mic input as a fallback when native voice is unavailable
- Preserve the existing turn-based backend model for CLI and external integrations.
- Remove the legacy ElevenLabs-specific Assistant TTS path across platforms.
- Keep existing legacy/browser voice input working as fallback input.

## Non-Goals

- Replace the existing `/api/turn` model for external callers.
- Redesign desktop voice behavior in this document.
- Fully specify iOS support.
- Commit to ambient wake for v1.

## Product Model

Assistant mobile should support two voice modes at the backend level:

1. `Turn mode`
   - Existing `agent-voice-adapter` behavior.
   - Used when an external caller needs deterministic "speak, maybe listen, then return result"
     behavior.

2. `Client media mode`
   - New behavior for Assistant-owned UX.
   - The client owns playback, capture initiation, cancellation, and transcript submission.
   - The backend provides TTS and STT primitives, not turn orchestration.

The UI should use `Client media mode` as the default for Assistant mobile voice.

## Agreed V1 Decisions

These decisions have been made for the initial implementation direction.

### Voice target

- Voice is bound to the selected chat panel only.
- Only the selected chat panel may trigger native TTS playback.
- Native STT input is submitted only to the selected chat panel.
- There is no multi-session voice arbitration in v1.

### Queueing

- There is no client-side or server-side voice queue in v1.
- Assistant does not attempt to queue speech from multiple sessions.
- If a different chat panel becomes selected, current playback stops immediately.

### Context invalidation that should stop voice immediately

- selected chat panel changes
- selected panel switches to a different session
- selected session is cleared/reset
- any equivalent UI action that invalidates the current voice target
- active playback and active capture must both stop on these transitions

### Stop behavior

- If TTS is active, pressing stop should cut off playback and immediately transition into native
  STT capture for the same selected-panel context.
- If native STT capture is active, pressing stop again should cancel recognition.
- This preserves the current useful "cut off long output and reply immediately" behavior from the
  existing Android voice app.

### Ownership model

- The backend remains primitive and media-oriented for direct mode.
- The native Android service owns voice lifecycle and coordination.
- The native Android service owns background-capable two-way voice behavior.
- The web UI remains a control surface and state renderer.
- The backend should not understand higher-level client interactions in v1.

### Backend routing

- Direct media mode should not use the current "active client" concept.
- Direct media requests should target an explicit client identity.
- The backend should understand client capabilities so turn-mode traffic is not routed to
  direct-media-only clients.

### TTS / STT transport

- Direct TTS should start over HTTP and stream over websocket.
- Direct STT should support both:
  - websocket streaming as the primary/native path
  - HTTP blob upload as a secondary/fallback path
- Initial direct-media support is native Android Capacitor only.

### Interaction model

- Assistant mobile still needs a client-owned interaction lifecycle.
- That interaction lifecycle lives in the native Android service.
- The backend should only expose lower-level TTS/STT primitives plus ownership/cancellation.

### Legacy feature handling

- Remove the legacy Assistant TTS playback path that is tied to the previous ElevenLabs integration.
- Continue to allow legacy/browser voice input to work.
- On non-native platforms, "audio responses" may remain enabled in UI, but should no longer depend on
  the removed legacy ElevenLabs-specific path.

### Assistant integration model

- Native Android talks directly to `agent-voice-adapter` over HTTP and websocket.
- Native Android also talks directly to the Assistant backend.
- The Assistant backend is not a proxy for the voice-adapter media path.
- When native voice mode is enabled, native becomes the only TTS decision-maker.
- The web app may still observe the same session as a normal client, but it should not separately
  speak those same replies.

### Startup, notification, and reconnect behavior

- Assistant Android should move to `minSdk 26`.
- Native voice mode should start a foreground service immediately when enabled.
- The service should show a persistent minimal notification while voice mode is enabled.
- If the app launches with voice mode already enabled, the service should start/connect immediately
  but should not arm speech or capture until the web app pushes valid selected-panel/session context.
- Native should automatically reconnect while voice mode remains enabled.
- If voice mode is turned off in settings, active playback and active capture should both stop
  immediately and the service notification should go away.

### Session targeting and submission

- Native needs only the minimal current voice-target bundle from the web app:
  - selected panel id
  - selected session id
  - Assistant API base URL
- Native STT should submit recognized text directly to the existing Assistant session message API,
  not via the WebView.
- Native voice submission should use the existing
  `POST /api/plugins/sessions/operations/message` route with `mode: "async"`.
- Native voice submission should send raw transcript text only.
- Native voice submission should not attempt to reproduce web-only panel/context prefixing in v1.

### Assistant output tracking

- For full background hands-free behavior, native must subscribe directly to Assistant session events.
- Native should maintain its own lightweight Assistant websocket connection alongside the WebView's
  websocket.
- The native Assistant websocket should subscribe only to the currently selected session.
- On panel/session change, native should:
  - stop playback
  - stop capture
  - discard pending voice state
  - unsubscribe the old Assistant session
  - subscribe the new Assistant session
- Native should only speak finalized assistant replies in v1.
- Native should ignore tool/status/system events for speech in v1.
- Native should speak the next assistant reply that starts after a native or typed user message is
  submitted while voice mode is enabled.
- If a newer finalized assistant reply arrives for the same selected session, it supersedes the
  current voice interaction and native should stop the current playback/capture and switch to the
  newer reply.

#### Finalized-reply detection contract

- Native should consume the same `chat_event` stream semantics the web client already uses.
- Assistant text output is grouped by `responseId`.
- `assistant_chunk` means assistant text is in progress for that `responseId`.
- `assistant_done` means the finalized assistant text for that `responseId` is available and may be
  spoken.
- `interrupt` or `error` for an in-flight `responseId` means that response must not be spoken.
- Native should only speak a reply after receiving `assistant_done` for the selected session.
- After native or typed user submission, native should consider only assistant replies whose output
  starts after that submission boundary.
- If multiple eligible finalized replies arrive, native should speak only the latest applicable one
  for the selected session.

### Input behavior

- On Android, when native voice mode is enabled, the mic button should use native STT only.
- When native voice mode is disabled, the mic button should continue using existing browser dictation.
- On non-Android/web clients, browser dictation remains unchanged.
- Tapping the mic button during TTS should cut playback and begin native STT.
- Tapping the mic button during native STT should cancel/abandon capture.
- Typed messages in the selected session should participate in the same "wait for next finalized
  assistant reply and speak it" flow as voice-submitted messages.

### TTS behavior

- Use the backend's configured default voice/model in v1.
- Do not expose voice/model controls in Assistant v1.
- Do not add Assistant-side truncation or extra sanitization in v1.
- Send the full finalized assistant reply text to `agent-voice-adapter` and rely on existing
  backend sanitization.
- Use one direct-media TTS request per finalized assistant reply in v1.
- Do not implement incremental append-style direct TTS in v1.

### UI and state model

- Native should expose a stable high-level state model to the web UI:
  - `disabled`
  - `connecting`
  - `idle`
  - `speaking`
  - `listening`
  - `waiting`
  - `disconnected`
  - `error`
- If foregrounded, the web UI may show lightweight transient status for cancellation or failures.
- Recognition cue sounds should be skipped in v1.
- The persistent notification should remain minimal in v1, with action buttons deferred.

## Proposed Architecture

### Client split

- Native Android service:
  - owns websocket lifecycle to `agent-voice-adapter`
  - owns websocket lifecycle to Assistant backend
  - owns PCM playback
  - owns mic capture
  - owns selected-session Assistant subscription
  - owns direct message submission to Assistant backend
  - owns decision-making for when finalized assistant replies should be spoken
  - owns foreground service / background reliability
  - owns stop / cancel / activation / barge-in behavior
- Capacitor bridge:
  - exposes service commands to the web app
  - forwards status and result events back to the web app
- Web UI:
  - owns preferences and visible state
  - owns selected panel/session choice
  - pushes current voice-target context into native
  - renders native status/events when foregrounded

### Code reuse

Reuse the native Android runtime from `agent-voice-adapter` as the basis for the Assistant mobile
plugin/module:

- `VoiceAdapterService`
- `PcmAudioPlayer`
- `MicPcmStreamer`
- `CuePlayer`
- `ExternalMediaController`
- `AudioDeviceUtils`
- `AdapterConfig`
- `UrlUtils`

Do not reuse the standalone `agent-voice-adapter` Android `MainActivity` UI wholesale. Assistant
should keep its own WebView UI and consume a smaller native event surface.

## Backend Direction

The existing backend is still turn-centric:

- `POST /api/turn`
- `POST /api/turn/cancel`
- `POST /api/turn/stop-tts`
- websocket messages named around `turn_*`

Assistant mobile should add a second API family for direct media operations.

### Recommendation

Keep `/api/turn` unchanged.

Add a new "client media" API alongside it. This avoids forcing Assistant mobile through turn queue
semantics when the app itself already owns the conversation.

## Proposed Direct Media API

The exact shape can vary, but the key change is to replace turn semantics with lightweight request
IDs that are private to the client/backend media session.

### TTS

Client starts TTS:

```http
POST /api/media/tts
Content-Type: application/json

{
  "requestId": "uuid",
  "text": "Hello world",
  "model": "optional-model-id",
  "voice": "optional-voice-id",
  "sessionId": "optional-current-session-id"
}
```

Server streams playback over websocket:

```json
{ "type": "media_tts_start", "requestId": "uuid" }
{ "type": "media_tts_audio_chunk", "requestId": "uuid", "sampleRate": 24000, "encoding": "pcm_s16le", "chunkBase64": "..." }
{ "type": "media_tts_end", "requestId": "uuid", "success": true }
```

Client can stop playback:

```http
POST /api/media/tts/stop
Content-Type: application/json

{ "requestId": "uuid" }
```

Optional local playback terminal ack:

```json
{ "type": "media_tts_terminal", "requestId": "uuid", "status": "done" }
```

### STT

Client starts a capture session:

```json
{
  "type": "media_stt_start",
  "requestId": "uuid",
  "sampleRate": 48000,
  "channels": 1,
  "encoding": "pcm_s16le",
  "modelId": "optional-asr-model-id"
}
```

Client streams chunks:

```json
{ "type": "media_stt_chunk", "requestId": "uuid", "chunkBase64": "..." }
{ "type": "media_stt_end", "requestId": "uuid" }
```

Server returns result:

```json
{
  "type": "media_stt_result",
  "requestId": "uuid",
  "success": true,
  "text": "recognized speech",
  "providerId": "parakeet_local",
  "modelId": "nvidia/parakeet-ctc-0.6b",
  "durationMs": 1203
}
```

Optional server-side endpointing events:

```json
{ "type": "media_stt_started", "requestId": "uuid" }
{ "type": "media_stt_stopped", "requestId": "uuid", "reason": "silence" }
```

### Why this is better for Assistant

- The agent does not need to know about voice turns.
- TTS can be driven directly from normal assistant output.
- STT can be initiated from the mic button without fabricating a fake turn.
- Recognized text can be submitted as a normal message through the Assistant app.
- Barge-in becomes a client concern instead of an external-caller coordination problem.

## Native Capacitor Plugin Contract

The web UI should talk to a small Capacitor plugin API.

### Commands

- `startVoiceRuntime(config)`
- `updateVoiceRuntime(config)`
- `stopVoiceRuntime()`
- `snapshotVoiceRuntime()`
- `bindVoiceTarget({ panelId, sessionId, assistantApiBaseUrl })`
- `clearVoiceTarget()`
- `notifyUserMessageSubmitted({ sessionId, source })`
- `stopSpeaking({ requestId? })`
- `startSpeechCapture({ requestId, modelId? })`
- `stopSpeechCapture({ requestId? })`
- `cancelSpeechCapture({ requestId? })`

### Events

- `voiceStatus`
- `voiceRuntimeState`
- `voiceListeningState`
- `voiceMicRoute`
- `voiceTtsStarted`
- `voiceTtsEnded`
- `voiceSttResult`
- `voiceTranscriptSubmitted`
- `voiceError`

## UI Model

### Preferences

Reuse the existing "audio responses" preference as the top-level enable/disable switch for native
voice playback on Capacitor Android.

Behavior:

- Web browser: keep current browser audio behavior and browser dictation
- Capacitor Android with native voice available:
  - `audio responses on` => native voice mode enabled
  - `audio responses off` => native voice mode disabled and browser dictation remains available

The browser mic path should remain available whenever native voice mode is off or unavailable.

### Main states

- `idle`
- `speaking`
- `listening`
- `processing`
- `error`

### Mic button behavior

Resulting behavior:

- `idle`: tap mic starts native capture
- `speaking`: tap mic acts as `Stop`
- `listening`: tap mic acts as `Cancel`
- `processing`: mic disabled or spinner
- with native voice mode off, the existing browser dictation behavior remains unchanged

### TTS stop / barge-in

When TTS is active and the user presses stop:

1. native runtime immediately stops local playback
2. native runtime calls `POST /api/media/tts/stop` or equivalent
3. if the user intended voice input, native runtime starts STT capture immediately after playback
   handoff
4. native submits the recognized text directly to the Assistant backend as a normal session message
5. native waits for the next finalized assistant reply for that session and speaks it

This reproduces the useful "cut off TTS and start listening" behavior from the current Android app
without requiring an external tool-driven turn.

## Relationship to Existing "Voice to Agent"

The current Android app already has a native client-initiated capture path called "Voice to Agent."

That flow is:

1. UI asks the service to start capture.
2. Native service starts mic streaming over websocket.
3. Backend returns `turn_listen_result`.
4. Android app posts the transcript to session-dispatch.

For Assistant mobile, the reusable part is steps 1 through 3. Step 4 should change.

Instead of posting to session-dispatch, Assistant mobile should submit the transcript directly to the
Assistant backend as a normal message for the selected session.

This makes the existing "Voice to Agent" capture path a good implementation reference even if the
destination behavior changes.

## Suggested Rollout

### Phase 1

- Native foreground service inside a Capacitor plugin
- Direct connection to `agent-voice-adapter`
- Direct connection to Assistant backend
- Selected-session-only Assistant subscription
- Finalized-reply native TTS playback for selected session
- Reuse existing "audio responses" preference

### Phase 2

- Native mic button path on Android
- Direct native STT capture
- Native transcript submission through existing sessions message API
- Stop-TTS / mic-tap barge-in support

### Phase 3

- Follow-up notification actions
- Optional ambient wake
- Optional external media pause/resume
- Additional agent-facing voice tool for exceptional cases only

## Requirements

### Functional requirements

- Assistant can enable native voice mode from the existing "audio responses" preference on
  Capacitor Android.
- Assistant removes the legacy ElevenLabs-specific TTS playback path across platforms.
- Assistant preserves existing browser-based voice input as fallback input.
- Assistant Android runs native voice mode only when the existing "audio responses" preference is
  enabled.
- Disabling that preference immediately stops active playback and active capture.
- Assistant speaks only responses belonging to the currently selected chat panel.
- Changing the selected chat panel immediately stops active playback.
- Changing the selected panel's session immediately stops active playback.
- Clearing or resetting the active session immediately stops active playback.
- Changing the selected chat panel immediately stops active native capture.
- Changing the selected panel's session immediately stops active native capture.
- Clearing or resetting the active session immediately stops active native capture.
- The user can stop active TTS playback at any time.
- Stopping active TTS playback immediately transitions to native STT capture for the same selected
  chat panel context.
- The user can stop active native STT capture after that handoff.
- The user can start native speech capture from the selected chat panel context.
- Recognized text from native STT is sent immediately as a normal message for the selected chat
  panel context.
- On Android with native voice mode enabled, the mic button uses native STT only.
- With native voice mode disabled, browser-based mic input remains available.
- Typed user messages in the selected session should also trigger the same speak-the-next-finalized-
  reply flow when native voice mode is enabled.
- Native should speak only finalized assistant replies in v1.
- Native should ignore non-assistant event types for speech in v1.
- Native should send one TTS request per finalized assistant reply and should not attempt incremental
  append-style TTS in v1.

### Native runtime requirements

- The native Android service owns playback and capture state.
- The native Android service remains the source of truth while the app is backgrounded.
- The native Android service can stop playback immediately when the UI invalidates the voice target.
- The native Android service can expose runtime status/events back to the WebView.
- The native Android service starts immediately when native voice mode is enabled and runs as a
  foreground service with a persistent notification.
- The native Android service reconnects automatically while native voice mode remains enabled.
- The native Android service must be able to continue functioning while the phone is locked, to the
  extent ordinary foreground-service behavior already permits.
- The native Android service maintains its own Assistant websocket subscription for the selected
  session.
- The native Android service submits recognized voice transcripts directly to the Assistant backend.

### Backend requirements

- The backend must support direct TTS requests independently of `/api/turn`.
- The backend must support direct STT requests independently of `/api/turn`.
- The backend must support explicit client targeting for direct media requests.
- The backend must distinguish turn-capable clients from direct-media-only clients.
- Existing `/api/turn` behavior must remain intact.
- The initial direct-media rollout only needs to support the native Android Capacitor client.
- Assistant backend must already support or continue supporting
  `POST /api/plugins/sessions/operations/message` for native transcript submission.

## Answered Scope Decisions

- Direct-media requests are native Android Capacitor only in the initial rollout.
- Legacy Assistant TTS playback should be removed rather than maintained in parallel.
- Legacy/browser voice input remains available.
- Assistant Android should move to `minSdk 26`.
- The service should use a persistent minimal notification in v1.
- Voice mode should support background/locked-phone use as a foreground service behavior target.

## Remaining Questions

- Native/web UI state synchronization:
  - how much native runtime state should drive visible WebView controls and indicators while the app
    is foregrounded
  - whether the web UI should fully trust native state for mic/voice button rendering when native
    voice mode is enabled
- Assistant event-matching implementation details:
  - the exact native logic for establishing the "user submission boundary"
  - whether native should track that boundary by local submit time only, by `clientMessageId`, by
    resulting `user_message` event, or by another explicit marker
- Native Assistant websocket integration details:
  - whether native should use the same websocket protocol implementation shape as the web client or a
    thinner Android-specific implementation
  - how native should reconnect/resubscribe when the selected session changes during transient
    Assistant websocket reconnects
- Assistant session message API verification:
  - confirm the exact response shape and failure behavior of
    `POST /api/plugins/sessions/operations/message` for native background submission
  - confirm whether any additional request metadata is needed for clean observability or deduplication
- Native plugin contract finalization:
  - exact command names and payloads
  - exact event names and payloads
  - whether any snapshot/debug API is needed beyond the high-level state model
- Android implementation packaging:
  - whether to copy runtime code directly into an Assistant-local Capacitor plugin first or split out
    a more reusable internal module during the first implementation
- Foreground notification follow-up scope:
  - v1 is minimal, but action buttons like `Stop` and `Talk` remain a follow-up decision
- Test strategy:
  - what level of Android-native automated coverage is required in the first implementation
  - how to validate background/lock-screen behavior reliably during development

## Implementation Plan

### Phase 0: Contract and integration confirmation

- Confirm `agent-voice-adapter` direct-media contract and tests.
- Confirm Assistant session message API contract for
  `POST /api/plugins/sessions/operations/message`.
- Confirm native Assistant websocket subscription behavior needed for selected-session-only voice
  tracking.

### Phase 1: Backend primitives

- Completed in `agent-voice-adapter` for direct-media v1.
- No further backend changes required for Assistant v1 beyond using the landed contract.

### Phase 2: Native Android runtime/plugin

- Extract or reuse native Android runtime pieces from `agent-voice-adapter`.
- Package them in a reusable module or local Capacitor plugin.
- Keep lifecycle and state in the native Android service.
- Expose a small Capacitor command/event surface to the WebView.
- Keep the native Android service as the selected-panel-only voice authority.
- Add Assistant backend websocket support in the native service.
- Add Assistant session message submission in the native service.

### Phase 3: Assistant mobile integration

- Reuse the existing "audio responses" preference to enable native voice playback on Capacitor.
- Push selected panel/session state into native.
- Route selected-session finalized assistant output to native TTS through native Assistant session
  tracking.
- Stop native playback on panel/session/context invalidation.
- Keep browser mic input when native voice mode is off.
- Remove the legacy ElevenLabs-specific TTS path.

### Phase 4: Native mic path

- Add native STT capture initiation from the selected chat panel.
- Send recognized transcripts immediately as normal messages through the existing sessions message
  API for the selected chat panel.
- Add stop/cancel/error state handling in the UI.
- Make typed messages also participate in the same native voice follow-up flow.

### Phase 5: TTS stop and barge-in

- Add explicit TTS stop behavior from the UI.
- Support immediate handoff into native STT after stop.
- Support a second stop action that cancels active recognition.
- Ensure context invalidation stops active playback, active capture, and any associated pending
  voice state.

## Concrete Work Breakdown

### Assistant app work

- Replace legacy Assistant TTS wiring with a capability-based voice runtime selection:
  - native Android service when available
  - no legacy ElevenLabs-specific fallback path
- Keep existing browser voice input path intact.
- Add selected-panel voice targeting in the web UI.
- Add panel/session/context invalidation hooks that tell native voice to stop immediately.
- Map native STT results to immediate message submission in the selected panel.
- Update mobile UI state and controls for:
  - speaking
  - listening
  - processing
  - stopped/error

### Native Android work

- Package the reusable Kotlin runtime into a reusable module or Capacitor plugin.
- Adapt the service API so the WebView can:
  - start runtime
  - request TTS
  - stop TTS
  - start/cancel STT
  - receive events
- Implement selected-panel context tracking in the native service.
- Ensure background-safe stop and capture teardown on context invalidation.

### Backend work

- Add direct-media APIs and websocket messages.
- Add client capability and client identity support for direct-media targeting.
- Ensure turn-mode traffic ignores direct-media-only clients.
- Keep the implementation additive to existing `/api/turn` behavior.

### Cleanup work

- Remove legacy Assistant TTS playback code and related configuration that only existed for the
  old ElevenLabs integration.
- Leave legacy/browser voice input intact.

## Recommendation

For Assistant mobile, voice should be modeled as a client-driven native media runtime, not as a
tool-driven turn system.

The backend should keep the existing turn API for external callers, but add a second direct-media
API that:

- streams TTS to the native client
- accepts native STT uploads from the client
- returns recognized text
- uses request IDs instead of turn semantics

For v1, voice should be bound to the selected chat panel only, with no voice queue and immediate
stop on voice-target invalidation. That gives Assistant a much simpler mental model while preserving
the existing `agent-voice-adapter` workflow for clients that genuinely need turn-bounded
orchestration.
