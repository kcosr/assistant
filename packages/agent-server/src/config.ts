import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';
import type { AgentDefinition } from './agents';
import { DEFAULT_ATTACHMENT_PREVIEW_SNIPPET_CHARS } from './attachments/constants';
import { normalizeContextFileSourcesForConfigDir } from './contextFiles';
import { normalizeInstructionSkillSourcesForConfigDir } from './instructionSkills';
import { resolveAgentTemplates } from './templateResolution';

const NonEmptyTrimmedStringSchema = z.string().trim().min(1);
const AbsolutePathSchema = NonEmptyTrimmedStringSchema.refine(
  (value) => path.isAbsolute(value),
  'must be an absolute path',
);

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

const ToolApprovalsConfigSchema = z
  .object({
    required: GlobPatternListSchema,
    bashAllowPrefixes: z.array(NonEmptyTrimmedStringSchema).optional(),
    writeAllowDirectories: z.array(AbsolutePathSchema).optional(),
  })
  .optional()
  .nullable()
  .transform((value) =>
    value?.required && value.required.length > 0
      ? {
          required: value.required,
          ...(value.bashAllowPrefixes ? { bashAllowPrefixes: value.bashAllowPrefixes } : {}),
          ...(value.writeAllowDirectories
            ? { writeAllowDirectories: value.writeAllowDirectories }
            : {}),
        }
      : undefined,
  );

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

function parseChatThinking(options: {
  agentId: string;
  thinkingRaw: unknown;
}): string[] | undefined {
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

const ChatProfileModelSchema = z
  .object({
    id: NonEmptyTrimmedStringSchema.refine(
      (value) => /^[^/\s]+\/[^\s]+$/.test(value),
      'Pi models must use provider/model format',
    ),
    thinking: z
      .array(z.enum(['none', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']))
      .min(1)
      .refine((levels) => new Set(levels).size === levels.length, 'Thinking levels must be unique')
      .optional(),
    sampling: z
      .never({
        invalid_type_error:
          'Profile sampling is not supported; configure sampling in Pi agent request-overrides.json',
      })
      .optional(),
  })
  .strict();

const ChatProfileSchema = z
  .object({
    models: z
      .array(ChatProfileModelSchema)
      .min(1)
      .refine(
        (models) => new Set(models.map((model) => model.id)).size === models.length,
        'Models in a chat profile must have unique ids',
      ),
  })
  .strict();

const PiSdkChatConfigSchema = z
  .object({
    timeoutMs: z.number().int().min(1).optional(),
    maxToolIterations: z.number().int().min(1).optional(),
    compaction: z
      .object({
        enabled: z.boolean().optional(),
        reserveTokens: z.number().int().min(1).optional(),
        keepRecentTokens: z.number().int().min(1).optional(),
      })
      .optional(),
  })
  .strict();

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

const InstructionSkillSourceConfigSchema = z.object({
  root: NonEmptyTrimmedStringSchema,
  available: GlobPatternListSchema,
  inline: GlobPatternListSchema,
});

const InstructionSkillsConfigSchema = z
  .array(InstructionSkillSourceConfigSchema)
  .optional()
  .nullable()
  .transform((value) => {
    if (!value || value.length === 0) {
      return undefined;
    }
    return value.map((source) => ({
      root: source.root,
      ...(source.available !== undefined ? { available: source.available } : {}),
      ...(source.inline !== undefined ? { inline: source.inline } : {}),
    }));
  });

const ContextFileSourceConfigSchema = z.object({
  root: NonEmptyTrimmedStringSchema,
  include: z.array(NonEmptyTrimmedStringSchema).min(1),
});

const ContextFilesConfigSchema = z
  .array(ContextFileSourceConfigSchema)
  .optional()
  .nullable()
  .transform((value) => {
    if (!value || value.length === 0) {
      return undefined;
    }
    return value.map((source) => ({
      root: source.root,
      include: source.include,
    }));
  });

const SessionWorkingDirConfigSchema = z
  .discriminatedUnion('mode', [
    z.object({
      mode: z.literal('none'),
    }),
    z.object({
      mode: z.literal('fixed'),
      path: AbsolutePathSchema,
    }),
    z.object({
      mode: z.literal('prompt'),
      roots: z.array(AbsolutePathSchema).min(1),
    }),
  ])
  .optional()
  .nullable()
  .transform((value) => value ?? undefined);

const RawAgentConfigSchema = z.object({
  agentId: NonEmptyTrimmedStringSchema,
  displayName: NonEmptyTrimmedStringSchema,
  description: NonEmptyTrimmedStringSchema,
  type: AgentTypeSchema.optional().nullable(),
  chat: ChatConfigSchema.optional().nullable(),
  chatProfile: NonEmptyTrimmedStringSchema.optional().nullable(),
  external: ExternalAgentConfigSchema.optional().nullable(),
  systemPrompt: z.string().trim().min(1).optional(),
  toolAllowlist: GlobPatternListSchema,
  toolDenylist: GlobPatternListSchema,
  toolApprovals: ToolApprovalsConfigSchema,
  toolExposure: z.enum(['tools', 'skills', 'mixed']).optional().nullable(),
  skillAllowlist: GlobPatternListSchema,
  skillDenylist: GlobPatternListSchema,
  capabilityAllowlist: GlobPatternListSchema,
  capabilityDenylist: GlobPatternListSchema,
  agentAllowlist: GlobPatternListSchema,
  agentDenylist: GlobPatternListSchema,
  bangCommandEnabled: z.boolean().optional().nullable(),
  uiVisible: z.boolean().optional().nullable(),
  apiExposed: z.boolean().optional().nullable(),
  sessionWorkingDir: SessionWorkingDirConfigSchema.optional(),
  sessionWorkingDirMode: z
    .unknown()
    .optional()
    .superRefine((value, ctx) => {
      if (value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sessionWorkingDirMode is no longer supported; use sessionWorkingDir instead',
        });
      }
    }),
  sessionWorkingDirRoots: z
    .unknown()
    .optional()
    .superRefine((value, ctx) => {
      if (value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'sessionWorkingDirRoots is no longer supported; use sessionWorkingDir instead',
        });
      }
    }),
  schedules: z
    .unknown()
    .optional()
    .superRefine((value, ctx) => {
      if (value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'scheduled sessions are no longer configured on agents; use the scheduled-sessions plugin store instead',
        });
      }
    }),
  skills: InstructionSkillsConfigSchema,
  contextFiles: ContextFilesConfigSchema,
});

