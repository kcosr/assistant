# Tools — Migration Design

## Overview

Assistant has two categories of tools:

1. **Built-in tools** — registered directly in code (`builtInTools.ts`): `voice_speak`, `voice_ask`, `attachment_send`, and the `agents_message` handler
2. **Plugin tools** — generated from plugin manifests at runtime (`plugins/registry.ts`): notes, lists, search, time-tracker, coding tools (read/write/edit/bash/grep/find/ls), panels, etc.

Both currently use assistant's own interfaces (`BuiltInToolDefinition`, `PluginToolDefinition`) which take raw `unknown` args and return `unknown`. These need to migrate to agent-core's `AgentTool` interface.

Decision after code review: move directly to native `AgentTool` as the runtime contract.

`AgentTool` is expressive enough for assistant's current needs. The remaining work is not a model
gap in pi-agent-core; it is a rewrite of assistant's tool construction layer so built-ins, plugins,
coding tools, and MCP tools are produced as `AgentTool`s directly.

## Target Interface

Agent-core's `AgentTool`:

```typescript
interface AgentTool<TParameters extends TSchema, TDetails = any> {
  name: string;
  label: string;
  description: string;
  parameters: TParameters;           // TypeBox schema
  execute: (
    toolCallId: string,
    params: Static<TParameters>,     // parsed, validated
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

Key differences from assistant's current interfaces:
- **Params are parsed objects**, not raw JSON strings or `unknown`
- **Return type is structured** (`AgentToolResult` with content + details), not arbitrary `unknown`
- **TypeBox schemas** for parameters instead of plain JSON Schema objects
- **`onUpdate` callback** for streaming tool output (replaces assistant's `ToolUpdate`)
- **`signal` parameter** for abort (currently on `ToolContext`)
- **`label` field** required (human-readable display name)

## Category 1: Coding Tools (read, write, edit, bash, grep, find, ls)

### Approach: Import from `@mariozechner/pi-coding-agent`

The coding-agent already exports these as `AgentTool` creators:

```typescript
import { createReadTool, createWriteTool, createEditTool,
         createBashTool, createGrepTool, createFindTool,
         createLsTool } from '@mariozechner/pi-coding-agent';

