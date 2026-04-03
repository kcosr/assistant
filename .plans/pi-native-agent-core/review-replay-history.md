# Replay / History Review

Current status: the branch has the new projected transcript protocol, request-group history edit APIs, and canonical Pi replay path wired for `pi` / `pi-cli`. The implementation is still mixed, though: replay is still projected from legacy `ChatEvent` history, live transcript sequencing is process-local, and attachment cleanup still assumes turn ids.

## Findings

- High: `revision` is synthesized from `updatedAt` timestamps in [`packages/plugins/core/sessions/server/index.ts`](packages/plugins/core/sessions/server/index.ts:84) and reused as the replay revision in [`packages/plugins/core/sessions/server/index.ts`](packages/plugins/core/sessions/server/index.ts:427). That is not a persisted monotonic revision, so rapid successive rewrites or clock skew can reuse the same revision and defeat stale-cursor invalidation.
- High: request-group cleanup still deletes attachments by `turnId`, not by `requestId`, in [`packages/agent-server/src/sessionHub.ts`](packages/agent-server/src/sessionHub.ts:640). The attachment store still keys ownership by `turnId` in [`packages/agent-server/src/attachments/store.ts`](packages/agent-server/src/attachments/store.ts:31), while imported/shared logs synthesize request ids in [`packages/agent-server/src/history/piSessionWriter.ts`](packages/agent-server/src/history/piSessionWriter.ts:1077). That means request rewrites for synthesized transcripts will not clean up dropped attachments deterministically.
- Medium: live projected transcript sequence numbers are kept in a process-global map in [`packages/agent-server/src/events/chatEventUtils.ts`](packages/agent-server/src/events/chatEventUtils.ts:351) and never reset when `session_history_changed` forces a transcript reload in [`packages/agent-server/src/sessionHub.ts`](packages/agent-server/src/sessionHub.ts:663) and [`packages/web-client/src/controllers/serverMessageHandler.ts`](packages/web-client/src/controllers/serverMessageHandler.ts:562). After a rewrite, live events can keep incrementing from the old sequence space while replay restarts from `0`, which breaks the sequence/cursor reconciliation contract.
- Medium: the new projected transcript schema exposes `exchangeId` in [`packages/shared/src/protocol.ts`](packages/shared/src/protocol.ts:563), but the projector still derives it from `messageId` for `agent_message` / `agent_callback` events in [`packages/plugins/core/sessions/server/transcriptProjection.ts`](packages/plugins/core/sessions/server/transcriptProjection.ts:168). That means agent-to-agent exchanges are not actually represented by a durable exchange id, so replay cannot correlate the caller/target/callback chain the way the plan requires.

## Completed Work

- [`packages/plugins/core/sessions/server/index.ts`](packages/plugins/core/sessions/server/index.ts:410) now serves projected transcript slices and request-group history edits for Pi-backed sessions.
- [`packages/agent-server/src/history/piSessionWriter.ts`](packages/agent-server/src/history/piSessionWriter.ts:1255) now writes explicit request boundary entries and rewrites history by request group.
- [`packages/shared/src/protocol.ts`](packages/shared/src/protocol.ts:563) now includes the projected transcript, replay, and request-edit schemas.
- [`packages/web-client/src/index.ts`](packages/web-client/src/index.ts:4051) and [`packages/web-client/src/controllers/serverMessageHandler.ts`](packages/web-client/src/controllers/serverMessageHandler.ts:222) now speak `transcript_event` and `session_history_changed`.

## Remaining Gaps

- Make revision an explicit persisted counter instead of deriving it from timestamps.
- Move attachment ownership and cleanup fully onto `requestId` plus `toolCallId`.
- Persist a real `exchangeId` through writer, replay, and projected transcript output.
- Reset the live projected sequence state when a rewrite forces a new revision.
- Remove the remaining turn-id compatibility paths once the new request-group contract is fully authoritative.
