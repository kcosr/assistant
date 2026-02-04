import { randomUUID } from 'node:crypto';

import type { ServerTextDoneMessage, ServerUserMessageMessage } from '@assistant/shared';
import type { ChatEvent, TurnStartTrigger } from '@assistant/shared';

import type {
  ChatCompletionMessage,
  ChatCompletionMessageMeta,
  ChatCompletionToolCallState,
} from './chatCompletionTypes';
import type { PiSdkChatConfig } from './agents';
import type { EnvConfig } from './envConfig';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { SessionConnection } from './ws/sessionConnection';
import { buildExternalCallbackUrl, postExternalUserInput } from './externalAgents';
import type { Tool } from './tools';
import type { SkillSummary } from './skills';
import { updateSystemPromptWithTools } from './systemPromptUpdater';
import type { TtsBackendFactory } from './tts/types';
import type { EventStore } from './events';
import { appendAndBroadcastChatEvents, createChatEventBase } from './events/chatEventUtils';
import {
  createBroadcastOutputAdapter,
  createTtsSession,
  resolveChatProvider,
  runChatCompletionCore,
} from './chatRunCore';
import { resolveSessionModelForRun, resolveSessionThinkingForRun } from './sessionModel';
import { attachPiSdkMessageToLastAssistant } from './history/piSessionSync';

export interface ChatProcessorOptions {
  sessionId: string;
  state: LogicalSessionState;
  text: string;
  responseId?: string;
  sessionHub: SessionHub;
  envConfig: EnvConfig;
  chatCompletionTools: unknown[];
  availableTools?: Tool[];
  availableSkills?: SkillSummary[];
  handleChatToolCalls: (
    sessionId: string,
    state: LogicalSessionState,
    toolCalls: ChatCompletionToolCallState[],
  ) => Promise<void>;
  outputMode?: 'text' | 'speech' | 'both';
  ttsBackendFactory?: TtsBackendFactory | null;
  clientAudioCapabilities?: { audioOut?: boolean };
  excludeConnection?: SessionConnection;
  /**
   * Optional metadata for messages that originate from another agent
   * via agents_message. When provided, the user turn is logged
   * as an agent_message record instead of a user_message.
   */
  agentMessageContext?: {
    fromSessionId: string;
    fromAgentId?: string;
    responseId?: string;
    /**
     * Optional override for how the message is logged when it
     * originates from another agent. When omitted, the message is
     * logged as an agent_message. When set to "none", no agent
     * message log record is written but the client still receives a
     * user_message event with agent attribution. When set to "callback",
     * ChatEvents are emitted for the response but the input text is not
     * shown as a user message (used for async agent callbacks).
     */
    logType?: 'agent_message' | 'none' | 'callback';
  };
  log?: (...args: unknown[]) => void;
  eventStore?: EventStore;
}

export interface ChatToolCallMetric {
  name: string;
  durationMs: number;
}

export interface ChatProcessorResult {
  responseId: string;
  response: string;
  truncated: boolean;
  toolCallCount: number;
  toolCalls: ChatToolCallMetric[];
  durationMs: number;
  thinkingText?: string;
}

export function isSessionBusy(sessionState: LogicalSessionState): boolean {
  return !!sessionState.activeChatRun;
}

