import type {
  ChatEvent,
  ServerMessage,
  ServerTextDeltaMessage,
  ServerThinkingDeltaMessage,
  ServerThinkingDoneMessage,
  ServerThinkingStartMessage,
  ServerToolCallStartMessage,
} from '@assistant/shared';

import type { AgentDefinition, PiSdkChatConfig } from './agents';
import type {
  ChatCompletionMessage,
  ChatCompletionToolCallMessageToolCall,
  ChatCompletionToolCallState,
} from './chatCompletionTypes';
import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';
import type { EnvConfig } from './envConfig';
import type { EventStore } from './events';
import {
  appendAndBroadcastChatEvents,
  createChatEventBase,
  emitToolInputChunkEvent,
  emitToolOutputChunkEvent,
} from './events/chatEventUtils';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { TtsBackendFactory, TtsStreamingSession } from './tts/types';
import { getCodexSessionStore } from './codexSessionStore';
import os from 'node:os';
import { resolvePiAgentAuthApiKey } from './llm/piAgentAuth';

import {
  resolveCliModelForRun,
  resolveSessionModelForRun,
  resolveSessionThinkingForRun,
} from './sessionModel';
import { createCliToolCallbacks } from './ws/cliCallbackFactory';
import { runClaudeCliChat, type ClaudeCliChatConfig } from './ws/claudeCliChat';
import { runCodexCliChat, type CodexCliChatConfig } from './ws/codexCliChat';
import { runPiCliChat, type PiCliChatConfig, type PiSessionInfo } from './ws/piCliChat';
import { buildProviderAttributesPatch, getProviderAttributes } from './history/providerAttributes';
import {
  resolvePiSdkModel,
  runPiSdkChatCompletionIteration,
} from './llm/piSdkProvider';

type ChatProvider = 'pi' | 'claude-cli' | 'codex-cli' | 'pi-cli';
type OutputModeValue = 'text' | 'speech' | 'both';

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
  responseId: string;
  agent?: AgentDefinition;
  provider: ChatProvider;
  envConfig: EnvConfig;
  chatCompletionTools: unknown[];
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
  log: (...args: unknown[]) => void;
}

