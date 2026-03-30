# Mobile Voice Tool Mode Web Contract

## Scope

This document defines the web-client-side contract for the tool-driven mobile voice model in
[mobile-voice-tool-mode.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode.md).

This contract covers:

- transcript rendering of `voice_speak` and `voice_ask`
- rendering of spoken user input through `user_audio`
- settings ownership for the adapter URL
- sync responsibilities from web into native

This contract does not define the native bridge implementation itself. It defines what the web
layer must provide to it.

## Goals

- Preserve the normal transcript/event architecture.
- Avoid a new assistant message type for voice prompts.
- Make voice-tool output look like a first-class chat bubble rather than generic tool chrome.
- Keep the web layer as source of truth for selected session and settings.

## Transcript Rendering Rules

### Assistant side: `voice_speak` and `voice_ask`

The web client should render these tool calls/results as speaker bubbles rather than generic tool
output blocks.

Rendering source of truth:

- bubble body comes from `tool_call.payload.args.text`
- tool name is used only for behavior/state:
  - `voice_speak`
  - `voice_ask`

Tool-result handling:

- success result is minimal and should not render as a separate verbose result body
- the bubble remains the visible artifact
- tool-call/result chrome should be suppressed for these tools

Error handling:

- backend validation errors may render inline on the same speaker bubble
- device-local runtime errors must not be reconstructed from shared transcript events
- foreground-only local runtime state may decorate the bubble locally without persistence

### User side: `user_audio`

The web client should render `user_audio` as an ordinary user bubble with microphone styling.

Rendering source of truth:

- bubble body comes from `user_audio.payload.transcription`
- local visual treatment distinguishes spoken input from typed input

This path already exists conceptually in:

- `packages/web-client/src/controllers/chatRenderer.ts`

## Autoplay Ownership

The web layer should not own speech playback when native voice mode is enabled.

Rules:

- web still renders the session normally
- web does not separately speak `voice_speak` / `voice_ask`
- web does not attempt to queue or arbitrate multiple voice prompts

Native is the runtime owner for playback/listen behavior.

## Selected Session Sync

The web layer remains the source of truth for which session is active for voice behavior.

It must push selected-session changes into native whenever they change.

Required sync payload:

```json
{
  "panelId": "string",
  "sessionId": "string"
}
```

Behavior:

- if the selected panel/session changes, web pushes the new binding to native immediately
- if the session is cleared or no longer valid, web pushes a cleared selection state
- native uses this state to gate playback and recognition

## Settings Ownership

### Audio responses

The existing `audio responses` preference remains the source of truth for whether native voice mode
is enabled on Android.

Existing touchpoints:

- `packages/web-client/src/controllers/speechAudioController.ts`
- `packages/web-client/src/utils/clientPreferences.ts`

### Adapter URL

The web layer must own and persist the `agent-voice-adapter` base URL.

Initial default:

- `https://assistant/agent-voice-adapter`

Requirements:

- surface it in the existing settings dropdown
- persist it using the normal web settings/preference model
- push it into native during initialization
- push updates to native whenever it changes

## Web-To-Native Sync Contract

The web layer must be able to push the following state into native:

- voice-mode enabled/disabled
- selected panel/session
- Assistant base URL if needed by native submit logic
- `agent-voice-adapter` base URL

The web layer must also be able to receive high-level native runtime state for foreground UI.

Minimum expected native-to-web state:

- `disabled`
- `connecting`
- `idle`
- `speaking`
- `listening`
- `error`

Optional foreground-only details:

- error message
- adapter disconnected/reconnecting

## Existing Rendering Pattern To Reuse

The closest current pattern is the special rendering path for `agents_message`.

Reference files:

- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/utils/toolOutputRenderer.ts`

The `voice_speak` and `voice_ask` rendering path should follow the same architectural idea:

- special-case known tool names
- avoid inventing a separate transcript type
- collapse tool-call/result mechanics into a custom bubble presentation

## Suggested Web Touchpoints

Primary files:

- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/chatRenderer.test.ts`
- `packages/web-client/src/controllers/serverMessageHandler.ts`
- `packages/web-client/src/controllers/settingsDropdown.test.ts`
- `packages/web-client/src/controllers/speechAudioController.ts`
- `packages/web-client/src/controllers/speechAudioController.test.ts`
- `packages/web-client/src/index.ts`

Possible utility touchpoints:

- `packages/web-client/src/utils/toolOutputRenderer.ts`
- `packages/web-client/src/utils/clientPreferences.ts`
- `packages/web-client/src/utils/webClientElements.ts`

## Verification

Minimum web coverage:

- `voice_speak` renders as a speaker bubble instead of generic tool chrome
- `voice_ask` renders as a speaker bubble instead of generic tool chrome
- `user_audio` renders as a user bubble with microphone styling
- voice prompts remain visible when voice mode is off
- adapter URL setting persists and syncs into native bridge calls
- selected session changes sync into native bridge calls

## Ownership Suggestion

Safe web write scope for one worker:

- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/chatRenderer.test.ts`
- `packages/web-client/src/controllers/speechAudioController.ts`
- `packages/web-client/src/controllers/speechAudioController.test.ts`
- `packages/web-client/src/controllers/serverMessageHandler.ts`
- `packages/web-client/src/index.ts`

Coordinate before editing shared bridge helpers if a separate Android worker is also creating them.
