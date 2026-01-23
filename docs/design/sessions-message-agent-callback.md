# Sessions Message Agent Callback

## Problem

When `sessions_message` is called in async mode, the only callback mechanism is webhooks. This is awkward for agent-to-agent communication where one agent delegates work to another via `sessions_message`.

The built-in `agents_message` tool has a better pattern: it tracks the calling session context and broadcasts the result back via `agent_callback_result`, then triggers a callback turn in the caller.

Currently:
- `agents_message` → internal callback via `agent_callback_result` broadcast
- `sessions_message` → external webhook (or no callback at all)

## Proposed Solution

Unify `sessions_message` async callbacks with the `agents_message` pattern when the caller is another agent session.

### Implementation

1. **Detect agent tool context** in `sessions_message`:
   ```typescript
   // In sessions plugin message operation
   const fromSessionId = ctx.sessionId;  // Calling session if from tool context
   const fromAgentId = ctx.agentId;
   ```

2. **Pass context to processUserMessage**:
   ```typescript
   await processUserMessage({
     // ...existing options
     agentMessageContext: fromSessionId ? {
       fromSessionId,
       fromAgentId,
       responseId,
     } : undefined,
   });
   ```

3. **On CLI completion, use existing callback mechanism**:
   - Broadcast `agent_callback_result` to caller session
   - Trigger callback turn in caller session
   - Return just `result.response` (final agent message, not full conversation)

4. **Webhook behavior**:
   - If called from an agent context: send internal callback **and** webhook (if provided)
   - If not called from an agent context: webhook-only (if provided)

### What Gets Returned

Only the final agent response text (`result.response.trim()`), not:
- Full conversation history
- Intermediate tool calls
- Thinking/reasoning

This matches what `agents_message` returns and is what callers typically want - the answer, not the transcript.

### Code Locations

- `packages/plugins/core/sessions/server/index.ts` - Add context detection
- `packages/agent-server/src/sessionMessages.ts` - Wire up agentMessageContext
- `packages/agent-server/src/builtInTools.ts` - Reference implementation in `executeAsyncAgentMessage`

### Benefits

1. **Consistent behavior** - Both `agents_message` and `sessions_message` work the same way for inter-agent calls
2. **No external dependencies** - No webhook server needed for agent-to-agent communication
3. **Automatic callback turns** - Calling agent can continue processing with the result
4. **Simpler mental model** - One pattern for async agent delegation

## Decisions

1. **Webhook + internal callback:** if a webhook is provided for an agent caller, send **both**.
2. **Text only:** callback payload is the final response text (`result.response.trim()`), no metadata.
3. **No timeout callback:** match current `agents_message` behavior (log errors only).
4. **Toolbox UI when attention required:** show the toolbox even if hidden; append an "attachment" row anchored to the bottom of the toolbox that contains the approval selections. This row remains visible whether collapsed or expanded; when expanded, it stays attached and moves down with the toolbox content.

## Files to Update

- `packages/plugins/core/sessions/server/index.ts` (detect caller context)
- `packages/agent-server/src/sessionMessages.ts` (agent callback + webhook flow)
- `packages/agent-server/src/builtInTools.ts` (reference behavior)
- `packages/web-client/src/panels/tools/*` (toolbox attachment row + attention UI)
