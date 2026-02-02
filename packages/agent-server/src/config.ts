import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';
import type { AgentDefinition } from './agents';
import { isValidCron5Field } from './scheduledSessions/cronUtils';

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);

const GlobPatternListSchema = z
  .array(NonEmptyTrimmedStringSchema)
  .optional()
  .nullable()
  .transform((value) => {
    if (!value || value.length === 0) {
      return undefined;
    }
    return value;
  });

const ExtraArgsSchema = z
  .array(NonEmptyTrimmedStringSchema)
  .optional()
  .transform((value) => {
    if (!value || value.length === 0) {
      return undefined;
    }
    return value;
  });

const CliWrapperConfigSchema = z.object({
  path: NonEmptyTrimmedStringSchema,
  env: z.record(z.string()).optional(),
});

const ScheduleConfigSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  cron: NonEmptyTrimmedStringSchema,
  prompt: NonEmptyTrimmedStringSchema.optional(),
  preCheck: NonEmptyTrimmedStringSchema.optional(),
  sessionTitle: NonEmptyTrimmedStringSchema.optional(),
  enabled: z.boolean().optional().default(true),
  maxConcurrent: z.number().int().min(1).optional().default(1),
});

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

function assertNoReservedArgs(options: {
  agentId: string;
  provider: 'claude-cli' | 'codex-cli' | 'pi-cli';
  extraArgs?: string[];
  reservedArgs: readonly string[];
}): void {
  const { agentId, provider, extraArgs, reservedArgs } = options;
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
      `agents[${agentId}].chat.config.extraArgs must not include reserved ${provider} flags: ${list}`,
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

function assertNoCodexReasoningExtraArgs(options: { agentId: string; extraArgs?: string[] }): void {
  const { agentId, extraArgs } = options;
  if (!extraArgs || extraArgs.length === 0) {
    return;
  }
  if (hasCodexReasoningConfig(extraArgs)) {
    throw new Error(
      `agents[${agentId}].chat.config.extraArgs must not include codex model_reasoning_effort overrides when chat.thinking is set`,
    );
  }
}

function parseChatModels(options: { agentId: string; modelsRaw: unknown }): string[] | undefined {
  const { agentId, modelsRaw } = options;
  if (modelsRaw === undefined || modelsRaw === null) {
    return undefined;
  }
  if (!Array.isArray(modelsRaw)) {
    throw new Error(
      `agents[${agentId}].chat.models must be an array of non-empty strings, null, or omitted`,
    );
  }
  const collected: string[] = [];
  for (let i = 0; i < modelsRaw.length; i += 1) {
    const value = modelsRaw[i];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(
        `agents[${agentId}].chat.models[${i}] must be a non-empty string when provided`,
      );
    }
    collected.push(value.trim());
  }
  if (collected.length === 0) {
    throw new Error(`agents[${agentId}].chat.models must contain at least one model when provided`);
  }
  return collected;
}

function parseChatThinking(options: { agentId: string; thinkingRaw: unknown }): string[] | undefined {
  const { agentId, thinkingRaw } = options;
  if (thinkingRaw === undefined || thinkingRaw === null) {
    return undefined;
  }
  if (!Array.isArray(thinkingRaw)) {
    throw new Error(
      `agents[${agentId}].chat.thinking must be an array of non-empty strings, null, or omitted`,
    );
  }
  const collected: string[] = [];
  for (let i = 0; i < thinkingRaw.length; i += 1) {
    const value = thinkingRaw[i];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(
        `agents[${agentId}].chat.thinking[${i}] must be a non-empty string when provided`,
      );
    }
    collected.push(value.trim());
  }
  if (collected.length === 0) {
    throw new Error(
      `agents[${agentId}].chat.thinking must contain at least one entry when provided`,
    );
  }
  return collected;
}

const AgentTypeSchema = z.enum(['chat', 'external']);

const ExternalAgentConfigSchema = z.object({
  inputUrl: NonEmptyTrimmedStringSchema,
  callbackBaseUrl: NonEmptyTrimmedStringSchema,
});

const ChatProviderSchema = z.enum(['pi', 'claude-cli', 'codex-cli', 'pi-cli']);

const CliChatConfigSchema = z.object({
  workdir: NonEmptyTrimmedStringSchema.optional(),
  extraArgs: ExtraArgsSchema,
  wrapper: CliWrapperConfigSchema.optional(),
});

const PiCliChatConfigSchema = z.object({
  workdir: NonEmptyTrimmedStringSchema.optional(),
  extraArgs: ExtraArgsSchema,
  wrapper: CliWrapperConfigSchema.optional(),
});

