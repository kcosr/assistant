import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  AssistantTextPhase,
  ChatEvent,
  ServerMessage,
  ServerTextDeltaMessage,
  ServerThinkingDeltaMessage,
  ServerThinkingDoneMessage,
  ServerThinkingStartMessage,
  ServerToolCallStartMessage,
  ServerToolResultMessage,
} from '@assistant/shared';

import type { AgentDefinition, PiSdkChatConfig } from './agents';
import type {
  ChatCompletionMessage,
  ChatCompletionToolCallMessageToolCall,
  ChatCompletionToolCallState,
} from './chatCompletionTypes';
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type ThinkingLevel as PiAgentThinkingLevel,
} from '@mariozechner/pi-agent-core';
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  type Message as PiSdkMessage,
  type Model,
  type TextContent,
  type ToolCall,
  type ToolResultMessage,
} from '@mariozechner/pi-ai';
import type { EnvConfig } from './envConfig';
import type { EventStore } from './events';
import {
  appendAndBroadcastChatEvents,
  createChatEventBase,
  emitToolCallEvent,
  emitToolInputChunkEvent,
  emitToolOutputChunkEvent,
  emitToolResultEvent,
} from './events/chatEventUtils';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { TtsBackendFactory, TtsStreamingSession } from './tts/types';
import { getCodexSessionStore } from './codexSessionStore';

import {
  resolveCliModelForRun,
  resolveSessionModelForRun,
  resolveSessionThinkingForRun,
} from './sessionModel';
import { createCliToolCallbacks } from './ws/cliCallbackFactory';
import { runClaudeCliChat, type ClaudeCliChatConfig } from './ws/claudeCliChat';
import { runCodexCliChat, type CodexCliChatConfig } from './ws/codexCliChat';
import { resolveCliRuntimeConfig } from './ws/cliRuntimeConfig';
import { runPiCliChat, type PiCliChatConfig, type PiSessionInfo } from './ws/piCliChat';
import { buildProviderAttributesPatch, getProviderAttributes } from './history/providerAttributes';
import { loadCanonicalPiReplayMessages } from './history/piSessionReplay';
import {
  parseAssistantTextSignature,
  resolvePiSdkModel,
  resolvePiSdkAuthApiKey,
} from './llm/piSdkProvider';
import {
  extractSessionContextUsageFromAssistantMessage,
  isSessionContextUsageEqual,
} from './contextUsage';
import type { AgentTool as NativeAgentTool } from './tools';

type ChatProvider = 'pi' | 'claude-cli' | 'codex-cli' | 'pi-cli';
type OutputModeValue = 'text' | 'speech' | 'both';
type PiAiModule = typeof import('@mariozechner/pi-ai');

let piAiModulePromise: Promise<PiAiModule> | null = null;

async function loadPiAiModule(): Promise<PiAiModule> {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@mariozechner/pi-ai');
  }
  return piAiModulePromise;
}

function extractToolOutputText(result: unknown): string {
  if (typeof result === 'string') {
    return result;
  }
  if (!result || typeof result !== 'object') {
    return '';
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return '';
  }
  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const typedBlock = block as { type?: unknown; text?: unknown };
    if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
      chunks.push(typedBlock.text);
    }
  }
  return chunks.join('');
}

function computeToolOutputDelta(previousText: string, nextText: string): string {
  if (!nextText) {
    return '';
  }
  if (!previousText) {
    return nextText;
  }
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length);
  }
  const maxOverlap = Math.min(previousText.length, nextText.length, 8192);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previousText.slice(-overlap) === nextText.slice(0, overlap)) {
      return nextText.slice(overlap);
    }
  }
  return nextText;
}

export interface ChatRunOutputAdapter {
  send: (message: ServerMessage) => void;
}

export function createBroadcastOutputAdapter(
  sessionHub: SessionHub,
  sessionId: string,
): ChatRunOutputAdapter {
  return {
    send: (message) => {
      sessionHub.broadcastToSession(sessionId, message);
    },
  };
}

export interface ChatRunCoreOptions {
  sessionId: string;
  state: LogicalSessionState;
  text: string;
  requestId?: string;
  responseId: string;
  agent?: AgentDefinition;
  provider: ChatProvider;
  envConfig: EnvConfig;
  chatCompletionTools: unknown[];
  agentTools?: NativeAgentTool[];
  handleChatToolCalls: (
    sessionId: string,
    state: LogicalSessionState,
    toolCalls: ChatCompletionToolCallState[],
  ) => Promise<void>;
  sessionHub: SessionHub;
  output: ChatRunOutputAdapter;
  abortController: AbortController;
  eventStore?: EventStore;
  turnId?: string;
  shouldEmitChatEvents: boolean;
  includeAgentExchangeIdInMessages: boolean;
  trackTextStartedAt: boolean;
  onToolCallMetric?: (toolName: string, durationMs: number) => void;
  debugChatCompletionsContext?: unknown;
  log: (...args: unknown[]) => void;
}

export interface ChatRunCoreResult {
  fullText: string;
  thinkingText: string;
  provider: ChatProvider;
  aborted: boolean;
  abortReason?: 'timeout' | 'aborted';
  piSdkMessage?: PiSdkMessage;
  piReplayMessages?: ChatCompletionMessage[];
  piBaseReplayMessages?: ChatCompletionMessage[];
}

export class ChatRunError extends Error {
  code: string;
  details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function isChatRunError(err: unknown): err is ChatRunError {
  return err instanceof ChatRunError;
}

const DEFAULT_PI_REQUEST_TIMEOUT_MS = 300_000;

function isPiReasoningLevel(
  value: string,
): value is 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' {
  return (
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
  );
}

const SENSITIVE_DEBUG_KEYS = new Set([
  'apikey',
  'api_key',
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'openai-api-key',
  'anthropic-api-key',
  'anthropic-oauth-token',
]);

const debugChatCompletionLogWrites = new Map<string, Promise<void>>();

function redactDebugPayload(value: unknown): unknown {
  const seen = new WeakSet<object>();

  const redactHeaders = (headers: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [key, headerValue] of Object.entries(headers)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_DEBUG_KEYS.has(lower)) {
        result[key] = '[redacted]';
      } else {
        result[key] = headerValue;
      }
    }
    return result;
  };

  const redactValue = (input: unknown, key?: string): unknown => {
    if (typeof input === 'string') {
      if (key?.toLowerCase() === 'data' && input.length > 200) {
        return `[base64 ${input.length} chars]`;
      }
      return input;
    }

    if (!input || typeof input !== 'object') {
      return input;
    }

    if (seen.has(input)) {
      return '[Circular]';
    }
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map((item) => redactValue(item));
    }

    const result: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(input)) {
      const lower = childKey.toLowerCase();
      if (SENSITIVE_DEBUG_KEYS.has(lower)) {
        result[childKey] = '[redacted]';
        continue;
      }
      if (lower === 'headers' && childValue && typeof childValue === 'object') {
        result[childKey] = redactHeaders(childValue as Record<string, unknown>);
        continue;
      }
      result[childKey] = redactValue(childValue, childKey);
    }
    return result;
  };

  return redactValue(value);
}

