import { randomUUID } from 'node:crypto';

import {
  getModels,
  getProviders,
  streamSimple,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type Tool as PiTool,
  type SimpleStreamOptions,
  type Message,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
  type Usage,
} from '@mariozechner/pi-ai';

import type { ChatCompletionMessage, ChatCompletionToolCallState } from '../chatCompletionTypes';

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

function resolveProviderId(providerRaw: string): string | undefined {
  const trimmed = providerRaw.trim();
  if (!trimmed) {
    return undefined;
  }
  const target = trimmed.toLowerCase();
  const providers = getProviders();
  const match = providers.find((provider) => provider.toLowerCase() === target);
  return match ?? trimmed;
}

export function resolvePiSdkModel(options: {
  modelSpec: string;
  defaultProvider?: string;
}): PiSdkModelResolution {
  const { modelSpec, defaultProvider } = options;
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
    throw new Error(
      'Pi chat requires provider/model format when chat.config.provider is not set',
    );
  }

  const providerId = resolveProviderId(providerRaw);
  if (!providerId) {
    throw new Error(`Pi chat provider "${providerRaw}" is not available`);
  }

  const models = getModels(providerId as any);
  if (!models || models.length === 0) {
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
        blocks.push({ type: 'text', text: content });
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

function createTimeoutSignal(options: {
  signal: AbortSignal;
  timeoutMs?: number;
}): { signal: AbortSignal; clear: () => void } {
  const { signal, timeoutMs } = options;
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return { signal, clear: () => undefined };
  }

  if (signal.aborted) {
    return { signal, clear: () => undefined };
  }

  const controller = new AbortController();
  const abortHandler = () => controller.abort();
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
  onDeltaText: (deltaText: string, iterationText: string) => Promise<void> | void;
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

  const stream = streamSimple(resolvedModel, context, streamOptions);

  try {
    for await (const event of stream) {
      switch (event.type) {
        case 'text_delta': {
          if (event.delta) {
            iterationText += event.delta;
            await onDeltaText(event.delta, iterationText);
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
    assistantMessage: finalMessage,
  };
}
