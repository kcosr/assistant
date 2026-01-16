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

const AgentTypeSchema = z.enum(['chat', 'external']);

const ExternalAgentConfigSchema = z.object({
  inputUrl: NonEmptyTrimmedStringSchema,
  callbackBaseUrl: NonEmptyTrimmedStringSchema,
});

const ChatProviderSchema = z.enum([
  'openai',
  'claude-cli',
  'codex-cli',
  'pi-cli',
  'openai-compatible',
]);

const CliChatConfigSchema = z.object({
  workdir: NonEmptyTrimmedStringSchema.optional(),
  extraArgs: ExtraArgsSchema,
  wrapper: CliWrapperConfigSchema.optional(),
});

const PiCliChatConfigSchema = z.object({
  workdir: NonEmptyTrimmedStringSchema.optional(),
  sessionDir: NonEmptyTrimmedStringSchema.optional(),
  sessionDirCli: NonEmptyTrimmedStringSchema.optional(),
  extraArgs: ExtraArgsSchema,
  wrapper: CliWrapperConfigSchema.optional(),
});

const OpenAiCompatibleChatConfigSchema = z
  .object({
    baseUrl: NonEmptyTrimmedStringSchema,
    apiKey: NonEmptyTrimmedStringSchema.optional(),
    /**
     * Legacy single-model configuration. When provided, this will be
     * normalised into a single-element models array.
     */
    model: NonEmptyTrimmedStringSchema.optional(),
    /**
     * Preferred configuration: list of allowed model ids. At least one
     * model is required at runtime (either via models or model).
     */
    models: z.array(NonEmptyTrimmedStringSchema).optional(),
    maxTokens: z.number().int().min(1).optional(),
    temperature: z.number().min(0).max(2).optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((value, ctx) => {
    const hasModels = Array.isArray(value.models) && value.models.length > 0;
    const hasModel = typeof value.model === 'string' && value.model.trim().length > 0;
    if (!hasModels && !hasModel) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['models'],
        message:
          'Either "models" (non-empty array) or "model" (string) is required for openai-compatible chat.config',
      });
    }
  });