export function formatDebugPayloadForLog(value: unknown): string {
  return JSON.stringify(redactDebugPayload(value), null, 2);
}

export function getDebugChatCompletionsLogPath(dataDir: string): string {
  return path.join(dataDir, 'logs', 'chat-completions.jsonl');
}

export async function appendDebugChatCompletionsLogRecord(options: {
  dataDir: string;
  record: unknown;
}): Promise<string> {
  const filePath = getDebugChatCompletionsLogPath(options.dataDir);
  const line = `${JSON.stringify(redactDebugPayload(options.record))}\n`;
  const previous = debugChatCompletionLogWrites.get(filePath) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, line, 'utf8');
    });
  debugChatCompletionLogWrites.set(filePath, next);
  await next;
  if (debugChatCompletionLogWrites.get(filePath) === next) {
    debugChatCompletionLogWrites.delete(filePath);
  }
  return filePath;
}

export function previewDebugText(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > 160 ? `${singleLine.slice(0, 157)}...` : singleLine;
}

export function logDebugChatEventRecord(options: {
  enabled: boolean;
  dataDir?: string;
  log: (...args: unknown[]) => void;
  record: unknown;
}): void {
  const { enabled, dataDir, log, record } = options;
  if (!enabled || !dataDir) {
    return;
  }
  log('chat event debug', formatDebugPayloadForLog(record));
  void appendDebugChatCompletionsLogRecord({ dataDir, record }).catch((error) => {
    log('failed to write chat event debug log', String(error));
  });
}

export function resolveChatProvider(agent?: AgentDefinition): {
  agentType: 'chat' | 'external';
  provider: ChatProvider;
} {
  const agentType = agent?.type ?? 'chat';
  const provider = agent?.chat?.provider ?? 'pi';
  return { agentType, provider };
}

export function createTtsSession(options: {
  sessionId: string;
  responseId: string;
  abortSignal: AbortSignal;
  outputMode: OutputModeValue;
  ttsBackendFactory?: TtsBackendFactory | null;
  clientAudioCapabilities?: { audioOut?: boolean };
}): TtsStreamingSession | undefined {
  const {
    sessionId,
    responseId,
    abortSignal,
    outputMode,
    ttsBackendFactory,
    clientAudioCapabilities,
  } = options;

  if (
    !ttsBackendFactory ||
    !ttsBackendFactory.isEnabled() ||
    !clientAudioCapabilities?.audioOut ||
    (outputMode !== 'speech' && outputMode !== 'both')
  ) {
    return undefined;
  }

  return (
    ttsBackendFactory.createSession({
      sessionId,
      responseId,
      abortSignal,
    }) ?? undefined
  );
}

function getAgentExchangeId(
  state: LogicalSessionState,
  getAgentExchangeIdFn?: () => string | undefined,
): string | undefined {
  if (getAgentExchangeIdFn) {
    return getAgentExchangeIdFn();
  }
  return state.activeChatRun?.agentExchangeId;
}

function getRequestId(
  state: LogicalSessionState,
  requestId?: string,
  responseId?: string,
): string | undefined {
  return requestId ?? state.activeChatRun?.requestId ?? responseId;
}

function createRequestPayload(requestId?: string): {} | { requestId: string } {
  return requestId ? { requestId } : {};
}

function createChatRunStreamHandlers(options: {
  sessionId: string;
  state: LogicalSessionState;
  requestId?: string;
  responseId: string;
  provider: ChatProvider;
  output: ChatRunOutputAdapter;
  eventStore?: EventStore;
  sessionHub: SessionHub;
  shouldEmitChatEvents: boolean;
  turnId?: string;
  includeAgentExchangeIdInMessages: boolean;
  trackTextStartedAt: boolean;
  debugChatCompletions?: boolean;
  debugChatCompletionsContext?: unknown;
  debugDataDir?: string;
  log: (...args: unknown[]) => void;
  getAgentExchangeId?: () => string | undefined;
}) {
  const {
    sessionId,
    state,
    requestId,
    responseId,
    provider,
    output,
    eventStore,
    sessionHub,
    shouldEmitChatEvents,
    turnId,
    includeAgentExchangeIdInMessages,
    trackTextStartedAt,
    debugChatCompletions,
    debugChatCompletionsContext,
    debugDataDir,
    log,
    getAgentExchangeId: getAgentExchangeIdFn,
  } = options;

  let thinkingText = '';
  let thinkingStarted = false;
  const requestPayload = createRequestPayload(getRequestId(state, requestId, responseId));

  const buildAgentExchangePayload = (): { agentExchangeId?: string } => {
    const agentExchangeId = getAgentExchangeId(state, getAgentExchangeIdFn);
    if (includeAgentExchangeIdInMessages && agentExchangeId) {
      return { agentExchangeId };
    }
    return {};
  };

  const recordAssistantChunk = (
    deltaText: string,
    accumulatedText: string,
    phase?: AssistantTextPhase,
  ): void => {
    logDebugChatEventRecord({
      enabled: Boolean(debugChatCompletions),
      log,
      ...(debugDataDir ? { dataDir: debugDataDir } : {}),
      record: {
        timestamp: new Date().toISOString(),
        direction: 'event',
        eventType: 'assistant_chunk',
        provider,
        sessionId,
        responseId,
        ...(turnId ? { turnId } : {}),
        ...(debugChatCompletionsContext !== undefined
          ? { debugContext: debugChatCompletionsContext }
          : {}),
        phase: phase ?? null,
        textLength: deltaText.length,
        textPreview: previewDebugText(deltaText),
        accumulatedTextLength: accumulatedText.length,
        accumulatedTextPreview: previewDebugText(accumulatedText),
      },
    });
  };

  const emitThinkingStart = async (): Promise<void> => {
    if (thinkingStarted) {
      return;
    }
    thinkingStarted = true;
    thinkingText = '';
    if (state.activeChatRun) {
      state.activeChatRun.outputStarted = true;
    }
    const message: ServerThinkingStartMessage = {
      type: 'thinking_start',
      responseId,
      ...requestPayload,
      ...buildAgentExchangePayload(),
    };
    output.send(message);
  };

  const emitThinkingDelta = async (delta: string): Promise<void> => {
    if (!delta) {
      return;
    }
    if (!thinkingStarted) {
      await emitThinkingStart();
    }
    thinkingText += delta;
    const message: ServerThinkingDeltaMessage = {
      type: 'thinking_delta',
      responseId,
      delta,
      ...requestPayload,
      ...buildAgentExchangePayload(),
    };
    output.send(message);

    if (shouldEmitChatEvents && turnId) {
      const events: ChatEvent[] = [
        {
          ...createChatEventBase({
            sessionId,
            ...(turnId ? { turnId } : {}),
            responseId,
          }),
          type: 'thinking_chunk',
          payload: { text: delta },
        },
      ];
      void appendAndBroadcastChatEvents(
        {
          ...(eventStore ? { eventStore } : {}),
          sessionHub,
          sessionId,
        },
        events,
      );
    }
  };

  const emitThinkingDone = async (textValue: string): Promise<void> => {
    const finalText = textValue || thinkingText;
    if (!thinkingStarted && !finalText) {
      return;
    }
    if (!thinkingStarted && finalText) {
      await emitThinkingStart();
    }
    thinkingText = finalText;
    const message: ServerThinkingDoneMessage = {
      type: 'thinking_done',
      responseId,
      text: finalText,
      ...requestPayload,
      ...buildAgentExchangePayload(),
    };
    output.send(message);

    if (shouldEmitChatEvents && turnId) {
      const events: ChatEvent[] = [
        {
          ...createChatEventBase({
            sessionId,
            ...(turnId ? { turnId } : {}),
            responseId,
          }),
          type: 'thinking_done',
          payload: { text: finalText },
        },
      ];
      void appendAndBroadcastChatEvents(
        {
          ...(eventStore ? { eventStore } : {}),
          sessionHub,
          sessionId,
        },
        events,
      );
    }

    thinkingStarted = false;
    thinkingText = '';
  };

  const emitTextDelta = async (
    deltaText: string,
    textSoFar: string,
    phase?: AssistantTextPhase,
  ): Promise<void> => {
    if (state.activeChatRun) {
      state.activeChatRun.accumulatedText = textSoFar;
      state.activeChatRun.outputStarted = true;
      if (trackTextStartedAt && !state.activeChatRun.textStartedAt) {
        state.activeChatRun.textStartedAt = new Date().toISOString();
      }
    }

    const message: ServerTextDeltaMessage = {
      type: 'text_delta',
      responseId,
      delta: deltaText,
      ...(phase ? { phase } : {}),
      ...requestPayload,
      ...buildAgentExchangePayload(),
    };
    output.send(message);
    recordAssistantChunk(deltaText, textSoFar, phase);

    if (shouldEmitChatEvents && turnId) {
      const events: ChatEvent[] = [
        {
          ...createChatEventBase({
            sessionId,
            ...(turnId ? { turnId } : {}),
            responseId,
          }),
          type: 'assistant_chunk',
          payload: {
            text: deltaText,
            ...(phase ? { phase } : {}),
          },
        },
      ];
      void appendAndBroadcastChatEvents(
        {
          ...(eventStore ? { eventStore } : {}),
          sessionHub,
          sessionId,
        },
        events,
      );
    }

    const activeRun = state.activeChatRun;
    const runTtsSession = activeRun?.ttsSession;
    if (runTtsSession && activeRun.responseId === responseId) {
      try {
        await runTtsSession.appendText(deltaText);
      } catch (err) {
        log('tts appendText error', err);
      }
    }
  };

  return {
    emitThinkingStart,
    emitThinkingDelta,
    emitThinkingDone,
    emitTextDelta,
    getThinkingText: () => thinkingText,
  };
}

