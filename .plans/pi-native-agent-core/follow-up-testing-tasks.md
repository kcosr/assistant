# Follow-Up Testing Tasks

This file captures the next testing work needed after the Pi-native replay/runtime cutover.

The goal is to prevent regressions in:
- replay after refresh
- reconnect during active streaming
- request-group history editing
- tool/attachment/interaction durability
- live/replay reconciliation

## Testing Strategy

Use a three-layer test pyramid:

1. Contract tests
2. Real wire integration tests
3. Small browser smoke suite

Most replay bugs should be caught in layers 1 and 2, without depending on a real browser.

## 1. Contract Tests

These should remain the largest body of coverage.

Primary files:
- [chatEventUtils.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/events/chatEventUtils.ts)
- [index.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/plugins/core/sessions/server/index.ts)
- [chatRenderer.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/controllers/chatRenderer.ts)

Add or tighten invariants for:
- normal streaming does not change transcript `revision`
- `sequence` is monotonic within one revision
- history edit bumps `revision` and forces reset/full replay
- replay merges canonical persisted transcript with in-memory live overlay
- reconnect mid-stream includes already-streamed chunks
- tool output deltas do not duplicate prior text
- `request_end` clears active request state and typing/busy indicators
- stale cursor on an older revision returns reset/full replay
- imported/shared Pi logs without assistant request markers still synthesize stable request groups

## 2. Real Wire Integration Tests

This is the most important missing layer.

Use:
- a real test server
- a real WebSocket client
- real `POST /api/plugins/sessions/operations/events`
- deterministic scripted streaming instead of a real model

Do not rely on browser automation for these.

Build a reusable scenario harness that can:
- create a session
- open WebSocket connection A
- send a message
- emit deterministic streamed transcript events
- call replay mid-stream
- disconnect/reconnect
- continue streaming
- assert replay/live consistency at each step

Core scenario to implement first:

1. Create session.
2. Connect websocket A.
3. Send one message.
4. Stream chunks `1..N`.
5. Call replay mid-stream and assert replay includes chunks `1..N`.
6. Disconnect websocket A.
7. Connect websocket B.
8. Call replay again and assert the same in-flight transcript is present immediately.
9. Stream chunks `N+1..end`.
10. Assert websocket B receives only the remaining suffix.
11. Assert final replay is complete and contains no duplicates.

Additional wire scenarios:
- refresh/reconnect during text streaming
- refresh/reconnect during tool output streaming
- refresh/reconnect followed by a second user message
- attachment bubble replay after reconnect
- questionnaire / interaction replay after reconnect
- delete request / trim before / trim after during non-empty transcript
- imported/shared Pi log load and subsequent rewrite into assistant request markers

## 3. Browser Smoke Suite

Keep this small.

Use Playwright rather than MCP/Chrome DevTools for regression automation.

Browser smoke should verify:
- refresh during text streaming preserves the visible partial turn
- refresh during tool streaming preserves visible streamed tool output
- sending another message after refresh does not wipe older turns
- typing indicator clears when the request completes
- attachment bubble survives reload
- request deletion updates the visible transcript correctly

These tests should validate the user-visible contract, not the full replay math.

## Recommended Next Implementation

Create a dedicated replay scenario harness and make it the main regression gate for replay/live bugs.

Suggested order:

1. Add a reusable real-wire replay scenario helper.
2. Implement the mid-stream reconnect scenario first.
3. Add tool-stream reconnect coverage.
4. Add request-history edit replay coverage.
5. Add a small Playwright smoke suite for the top UI flows.

## Non-Goals

Do not make replay correctness depend primarily on:
- manual MCP/DevTools browsing
- a real LLM provider
- long end-to-end browser suites for logic that can be tested at the wire level

The browser suite should stay narrow. The real-wire integration layer should carry most of the replay regression burden.
