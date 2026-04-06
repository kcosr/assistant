# Agent Configuration Rework

## Motivation

The current agent configuration is a flat array of standalone `AgentDefinition` objects in `config.json`. Each agent independently declares everything: chat provider, wrapper config, system prompt, tool/skill/capability scoping, context files, instruction skills, and session working dir. There is no inheritance, composition, or sharing mechanism.

**Problems:**

1. **Duplication** -- Multiple CLI agents repeat identical wrapper config, skills, and scoping. Any shared concern must be copied verbatim to each agent.
2. **Static file resources** -- Skills and context files are cached in module-level `Map`s at startup (`rootCache`, `sourceDiscoveryCache`, `contextPromptCache`) with no invalidation. Adding/editing a SKILL.md or context file requires a server restart.
3. **No composition** -- Creating a variant agent (e.g., "like claude-cli but read-only") requires duplicating the entire definition and modifying it.

## Design Overview

Two changes:

1. **Templates with `extends`** -- Named, reusable partial agent configurations. Agents and templates can extend one or more templates. Deep merge, last writer wins.
2. **Drop file resource caches** -- Skills and context files are read from disk on every access. No caches, no invalidation logic, always fresh.

## Templates

### Concept

A **template** is a named partial agent configuration. It can contain any agent field except identity (`agentId`, `displayName`, `description`). Templates can extend other templates via `extends`.

Templates live in a new top-level `templates` object in `config.json`, keyed by name.

### Config Structure

```jsonc
{
  "templates": {
    "containerized": {
      "chat": {
        "config": {
          "wrapper": {
            "path": "/home/kevin/devtools/container/run.sh",
            "env": { "PERSISTENT": "1", "PROXY": "1", "CONTAINER_NAME": "assistant" }
          }
        }
      }
    },
    "coding": {
      "extends": "containerized",
      "sessionWorkingDir": { "mode": "prompt", "roots": ["/home/kevin/worktrees"] },
      "skills": [
        { "root": "./dist/skills", "available": ["*"], "inline": [] }
      ],
      "contextFiles": [
        { "root": "./context/coding", "include": ["*.md"] }
      ]
    },
    "read-only": {
      "toolDenylist": ["*_write", "*_delete", "*_create", "*_update"]
    }
  },
  "agents": [
    {
      "agentId": "claude-cli",
      "extends": "coding",
      "displayName": "Claude Code",
      "description": "Claude Code CLI agent.",
      "chat": {
        "provider": "claude-cli",
        "models": ["opus", "sonnet", "haiku"],
        "thinking": ["none", "low", "medium", "high", "xhigh"]
      }
    },
    {
      "agentId": "codex-cli",
      "extends": "coding",
      "displayName": "Codex",
      "description": "OpenAI Codex CLI agent.",
      "chat": {
        "provider": "codex-cli",
        "models": ["gpt-5.2-codex", "gpt-5.2"],
        "thinking": ["off", "low", "medium", "high", "xhigh"]
      }
    },
    {
      "agentId": "reviewer",
      "extends": ["coding", "read-only"],
      "displayName": "Code Reviewer",
      "description": "Read-only code review agent.",
      "chat": {
        "provider": "claude-cli",
        "models": ["sonnet"]
      }
    },
    {
      "agentId": "lists",
      "displayName": "Lists Manager",
      "description": "Manages your personal lists.",
      "systemPrompt": "You are a lists manager...",
      "toolAllowlist": ["lists_*", "url_fetch_fetch"]
    }
  ]
}
```

### `extends` Semantics

- **On agents:** `extends` accepts a string (single template) or array of strings (multiple templates).
- **On templates:** Same -- a template can extend one or more other templates.
- **Resolution order:** When `extends` is an array, templates are applied left-to-right. Each is deep-merged onto the accumulator. The agent's own inline fields are merged last (highest priority).
- **Cycle detection:** Template chains are resolved at config load time. Circular references are detected and rejected with an error.

### Inheritable Fields

All `AgentDefinition` fields are inheritable **except** identity fields that must always be declared on the concrete agent:

