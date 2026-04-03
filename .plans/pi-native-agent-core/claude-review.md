# Claude Code Review: `feat/pi-native-agent-core`

**Date**: 2026-04-03
**Branch**: `feat/pi-native-agent-core` -> `main`
**Scope**: 133 files changed, ~12,800 added / ~8,500 removed

---

## Summary

This branch migrates the Pi runtime from an event-store-based overlay system to a
native agent loop with canonical transcript persistence. The change spans the full
stack: server agent loop, transcript persistence/replay, shared protocol, client
renderer, session plugin, and Android voice service cleanup.

### Major architectural changes

1. **Native Pi agent loop** (`chatRunCore.ts`) — replaces the prior overlay-based
   event mirroring with a direct `@mariozechner/pi-agent-core` Agent subscription
   that streams thinking, text, and tool-call events through the existing chat
   infrastructure.

2. **Canonical transcript persistence** (`piSessionWriter.ts`,
   `piTranscriptRevision.ts`) — Pi sessions now persist a monotonically-revisioned
   transcript as the source of truth, replacing the dual EventStore + overlay model.

3. **Transcript projection** (`transcriptProjection.ts`, `chatEventUtils.ts`) —
   server-side projection converts canonical Pi history into the projected
   transcript event wire format consumed by clients.

4. **Replay from transcript** (`piSessionReplay.ts`, `historyProvider.ts`) —
   session replay loads from the canonical transcript rather than replaying
   EventStore overlays.

5. **Client rendering overhaul** (`chatRenderer.ts`, `serverMessageHandler.ts`,
   `index.ts`) — the web client handles projected transcript events natively,
   replacing the old chatEvent replay/dedup system.

6. **Dead code removal** — extensive cleanup of legacy overlay replay paths,
   EventStore mirroring, and compatibility shims.

---

## High Severity Issues

### 1. Duplicate `startRequest` overwrites response ID before dedup check

**File**: `historyProvider.ts:~1504-1509`

In `startRequest`, the mutable state fields `currentRequestId`, `currentResponseId`,
`currentRequestExplicit`, and `currentRequestStartedAt` are all assigned **before**
checking `emittedRequestStarts.has(requestId)`. If the requestId was already emitted,
the function returns early without emitting a duplicate `request_start` event, but
`currentResponseId` has already been reset to `null`.

**Impact**: A duplicate `startRequest` call silently resets `currentResponseId`,
causing `ensureResponseId` to generate a new response ID mid-turn. This splits a
single turn's events across two different response IDs, corrupting the event stream
structure.

**Fix**: Move the `emittedRequestStarts.has(requestId)` check to the top of the
function, before any state mutation.

### 2. Async subscribe callback may produce unhandled rejections

**File**: `chatRunCore.ts:~1484-1539`

The `piAgentRuntime.agent.subscribe` callback is declared `async` and uses `await`
internally (e.g., `await streamHandlers.emitTextDelta`). If the Agent's `subscribe`
mechanism does not await the callback's returned promise, two problems arise:

- Errors thrown inside the async callback become **unhandled promise rejections**
  rather than propagating to the `try/finally` block around `agent.prompt`.
- Awaited operations inside the callback could execute **after** the subscription
  has been unsubscribed or the agent prompt has resolved, creating a race condition.

**Impact**: Silent error swallowing or post-teardown side effects during Pi agent
streaming.

**Fix**: Verify that `agent.subscribe` awaits async callbacks. If it does not, wrap
the callback body in a `.catch()` that propagates errors to the outer context (e.g.,
via an `AbortController` or shared error state).

### 3. Buffered transcript events lost on reload failure

**File**: `index.ts:~2256-2261`

When buffered events have a higher revision than the current replay revision,
`void loadSessionTranscript(trimmed, { force: true })` is called fire-and-forget.
The buffer has already been cleared (line ~2238), so if the force-reload fails
(network error, server error), those buffered events are **permanently lost**.

**Impact**: Client misses transcript events with no recovery path other than a full
page reload.

**Fix**: Retain the buffer until the reload succeeds. Either:
- Don't clear the buffer until the reload promise resolves, or
- Re-buffer the events in the reload's `.catch()` handler.

### 4. Double-apply on `'reload'` result

**File**: `serverMessageHandler.ts:~1965-1968`

When `applyResult === 'reload'`, the event is buffered and `loadSessionTranscript`
is called with `force: true`. However, the event was **already stored** in the
`projectedTranscriptEvents` map during the failed apply inside
`handleNewProjectedEvent` (which called `replayProjectedEvents`). After the reload
completes and the buffer is flushed, the event gets applied a second time.

