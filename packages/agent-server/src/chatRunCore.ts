import OpenAI from 'openai';

import type {
  ChatEvent,
  ServerMessage,
  ServerTextDeltaMessage,
  ServerThinkingDeltaMessage,
  ServerThinkingDoneMessage,
  ServerThinkingStartMessage,
  ServerToolCallStartMessage,
} from '@assistant/shared';

import type { AgentDefinition, OpenAiCompatibleChatConfig } from './agents';
import type {
  ChatCompletionMessage,
  ChatCompletionToolCallMessageToolCall,
  ChatCompletionToolCallState,
} from './chatCompletionTypes';
import { openaiConfigured, type EnvConfig } from './envConfig';
import type { EventStore } from './events';
import {
  appendAndBroadcastChatEvents,
  createChatEventBase,
  emitToolInputChunkEvent,
} from './events/chatEventUtils';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { TtsBackendFactory, TtsStreamingSession } from './tts/types';
import { getCodexSessionStore } from './codexSessionStore';

import { createCliToolCallbacks } from './ws/cliCallbackFactory';
import { runClaudeCliChat, type ClaudeCliChatConfig } from './ws/claudeCliChat';
import { runCodexCliChat, type CodexCliChatConfig } from './ws/codexCliChat';
import { runChatCompletionIteration } from './ws/chatCompletionStreaming';
import { runPiCliChat, type PiCliChatConfig } from './ws/piCliChat';

type ChatProvider = 'openai' | 'openai-compatible' | 'claude-cli' | 'codex-cli' | 'pi-cli';
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
  hadPriorUserMessages: boolean;
  envConfig: EnvConfig;
  openaiClient?: OpenAI;
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

export function resolveChatProvider(agent?: AgentDefinition): {
  agentType: 'chat' | 'external';
  provider: ChatProvider;
} {
  const agentType = agent?.type ?? 'chat';
  const provider = agent?.chat?.provider ?? 'openai';
  return { agentType, provider };
}