const tools = [
  createReadTool(cwd),
  createWriteTool(cwd),
  createEditTool(cwd),
  createBashTool(cwd),
  createGrepTool(cwd),
  createFindTool(cwd),
  createLsTool(cwd),
];
```

Each tool:
- Takes a `cwd` parameter for path resolution
- Returns a proper `AgentTool` with TypeBox schema
- Has `operations` option for pluggable I/O (e.g., remote execution)
- Handles abort signals, image detection, output truncation

### Considerations

- Coding-agent tools import TUI rendering utilities (`@mariozechner/pi-tui`) for their `renderResult` methods. Assistant doesn't use TUI rendering. The `AgentTool` interface only requires `execute`, not render — so this is fine. We only use the `execute` path.
- The tools have `ToolDefinition` (coding-agent's richer type with `promptSnippet`, `promptGuidelines`, `renderCall`, `renderResult`) but are wrapped to plain `AgentTool` via `wrapToolDefinition`. We can import the `AgentTool` directly.
- The `cwd` must be resolved per session (from session working directory config).

### Dependency Decision

Use `@mariozechner/pi-coding-agent` as the source of truth for coding-tool implementations.

Decision:

- Import the coding tools directly from `@mariozechner/pi-coding-agent`
- Do not copy the tool sources into assistant
- If package/runtime issues appear, fix them at the package boundary rather than forking the tool
  code into assistant

Rationale:

- keeps the long-term architecture single-source rather than creating a local fork
- avoids permanent drift between assistant and coding-agent tool behavior
- matches the goal of moving toward the native pi stack instead of rebuilding it locally
- keeps assistant focused on runtime integration, not tool maintenance

The server build still needs an immediate validation pass to prove the imported dependency surface
is safe in-process, but import is the target design, not a tentative default.

## Hook Ownership

Target ownership for orchestration concerns:

- `beforeToolCall`
  - approvals
  - tool-call rate limiting
  - final allow/deny checks after argument validation
- `afterToolCall`
  - result normalization
  - error/result metadata shaping
  - post-execution logging / metrics

Until that migration is complete, the existing assistant tool stack may still own some of this
logic internally. That is a temporary implementation detail, not the end-state contract.

## Category 2: Plugin Tools (notes, lists, search, etc.)

### Current Shape

Plugins register tools via `PluginToolDefinition`:

```typescript
interface PluginToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  capabilities?: string[];
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}
```

These are generated dynamically from plugin manifests and operations.

### Approach: Emit Native AgentTools Directly

Do not keep `ToolHost` as the runtime execution abstraction.

Instead:

1. Rewrite plugin generation so it emits `AgentTool`s directly.
2. Keep a small assistant-local helper layer for constructing per-session execution closures.
3. Reuse existing business logic (`handler(args, ctx)`, operation coercion, interaction wiring,
   approvals, rate limiting, nested chunk forwarding) behind those `AgentTool` implementations.

Deep-dive conclusion:

- built-in tools are straightforward to rewrite directly
- plugin tools can stay on their current handler logic, but should be wrapped at registration time
  into native `AgentTool`s rather than routed back through `ToolHost`
- coding tools already exist as native `AgentTool`s in `pi-coding-agent`
- MCP tools need an `AgentTool` wrapper around the current MCP client, but there is no conceptual
  blocker requiring `ToolHost` to stay as the primary runtime abstraction

### Generated Operation Tools

Manifest-defined plugin operations need a more explicit migration plan because they are generated
rather than hand-written one by one.

Target rules:

- generate one `AgentTool` per manifest operation
- preserve current naming from `resolveToolConfig()` / `normalizeToolPrefix()`
- preserve current description and capability wiring from the manifest
- keep HTTP/CLI operation surfaces independent; the `AgentTool` migration is only for the tool
  surface

Implementation shape:

1. Keep the current manifest-to-tool discovery path in `createPluginOperationSurface()`.
2. Replace the returned `PluginToolDefinition[]` tool surface with generated `AgentTool[]`.
3. Keep the existing operation handler functions as the business logic endpoint.
4. Keep route generation for HTTP operations unchanged except for any context-type fallout from the
   tool runtime rewrite.

This keeps generated tools and generated HTTP routes aligned around the same manifest/handler
definitions without preserving the old `ToolHost` execution contract.

### Schema And Argument Semantics

Generated plugin tools should preserve current input behavior as closely as possible.

Plan:

- wrap the normalized manifest JSON schema with `Type.Unsafe()` for the `AgentTool.parameters`
  field
- preserve assistant-side `coerceArgs()` and `validateArgs()` behavior before invoking the
  operation handler
- do not rely on raw TypeBox validation alone if that would change current string-to-number,
  string-to-boolean, string-to-array, or JSON-text coercion behavior

This matters because generated operation tools currently accept some values through best-effort
coercion in [operations.ts](/home/kevin/worktrees/assistant-pi-native-agent-core/packages/agent-server/src/plugins/operations.ts). The migration should not silently tighten or reshape plugin inputs just because the runtime contract changes.

### Result Shaping For Generated Tools

Generated plugin operations return arbitrary JSON-serializable values today. The migration needs a
deterministic adapter from those results into `AgentToolResult`.

Compatibility-first rule:

- `details` carries the raw operation result
- `content` is derived for model/tool-result visibility:
  - string result → one text content item with that string
  - number / boolean / null → one text content item with JSON stringification
  - object / array → one text content item with stable JSON stringification

Scope limit:

- richer outputs such as attachment bubbles or non-text media should not be implicit in generated
  plugin operations
- plugins that need richer tool-result semantics should use an explicit built-in or hand-written
  native `AgentTool`, not the generic generated-operation adapter

### Target ToolContext For Generated Tools

The generated-tool path should narrow the current `ToolContext` instead of carrying forward every
legacy dependency.

Target execution context for generated tools:

- keep:
  - `signal`
  - `sessionId`
  - `toolCallId`
  - `requestInteraction`
  - `approvals`
  - `interaction`
  - `onUpdate`
  - `forwardChunksTo`
  - `sessionHub`
  - `sessionIndex`
  - `agentRegistry`
  - `envConfig`
  - `scheduledSessionService`
  - `searchService`
- add / prefer:
  - `requestId` as the outer request-group id
- phase out:
  - `turnId` as the primary visible-history anchor
  - `eventStore`
  - `historyProvider`
  - `baseToolHost`

If a plugin operation still needs one of the phase-out fields during migration, treat that as a
temporary adapter concern and track it explicitly rather than leaving the final context contract
vague.

### ToolContext Mapping

Plugin handlers currently receive a rich `ToolContext` with sessionId, sessionHub, interaction
helpers, and other assistant services.
We still need to construct this from the agent-core execution context, but that can happen inside
native `AgentTool.execute()` implementations:

```typescript
function buildToolContext(options: {
  toolCallId: string;
  signal: AbortSignal;
  onUpdate?: AgentToolUpdateCallback;
  // ... session-level context captured in closure
}): ToolContext {
  return {
    signal: options.signal,
    sessionId,
    toolCallId: options.toolCallId,
    turnId,
    responseId,
    agentRegistry,
    sessionIndex,
    envConfig,
    sessionHub,
    requestAdapter,
    sessionWriter,
    // ... etc
    onUpdate: options.onUpdate ? (update) => {
      options.onUpdate!({
        content: [{ type: 'text', text: update.delta }],
        details: update.details ?? {},
      });
    } : undefined,
  };
}
```

### Schema Conversion

Plugin tools use plain JSON Schema objects. Agent-core uses TypeBox. Options:

1. **Convert at registration time** — parse JSON Schema to TypeBox. Complex, fragile.
2. **Use `Type.Unsafe()`** — TypeBox allows wrapping raw JSON Schema: `Type.Unsafe(plugin.inputSchema)`. Agent-core's `validateToolArguments` uses TypeBox's `Value.Check` which works with unsafe schemas.
3. **Pass through as-is** — agent-core's `AgentTool.parameters` is typed as `TSchema` but at runtime it's just used for validation. Raw JSON Schema objects may work.

**Recommendation**: Use `Type.Unsafe()` to wrap plugin JSON schemas. Minimal code, correct typing.

## Category 3: Built-In Tools (voice, attachments, agents_message)

### Approach: Rewrite as AgentTool

These are small, hand-written tools. Rewrite each directly:

#### voice_speak / voice_ask

```typescript
const voiceSpeakTool: AgentTool = {
  name: 'voice_speak',
  label: 'Voice Speak',
  description: '...',
  parameters: Type.Object({
    text: Type.String({ description: 'The exact words the user should hear.' }),
  }),
  execute: async (_toolCallId, params) => {
    return {
      content: [{ type: 'text', text: JSON.stringify({ accepted: true }) }],
      details: { accepted: true },
    };
  },
};
```

#### attachment_send

Rewrite `handleAttachmentSend` to return `AgentToolResult` instead of raw object. The logic stays
the same, just the return shape changes. Its result also needs stable projection into the
session-local replay sequence so attachment bubbles reconcile identically across live stream,
reconnect, and reload.

Attachment ownership should be explicit:

- persist the owning `requestId`
- persist the `toolCallId`
- use those ids for replay placement and history-edit cleanup

#### agents_message

This is the most complex built-in tool (~500 lines). It needs access to sessionHub, agentRegistry,
envConfig, and request/persistence coordination helpers. These would be captured in a closure when
creating the tool:

```typescript
function createAgentsMessageTool(deps: {
  sessionHub: SessionHub;
  agentRegistry: AgentRegistry;
  envConfig: EnvConfig;
  requestAdapter: RequestAdapter;
  sessionWriter: PiSessionWriter;
  // ...
}): AgentTool {
  return {
    name: 'agents_message',
    label: 'Send Agent Message',
    description: '...',
    parameters: agentsMessageSchema,
    execute: async (toolCallId, params, signal) => {
      const result = await handleAgentMessage(params, deps, signal);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
```

**Key change**: `agents_message` currently calls `processUserMessage` which is deeply tied to the old chat path. In the new architecture, it routes through **SessionHub** instead — `sessionHub.sendMessage(targetSessionId, text)` or similar. SessionHub knows how to dispatch to the target session's `Agent` instance. The tool doesn't need to know about chat internals at all.

Flow:
1. `execute()` resolves target agent + session (same as today)
2. Calls `sessionHub.sendMessage(targetSessionId, text, { fromSessionId, fromAgentId, mode })`

### Exchange Model

`agents_message` should use one durable cross-session `exchangeId` per invocation.

Rules:

- `requestId` stays per-session and identifies one outer request group in that session
- `exchangeId` spans the caller request, the target request, and any callback request triggered by
  that `agents_message` exchange
- callback turns are normal new outer requests in the caller session, not a separate persistence
  model

Persistence:

- caller-side tool metadata should include `exchangeId`
- target-side attribution metadata entry should include:
  - `kind: 'agent_message'`
  - `exchangeId`
  - `fromSessionId`
  - `fromAgentId`
  - caller `requestId` when available
- callback-side attribution metadata entry should include:
  - `kind: 'callback'`
  - `exchangeId`
  - `fromSessionId`
  - `fromAgentId`
  - source target-session `requestId` when available

This keeps cross-session correlation in the same pi JSONL file without introducing a second replay
or callback store.
3. SessionHub routes to the target session's pi-native chat module
4. For sync mode: await result. For async: fire-and-forget, SessionHub handles callback routing.

This eliminates the tight coupling to `processUserMessage` and all the tool host / tool scoping re-resolution that currently happens inside the tool.

## Category 4: Interaction Tools (questions, approvals)

Currently, tools can call `ctx.requestInteraction()` to prompt the user mid-execution. This is a side effect from within the tool's handler.

With agent-core, tools still have full control during `execute()`. The interaction flow would work the same way — the tool calls an interaction function captured in its closure, waits for the response, and continues. Agent-core doesn't interfere with what tools do during execution.

No product-level architecture change needed, but the migration must preserve current semantics from
`ToolContext`:

- `requestInteraction()`
- approval cache access
- `forwardChunksTo` for nested streaming
- durable interaction persistence through the session writer / request adapter

## Tool Execution Mode

Agent-core supports parallel tool execution. Assistant should not enable that by default in the
first migration cut.

Reason:
- current tools have side effects
- interactions can block on user input
- live/replay UI ordering is observable and now needs to reconcile through one sequence/cursor model
- nested chunk forwarding and `agents_message` are concurrency-sensitive

Default policy:
- first cut: `sequential`
- later: enable `parallel` only after tool-safety review and explicit tests

## Interaction Model

Tools continue to own interaction behavior inside `execute()`, but the durable state model changes:

- every user-visible interaction lifecycle step must be persisted in the same pi session file
- the in-memory waiter/promise is only a live execution detail, not the source of truth
- synchronous waits may block while the process is alive, but they are not revived as blocked
  promises after restart
- asynchronous interaction completion should resume through a later normal agent request, backed by
  durable session-file entries, not by continuing an old suspended tool call

Recommended durable custom entries:

- `assistant.interaction_request`
- `assistant.interaction_response`
- `assistant.interaction_update`
- `assistant.interaction_terminal`

This keeps interaction recovery in the same single-file history model as messages, turns, and outer
request groups.

## Tool Scoping

Assistant has `toolAllowlist` / `toolDenylist` per agent to control which tools are visible. This filtering happens at the `ToolHost` level before tools are passed to the chat run.

With agent-core, filtering happens before setting `agent.setTools(filteredTools)`. Same logic, different point of application.

## Summary

| Tool Category | Count | Approach |
|---|---|---|
| Coding tools (read, write, edit, bash, grep, find, ls) | 7 | Import from `@mariozechner/pi-coding-agent` |
| Plugin tools (notes, lists, search, etc.) | ~30+ | Change generation to output `AgentTool` directly |
| Built-in tools (voice, attachments) | 3 | Rewrite as `AgentTool` |
| agents_message | 1 | Rewrite as `AgentTool`, update to use new chat module |
| Interaction tools | varies | No architecture change, pass context through closure |

## Deep-Dive Conclusion

Direct native `AgentTool` usage is viable. I do not see an architectural gap that requires a
runtime `ToolHost` bridge.

The concrete rewrite surfaces are:

- built-in tool registration (`registerBuiltInSessionTools`)
- plugin tool registration (`PluginToolDefinition` / `PluginToolHost`)
- MCP tool registration (`McpToolHost`)
- per-session tool scoping and exposure
- shared closure/context construction for `sessionId`, `requestId`, interaction helpers,
  event/persistence hooks, and chunk forwarding

Those are implementation tasks, not blockers in the pi tool model.

## Open Questions

- [x] Coding tools source — import directly from `@mariozechner/pi-coding-agent`; do not copy tool
  sources into assistant
- [x] Generated plugin tool schema wrapping — use `Type.Unsafe()` around normalized manifest JSON
  schema, while preserving assistant-side coercion/validation helpers for parity
- [x] First-cut runtime contract — use native `AgentTool` directly, not a compatibility `ToolHost`
  adapter
- [x] Generated plugin result shaping — raw result goes in `details`; textual `content` is derived
  deterministically for strings/scalars/objects
- [ ] Which built-in/plugin tools can safely opt into parallel execution later?