function createEmptyUsage() {
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

function parseToolCallArguments(argumentsJson: string): Record<string, unknown> {
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
    // Fall through to empty arguments.
  }
  return {};
}

function stringifyToolCallArguments(args: unknown): string {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return '{}';
  }
}

function parseToolResultErrorState(content: string): boolean {
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
    // Ignore parse errors.
  }
  return false;
}

function getMessageTimestampMs(message: Exclude<ChatCompletionMessage, { role: 'system' }>): number {
  return message.historyTimestampMs ?? Date.now();
}

function buildSyntheticAssistantMessage(options: {
  message: Extract<ChatCompletionMessage, { role: 'assistant' }>;
  model: Model<any>;
}): AssistantMessage {
  const { message, model } = options;
  const content: Array<TextContent | ToolCall> = [];
  if (message.content.trim()) {
    content.push({
      type: 'text',
      text: message.content,
      ...(message.assistantTextSignature ? { textSignature: message.assistantTextSignature } : {}),
    });
  }
  for (const toolCall of message.tool_calls ?? []) {
    content.push({
      type: 'toolCall',
      id: toolCall.id,
      name: toolCall.function.name,
      arguments: parseToolCallArguments(toolCall.function.arguments),
    });
  }
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: createEmptyUsage(),
    stopReason: message.tool_calls?.length ? 'toolUse' : 'stop',
    timestamp: getMessageTimestampMs(message),
  };
}

function buildToolNameIndex(messages: ChatCompletionMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      if (message.piSdkMessage?.role === 'assistant') {
        for (const block of message.piSdkMessage.content) {
          if (block.type === 'toolCall') {
            names.set(block.id, block.name);
          }
        }
      }
      for (const toolCall of message.tool_calls ?? []) {
        names.set(toolCall.id, toolCall.function.name);
      }
    }
  }
  return names;
}

function toPiAgentMessage(options: {
  message: Exclude<ChatCompletionMessage, { role: 'system' }>;
  toolNameIndex: Map<string, string>;
  model: Model<any>;
}): AgentMessage {
  const { message, toolNameIndex, model } = options;
  if (message.role === 'user') {
    return {
      role: 'user',
      content: message.content,
      timestamp: getMessageTimestampMs(message),
    };
  }
  if (message.role === 'assistant') {
    return message.piSdkMessage && message.piSdkMessage.role === 'assistant'
      ? message.piSdkMessage
      : buildSyntheticAssistantMessage({ message, model });
  }
  return {
    role: 'toolResult',
    toolCallId: message.tool_call_id,
    toolName: toolNameIndex.get(message.tool_call_id) ?? 'tool',
    content: message.content.trim() ? [{ type: 'text', text: message.content }] : [],
    details: undefined,
    isError: parseToolResultErrorState(message.content),
    timestamp: getMessageTimestampMs(message),
  };
}

