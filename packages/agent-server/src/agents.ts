import fs from 'node:fs';
import path from 'node:path';

import type { ScheduleConfig } from './scheduledSessions/types';
import { isValidCron5Field } from './scheduledSessions/cronUtils';

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

export interface AgentDefinition {
  agentId: string;
  displayName: string;
  description: string;
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
   * Optional scheduled sessions for this agent.
   */
  schedules?: ScheduleConfig[];
  /**
   * Optional instruction skills configuration (Pi-style SKILL.md discovery + prompt inclusion).
   */
  skills?: InstructionSkillSource[];
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

const CLAUDE_CLI_RESERVED_ARGS = [
  '--output-format',
  '--session-id',
  '--resume',
  '-p',
  '--include-partial-messages',
  '--verbose',
] as const;

const CODEX_CLI_RESERVED_ARGS = ['--json', 'resume'] as const;

const PI_CLI_RESERVED_ARGS = ['--mode', '--session', '--session-dir', '--continue', '-p'] as const;
const CODEX_REASONING_KEY = 'model_reasoning_effort';

function assertNoReservedExtraArgs(options: {
  index: number;
  provider: 'claude-cli' | 'codex-cli' | 'pi-cli';
  extraArgs?: string[];
  reservedArgs: readonly string[];
}): void {
  const { index, provider, extraArgs, reservedArgs } = options;
  if (!extraArgs || extraArgs.length === 0) {
    return;
  }

  const reservedHit = new Set<string>();
  for (const arg of extraArgs) {
    for (const reserved of reservedArgs) {
      if (arg === reserved || (reserved.startsWith('-') && arg.startsWith(`${reserved}=`))) {
        reservedHit.add(reserved);
        break;
      }
    }
  }

  if (reservedHit.size > 0) {
    const list = Array.from(reservedHit).sort().join(', ');
    throw new Error(
      `agents[${index}].chat.config.extraArgs must not include reserved ${provider} flags: ${list}`,
    );
  }
}

function hasCodexReasoningConfig(extraArgs: string[]): boolean {
  for (let i = 0; i < extraArgs.length; i += 1) {
    const arg = extraArgs[i];
    if (typeof arg !== 'string' || arg.length === 0) {
      continue;
    }
    if (arg === '--config' || arg === '-c') {
      const value = extraArgs[i + 1];
      if (typeof value === 'string' && value.includes(CODEX_REASONING_KEY)) {
        return true;
      }
      continue;
    }
    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length);
      if (value.includes(CODEX_REASONING_KEY)) {
        return true;
      }
      continue;
    }
    if (arg.startsWith('-c=')) {
      const value = arg.slice('-c='.length);
      if (value.includes(CODEX_REASONING_KEY)) {
        return true;
      }
      continue;
    }
    if (arg.startsWith('-c') && arg.length > 2) {
      const value = arg.slice(2);
      if (value.includes(CODEX_REASONING_KEY)) {
        return true;
      }
    }
  }
  return false;
}

function assertNoCodexReasoningExtraArgs(options: { index: number; extraArgs?: string[] }): void {
  const { index, extraArgs } = options;
  if (!extraArgs || extraArgs.length === 0) {
    return;
  }
  if (hasCodexReasoningConfig(extraArgs)) {
    throw new Error(
      `agents[${index}].chat.config.extraArgs must not include codex model_reasoning_effort overrides when chat.thinking is set`,
    );
  }
}

function parseChatModels(options: { index: number; modelsRaw: unknown }): string[] | undefined {
  const { index, modelsRaw } = options;
  if (modelsRaw === undefined || modelsRaw === null) {
    return undefined;
  }
  if (!Array.isArray(modelsRaw)) {
    throw new Error(
      `agents[${index}].chat.models must be an array of non-empty strings, null, or omitted`,
    );
  }
  const collected: string[] = [];
  for (let i = 0; i < modelsRaw.length; i += 1) {
    const value = modelsRaw[i];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(
        `agents[${index}].chat.models[${i}] must be a non-empty string when provided`,
      );
    }
    collected.push(value.trim());
  }
  if (collected.length === 0) {
    throw new Error(`agents[${index}].chat.models must contain at least one model when provided`);
  }
  return collected;
}