const ChatConfigSchema = z.object({
  provider: ChatProviderSchema.optional().nullable(),
  config: z.unknown().optional().nullable(),
  /**
   * For provider "openai": list of allowed model ids. The first
   * model is used as the default for new sessions.
   */
  models: z.array(NonEmptyTrimmedStringSchema).optional().nullable(),
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
    const provider: 'openai' | 'claude-cli' | 'codex-cli' | 'pi-cli' | 'openai-compatible' =
      providerRaw === 'claude-cli' ||
      providerRaw === 'codex-cli' ||
      providerRaw === 'pi-cli' ||
      providerRaw === 'openai-compatible'
        ? providerRaw
        : 'openai';

    if (provider === 'openai') {
      if (rawChat.config) {
        throw new Error(
          `agents[${agentId}].chat.config is only valid when chat.provider is "claude-cli", "codex-cli", "pi-cli", or "openai-compatible"`,
        );
      }

      const modelsList =
        rawChat.models && Array.isArray(rawChat.models)
          ? rawChat.models.filter((m) => typeof m === 'string' && m.trim().length > 0)
          : [];

      if (rawChat.models && modelsList.length === 0) {
        throw new Error(
          `agents[${agentId}].chat.models must contain at least one non-empty string when provided`,
        );
      }

      if (providerRaw === 'openai') {
        base.chat = {
          provider: 'openai',
          ...(modelsList.length > 0 ? { models: modelsList } : {}),
        };
      }
    } else if (provider === 'claude-cli' || provider === 'codex-cli') {
      const config =
        rawChat.config !== undefined && rawChat.config !== null
          ? CliChatConfigSchema.parse(rawChat.config)
          : undefined;
      if (provider === 'claude-cli') {
        if (config?.extraArgs) {
          assertNoReservedArgs({
            agentId,
            provider: 'claude-cli',
            extraArgs: config.extraArgs,
            reservedArgs: CLAUDE_CLI_RESERVED_ARGS,
          });
        }
        base.chat = {
          provider: 'claude-cli',
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
          assertNoReservedArgs({
            agentId,
            provider: 'codex-cli',
            extraArgs: config.extraArgs,
            reservedArgs: CODEX_CLI_RESERVED_ARGS,
          });
        }
        base.chat = {
          provider: 'codex-cli',
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
      const config =
        rawChat.config !== undefined && rawChat.config !== null
          ? PiCliChatConfigSchema.parse(rawChat.config)
          : undefined;

      if (config?.extraArgs) {
        assertNoReservedArgs({
          agentId,
          provider: 'pi-cli',
          extraArgs: config.extraArgs,
          reservedArgs: PI_CLI_RESERVED_ARGS,
        });
      }

      base.chat = {
        provider: 'pi-cli',
        ...(config
          ? {
              config: {
                ...(config.workdir ? { workdir: config.workdir } : {}),
                ...(config.sessionDir ? { sessionDir: config.sessionDir } : {}),
                ...(config.sessionDirCli ? { sessionDirCli: config.sessionDirCli } : {}),
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
      const config =
        rawChat.config !== undefined && rawChat.config !== null
          ? OpenAiCompatibleChatConfigSchema.parse(rawChat.config)
          : undefined;
      if (!config) {
        throw new Error(
          `agents[${agentId}].chat.config is required when chat.provider is "openai-compatible"`,
        );
      }

      const modelsFromConfig =
        config.models && Array.isArray(config.models)
          ? config.models.filter((m) => typeof m === 'string' && m.trim().length > 0)
          : [];
      const singleModel =
        typeof config.model === 'string' && config.model.trim().length > 0
          ? config.model.trim()
          : undefined;

      const finalModels =
        modelsFromConfig.length > 0 ? modelsFromConfig : singleModel ? [singleModel] : [];

      if (finalModels.length === 0) {
        throw new Error(
          `agents[${agentId}].chat.config.models must contain at least one model when chat.provider is "openai-compatible"`,
        );
      }

      base.chat = {
        provider: 'openai-compatible',
        config: {
          baseUrl: config.baseUrl,
          models: finalModels,
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
          ...(config.headers ? { headers: config.headers } : {}),
        },
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

export const PluginConfigSchema = z
  .object({
    enabled: z.boolean(),
    source: z
      .object({
        path: NonEmptyTrimmedStringSchema.optional(),
      })
      .optional(),
    workspaceRoot: NonEmptyTrimmedStringSchema.optional(),
    mode: z.enum(['local', 'container']).optional(),
    local: z
      .object({
        workspaceRoot: NonEmptyTrimmedStringSchema.optional(),
        sharedWorkspace: z.boolean().optional(),
      })
      .optional(),
    container: z
      .object({
        runtime: z.enum(['docker', 'podman']).optional(),
        socketPath: NonEmptyTrimmedStringSchema.optional(),
        image: NonEmptyTrimmedStringSchema.optional(),
        socketDir: NonEmptyTrimmedStringSchema.optional(),
        workspaceVolume: NonEmptyTrimmedStringSchema.optional(),
        sharedWorkspace: z.boolean().optional(),
        resources: z
          .object({
            memory: NonEmptyTrimmedStringSchema.optional(),
            cpus: z.number().positive().optional(),
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
});

export type SessionsConfig = z.infer<typeof SessionsConfigSchema>;

export const AppConfigSchema = z.object({
  agents: z
    .array(AgentConfigSchema)
    .optional()
    .transform((value) => value ?? []),
  plugins: z
    .record(PluginConfigSchema)
    .optional()
    .transform<PluginsConfig>((value) => value ?? {}),
  mcpServers: z
    .array(McpServerConfigSchema)
    .optional()
    .transform((value) => value ?? []),
  sessions: SessionsConfigSchema.optional(),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;

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

  const config = AppConfigSchema.parse(parsedJson);
  return applyEnvSubstitution(config);
}