**Impact**: Duplicate rendering of transcript events after a revision-triggered
reload. Depending on the event type, this could cause duplicate messages in the chat
UI, duplicate tool call entries, or incorrect sequence numbering.

**Fix**: Either:
- Don't buffer if the event is already in the `projectedTranscriptEvents` map, or
- Clear/reset the map entry before buffering so the reload starts fresh.

---

## Medium Severity Issues

### 5. `liveTranscriptStateBySession` global map leaks entries

**File**: `chatEventUtils.ts:157-172`

`liveTranscriptStateBySession` uses a `globalThis`-scoped `Map` keyed by sessionId.
Entries are added by `seedLiveTranscriptSessionState` and
`broadcastProjectedTranscriptEvents` but only removed by
`resetLiveTranscriptSessionState`.

If `resetLiveTranscriptSessionState` is never called for a session (e.g., server
crash, session timeout without cleanup, uncaught exception during teardown), entries
leak indefinitely.

**Impact**: Slow memory leak proportional to the number of Pi sessions that don't
cleanly shut down.

**Fix**: Hook cleanup into session teardown in `sessionHub.ts` or
`sessionRuntime.ts`. Consider using a `WeakRef`-based approach or a periodic sweep
as a safety net.

### 6. Unbounded `replayOverlay` growth during streaming

**File**: `chatEventUtils.ts:~784-801`

Transient events (`assistant_chunk`, `thinking_chunk`, `tool_input_chunk`, etc.) are
pushed into `replayOverlay` and only cleared on `turn_end`. For long-running turns
with heavy streaming (e.g., large code generation or verbose tool output), this array
grows without bound.

**Impact**: Memory pressure for long Pi sessions with large streaming responses.
Thousands of chunk events could accumulate per turn.

**Fix**: Consider:
- Compacting transient chunks periodically (merge consecutive text chunks)
- Setting a cap on `replayOverlay` size with a flush/compact trigger
- Clearing transient events when the corresponding `_done` event arrives (since
  chunks are superseded by the final content)

### 7. Mixed-revision batch silently drops older-revision events

**File**: `chatRenderer.ts:~1328-1332`

`incomingRevision` is taken from the **last** element of the normalized event array.
The subsequent filter `revisionEvents = normalized.filter(e => e.revision === incomingRevision)`
silently discards events from older revisions in the same batch.

**Impact**: If buffered events straddle a revision boundary (e.g., events from
revision N and N+1 arrive in the same WebSocket message), events from revision N are
silently dropped without triggering a reload. This causes rendering gaps — missing
messages or tool calls in the UI.

**Fix**: Either:
- Process events grouped by revision (handle each revision group sequentially), or
- Take the **minimum** revision and trigger a reload if mixed revisions are detected.

### 8. `computeToolOutputDelta` has O(n^2) worst case

**File**: `chatRunCore.ts:~96-112`

The overlap search loop iterates up to `min(previousText.length, nextText.length, 8192)`
times, with each iteration performing a `string.slice` comparison. For large tool
outputs approaching the 8KB cap with no overlap (worst case), this is O(n^2) in the
overlap region.

**Impact**: CPU cost per `tool_execution_update` event. With frequent tool output
updates (e.g., streaming build logs), this adds up.

**Fix**: Consider using a rolling hash or suffix-based approach for overlap detection.
Alternatively, if tool outputs are append-only in practice, a simpler length-based
check would suffice.

### 9. `tool_execution_update` offset semantics inconsistent with `toolInputOffsets`

**File**: `chatRunCore.ts:~1607`

`nextOffset = currentOffset + delta.length` is emitted as the offset, meaning the
first chunk is emitted with a non-zero offset equal to its own length. This means
the offset represents the **end** position of the chunk.

In contrast, `toolInputOffsets` uses **start** position semantics (initialized to 0,
incremented after emission).

**Impact**: Consumers of `tool_execution_update` events that interpret offset as a
start position (consistent with `toolInputOffsets` semantics) will render tool output
incorrectly.

**Fix**: Align offset semantics. Either emit `currentOffset` as the offset (start
position) and then increment, or document the end-position semantics clearly and
ensure all consumers handle it correctly.

### 10. Mutation of `state.chatMessages` during streaming

**File**: `chatRunCore.ts:~1544-1553`