| Field | Inheritable | Notes |
|-------|-------------|-------|
| `agentId` | No | Required on agent, not allowed on templates |
| `displayName` | No | Required on agent, not allowed on templates |
| `description` | No | Required on agent, not allowed on templates |
| `type` | Yes | `'chat'` or `'external'` |
| `chat` | Yes | Deep-merged (provider, models, thinking, config all merge normally) |
| `external` | Yes | Deep-merged |
| `systemPrompt` | Yes | Replaced (scalar) |
| `sessionWorkingDir` | Yes | Replaced (treated as atomic value) |
| `toolAllowlist` | Yes | Replaced (array) |
| `toolDenylist` | Yes | Replaced (array) |
| `toolExposure` | Yes | Replaced (scalar) |
| `skillAllowlist` | Yes | Replaced (array) |
| `skillDenylist` | Yes | Replaced (array) |
| `capabilityAllowlist` | Yes | Replaced (array) |
| `capabilityDenylist` | Yes | Replaced (array) |
| `agentAllowlist` | Yes | Replaced (array) |
| `agentDenylist` | Yes | Replaced (array) |
| `skills` | Yes | Replaced (array of objects) |
| `contextFiles` | Yes | Replaced (array of objects) |
| `uiVisible` | Yes | Replaced (boolean) |
| `apiExposed` | Yes | Replaced (boolean) |

### Merge Rules

| Type | Rule |
|------|------|
| Scalar (string, number, boolean) | Last writer wins |
| Object | Deep merge (recurse into keys) |
| Array | Replace entirely (last writer wins) |
| Explicit `null` | Clears the inherited value (field removed from result) |

**`chat.config` cross-provider inheritance:**

`chat.config` is provider-specific -- CLI providers use `{workdir, extraArgs, wrapper}` while the Pi SDK uses `{provider, apiKey, baseUrl, ...}`. `chat.config` is deep-merged like everything else, which works well when the provider stays the same (e.g., overriding just `workdir` while inheriting `wrapper`). When an agent switches providers, inherited keys from the wrong provider may be present after merge. Post-merge validation (existing provider-specific schema checks in `config.ts`) catches these invalid combinations with a clear error. The agent can use `"config": null` to clear inherited config before providing new provider-specific values.

**Example of `null` clearing:**

```jsonc
{
  "templates": {
    "base": {
      "systemPrompt": "You are a helpful assistant.",
      "toolDenylist": ["dangerous_*"]
    }
  },
  "agents": [
    {
      "agentId": "unrestricted",
      "extends": "base",
      "displayName": "Unrestricted",
      "description": "No restrictions.",
      "toolDenylist": null
    }
  ]
}
```

Result: `toolDenylist` is removed; `systemPrompt` is inherited.

### Resolution Algorithm

```
resolveAgent(agentConfig, templateMap):
  1. Collect the extends chain:
     - If agentConfig.extends is a string, wrap in array
     - For each template name, recursively resolve its own extends chain (depth-first)
     - Detect cycles; throw if found
     - Result: ordered list of template fragments, root-first

  2. Merge:
     base = {}
     for fragment in resolvedTemplateChain:
       base = deepMerge(base, fragment)
     result = deepMerge(base, agentConfig)

  3. Strip meta-fields: delete result.extends

  4. Validate: ensure agentId, displayName, description are present

  5. Return result as AgentDefinition
```

### TypeScript Types

```typescript
/**
 * Partial agent config -- used for templates and the inheritable portion of agents.
 * All fields optional. Identity fields (agentId, displayName, description) excluded.
 */
interface AgentConfigFragment {
  extends?: string | string[];
  type?: 'chat' | 'external';
  chat?: {
    provider?: 'pi' | 'claude-cli' | 'codex-cli' | 'pi-cli';
    models?: string[];
    thinking?: string[];
    config?: CliChatConfig | PiSdkChatConfig;
  };
  external?: { inputUrl: string; callbackBaseUrl: string };
  systemPrompt?: string | null;
  sessionWorkingDir?: AgentSessionWorkingDirConfig | null;
  toolAllowlist?: string[] | null;
  toolDenylist?: string[] | null;
  toolExposure?: 'tools' | 'skills' | 'mixed' | null;
  skillAllowlist?: string[] | null;
  skillDenylist?: string[] | null;
  capabilityAllowlist?: string[] | null;
  capabilityDenylist?: string[] | null;
  agentAllowlist?: string[] | null;
  agentDenylist?: string[] | null;
  skills?: InstructionSkillSource[] | null;
  contextFiles?: ContextFileSource[] | null;
  uiVisible?: boolean | null;
  apiExposed?: boolean | null;
}

/**
 * Concrete agent definition in config. Extends AgentConfigFragment
 * with required identity fields.
 */
interface AgentConfig extends AgentConfigFragment {
  agentId: string;
  displayName: string;
  description: string;
}

/**
 * Top-level config structure.
 */
interface AppConfig {
  templates?: Record<string, AgentConfigFragment>;
  agents: AgentConfig[];
  profiles: ProfileConfig[];
  plugins: Record<string, PluginConfig>;
  mcpServers: McpServerConfig[];
  sessions?: SessionsConfig;
  attachments?: AttachmentsConfig;
}
```

