export interface CliWrapperConfig {
  /**
   * Command wrapper path for running CLI tools in a container.
   */
  path: string;
  /**
   * Extra environment variables for the wrapper process.
   */
  env?: Record<string, string>;
}

export type InstructionSkillSource = {
  /**
   * Directory to recursively scan for SKILL.md files.
   */
  root: string;
  /**
   * Glob patterns over discovered skill names to include in the reference listing.
   * Defaults to ["*"] when both available and inline are omitted.
   */
  available?: string[];
  /**
   * Glob patterns over discovered skill names to include inline in the system prompt.
   * Defaults to [] when both available and inline are omitted.
   */
  inline?: string[];
};

export type ContextFileSource = {
  /**
   * Absolute root directory to search within after config loading resolves relative paths.
   */
  root: string;
  /**
   * Root-relative file paths or glob patterns to include in prompt context.
   */
  include: string[];
};

export type AgentSessionWorkingDirConfig =
  | { mode: 'none' }
  | { mode: 'fixed'; path: string }
  | { mode: 'prompt'; roots: string[] };

export interface AgentDefinition {
  agentId: string;
  displayName: string;
  description: string;
  sessionWorkingDir?: AgentSessionWorkingDirConfig;
  /**
   * Runtime type for this agent.
   * - "chat": in-process chat completions (default)
   * - "external": async external connector (inputUrl + callback endpoint)
   */
  type?: 'chat' | 'external';
  /**
   * Chat provider configuration (only valid when type is "chat" or omitted).
   * Defaults to Pi SDK chat when omitted.
   */
  chat?: {
    provider?: 'pi' | 'claude-cli' | 'codex-cli' | 'pi-cli';
    /**
     * For provider "pi" and CLI providers: list of allowed model ids.
     * The first model (when present) is used as the default for new sessions.
     */
    models?: string[];
    /**
     * For providers "pi" and "codex-cli": list of allowed thinking levels.
     * The first level (when present) is used as the default for new sessions.
     * For Codex, the level maps to model_reasoning_effort via --config.
     */
    thinking?: string[];
    config?:
      | {
          /**
           * Used for CLI providers ("claude-cli", "codex-cli", "pi-cli"): working directory.
           */
          workdir?: string;
          /**
           * Used for CLI providers ("claude-cli", "codex-cli", "pi-cli"): extra CLI args.
           */
          extraArgs?: string[];
          /**
           * Optional wrapper configuration for running the CLI in a container.
           */
          wrapper?: CliWrapperConfig;
        }
      | PiSdkChatConfig;
  };
  /**
   * External agent configuration. Required when type is "external".
   */
  external?: {
    inputUrl: string;
    callbackBaseUrl: string;
  };
  /**
   * Optional visibility flag for built-in clients (UI and agents_* tools).
   * When false, the agent is hidden from built-in discovery and delegation.
   * Defaults to true when omitted.
   */
  uiVisible?: boolean;
  /**
   * Legacy visibility flag for external API tool endpoints (currently unused).
   * Defaults to false when omitted.
   */
  apiExposed?: boolean;
  /**
   * Optional custom system prompt for this agent. If omitted, a default
   * prompt will be generated based on displayName and description.
   */
  systemPrompt?: string;
  /**
   * Optional list of glob patterns that restrict which tools
   * this agent may access. When omitted, the agent may access
   * all tools.
   */
  toolAllowlist?: string[];
  /**
   * Optional list of glob patterns that exclude tools for this agent.
   * Applied after the allowlist (if any), so denylist patterns can
   * remove tools that would otherwise be allowed.
   */
  toolDenylist?: string[];
  /**
   * Optional tool exposure mode:
   * - "tools": expose tools via model tool calls (default)
   * - "skills": expose plugin operations only via CLI skills
   * - "mixed": combine tools + skills (use skillAllowlist to choose CLI-only plugins)
   */
  toolExposure?: 'tools' | 'skills' | 'mixed';
  /**
   * Optional list of glob patterns that restrict which plugin skills
   * are exposed to this agent (matches plugin ids).
   */
  skillAllowlist?: string[];
  /**
   * Optional list of glob patterns that exclude plugin skills for this agent.
   * Applied after the allowlist (if any), so denylist patterns can
   * remove skills that would otherwise be allowed.
   */
  skillDenylist?: string[];
  /**
   * Optional list of glob patterns that restrict which tool capabilities
   * this agent may access. When omitted, the agent may access all capabilities.
   */
  capabilityAllowlist?: string[];
  /**
   * Optional list of glob patterns that exclude tool capabilities for this agent.
   * Applied after the allowlist (if any), so denylist patterns can remove
   * capabilities that would otherwise be allowed.
   */
  capabilityDenylist?: string[];
  /**
   * Optional list of glob patterns that restrict which peer agents
   * this agent may see or delegate to. When omitted, the agent may
   * see all agents.
   */
  agentAllowlist?: string[];
  /**
   * Optional list of glob patterns that exclude peer agents for this
   * agent. Applied after the allowlist (if any), so denylist patterns
   * can remove agents that would otherwise be visible.
   */
  agentDenylist?: string[];
  /**
   * Optional instruction skills configuration (Pi-style SKILL.md discovery + prompt inclusion).
   */
  skills?: InstructionSkillSource[];
  /**
   * Optional context files configuration for prompt augmentation.
   */
  contextFiles?: ContextFileSource[];
}

export interface PiSdkChatConfig {
  /**
   * Default provider to use when models omit a prefix.
   * Example: "anthropic" for "claude-sonnet-4-5".
   */
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  maxToolIterations?: number;
}

export class AgentRegistry {
  private readonly agentsById = new Map<string, AgentDefinition>();

  constructor(definitions: AgentDefinition[]) {
    for (const definition of definitions) {
      const id = definition.agentId;
      if (!id) {
        continue;
      }
      if (this.agentsById.has(id)) {
        throw new Error(`Duplicate agentId in AgentRegistry: ${id}`);
      }
      this.agentsById.set(id, { ...definition });
    }
  }

  getAgent(agentId: string): AgentDefinition | undefined {
    return this.agentsById.get(agentId);
  }

  listAgents(): AgentDefinition[] {
    return Array.from(this.agentsById.values());
  }

  hasAgent(agentId: string): boolean {
    return this.agentsById.has(agentId);
  }
}
