# Agents Design Document

> Note: Sections referencing the artifacts panel assume the panel plugin architecture (the panel is owned by the artifacts plugin, not core layout).

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Concepts](#concepts)
- [Pinned Sessions and Default Routing](#pinned-sessions-and-default-routing)
- [Session Operations](#session-operations)
- [Agent Interaction Patterns](#agent-interaction-patterns)
- [Agent Communication Flows](#agent-communication-flows)
- [Agent Tools](#agent-tools)
- [Tool Scoping](#tool-scoping)
- [Prompt Construction](#prompt-construction)
- [Agent Discovery](#agent-discovery)
- [Data Model](#data-model)
- [UI Considerations](#ui-considerations)
- [Migration Path](#migration-path)
- [Future Considerations](#future-considerations)

## Overview

This document describes the agent architecture for the AI Assistant. Agents are specialized AI personas with custom system prompts and scoped tool access. They enable domain-specific interactions while supporting both one-off tasks and long-running contextual conversations.

See `docs/design/external-agents.md` for the proposed async “external agent” runtime kind.

## Source files

- `packages/agent-server/src/agents.ts`
- `packages/agent-server/src/sessionResolution.ts`
- `packages/agent-server/src/systemPrompt.ts`
- `packages/agent-server/src/toolExposure.ts`
- `packages/agent-server/src/tools.ts`

## Concepts

### Agent

An **Agent** is a template/definition that configures how the AI behaves in a particular domain. Agents are system-defined via configuration (not user-created at runtime).

An agent has:

- **agentId**: Unique identifier (e.g., `"reading-list"`, `"todo"`, `"journal"`)
- **displayName**: Human-readable name (e.g., `"Reading List Manager"`)
- **type**: Runtime type (`"chat"` or `"external"`)
- **chat.provider**: Chat backend for `"chat"` agents (`"openai"` (default), `"openai-compatible"`, `"claude-cli"`, `"codex-cli"`, or `"pi-cli"`)
- **systemPrompt**: Custom instructions that shape the agent's behavior
- **toolAllowlist** / **toolDenylist**: Optional glob patterns to allow/deny tools (if omitted, all tools are available)
- **toolExposure**: Optional tool exposure mode (`"tools"` default, `"skills"`, or `"mixed"`)
- **skillAllowlist** / **skillDenylist**: Optional glob patterns to allow/deny plugin skills (matches plugin ids)
- **capabilityAllowlist** / **capabilityDenylist**: Optional glob patterns to allow/deny tool capabilities

### Session

A **Session** is a conversation instance associated with an agent.

A session has:

- **sessionId**: Unique identifier (UUID)
- **agentId**: Link to an agent definition
- **name**: Optional user-assigned name
- **pinned**: (Deprecated) Historical flag for UI persistence and default routing (server no longer relies on this for routing)
- **createdAt**: Timestamp
- **updatedAt**: Timestamp
- **lastSnippet**: Preview of recent content

### Relationship

```
┌─────────────────────────────────────────────────────────────┐
│                         Agents                              │
│            (Templates defined in configuration)             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ reading-list │  │     todo     │  │   journal    │      │
│  │              │  │              │  │              │      │
│  │ Tools:       │  │ Tools:       │  │ Tools:       │      │
│  │ - rl_add     │  │ - todo_*     │  │ (all)        │      │
│  │ - rl_list    │  │              │  │              │      │
│  │ - rl_search  │  │              │  │              │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                 │               │
│         ▼                 ▼                 ▼               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                     Sessions                         │   │
│  │           (Conversation instances)                   │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ • reading-list session (pinned) ← default instance  │   │
│  │ • reading-list session #2                           │   │
│  │ • todo session (not pinned) ← new each time         │   │
│  │ • journal session (pinned) ← default instance       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Pinned Sessions and Default Routing

The server previously used the **pinned** flag for both UI affordance and default routing. This has been simplified:

1. **Default Routing** now uses the **most recently updated** non-deleted session for a given agent.
2. **Pinned** is treated as a UI concern only and is no longer persisted or enforced server-side.

### Routing Behavior

When switching to an agent or delegating a task:

1. If a non-deleted session exists for that agent, the **most recently updated** one is reused.
2. If no session exists for that agent, a new session is created.

There is no explicit "touch" endpoint; `updatedAt` advances when messages arrive or metadata changes (rename/pin/attributes), and the UI can reorder accordingly.

## Session Operations

### Clear vs Delete

| Operation  | Behavior                                                   |
| ---------- | ---------------------------------------------------------- |
| **Clear**  | Wipe conversation history, retain metadata (agentId, name) |
| **Delete** | Remove session entirely                                    |

**Clear** is useful for resetting a long-running agent conversation without losing the agent/session identity.

## Agent Interaction Patterns

Users can interact with agents in three ways:

### 1. Direct Interaction

User switches to an agent's session and chats directly.

```
User: "Switch to the journal agent"
→ Switches to the journal agent's most recent session (or creates new)
→ User continues conversation in that session
```

### 2. Delegation (Ask/Tell)

User asks the current agent to delegate a task to another agent. The task executes in the background and returns a result. The user stays in their current session.

```
User (in general session): "Ask the reading-list agent to add https://example.com/article"
→ Current agent delegates to reading-list agent
→ Reading-list agent processes request using its tools
→ Result returned to current session
→ User never "sees" the reading-list session
```

Delegation characteristics:

- **Single-turn**: One request, one response
- **Blocking**: Current agent waits for result
- **Invisible**: User doesn't see the sub-agent session
- **Logged**: The interaction is recorded in the target agent's session history

### 3. Switch with Context

User switches to another agent with an initial message, optionally returning later with context.

```
User (in agent A): "Switch to agent B and discuss X"
→ Switches to agent B's session
→ "X" sent as initial message
→ Multi-turn conversation with agent B
→ User: "Go back to agent A and tell them what we decided"
→ Switches back to agent A with summary
```

## Agent Communication Flows

### Built-in Agent → Built-in Agent

A built-in agent (e.g., `general`) delegates to another built-in agent (e.g., `notes`).

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ assistant  │     │ assistant  │     │ assistant  │
│ Agent: general│     │ Server        │     │ Agent: notes  │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        │  agents_      │                     │
        │  message            │                     │
        │  { agentId: "notes",│                     │
        │    content: "...",  │                     │
        │    mode: "sync" }   │                     │
        │────────────────────>│                     │
        │                     │                     │
        │                     │  processUserMessage │
        │                     │  (internal call,    │
        │                     │   same server)      │
        │                     │────────────────────>│
        │                     │                     │
        │                     │   (notes agent      │
        │                     │    runs, calls      │
        │                     │    tools...)        │
        │                     │                     │
        │                     │  Response           │
        │                     │<────────────────────│
        │                     │                     │
        │  { status: "complete",                    │
        │    response: "...", │                     │
        │    toolCallCount: 1 }                     │
        │<────────────────────│                     │
        │                     │                     │
```

### Built-in Agent → CLI Agent (Claude/Codex/Pi)

A built-in agent delegates to a CLI-based agent like `claude-cli`, `codex-cli`, or `pi-cli`.

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ assistant  │     │ assistant  │     │ Claude CLI    │
│ Agent: general│     │ Server        │     │ (spawned)     │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        │  agents_      │                     │
        │  message            │                     │
        │  { agentId:         │                     │
        │    "claude-cli",    │                     │
        │    content: "...",  │                     │
        │    mode: "sync" }   │                     │
        │────────────────────>│                     │
        │                     │                     │
        │                     │  spawn claude CLI   │
        │                     │  process            │
        │                     │────────────────────>│
        │                     │                     │
        │                     │   (claude runs,     │
        │                     │    reads files,     │
        │                     │    runs bash...)    │
        │                     │                     │
        │                     │  stdout/completion  │
        │                     │<────────────────────│
        │                     │                     │
        │  { status: "complete",                    │
        │    response: "...", │                     │
        │    toolCallCount: 5 }                     │
        │<────────────────────│                     │
        │                     │                     │
```

### Async Mode (Fire-and-Forget)

When using `mode: "async"`, the calling agent doesn't wait for a response.

```
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ assistant  │     │ assistant  │     │ Target Agent  │
│ Agent: general│     │ Server        │     │               │
└───────┬───────┘     └───────┬───────┘     └───────┬───────┘
        │                     │                     │
        │  agents_      │                     │
        │  message            │                     │
        │  { agentId: "...",  │                     │
        │    content: "...",  │                     │
        │    mode: "async" }  │                     │
        │────────────────────>│                     │
        │                     │                     │
        │  { status: "started",                     │
        │    responseId: "..." }                    │
        │<────────────────────│                     │
        │                     │                     │
        │  (general continues │  (target agent      │
        │   its response)     │   runs in           │
        │                     │   background)       │
        │                     │────────────────────>│
        │                     │                     │
        │                     │   (processing...)   │
        │                     │                     │
        │                     │  Response stored    │
        │                     │  in target session  │
        │                     │<────────────────────│
        │                     │                     │
```

## Agent Tools

Two built-in tools enable agent interactions:

### agents_message

Send a message to another agent using the full chat pipeline (system prompt, tools, and session history). Supports both sync and async modes.

```typescript
agents_message({
  agentId: string;                // Target agent
  content: string;                // Message content to send as a user message
  session?: 'latest' | 'create' | 'latest-or-create' | string; // Session resolution strategy (default 'latest-or-create')
  mode?: 'sync' | 'async';        // 'sync' waits for response; 'async' starts run and returns immediately (default 'sync')
  timeout?: number;               // Optional timeout in seconds for sync mode (default 300)
})
// Sync mode returns:
// {
//   mode: 'sync',
//   status: 'complete' | 'timeout',
//   agentId: string,
//   sessionId: string,
//   sessionName: string,
//   created: boolean,
//   responseId?: string,
//   response?: string,
//   truncated?: boolean,
//   durationMs?: number,
//   toolCallCount?: number,
//   toolCalls?: Array<{ name: string; durationMs: number }>,
//   thinkingText?: string,
//   timeoutSeconds?: number,
//   message?: string; // for timeout
// }
//
// Async mode returns:
// {
//   mode: 'async',
//   status: 'started',
//   agentId: string,
//   sessionId: string,
//   sessionName: string,
//   created: boolean,
//   responseId: string
// }
```

**Behavior:**

1. Resolve the target session using the requested `session` strategy:
   - `latest`: use the most recently updated non-deleted session for the agent (error if none exist)
   - `create`: always create a new session for the agent
   - `latest-or-create` (default): reuse the most recent session, or create one if none exist
   - any other non-empty string: treated as an explicit session id (must exist and belong to the agent)
2. Ensure the target agent is visible and allowed from the current agent session (respecting `agentAllowlist`/`agentDenylist` and `uiVisible`).
3. Inject `content` as a user message into the resolved session.
4. Run the target agent via `processUserMessage` with full tool call support, using the target agent's tool allowlist/denylist.
5. In **sync** mode:
   - Wait for the chat run to complete or until `timeout` seconds elapse.
   - Return the response metadata and text as described above.
   - A timeout does **not** cancel the underlying run; it continues in the background in the target session.
6. In **async** mode:
   - Schedule the chat run and return immediately with `status: "started"` and a `responseId`.
   - The target session (and any connected clients) receive the normal streaming messages.

**Use cases:**

- "Ask the todo agent to add 'buy milk'" → sync mode to summarize the result.
- "Tell the reading-list agent to summarize my queue" → sync mode to get the summary back.
- "Kick off a long-running analysis in the code-review agent" → async mode.

## Tool Scoping

Tool access is enforced server-side based on agent configuration.

### Configuration

```typescript
interface AgentDefinition {
  agentId: string;
  displayName: string;
  description: string;
  systemPrompt?: string;
  toolAllowlist?: string[]; // Glob patterns, e.g., ["reading_list_*", "web_fetch"]
  toolDenylist?: string[]; // Applied after allowlist
  toolExposure?: 'tools' | 'skills' | 'mixed';
  skillAllowlist?: string[]; // Glob patterns matching plugin ids
  skillDenylist?: string[]; // Applied after allowlist
  capabilityAllowlist?: string[]; // Glob patterns for tool capabilities (e.g., ["lists.*"])
  capabilityDenylist?: string[]; // Applied after allowlist
  agentAllowlist?: string[]; // Glob patterns for visible/delegatable agents
  agentDenylist?: string[]; // Applied after allowlist
  uiVisible?: boolean; // When false, hidden from built-in clients (default true)
  apiExposed?: boolean; // Legacy HTTP tools exposure flag (currently unused)
}
```

### Enforcement

When processing a tool call for a session:

```typescript
function getEffectiveTools(session: Session, allTools: Tool[]): Tool[] {
  const agent = getAgentDefinition(session.agentId);
  if (
    !agent.toolAllowlist &&
    !agent.toolDenylist &&
    !agent.capabilityAllowlist &&
    !agent.capabilityDenylist
  ) {
    return allTools; // No scoping = all tools
  }

  return allTools.filter(
    (tool) =>
      tool.name.startsWith('system_') ||
      ((!agent.toolAllowlist ||
        agent.toolAllowlist.some((pattern) => matchGlob(pattern, tool.name))) &&
        (!agent.toolDenylist ||
          !agent.toolDenylist.some((pattern) => matchGlob(pattern, tool.name))) &&
        (!tool.capabilities ||
          tool.capabilities.length === 0 ||
          ((!agent.capabilityAllowlist ||
            tool.capabilities.every((capability) =>
              agent.capabilityAllowlist.some((pattern) => matchGlob(pattern, capability)),
            )) &&
            (!agent.capabilityDenylist ||
              !tool.capabilities.some((capability) =>
                agent.capabilityDenylist.some((pattern) => matchGlob(pattern, capability)),
              )))))),
  );
}
```

**Security**: This is a security boundary, not just a UI feature. Tool calls are validated against the agent's allowlist before execution.

### Built-in Tools

The `agents_*` tools are provided by the agents plugin. They follow the same allowlist/capability
rules as other tools and can be disabled via plugin config.

## Prompt Construction

The server constructs a full system prompt for every chat run. This prompt combines:

- A **base system prompt** (global or agent-specific instructions)
- A list of **available tools**
- Optional **CLI skills** (when `toolExposure` enables skills)
- Optional **artifacts sections** (available artifact items, message context instructions, artifacts panel state)
- Optional **agent discovery** section (other agents you can delegate to or switch to)

### Base System Prompt

When a chat run starts, the server chooses the base prompt:

- If the session has an `agentId` and that agent has a non-empty `systemPrompt`, that text is used as the base.
- Otherwise, if the session has an `agentId`, the base prompt is generated from the agent definition:
  - `"You are ${agent.displayName}. ${agent.description}"`
- If there is no `agentId`, a default global system prompt is used.

All other sections described below are appended after this base prompt.

### Tool and Artifacts Sections

If tools are available for the run, the server appends:

- **Available tools**: A list of non-`system_` tools with name and short description.
- **Available CLI skills**: When `toolExposure` is `"skills"` or `"mixed"`, the prompt lists the
  plugin skills that should be used via `bash` (each entry includes a SKILL.md path and CLI path).
- **Available artifact items**: When artifacts tools (lists/notes/views) are present and a list of items is provided, the server groups them by type and lists each item by name and id.

These sections are informational only; tool scoping is enforced separately as described above.

### Message Context Section

When artifacts tools are available, the system prompt also includes a **Message Context** section that describes the XML context line the client prepends to each user message:

- Format: `<context panel-id="<panel-id>" panel-type="<panel-type>" panel-title="<panel-title>" type="<type>" id="<id>" name="<name>" selection="<item-ids>" mode="<mode>" />` or, when viewing a View, `<context panel-id="<panel-id>" panel-type="<panel-type>" panel-title="<panel-title>" view-name="<view-name>" view-query="<view-query>" selection="<item-ids>" mode="<mode>" />`
- Semantics:
  - `panel-id` / `panel-type` / `panel-title` describe the currently selected panel in the UI.
  - `type` / `id` / `name` describe the active artifact item, if any (when not in View mode).
  - `view-name` / `view-query` describe the active View when the artifacts panel is in View mode.
  - `selection` is a comma-separated list of selected item IDs, if any.
  - `mode` communicates response style hints (for example `brief` for concise outputs).
  - If no item or view is active, only the panel attributes are present.

Important design points:

- The **client** is responsible for building and prepending this context line on every user message, typically via the artifacts panel's context provider. The server does not synthesize or rewrite it.
- The same context line is stored in the transcript, so replayed conversations reuse identical user messages (good for prompt caching).
- Selection data comes directly from the UI (e.g., selected list items), which would otherwise require extra server state.

The UI behavior and exact parsing rules for this context line are documented in `docs/UI_SPEC.md` under **Message Context**.

### Artifacts Panels Section

When artifacts tools are available, the system prompt may include an **Artifacts Panels** section listing the open artifacts panels:

- Each entry shows the panel id and (when available) the active artifact summary (type/id/name).
- The data comes from the panel inventory snapshot pushed by the client (`panel_event` payload `panel_inventory`) and uses per-panel context emitted by the artifacts panel.
- If no UI is connected (headless agents), the agent can call `panels_list` / `panels_selected` with `includeContext: true` to locate the target panel.

### Available Agents Section

After the artifacts sections, the system prompt may include an **Available agents** section:

- Lists other agents that are visible and allowed from the current agent (respecting `agentAllowlist`/`agentDenylist`).
- Explains how to use `agents_message` to collaborate with these agents.

This section is purely instructional and is regenerated for each chat run based on the current agent registry and visibility rules.

## Agent Discovery

Agents inject their available peers into the system prompt:

```
You are the Reading List Manager agent.

Available agents you can delegate to:
- todo: Todo List Manager - manages tasks and reminders
- journal: Personal Journal - for reflections and notes
- code-reviewer: Code Reviewer - analyzes code snippets

Use agents_message to ask another agent to perform a task.
```

## Data Model

### Agent Definition (Configuration)

```typescript
interface AgentDefinition {
  agentId: string;
  displayName: string;
  description: string;
  systemPrompt?: string;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  toolExposure?: 'tools' | 'skills' | 'mixed';
  skillAllowlist?: string[];
  skillDenylist?: string[];
  capabilityAllowlist?: string[];
  capabilityDenylist?: string[];
  agentAllowlist?: string[];
  agentDenylist?: string[];
  uiVisible?: boolean; // When false, hidden from built-in clients (default true)
  apiExposed?: boolean; // Legacy HTTP tools exposure flag (currently unused)
  // Future extensions:
  // model?: string;
  // temperature?: number;
  // maxTokens?: number;
}
```

### Session Summary (Database)

```typescript
interface SessionSummary {
  sessionId: string;
  agentId: string;
  name?: string; // user-assigned name
  // pinned?: boolean;      // deprecated - server no longer uses this for routing
  /**
   * When set, indicates that the session is pinned in the UI.
   * The value is the timestamp when the session was pinned and
   * is used for ordering pinned sessions (most recently pinned first).
   */
  pinnedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastSnippet?: string;
  attributes?: Record<string, unknown>; // optional session-scoped attributes for plugins/panels
}
```

### Configuration File

```json
{
  "agents": [
    {
      "agentId": "reading-list",
      "displayName": "Reading List Manager",
      "systemPrompt": "You are a reading list manager. Help the user track articles, papers, and links they want to read. You can add items, list the queue, search for items, and mark items as read.",
      "toolAllowlist": ["reading_list_*"],
      "toolDenylist": ["reading_list_delete"],
      "toolExposure": "mixed",
      "skillAllowlist": ["notes"],
      "capabilityAllowlist": ["lists.*"],
      "capabilityDenylist": ["lists.write"],
      "agentAllowlist": ["todo", "journal"],
      "uiVisible": true,
      "apiExposed": false
    },
    {
      "agentId": "todo",
      "displayName": "Todo Manager",
      "systemPrompt": "You are a todo list manager. Help the user track tasks, set reminders, and stay organized.",
      "toolAllowlist": ["todo_*"],
      "uiVisible": true
    },
    {
      "agentId": "journal",
      "displayName": "Personal Journal",
      "systemPrompt": "You are a personal journal assistant. Help the user reflect on their day, capture thoughts, and review past entries.",
      "toolAllowlist": ["journal_*"],
      "uiVisible": true
    },
    {
      "agentId": "general",
      "displayName": "General Assistant",
      "systemPrompt": "You are a helpful general assistant.",
      "toolAllowlist": null,
      "uiVisible": true
    }
  ]
}
```

## UI Considerations

### Session List

- Group or tag sessions by agent
- Show agent icon/color for quick identification
- Optionally highlight or pin sessions in the UI (client-side concern)

### Session Actions

- **Clear**: Wipe history, keep metadata
- **Delete**: Remove session
- **Rename**: Set custom name

### Agent Switching

- Agent selector/switcher in UI
- "New session" option per agent (creates unpinned session)
- Visual indicator of current agent

## Migration Path

### From Current State

1. Require `agentId` for all sessions
2. Existing pinned sessions remain pinned (UI affordance preserved)
3. Add agent configuration
4. Implement tool scoping
5. Add new agent tools (`agents_message`)
6. Update/replace session tools

## Future Considerations

### Not in Scope for V1

- **User-defined agents**: Agents are system-configured only
- **Agent versioning**: Config changes apply immediately to all sessions
- **Delegation chaining**: Agent A delegates to B, B delegates to C (limit to 1 level)
- **Parallel delegation**: Delegate to multiple agents simultaneously
- **Agent permissions**: All agents accessible to all sessions

### Potential V2 Features

- User-created agents via API/UI
- Agent templates (inherit from base agent)
- Delegation depth limits and cycle detection
- Agent-to-agent permissions
- Async/non-blocking delegation
- Agent memory/knowledge bases