### Zod Schema: Two-Phase Parsing

The current Zod schemas for agent fields (e.g., `ContextFilesConfigSchema`, `InstructionSkillsConfigSchema`) transform `null` to `undefined` during parsing. This would destroy `null` values before template merge logic can use them for clearing.

**Solution:** Use a two-phase schema approach:

1. **Raw fragment schema** -- Parses templates and agent configs with `null` preserved (no `.nullable().transform(...)` collapsing). Minimal validation -- just structural checks.
2. **Template resolution** -- Operates on raw fragments. `null` values clear inherited fields during deep merge.
3. **Final agent schema** -- After resolution, each fully-merged agent is validated through the existing strict schemas (which collapse null to undefined, enforce required fields, validate provider-specific config, etc.).

This keeps the existing validation logic intact while allowing `null` to flow through the merge step.

### Skills Root Normalization

Currently, context file roots are normalized relative to the config file directory in `loadConfig()` (via `normalizeContextFileSourcesForConfigDir()`), but skills roots are resolved relative to `process.cwd()` in `instructionSkills.ts`. This means `"root": "./dist/skills"` resolves differently depending on where the server is started.

**Fix:** Add equivalent config-dir normalization for skills roots in `loadConfig()`, matching what context files already do. This should happen after template resolution (so inherited skills roots are also normalized) but before the resolved agents are handed to `AgentRegistry`. The `discoverRootSkills()` function in `instructionSkills.ts` should then expect absolute paths only.

### Resolved Output

After template resolution, every agent is a fully resolved `AgentDefinition` (same type as today). The `AgentRegistry` receives resolved definitions -- it does not need to know about templates. Template resolution happens entirely within `config.ts` at load time.

## Dynamic File Resource Reload

### Problem

Three module-level caches hold file-based resources from startup:

- `instructionSkills.ts` -- `rootCache: Map<string, RootDiscoveryResult>` (line 33)
- `contextFiles.ts` -- `sourceDiscoveryCache: Map<string, SourceDiscovery>` (line 26)
- `contextFiles.ts` -- `contextPromptCache: Map<string, string>` (line 27)

These are populated by `preloadInstructionSkillsForAgents()` and `preloadContextFilesForAgents()` at startup and never invalidated. Changing a SKILL.md file or context file requires a server restart.

### Solution

**Remove the caches entirely.** Read from disk on every access.

These are small operations -- a handful of directory walks and file reads for SKILL.md files and context markdown. The cost is negligible compared to the LLM API call that follows every system prompt build.

### Changes

1. **`instructionSkills.ts`**: Delete `rootCache` Map. Make `discoverRootSkills()` always walk the directory and parse files.
2. **`contextFiles.ts`**: Delete `sourceDiscoveryCache` and `contextPromptCache` Maps. Make `collectFilesForSource()` and `resolveContextPrompt()` always read from disk.
3. **`index.ts`**: Remove calls to `preloadInstructionSkillsForAgents()` and `preloadContextFilesForAgents()`.

### Benefits

- Skills dropdown (`listInstructionSkills()` -> `resolveSessionConfigCapabilities()`) always reflects current SKILL.md files on disk.
- System prompt (`buildSystemPrompt()` -> `buildInstructionSkillsPrompt()` / `buildContextFilesPrompt()`) always includes current file content.
- Zero new infrastructure -- no file watchers, no invalidation logic, no TTL.
- Adding, editing, or removing SKILL.md and context files takes effect on the next chat turn or skill list request with no restart.

### Failure Behavior Tradeoff

Removing caches changes failure semantics. Today, preloaded resources survive later filesystem issues (file deletion, permission changes, transient I/O errors). Without caches, a missing or unreadable file will fail the system prompt build or capability listing on the next access.

**This is intentional.** Freshness is more important than resilience to filesystem issues that shouldn't happen in normal operation. If a SKILL.md or context file is deleted, the system should reflect that immediately rather than silently serving stale content. Errors from `buildContextFilesPrompt()` and `buildInstructionSkillsPrompt()` should be caught at the call site and logged, with the affected section omitted from the prompt rather than crashing the chat turn.

### Future Optimization

If profiling ever shows disk reads are a bottleneck (unlikely given the small number of files involved), a simple TTL cache (e.g., 30 seconds) can be added as a wrapper around the read functions. This is a one-line change and does not affect the design.

## Session Config

### Current State

`SessionConfig` supports these override fields, validated against the agent's capabilities:

```typescript
interface SessionConfig {
  model?: string;
  thinking?: string;
  workingDir?: string;
  skills?: string[];
  sessionTitle?: string;
}
```