function parseChatThinking(options: { index: number; thinkingRaw: unknown }): string[] | undefined {
  const { index, thinkingRaw } = options;
  if (thinkingRaw === undefined || thinkingRaw === null) {
    return undefined;
  }
  if (!Array.isArray(thinkingRaw)) {
    throw new Error(
      `agents[${index}].chat.thinking must be an array of non-empty strings, null, or omitted`,
    );
  }
  const collected: string[] = [];
  for (let i = 0; i < thinkingRaw.length; i += 1) {
    const value = thinkingRaw[i];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(
        `agents[${index}].chat.thinking[${i}] must be a non-empty string when provided`,
      );
    }
    collected.push(value.trim());
  }
  if (collected.length === 0) {
    throw new Error(
      `agents[${index}].chat.thinking must contain at least one entry when provided`,
    );
  }
  return collected;
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

interface AgentDefinitionConfigShape {
  agentId?: unknown;
  displayName?: unknown;
  description?: unknown;
  type?: unknown;
  chat?: unknown;
  external?: unknown;
  systemPrompt?: unknown;
  toolAllowlist?: unknown;
  toolDenylist?: unknown;
  toolExposure?: unknown;
  skillAllowlist?: unknown;
  skillDenylist?: unknown;
  capabilityAllowlist?: unknown;
  capabilityDenylist?: unknown;
  agentAllowlist?: unknown;
  agentDenylist?: unknown;
  uiVisible?: unknown;
  apiExposed?: unknown;
  schedules?: unknown;
  skills?: unknown;
}

interface AgentsConfigFileShape {
  agents?: unknown;
}