function buildPiAgentContext(options: {
  messages: ChatCompletionMessage[];
  text: string;
  model: Model<any>;
}): {
  systemPrompt: string;
  contextMessages: AgentMessage[];
  promptMessage: AgentMessage;
} {
  const { messages, text, model } = options;
  const systemPrompt = messages[0]?.role === 'system' ? messages[0].content : '';
  const nonSystemMessages = (messages[0]?.role === 'system' ? messages.slice(1) : messages.slice())
    .filter((message): message is Exclude<ChatCompletionMessage, { role: 'system' }> => message.role !== 'system');
  const lastMessage = nonSystemMessages[nonSystemMessages.length - 1];
  const toolNameIndex = buildToolNameIndex(nonSystemMessages);
  const promptSource =
    lastMessage?.role === 'user' && lastMessage.content === text ? lastMessage : undefined;
  const contextSource = promptSource ? nonSystemMessages.slice(0, -1) : nonSystemMessages;
  const contextMessages = contextSource.map((message) =>
    toPiAgentMessage({
      message,
      toolNameIndex,
      model,
    }),
  );
  const promptMessage: AgentMessage = promptSource
    ? toPiAgentMessage({
        message: promptSource,
        toolNameIndex,
        model,
      })
    : {
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
  return {
    systemPrompt,
    contextMessages,
    promptMessage,
  };
}

function appendAssistantToolCallMessage(
  target: ChatCompletionMessage[],
  message: AssistantMessage,
): void {
  const textBlocks = message.content.filter((block): block is TextContent => block.type === 'text');
  const toolCalls = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
  if (toolCalls.length === 0) {
    return;
  }
  target.push({
    role: 'assistant',
    content: textBlocks.map((block) => block.text).join(''),
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function',
      function: {
        name: toolCall.name,
        arguments: stringifyToolCallArguments(toolCall.arguments),
      },
    })),
    historyTimestampMs: message.timestamp,
    piSdkMessage: message,
  });
}

function appendToolResultMessage(
  target: ChatCompletionMessage[],
  message: ToolResultMessage,
): void {
  const text = message.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('');
  target.push({
    role: 'tool',
    tool_call_id: message.toolCallId,
    content: text,
    historyTimestampMs: message.timestamp,
  });
}