In the `message_end` handler, `state.chatMessages` is mutated (via `push`) inside an
event subscription callback that runs concurrently with the agent loop. If
`agent.prompt` reads `state.chatMessages` for subsequent turns (e.g., through the
`convertToLlm` function which filters messages), there's a potential data race
between the subscription writing tool results and the agent reading messages for the
next LLM call.

**Impact**: Corrupted LLM context if the agent reads a partially-constructed message
array.

**Fix**: Verify that `agent.prompt` does not read `state.chatMessages` concurrently,
or use a double-buffer / snapshot approach.

---

## Low Severity Issues

### 11. Duplicate `buildPiAgentContext` call

**File**: `chatRunCore.ts:~1404-1421`

`buildPiAgentContext` is called twice with the same arguments. The first call sets
the system prompt via `setSystemPrompt`, then the second call destructures
`systemPrompt`, `contextMessages`, and `promptMessage` and calls `setSystemPrompt`
again. This is wasted computation.

**Fix**: Remove the first call or consolidate into a single invocation.

### 12. Redundant condition in event emission guard

**Files**: `chatProcessor.ts:~361`, `chatRunLifecycle.ts:~297`

```
(shouldEmitChatEvents && eventStore && turnId) || (chatProvider === 'pi' && turnId)
```

Since `shouldEmitChatEvents` is already set to `true` when `chatProvider === 'pi'`,
the second disjunct is always covered by the first when `turnId` is truthy.

**Fix**: Simplify to `shouldEmitChatEvents && turnId`. Verify that `eventStore` is
always truthy when `shouldEmitChatEvents` is true for Pi sessions.

### 13. Leaked `AbortController`

**File**: `sessionRuntime.ts:~1167`

---

## Assistant Triage Follow-Up

Reviewed against the current branch after the later Pi cutover work. Some findings are still
live, some are now stale, and a few are lower-priority robustness issues rather than blockers.

### Still actionable now

1. `historyProvider.ts` `startRequest` mutates replay state before the duplicate-request guard.
   That can still reset `currentResponseId` on a deduped `request_start`.

2. `chatRunCore.ts` still passes an `async` callback to `piAgentRuntime.agent.subscribe(...)`.
   Upstream `@mariozechner/pi-agent-core` `subscribe` is synchronous and does not await
   listener promises, so callback failures can escape the surrounding `prompt()` control flow.

3. Client replay robustness still needs tightening:
   - buffered transcript events are cleared before a forced reload succeeds in
     `packages/web-client/src/index.ts`
   - `replayProjectedEvents()` in `packages/web-client/src/controllers/chatRenderer.ts`
     still collapses mixed-revision batches to the last revision in the batch

4. `SessionHub.clearSession()` still leaves `providers.pi` / `providers.pi-cli`
   transcript metadata behind instead of removing the Pi provider state entirely.

5. `agents_message` callback contract/tests are out of sync around `exchangeId`.
   The runtime now includes it in callback context; tests and docs need to match the intended
   end-state contract.

### Valid but lower priority

- `liveTranscriptStateBySession` cleanup / overlay growth concerns
- tool output offset semantics consistency
- long-running replay/load recursion hardening

### Now stale after later cutover work

- Earlier findings tied to persisted streaming chunk entries (`assistant_chunk`,
  `thinking_chunk`, `tool_*_chunk`) are obsolete. That path was removed in favor of transient
  in-memory overlay plus canonical replay messages.

### Priority order

1. Fix `historyProvider.ts` request-start mutation ordering
2. Fix Pi async subscribe error propagation in `chatRunCore.ts`
3. Fix `SessionHub.clearSession()` provider metadata cleanup
4. Lock the `agents_message` `exchangeId` contract and align tests
5. Harden client buffered replay / mixed-revision handling

A `new AbortController()` is created for `toolContext.signal` but never stored or
aborted. Tools that register listeners on the signal hold references to the
controller.

**Impact**: Minor memory overhead if tool resolution is called repeatedly within a
session.

**Fix**: Store the controller and call `.abort()` during cleanup, or reuse a
session-scoped controller.

### 14. `toolcall_start` doesn't emit `tool_call_start` to client

**File**: `chatRunCore.ts:~1517-1521`

When `assistantEvent.type === 'toolcall_start'`, the handler only sets the
`toolInputOffsets` entry. It does not send a `tool_call_start` message to the client.
The actual `tool_call_start` is sent later in `tool_execution_start`, but there's a
gap — clients won't see the tool call announced during the LLM streaming phase, only
when execution begins.

