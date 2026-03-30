# Mobile Voice Tool Mode

Companion implementation artifacts:

- [mobile-voice-tool-mode-backend-contract.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode-backend-contract.md)
- [mobile-voice-tool-mode-web-contract.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode-web-contract.md)
- [mobile-voice-tool-mode-android-contract.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode-android-contract.md)
- [mobile-voice-tool-mode-parallel-implementation-plan.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode-parallel-implementation-plan.md)

## Overview

This document describes a simpler alternative to the more automatic client-driven native voice
architecture in [mobile-native-voice-mode.md](/home/kevin/worktrees/assistant/docs/design/mobile-native-voice-mode.md).

In this model, the agent explicitly decides when something should be spoken by calling one of two
dedicated async voice tools. The tool does not block waiting for recognition input. Instead:

1. the agent calls a `voice_speak` or `voice_ask` tool with the text the user should hear
2. the tool returns immediately
3. the client renders the tool output as a structured assistant voice prompt
4. if native voice mode is enabled, the client speaks that prompt
5. `voice_ask` may auto-start recognition after playback
6. recognized speech is submitted back as a normal user message in a later turn

This keeps voice transport and client runtime behavior native, while removing the need for the
client to infer which ordinary assistant replies should be spoken.

## Why This Model Exists

Compared with automatic native voice mode, this model is simpler because:

- the agent explicitly marks speech-worthy output
- the client does not need to inspect ordinary assistant output and decide what to speak
- the client does not need rich assistant response tracking logic just to find the next reply
- the speech act becomes a first-class structured UI event instead of an inference

This model is a strong v1 candidate if the goal is to get to a reliable background-capable mobile
voice workflow with less implementation complexity.

## Future Extensibility

Out of scope for v1, but relevant to implementation shape: this design should leave room for
additional client-facing agent actions that are not strictly speech-related.

One likely follow-up is an agent tool that raises or updates an Android notification state without
triggering TTS or STT. That future capability should influence the shape of the implementation:

- keep `voice_speak` and `voice_ask` as separate end-state tools for v1
- avoid baking voice-only assumptions too deeply into transcript rendering and native bridge design
- prefer a renderer/bridge structure that can later support another agent-driven client action such
  as a notification prompt or persistent tray update

For v1, that future should remain an implementation consideration, not a reason to generalize the
tool surface prematurely.

## Goals

- Keep voice transport native on Android.
- Let the agent explicitly produce spoken output through async voice tools.
- Preserve client-owned playback, recognition, and stop/barge-in behavior.
- Render voice prompts and spoken replies as structured UI messages.
- Support voice mode on Android without requiring automatic speech for every ordinary assistant reply.
- Allow the same structured voice prompt to render even when voice mode is off.

## Non-Goals

- Automatically speak every normal assistant reply.
- Infer speech-worthy content from ordinary assistant output in v1.
- Make the async voice tools block waiting for a spoken reply.
- Replace the more automatic client-driven architecture as a future option.

## Product Model

### Core loop

1. The agent calls `voice_speak` or `voice_ask` with text to speak.
2. Assistant renders a structured assistant voice prompt in the session transcript.
3. If voice mode is enabled, native Android sends that text to `agent-voice-adapter` and plays it.
4. When playback completes, `voice_ask` may auto-start recognition for hands-free continuation.
5. Recognized user speech is submitted back to Assistant as a normal user message.
6. The agent receives that message in a later turn and can decide what to do next.

### Tool behavior

- `voice_speak` is asynchronous and speak-only.
- `voice_ask` is asynchronous and speak-then-listen.
- Both tools return immediately after creating the voice prompt event.
- Both tools should reject invalid arguments such as missing/empty text.
- Tool descriptions should explicitly guide agents:
  - use `voice_ask` when a spoken reply is expected
  - use `voice_speak` for one-way spoken updates or progress
  - do not use either tool unless the user has initiated or requested voice-style interaction
- Recognition is not routed back through the tool result.
- User follow-up speech returns as an ordinary session message, not as tool output.
- Both tools are fire-and-forget:
  - success means the prompt/tool event was accepted and rendered
  - native playback, auto-listen, and STT outcomes are client-side behavior
  - those client-side outcomes are not reported back into the original tool call result

### Voice mode on vs off

- If voice mode is on:
  - structured assistant voice prompts are spoken natively
  - post-playback recognition may begin automatically
- If voice mode is off:
  - the same structured assistant voice prompts still render in the transcript
  - they are not played automatically
  - no automatic recognition is started from those prompts

This means tool usage is still valuable even without active voice playback because it provides
intentional UI semantics.

