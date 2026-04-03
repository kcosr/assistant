# Runtime / Tooling Review

Current status: the branch has landed some real migration plumbing, and the targeted runtime/tooling tests pass, but the native pi path is still a hybrid. `AgentTool` helpers, `AuthStorage` lookup, and transcript projection code are present, yet `provider === 'pi'` still flows through the legacy `ToolHost` / `EventStore` orchestration and the old chat loop.

## Findings

- High: the native runtime cutover is not actually wired yet. [sessionRuntime.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/ws/sessionRuntime.ts#L1055), [sessionRuntime.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/ws/sessionRuntime.ts#L1240), [chatProcessor.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/chatProcessor.ts#L25), [chatRunCore.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/chatRunCore.ts#L1295)
  - `SessionRuntime` still resolves tools through `createScopedToolHost` / `listAgentToolsForHost` and passes `eventStore` into the run path.
  - `chatProcessor.ts` still delegates to `runChatCompletionCore`.
  - `chatRunCore.ts` still owns the `Agent` instantiation, manual turn handling, and EventStore broadcast bridge.
  - Impact: the old abstraction remains live, so the migration target is not yet the runtime contract and legacy replay/tool semantics are still coupled to the pi provider.

- High: the tool contract still bakes in deprecated turn-scoped and replay-scoped state. [tools/types.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/tools/types.ts#L106), [builtInTools.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/builtInTools.ts#L250)
  - `ToolContext` still exposes `turnId`, `responseId`, `baseToolHost`, `eventStore`, and `historyProvider`.
  - `attachment_send` still requires `turnId` and stores attachment ownership against `turnId` instead of `requestId`.
  - Impact: new `AgentTool`s cannot anchor work to the outer request group, so attachment cleanup and history rewrites remain turn-scoped instead of request-group scoped.

- Medium: agent-to-agent replay correlation is keyed to message IDs instead of exchange IDs. [transcriptProjection.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/plugins/core/sessions/server/transcriptProjection.ts#L198), [protocol.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/shared/src/protocol.ts#L437)
  - `transcriptProjection.ts` maps `agent_message` and `agent_callback` to `exchangeId: event.payload.messageId`.
  - The protocol documents `agentExchangeId` as the grouping key for a single `agents_message` exchange.
  - Impact: callbacks and related UI/replay events can be grouped by the message record rather than the cross-session exchange, which risks mis-threading agent exchange state.

## Completed Work

- Added `@mariozechner/pi-agent-core` and `@mariozechner/pi-coding-agent` to `packages/agent-server/package.json`.
- Introduced `createAgentTool` / `AgentToolResult` helpers in `packages/agent-server/src/tools.ts`.
- Switched `packages/agent-server/src/llm/piSdkProvider.ts` to `AuthStorage`-backed API key lookup.
- Added projected transcript handling in `packages/plugins/core/sessions/server/transcriptProjection.ts` and wired the sessions plugin to use it.
- Targeted checks passed: `tools.test.ts`, `plugins/registry.test.ts`, `ws/chatRunLifecycle.pi.test.ts`, `chatProcessor.test.ts`, `llm/piSdkProvider.test.ts`, plus `tsc -p packages/agent-server/tsconfig.json --noEmit`.

## Remaining Gaps

- Replace `ToolHost`-based runtime resolution with native `AgentTool` wiring end-to-end.
- Move attachment ownership and cleanup from `turnId` to `requestId` plus `toolCallId`.
- Remove `eventStore` / `historyProvider` from the tool contract once replay is fully projection-based.
- Finish the `provider === 'pi'` cutover away from `chatRunCore` / `processUserMessage`.
