import { randomUUID } from 'node:crypto';

import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  Message,
  SimpleStreamOptions,
  TextContent,
  Tool as PiTool,
  ToolCall,
  ToolResultMessage,
  Usage,
} from '@earendil-works/pi-ai';
import type { AssistantTextPhase } from '@assistant/shared';

import type { PiSdkChatConfig } from '../agents';
import type { ChatCompletionMessage, ChatCompletionToolCallState } from '../chatCompletionTypes';
import { resolvePiAgentAuthApiKey } from './piAgentAuth';

export interface PiToolCallStartInfo {
  id: string;
  name: string;
}

export interface PiToolInputDeltaInfo {
  id: string;
  name: string;
  argumentsDelta: string;
  argumentsJson: string;
}

export interface PiSdkModelResolution {
  model: Model<Api>;
  providerId: string;
  modelId: string;
}

export interface PiSdkRuntimeModelResolution extends PiSdkModelResolution {
  runtimeModel: Model<Api>;
  providerMatchesConfig: boolean;
  apiKey?: string;
  headers?: Record<string, string>;
}

export interface PiAssistantTextBlock {
  text: string;
  phase?: AssistantTextPhase;
  textSignature?: string;
}

type PiAiModule = typeof import('@earendil-works/pi-ai');
let piAiModulePromise: Promise<PiAiModule> | null = null;

async function loadPiAiModule(): Promise<PiAiModule> {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@earendil-works/pi-ai');
  }
  return piAiModulePromise;
}

export async function resolvePiSdkAuthApiKey(options: {
  providerId: string;
  log?: (...args: unknown[]) => void;
}): Promise<string | undefined> {
  const { providerId, log } = options;
  const trimmedProviderId = providerId.trim();
  if (!trimmedProviderId) {
    return undefined;
  }

  return resolvePiAgentAuthApiKey({
    providerId: trimmedProviderId,
    ...(log ? { log } : {}),
  });
}

function createEmptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function buildPiModelCost(
  cost: PiSdkChatConfig['cost'] | undefined,
  fallback?: Model<Api>['cost'],
): Model<Api>['cost'] {
  return {
    input: cost?.input ?? fallback?.input ?? 0,
    output: cost?.output ?? fallback?.output ?? 0,
    cacheRead: cost?.cacheRead ?? fallback?.cacheRead ?? 0,
    cacheWrite: cost?.cacheWrite ?? fallback?.cacheWrite ?? 0,
  };
}

async function resolveProviderId(providerRaw: string): Promise<string | undefined> {
  const trimmed = providerRaw.trim();
  if (!trimmed) {
    return undefined;
  }
  const target = trimmed.toLowerCase();
  const { getProviders } = await loadPiAiModule();
  const providers = getProviders();
  const match = providers.find((provider) => provider.toLowerCase() === target);
  return match ?? trimmed;
}

function buildSyntheticPiSdkModel(options: {
  providerId: string;
  modelId: string;
  baseUrl: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  cost?: {
    input?: number | undefined;
    output?: number | undefined;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
  };
  compat?: Model<Api>['compat'];
}): Model<Api> {
  const { providerId, modelId, baseUrl, contextWindow } = options;
  return {
    id: modelId,
    name: modelId,
    api: (options.api ?? 'openai-responses') as Api,
    provider: providerId,
    baseUrl,
    reasoning: options.reasoning ?? true,
    input: options.input ?? ['text'],
    cost: buildPiModelCost(options.cost),
    contextWindow:
      typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0
        ? Math.floor(contextWindow)
        : 128000,
    maxTokens:
      typeof options.maxTokens === 'number' &&
      Number.isFinite(options.maxTokens) &&
      options.maxTokens > 0
        ? Math.floor(options.maxTokens)
        : 16000,
    ...(options.compat !== undefined ? { compat: options.compat } : {}),
  };
}