export function ensureOpenAiConfigured(envConfig: EnvConfig): void {
  if (!openaiConfigured(envConfig)) {
    throw new ChatRunError(
      'openai_not_configured',
      'OpenAI is not configured. Set OPENAI_API_KEY and OPENAI_CHAT_MODEL to use this agent, or choose a CLI-based agent instead.',
    );
  }
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

function resolveOpenAiRunConfig(options: {
  provider: ChatProvider;
  agent?: AgentDefinition;
  state: LogicalSessionState;
  envConfig: EnvConfig;
  openaiClient?: OpenAI;
}): {
  openaiClient: OpenAI;
  model: string;
  maxTokens?: number;
  temperature?: number;
} {
  const { provider, agent, state, envConfig, openaiClient } = options;

  if (provider === 'openai-compatible') {
    const rawConfig = agent?.chat?.config as OpenAiCompatibleChatConfig | undefined;
    if (!rawConfig) {
      throw new ChatRunError(
        'agent_config_error',
        'Missing chat configuration for openai-compatible provider',
      );
    }

    const baseUrl = rawConfig.baseUrl?.trim();
    const models = Array.isArray(rawConfig.models)
      ? rawConfig.models.map((model) => model.trim()).filter((model) => model.length > 0)
      : [];

    if (!baseUrl || models.length === 0) {
      throw new ChatRunError(
        'agent_config_error',
        'openai-compatible provider requires non-empty baseUrl and at least one model',
      );
    }

    const apiKey =
      typeof rawConfig.apiKey === 'string' && rawConfig.apiKey.trim().length > 0
        ? rawConfig.apiKey.trim()
        : envConfig.apiKey;

    const openaiClientForRun = new OpenAI({
      apiKey: apiKey || 'sk-no-api-key',
      baseURL: baseUrl,
      ...(rawConfig.headers ? { defaultHeaders: rawConfig.headers } : {}),
    });

    const sessionModel =
      typeof state.summary.model === 'string' && state.summary.model.trim().length > 0
        ? state.summary.model.trim()
        : undefined;
    const modelForRun =
      sessionModel && models.includes(sessionModel)
        ? sessionModel
        : (models[0] ?? envConfig.chatModel ?? '');

    return {
      openaiClient: openaiClientForRun,
      model: modelForRun,
      ...(rawConfig.maxTokens !== undefined ? { maxTokens: rawConfig.maxTokens } : {}),
      ...(rawConfig.temperature !== undefined ? { temperature: rawConfig.temperature } : {}),
    };
  }

  if (!openaiClient && !envConfig.apiKey) {
    throw new ChatRunError(
      'openai_not_configured',
      'OpenAI is not configured. Set OPENAI_API_KEY and OPENAI_CHAT_MODEL to use this agent.',
    );
  }
  if (!envConfig.chatModel) {
    throw new ChatRunError(
      'openai_not_configured',
      'OpenAI is not configured. OPENAI_CHAT_MODEL is required to use this agent.',
    );
  }

  const models =
    agent && agent.chat && Array.isArray(agent.chat.models)
      ? agent.chat.models.map((model) => model.trim()).filter((model) => model.length > 0)
      : [];
  const sessionModel =
    typeof state.summary.model === 'string' && state.summary.model.trim().length > 0
      ? state.summary.model.trim()
      : undefined;
  const modelForRun =
    sessionModel && (models.length === 0 || models.includes(sessionModel))
      ? sessionModel
      : (models[0] ?? envConfig.chatModel);

  const openaiClientForRun = openaiClient ?? new OpenAI({ apiKey: envConfig.apiKey });

  return {
    openaiClient: openaiClientForRun,
    model: modelForRun,
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
    hadPriorUserMessages,
    envConfig,
    openaiClient,
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

  if (provider === 'claude-cli') {
    const claudeConfig = agent?.chat?.config as ClaudeCliChatConfig | undefined;

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
      sessionId,
      resumeSession: hadPriorUserMessages,
      userText: text,
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

    aborted = cliAborted;
    fullText = claudeText;
  } else if (provider === 'codex-cli') {
    const codexConfig = agent?.chat?.config as CodexCliChatConfig | undefined;

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

    const {
      text: codexText,
      aborted: cliAborted,
      codexSessionId,
    } = await runCodexCliChat({
      ourSessionId: sessionId,
      existingCodexSessionId,
      userText: text,
      ...(codexConfig ? { config: codexConfig } : {}),
      abortSignal: abortController.signal,
      onTextDelta: streamHandlers.emitTextDelta,
      onThinkingStart: streamHandlers.emitThinkingStart,
      onThinkingDelta: streamHandlers.emitThinkingDelta,
      onThinkingDone: streamHandlers.emitThinkingDone,
      onToolCallStart: codexCallbacks.onToolCallStart,
      onToolResult: codexCallbacks.onToolResult,
      log,
    });

    if (codexSessionId && codexSessionId !== existingCodexSessionId) {
      try {
        await codexSessionStore.set({
          sessionId,
          codexSessionId,
          ...(codexConfig?.workdir ? { workdir: codexConfig.workdir } : {}),
        });
      } catch (err) {
        log('failed to persist Codex session mapping', err);
      }
    }

    aborted = cliAborted;
    fullText = codexText;
  } else if (provider === 'pi-cli') {
    const piConfig = agent?.chat?.config as PiCliChatConfig | undefined;

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

    const { text: piText, aborted: cliAborted } = await runPiCliChat({
      sessionId,
      resumeSession: hadPriorUserMessages,
      userText: text,
      ...(piConfig ? { config: piConfig } : {}),
      dataDir: envConfig.dataDir,
      abortSignal: abortController.signal,
      onTextDelta: streamHandlers.emitTextDelta,
      onThinkingStart: streamHandlers.emitThinkingStart,
      onThinkingDelta: streamHandlers.emitThinkingDelta,
      onThinkingDone: streamHandlers.emitThinkingDone,
      onToolCallStart: piCallbacks.onToolCallStart,
      onToolResult: piCallbacks.onToolResult,
      log,
    });

    aborted = cliAborted;
    fullText = piText;
  } else {
    let iterations = 0;
    const maxIterations = 4;

    const {
      openaiClient: openaiClientForRun,
      model,
      maxTokens,
      temperature,
    } = resolveOpenAiRunConfig({
      provider,
      state,
      envConfig,
      ...(agent ? { agent } : {}),
      ...(openaiClient ? { openaiClient } : {}),
    });

    // Track cumulative offsets for tool input streaming
    const toolInputOffsets = new Map<string, number>();

    while (!abortController.signal.aborted && iterations < maxIterations) {
      // Clear offsets for new iteration (tool calls are new per iteration)
      toolInputOffsets.clear();

      const { text: iterationText, toolCalls } = await runChatCompletionIteration({
        openaiClient: openaiClientForRun,
        model,
        messages: state.chatMessages,
        tools: chatCompletionTools,
        abortSignal: abortController.signal,
        debug: envConfig.debugChatCompletions,
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
        ...(maxTokens !== undefined ? { maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      });

      if (iterationText.length > 0) {
        fullText += iterationText;
        if (state.activeChatRun) {
          state.activeChatRun.accumulatedText = fullText;
        }
      }

      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      const assistantToolCallMessage: ChatCompletionMessage = {
        role: 'assistant',
        content: '',
        tool_calls: toolCalls.map<ChatCompletionToolCallMessageToolCall>((call) => ({
          id: call.id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.argumentsJson,
          },
        })),
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
    }
  }

  return {
    fullText,
    thinkingText: streamHandlers.getThinkingText(),
    provider,
    aborted,
  };
}