const PiSdkChatConfigSchema = z.object({
  provider: NonEmptyTrimmedStringSchema.optional(),
  apiKey: NonEmptyTrimmedStringSchema.optional(),
  baseUrl: NonEmptyTrimmedStringSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(1).optional(),
  maxTokens: z.number().int().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxToolIterations: z.number().int().min(1).optional(),
});

const ChatConfigSchema = z.object({
  provider: ChatProviderSchema.optional().nullable(),
  config: z.unknown().optional().nullable(),
  /**
   * For provider "pi" and CLI providers: list of allowed model ids.
   * The first model is used as the default for new sessions.
   */
  models: z.array(NonEmptyTrimmedStringSchema).optional().nullable(),
  /**
   * For providers "pi" and "codex-cli": list of allowed thinking levels.
   * The first level is used as the default for new sessions.
   */
  thinking: z.array(NonEmptyTrimmedStringSchema).optional().nullable(),
});

const RawAgentConfigSchema = z.object({
  agentId: NonEmptyTrimmedStringSchema,
  displayName: NonEmptyTrimmedStringSchema,
  description: NonEmptyTrimmedStringSchema,
  type: AgentTypeSchema.optional().nullable(),
  chat: ChatConfigSchema.optional().nullable(),
  external: ExternalAgentConfigSchema.optional().nullable(),
  systemPrompt: z.string().trim().min(1).optional(),
  toolAllowlist: GlobPatternListSchema,
  toolDenylist: GlobPatternListSchema,
  toolExposure: z.enum(['tools', 'skills', 'mixed']).optional().nullable(),
  skillAllowlist: GlobPatternListSchema,
  skillDenylist: GlobPatternListSchema,
  capabilityAllowlist: GlobPatternListSchema,
  capabilityDenylist: GlobPatternListSchema,
  agentAllowlist: GlobPatternListSchema,
  agentDenylist: GlobPatternListSchema,
  uiVisible: z.boolean().optional().nullable(),
  apiExposed: z.boolean().optional().nullable(),
  schedules: z.array(ScheduleConfigSchema).optional(),
}).superRefine((value, ctx) => {
  if (!value.schedules || value.schedules.length === 0) {
    return;
  }
  const seenIds = new Set<string>();
  for (const schedule of value.schedules) {
    if (seenIds.has(schedule.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedules'],
        message: `Duplicate schedule id "${schedule.id}" within agent "${value.agentId}"`,
      });
    }
    seenIds.add(schedule.id);

    if (!isValidCron5Field(schedule.cron)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedules', schedule.id, 'cron'],
        message: `Invalid 5-field cron expression: "${schedule.cron}"`,
      });
    }

    if (!schedule.prompt && !schedule.preCheck) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['schedules', schedule.id],
        message: `Schedule "${schedule.id}" must define "prompt", "preCheck", or both`,
      });
    }
  }
});