function buildSyntheticPiSdkModelResolution(options: {
  providerId: string;
  modelIdRaw: string;
  baseUrl: string;
  contextWindow?: number;
  api?: string;
  maxTokens?: number;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  cost?: {
    input?: number | undefined;
    output?: number | undefined;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
  };
  compat?: Model<Api>['compat'];
}): PiSdkModelResolution {
  const { providerId, modelIdRaw, baseUrl, contextWindow } = options;
  const syntheticModel = buildSyntheticPiSdkModel({
    providerId,
    modelId: modelIdRaw.trim(),
    baseUrl: baseUrl.trim(),
    ...(options.api !== undefined ? { api: options.api } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
    ...(options.input !== undefined ? { input: options.input } : {}),
    ...(options.cost !== undefined ? { cost: options.cost } : {}),
    ...(options.compat !== undefined ? { compat: options.compat } : {}),
  });
  return {
    model: syntheticModel,
    providerId,
    modelId: syntheticModel.id,
  };
}

function getModelSpecProvider(modelSpec: string): string | undefined {
  const trimmed = modelSpec.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return undefined;
  }
  const provider = trimmed.slice(0, slashIndex).trim();
  return provider || undefined;
}

function providerMatchesRawConfig(provider: string | undefined, configProvider: string): boolean {
  return Boolean(provider && provider.toLowerCase() === configProvider.toLowerCase());
}

function buildPiModelOverrides(config: PiSdkChatConfig | undefined) {
  return {
    ...(config?.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config?.api ? { api: config.api } : {}),
    ...(config?.contextWindow !== undefined ? { contextWindow: config.contextWindow } : {}),
    ...(config?.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config?.reasoning !== undefined ? { reasoning: config.reasoning } : {}),
    ...(config?.input !== undefined ? { input: config.input } : {}),
    ...(config?.cost !== undefined ? { cost: config.cost } : {}),
    ...(config?.compat !== undefined ? { compat: config.compat } : {}),
  };
}

function buildPiRuntimeModelOverrides(
  config: PiSdkChatConfig | undefined,
  fallbackModel: Model<Api>,
): Partial<Model<Api>> {
  return {
    ...(config?.api ? { api: config.api as Api } : {}),
    ...(config?.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config?.contextWindow !== undefined ? { contextWindow: config.contextWindow } : {}),
    ...(config?.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config?.reasoning !== undefined ? { reasoning: config.reasoning } : {}),
    ...(config?.input !== undefined ? { input: config.input } : {}),
    ...(config?.cost !== undefined
      ? { cost: buildPiModelCost(config.cost, fallbackModel.cost) }
      : {}),
    ...(config?.compat !== undefined ? { compat: config.compat } : {}),
  };
}

export async function resolvePiSdkRuntimeModel(options: {
  modelSpec: string;
  config?: PiSdkChatConfig | undefined;
  log?: (...args: unknown[]) => void;
}): Promise<PiSdkRuntimeModelResolution> {
  const { modelSpec, config, log } = options;
  const configProviderRaw = config?.provider?.trim();
  const configProvider = configProviderRaw || undefined;
  const modelSpecProvider = getModelSpecProvider(modelSpec);
  const modelSpecUsesConfigProvider =
    !configProvider ||
    !modelSpecProvider ||
    providerMatchesRawConfig(modelSpecProvider, configProvider);
  const modelOverrides = modelSpecUsesConfigProvider ? buildPiModelOverrides(config) : {};
  const resolvedModel =
    configProvider === undefined
      ? await resolvePiSdkModel({
          modelSpec,
          ...modelOverrides,
        })
      : await resolvePiSdkModel({
          modelSpec,
          defaultProvider: configProvider,
          ...modelOverrides,
        });
  const providerMatchesConfig =
    !configProvider || configProvider.toLowerCase() === resolvedModel.providerId.toLowerCase();
  const authApiKey = await resolvePiSdkAuthApiKey({
    providerId: resolvedModel.providerId,
    ...(log ? { log } : {}),
  });
  const apiKey = providerMatchesConfig ? (config?.apiKey ?? authApiKey) : authApiKey;
  const configuredHeaders = providerMatchesConfig ? config?.headers : undefined;
  if (providerMatchesConfig && config?.authHeader && !apiKey) {
    log?.('Pi chat authHeader is enabled but no API key is configured or available', {
      providerId: resolvedModel.providerId,
      modelSpec,
    });
  }
  const headers =
    providerMatchesConfig && config?.authHeader && apiKey
      ? { ...configuredHeaders, Authorization: `Bearer ${apiKey}` }
      : configuredHeaders;
  const runtimeModel: Model<Api> = {
    ...resolvedModel.model,
    ...(providerMatchesConfig ? buildPiRuntimeModelOverrides(config, resolvedModel.model) : {}),
    ...(headers ? { headers } : {}),
  };

  return {
    ...resolvedModel,
    runtimeModel,
    providerMatchesConfig,
    ...(apiKey ? { apiKey } : {}),
    ...(headers ? { headers } : {}),
  };
}