### Busy behavior

- If a new `voice_speak` or `voice_ask` prompt arrives while native is already speaking or
  listening, the current interaction continues.
- The later prompt still renders in the transcript.
- The later prompt does not interrupt the active interaction.
- The later prompt does not get queued for delayed autoplay.
- This rule applies uniformly; v1 does not need a special same-turn rule beyond the normal
  active-interaction behavior.

## UX Model

### Assistant voice prompt rendering

- Voice-tool output should render differently from a normal assistant message.
- Recommended initial treatment:
  - assistant voice prompts render with a speaker icon
  - visually distinct bubble style from plain assistant text
  - text remains fully visible in the transcript
  - if a local playback or recognition runtime error occurs while the web UI is foregrounded, that
    state may be shown directly on the speaker bubble

### User spoken reply rendering

- Spoken user replies should render as normal user messages with an additional visual marker.
- Recommended initial treatment:
  - microphone icon for spoken user input
  - otherwise remain compatible with existing session transcript behavior

### When voice mode is disabled

- Assistant voice prompts still render with the speaker icon and voice-prompt styling.
- No automatic playback occurs.
- No automatic post-playback recognition occurs.
- Browser dictation remains available when native voice mode is off.

## Agreed Decisions For This Model

- Android native voice mode still reuses the existing `audio responses` preference.
- On Android with voice mode enabled, native handles playback and recognition.
- On Android with voice mode disabled, browser dictation remains available.
- The `agent-voice-adapter` base URL should be configurable in the existing settings UI.
- The web app remains the source of truth for that setting and persists it in normal app settings
  storage.
- Native must receive the current adapter URL at startup and whenever the setting changes.
- Initial default adapter URL: `https://assistant/agent-voice-adapter`.
- If the agent calls `voice_speak` or `voice_ask` while voice mode is off, the prompt still renders as a structured
  assistant message with the speaker icon but does not autoplay.
- User spoken replies are submitted as ordinary Assistant messages, not tool results.
- The voice tools should be async and non-blocking.
- Assistant should expose `voice_speak` and `voice_ask` as separate tools so they can be allowlisted
  independently per agent.
- Voice playback and auto-listen should only trigger for the currently selected session.
- If the selected panel/session changes during active playback or listening, native should stop the
  current interaction immediately and discard any pending follow-up for the old session.
- Only newly arrived voice-tool events should auto-play in v1.
- Older voice-tool events in the selected session should remain visible but should not auto-play when
  a user later switches into that session.
- If a new voice-tool event arrives while native is already speaking or listening, it should not
  interrupt the active interaction in v1.
- Newly arrived voice-tool events that appear during an active interaction should remain visible in
  the transcript but should not auto-play later as delayed backlog items.
- `voice_ask` should start recognition after normal playback completion and after manual playback
  interruption.
- `voice_speak` should allow manual stop of playback, but should not transition into a recognition
  phase afterward.
- The native runtime needs the same selected-session state the web app uses, including background
  updates when the selected panel/session changes.
- Agents do not need real-time client voice capability state in v1.
- `voice_speak` and `voice_ask` remain valid even when the active client has voice mode off; in
  that case the tool still renders the speaker bubble, but no autoplay or auto-listen occurs.

## Architecture

### Client responsibilities

- native Android service owns:
  - `agent-voice-adapter` connection
  - playback
  - speech capture
  - stop / barge-in behavior
  - foreground-service lifecycle
  - current selected-session binding pushed from the web app
  - current `agent-voice-adapter` base URL pushed from the web app
- web UI owns:
  - rendering structured voice prompt messages
  - rendering spoken user messages
  - rendering `voice_speak` and `voice_ask` tool calls/results as speaker bubbles
  - voice mode preference state
  - pushing selected panel/session changes into native so background voice behavior stays aligned
  - persisting and updating the configured `agent-voice-adapter` base URL

### Assistant backend responsibilities

- expose `voice_speak` and `voice_ask` to agents
- persist the resulting tool calls/results in the normal transcript/event stream
- accept the user's spoken follow-up as a normal session message operation with spoken-input metadata
- describe the tools clearly enough that agents can choose between speak-only and speak-then-listen

### Voice-adapter responsibilities

- speak text supplied by the native client
- support stop and recognition handoff through the landed direct-media API

## Configuration Model

- Assistant should expose the `agent-voice-adapter` base URL in the normal settings dropdown UI.
- The web layer persists that setting using the existing web settings/preference storage model.
- The native bridge/service must be updated with:
  - the current URL during initialization
  - every later settings change