export async function processUserMessage(
  options: ChatProcessorOptions,
): Promise<ChatProcessorResult> {
  const {
    sessionId,
    state,
    text,
    sessionHub,
    envConfig,
    chatCompletionTools,
    availableTools,
    availableSkills,
    handleChatToolCalls,
    outputMode = 'text',
    ttsBackendFactory = null,
    clientAudioCapabilities,
    excludeConnection,
    agentMessageContext,
    log = () => undefined,
    eventStore,
  } = options;

  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error('Text input must not be empty');
  }

  if (state.deleted) {
    throw new Error('Session has been deleted');
  }

  if (state.activeChatRun) {
    throw new Error('Session is busy');
  }

  const shouldUpdatePrompt =
    availableTools !== undefined || (availableSkills && availableSkills.length > 0);
  if (shouldUpdatePrompt) {
    await updateSystemPromptWithTools({
      state,
      sessionHub,
      tools: availableTools ?? [],
      ...(availableSkills ? { skills: availableSkills } : {}),
      log,
    });
  }

  // Emit ChatEvents unless logType is 'none'. 'callback' emits events but skips user_message.
  const logType = agentMessageContext?.logType;
  const shouldEmitChatEvents = !!eventStore && logType !== 'none';
  const turnId = shouldEmitChatEvents ? randomUUID() : undefined;

  const startTime = Date.now();
  const responseId = options.responseId ?? randomUUID();
  const agentExchangeId = agentMessageContext?.responseId;

  console.log('[chatProcessor] processUserMessage start', {
    sessionId,
    responseId,
    agentId: state.summary.agentId,
    isAgentMessage: !!agentMessageContext,
    fromAgentId: agentMessageContext?.fromAgentId,
    agentMessageLogType: agentMessageContext?.logType ?? 'agent_message',
    textPreview: trimmedText.slice(0, 100),
  });

  const agentId = state.summary.agentId;
  const agent = agentId ? sessionHub.getAgentRegistry().getAgent(agentId) : undefined;
  const { agentType, provider: chatProvider } = resolveChatProvider(agent);
  if (shouldEmitChatEvents && eventStore && turnId) {
    const trigger: TurnStartTrigger = agentMessageContext
      ? logType === 'callback'
        ? 'callback'
        : 'system'
      : 'user';

    const events: ChatEvent[] = [
      {
        ...createChatEventBase({
          sessionId,
          ...(turnId ? { turnId } : {}),
        }),
        type: 'turn_start',
        payload: { trigger },
      },
    ];

    // Skip user_message for 'callback' (internal callback text shouldn't be shown)
    const skipUserMessage = logType === 'callback';
    if (!skipUserMessage) {
      const userPayload: { text: string; fromAgentId?: string; fromSessionId?: string } = {
        text: trimmedText,
      };
      const fromAgentId =
        typeof agentMessageContext?.fromAgentId === 'string'
          ? agentMessageContext.fromAgentId.trim()
          : '';
      const fromSessionId =
        typeof agentMessageContext?.fromSessionId === 'string'
          ? agentMessageContext.fromSessionId.trim()
          : '';
      if (fromAgentId) {
        userPayload.fromAgentId = fromAgentId;
      }
      if (fromSessionId) {
        userPayload.fromSessionId = fromSessionId;
      }
      events.push({
        ...createChatEventBase({
          sessionId,
          ...(turnId ? { turnId } : {}),
        }),
        type: 'user_message',
        payload: userPayload,
      });
    }

    void appendAndBroadcastChatEvents(
      {
        eventStore,
        sessionHub,
        sessionId,
      },
      events,
    );
  }
  void sessionHub.recordSessionActivity(
    sessionId,
    trimmedText.length > 120 ? `${trimmedText.slice(0, 117)}…` : trimmedText,
  );

  const userBroadcast: ServerUserMessageMessage = {
    type: 'user_message',
    sessionId,
    text: trimmedText,
    ...(agentMessageContext
      ? {
          fromSessionId: agentMessageContext.fromSessionId,
          ...(agentMessageContext.fromAgentId
            ? { fromAgentId: agentMessageContext.fromAgentId }
            : {}),
          agentMessageType:
            logType === 'callback' ? 'agent_callback' : 'agent_message',
          ...(agentExchangeId ? { agentExchangeId } : {}),
        }
      : {}),
  };
  if (excludeConnection) {
    sessionHub.broadcastToSessionExcluding(sessionId, userBroadcast, excludeConnection);
  } else {
    sessionHub.broadcastToSession(sessionId, userBroadcast);
  }

  let userMeta: ChatCompletionMessageMeta | undefined;
  if (agentMessageContext) {
    const fromAgentId =
      typeof agentMessageContext.fromAgentId === 'string'
        ? agentMessageContext.fromAgentId.trim()
        : '';
    const fromSessionId =
      typeof agentMessageContext.fromSessionId === 'string'
        ? agentMessageContext.fromSessionId.trim()
        : '';
    if (agentMessageContext.logType === 'callback') {
      userMeta = {
        source: 'callback',
        visibility: 'hidden',
        ...(fromAgentId ? { fromAgentId } : {}),
        ...(fromSessionId ? { fromSessionId } : {}),
      };
    } else {
      userMeta = {
        source: 'agent',
        visibility: 'visible',
        ...(fromAgentId ? { fromAgentId } : {}),
        ...(fromSessionId ? { fromSessionId } : {}),
      };
    }
  }

  const userMessage: ChatCompletionMessage = {
    role: 'user',
    content: trimmedText,
    ...(userMeta ? { meta: userMeta } : {}),
  };
  state.chatMessages.push(userMessage);

  if (agentType === 'external') {
    const external = agent?.external;
    if (!agentId || !external) {
      throw new Error('External agent configuration is missing');
    }

    const callbackUrl = buildExternalCallbackUrl({
      callbackBaseUrl: external.callbackBaseUrl,
      sessionId,
    });

    await postExternalUserInput({
      inputUrl: external.inputUrl,
      payload: {
        sessionId,
        agentId,
        callbackUrl,
        message: {
          type: 'user',
          text: trimmedText,
          createdAt: new Date().toISOString(),
        },
      },
      timeoutMs: 5000,
    });

    const durationMs = Date.now() - startTime;
    return {
      responseId,
      response: '',
      truncated: false,
      toolCallCount: 0,
      toolCalls: [],
      durationMs,
    };
  }

  const abortController = new AbortController();
  const abortSignal = abortController.signal;
  const ttsAudioOut =
    typeof clientAudioCapabilities?.audioOut === 'boolean'
      ? { audioOut: clientAudioCapabilities.audioOut }
      : undefined;

  const ttsSession = createTtsSession({
    sessionId,
    responseId,
    abortSignal,
    outputMode,
    ttsBackendFactory,
    ...(ttsAudioOut ? { clientAudioCapabilities: ttsAudioOut } : {}),
  });

  state.activeChatRun = {
    responseId,
    abortController,
    accumulatedText: '',
    activeToolCalls: new Map(),
    ...(turnId ? { turnId } : {}),
    ...(agentExchangeId ? { agentExchangeId } : {}),
    ...(ttsSession ? { ttsSession } : {}),
  };

  let fullText = '';
  let thinkingText = '';

  const toolCallMetrics: ChatToolCallMetric[] = [];

  try {
    const output = createBroadcastOutputAdapter(sessionHub, sessionId);
    const runResult = await runChatCompletionCore({
      sessionId,
      state,
      text: trimmedText,
      responseId,
      provider: chatProvider,
      envConfig,
      chatCompletionTools,
      handleChatToolCalls,
      sessionHub,
      output,
      abortController,
      shouldEmitChatEvents,
      includeAgentExchangeIdInMessages: true,
      trackTextStartedAt: false,
      onToolCallMetric: (toolName, durationMs) => {
        toolCallMetrics.push({ name: toolName, durationMs });
      },
      log,
      ...(agent ? { agent } : {}),
      ...(eventStore ? { eventStore } : {}),
      ...(turnId ? { turnId } : {}),
    });

    const wasAborted = runResult.aborted || abortSignal.aborted;
    if (wasAborted) {
      const piSessionWriter = sessionHub.getPiSessionWriter?.();
      if (piSessionWriter && runResult.provider === 'pi') {
        try {
          const modelSpec = resolveSessionModelForRun({ agent, summary: state.summary });
          const thinkingLevel = resolveSessionThinkingForRun({ agent, summary: state.summary });
          const defaultProvider = (agent?.chat?.config as PiSdkChatConfig | undefined)?.provider;
          const messages = attachPiSdkMessageToLastAssistant({
            messages: state.chatMessages,
            ...(runResult.piSdkMessage ? { piSdkMessage: runResult.piSdkMessage } : {}),
          });
          const updatedSummary = await piSessionWriter.sync({
            summary: state.summary,
            messages,
            ...(modelSpec ? { modelSpec } : {}),
            ...(defaultProvider ? { defaultProvider } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
            updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
          });
          if (updatedSummary) {
            state.summary = updatedSummary;
          }
        } catch (err) {
          log('failed to sync Pi session history', err);
        }
      }
    }

    if (runResult.aborted) {
      throw new Error('Chat run aborted');
    }

    fullText = runResult.fullText;
    thinkingText = runResult.thinkingText;

    const shouldLogAssistant =
      !abortSignal.aborted && (fullText.length > 0 || thinkingText.length > 0);

    if (shouldLogAssistant) {
      const active = state.activeChatRun;
      const ttsSessionForRun = active?.ttsSession;

      const doneMessage: ServerTextDoneMessage = {
        type: 'text_done',
        responseId,
        text: fullText,
        ...(agentExchangeId ? { agentExchangeId } : {}),
      };
      console.log('[chatProcessor] broadcasting text_done', {
        sessionId,
        responseId,
        agentExchangeId: agentExchangeId ?? null,
      });
      sessionHub.broadcastToSession(sessionId, doneMessage);

      if (shouldEmitChatEvents && eventStore && turnId) {
        const events: ChatEvent[] = [
          {
            ...createChatEventBase({
              sessionId,
              ...(turnId ? { turnId } : {}),
              responseId,
            }),
            type: 'assistant_done',
            payload: { text: fullText },
          },
          {
            ...createChatEventBase({
              sessionId,
              ...(turnId ? { turnId } : {}),
            }),
            type: 'turn_end',
            payload: {},
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

      if (ttsSessionForRun) {
        await ttsSessionForRun.finish();
      }
      void sessionHub.recordSessionActivity(
        sessionId,
        fullText.length > 120 ? `${fullText.slice(0, 117)}…` : fullText,
      );
      state.chatMessages.push({
        role: 'assistant',
        content: fullText,
        ...(runResult.piSdkMessage ? { piSdkMessage: runResult.piSdkMessage } : {}),
      });

      const piSessionWriter = sessionHub.getPiSessionWriter?.();
      if (piSessionWriter && runResult.provider === 'pi') {
        try {
          const modelSpec = resolveSessionModelForRun({ agent, summary: state.summary });
          const thinkingLevel = resolveSessionThinkingForRun({ agent, summary: state.summary });
          const defaultProvider = (agent?.chat?.config as PiSdkChatConfig | undefined)?.provider;
          const updatedSummary = await piSessionWriter.sync({
            summary: state.summary,
            messages: state.chatMessages,
            ...(modelSpec ? { modelSpec } : {}),
            ...(defaultProvider ? { defaultProvider } : {}),
            ...(thinkingLevel ? { thinkingLevel } : {}),
            updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
          });
          if (updatedSummary) {
            state.summary = updatedSummary;
          }
        } catch (err) {
          log('failed to sync Pi session history', err);
        }
      }
    }

    const durationMs = Date.now() - startTime;

    let responseText = fullText;
    let truncated = false;
    const maxBytes = 10_000;
    const byteLength = Buffer.byteLength(responseText, 'utf8');
    if (byteLength > maxBytes) {
      truncated = true;
      let current = responseText;
      while (current.length > 0 && Buffer.byteLength(current, 'utf8') > maxBytes) {
        current = current.slice(0, -1);
      }
      responseText = current;
    }

    const toolCallCount = toolCallMetrics.length;

    console.log('[chatProcessor] processUserMessage complete', {
      sessionId,
      responseId,
      durationMs,
      toolCallCount,
      responseLength: responseText.length,
      truncated,
    });

    return {
      responseId,
      response: responseText,
      truncated,
      toolCallCount,
      toolCalls: toolCallMetrics,
      durationMs,
      ...(thinkingText ? { thinkingText } : {}),
    };
  } finally {
    if (state.activeChatRun && state.activeChatRun.responseId === responseId) {
      state.activeChatRun = undefined;
    }
    void sessionHub.processNextQueuedMessage(sessionId);
  }
}