export async function resolvePiSdkModel(options: {
  modelSpec: string;
  defaultProvider?: string;
  baseUrl?: string;
  api?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  input?: ('text' | 'image')[];
  cost?: {
    input?: number | undefined;
    output?: number | undefined;
    cacheRead?: number | undefined;
    cacheWrite?: number | undefined;
  };
  compat?: Model<Api>['compat'];
}): Promise<PiSdkModelResolution> {
  const { modelSpec, defaultProvider, baseUrl, contextWindow } = options;
  const trimmedSpec = modelSpec.trim();
  if (!trimmedSpec) {
    throw new Error('Pi chat requires a non-empty model id');
  }

  let providerRaw: string | undefined;
  let modelIdRaw: string;
  const slashIndex = trimmedSpec.indexOf('/');
  if (slashIndex !== -1) {
    providerRaw = trimmedSpec.slice(0, slashIndex);
    modelIdRaw = trimmedSpec.slice(slashIndex + 1);
  } else {
    providerRaw = defaultProvider?.trim();
    modelIdRaw = trimmedSpec;
  }

  if (!providerRaw) {
    throw new Error('Pi chat requires provider/model format when chat.config.provider is not set');
  }

  const providerId = await resolveProviderId(providerRaw);
  if (!providerId) {
    throw new Error(`Pi chat provider "${providerRaw}" is not available`);
  }

  const { getModels, getProviders } = await loadPiAiModule();
  const knownProvider = getProviders().find(
    (provider) => provider.toLowerCase() === providerId.toLowerCase(),
  );
  if (!knownProvider) {
    if (typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
      return buildSyntheticPiSdkModelResolution({
        providerId,
        modelIdRaw,
        baseUrl,
        ...(options.api !== undefined ? { api: options.api } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
        ...(options.input !== undefined ? { input: options.input } : {}),
        ...(options.cost !== undefined ? { cost: options.cost } : {}),
        ...(options.compat !== undefined ? { compat: options.compat } : {}),
      });
    }
    throw new Error(`No Pi models found for provider "${providerId}"`);
  }

  const models = getModels(knownProvider);
  if (!models || models.length === 0) {
    if (typeof baseUrl === 'string' && baseUrl.trim().length > 0) {
      return buildSyntheticPiSdkModelResolution({
        providerId,
        modelIdRaw,
        baseUrl,
        ...(options.api !== undefined ? { api: options.api } : {}),
        ...(contextWindow !== undefined ? { contextWindow } : {}),
        ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
        ...(options.input !== undefined ? { input: options.input } : {}),
        ...(options.cost !== undefined ? { cost: options.cost } : {}),
        ...(options.compat !== undefined ? { compat: options.compat } : {}),
      });
    }
    throw new Error(`No Pi models found for provider "${providerId}"`);
  }

  const targetId = modelIdRaw.trim().toLowerCase();
  const model = models.find((entry) => entry.id.toLowerCase() === targetId);
  if (!model) {
    throw new Error(`Pi model "${providerId}/${modelIdRaw}" was not found`);
  }

  return {
    model,
    providerId,
    modelId: model.id,
  };
}

export function mapChatCompletionToolsToPiTools(tools: unknown[]): PiTool[] {
  const result: PiTool[] = [];

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') {
      continue;
    }

    const type = (tool as { type?: unknown }).type;
    if (type !== 'function') {
      continue;
    }

    const fn = (tool as { function?: unknown }).function as
      | { name?: unknown; description?: unknown; parameters?: unknown }
      | undefined;
    if (!fn || typeof fn.name !== 'string' || !fn.name.trim()) {
      continue;
    }

    result.push({
      name: fn.name.trim(),
      description: typeof fn.description === 'string' ? fn.description : '',
      parameters: (fn.parameters ?? {}) as PiTool['parameters'],
    });
  }

  return result;
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore JSON errors and fall back to empty args.
  }
  return {};
}

