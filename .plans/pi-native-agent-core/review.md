# Pi Native Agent Core Migration Review

Reviewed on 2026-04-02 against the current `feat/pi-native-agent-core` worktree, using the
documents in `.plans/pi-native-agent-core/` as the target contract.

Detailed sub-reviews:

- `review-runtime-tools.md`
- `review-replay-history.md`
- `review-client.md`

## Overall Status

The branch has real migration progress:

- `@mariozechner/pi-agent-core` and `@mariozechner/pi-coding-agent` are added.
- `AuthStorage`-backed API key resolution is in place.
- projected transcript protocol types, session replay APIs, and request-group history edit APIs are
  implemented.
- the web client can load and render `transcript_event` payloads.
- targeted runtime, replay, protocol, and client tests are currently passing.

The branch is still a hybrid, not the target architecture from the plan. The native Pi path still
routes through the old chat loop and old tool/replay abstractions, and the new transcript layer is
still projecting legacy `ChatEvent` semantics rather than using the session file as the direct UI
source of truth.

## Findings

- High: the native cutover is not complete, so `provider === 'pi'` still runs through the legacy
  runtime contract instead of a clean `piNativeChat` path. `processUserMessage()` still delegates
  to `runChatCompletionCore()` in `packages/agent-server/src/chatProcessor.ts:596`, and
  `chatRunCore.ts` still owns the `Agent` instantiation, manual turn handling, tool iteration
  guard, EventStore emission, TTS wiring, and dual-format state updates in
  `packages/agent-server/src/chatRunCore.ts:1295`. Tool execution is still mediated through the
  old `ToolHost` surface in `packages/agent-server/src/tools/types.ts:196` and
  `packages/agent-server/src/tools.ts:154`, with plugin and MCP tools wrapped back into that bridge
  in `packages/agent-server/src/plugins/registry.ts:560` and
  `packages/agent-server/src/tools/mcpToolHost.ts:200`.

- High: replay for Pi sessions still depends on reconstructing legacy `ChatEvent` history, then
  projecting that into the new wire format, which is not the planned session-file-native replay
  model. The sessions plugin loads Pi replay through `loadCanonicalPiSessionEvents()` in
  `packages/plugins/core/sessions/server/index.ts:432`, which calls
  `buildChatEventsFromPiSession()` in `packages/agent-server/src/history/historyProvider.ts:1368`.
  The session writer is still mirroring legacy chat events into the Pi log via
  `appendAssistantEvent()` in `packages/agent-server/src/history/piSessionWriter.ts:1552`. This
  means the new replay transport exists, but the durable source is still a ChatEvent-shaped overlay
  encoded inside the Pi session file.

- High: the client replay contract is not actually incremental or sequence-driven yet. After the
  first transcript load, `loadSessionTranscript()` returns early in
  `packages/web-client/src/index.ts:4059`, so `afterCursor` is effectively unused. When replay does
  run, the client clears and re-renders whatever slice it received in
  `packages/web-client/src/index.ts:4102` instead of reconciling by `(revision, sequence)`. The
  renderer still routes projected events back through legacy `chatEventType` handling in
  `packages/web-client/src/controllers/chatRenderer.ts:470`, and the live handler simply appends
  arrival-order events in `packages/web-client/src/controllers/serverMessageHandler.ts:143`. The
  plan’s cursor/revision/sequence reconciliation model is therefore not enforced client-side yet.

- Medium: `revision` and live `sequence` are not durable enough for reliable stale-cursor and
  rewrite handling. Replay revision is still derived from `updatedAt` timestamps in
  `packages/plugins/core/sessions/server/index.ts:84` and reused in
  `packages/plugins/core/sessions/server/index.ts:427`, so it is not an explicit persisted counter.
  Live projected sequence numbers are stored in a process-local map in
  `packages/agent-server/src/events/chatEventUtils.ts:351` and are not reset when
  `session_history_changed` is broadcast from `packages/agent-server/src/sessionHub.ts:663`. That
  leaves the current implementation vulnerable to sequence-space drift across rewrites and process
  restarts.

- Medium: request-group ownership is still incomplete. `attachment_send` still requires `turnId`
  and stores attachment ownership by turn in `packages/agent-server/src/builtInTools.ts:250`, and
  the attachment store itself is still keyed by `turnId` in
  `packages/agent-server/src/attachments/store.ts:31`. History rewrite cleanup still deletes by
  turn ids in `packages/agent-server/src/sessionHub.ts:640`. That conflicts with the plan’s
  `requestId + toolCallId` ownership model and will not clean up synthesized request groups
  deterministically.

- Medium: agent-to-agent replay correlation still does not preserve a durable exchange id.
  `exchangeId` is present in the protocol in `packages/shared/src/protocol.ts:563`, but the
  projector still derives it from `messageId` for `agent_message` and `agent_callback` in
  `packages/plugins/core/sessions/server/transcriptProjection.ts:198`. That is weaker than the
  planned cross-session `exchangeId` contract for caller, target, and callback request groups.

## Notable Completed Work

- `packages/agent-server/src/llm/piSdkProvider.ts` now resolves API keys through `AuthStorage`.
- `packages/agent-server/src/tools.ts` and related tests added an `AgentTool`-shaped wrapper path.
- `packages/agent-server/src/history/piSessionWriter.ts` now writes explicit
  `assistant.request_start` / `assistant.request_end` boundaries and supports request-group history
  edits.
- `packages/plugins/core/sessions/server/index.ts`,
  `packages/plugins/core/sessions/server/transcriptProjection.ts`, and
  `packages/shared/src/protocol.ts` define the projected transcript replay API and wire schema.
- `packages/web-client/src/index.ts`,
  `packages/web-client/src/controllers/serverMessageHandler.ts`, and
  `packages/web-client/src/controllers/chatRenderer.ts` now handle projected transcript replay.
- The in-progress worktree also removes the old `chat_event` wire path and deletes
  `packages/web-client/src/utils/chatEventReplayDedup.ts`, which is aligned with the target
  direction even though the internal replay model is still legacy-backed.

## Validation

I ran these targeted suites and they passed:

- `npx vitest --run packages/shared/src/protocol.test.ts packages/agent-server/src/events/chatEventUtils.test.ts packages/agent-server/src/sessionConnectionRegistry.test.ts packages/plugins/core/sessions/server/index.test.ts packages/plugins/core/sessions/server/transcriptProjection.test.ts packages/web-client/src/controllers/serverMessageHandler.agentCallbackResult.test.ts packages/web-client/src/controllers/chatRenderer.test.ts`
- `npx vitest --run packages/agent-server/src/chatProcessor.test.ts packages/agent-server/src/ws/chatRunLifecycle.pi.test.ts packages/agent-server/src/tools.test.ts packages/agent-server/src/plugins/registry.test.ts packages/agent-server/src/history/piSessionWriter.test.ts`

## Near-Term Gaps

- Finish the actual runtime cutover away from `chatRunCore` / `processUserMessage`.
- Remove `ToolHost`, `eventStore`, and `historyProvider` from the target Pi runtime contract.
- Make replay projection session-file-native instead of ChatEvent-native.
- Make revision explicit and persistent, and make live/replay reconciliation actually use
  `sequence` and `cursor`.
- Move attachment ownership and cleanup fully to `requestId` plus `toolCallId`.
- Persist and project a real `exchangeId` for `agents_message`.