export const AgentConfigSchema = RawAgentConfigSchema.transform((value) => {
  const {
    agentId,
    displayName,
    description,
    type: rawType,
    chat: rawChat,
    external: rawExternal,
    systemPrompt,
    toolAllowlist,
    toolDenylist,
    toolExposure,
    skillAllowlist,
    skillDenylist,
    capabilityAllowlist,
    capabilityDenylist,
    agentAllowlist,
    agentDenylist,
    uiVisible,
    apiExposed,
    schedules,
  } = value;

  const normalizedSchedules = schedules?.map((schedule) => ({
    id: schedule.id,
    cron: schedule.cron,
    enabled: schedule.enabled,
    maxConcurrent: schedule.maxConcurrent,
    ...(schedule.prompt !== undefined ? { prompt: schedule.prompt } : {}),
    ...(schedule.preCheck !== undefined ? { preCheck: schedule.preCheck } : {}),
    ...(schedule.sessionTitle !== undefined ? { sessionTitle: schedule.sessionTitle } : {}),
  }));

  const base: AgentDefinition = {
    agentId,
    displayName,
    description,
    ...(normalizedSchedules ? { schedules: normalizedSchedules } : {}),
  };

  const type = rawType === 'external' ? 'external' : 'chat';
  if (type !== 'chat') {
    base.type = type;
  }

  if (type === 'external') {
    if (!rawExternal) {
      throw new Error(`agents[${agentId}].external is required when type is "external"`);
    }
    base.external = {
      inputUrl: rawExternal.inputUrl,
      callbackBaseUrl: rawExternal.callbackBaseUrl,
    };
    if (rawChat) {
      throw new Error(`agents[${agentId}].chat is only valid when type is "chat"`);
    }
  } else if (rawExternal) {
    throw new Error(`agents[${agentId}].external is only valid when type is "external"`);
  }

  if (type === 'chat' && rawChat) {
    const providerRaw = rawChat.provider ?? undefined;
    const provider: 'pi' | 'claude-cli' | 'codex-cli' | 'pi-cli' =
      providerRaw === 'pi' ||
      providerRaw === 'claude-cli' ||
      providerRaw === 'codex-cli' ||
      providerRaw === 'pi-cli'
        ? providerRaw
        : 'pi';

    if (provider === 'pi') {
      const models = parseChatModels({ agentId, modelsRaw: rawChat.models });
      const thinking = parseChatThinking({ agentId, thinkingRaw: rawChat.thinking });
      const config =
        rawChat.config !== undefined && rawChat.config !== null
          ? PiSdkChatConfigSchema.parse(rawChat.config)
          : undefined;

      base.chat = {
        provider: 'pi',
        ...(models ? { models } : {}),
        ...(thinking ? { thinking } : {}),
        ...(config
          ? {
              config: {
                ...(config.provider ? { provider: config.provider } : {}),
                ...(config.apiKey ? { apiKey: config.apiKey } : {}),
                ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
                ...(config.headers ? { headers: config.headers } : {}),
                ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
                ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
                ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
                ...(config.maxToolIterations !== undefined
                  ? { maxToolIterations: config.maxToolIterations }
                  : {}),
              },
            }
          : {}),
      };
    } else if (provider === 'claude-cli' || provider === 'codex-cli') {
      const models = parseChatModels({ agentId, modelsRaw: rawChat.models });
      const thinking =
        provider === 'codex-cli'
          ? parseChatThinking({ agentId, thinkingRaw: rawChat.thinking })
          : undefined;
      const config =
        rawChat.config !== undefined && rawChat.config !== null
          ? CliChatConfigSchema.parse(rawChat.config)
          : undefined;
      if (provider === 'claude-cli') {
        if (config?.extraArgs) {
          const reservedArgs = models
            ? [...CLAUDE_CLI_RESERVED_ARGS, '--model']
            : CLAUDE_CLI_RESERVED_ARGS;
          assertNoReservedArgs({
            agentId,
            provider: 'claude-cli',
            extraArgs: config.extraArgs,
            reservedArgs,
          });
        }
        base.chat = {
          provider: 'claude-cli',
          ...(models ? { models } : {}),
          ...(config
            ? {
                config: {
                  ...(config.workdir ? { workdir: config.workdir } : {}),
                  ...(config.extraArgs ? { extraArgs: config.extraArgs } : {}),
                  ...(config.wrapper
                    ? {
                        wrapper: {
                          path: config.wrapper.path,
                          ...(config.wrapper.env ? { env: config.wrapper.env } : {}),
                        },
                      }
                    : {}),
                },
              }
            : {}),
        };
      } else {
        if (config?.extraArgs) {
          const reservedArgs = models
            ? [...CODEX_CLI_RESERVED_ARGS, '--model']
            : CODEX_CLI_RESERVED_ARGS;
          assertNoReservedArgs({
            agentId,
            provider: 'codex-cli',
            extraArgs: config.extraArgs,
            reservedArgs,
          });
          if (thinking) {
            assertNoCodexReasoningExtraArgs({ agentId, extraArgs: config.extraArgs });
          }
        }
        base.chat = {
          provider: 'codex-cli',
          ...(models ? { models } : {}),
          ...(thinking ? { thinking } : {}),
          ...(config
            ? {
                config: {
                  ...(config.workdir ? { workdir: config.workdir } : {}),
                  ...(config.extraArgs ? { extraArgs: config.extraArgs } : {}),
                  ...(config.wrapper
                    ? {
                        wrapper: {
                          path: config.wrapper.path,
                          ...(config.wrapper.env ? { env: config.wrapper.env } : {}),
                        },
                      }
                    : {}),
                },
              }
            : {}),
        };
      }
    } else if (provider === 'pi-cli') {
      const models = parseChatModels({ agentId, modelsRaw: rawChat.models });
      const thinking = parseChatThinking({ agentId, thinkingRaw: rawChat.thinking });
      const config =
        rawChat.config !== undefined && rawChat.config !== null
          ? PiCliChatConfigSchema.parse(rawChat.config)
          : undefined;

      if (config?.extraArgs) {
        const reservedArgs = models || thinking
          ? [
              ...PI_CLI_RESERVED_ARGS,
              ...(models ? ['--model', '--provider'] : []),
              ...(thinking ? ['--thinking'] : []),
            ]
          : PI_CLI_RESERVED_ARGS;
        assertNoReservedArgs({
          agentId,
          provider: 'pi-cli',
          extraArgs: config.extraArgs,
          reservedArgs,
        });
      }

      base.chat = {
        provider: 'pi-cli',
        ...(models ? { models } : {}),
        ...(thinking ? { thinking } : {}),
        ...(config
          ? {
              config: {
                ...(config.workdir ? { workdir: config.workdir } : {}),
                ...(config.extraArgs ? { extraArgs: config.extraArgs } : {}),
                ...(config.wrapper
                  ? {
                      wrapper: {
                        path: config.wrapper.path,
                        ...(config.wrapper.env ? { env: config.wrapper.env } : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
    }
  }

  const extended: AgentDefinition = { ...base };

  if (systemPrompt) {
    extended.systemPrompt = systemPrompt;
  }
  if (toolAllowlist) {
    extended.toolAllowlist = toolAllowlist;
  }
  if (toolDenylist) {
    extended.toolDenylist = toolDenylist;
  }
  if (toolExposure) {
    extended.toolExposure = toolExposure;
  }
  if (skillAllowlist) {
    extended.skillAllowlist = skillAllowlist;
  }
  if (skillDenylist) {
    extended.skillDenylist = skillDenylist;
  }
  if (capabilityAllowlist) {
    extended.capabilityAllowlist = capabilityAllowlist;
  }
  if (capabilityDenylist) {
    extended.capabilityDenylist = capabilityDenylist;
  }
  if (agentAllowlist) {
    extended.agentAllowlist = agentAllowlist;
  }
  if (agentDenylist) {
    extended.agentDenylist = agentDenylist;
  }
  if (uiVisible !== undefined && uiVisible !== null) {
    extended.uiVisible = uiVisible;
  }
  if (apiExposed !== undefined && apiExposed !== null) {
    extended.apiExposed = apiExposed;
  }

  return extended;
});

export type AgentConfig = AgentDefinition;

export const GitVersioningConfigSchema = z.object({
  enabled: z.boolean().default(false),
  intervalMinutes: z.number().int().min(1).default(1),
});

export type GitVersioningConfig = z.infer<typeof GitVersioningConfigSchema>;

const PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;
const DEFAULT_PROFILE_ID = 'default';

const ProfileConfigSchema = z.object({
  id: NonEmptyTrimmedStringSchema,
  label: NonEmptyTrimmedStringSchema.optional(),
});

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;

const ProfilesConfigSchema = z
  .array(ProfileConfigSchema)
  .optional()
  .transform((value) => value ?? []);

export type ProfileDefinition = {
  id: string;
  label: string;
};

export const PluginConfigSchema = z
  .object({
    enabled: z.boolean(),
    source: z
      .object({
        path: NonEmptyTrimmedStringSchema.optional(),
      })
      .optional(),
    workspaceRoot: NonEmptyTrimmedStringSchema.optional(),
    mode: z.enum(['local', 'sidecar']).optional(),
    local: z
      .object({
        workspaceRoot: NonEmptyTrimmedStringSchema.optional(),
      })
      .optional(),
    sidecar: z
      .object({
        socketPath: NonEmptyTrimmedStringSchema.optional(),
        tcp: z
          .object({
            host: NonEmptyTrimmedStringSchema,
            port: z.number().int().positive(),
          })
          .optional(),
        waitForReadyMs: z.number().int().positive().optional(),
        auth: z
          .object({
            token: NonEmptyTrimmedStringSchema.optional(),
            required: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    spotify: z
      .object({
        rewriteWebUrlsToUris: z.boolean().optional(),
      })
      .optional(),
    instances: z
      .array(
        z.union([
          NonEmptyTrimmedStringSchema,
          z
            .object({
              id: NonEmptyTrimmedStringSchema,
              label: NonEmptyTrimmedStringSchema.optional(),
            })
            .passthrough(),
        ]),
      )
      .optional(),
    gitVersioning: GitVersioningConfigSchema.optional(),
  })
  .passthrough();

export type PluginConfig = z.infer<typeof PluginConfigSchema>;
export type PluginsConfig = Record<string, PluginConfig>;

export const McpServerConfigSchema = z.object({
  name: NonEmptyTrimmedStringSchema.optional(),
  command: NonEmptyTrimmedStringSchema,
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const SessionsConfigSchema = z.object({
  maxCached: z.number().int().min(1).default(100),
  mirrorPiSessionHistory: z.boolean().default(true),
});

export type SessionsConfig = z.infer<typeof SessionsConfigSchema>;

export const AppConfigSchema = z
  .object({
    agents: z
      .array(AgentConfigSchema)
      .optional()
      .transform((value) => value ?? []),
    profiles: ProfilesConfigSchema,
    plugins: z
      .record(PluginConfigSchema)
      .optional()
      .transform<PluginsConfig>((value) => value ?? {}),
    mcpServers: z
      .array(McpServerConfigSchema)
      .optional()
      .transform((value) => value ?? []),
    sessions: SessionsConfigSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const profileIds = new Set<string>();
    const seenProfiles = new Set<string>();

    value.profiles.forEach((profile, index) => {
      const normalized = normalizeProfileId(profile.id);
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['profiles', index, 'id'],
          message: `Invalid profile id "${profile.id}"`,
        });
        return;
      }
      if (seenProfiles.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['profiles', index, 'id'],
          message: `Duplicate profile id "${normalized}"`,
        });
        return;
      }
      seenProfiles.add(normalized);
      profileIds.add(normalized);
    });

    profileIds.add(DEFAULT_PROFILE_ID);

    for (const [pluginId, pluginConfig] of Object.entries(value.plugins)) {
      const rawInstances = pluginConfig.instances;
      if (!Array.isArray(rawInstances)) {
        continue;
      }
      rawInstances.forEach((entry, index) => {
        const rawId = typeof entry === 'string' ? entry : entry?.id;
        if (typeof rawId !== 'string') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['plugins', pluginId, 'instances', index],
            message: `Instance id for plugin "${pluginId}" must be a string`,
          });
          return;
        }
        const normalized = normalizeProfileId(rawId);
        if (!normalized) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['plugins', pluginId, 'instances', index],
            message: `Invalid instance id "${rawId}" for plugin "${pluginId}"`,
          });
          return;
        }
        if (!profileIds.has(normalized)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['plugins', pluginId, 'instances', index],
            message: `Instance id "${normalized}" for plugin "${pluginId}" is not defined in profiles`,
          });
        }
      });
    }
  });

export type AppConfig = z.infer<typeof AppConfigSchema>;

function formatProfileLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeProfileId(value: string): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.toLowerCase();
  if (!PROFILE_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeProfiles(profiles: ProfileConfig[]): ProfileDefinition[] {
  const map = new Map<string, ProfileDefinition>();
  for (const profile of profiles) {
    const normalized = normalizeProfileId(profile.id);
    if (!normalized) {
      throw new Error(`Invalid profile id "${profile.id}"`);
    }
    if (map.has(normalized)) {
      throw new Error(`Duplicate profile id "${normalized}"`);
    }
    const label = profile.label?.trim() || formatProfileLabel(normalized);
    map.set(normalized, { id: normalized, label });
  }

  if (!map.has(DEFAULT_PROFILE_ID)) {
    map.set(DEFAULT_PROFILE_ID, {
      id: DEFAULT_PROFILE_ID,
      label: 'Default',
    });
  }

  const entries = Array.from(map.values());
  if (entries.length === 0) {
    return entries;
  }
  if (entries[0]?.id === DEFAULT_PROFILE_ID) {
    return entries;
  }
  const defaultProfile = map.get(DEFAULT_PROFILE_ID);
  if (!defaultProfile) {
    return entries;
  }
  return [defaultProfile, ...entries.filter((profile) => profile.id !== DEFAULT_PROFILE_ID)];
}

function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, name: string) => {
    const envValue = process.env[name];
    return envValue ?? '';
  });
}

/**
 * Recursively walk a value and substitute environment variables in all strings.
 */
function deepSubstitute<T>(value: T): T {
  if (typeof value === 'string') {
    return substituteEnvVars(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepSubstitute(item)) as T;
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = deepSubstitute(val);
    }
    return result as T;
  }

  return value;
}

function applyEnvSubstitution(config: AppConfig): AppConfig {
  return deepSubstitute(config);
}

export function loadConfig(configPath: string): AppConfig {
  const resolvedPath = path.resolve(configPath);

  let raw: string;
  try {
    raw = fs.readFileSync(resolvedPath, 'utf8');
  } catch (err) {
    const anyErr = err as NodeJS.ErrnoException;
    if (anyErr && anyErr.code === 'ENOENT') {
      throw new Error(`Configuration file not found at ${resolvedPath}`);
    }

    throw new Error(`Failed to read configuration file at ${resolvedPath}: ${anyErr}`);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `Configuration file at ${resolvedPath} is not valid JSON: ${(err as Error).message}`,
    );
  }

  const config = applyEnvSubstitution(AppConfigSchema.parse(parsedJson));
  const profiles = normalizeProfiles(config.profiles ?? []);
  return {
    ...config,
    profiles,
  };
}