function parseToolResultIsError(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if ('ok' in parsed) {
        return (parsed as { ok?: unknown }).ok !== true;
      }
      if ('error' in parsed) {
        return Boolean((parsed as { error?: unknown }).error);
      }
    }
  } catch {
    // Ignore JSON errors.
  }
  return false;
}

export function parseAssistantTextSignature(
  signature: string | undefined,
): { id: string; phase?: AssistantTextPhase } | null {
  if (typeof signature !== 'string' || !signature.startsWith('{')) {
    return null;
  }
  try {
    const parsed = JSON.parse(signature) as { id?: unknown; phase?: unknown };
    if (typeof parsed.id !== 'string' || parsed.id.trim().length === 0) {
      return null;
    }
    const phase =
      parsed.phase === 'commentary' || parsed.phase === 'final_answer' ? parsed.phase : undefined;
    return { id: parsed.id, ...(phase ? { phase } : {}) };
  } catch {
    return null;
  }
}

export function encodeAssistantTextSignature(options: {
  id?: string;
  phase?: AssistantTextPhase;
}): string | undefined {
  const id = options.id?.trim() || randomUUID();
  const payload: { v: 1; id: string; phase?: AssistantTextPhase } = { v: 1, id };
  if (options.phase) {
    payload.phase = options.phase;
  }
  return JSON.stringify(payload);
}

export function extractAssistantTextBlocksFromPiMessage(
  message: Message | undefined,
): PiAssistantTextBlock[] {
  if (!message || message.role !== 'assistant') {
    return [];
  }
  const blocks: PiAssistantTextBlock[] = [];
  for (const block of message.content) {
    if (block.type !== 'text' || typeof block.text !== 'string' || block.text.length === 0) {
      continue;
    }
    const parsedSignature = parseAssistantTextSignature(block.textSignature);
    blocks.push({
      text: block.text,
      ...(parsedSignature?.phase ? { phase: parsedSignature.phase } : {}),
      ...(typeof block.textSignature === 'string' && block.textSignature.length > 0
        ? { textSignature: block.textSignature }
        : {}),
    });
  }
  return blocks;
}

