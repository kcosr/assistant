# Mobile Voice Tool Mode Backend Contract

## Scope

This document defines the Assistant-backend-side contract for the tool-driven mobile voice model in
[mobile-voice-tool-mode.md](/home/kevin/worktrees/assistant/docs/design/mobile-voice-tool-mode.md).

This contract covers:

- `voice_speak`
- `voice_ask`
- spoken-input submission through the existing sessions message API
- transcript/event semantics needed by web and Android clients

This contract does not cover Android runtime behavior or web rendering details beyond the minimum
data shape they depend on.

## Goals

- Keep tool execution fire-and-forget.
- Reuse the existing transcript/event architecture.
- Reuse the existing sessions message API instead of creating a separate speech-submit route.
- Preserve normal agent-processing semantics for spoken input.

## Tool Definitions

### `voice_speak`

Purpose:

- create a spoken assistant prompt for one-way output
- do not request follow-up listening

Arguments:

```json
{
  "text": "string"
}
```

Validation:

- `text` is required
- `text` must be a string
- `text.trim()` must be non-empty
- oversized payloads may be rejected through normal backend validation limits

Result:

```json
{
  "accepted": true
}
```

Semantics:

- success means the prompt/tool event was accepted into the session transcript
- it does not mean playback occurred
- later native playback/runtime failures are not reflected in the tool result

### `voice_ask`

Purpose:

- create a spoken assistant prompt for output that expects a spoken reply
- client may auto-listen after playback

Arguments:

```json
{
  "text": "string"
}
```

Validation:

- same as `voice_speak`

Result:

```json
{
  "accepted": true
}
```

Semantics:

- same fire-and-forget semantics as `voice_speak`
- the tool does not block waiting for speech input
- the eventual spoken user reply is not returned through the tool result

## Tool Description Requirements

Tool descriptions should explicitly guide agents:

- `voice_ask`:
  - use when a spoken reply is expected
- `voice_speak`:
  - use for one-way spoken updates, notifications, or progress
- both:
  - use only when the user has initiated or requested voice-style interaction

The existing system prompt machinery already includes visible tool descriptions in agent prompts:

- `packages/agent-server/src/systemPrompt.ts`
- `packages/agent-server/src/systemPromptUpdater.ts`

No separate live client voice-state prompt injection is required for v1.

## Transcript Semantics

### Assistant voice prompts

The backend should not invent a new transcript event type for assistant voice prompts.

Instead:

- `voice_speak` and `voice_ask` should appear through the existing tool-call transcript flow:
  - `tool_call`
  - `tool_result`

The web client will render these tools specially as speaker bubbles instead of generic tool blocks.

Expected transcript data:

- `tool_call.payload.toolName` is `voice_speak` or `voice_ask`
- `tool_call.payload.args.text` contains the displayed prompt body
- `tool_result.payload.result` is a minimal accepted payload

### Spoken user input

Spoken user input should use the existing `user_audio` chat event type rather than a plain
`user_message`.

Event shape already exists in:

- `packages/shared/src/chatEvents.ts`

Expected payload:

```json
{
  "transcription": "recognized speech",
  "durationMs": 4200
}
```

Agent-processing semantics:

- the agent should continue to receive the transcription as ordinary user text in model context
- there is no need to tell the model that the input was spoken in v1

That behavior already matches replay logic in:

- `packages/agent-server/src/sessionChatMessages.ts`

## Sessions Message API Extension

### Existing route

Continue using:

- `POST /api/plugins/sessions/operations/message`

Current implementation entry points:

- `packages/plugins/core/sessions/server/index.ts`
- `packages/agent-server/src/sessionMessages.ts`

### Request extension

Add two optional top-level request fields:

```json
{
  "sessionId": "string",
  "content": "string",
  "mode": "async",
  "inputType": "audio",
  "durationMs": 4200
}
```

Rules:

- `inputType`:
  - allowed values: `"text"` or `"audio"`
  - default: `"text"`
- `durationMs`:
  - required when `inputType === "audio"`
  - ignored or rejected when `inputType === "text"`; implementation choice may be strict

### Behavioral mapping

- `inputType === "text"`:
  - current behavior
  - emit `user_message`
- `inputType === "audio"`:
  - process `content` as normal user text for the agent
  - emit `user_audio` instead of `user_message`

This is a request-level hint on the submit route. It is not a new transcript event type and it does
not change model-facing message content.

## Error Handling

### Tool errors

The tools may fail only for backend-local reasons such as:

- invalid arguments
- inability to append the tool event to the session

These errors should use normal tool error behavior.

### Runtime playback/listen failures

These are not backend tool failures and should not be reported through the tool result:

- adapter unavailable
- playback failure
- local STT failure
- local timeout/disconnect

Those are client/runtime concerns.

## Suggested Backend Touchpoints

Primary files:

- `packages/agent-server/src/builtInTools.ts`
- `packages/agent-server/src/builtInTools.test.ts`
- `packages/agent-server/src/systemPrompt.ts`
- `packages/agent-server/src/systemPromptUpdater.test.ts`
- `packages/plugins/core/sessions/server/index.ts`
- `packages/plugins/core/sessions/server/index.test.ts`
- `packages/agent-server/src/sessionMessages.ts`
- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/chatProcessor.test.ts`
- `packages/shared/src/chatEvents.ts`

Potential secondary files, depending on implementation:

- `packages/agent-server/src/events/eventStore.ts`
- `packages/agent-server/src/events/eventStore.test.ts`
- `packages/agent-server/src/history/piSessionWriter.ts`
- `packages/agent-server/src/history/piSessionWriter.test.ts`

## Verification

Minimum backend coverage:

- `voice_speak` accepts valid text and rejects missing/empty text
- `voice_ask` accepts valid text and rejects missing/empty text
- both tools create normal tool-call/result transcript output
- spoken submit with `inputType: "audio"` and `durationMs` emits `user_audio`
- spoken submit still reaches the agent as ordinary user text
- plain text submit without `inputType` keeps existing `user_message` behavior

## Ownership Suggestion

Safe backend write scope for one worker:

- `packages/agent-server/src/builtInTools.ts`
- `packages/agent-server/src/builtInTools.test.ts`
- `packages/plugins/core/sessions/server/index.ts`
- `packages/plugins/core/sessions/server/index.test.ts`
- `packages/agent-server/src/sessionMessages.ts`
- `packages/agent-server/src/chatProcessor.ts`
- `packages/agent-server/src/chatProcessor.test.ts`

If shared schema or persistence changes are needed, coordinate before editing:

- `packages/shared/src/chatEvents.ts`
- `packages/agent-server/src/history/piSessionWriter.ts`