export interface ChatRunCoreResult {
  fullText: string;
  thinkingText: string;
  provider: ChatProvider;
  aborted: boolean;
  piSdkMessage?: PiSdkMessage;
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

function createChatRunStreamHandlers(options: {
  sessionId: string;
  state: LogicalSessionState;
  responseId: string;
  output: ChatRunOutputAdapter;
  eventStore?: EventStore;
  sessionHub: SessionHub;
  shouldEmitChatEvents: boolean;
  turnId?: string;
  includeAgentExchangeIdInMessages: boolean;
  trackTextStartedAt: boolean;
  log: (...args: unknown[]) => void;
  getAgentExchangeId?: () => string | undefined;
}) {
  const {
    sessionId,
    state,
    responseId,
    output,
    eventStore,
    sessionHub,
    shouldEmitChatEvents,
    turnId,
    includeAgentExchangeIdInMessages,
    trackTextStartedAt,
    log,
    getAgentExchangeId: getAgentExchangeIdFn,
  } = options;

  let thinkingText = '';
  let thinkingStarted = false;
  let thinkingCompleted = false;

  const buildAgentExchangePayload = (): { agentExchangeId?: string } => {
    const agentExchangeId = getAgentExchangeId(state, getAgentExchangeIdFn);
    if (includeAgentExchangeIdInMessages && agentExchangeId) {
      return { agentExchangeId };
    }
    return {};
  };

  const emitThinkingStart = async (): Promise<void> => {
    if (thinkingStarted) {
      return;
    }
    thinkingStarted = true;
    const message: ServerThinkingStartMessage = {
      type: 'thinking_start',
      responseId,
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
      ...buildAgentExchangePayload(),
    };
    output.send(message);

    if (shouldEmitChatEvents && eventStore && turnId) {
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
          eventStore,
          sessionHub,
          sessionId,
        },
        events,
      );
    }
  };

  const emitThinkingDone = async (textValue: string): Promise<void> => {
    if (thinkingCompleted) {
      return;
    }
    thinkingCompleted = true;
    const finalText = textValue || thinkingText;
    thinkingText = finalText;
    if (!thinkingStarted && finalText) {
      await emitThinkingStart();
    }
    const message: ServerThinkingDoneMessage = {
      type: 'thinking_done',
      responseId,
      text: finalText,
      ...buildAgentExchangePayload(),
    };
    output.send(message);

    if (shouldEmitChatEvents && eventStore && turnId) {
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
          eventStore,
          sessionHub,
          sessionId,
        },
        events,
      );
    }
  };

  const emitTextDelta = async (deltaText: string, textSoFar: string): Promise<void> => {
    if (state.activeChatRun) {
      state.activeChatRun.accumulatedText = textSoFar;
      if (trackTextStartedAt && !state.activeChatRun.textStartedAt) {
        state.activeChatRun.textStartedAt = new Date().toISOString();
      }
    }

    const message: ServerTextDeltaMessage = {
      type: 'text_delta',
      responseId,
      delta: deltaText,
      ...buildAgentExchangePayload(),
    };
    output.send(message);

    if (shouldEmitChatEvents && eventStore && turnId) {
      const events: ChatEvent[] = [
        {
          ...createChatEventBase({
            sessionId,
            ...(turnId ? { turnId } : {}),
            responseId,
          }),
          type: 'assistant_chunk',
          payload: { text: deltaText },
        },
      ];
      void appendAndBroadcastChatEvents(
        {
          eventStore,
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

export async function runChatCompletionCore(
  options: ChatRunCoreOptions,
): Promise<ChatRunCoreResult> {
  const {
    sessionId,
    state,
    text,
    responseId,
    agent,
    provider,
    envConfig,
    chatCompletionTools,
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
    log,
  } = options;

  const getAgentExchangeIdFn = () => state.activeChatRun?.agentExchangeId;
  const streamHandlers = createChatRunStreamHandlers({
    sessionId,
    state,
    responseId,
    output,
    sessionHub,
    shouldEmitChatEvents,
    includeAgentExchangeIdInMessages,
    trackTextStartedAt,
    log,
    getAgentExchangeId: getAgentExchangeIdFn,
    ...(eventStore ? { eventStore } : {}),
    ...(turnId ? { turnId } : {}),
  });

  let fullText = '';
  let aborted = false;
  let finalPiSdkMessage: PiSdkMessage | undefined;
  let lastPiSdkMessage: PiSdkMessage | undefined;

  if (provider === 'claude-cli') {
    const claudeConfig = agent?.chat?.config as ClaudeCliChatConfig | undefined;
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
      ...(onToolCallMetric ? { onToolCallMetric } : {}),
    });

    const { text: claudeText, aborted: cliAborted } = await runClaudeCliChat({
      sessionId: resolvedSessionId,
      resumeSession,
      userText: text,
      ...(model ? { model } : {}),
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
    const codexConfig = agent?.chat?.config as CodexCliChatConfig | undefined;
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
    const piConfig = agent?.chat?.config as PiCliChatConfig | undefined;
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
    let iterations = 0;

    const piConfig = agent?.chat?.config as PiSdkChatConfig | undefined;
    const maxToolIterations = piConfig?.maxToolIterations ?? 100;
    const modelSpec = resolveSessionModelForRun({ agent, summary: state.summary });
    if (!modelSpec) {
      throw new ChatRunError(
        'agent_config_error',
        'Pi chat requires at least one model in chat.models or a session override.',
      );
    }

    let resolvedModel: ReturnType<typeof resolvePiSdkModel>;
    try {
      const defaultProvider = piConfig?.provider;
      resolvedModel =
        defaultProvider === undefined
          ? resolvePiSdkModel({ modelSpec })
          : resolvePiSdkModel({ modelSpec, defaultProvider });
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

    // Resolve auth in this order:
    // 1) explicit agent config apiKey (only applies when provider matches config.provider)
    // 2) ~/.pi/agent/auth.json OAuth token for supported providers (anthropic, openai-codex)
    const piAgentAuthApiKey = await resolvePiAgentAuthApiKey({
      providerId: resolvedModel.providerId,
      log,
    });

    const apiKey = providerMatchesConfig ? piConfig?.apiKey ?? piAgentAuthApiKey : piAgentAuthApiKey;
    const baseUrl = providerMatchesConfig ? piConfig?.baseUrl : undefined;
    const headers = providerMatchesConfig ? piConfig?.headers : undefined;

    // Track cumulative offsets for tool input streaming
    const toolInputOffsets = new Map<string, number>();
    const debugChatCompletions = envConfig.debugChatCompletions;
    let hitToolIterationLimit = false;

    while (!abortController.signal.aborted && iterations < maxToolIterations) {
      // Clear offsets for new iteration (tool calls are new per iteration)
      toolInputOffsets.clear();
      const iterationIndex = iterations + 1;

      const { text: iterationText, toolCalls, aborted: piAborted, assistantMessage } =
        await runPiSdkChatCompletionIteration({
          model: resolvedModel.model,
          messages: state.chatMessages,
          tools: chatCompletionTools,
          abortSignal: abortController.signal,
          onToolCallStart: (info) => {
            const agentExchangeId = getAgentExchangeId(state, getAgentExchangeIdFn);
            const message: ServerToolCallStartMessage = {
              type: 'tool_call_start',
              callId: info.id,
              toolName: info.name,
              arguments: '{}',
              ...(agentExchangeId ? { agentExchangeId } : {}),
            };
            output.send(message);

            toolInputOffsets.set(info.id, 0);
          },
          onToolInputDelta: (info) => {
            if (shouldEmitChatEvents && turnId) {
              const currentOffset = toolInputOffsets.get(info.id) ?? 0;
              emitToolInputChunkEvent({
                sessionHub,
                sessionId,
                turnId,
                responseId,
                toolCallId: info.id,
                toolName: info.name,
                chunk: info.argumentsDelta,
                offset: currentOffset,
              });
              toolInputOffsets.set(info.id, currentOffset + info.argumentsDelta.length);
            }
          },
          onDeltaText: streamHandlers.emitTextDelta,
          onThinkingStart: streamHandlers.emitThinkingStart,
          onThinkingDelta: streamHandlers.emitThinkingDelta,
          onThinkingDone: streamHandlers.emitThinkingDone,
          ...(piConfig?.maxTokens !== undefined ? { maxTokens: piConfig.maxTokens } : {}),
          ...(piConfig?.temperature !== undefined ? { temperature: piConfig.temperature } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(baseUrl ? { baseUrl } : {}),
          ...(headers ? { headers } : {}),
          ...(piConfig?.timeoutMs !== undefined ? { timeoutMs: piConfig.timeoutMs } : {}),
          ...(debugChatCompletions
            ? {
                onPayload: (payload) => {
                  log('pi chat request', {
                    sessionId,
                    responseId,
                    iteration: iterationIndex,
                    provider: resolvedModel.providerId,
                    model: resolvedModel.model.id,
                    payload: redactDebugPayload(payload),
                  });
                },
                onResponse: (response) => {
                  log('pi chat response', {
                    sessionId,
                    responseId,
                    iteration: iterationIndex,
                    provider: resolvedModel.providerId,
                    model: resolvedModel.model.id,
                    response: {
                      text: response.text,
                      toolCalls: response.toolCalls,
                      aborted: response.aborted,
                      message: redactDebugPayload(response.message),
                    },
                  });
                },
              }
            : {}),
        });

      if (iterationText.length > 0) {
        fullText += iterationText;
        if (state.activeChatRun) {
          state.activeChatRun.accumulatedText = fullText;
        }
      }

      lastPiSdkMessage = assistantMessage;

      if (piAborted) {
        aborted = true;
        finalPiSdkMessage = assistantMessage;
        break;
      }

      if (!toolCalls || toolCalls.length === 0) {
        finalPiSdkMessage = assistantMessage;
        break;
      }

      const assistantToolCallMessage: ChatCompletionMessage = {
        role: 'assistant',
        content: iterationText,
        tool_calls: toolCalls.map<ChatCompletionToolCallMessageToolCall>((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.argumentsJson,
          },
        })),
        piSdkMessage: assistantMessage,
      };

      state.chatMessages.push(assistantToolCallMessage);

      const toolRunStart = Date.now();
      await handleChatToolCalls(sessionId, state, toolCalls);
      const toolRunDurationMs = Date.now() - toolRunStart;

      if (onToolCallMetric) {
        for (const call of toolCalls) {
          onToolCallMetric(call.name, toolRunDurationMs);
        }
      }

      iterations += 1;
      if (iterations >= maxToolIterations) {
        hitToolIterationLimit = true;
        break;
      }
    }

    if (hitToolIterationLimit) {
      log('pi tool iteration limit reached', {
        sessionId,
        responseId,
        maxToolIterations,
        iterations,
      });
      throw new ChatRunError(
        'tool_iteration_limit',
        `Tool iteration limit reached (${maxToolIterations}).`,
        {
          maxToolIterations,
          iterations,
        },
      );
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
    ...(provider === 'pi' && resolvedPiSdkMessage
      ? { piSdkMessage: resolvedPiSdkMessage }
      : {}),
  };
}
