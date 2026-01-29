# Surface Pi CLI errors in chat UI

## Overview

When the Pi CLI encounters an error (rate limit, API error, etc.), it emits JSON events with
`stopReason: "error"` and an `errorMessage` field. Today the agent server ignores these events,
so the chat UI never shows the failure. This design adds error detection to the Pi CLI stream
parser and emits a client-facing error message using the existing red error UI.

## Goals

- Detect Pi CLI error responses from streaming JSON (events with `stopReason: "error"`).
- Extract and surface the error message in the chat UI using the existing error presentation.
- Handle errors generically (rate limits, API errors, authentication failures, etc.).

## Non‑Goals

- Changing Pi CLI retry logic or configuration.
- Adding new UI components beyond the existing error box.
- Blocking the stream on errors (Pi CLI may retry or recover).

## Pi CLI Error Event Structure

When an error occurs, Pi CLI emits events like:

```json
{"type":"message_end","message":{"stopReason":"error","errorMessage":"429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\",\"message\":\"...\"}}"}}
{"type":"turn_end","message":{"stopReason":"error","errorMessage":"..."}}
```

The `errorMessage` field contains either:
- A plain text error message
- A JSON-prefixed string (e.g., `429 {...}`) where the JSON contains `error.message`

## Proposed Design

### Server Behavior

1. In `packages/agent-server/src/ws/piCliChat.ts`, extend `processLine` to recognize error events:
   - `message_end` with `message.stopReason === "error"`
   - `turn_end` with `message.stopReason === "error"`

2. Extract the error message from `errorMessage`:
   - Try to parse embedded JSON to get `error.message`
   - Fall back to the raw `errorMessage` string

3. Add a new callback `onCliError?: (code: string, message: string) => void` to `runPiCliChat`
   so the caller can emit a chat error event.

4. Track errors with a flag to avoid duplicate error emissions per run.

### Client Behavior

- Use the existing `error` chat event rendering (red error box) to display the message.
- The stream continues if Pi CLI recovers; the error is informational.

## Files to Update

- `packages/agent-server/src/ws/piCliChat.ts` – parse error events, add `onCliError` callback
- `packages/agent-server/src/chatRunCore.ts` – wire `onCliError` to emit chat error event
- `packages/agent-server/src/ws/piCliChat.test.ts` – test error event parsing
- `packages/agent-server/src/ws/chatRunLifecycle.piCli.test.ts` – test error broadcast

## Open Questions

None.