- If the adapter URL changes while voice mode is enabled, native should:
  - stop active playback
  - stop active recognition
  - disconnect from the old adapter endpoint
  - reconnect to the new endpoint

## Native Runtime Behavior

### Playback

- Native receives a structured assistant voice prompt event from Assistant.
- If voice mode is enabled, native sends a single direct-media TTS request with the full prompt text.
- If voice mode is disabled, native ignores playback and auto-listen behavior, but the UI still
  renders the prompt.
- Native only auto-plays a voice prompt when:
  - it belongs to the currently selected session
  - it is newly observed while that session is selected
- Native should not auto-play older prompt events merely because the user later switched into the
  session.
- If native is already in an active voice interaction, later voice prompts should be rendered only
  and should not preempt or queue behind the current interaction in v1.

### Recognition

- After playback ends, native may auto-start recognition when voice mode is enabled.
- If the user stops recognition, capture is canceled and no message is submitted.
- If recognition succeeds, native submits the transcript as a normal Assistant user message.
- More specifically:
  - for `voice_ask`, recognition starts after normal playback completion or manual
    stop/mic interruption
  - for `voice_speak`, manual stop/mic interruption only stops playback and ends the
    interaction
  - if recognition times out, fails, or loses the adapter connection, no user message is submitted
    and the interaction returns to idle
  - if the web UI is foregrounded, it may show lightweight transient status for timeout, cancel, or
    disconnect failure
  - these device-local runtime failures should not be persisted into the shared session transcript

### Message submission

- Native should submit spoken user input through the existing
  `POST /api/plugins/sessions/operations/message` route.
- Native should use `mode: "async"` by default.
- Native should submit raw recognized text only.
- Native should not reproduce web-only panel/context prefixing in v1.
- Extend the existing message route rather than creating a separate speech-submit route.
- Add the spoken-input fields at the top level of the existing message request body.
- Spoken input should add:
  - `inputType: "audio"`
  - `durationMs`
- When `inputType === "audio"`, the backend should emit a `user_audio` transcript event instead of
  `user_message` while still processing the transcription as ordinary user text for the agent.
- `inputType` is a request-level hint on the submit route, not a new transcript event type.
- The agent should continue to receive spoken input as ordinary user text for model context in v1.

## Tool Contract Direction

The intended v1 tool surface is:

```json
{
  "name": "voice_speak",
  "arguments": {
    "text": "What would you like me to do next?"
  }
}
```

```json
{
  "name": "voice_ask",
  "arguments": {
    "text": "What would you like me to do next?"
  }
}
```

Expected behavior:

- both tools create a structured speaker-bubble prompt in the current session
- both tools return immediately
- neither tool waits for recognition input
- neither tool returns the user's spoken answer
- both are considered successful once the prompt is created in the session transcript
- neither fails based on later native playback or recognition runtime state
- `voice_speak` is speak-only
- `voice_ask` is speak-then-listen

Validation expectations:

- `text` is required and must be non-empty after trimming
- the backend may reject excessively large payloads using normal tool validation rules

Recommended result shape:

- keep the tool result minimal and fire-and-forget
- success should only mean the prompt/tool event was accepted
- do not include playback/listen runtime state in the tool result
- if an identifier is needed, prefer returning a small accepted payload such as:

```json
{
  "accepted": true
}
```

Possible future optional arguments:

- `style` or `variant`
- `label`

These are not required for v1.

## Why This May Be Better For V1

- simpler than automatic reply detection
- avoids native parsing of all assistant output for speech decisions
- gives explicit structured UI semantics
- still supports hands-free interaction when voice mode is on
- still degrades cleanly to visible transcript-only behavior when voice mode is off

## Tradeoffs

### Pros

- much simpler state model
- clearer ownership
- better UI semantics
- lower risk first implementation

### Cons

- relies on the agent to call the voice tool consistently
- ordinary assistant replies are not automatically spoken unless explicitly marked
- may require agent prompt/tooling work to get the desired conversational behavior
- later voice prompts that arrive during an active interaction are rendered but intentionally not
  auto-played in v1, so some spoken prompts may be missed if an agent fires them too rapidly

### Accepted V1 Risks

- If an agent does not call `voice_speak` or `voice_ask`, nothing will be spoken.
- If an agent emits additional voice prompts while a current interaction is active, those later
  prompts render but do not auto-play.
- These are intentional tradeoffs for the simpler tool-driven architecture.
- This is considered acceptable because the existing CLI voice workflow already depends on similar
  agent cooperation once the user has asked to use voice.

## Runtime Semantics