export function buildPiContext(options: {
  messages: ChatCompletionMessage[];
  tools: PiTool[];
  model: Model<Api>;
}): Context {
  const { messages, tools, model } = options;

  const systemPromptParts: string[] = [];
  const piMessages: Message[] = [];
  const toolCallNameById = new Map<string, string>();
  // When we reconstruct tool calls from ChatCompletion tool_calls (rather than
  // preserving the Pi SDK assistant message), the toolCallId might include
  // OpenAI Responses item ids (e.g. "...|fc_..."). Replaying those ids without
  // the associated reasoning item can trigger a 400 from the OpenAI provider.
  //
  // To avoid this, remap such ids to fresh call ids when we are in the
  // reconstruction path.
  const shouldRemapOpenAiResponseItemIds = model.api === 'openai-responses';
  const toolCallIdRemap = new Map<string, string>();
  const maybeRemapToolCallId = (rawId: string): string => {
    if (!shouldRemapOpenAiResponseItemIds) {
      return rawId;
    }
    if (!rawId.includes('|fc_') && !rawId.startsWith('fc_')) {
      return rawId;
    }
    const existing = toolCallIdRemap.get(rawId);
    if (existing) {
      return existing;
    }
    const next = `call_${randomUUID()}`;
    toolCallIdRemap.set(rawId, next);
    return next;
  };
  let timestamp = Date.now();
  const nextTimestamp = () => timestamp++;

  for (const message of messages) {
    if (message.role === 'system') {
      const content = message.content.trim();
      if (content) {
        systemPromptParts.push(content);
      }
      continue;
    }

    if (message.role === 'user') {
      const content = message.content.trim();
      if (!content) {
        continue;
      }
      piMessages.push({
        role: 'user',
        content,
        timestamp: nextTimestamp(),
      });
      continue;
    }

    if (message.role === 'assistant') {
      const piSdkMessage = message.piSdkMessage;
      if (piSdkMessage && piSdkMessage.role === 'assistant') {
        for (const block of piSdkMessage.content) {
          if (block.type === 'toolCall' && block.id && block.name) {
            toolCallNameById.set(block.id, block.name);
          }
        }
        piMessages.push(piSdkMessage);
        continue;
      }

      const blocks: Array<TextContent | ToolCall> = [];
      const content = message.content.trim();
      if (content) {
        const textSignature =
          message.assistantTextSignature ??
          (message.assistantTextPhase
            ? encodeAssistantTextSignature({ phase: message.assistantTextPhase })
            : undefined);
        blocks.push({
          type: 'text',
          text: content,
          ...(textSignature ? { textSignature } : {}),
        });
      }

      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          const name = call.function?.name ?? '';
          const rawId = call.id || randomUUID();
          const id = maybeRemapToolCallId(rawId);
          if (name) {
            toolCallNameById.set(id, name);
          }
          blocks.push({
            type: 'toolCall',
            id,
            name,
            arguments: parseToolArguments(call.function?.arguments ?? ''),
          });
        }
      }

      if (blocks.length === 0) {
        continue;
      }

      piMessages.push({
        role: 'assistant',
        content: blocks,
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: createEmptyUsage(),
        stopReason: 'stop',
        timestamp: nextTimestamp(),
      });
      continue;
    }

    if (message.role === 'tool') {
      const rawToolCallId = message.tool_call_id;
      const remappedToolCallId = toolCallIdRemap.get(rawToolCallId) ?? rawToolCallId;
      const toolName = toolCallNameById.get(remappedToolCallId) || 'tool';
      const isError = parseToolResultIsError(message.content);
      const toolResult: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: remappedToolCallId,
        toolName,
        content: [{ type: 'text', text: message.content }],
        isError,
        timestamp: nextTimestamp(),
      };
      piMessages.push(toolResult);
    }
  }

  const context: Context = {
    messages: piMessages,
  };

  if (systemPromptParts.length > 0) {
    context.systemPrompt = systemPromptParts.join('\n\n');
  }
  if (tools.length > 0) {
    context.tools = tools;
  }

  return context;
}

function createTimeoutSignal(options: { signal: AbortSignal; timeoutMs?: number }): {
  signal: AbortSignal;
  clear: () => void;
} {
  const { signal, timeoutMs } = options;
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal, clear: () => undefined };
  }

  if (signal.aborted) {
    return { signal, clear: () => undefined };
  }

  const controller = new AbortController();
  const abortHandler = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abortHandler, { once: true });
  const timeoutId = setTimeout(() => controller.abort('timeout'), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', abortHandler);
    },
  };
}

