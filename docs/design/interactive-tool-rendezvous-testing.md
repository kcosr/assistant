# Interactive Tool Rendezvous Testing

## Overview

Test that interaction ID correlation works correctly when multiple CLIs call interactive tools (like the questions plugin) via HTTP, and the responses are correctly routed through the WebSocket session.

## Background

The interaction system uses a three-part key for correlation:
- `sessionId` - The WebSocket session
- `callId` - The tool call ID (matched via rendezvous)
- `interactionId` - UUID generated per interaction request

### Key Components

1. **CliToolCallRendezvous** (`cliToolCallRendezvous.ts`)
   - Records tool calls from WebSocket sessions
   - Matches HTTP requests to in-flight tool calls using scoring
   - Falls back to `bash`/`shell`/`terminal` calls when no better match

2. **InteractionRegistry** (`interactionRegistry.ts`)
   - Registers pending interaction requests with composite key
   - Routes responses to correct pending request
   - Handles timeouts and session cleanup

3. **Operations** (`operations.ts`)
   - HTTP route handler that resolves `sessionId` and matches tool calls
   - Wires `requestInteraction` to the session context

## Existing Test Coverage

| File | Coverage |
|------|----------|
| `cliToolCallRendezvous.test.ts` | Scoring, waiting, fallback |
| `interactionRegistry.test.ts` | Registration, resolution, timeout |
| `questions/server/index.test.ts` | Validation, reprompt logic |

## Test Scenarios Needed

### 1. End-to-End HTTP → WS Interaction Flow
- CLI calls questions plugin via HTTP with `x-session-id` header
- Verify interaction request appears on WebSocket
- Submit response and verify it returns to HTTP caller

### 2. Concurrent Interactions from Multiple CLIs
- Two CLIs (e.g., `assistant-cli`, `coding-executor`) both call interactive tools
- Verify each response routes to the correct caller
- No cross-talk between sessions or tool calls

### 3. Rendezvous Edge Cases
- HTTP request arrives before WebSocket tool call (wait and match)
- HTTP request arrives after WebSocket tool call completes (timeout/error)
- Multiple tool calls in same session, correct one matched

### 4. Error Handling
- Client disconnects mid-interaction
- Interaction timeout behavior
- Session cleanup clears pending interactions

## Files to Update

- `packages/agent-server/src/ws/cliToolCallRendezvous.test.ts` - Add concurrent call tests
- `packages/agent-server/src/plugins/operations.test.ts` - Add HTTP interaction tests
- `packages/plugins/official/questions/server/index.test.ts` - Add integration scenarios

## Open Questions

1. **Which CLIs specifically?** The assistant app has multiple CLIs (assistant-cli, coding-executor, coding-sidecar). Which need testing?

2. **Integration vs Unit?** Should this be automated integration tests (spinning up real HTTP/WS) or mock-based unit tests?

3. **Manual Testing Needed?** Are there UI-specific scenarios (questionnaire rendering, focus behavior) that need manual verification?

4. **Test Environment** - Is there a test harness for running multiple CLI sessions against a test server?