- The backend-side responsibility is limited to validating the tool input and creating the
  corresponding prompt/tool event in the current session.
- The client-side responsibility is to decide what to do with that prompt:
  - render it as a speaker bubble
  - play it if voice mode is enabled
  - auto-listen afterward only for `voice_ask`
- Because playback and recognition are client-owned, the agent should not expect delivery receipts,
  playback completion, or recognition failure details through the tool result.

## Relationship To Automatic Native Voice Mode

This model does not replace the more automatic architecture in
[mobile-native-voice-mode.md](/home/kevin/worktrees/assistant/docs/design/mobile-native-voice-mode.md).

Instead:

- this document captures the simpler async-tool-driven model
- the other document captures the richer automatic client-driven model

It is reasonable to implement this model first and revisit the more automatic model later.

## Initial Implementation Direction

1. Add `voice_speak` and `voice_ask` on the Assistant side.
2. Render those tool calls/results distinctly in the transcript with a speaker icon bubble.
3. Extend the sessions message API to support spoken submissions via `inputType: "audio"` and
   `durationMs`.
4. Render `user_audio` transcript events with the microphone marker.
5. Wire native Android playback of voice-tool prompts when voice mode is enabled.
6. Reuse the existing direct-media stop and STT handoff behavior.
7. Sync selected session and adapter URL from web into native.

## Implementation Workstreams

### Workstream A: Assistant backend tools and transcript semantics

- add `voice_speak` and `voice_ask`
- decide exact tool result shape for fire-and-forget success
- ensure transcript/tool events carry enough information for speaker-bubble rendering
- avoid coupling the rendering path so tightly to voice that a future notification-style agent tool
  would require a full redesign
- reference:
  - `packages/agent-server/src/builtInTools.ts`
  - `packages/shared/src/chatEvents.ts`

### Workstream B: Assistant session message API for spoken input

- extend `POST /api/plugins/sessions/operations/message`
- add `inputType: "text" | "audio"`
- require `durationMs` for `inputType: "audio"`
- emit `user_audio` instead of `user_message` for spoken input
- preserve normal agent-processing semantics for the transcription text
- reference:
  - `packages/plugins/core/sessions/server/index.ts`
  - `packages/agent-server/src/sessionMessages.ts`
  - `packages/agent-server/src/chatProcessor.ts`
  - `packages/shared/src/chatEvents.ts`

### Workstream C: Web transcript rendering and settings sync

- render `voice_speak` / `voice_ask` tool activity as speaker bubbles instead of generic tool UI
- render `user_audio` as microphone-marked user bubbles
- expose and persist the adapter URL setting
- sync selected session, voice-mode state, and adapter URL into native
- reference:
  - `packages/web-client/src/controllers/chatRenderer.ts`
  - `packages/web-client/src/controllers/serverMessageHandler.ts`
  - `packages/web-client/src/index.ts`

### Workstream D: Android native bridge and service integration

- build the Capacitor-native bridge surface
- sync settings and selected-session state from web into native
- connect native to `agent-voice-adapter`
- autoplay only newly arrived prompt events for the selected session
- for `voice_ask`, submit recognized speech back through the Assistant sessions message API with
  `inputType: "audio"` and `durationMs`
- reference:
  - `docs/design/mobile-native-voice-mode.md`
  - cross-repo dependency: `agent-voice-adapter/docs/direct-media-backend-contract.md`
  - cross-repo dependency: `agent-voice-adapter/android/app/src/main/java/com/agentvoiceadapter/android/VoiceAdapterService.kt`
  - cross-repo dependency: `agent-voice-adapter/android/app/src/main/java/com/agentvoiceadapter/android/MicPcmStreamer.kt`

## Test Plan Direction

### Backend

- tool tests for `voice_speak` and `voice_ask` acceptance and transcript persistence
- sessions message API tests for `inputType: "audio"` and required `durationMs`
- event emission tests confirming spoken submissions create `user_audio` rather than `user_message`

### Web

- transcript rendering tests for speaker-bubble treatment of `voice_speak` / `voice_ask`
- transcript rendering tests for `user_audio` microphone styling
- settings/controller tests for syncing selected session, voice mode, and adapter URL into native

### Android / Integration

- bridge tests for selected-session updates and adapter URL updates
- native runtime tests for active-session-only autoplay behavior
- integration tests for `voice_ask` stop-to-listen and cancel behavior
- integration tests for timeout/disconnect return-to-idle behavior

## Remaining Questions

- exact native bridge/plugin API shape
- exact Android packaging/reuse strategy for bringing over voice-adapter runtime pieces