export async function runChatCompletionCore(
  options: ChatRunCoreOptions,
): Promise<ChatRunCoreResult> {
  const {
    sessionId,
    state,
    text,
    requestId,
    responseId,
    agent,
    provider,
    envConfig,
    chatCompletionTools,
    agentTools = [],
    handleChatToolCalls,
    sessionHub,
    output,
    abortController,
    eventStore,
    turnId,
    shouldEmitChatEvents,
    includeAgentExchangeIdInMessages,
    trackTextStartedAt,
    onToolCallMetric,
    debugChatCompletionsContext,
    log,
  } = options;

  const getAgentExchangeIdFn = () => state.activeChatRun?.agentExchangeId;
  const requestIdValue = getRequestId(state, requestId, responseId);
  const requestPayload = createRequestPayload(requestIdValue);
  const streamHandlers = createChatRunStreamHandlers({
    sessionId,
    state,
    responseId,
    provider,
    output,
    sessionHub,
    shouldEmitChatEvents,
    includeAgentExchangeIdInMessages,
    trackTextStartedAt,
    debugChatCompletions: envConfig.debugChatCompletions,
    debugChatCompletionsContext,
    debugDataDir: envConfig.dataDir,
    log,
    getAgentExchangeId: getAgentExchangeIdFn,
    ...requestPayload,
    ...(eventStore ? { eventStore } : {}),
    ...(turnId ? { turnId } : {}),
  });

  let fullText = '';
  let aborted = false;
  let abortReason: 'timeout' | 'aborted' | undefined;
  let finalPiSdkMessage: PiSdkMessage | undefined;
  let lastPiSdkMessage: PiSdkMessage | undefined;
  let piReplayMessages: ChatCompletionMessage[] | undefined;
  let piBaseReplayMessages: ChatCompletionMessage[] | undefined;

  if (provider === 'claude-cli') {
    const claudeConfig = resolveCliRuntimeConfig(
      agent?.chat?.config as ClaudeCliChatConfig | undefined,
      {
        sessionId,
        ...(state.summary.attributes?.core?.workingDir
          ? { workingDir: state.summary.attributes.core.workingDir }
          : {}),
      },
    );
    const attributes = state.summary.attributes;
    let storedClaudeSession: { sessionId?: string; cwd?: string } | null = null;
    const providerInfo = getProviderAttributes(attributes, 'claude-cli', ['claude']);
    if (providerInfo) {
      const rawSessionId = providerInfo['sessionId'];
      const rawCwd = providerInfo['cwd'];
      storedClaudeSession = {
        ...(typeof rawSessionId === 'string' && rawSessionId.trim().length > 0
          ? { sessionId: rawSessionId.trim() }
          : {}),
        ...(typeof rawCwd === 'string' && rawCwd.trim().length > 0 ? { cwd: rawCwd.trim() } : {}),
      };
    }
    const resumeSession = Boolean(storedClaudeSession?.sessionId);
    const resolvedCwd = claudeConfig?.workdir?.trim() || os.homedir() || process.cwd();
    const resolvedSessionId = storedClaudeSession?.sessionId?.trim() || sessionId.trim();
    const nextCwd = resolvedCwd && resolvedCwd.trim().length > 0 ? resolvedCwd.trim() : undefined;
    const model = resolveCliModelForRun({ agent, summary: state.summary });
    const thinking = resolveSessionThinkingForRun({ agent, summary: state.summary });

    if (resolvedSessionId && nextCwd) {
      const currentSessionId = storedClaudeSession?.sessionId ?? '';
      const currentCwd = storedClaudeSession?.cwd ?? undefined;
      if (resolvedSessionId !== currentSessionId || nextCwd !== currentCwd) {
        try {
          const providerPatch = buildProviderAttributesPatch('claude-cli', {
            sessionId: resolvedSessionId,
            cwd: nextCwd,
          });
          await sessionHub.updateSessionAttributes(sessionId, providerPatch);
          storedClaudeSession = { sessionId: resolvedSessionId, cwd: nextCwd };
        } catch (err) {
          log('failed to persist Claude session mapping (pre-run)', err);
        }
      }
    }

    const claudeCallbacks = createCliToolCallbacks({
      sessionId,
      responseId,
      sessionHub,
      sendMessage: output.send,
      log,
      eventStore,
      turnId,
      shouldEmitChatEvents,
      getAgentExchangeId: getAgentExchangeIdFn,
      providerName: 'Claude CLI',
      ...requestPayload,
      ...(onToolCallMetric ? { onToolCallMetric } : {}),
    });

    const { text: claudeText, aborted: cliAborted } = await runClaudeCliChat({
      sessionId: resolvedSessionId,
      resumeSession,
      userText: text,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(claudeConfig ? { config: claudeConfig } : {}),
      abortSignal: abortController.signal,
      onTextDelta: streamHandlers.emitTextDelta,
      onThinkingStart: streamHandlers.emitThinkingStart,
      onThinkingDelta: streamHandlers.emitThinkingDelta,
      onThinkingDone: streamHandlers.emitThinkingDone,
      onToolCallStart: claudeCallbacks.onToolCallStart,
      onToolResult: claudeCallbacks.onToolResult,
      log,
    });

    if (resolvedSessionId && nextCwd) {
      const currentSessionId = storedClaudeSession?.sessionId ?? '';
      const currentCwd = storedClaudeSession?.cwd ?? undefined;
      if (resolvedSessionId !== currentSessionId || nextCwd !== currentCwd) {
        try {
          const providerPatch = buildProviderAttributesPatch('claude-cli', {
            sessionId: resolvedSessionId,
            cwd: nextCwd,
          });
          await sessionHub.updateSessionAttributes(sessionId, providerPatch);
          storedClaudeSession = { sessionId: resolvedSessionId, cwd: nextCwd };
        } catch (err) {
          log('failed to persist Claude session mapping', err);
        }
      }
    }

    aborted = cliAborted;
    fullText = claudeText;
  } else if (provider === 'codex-cli') {
    const codexConfig = resolveCliRuntimeConfig(
      agent?.chat?.config as CodexCliChatConfig | undefined,
      {
        sessionId,
        ...(state.summary.attributes?.core?.workingDir
          ? { workingDir: state.summary.attributes.core.workingDir }
          : {}),
      },
    );
    const attributes = state.summary.attributes;
    let storedCodexSession: { sessionId?: string; cwd?: string } | null = null;
    const providerInfo = getProviderAttributes(attributes, 'codex-cli', ['codex']);
    if (providerInfo) {
      const rawSessionId = providerInfo['sessionId'];
      const rawCwd = providerInfo['cwd'];
      storedCodexSession = {
        ...(typeof rawSessionId === 'string' && rawSessionId.trim().length > 0
          ? { sessionId: rawSessionId.trim() }
          : {}),
        ...(typeof rawCwd === 'string' && rawCwd.trim().length > 0 ? { cwd: rawCwd.trim() } : {}),
      };
    }

    const codexSessionStore = getCodexSessionStore(envConfig.dataDir);
    let existingCodexSessionId: string | undefined;

    try {
      const existingMapping = await codexSessionStore.get(sessionId);
      existingCodexSessionId = existingMapping?.codexSessionId;
    } catch (err) {
      log('failed to load Codex session mapping', err);
    }

    const codexCallbacks = createCliToolCallbacks({
      sessionId,
      responseId,
      sessionHub,
      sendMessage: output.send,
      log,
      eventStore,
      turnId,
      shouldEmitChatEvents,
      getAgentExchangeId: getAgentExchangeIdFn,
      providerName: 'Codex CLI',
      ...requestPayload,
      ...(onToolCallMetric ? { onToolCallMetric } : {}),
    });
    const model = resolveCliModelForRun({ agent, summary: state.summary });
    const thinking = resolveSessionThinkingForRun({ agent, summary: state.summary });

    let syncedCodexSessionId = existingCodexSessionId;
    const syncCodexSessionId = async (nextId: string): Promise<void> => {
      const trimmed = nextId.trim();
      if (!trimmed || trimmed === syncedCodexSessionId) {
        return;
      }
      syncedCodexSessionId = trimmed;
      try {
        await codexSessionStore.set({
          sessionId,
          codexSessionId: trimmed,
          ...(codexConfig?.workdir ? { workdir: codexConfig.workdir } : {}),
        });
      } catch (err) {
        log('failed to persist Codex session mapping', err);
      }

      const nextCwd = codexConfig?.workdir?.trim() || undefined;
      const currentSessionId = storedCodexSession?.sessionId ?? '';
      const currentCwd = storedCodexSession?.cwd ?? undefined;
      if (trimmed !== currentSessionId || nextCwd !== currentCwd) {
        try {
          const providerPatch = buildProviderAttributesPatch(
            'codex-cli',
            {
              sessionId: trimmed,
              ...(nextCwd ? { cwd: nextCwd } : {}),
            },
            ['codex'],
          );
          await sessionHub.updateSessionAttributes(sessionId, providerPatch);
          storedCodexSession = { sessionId: trimmed, ...(nextCwd ? { cwd: nextCwd } : {}) };
        } catch (err) {
          log('failed to persist Codex session mapping', err);
        }
      }
    };

    const {
      text: codexText,
      aborted: cliAborted,
      codexSessionId,
    } = await runCodexCliChat({
      ourSessionId: sessionId,
      existingCodexSessionId,
      userText: text,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(codexConfig ? { config: codexConfig } : {}),
      abortSignal: abortController.signal,
      onTextDelta: streamHandlers.emitTextDelta,
      onThinkingStart: streamHandlers.emitThinkingStart,
      onThinkingDelta: streamHandlers.emitThinkingDelta,
      onThinkingDone: streamHandlers.emitThinkingDone,
      onToolCallStart: codexCallbacks.onToolCallStart,
      onToolResult: codexCallbacks.onToolResult,
      onSessionId: syncCodexSessionId,
      log,
    });

    if (codexSessionId) {
      await syncCodexSessionId(codexSessionId);
    }

    aborted = cliAborted;
    fullText = codexText;
  } else if (provider === 'pi-cli') {
    const piConfig = resolveCliRuntimeConfig(agent?.chat?.config as PiCliChatConfig | undefined, {
      sessionId,
      ...(state.summary.attributes?.core?.workingDir
        ? { workingDir: state.summary.attributes.core.workingDir }
        : {}),
    });
    const attributes = state.summary.attributes;
    let storedPiSession: { sessionId?: string; cwd?: string } | null = null;
    const providerInfo = getProviderAttributes(attributes, 'pi-cli', ['pi']);
    if (providerInfo) {
      const rawSessionId = providerInfo['sessionId'];
      const rawCwd = providerInfo['cwd'];
      storedPiSession = {
        ...(typeof rawSessionId === 'string' && rawSessionId.trim().length > 0
          ? { sessionId: rawSessionId.trim() }
          : {}),
        ...(typeof rawCwd === 'string' && rawCwd.trim().length > 0
          ? { cwd: rawCwd.trim() }
          : {}),
      };
    }
    const resumeSessionId = storedPiSession?.sessionId;
    const model = resolveCliModelForRun({ agent, summary: state.summary });
    const thinking = resolveSessionThinkingForRun({ agent, summary: state.summary });

    const piCallbacks = createCliToolCallbacks({
      sessionId,
      responseId,
      sessionHub,
      sendMessage: output.send,
      log,
      eventStore,
      turnId,
      shouldEmitChatEvents,
      getAgentExchangeId: getAgentExchangeIdFn,
      providerName: 'Pi CLI',
      ...requestPayload,
      ...(onToolCallMetric ? { onToolCallMetric } : {}),
    });

    const emitPiToolOutputChunk = (
      callId: string,
      toolName: string,
      chunk: string,
      offset: number,
      stream?: 'stdout' | 'stderr' | 'output',
    ): void => {
      emitToolOutputChunkEvent({
        sessionHub,
        sessionId,
        ...(turnId ? { turnId } : {}),
        ...(responseId ? { responseId } : {}),
        toolCallId: callId,
        toolName,
        chunk,
        offset,
        ...(stream ? { stream } : {}),
      });
    };

    const syncPiSessionInfo = async (info: PiSessionInfo): Promise<void> => {
      const nextSessionId =
        typeof info.sessionId === 'string' && info.sessionId.trim().length > 0
          ? info.sessionId.trim()
          : '';
      if (!nextSessionId) {
        return;
      }
      const nextCwd =
        typeof info.cwd === 'string' && info.cwd.trim().length > 0 ? info.cwd.trim() : undefined;
      const currentSessionId = storedPiSession?.sessionId ?? '';
      const currentCwd = storedPiSession?.cwd ?? undefined;
      if (nextSessionId === currentSessionId && nextCwd === currentCwd) {
        return;
      }
      storedPiSession = { sessionId: nextSessionId, ...(nextCwd ? { cwd: nextCwd } : {}) };
      try {
        const providerPatch = buildProviderAttributesPatch('pi-cli', {
          sessionId: nextSessionId,
          ...(nextCwd ? { cwd: nextCwd } : {}),
        });
        await sessionHub.updateSessionAttributes(sessionId, providerPatch);
      } catch (err) {
        log('failed to persist Pi session mapping', err);
      }
    };

    const { text: piText, aborted: cliAborted } = await runPiCliChat({
      sessionId,
      ...(resumeSessionId ? { piSessionId: resumeSessionId } : {}),
      userText: text,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(piConfig ? { config: piConfig } : {}),
      abortSignal: abortController.signal,
      onTextDelta: streamHandlers.emitTextDelta,
      onThinkingStart: streamHandlers.emitThinkingStart,
      onThinkingDelta: streamHandlers.emitThinkingDelta,
      onThinkingDone: streamHandlers.emitThinkingDone,
      onToolCallStart: piCallbacks.onToolCallStart,
      onToolResult: piCallbacks.onToolResult,
      onToolOutputChunk: emitPiToolOutputChunk,
      onSessionInfo: syncPiSessionInfo,
      log,
    });

    aborted = cliAborted;
    fullText = piText;
  } else if (provider === 'pi') {
    const piConfig = agent?.chat?.config as PiSdkChatConfig | undefined;
    const maxToolIterations = piConfig?.maxToolIterations ?? 100;
    const modelSpec = resolveSessionModelForRun({ agent, summary: state.summary });
    if (!modelSpec) {
      throw new ChatRunError(
        'agent_config_error',
        'Pi chat requires at least one model in chat.models or a session override.',
      );
    }

    let resolvedModel: Awaited<ReturnType<typeof resolvePiSdkModel>>;
    try {
      const defaultProvider = piConfig?.provider;
      resolvedModel =
        defaultProvider === undefined
          ? await resolvePiSdkModel({ modelSpec, ...(piConfig?.baseUrl ? { baseUrl: piConfig.baseUrl } : {}) })
          : await resolvePiSdkModel({
              modelSpec,
              defaultProvider,
              ...(piConfig?.baseUrl ? { baseUrl: piConfig.baseUrl } : {}),
            });
    } catch (err) {
      throw new ChatRunError(
        'agent_config_error',
        err instanceof Error ? err.message : 'Failed to resolve Pi model',
      );
    }

    const thinking = resolveSessionThinkingForRun({ agent, summary: state.summary });
    const reasoning = thinking && isPiReasoningLevel(thinking) ? thinking : undefined;
    const configProvider = piConfig?.provider?.trim();
    const providerMatchesConfig =
      !configProvider || configProvider.toLowerCase() === resolvedModel.providerId.toLowerCase();
    const piAgentAuthApiKey = await resolvePiSdkAuthApiKey({
      providerId: resolvedModel.providerId,
      log,
    });
    const apiKey =
      providerMatchesConfig ? piConfig?.apiKey ?? piAgentAuthApiKey : piAgentAuthApiKey;
    const baseUrl = providerMatchesConfig ? piConfig?.baseUrl : undefined;
    const headers = providerMatchesConfig ? piConfig?.headers : undefined;
    const canonicalReplayMessages = await loadCanonicalPiReplayMessages({
      summary: state.summary,
    });
    piReplayMessages = state.chatMessages;
    if (canonicalReplayMessages) {
      const systemMessage =
        state.chatMessages[0]?.role === 'system' ? state.chatMessages[0] : undefined;
      const currentUserMessage =
        state.chatMessages[state.chatMessages.length - 1]?.role === 'user'
          ? state.chatMessages[state.chatMessages.length - 1]
          : undefined;
      const lastCanonical = canonicalReplayMessages[canonicalReplayMessages.length - 1];
      const shouldAppendCurrentUser =
        currentUserMessage?.role === 'user' &&
        !(
          lastCanonical?.role === 'user' &&
          lastCanonical.content === currentUserMessage.content &&
          lastCanonical.historyTimestampMs !== undefined &&
          lastCanonical.historyTimestampMs === currentUserMessage.historyTimestampMs
        );
      piReplayMessages = [
        ...(systemMessage ? [systemMessage] : []),
        ...canonicalReplayMessages,
        ...(shouldAppendCurrentUser && currentUserMessage ? [currentUserMessage] : []),
      ];
    }

    const agentModel: Model<any> = {
      ...resolvedModel.model,
      ...(baseUrl ? { baseUrl } : {}),
      ...(headers ? { headers } : {}),
    };
    type PiRuntimeConfig = {
      apiKey?: string;
      temperature?: number;
      maxTokens?: number;
      headers?: Record<string, string>;
    };
    type PiRuntimeState = {
      requestConfig: PiRuntimeConfig;
      onPayload?: ((payload: unknown, model: Model<any>) => unknown | Promise<unknown>) | undefined;
      agent: Agent;
    };
    const piAgentRuntime =
      state.piAgentRuntime ??
      (() => {
        const runtime: PiRuntimeState = {
          requestConfig: {},
          onPayload: undefined,
          agent: undefined as unknown as Agent,
        };
        runtime.agent = new Agent({
          convertToLlm: async (messages) =>
            messages.filter(
              (message) =>
                message.role === 'user' ||
                message.role === 'assistant' ||
                message.role === 'toolResult',
            ) as PiSdkMessage[],
          getApiKey: async () => runtime.requestConfig.apiKey,
          streamFn: async (model, context, options) =>
            (await loadPiAiModule()).streamSimple(model, context, {
              ...options,
              ...(runtime.requestConfig.apiKey ? { apiKey: runtime.requestConfig.apiKey } : {}),
              ...(runtime.requestConfig.temperature !== undefined
                ? { temperature: runtime.requestConfig.temperature }
                : {}),
              ...(runtime.requestConfig.maxTokens !== undefined
                ? { maxTokens: runtime.requestConfig.maxTokens }
                : {}),
              ...(runtime.requestConfig.headers ? { headers: runtime.requestConfig.headers } : {}),
            }),
          onPayload: async (payload, model) =>
            runtime.onPayload ? runtime.onPayload(payload, model) : undefined,
          sessionId,
        });
        state.piAgentRuntime = runtime as LogicalSessionState['piAgentRuntime'];
        return runtime;
      })() as PiRuntimeState;
    piAgentRuntime.requestConfig = {
      ...(apiKey ? { apiKey } : {}),
      ...(piConfig?.temperature !== undefined ? { temperature: piConfig.temperature } : {}),
      ...(piConfig?.maxTokens !== undefined ? { maxTokens: piConfig.maxTokens } : {}),
      ...(headers ? { headers } : {}),
    };
    piAgentRuntime.onPayload = envConfig.debugChatCompletions
      ? async (payload, model) => {
          const record = {
            timestamp: new Date().toISOString(),
            direction: 'request',
            sessionId,
            responseId,
            provider: resolvedModel.providerId,
            model: model.id,
            ...(debugChatCompletionsContext !== undefined
              ? { debugContext: debugChatCompletionsContext }
              : {}),
            payload,
          };
          log('pi chat request', formatDebugPayloadForLog(record));
          await appendDebugChatCompletionsLogRecord({
            dataDir: envConfig.dataDir,
            record,
          }).catch((error) => {
            log('failed to write pi chat request debug log', String(error));
          });
          return undefined;
        }
      : undefined;
    piAgentRuntime.agent.setModel(agentModel);
    piAgentRuntime.agent.setSystemPrompt(
      buildPiAgentContext({
        messages: piReplayMessages,
        text,
        model: agentModel,
      }).systemPrompt,
    );
    piAgentRuntime.agent.setThinkingLevel((reasoning ?? 'off') as PiAgentThinkingLevel);
    piAgentRuntime.agent.setTools(agentTools as never);

    const { contextMessages, promptMessage, systemPrompt } = buildPiAgentContext({
      messages: piReplayMessages,
      text,
      model: agentModel,
    });
    piAgentRuntime.agent.setSystemPrompt(systemPrompt);
    piAgentRuntime.agent.replaceMessages(contextMessages);

    const toolInputOffsets = new Map<string, number>();
    const toolOutputOffsets = new Map<string, number>();
    const toolOutputTexts = new Map<string, string>();
    piBaseReplayMessages = piReplayMessages.slice();
    const piReplayAccumulator = piReplayMessages.slice();
    let toolIterationCount = 0;
    let hitToolIterationLimit = false;

    const emitToolResultMessage = async (
      event: Extract<AgentEvent, { type: 'tool_execution_end' }>,
    ): Promise<void> => {
      const result = event.result as {
        content?: Array<{ type?: string; text?: string }>;
        details?: unknown;
      };
      const textResult = result.content
        ?.filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text as string)
        .join('');
      const toolResultMessage: ServerToolResultMessage = {
        type: 'tool_result',
        callId: event.toolCallId,
        toolName: event.toolName,
        ok: !event.isError,
        ...(requestIdValue ? { requestId: requestIdValue } : {}),
        ...(getAgentExchangeId(state, getAgentExchangeIdFn)
          ? { agentExchangeId: getAgentExchangeId(state, getAgentExchangeIdFn) }
          : {}),
        result,
        ...(event.isError
          ? {
              error: {
                code: 'tool_error',
                message: textResult || 'Tool call failed',
              },
            }
          : {}),
      };
      output.send(toolResultMessage);
      if (shouldEmitChatEvents && turnId) {
        await emitToolResultEvent({
          ...(eventStore ? { eventStore } : {}),
          sessionHub,
          sessionId,
          turnId,
          responseId,
          toolCallId: event.toolCallId,
          result,
          ...(event.isError
            ? {
                error: {
                  code: 'tool_error',
                  message: textResult || 'Tool call failed',
                },
              }
            : {}),
        });
      }
    };

    let subscriptionError: unknown = null;
    let subscriptionWork = Promise.resolve();

    const handleAgentEvent = async (event: AgentEvent): Promise<void> => {
      switch (event.type) {
        case 'message_update': {
          const partial = event.message;
          if (partial.role !== 'assistant') {
            return;
          }
          const assistantEvent = event.assistantMessageEvent as AssistantMessageEvent;
          if (
            assistantEvent.type === 'text_delta' ||
            assistantEvent.type === 'text_start' ||
            assistantEvent.type === 'text_end'
          ) {
            const block = partial.content[assistantEvent.contentIndex];
            const phase =
              block && block.type === 'text'
                ? parseAssistantTextSignature(block.textSignature)?.phase
                : undefined;
            if (assistantEvent.type === 'text_delta' && assistantEvent.delta) {
              fullText += assistantEvent.delta;
              await streamHandlers.emitTextDelta(assistantEvent.delta, fullText, phase);
            }
          } else if (
            assistantEvent.type === 'thinking_start' ||
            assistantEvent.type === 'thinking_delta' ||
            assistantEvent.type === 'thinking_end'
          ) {
            if (assistantEvent.type === 'thinking_start') {
              await streamHandlers.emitThinkingStart();
            } else if (assistantEvent.type === 'thinking_delta' && assistantEvent.delta) {
              await streamHandlers.emitThinkingDelta(assistantEvent.delta);
            } else if (assistantEvent.type === 'thinking_end') {
              const block = partial.content[assistantEvent.contentIndex];
              await streamHandlers.emitThinkingDone(
                block && block.type === 'thinking' ? block.thinking : streamHandlers.getThinkingText(),
              );
            }
          } else if (assistantEvent.type === 'toolcall_start') {
            const block = partial.content[assistantEvent.contentIndex];
            if (block?.type === 'toolCall') {
              toolInputOffsets.set(block.id, 0);
            }
          } else if (assistantEvent.type === 'toolcall_delta') {
            const block = partial.content[assistantEvent.contentIndex];
            if (block?.type === 'toolCall' && shouldEmitChatEvents && turnId) {
              const currentOffset = toolInputOffsets.get(block.id) ?? 0;
              const nextOffset = currentOffset + assistantEvent.delta.length;
              emitToolInputChunkEvent({
                sessionHub,
                sessionId,
                turnId,
                responseId,
                toolCallId: block.id,
                toolName: block.name,
                chunk: assistantEvent.delta,
                offset: nextOffset,
              });
              toolInputOffsets.set(block.id, nextOffset);
            }
          }
          return;
        }
        case 'message_end': {
          if (event.message.role === 'assistant') {
            lastPiSdkMessage = event.message;
            if (event.message.content.some((block) => block.type === 'toolCall')) {
              appendAssistantToolCallMessage(piReplayAccumulator, event.message);
              appendAssistantToolCallMessage(state.chatMessages, event.message);
            } else {
              finalPiSdkMessage = event.message;
            }
          } else if (event.message.role === 'toolResult') {
            appendToolResultMessage(piReplayAccumulator, event.message);
            appendToolResultMessage(state.chatMessages, event.message);
          }
          return;
        }
        case 'turn_end':
          if (event.toolResults.length > 0) {
            toolIterationCount += 1;
            if (toolIterationCount >= maxToolIterations) {
              hitToolIterationLimit = true;
              piAgentRuntime.agent.abort();
            }
          }
          return;
        case 'tool_execution_start': {
          const argsJson = stringifyToolCallArguments(event.args);
          output.send({
            type: 'tool_call_start',
            callId: event.toolCallId,
            toolName: event.toolName,
            arguments: argsJson,
            ...(requestIdValue ? { requestId: requestIdValue } : {}),
            ...(getAgentExchangeId(state, getAgentExchangeIdFn)
              ? { agentExchangeId: getAgentExchangeId(state, getAgentExchangeIdFn) }
              : {}),
          });
          toolOutputOffsets.set(event.toolCallId, 0);
          toolOutputTexts.set(event.toolCallId, '');
          if (shouldEmitChatEvents && turnId) {
            await emitToolCallEvent({
              ...(eventStore ? { eventStore } : {}),
              sessionHub,
              sessionId,
              turnId,
              responseId,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
            });
          }
          return;
        }
        case 'tool_execution_update': {
          const partialResult = event.partialResult as {
            content?: Array<{ type?: string; text?: string }>;
            details?: Record<string, unknown>;
          };
          const previousText = toolOutputTexts.get(event.toolCallId) ?? '';
          const nextText = extractToolOutputText(partialResult);
          const delta = computeToolOutputDelta(previousText, nextText);
          if (!delta) {
            toolOutputTexts.set(event.toolCallId, nextText);
            return;
          }
          const currentOffset = toolOutputOffsets.get(event.toolCallId) ?? 0;
          const streamValue = partialResult.details?.['stream'];
          const nextOffset = currentOffset + delta.length;
          emitToolOutputChunkEvent({
            sessionHub,
            sessionId,
            ...(turnId ? { turnId } : {}),
            ...(responseId ? { responseId } : {}),
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            chunk: delta,
            offset: nextOffset,
            ...(streamValue === 'stdout' || streamValue === 'stderr' || streamValue === 'output'
              ? { stream: streamValue }
              : {}),
          });
          toolOutputOffsets.set(event.toolCallId, nextOffset);
          toolOutputTexts.set(event.toolCallId, nextText);
          return;
        }
        case 'tool_execution_end':
          toolOutputOffsets.delete(event.toolCallId);
          toolOutputTexts.delete(event.toolCallId);
          await emitToolResultMessage(event);
          if (onToolCallMetric) {
            onToolCallMetric(event.toolName, 0);
          }
          return;
      }
    };

    const subscription = piAgentRuntime.agent.subscribe((event) => {
      subscriptionWork = subscriptionWork
        .then(async () => {
          if (subscriptionError) {
            return;
          }
          await handleAgentEvent(event);
        })
        .catch((error) => {
          if (subscriptionError) {
            return;
          }
          subscriptionError = error;
          piAgentRuntime.agent.abort();
        });
    });

    const onAbort = () => {
      piAgentRuntime.agent.abort();
    };
    abortController.signal.addEventListener('abort', onAbort, { once: true });
    let promptError: unknown = null;
    try {
      await piAgentRuntime.agent.prompt(promptMessage);
    } catch (error) {
      promptError = error;
    } finally {
      abortController.signal.removeEventListener('abort', onAbort);
      subscription();
      await subscriptionWork;
    }

    if (subscriptionError) {
      throw subscriptionError;
    }
    if (promptError) {
      throw promptError;
    }

    piReplayMessages = piReplayAccumulator.slice();
    const maybeResolvedPiMessage = finalPiSdkMessage ?? lastPiSdkMessage;
    const resolvedPiMessage =
      maybeResolvedPiMessage?.role === 'assistant' ? maybeResolvedPiMessage : undefined;
    if (resolvedPiMessage) {
      const contextUsage = extractSessionContextUsageFromAssistantMessage({
        contextWindow: resolvedModel.model.contextWindow,
        message: resolvedPiMessage,
      });
      if (contextUsage && !isSessionContextUsageEqual(state.summary.contextUsage, contextUsage)) {
        const updatedSummary = await sessionHub.updateSessionContextUsage(sessionId, contextUsage);
        if (updatedSummary) {
          state.summary = updatedSummary;
        }
      }
      if (envConfig.debugChatCompletions) {
        const record = {
          timestamp: new Date().toISOString(),
          direction: 'response',
          sessionId,
          responseId,
          provider: resolvedModel.providerId,
          model: resolvedModel.model.id,
          ...(debugChatCompletionsContext !== undefined
            ? { debugContext: debugChatCompletionsContext }
            : {}),
          response: {
            text: fullText,
            message: resolvedPiMessage,
          },
        };
        log('pi chat response', formatDebugPayloadForLog(record));
        await appendDebugChatCompletionsLogRecord({
          dataDir: envConfig.dataDir,
          record,
        }).catch((error) => {
          log('failed to write pi chat response debug log', String(error));
        });
      }
    }

    if (hitToolIterationLimit) {
      log('pi tool iteration limit reached', {
        sessionId,
        responseId,
        maxToolIterations,
        iterations: toolIterationCount,
      });
      throw new ChatRunError(
        'tool_iteration_limit',
        `Tool iteration limit reached (${maxToolIterations}).`,
        {
          maxToolIterations,
          iterations: toolIterationCount,
        },
      );
    }

    if (resolvedPiMessage?.stopReason === 'aborted' || abortController.signal.aborted) {
      aborted = true;
      abortReason =
        abortController.signal.reason === 'timeout' || resolvedPiMessage?.errorMessage === 'timeout'
          ? 'timeout'
          : 'aborted';
      finalPiSdkMessage = resolvedPiMessage;
    } else if (resolvedPiMessage?.stopReason === 'error') {
      throw new ChatRunError(
        'upstream_error',
        resolvedPiMessage.errorMessage || 'Chat backend error',
      );
    } else {
      finalPiSdkMessage = resolvedPiMessage;
    }
  } else {
    throw new ChatRunError(
      'agent_config_error',
      `Unsupported chat provider "${provider}"`,
    );
  }

  const resolvedPiSdkMessage = finalPiSdkMessage ?? lastPiSdkMessage;

  return {
    fullText,
    thinkingText: streamHandlers.getThinkingText(),
    provider,
    aborted,
    ...(abortReason ? { abortReason } : {}),
    ...(provider === 'pi' && resolvedPiSdkMessage
      ? { piSdkMessage: resolvedPiSdkMessage }
      : {}),
    ...(provider === 'pi' && piReplayMessages ? { piReplayMessages } : {}),
    ...(provider === 'pi' && piBaseReplayMessages ? { piBaseReplayMessages } : {}),
  };
}