export async function runPiSdkChatCompletionIteration(options: {
  model: Model<Api>;
  messages: ChatCompletionMessage[];
  tools: unknown[];
  abortSignal: AbortSignal;
  onDeltaText: (
    deltaText: string,
    iterationText: string,
    phase?: AssistantTextPhase,
  ) => Promise<void> | void;
  onThinkingStart?: () => Promise<void> | void;
  onThinkingDelta?: (delta: string) => Promise<void> | void;
  onThinkingDone?: (text: string) => Promise<void> | void;
  onToolCallStart?: (info: PiToolCallStartInfo) => Promise<void> | void;
  onToolInputDelta?: (info: PiToolInputDeltaInfo) => Promise<void> | void;
  onPayload?: (payload: unknown) => void;
  onResponse?: (response: {
    message: AssistantMessage;
    text: string;
    toolCalls: ChatCompletionToolCallState[];
    thinkingText: string;
    aborted: boolean;
  }) => void;
  maxTokens?: number;
  temperature?: number;
  reasoning?: SimpleStreamOptions['reasoning'];
  apiKey?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}): Promise<{
  text: string;
  toolCalls: ChatCompletionToolCallState[];
  aborted: boolean;
  abortReason?: 'timeout' | 'aborted';
  assistantMessage: AssistantMessage;
}> {
  const {
    model,
    messages,
    tools,
    abortSignal,
    onDeltaText,
    onThinkingStart,
    onThinkingDelta,
    onThinkingDone,
    onToolCallStart,
    onToolInputDelta,
    onPayload,
    onResponse,
    maxTokens,
    temperature,
    reasoning,
    apiKey,
    baseUrl,
    headers,
    timeoutMs,
  } = options;

  const piTools = mapChatCompletionToolsToPiTools(tools);
  const resolvedModel: Model<Api> =
    baseUrl || headers
      ? {
          ...model,
          ...(baseUrl ? { baseUrl } : {}),
          ...(headers ? { headers: { ...(model.headers ?? {}), ...headers } } : {}),
        }
      : model;
  const context = buildPiContext({ messages, tools: piTools, model: resolvedModel });

  const { signal, clear } = createTimeoutSignal(
    timeoutMs === undefined ? { signal: abortSignal } : { signal: abortSignal, timeoutMs },
  );

  const streamOptions: SimpleStreamOptions = {
    ...(apiKey ? { apiKey } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(headers ? { headers } : {}),
    ...(onPayload ? { onPayload } : {}),
    ...(signal ? { signal } : {}),
  };

  let iterationText = '';
  let thinkingText = '';
  const toolCalls: ChatCompletionToolCallState[] = [];
  const seenToolCallIds = new Set<string>();
  let aborted = false;
  let abortReason: 'timeout' | 'aborted' | undefined;

  const { streamSimple } = await loadPiAiModule();
  const stream = streamSimple(resolvedModel, context, streamOptions);

  try {
    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta': {
          if (event.delta) {
            iterationText += event.delta;
            const phase = resolvedModel.api === 'openai-responses' ? 'final_answer' : undefined;
            await onDeltaText(event.delta, iterationText, phase);
          }
          break;
        }
        case 'thinking_start': {
          if (onThinkingStart) {
            await onThinkingStart();
          }
          break;
        }
        case 'thinking_delta': {
          if (event.delta) {
            thinkingText += event.delta;
            if (onThinkingDelta) {
              await onThinkingDelta(event.delta);
            }
          }
          break;
        }
        case 'thinking_end': {
          if (onThinkingDone) {
            await onThinkingDone(thinkingText);
          }
          break;
        }
        case 'toolcall_end': {
          const toolCall = event.toolCall;
          if (!toolCall || !toolCall.name) {
            break;
          }
          const id = toolCall.id || randomUUID();
          if (seenToolCallIds.has(id)) {
            break;
          }
          seenToolCallIds.add(id);

          const argumentsJson = JSON.stringify(toolCall.arguments ?? {});
          toolCalls.push({
            id,
            name: toolCall.name,
            argumentsJson,
          });

          if (onToolCallStart) {
            await onToolCallStart({ id, name: toolCall.name });
          }
          if (onToolInputDelta) {
            await onToolInputDelta({
              id,
              name: toolCall.name,
              argumentsDelta: argumentsJson,
              argumentsJson,
            });
          }
          break;
        }
        case 'error': {
          if (event.reason === 'aborted') {
            aborted = true;
            abortReason = signal.aborted && signal.reason === 'timeout' ? 'timeout' : 'aborted';
          }
          break;
        }
        default:
          break;
      }
    }
  } finally {
    clear();
  }

  const finalMessage = await stream.result();
  if (finalMessage.stopReason === 'aborted') {
    aborted = true;
    abortReason = signal.aborted && signal.reason === 'timeout' ? 'timeout' : 'aborted';
  }
  if (finalMessage.stopReason === 'error') {
    const errorMessage =
      typeof finalMessage.errorMessage === 'string' && finalMessage.errorMessage.length > 0
        ? finalMessage.errorMessage
        : 'Pi SDK chat request failed';
    throw new Error(errorMessage);
  }

  if (onResponse) {
    onResponse({
      message: finalMessage,
      text: iterationText,
      toolCalls,
      thinkingText,
      aborted,
    });
  }

  return {
    text: iterationText,
    toolCalls,
    aborted,
    ...(abortReason ? { abortReason } : {}),
    assistantMessage: finalMessage,
  };
}
