# Web Client Review

## Current Status

The web client has the first cut of the new transcript transport in place. It can receive `transcript_event` messages, render projected transcript events, and surface the `requestId`-based history-edit menu for the visible transcript boundary. The basic UI path is covered by focused tests, so this is not a wiring-stub anymore.

What is still missing is the actual cursor-driven replay model the plan calls for. The current client still behaves like a full-refresh renderer with some cursor bookkeeping bolted on top, rather than a sequence/cursor-aware reconciler.

## Findings

- High: cursor-based incremental replay is effectively disabled. `loadSessionTranscript()` returns early once a session is marked loaded, so the stored `sessionTranscriptCursors` are never used to request an `afterCursor` slice after the initial load. That makes the new replay cursor state dead code and blocks the planned incremental replay/reconnect path. Files: [`/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/index.ts`](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/index.ts).
- Medium: history rewrites can leave stale buffered projected events behind. `session_history_changed` forces a transcript reload, but the client does not clear `bufferedTranscriptEvents` or otherwise invalidate buffered projected events for the old revision before replaying the new transcript. If live projected events were buffered during hydration, they can still be appended after the rewritten transcript. Files: [`/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/controllers/serverMessageHandler.ts`](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/controllers/serverMessageHandler.ts), [`/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/index.ts`](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/index.ts).
- Medium: projected transcript rendering still ignores the sequence contract. `ChatRenderer.replayProjectedEvents()` clears the DOM and renders whatever array it receives, `handleNewProjectedEvent()` just appends in arrival order, and `renderProjectedEvent()` routes off legacy `chatEventType` while discarding `sequence` and `revision`. The client therefore does not yet reconcile transcript state by the new canonical ordering model. Files: [`/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/controllers/chatRenderer.ts`](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/controllers/chatRenderer.ts), [`/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/index.ts`](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/web-client/src/index.ts).

## Notable Completed Work

- `transcript_event` is now part of the shared protocol and the client can render it.
- Session history editing has been moved to `requestId` on the client side, with UI copy updated from turn-centric wording.
- `ChatRenderer` has a projected-transcript entry point and tests now cover the projected replay path.
- `ServerMessageHandler` has explicit buffering hooks for projected transcript events during hydration.

## Remaining Gaps

- Make replay actually cursor-driven instead of full-refresh only.
- Invalidate buffered projected events when a transcript revision changes.
- Use `sequence`/`revision` to reconcile ordering and replay slices instead of relying on arrival order.
- Add coverage for stale-cursor, history-rewrite, and partial-replay cases.