export const AgentConfigSchema = RawAgentConfigSchema.transform((value) => {
  const {
    agentId,
    displayName,
    description,
    type: rawType,
    chat: rawChat,
    chatProfile,
    external: rawExternal,
    systemPrompt,
    toolAllowlist,
    toolDenylist,
    toolApprovals,
    toolExposure,
    skillAllowlist,
    skillDenylist,
    capabilityAllowlist,
    capabilityDenylist,
    agentAllowlist,
    agentDenylist,
    bangCommandEnabled,
    uiVisible,
    apiExposed,
    sessionWorkingDir,
    skills,
    contextFiles,
  } = value;

  const base: AgentDefinition = {
    agentId,
    displayName,
    description,
    ...(chatProfile ? { chatProfile } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(contextFiles !== undefined ? { contextFiles } : {}),
    ...(sessionWorkingDir ? { sessionWorkingDir } : {}),
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
      if (rawChat.models != null || rawChat.thinking != null) {
        throw new Error(
          `agents[${agentId}].chat.models and chat.thinking are no longer supported for Pi; use chatProfile and root chatProfiles with per-model thinking settings`,
        );
      }
      const parsedConfig =
        rawChat.config != null ? PiSdkChatConfigSchema.safeParse(rawChat.config) : undefined;
      if (parsedConfig && !parsedConfig.success) {
        throw new Error(
          `agents[${agentId}].chat.config supports only timeoutMs, maxToolIterations and compaction; move provider/model definitions to Pi models.json and sampling to Pi agent request-overrides.json: ${parsedConfig.error.message}`,
        );
      }
      const config = parsedConfig?.success ? parsedConfig.data : undefined;
      base.chat = {
        provider: 'pi',
        ...(config
          ? {
              config: {
                ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
                ...(config.maxToolIterations !== undefined
                  ? { maxToolIterations: config.maxToolIterations }
                  : {}),
                ...(config.compaction
                  ? {
                      compaction: {
                        ...(config.compaction.enabled !== undefined
                          ? { enabled: config.compaction.enabled }
                          : {}),
                        ...(config.compaction.reserveTokens !== undefined
                          ? { reserveTokens: config.compaction.reserveTokens }
                          : {}),
                        ...(config.compaction.keepRecentTokens !== undefined
                          ? { keepRecentTokens: config.compaction.keepRecentTokens }
                          : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      };
    } else if (provider === 'claude-cli' || provider === 'codex-cli') {
      const models = parseChatModels({ agentId, modelsRaw: rawChat.models });
      const thinking = parseChatThinking({ agentId, thinkingRaw: rawChat.thinking });
      const config =
        rawChat.config !== undefined && rawChat.config !== null
          ? CliChatConfigSchema.parse(rawChat.config)
          : undefined;
      if (provider === 'claude-cli') {
        if (config?.extraArgs) {
          const reservedArgs: string[] = [...CLAUDE_CLI_RESERVED_ARGS];
          if (models) {
            reservedArgs.push('--model');
          }
          if (thinking) {
            reservedArgs.push('--effort');
          }
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
        const reservedArgs =
          models || thinking
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
  if (toolApprovals) {
    if (type !== 'chat' || (extended.chat?.provider && extended.chat.provider !== 'pi')) {
      throw new Error(
        `agents[${agentId}].toolApprovals is only supported by the native Pi SDK provider`,
      );
    }
    extended.toolApprovals = toolApprovals;
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
  if (bangCommandEnabled !== undefined && bangCommandEnabled !== null) {
    extended.bangCommandEnabled = bangCommandEnabled;
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
    mode: z.literal('local').optional(),
    local: z
      .object({
        workspaceRoot: NonEmptyTrimmedStringSchema.optional(),
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

export const AttachmentsConfigSchema = z.object({
  previewSnippetChars: z.number().int().min(1).default(DEFAULT_ATTACHMENT_PREVIEW_SNIPPET_CHARS),
});

export type AttachmentsConfig = z.infer<typeof AttachmentsConfigSchema>;

/**
 * Realtime voice agent tool exposure. Unlike text agents, missing/empty
 * toolAllowlist means no tools (explicit opt-in only).
 */
export const VoiceRealtimeConfigSchema = z.object({
  toolAllowlist: GlobPatternListSchema,
  toolDenylist: GlobPatternListSchema,
  /**
   * Optional instructions override. When omitted, the server uses a default
   * concise realtime prompt plus recent conversation context.
   */
  instructions: z
    .string()
    .optional()
    .nullable()
    .transform((value) => {
      if (typeof value !== 'string') {
        return undefined;
      }
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }),
});

export type VoiceRealtimeConfig = z.infer<typeof VoiceRealtimeConfigSchema>;

export const VoiceConfigSchema = z
  .object({
    realtime: VoiceRealtimeConfigSchema.optional()
      .nullable()
      .transform((value) => value ?? undefined),
  })
  .optional()
  .nullable()
  .transform((value) => value ?? undefined);

export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

export const CodexThreadsConfigSchema = z
  .object({
    allowedServers: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(100)
          .regex(
            /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
            'Codex Threads server aliases may contain letters, numbers, dots, underscores, and hyphens',
          ),
      )
      .min(1)
      .refine((servers) => new Set(servers).size === servers.length, {
        message: 'Codex Threads server aliases must be unique',
      }),
    binary: NonEmptyTrimmedStringSchema.default('codex-threads'),
    permissionMode: z.enum(['app-server-default', 'full-access']).default('app-server-default'),
    allowedCwdRoots: z.array(AbsolutePathSchema).default([]),
  })
  .strict();

export type CodexThreadsConfig = z.infer<typeof CodexThreadsConfigSchema>;

export const AppConfigSchema = z
  .object({
    agents: z
      .array(AgentConfigSchema)
      .optional()
      .transform((value) => value ?? []),
    chatProfiles: z.record(NonEmptyTrimmedStringSchema, ChatProfileSchema).optional(),
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
    attachments: AttachmentsConfigSchema.default({}),
    voice: VoiceConfigSchema,
    codexThreads: CodexThreadsConfigSchema.optional(),
  })
  .superRefine((value, ctx) => {
    value.agents.forEach((agent, index) => {
      if (!agent.chatProfile) return;
      if (agent.type === 'external' || (agent.chat?.provider && agent.chat.provider !== 'pi')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['agents', index, 'chatProfile'],
          message: 'chatProfile is only supported by the native Pi SDK provider',
        });
        return;
      }
      if (!Object.hasOwn(value.chatProfiles ?? {}, agent.chatProfile)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['agents', index, 'chatProfile'],
          message: `Unknown chatProfile "${agent.chatProfile}"; define it in root chatProfiles`,
        });
      }
    });
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
  })
  .transform((value) => ({
    ...value,
    agents: value.agents.map((agent): AgentDefinition => {
      const profile = agent.chatProfile ? value.chatProfiles?.[agent.chatProfile] : undefined;
      if (!profile) return agent;
      return {
        ...agent,
        chat: {
          ...agent.chat,
          provider: 'pi',
          models: profile.models.map((model) => model.id),
          modelSettings: profile.models.map((model) => ({
            id: model.id,
            ...(model.thinking !== undefined ? { thinking: model.thinking } : {}),
          })),
        },
      };
    }),
  }));

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

export function loadConfig(configPath: string): AppConfig {
  const resolvedPath = path.resolve(configPath);
  const configDir = path.dirname(resolvedPath);

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

  // 1. Env substitution on raw JSON (before template resolution and Zod)
  const substituted = deepSubstitute(parsedJson);

  // 2. Resolve templates (operates on raw JSON, consumes `templates` section)
  const resolved = resolveAgentTemplates(substituted as Record<string, unknown>);

  // 3. Zod validation and transformation
  const config = AppConfigSchema.parse(resolved);

  // 4. Normalize file paths relative to config directory
  const agents = config.agents.map((agent) => {
    const contextFiles = agent.contextFiles
      ? normalizeContextFileSourcesForConfigDir(agent.contextFiles, configDir)
      : undefined;
    const skills = agent.skills
      ? normalizeInstructionSkillSourcesForConfigDir(agent.skills, configDir)
      : undefined;
    return {
      ...agent,
      ...(contextFiles ? { contextFiles } : {}),
      ...(skills ? { skills } : {}),
    };
  });
  const profiles = normalizeProfiles(config.profiles ?? []);
  return {
    ...config,
    agents,
    profiles,
  };
}