**Impact**: If tool execution is delayed or skipped, the client never learns about
the tool call from the streaming phase. Minor UX gap.

### 15. `loadSessionTranscript` recursive call without depth guard

**File**: `index.ts:~2729-2731`

After `await loadPromise` completes, if `pendingForceReload` is true, it recursively
calls `await loadSessionTranscript(trimmed, { force: true })`. If another caller
concurrently sets `pendingForceReload` again during the recursive call, this could
chain indefinitely.

**Impact**: Unlikely in practice, but could cause infinite reload loops under
adversarial conditions.

**Fix**: Add a max recursion/iteration guard.

### 16. Silent drop of future overlay event types

**File**: `historyProvider.ts:~2066`

The overlay event type switch handles specific types but uses an unconditional
`continue` that silently drops any unmatched types. If new overlay types are added
to `isOverlayChatEventType`, they will be silently lost during Pi transcript
projection.

**Impact**: Data loss risk for future additions. Currently no types fall through
unhandled.

**Fix**: Add a default case that logs a warning for unknown overlay event types.

---

## Test Coverage Assessment

### Strengths

- **`chatEventUtils.test.ts`** (784 new lines): Thorough coverage of the live
  transcript broadcast pipeline. Tests Pi vs non-Pi paths, transient streaming
  overlay, sequence numbering, replay-seeded state continuity, and history
  realignment after refresh.

- **`chatRunLifecycle.pi.test.ts`** (+657 lines): Full mock of the
  `@mariozechner/pi-agent-core` Agent class with detailed event emission. Tests
  end-to-end Pi agent prompt flow including thinking, text, and tool calls.

- **`piSessionWriter.test.ts`**: Updated for rename from `turn`/`assistant.input` to
  `request`/user-message-with-meta format. Adds `transcriptRevision` assertions on
  rewrites.

- **`transcriptProjection.test.ts`** (120 new lines): Covers the new transcript
  projection logic including cursor pagination.

- **`sessionConnectionRegistry.test.ts`** (+332 lines): Expanded for subscription
  lifecycle changes.

- **Assertion quality**: Tests check exact `revision`/`sequence` values, verify
  `transcript_event` shapes, confirm `appendAssistantEvent` call counts, and validate
  file-level JSONL content. These are not smoke tests.

### Gaps

- **`chatRunCore.ts`** (+948/-317 lines) — the largest changed source file, tested
  only indirectly via `chatRunLifecycle.pi.test.ts`. No dedicated unit tests for
  internal branching logic (`computeToolOutputDelta`, offset tracking, message
  assembly).

- **`piTranscriptRevision.ts`** (38 new lines) — no dedicated unit test. Tested
  indirectly through `piSessionWriter` and `chatEventUtils`.

- **`sessionHub.ts`** (+221 lines) — significant refactoring with no new dedicated
  tests.

- **`sessionRuntime.ts`** (+108 lines) — tested only via
  `subscriptionRuntime.test.ts` (+73 lines), which is proportionally thin.

- **Client-side rendering** — `chatRenderer.test.ts` changes (+540/-lines) exist
  but the mixed-revision batch edge case (#7) and reload-failure event loss (#3)
  are not tested.

---

## Recommendations (Priority Order)

1. **Fix `startRequest` dedup ordering** (#1) — move the `has()` check before
   mutating state. Highest correctness risk.

2. **Verify `agent.subscribe` awaits async callbacks** (#2) — if not, add error
   propagation wrapper. Silent error swallowing is dangerous.

3. **Guard against reload failure losing buffered events** (#3) — retain buffer
   until reload succeeds.

4. **Prevent double-apply on reload** (#4) — either don't buffer if already in map,
   or clear map entry before buffering.

5. **Fix mixed-revision batch handling** (#7) — process events grouped by revision
   or detect and trigger reload.

6. **Add session cleanup for `liveTranscriptStateBySession`** (#5) — hook into
   session teardown.

7. **Add unit tests for `chatRunCore.ts` internals** — `computeToolOutputDelta`,
   offset tracking, and message assembly deserve direct test coverage given the
   file's size and centrality.

8. **Align `tool_execution_update` offset semantics** (#9) — consistency with
   `toolInputOffsets` reduces consumer confusion.

9. **Remove duplicate `buildPiAgentContext` call** (#11) — easy cleanup.

10. **Add depth guard to `loadSessionTranscript` recursion** (#15) — defensive
    measure against infinite reload loops.
