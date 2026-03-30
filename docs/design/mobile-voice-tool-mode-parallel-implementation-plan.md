# Mobile Voice Tool Mode Parallel Implementation Plan

## Scope

This plan turns the tool-driven mobile voice design into parallelizable work slices.

Primary design references:

- [mobile-voice-tool-mode.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode.md)
- [mobile-voice-tool-mode-backend-contract.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode-backend-contract.md)
- [mobile-voice-tool-mode-web-contract.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode-web-contract.md)
- [mobile-voice-tool-mode-android-contract.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode-android-contract.md)

Cross-repo dependency:

- `agent-voice-adapter/docs/direct-media-backend-contract.md`

## Sequencing Strategy

Parallelization is possible, but the slices are not equally independent.

Recommended order:

1. Backend contract and data-shape work first
2. Web rendering/settings work can begin in parallel once tool names and spoken-input semantics are stable
3. Android native work can begin in parallel once:
   - tool names are fixed
   - spoken-input submit contract is fixed
   - selected-session and adapter-URL sync semantics are fixed

## Workstream A: Assistant Backend Tools

### Ownership

- `packages/agent-server/src/builtInTools.ts`
- `packages/agent-server/src/builtInTools.test.ts`
- `packages/agent-server/src/systemPrompt.ts`
- `packages/agent-server/src/systemPromptUpdater.test.ts`

### Deliverables

- add `voice_speak`
- add `voice_ask`
- minimal accepted tool result shape
- clear tool descriptions for agent usage

### Gate

- tool definitions and tests land
- tool names and descriptions are stable

## Workstream B: Spoken Input Submit Path

### Ownership

- `packages/plugins/core/sessions/server/index.ts`
- `packages/plugins/core/sessions/server/index.test.ts`
- `packages/agent-server/src/sessionMessages.ts`
- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/chatProcessor.test.ts`

### Shared-Schema Caution

Avoid editing shared schema or persistence files unless needed. If required, coordinate first:

- `packages/shared/src/chatEvents.ts`
- `packages/agent-server/src/history/piSessionWriter.ts`
- `packages/agent-server/src/events/eventStore.ts`

### Deliverables

- extend existing message route with:
  - `inputType`
  - `durationMs`
- spoken submits emit `user_audio`
- agent still receives ordinary user text

### Gate

- backend spoken-submit tests land
- `user_audio` path is stable for web and Android consumers

## Workstream C: Web Rendering And Settings

### Ownership

- `packages/web-client/src/controllers/chatRenderer.ts`
- `packages/web-client/src/controllers/chatRenderer.test.ts`
- `packages/web-client/src/controllers/speechAudioController.ts`
- `packages/web-client/src/controllers/speechAudioController.test.ts`
- `packages/web-client/src/controllers/serverMessageHandler.ts`
- `packages/web-client/src/index.ts`

### Deliverables

- render `voice_speak` / `voice_ask` as speaker bubbles
- render `user_audio` with microphone styling
- expose and persist adapter URL setting
- sync voice mode, selected session, and adapter URL into native bridge

### Gate

- web transcript rendering tests land
- bridge call expectations are stable for Android worker

## Workstream D: Android Native Integration

### Ownership

- `packages/mobile-web/android/app/src/main/AndroidManifest.xml`
- `packages/mobile-web/android/app/src/main/java/com/assistant/work/MainActivity.java`
- `packages/mobile-web/android/variables.gradle`
- `packages/mobile-web/scripts/*`
- new committed native bridge/service files under `packages/mobile-web/android/app/src/main/java/...`

### External References Only

Do not edit these as part of the Assistant implementation slice:

- `agent-voice-adapter/docs/direct-media-backend-contract.md`
- `agent-voice-adapter/android/app/src/main/java/com/agentvoiceadapter/android/VoiceAdapterService.kt`
- `agent-voice-adapter/android/app/src/main/java/com/agentvoiceadapter/android/MicPcmStreamer.kt`

### Deliverables

- native bridge for config and state sync
- selected-session-only prompt autoplay
- direct playback/listen through `agent-voice-adapter`
- spoken submit back to Assistant using the extended sessions message route

### Gate

- Android integration compiles
- manual integration test covers:
  - `voice_speak`
  - `voice_ask`
  - stop behavior
  - session switching
  - adapter URL change

## Suggested Parallel Assignment

If using three implementation agents:

1. Backend agent:
   - Workstream A
   - Workstream B

2. Web agent:
   - Workstream C

3. Android agent:
   - Workstream D

This keeps write sets mostly disjoint and reduces merge pressure.

If using four implementation agents:

1. Backend tools agent:
   - Workstream A

2. Backend spoken-submit agent:
   - Workstream B

3. Web agent:
   - Workstream C

4. Android agent:
   - Workstream D

Only use this four-way split if the backend workers coordinate before touching shared persistence or
schema files.

## Review Checklist Before Coding

- tool names final: `voice_speak`, `voice_ask`
- tool result shape final: `{ "accepted": true }`
- spoken-input route extension final:
  - `inputType: "audio"`
  - `durationMs`
- transcript semantics final:
  - assistant side uses ordinary tool events
  - spoken user input uses `user_audio`
- active-interaction rule final:
  - later prompts render but do not auto-play

## Verification Matrix

### Backend

- `packages/agent-server/src/builtInTools.test.ts`
- `packages/plugins/core/sessions/server/index.test.ts`
- `packages/agent-server/src/chatProcessor.test.ts`

### Web

- `packages/web-client/src/controllers/chatRenderer.test.ts`
- `packages/web-client/src/controllers/speechAudioController.test.ts`
- additional targeted tests for settings sync if needed

### Android

- compile/build validation through `packages/mobile-web`
- targeted native tests if practical
- manual end-to-end validation on device/emulator

## Integration Risk Notes

- The largest product risk remains agent cooperation:
  - if agents do not call the tools, nothing is spoken
- The largest technical risk remains Android/native integration complexity:
  - foreground service
  - bridge ownership
  - session observation while backgrounded

Those are accepted v1 tradeoffs for the simpler tool-driven architecture.