function validateAgentDefinitionConfig(
  config: AgentDefinitionConfigShape,
  index: number,
): AgentDefinition {
  const rawAgentId = config.agentId;
  const rawDisplayName = config.displayName;
  const rawDescription = config.description;
  const rawType = config.type;
  const rawChat = config.chat;
  const rawExternal = config.external;
  const rawSystemPrompt = config.systemPrompt;
  const rawUiVisible = config.uiVisible;
  const rawApiExposed = config.apiExposed;
  const rawToolExposure = config.toolExposure;

  if (typeof rawAgentId !== 'string' || !rawAgentId.trim()) {
    throw new Error(`agents[${index}].agentId must be a non-empty string`);
  }
  if (typeof rawDisplayName !== 'string' || !rawDisplayName.trim()) {
    throw new Error(`agents[${index}].displayName must be a non-empty string`);
  }
  if (typeof rawDescription !== 'string' || !rawDescription.trim()) {
    throw new Error(`agents[${index}].description must be a non-empty string`);
  }
  if (rawType !== undefined && rawType !== null && rawType !== 'chat' && rawType !== 'external') {
    throw new Error(`agents[${index}].type must be "chat", "external", null, or omitted`);
  }
  if (
    rawSystemPrompt !== undefined &&
    rawSystemPrompt !== null &&
    (typeof rawSystemPrompt !== 'string' || !rawSystemPrompt.trim())
  ) {
    throw new Error(`agents[${index}].systemPrompt must be a non-empty string when provided`);
  }
  if (rawUiVisible !== undefined && rawUiVisible !== null && typeof rawUiVisible !== 'boolean') {
    throw new Error(`agents[${index}].uiVisible must be a boolean, null, or omitted`);
  }
  if (rawApiExposed !== undefined && rawApiExposed !== null && typeof rawApiExposed !== 'boolean') {
    throw new Error(`agents[${index}].apiExposed must be a boolean, null, or omitted`);
  }
  if (
    rawToolExposure !== undefined &&
    rawToolExposure !== null &&
    rawToolExposure !== 'tools' &&
    rawToolExposure !== 'skills' &&
    rawToolExposure !== 'mixed'
  ) {
    throw new Error(
      `agents[${index}].toolExposure must be "tools", "skills", "mixed", null, or omitted`,
    );
  }

  const agentId = rawAgentId.trim();
  const displayName = rawDisplayName.trim();
  const description = rawDescription.trim();
  const type = rawType === 'external' ? 'external' : 'chat';
  const systemPrompt =
    typeof rawSystemPrompt === 'string' && rawSystemPrompt.trim() ? rawSystemPrompt : undefined;
  const uiVisible = typeof rawUiVisible === 'boolean' ? rawUiVisible : undefined;
  const apiExposed = typeof rawApiExposed === 'boolean' ? rawApiExposed : undefined;
  const toolExposure =
    rawToolExposure === 'tools' || rawToolExposure === 'skills' || rawToolExposure === 'mixed'
      ? rawToolExposure
      : undefined;

  const {
    toolAllowlist,
    toolDenylist,
    skillAllowlist,
    skillDenylist,
    capabilityAllowlist,
    capabilityDenylist,
    agentAllowlist,
    agentDenylist,
  } = config;

  const parsePatternList = (raw: unknown, fieldName: string): string[] | undefined => {
    if (raw === null || raw === undefined) {
      return undefined;
    }

    if (!Array.isArray(raw)) {
      throw new Error(
        `agents[${index}].${fieldName} must be an array of strings, null, or omitted`,
      );
    }

    const patterns: string[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const value = raw[i];
      if (typeof value !== 'string' || !value.trim()) {
        throw new Error(
          `agents[${index}].${fieldName}[${i}] must be a non-empty string when provided`,
        );
      }
      patterns.push(value.trim());
    }

    return patterns.length > 0 ? patterns : undefined;
  };

  const allowlist = parsePatternList(toolAllowlist, 'toolAllowlist');
  const denylist = parsePatternList(toolDenylist, 'toolDenylist');
  const skillAllow = parsePatternList(skillAllowlist, 'skillAllowlist');
  const skillDeny = parsePatternList(skillDenylist, 'skillDenylist');
  const capabilityAllow = parsePatternList(capabilityAllowlist, 'capabilityAllowlist');
  const capabilityDeny = parsePatternList(capabilityDenylist, 'capabilityDenylist');
  const agentAllow = parsePatternList(agentAllowlist, 'agentAllowlist');
  const agentDeny = parsePatternList(agentDenylist, 'agentDenylist');

  const parseSchedules = (raw: unknown): ScheduleConfig[] | undefined => {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (!Array.isArray(raw)) {
      throw new Error(`agents[${index}].schedules must be an array when provided`);
    }
    const seenIds = new Set<string>();
    const schedules: ScheduleConfig[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const entry = raw[i];
      if (!entry || typeof entry !== 'object') {
        throw new Error(`agents[${index}].schedules[${i}] must be an object`);
      }
      const schedule = entry as {
        id?: unknown;
        cron?: unknown;
        prompt?: unknown;
        preCheck?: unknown;
        sessionTitle?: unknown;
        enabled?: unknown;
        maxConcurrent?: unknown;
      };
      const id = typeof schedule.id === 'string' ? schedule.id.trim() : '';
      if (!id) {
        throw new Error(`agents[${index}].schedules[${i}].id must be a non-empty string`);
      }
      if (seenIds.has(id)) {
        throw new Error(`Duplicate schedule id "${id}" in agents[${index}].schedules`);
      }
      seenIds.add(id);

      const cron = typeof schedule.cron === 'string' ? schedule.cron.trim() : '';
      if (!cron) {
        throw new Error(`agents[${index}].schedules[${i}].cron must be a non-empty string`);
      }
      if (!isValidCron5Field(cron)) {
        throw new Error(
          `agents[${index}].schedules[${i}].cron must be a valid 5-field cron expression`,
        );
      }

      const promptRaw = schedule.prompt;
      const prompt =
        typeof promptRaw === 'string' && promptRaw.trim().length > 0 ? promptRaw.trim() : undefined;
      if (promptRaw !== undefined && promptRaw !== null && !prompt) {
        throw new Error(`agents[${index}].schedules[${i}].prompt must be a non-empty string`);
      }

      const preCheckRaw = schedule.preCheck;
      const preCheck =
        typeof preCheckRaw === 'string' && preCheckRaw.trim().length > 0
          ? preCheckRaw.trim()
          : undefined;
      if (preCheckRaw !== undefined && preCheckRaw !== null && !preCheck) {
        throw new Error(`agents[${index}].schedules[${i}].preCheck must be a non-empty string`);
      }

      const sessionTitleRaw = schedule.sessionTitle;
      const sessionTitle =
        typeof sessionTitleRaw === 'string' && sessionTitleRaw.trim().length > 0
          ? sessionTitleRaw.trim()
          : undefined;
      if (sessionTitleRaw !== undefined && sessionTitleRaw !== null && !sessionTitle) {
        throw new Error(
          `agents[${index}].schedules[${i}].sessionTitle must be a non-empty string`,
        );
      }

      if (!prompt && !preCheck) {
        throw new Error(
          `agents[${index}].schedules[${i}] must define "prompt", "preCheck", or both`,
        );
      }

      const enabledRaw = schedule.enabled;
      if (enabledRaw !== undefined && enabledRaw !== null && typeof enabledRaw !== 'boolean') {
        throw new Error(`agents[${index}].schedules[${i}].enabled must be a boolean when provided`);
      }
      const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : true;

      const maxConcurrentRaw = schedule.maxConcurrent;
      if (
        maxConcurrentRaw !== undefined &&
        maxConcurrentRaw !== null &&
        (typeof maxConcurrentRaw !== 'number' ||
          !Number.isFinite(maxConcurrentRaw) ||
          !Number.isInteger(maxConcurrentRaw) ||
          maxConcurrentRaw < 1)
      ) {
        throw new Error(
          `agents[${index}].schedules[${i}].maxConcurrent must be an integer >= 1 when provided`,
        );
      }
      const maxConcurrent =
        typeof maxConcurrentRaw === 'number' ? maxConcurrentRaw : 1;

      schedules.push({
        id,
        cron,
        ...(prompt ? { prompt } : {}),
        ...(preCheck ? { preCheck } : {}),
        ...(sessionTitle ? { sessionTitle } : {}),
        enabled,
        maxConcurrent,
      });
    }
    return schedules.length > 0 ? schedules : undefined;
  };

  const schedules = parseSchedules(config.schedules);

  const parseInstructionSkills = (raw: unknown): InstructionSkillSource[] | undefined => {
    if (raw === undefined || raw === null) {
      return undefined;
    }
    if (!Array.isArray(raw)) {
      throw new Error(`agents[${index}].skills must be an array when provided`);
    }

    const sources: InstructionSkillSource[] = [];
    for (let i = 0; i < raw.length; i += 1) {
      const entry = raw[i];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`agents[${index}].skills[${i}] must be an object`);
      }
      const source = entry as { root?: unknown; available?: unknown; inline?: unknown };
      const root = typeof source.root === 'string' ? source.root.trim() : '';
      if (!root) {
        throw new Error(`agents[${index}].skills[${i}].root must be a non-empty string`);
      }

      const parseOptionalPatternList = (value: unknown, field: 'available' | 'inline'): string[] | undefined => {
        if (value === undefined || value === null) {
          return undefined;
        }
        if (!Array.isArray(value)) {
          throw new Error(`agents[${index}].skills[${i}].${field} must be an array of strings when provided`);
        }
        const patterns: string[] = [];
        for (let j = 0; j < value.length; j += 1) {
          const pattern = value[j];
          if (typeof pattern !== 'string' || !pattern.trim()) {
            throw new Error(
              `agents[${index}].skills[${i}].${field}[${j}] must be a non-empty string when provided`,
            );
          }
          patterns.push(pattern.trim());
        }
        return patterns.length > 0 ? patterns : undefined;
      };

      const available = parseOptionalPatternList(source.available, 'available');
      const inline = parseOptionalPatternList(source.inline, 'inline');

      sources.push({
        root,
        ...(available ? { available } : {}),
        ...(inline ? { inline } : {}),
      });
    }

    return sources.length > 0 ? sources : undefined;
  };

  const instructionSkills = parseInstructionSkills(config.skills);

  const base: AgentDefinition = {
    agentId,
    displayName,
    description,
  };

  if (type !== 'chat') {
    base.type = type;
  }

  if (rawChat !== undefined && rawChat !== null && (typeof rawChat !== 'object' || !rawChat)) {
    throw new Error(`agents[${index}].chat must be an object, null, or omitted`);
  }

  if (
    rawExternal !== undefined &&
    rawExternal !== null &&
    (typeof rawExternal !== 'object' || !rawExternal)
  ) {
    throw new Error(`agents[${index}].external must be an object, null, or omitted`);
  }

  if (type === 'external') {
    const external = rawExternal as
      | { inputUrl?: unknown; callbackBaseUrl?: unknown }
      | undefined
      | null;
    const inputUrlRaw = external?.inputUrl;
    const callbackBaseUrlRaw = external?.callbackBaseUrl;
    const inputUrl = typeof inputUrlRaw === 'string' ? inputUrlRaw.trim() : '';
    const callbackBaseUrl = typeof callbackBaseUrlRaw === 'string' ? callbackBaseUrlRaw.trim() : '';
    if (!inputUrl) {
      throw new Error(`agents[${index}].external.inputUrl must be a non-empty string`);
    }
    if (!callbackBaseUrl) {
      throw new Error(`agents[${index}].external.callbackBaseUrl must be a non-empty string`);
    }
    base.external = { inputUrl, callbackBaseUrl };
  } else if (rawExternal !== undefined && rawExternal !== null) {
    throw new Error(`agents[${index}].external is only valid when type is "external"`);
  }

  if (type === 'external') {
    if (rawChat !== undefined && rawChat !== null) {
      throw new Error(`agents[${index}].chat is only valid when type is "chat"`);
    }
  } else if (rawChat !== undefined && rawChat !== null) {
    const chat = rawChat as {
      provider?: unknown;
      config?: unknown;
      models?: unknown;
      thinking?: unknown;
    };
    const providerRaw = chat.provider;

    if (
      providerRaw !== undefined &&
      providerRaw !== null &&
      providerRaw !== 'pi' &&
      providerRaw !== 'claude-cli' &&
      providerRaw !== 'codex-cli' &&
      providerRaw !== 'pi-cli'
    ) {
      throw new Error(
        `agents[${index}].chat.provider must be "pi", "claude-cli", "codex-cli", "pi-cli", null, or omitted`,
      );
    }

    const provider =
      providerRaw === 'pi' ||
      providerRaw === 'claude-cli' ||
      providerRaw === 'codex-cli' ||
      providerRaw === 'pi-cli'
        ? (providerRaw as 'pi' | 'claude-cli' | 'codex-cli' | 'pi-cli')
        : 'pi';

    const configRaw = chat.config;
    const modelsRaw = chat.models;
    if (
      configRaw !== undefined &&
      configRaw !== null &&
      (typeof configRaw !== 'object' || !configRaw)
    ) {
      throw new Error(`agents[${index}].chat.config must be an object, null, or omitted`);
    }

    if (provider === 'pi') {
      const models = parseChatModels({ index, modelsRaw });
      const thinking = parseChatThinking({ index, thinkingRaw: chat.thinking });
      const config = configRaw as
        | {
            provider?: unknown;
            apiKey?: unknown;
            baseUrl?: unknown;
            headers?: unknown;
            timeoutMs?: unknown;
            maxTokens?: unknown;
            temperature?: unknown;
            maxToolIterations?: unknown;
          }
        | undefined
        | null;

      const providerRawConfig = config?.provider;
      const apiKeyRaw = config?.apiKey;
      const baseUrlRaw = config?.baseUrl;
      const headersRaw = config?.headers;
      const timeoutMsRaw = config?.timeoutMs;
      const maxTokensRaw = config?.maxTokens;
      const temperatureRaw = config?.temperature;
      const maxToolIterationsRaw = config?.maxToolIterations;

      const providerName =
        typeof providerRawConfig === 'string' && providerRawConfig.trim().length > 0
          ? providerRawConfig.trim()
          : undefined;
      const apiKey =
        typeof apiKeyRaw === 'string' && apiKeyRaw.trim().length > 0 ? apiKeyRaw.trim() : undefined;
      const baseUrl =
        typeof baseUrlRaw === 'string' && baseUrlRaw.trim().length > 0
          ? baseUrlRaw.trim()
          : undefined;
      const timeoutMs =
        typeof timeoutMsRaw === 'number' && Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
          ? Math.floor(timeoutMsRaw)
          : undefined;
      const maxTokens =
        typeof maxTokensRaw === 'number' && Number.isFinite(maxTokensRaw) && maxTokensRaw > 0
          ? Math.floor(maxTokensRaw)
          : undefined;
      const temperature =
        typeof temperatureRaw === 'number' && Number.isFinite(temperatureRaw)
          ? temperatureRaw
          : undefined;
      const maxToolIterations =
        typeof maxToolIterationsRaw === 'number' &&
        Number.isFinite(maxToolIterationsRaw) &&
        maxToolIterationsRaw > 0
          ? Math.floor(maxToolIterationsRaw)
          : undefined;

      let headers: Record<string, string> | undefined;
      if (headersRaw !== undefined && headersRaw !== null) {
        if (typeof headersRaw !== 'object' || Array.isArray(headersRaw)) {
          throw new Error(
            `agents[${index}].chat.config.headers must be an object with string values when provided`,
          );
        }
        headers = {};
        for (const [key, value] of Object.entries(headersRaw)) {
          if (typeof value !== 'string') {
            throw new Error(`agents[${index}].chat.config.headers["${key}"] must be a string`);
          }
          headers[key] = value;
        }
        if (Object.keys(headers).length === 0) {
          headers = undefined;
        }
      }

      if (
        providerRawConfig !== undefined &&
        providerRawConfig !== null &&
        (typeof providerRawConfig !== 'string' || !providerRawConfig.trim())
      ) {
        throw new Error(
          `agents[${index}].chat.config.provider must be a non-empty string when provided`,
        );
      }
      if (
        apiKeyRaw !== undefined &&
        apiKeyRaw !== null &&
        (typeof apiKeyRaw !== 'string' || !apiKeyRaw.trim())
      ) {
        throw new Error(
          `agents[${index}].chat.config.apiKey must be a non-empty string when provided`,
        );
      }
      if (
        baseUrlRaw !== undefined &&
        baseUrlRaw !== null &&
        (typeof baseUrlRaw !== 'string' || !baseUrlRaw.trim())
      ) {
        throw new Error(
          `agents[${index}].chat.config.baseUrl must be a non-empty string when provided`,
        );
      }
      if (
        timeoutMsRaw !== undefined &&
        timeoutMsRaw !== null &&
        (typeof timeoutMsRaw !== 'number' ||
          !Number.isFinite(timeoutMsRaw) ||
          Math.floor(timeoutMsRaw) <= 0)
      ) {
        throw new Error(
          `agents[${index}].chat.config.timeoutMs must be a positive number when provided`,
        );
      }
      if (
        maxTokensRaw !== undefined &&
        maxTokensRaw !== null &&
        (typeof maxTokensRaw !== 'number' ||
          !Number.isFinite(maxTokensRaw) ||
          Math.floor(maxTokensRaw) <= 0)
      ) {
        throw new Error(
          `agents[${index}].chat.config.maxTokens must be a positive integer when provided`,
        );
      }
      if (
        temperatureRaw !== undefined &&
        temperatureRaw !== null &&
        (typeof temperatureRaw !== 'number' || !Number.isFinite(temperatureRaw))
      ) {
        throw new Error(
          `agents[${index}].chat.config.temperature must be a finite number when provided`,
        );
      }
      if (
        maxToolIterationsRaw !== undefined &&
        maxToolIterationsRaw !== null &&
        (typeof maxToolIterationsRaw !== 'number' ||
          !Number.isFinite(maxToolIterationsRaw) ||
          Math.floor(maxToolIterationsRaw) <= 0)
      ) {
        throw new Error(
          `agents[${index}].chat.config.maxToolIterations must be a positive integer when provided`,
        );
      }

      const configHasValues =
        providerName ||
        apiKey ||
        baseUrl ||
        headers ||
        timeoutMs !== undefined ||
        maxTokens !== undefined ||
        temperature !== undefined ||
        maxToolIterations !== undefined;

      base.chat = {
        provider: 'pi',
        ...(models ? { models } : {}),
        ...(thinking ? { thinking } : {}),
        ...(configHasValues
          ? {
              config: {
                ...(providerName ? { provider: providerName } : {}),
                ...(apiKey ? { apiKey } : {}),
                ...(baseUrl ? { baseUrl } : {}),
                ...(headers ? { headers } : {}),
                ...(timeoutMs !== undefined ? { timeoutMs } : {}),
                ...(maxTokens !== undefined ? { maxTokens } : {}),
                ...(temperature !== undefined ? { temperature } : {}),
                ...(maxToolIterations !== undefined ? { maxToolIterations } : {}),
              },
            }
          : {}),
      };
    } else if (provider === 'claude-cli') {
      const models = parseChatModels({ index, modelsRaw });
      const config = configRaw as
        | {
            workdir?: unknown;
            extraArgs?: unknown;
          }
        | undefined
        | null;
      const workdirRaw = config?.workdir;
      const extraArgsRaw = config?.extraArgs;
      const workdir = typeof workdirRaw === 'string' ? workdirRaw.trim() : '';

      let extraArgs: string[] | undefined;
      if (Array.isArray(extraArgsRaw)) {
        const collected: string[] = [];
        for (let i = 0; i < extraArgsRaw.length; i += 1) {
          const value = extraArgsRaw[i];
          if (typeof value !== 'string' || !value.trim()) {
            throw new Error(
              `agents[${index}].chat.config.extraArgs[${i}] must be a non-empty string when provided`,
            );
          }
          collected.push(value.trim());
        }
        if (collected.length > 0) {
          extraArgs = collected;
        }
      } else if (extraArgsRaw !== undefined && extraArgsRaw !== null) {
        throw new Error(
          `agents[${index}].chat.config.extraArgs must be an array of strings, null, or omitted`,
        );
      }

      if (workdirRaw !== undefined && workdirRaw !== null && !workdir) {
        throw new Error(
          `agents[${index}].chat.config.workdir must be a non-empty string when provided`,
        );
      }

      if (extraArgs) {
        const reservedArgs = models
          ? [...CLAUDE_CLI_RESERVED_ARGS, '--model']
          : CLAUDE_CLI_RESERVED_ARGS;
        assertNoReservedExtraArgs({
          index,
          provider: 'claude-cli',
          extraArgs,
          reservedArgs,
        });
      }

      base.chat = {
        provider: 'claude-cli',
        ...(models ? { models } : {}),
        ...(workdir || extraArgs
          ? {
              config: {
                ...(workdir ? { workdir } : {}),
                ...(extraArgs ? { extraArgs } : {}),
              },
            }
          : {}),
      };
    } else if (provider === 'codex-cli') {
      const models = parseChatModels({ index, modelsRaw });
      const thinking = parseChatThinking({ index, thinkingRaw: chat.thinking });
      const config = configRaw as
        | {
            workdir?: unknown;
            extraArgs?: unknown;
          }
        | undefined
        | null;
      const workdirRaw = config?.workdir;
      const extraArgsRaw = config?.extraArgs;
      const workdir = typeof workdirRaw === 'string' ? workdirRaw.trim() : '';

      let extraArgs: string[] | undefined;
      if (Array.isArray(extraArgsRaw)) {
        const collected: string[] = [];
        for (let i = 0; i < extraArgsRaw.length; i += 1) {
          const value = extraArgsRaw[i];
          if (typeof value !== 'string' || !value.trim()) {
            throw new Error(
              `agents[${index}].chat.config.extraArgs[${i}] must be a non-empty string when provided`,
            );
          }
          collected.push(value.trim());
        }
        if (collected.length > 0) {
          extraArgs = collected;
        }
      } else if (extraArgsRaw !== undefined && extraArgsRaw !== null) {
        throw new Error(
          `agents[${index}].chat.config.extraArgs must be an array of strings, null, or omitted`,
        );
      }

      if (workdirRaw !== undefined && workdirRaw !== null && !workdir) {
        throw new Error(
          `agents[${index}].chat.config.workdir must be a non-empty string when provided`,
        );
      }

      if (extraArgs) {
        const reservedArgs = models
          ? [...CODEX_CLI_RESERVED_ARGS, '--model']
          : CODEX_CLI_RESERVED_ARGS;
        assertNoReservedExtraArgs({
          index,
          provider: 'codex-cli',
          extraArgs,
          reservedArgs,
        });
        if (thinking) {
          assertNoCodexReasoningExtraArgs({ index, extraArgs });
        }
      }

      base.chat = {
        provider: 'codex-cli',
        ...(models ? { models } : {}),
        ...(thinking ? { thinking } : {}),
        ...(workdir || extraArgs
          ? {
              config: {
                ...(workdir ? { workdir } : {}),
                ...(extraArgs ? { extraArgs } : {}),
              },
            }
          : {}),
      };
    } else if (provider === 'pi-cli') {
      const models = parseChatModels({ index, modelsRaw });
      const thinking = parseChatThinking({ index, thinkingRaw: chat.thinking });
      const config = configRaw as
        | {
            workdir?: unknown;
            extraArgs?: unknown;
          }
        | undefined
        | null;
      const workdirRaw = config?.workdir;
      const extraArgsRaw = config?.extraArgs;
      const workdir = typeof workdirRaw === 'string' ? workdirRaw.trim() : '';

      let extraArgs: string[] | undefined;
      if (Array.isArray(extraArgsRaw)) {
        const collected: string[] = [];
        for (let i = 0; i < extraArgsRaw.length; i += 1) {
          const value = extraArgsRaw[i];
          if (typeof value !== 'string' || !value.trim()) {
            throw new Error(
              `agents[${index}].chat.config.extraArgs[${i}] must be a non-empty string when provided`,
            );
          }
          collected.push(value.trim());
        }
        if (collected.length > 0) {
          extraArgs = collected;
        }
      } else if (extraArgsRaw !== undefined && extraArgsRaw !== null) {
        throw new Error(
          `agents[${index}].chat.config.extraArgs must be an array of strings, null, or omitted`,
        );
      }

      if (workdirRaw !== undefined && workdirRaw !== null && !workdir) {
        throw new Error(
          `agents[${index}].chat.config.workdir must be a non-empty string when provided`,
        );
      }

      if (extraArgs) {
        const reservedArgs = models || thinking
          ? [
              ...PI_CLI_RESERVED_ARGS,
              ...(models ? ['--model', '--provider'] : []),
              ...(thinking ? ['--thinking'] : []),
            ]
          : PI_CLI_RESERVED_ARGS;
        assertNoReservedExtraArgs({
          index,
          provider: 'pi-cli',
          extraArgs,
          reservedArgs,
        });
      }

      base.chat = {
        provider: 'pi-cli',
        ...(models ? { models } : {}),
        ...(thinking ? { thinking } : {}),
        ...(workdir || extraArgs
          ? {
              config: {
                ...(workdir ? { workdir } : {}),
                ...(extraArgs ? { extraArgs } : {}),
              },
            }
          : {}),
      };
    }
  }

  if (systemPrompt) {
    base.systemPrompt = systemPrompt;
  }

  const extended: AgentDefinition = { ...base };
  if (allowlist) {
    extended.toolAllowlist = allowlist;
  }
  if (denylist) {
    extended.toolDenylist = denylist;
  }
  if (toolExposure) {
    extended.toolExposure = toolExposure;
  }
  if (skillAllow) {
    extended.skillAllowlist = skillAllow;
  }
  if (skillDeny) {
    extended.skillDenylist = skillDeny;
  }
  if (capabilityAllow) {
    extended.capabilityAllowlist = capabilityAllow;
  }
  if (capabilityDeny) {
    extended.capabilityDenylist = capabilityDeny;
  }
  if (agentAllow) {
    extended.agentAllowlist = agentAllow;
  }
  if (agentDeny) {
    extended.agentDenylist = agentDeny;
  }
  if (schedules) {
    extended.schedules = schedules;
  }
  if (instructionSkills) {
    extended.skills = instructionSkills;
  }
  if (uiVisible !== undefined) {
    extended.uiVisible = uiVisible;
  }
  if (apiExposed !== undefined) {
    extended.apiExposed = apiExposed;
  }

  return extended;
}

