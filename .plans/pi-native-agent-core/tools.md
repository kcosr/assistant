# Tools — Migration Design

## Overview

Assistant has two categories of tools:

1. **Built-in tools** — registered directly in code (`builtInTools.ts`): `voice_speak`, `voice_ask`, `attachment_send`, and the `agents_message` handler
2. **Plugin tools** — generated from plugin manifests at runtime (`plugins/registry.ts`): notes, lists, search, time-tracker, coding tools (read/write/edit/bash/grep/find/ls), panels, etc.

Both currently use assistant's own interfaces (`BuiltInToolDefinition`, `PluginToolDefinition`) which take raw `unknown` args and return `unknown`. These need to migrate to agent-core's `AgentTool` interface.

The migration does not need to rewrite every tool up front. The existing tool host already
contains approvals, interaction routing, rate limiting hooks, MCP/plugin loading, and
`agents_message` side effects. The lowest-risk first cut is an adapter layer that exposes current
tool-host tools as `AgentTool`s while preserving current behavior.

Target-state note: these adapters are temporary internal scaffolding only. The target contract is
native `AgentTool` implementations and agent-core hook ownership where that improves clarity.

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

Add `@mariozechner/pi-coding-agent` as a dependency for the tool implementations, or copy the tool
source files. Importing is cleaner if the package is available; copying avoids pulling in TUI and
other CLI dependencies if package size / install surface becomes a problem.

**Recommendation**: Import first, but verify the agent-server build/runtime impact immediately.
`@mariozechner/pi-coding-agent` depends on `@mariozechner/pi-tui` and other CLI packages. The
runtime should prove that those imports remain safe in the server process before committing to this
as the permanent approach.

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

### Approach: Start with an Adapter, Then Move Native

Initial migration path:

1. Keep plugin generation as-is.
2. Wrap the existing `ToolHost` or plugin tool definitions in `AgentTool` adapters.
3. Convert plugin generation to emit native `AgentTool`s only after the new pi-native runtime is
   stable.

Reason: current plugin tools already carry coercion, HTTP surface generation, CLI matching, and
interaction wiring. Replacing all of that in the same migration as the core chat loop would widen
the failure surface unnecessarily.

### ToolContext Mapping

Plugin handlers currently receive a rich `ToolContext` with sessionId, eventStore, sessionHub, etc. We need to construct this from the agent-core execution context:

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
    baseToolHost,
    eventStore,
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

Rewrite `handleAttachmentSend` to return `AgentToolResult` instead of raw object. The logic stays the same, just the return shape changes.

#### agents_message

This is the most complex built-in tool (~500 lines). It needs access to sessionHub, agentRegistry, envConfig, eventStore, etc. These would be captured in a closure when creating the tool:

```typescript
function createAgentsMessageTool(deps: {
  sessionHub: SessionHub;
  agentRegistry: AgentRegistry;
  envConfig: EnvConfig;
  eventStore?: EventStore;
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

This is the desired end state. For the migration cutover, it is acceptable to keep
`agents_message` on a compatibility bridge into the existing session/runtime entrypoint until the
new pi-native dispatch path supports:

- sync mode
- async mode
- callback turns
- chunk forwarding for nested tool output
- agent exchange ids
- questionnaire / interaction propagation

Flow:
1. `execute()` resolves target agent + session (same as today)
2. Calls `sessionHub.sendMessage(targetSessionId, text, { fromSessionId, fromAgentId, mode })`
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
- `eventStore` emission for interaction state recovery

## Tool Execution Mode

Agent-core supports parallel tool execution. Assistant should not enable that by default in the
first migration cut.

Reason:
- current tools have side effects
- interactions can block on user input
- EventStore/WebSocket ordering is observable
- nested chunk forwarding and `agents_message` are concurrency-sensitive

Default policy:
- first cut: `sequential`
- later: enable `parallel` only after tool-safety review and explicit tests

## Tool Scoping

Assistant has `toolAllowlist` / `toolDenylist` per agent to control which tools are visible. This filtering happens at the `ToolHost` level before tools are passed to the chat run.

With agent-core, filtering happens before setting `agent.setTools(filteredTools)`. Same logic, different point of application.

If the first cut uses a compatibility tool-host adapter, keep the current scoping logic exactly as
it is and apply it before building the adapter list.

## Summary

| Tool Category | Count | Approach |
|---|---|---|
| Coding tools (read, write, edit, bash, grep, find, ls) | 7 | Import from `@mariozechner/pi-coding-agent` |
| Plugin tools (notes, lists, search, etc.) | ~30+ | Change generation to output `AgentTool` directly |
| Built-in tools (voice, attachments) | 3 | Rewrite as `AgentTool` |
| agents_message | 1 | Rewrite as `AgentTool`, update to use new chat module |
| Interaction tools | varies | No architecture change, pass context through closure |

## Open Questions

- [ ] Import coding tools from pi-coding-agent or copy source? (Recommend: import first, validate build/runtime impact)
- [ ] TypeBox schema conversion for plugin tools: `Type.Unsafe()` vs pass-through?
- [ ] Do we keep a compatibility adapter over `ToolHost` for the first cut? (Recommend: yes)
- [ ] Which built-in/plugin tools can safely opt into parallel execution later?