Used by three entry points:
- **UI** -- user creates a session via the `sessions` plugin
- **Scheduled sessions** -- `sessionConfig` on a schedule definition
- **Agent messaging** -- `agents_message` tool (currently does not accept `sessionConfig`; to be added)

### No Changes for Now

Session config stays as-is. The current fields are sufficient and the interface is additive -- new fields (e.g., `extends`, `contextFiles`, `systemPromptAppend`, scoping adjustments) can be added later without breaking changes.

### `sessionConfig` and Session Resolution Strategies

When `sessionConfig` is provided to `agents_message`:

- **`create`**: Config is always applied to the new session.
- **`latest-or-create`**: Config is applied only when a new session is created. If an existing session is found, `sessionConfig` is silently ignored (applying config overrides mid-conversation would be surprising). Callers that need specific config should use `"create"`.
- **`latest`** / explicit session ID: Config is ignored (no session creation occurs).

## Migration

No backwards compatibility is needed. However, the existing flat agent array format still works -- agents without `extends` resolve identically to today. The `templates` section is optional. Adoption is incremental:

1. Add `templates` section to config
2. Extract shared config from agents into templates
3. Add `extends` to agents that should inherit

A migration script can analyze the current config, detect duplicated fragments across agents, and suggest templates to extract.

## Implementation Plan

### Phase 1: Template Resolution

**Files to change:**

- `packages/agent-server/src/config.ts` -- Add `TemplatesConfigSchema` (Zod). Add template resolution logic in `loadConfig()`. Resolve all agents to flat `AgentDefinition` before creating `AgentRegistry`.
- `packages/agent-server/src/agents.ts` -- Add `AgentConfigFragment` type. `AgentDefinition` stays unchanged (it's the resolved output). **Remove `loadAgentDefinitionsFromFile()`** -- this is a second agent config loader with its own validation (line 1218-1277) that would diverge from template-aware loading. All agent loading must go through `loadConfig()` in `config.ts`.

**New functions:**

- `resolveTemplateChain(templateName, templateMap, visited)` -- Recursive depth-first resolution with cycle detection. Returns ordered list of fragments.
- `deepMergeFragments(base, override)` -- Deep merge with null-clearing semantics for objects and replace semantics for arrays.
- `resolveAgentConfig(agentConfig, templateMap)` -- Applies template chain + inline overrides, returns resolved `AgentDefinition`.

**Validation:**

- Template names must be unique
- Template `extends` references must exist
- Circular `extends` chains rejected
- Templates must not contain `agentId`, `displayName`, or `description`
- After resolution, every agent must have `agentId`, `displayName`, `description`
- Cycle detection and missing-reference validation should run early in `loadConfig()` (or via Zod `.superRefine()` on `AppConfigSchema`) so bad config fails fast at startup before any agents are resolved
- Skills roots must be normalized relative to config directory (matching context files), after template resolution

### Phase 2: Drop File Resource Caches

**Files to change:**

- `packages/agent-server/src/instructionSkills.ts` -- Remove `rootCache`. Remove `preloadInstructionSkillsForAgents()` export (or make it a no-op).
- `packages/agent-server/src/contextFiles.ts` -- Remove `sourceDiscoveryCache` and `contextPromptCache`. Remove `preloadContextFilesForAgents()` export (or make it a no-op).
- `packages/agent-server/src/index.ts` -- Remove preload calls.

### Phase 3: Add `sessionConfig` to `agents_message`

**Files to change:**

- `packages/plugins/core/agents/manifest.json` -- Add `sessionConfig` to the `message` operation schema.
- `packages/agent-server/src/builtInTools.ts` -- Parse and pass `sessionConfig` in `handleAgentMessage()`.
- `packages/agent-server/src/sessionResolution.ts` -- Accept `sessionConfig` in `resolveAgentSession()`, apply it when creating new sessions (same flow as scheduled sessions).

### Phase 4: Migrate Real Config

**File:** `~/.assistant/data/agents.json` (production config)

- Review the current agent definitions for duplication patterns
- Extract shared config into templates
- Update agents to use `extends`
- Validate the migrated config produces identical resolved agents

### Testing

- Unit tests for `resolveTemplateChain()` -- single extends, multi-extends, diamond, cycle detection, null clearing.
- Unit tests for `deepMergeFragments()` -- scalar replace, object merge, array replace, null clear.
- Integration test: load a config with templates, verify resolved agents match expected output.
- Verify existing `instructionSkills.test.ts` and `contextFiles.test.ts` still pass after cache removal.
- Verify `config.test.ts` still passes, add template-specific test cases.