export function loadAgentDefinitionsFromFile(configPath: string): AgentDefinition[] {
  const resolvedPath = path.resolve(configPath);

  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    const anyErr = err as NodeJS.ErrnoException;
    if (anyErr && anyErr.code === 'ENOENT') {
      console.warn(
        `Agents configuration file not found at ${resolvedPath}; starting with no configured agents.`,
      );
      return [];
    }
    throw new Error(`Failed to read agents configuration file at ${resolvedPath}: ${anyErr}`);
  }

  let parsed: AgentsConfigFileShape;
  try {
    parsed = JSON.parse(raw) as AgentsConfigFileShape;
  } catch (err) {
    throw new Error(
      `Agents configuration file at ${resolvedPath} is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Agents configuration file at ${resolvedPath} must contain a JSON object`);
  }

  const { agents } = parsed;
  if (agents === undefined) {
    return [];
  }
  if (!Array.isArray(agents)) {
    throw new Error(`"agents" in ${resolvedPath} must be an array`);
  }

  const definitions: AgentDefinition[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < agents.length; i += 1) {
    const entry = agents[i] as AgentDefinitionConfigShape;
    if (!entry || typeof entry !== 'object') {
      throw new Error(`agents[${i}] in ${resolvedPath} must be an object`);
    }

    const definition = validateAgentDefinitionConfig(entry, i);
    if (seenIds.has(definition.agentId)) {
      throw new Error(
        `Duplicate agentId "${definition.agentId}" found in agents configuration at index ${i}`,
      );
    }
    seenIds.add(definition.agentId);
    definitions.push(definition);
  }

  return definitions;
}
