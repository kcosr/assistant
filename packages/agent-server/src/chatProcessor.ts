import { randomUUID } from 'node:crypto';

import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';
import type {
  ServerTextDoneMessage,
  ServerUserAudioMessage,
  ServerUserMessageMessage,
} from '@assistant/shared';
import type { ChatEvent, TurnStartTrigger } from '@assistant/shared';

import type {
  ChatCompletionMessage,
  ChatCompletionMessageMeta,
  ChatCompletionToolCallState,
} from './chatCompletionTypes';
import type { AgentDefinition, PiSdkChatConfig } from './agents';
import type { EnvConfig } from './envConfig';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { SessionConnection } from './ws/sessionConnection';
import { buildExternalCallbackUrl, postExternalUserInput } from './externalAgents';
import type { AgentTool, Tool } from './tools';
import type { SkillSummary } from './skills';
import { updateSystemPromptWithTools } from './systemPromptUpdater';
import type { TtsBackendFactory } from './tts/types';
import type { EventStore } from './events';
import { appendAndBroadcastChatEvents, createChatEventBase } from './events/chatEventUtils';
import {
  createBroadcastOutputAdapter,
  createTtsSession,
  ChatRunError,
  isChatRunError,
  logDebugChatEventRecord,
  previewDebugText,
  resolveChatProvider,
  runChatCompletionCore,
} from './chatRunCore';
import { finalizeChatTurn } from './chatTurnFinalization';
import { extractAssistantTextBlocksFromPiMessage } from './llm/piSdkProvider';
import { resolveSessionModelForRun, resolveSessionThinkingForRun } from './sessionModel';
import { resolveVisibleAssistantText } from './piAssistantText';
import { buildMessagesForPiSync } from './history/piSessionSync';

function buildAssistantDoneEvents(options: {
  sessionId: string;
  turnId?: string;
  responseId: string;
  fullText: string;
  piSdkMessage: PiSdkMessage | undefined;
}): ChatEvent[] {
  const { sessionId, turnId, responseId, fullText, piSdkMessage } = options;
  const base = createChatEventBase({
    sessionId,
    ...(turnId ? { turnId } : {}),
    responseId,
  });
  const piBlocks = extractAssistantTextBlocksFromPiMessage(piSdkMessage);
  if (piBlocks.length > 0) {
    return piBlocks
      .filter((block) => block.text.trim().length > 0)
      .map((block) => ({
        ...base,
        id: randomUUID(),
        type: 'assistant_done' as const,
        payload: {
          text: block.text,
          ...(block.phase ? { phase: block.phase } : {}),
          ...(block.textSignature ? { textSignature: block.textSignature } : {}),
        },
      }));
  }
  if (!fullText.trim()) {
    return [];
  }
  return [
    {
      ...base,
      id: randomUUID(),
      type: 'assistant_done',
      payload: { text: fullText },
    },
  ];
}

async function persistInterruptedPiAssistantMessage(options: {
  sessionId: string;
  state: LogicalSessionState;
  sessionHub: SessionHub;
  agent: AgentDefinition | undefined;
  piSessionWriter: NonNullable<ReturnType<SessionHub['getPiSessionWriter']>>;
  runResult: {
    provider: string;
    fullText: string;
    piSdkMessage?: PiSdkMessage;
    piReplayMessages?: ChatCompletionMessage[];
  };
  log: (...args: unknown[]) => void;
}): Promise<void> {
  const { sessionId, state, sessionHub, agent, piSessionWriter, runResult, log } = options;
  if (runResult.provider !== 'pi' || !runResult.piSdkMessage) {
    return;
  }

  try {
    const active = state.activeChatRun;
    const visibleAssistant = resolveVisibleAssistantText({
      fullText: runResult.fullText,
      piSdkMessage: runResult.piSdkMessage,
    });
    const assistantTimestampMs =
      (runResult.piSdkMessage.role === 'assistant' &&
      Number.isFinite(runResult.piSdkMessage.timestamp)
        ? runResult.piSdkMessage.timestamp
        : undefined) ??
      (active?.textStartedAt ? Date.parse(active.textStartedAt) : undefined) ??
      Date.now();
    const modelSpec = resolveSessionModelForRun({ agent, summary: state.summary });
    const thinkingLevel = resolveSessionThinkingForRun({ agent, summary: state.summary });
    const defaultProvider = (agent?.chat?.config as PiSdkChatConfig | undefined)?.provider;
    const finalAssistantMessage: ChatCompletionMessage & { role: 'assistant' } = {
      role: 'assistant',
      content: visibleAssistant.text,
      historyTimestampMs: assistantTimestampMs,
      piSdkMessage: runResult.piSdkMessage,
    };
    const replayMessages = runResult.piReplayMessages;
    const messagesForPiSync =
      replayMessages && replayMessages !== state.chatMessages
        ? buildMessagesForPiSync({
            stateMessages: state.chatMessages,
            replayMessages,
            finalAssistantMessage,
          })
        : [...state.chatMessages, finalAssistantMessage];
    const updatedSummary = await piSessionWriter.sync({
      summary: state.summary,
      messages: messagesForPiSync,
      ...(modelSpec ? { modelSpec } : {}),
      ...(defaultProvider ? { defaultProvider } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
    });
    if (updatedSummary) {
      state.summary = updatedSummary;
    }
  } catch (err) {
    log('failed to sync interrupted Pi session history', err);
  }
}

export interface ChatProcessorOptions {
  sessionId: string;
  state: LogicalSessionState;
  text: string;
  requestId?: string;
  responseId?: string;
  sessionHub: SessionHub;
  envConfig: EnvConfig;
  chatCompletionTools: unknown[];
  agentTools?: AgentTool[];
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
    callbackEvent?: {
      messageId: string;
      fromAgentId?: string;
      fromSessionId: string;
      result: string;
    };
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
  userInput?: {
    type: 'audio';
    durationMs: number;
  };
  log?: (...args: unknown[]) => void;
  eventStore?: EventStore;
  externalAbortSignal?: AbortSignal;
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
    requestId: requestIdOption,
    sessionHub,
    envConfig,
    chatCompletionTools,
    agentTools = [],
    availableTools,
    availableSkills,
    handleChatToolCalls,
    outputMode = 'text',
    ttsBackendFactory = null,
    clientAudioCapabilities,
    excludeConnection,
    agentMessageContext,
    userInput,
    log = () => undefined,
    eventStore,
    externalAbortSignal,
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

  const startTime = Date.now();
  const responseId = options.responseId ?? randomUUID();
  const requestId = requestIdOption ?? responseId;
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
  const turnId = shouldEmitChatEvents || chatProvider === 'pi' ? randomUUID() : undefined;
  const piSessionWriter = sessionHub.getPiSessionWriter?.();
  if (piSessionWriter && chatProvider === 'pi' && turnId) {
    const trigger: TurnStartTrigger =
      agentMessageContext?.logType === 'callback' ? 'callback' : 'user';
    try {
      const updatedSummary = await piSessionWriter.appendTurnStart({
        summary: state.summary,
        turnId,
        trigger,
        updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
      });
      if (updatedSummary) {
        state.summary = updatedSummary;
      }
      if (
        !shouldEmitChatEvents &&
        agentMessageContext?.logType === 'callback' &&
        agentMessageContext.callbackEvent
      ) {
        const updatedSummaryFromEvent = await piSessionWriter.appendAssistantEvent({
          summary: state.summary,
          eventType: 'agent_callback',
          payload: {
            messageId: agentMessageContext.callbackEvent.messageId,
            ...(agentMessageContext.callbackEvent.fromAgentId
              ? { fromAgentId: agentMessageContext.callbackEvent.fromAgentId }
              : {}),
            fromSessionId: agentMessageContext.callbackEvent.fromSessionId,
            result: agentMessageContext.callbackEvent.result,
          },
          turnId,
          updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
        });
        if (updatedSummaryFromEvent) {
          state.summary = updatedSummaryFromEvent;
        }
      }
    } catch (err) {
      log('failed to append Pi turn start', err);
    }
  }
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
    if (logType === 'callback' && agentMessageContext?.callbackEvent) {
      events.push({
        ...createChatEventBase({
          sessionId,
          ...(turnId ? { turnId } : {}),
        }),
        type: 'agent_callback',
        payload: {
          messageId: agentMessageContext.callbackEvent.messageId,
          fromAgentId: agentMessageContext.callbackEvent.fromAgentId ?? 'unknown',
          fromSessionId: agentMessageContext.callbackEvent.fromSessionId,
          result: agentMessageContext.callbackEvent.result,
        },
      });
    }

    // Skip user_message for 'callback' (internal callback text shouldn't be shown)
    const skipUserMessage = logType === 'callback';
    if (!skipUserMessage) {
      const fromAgentId =
        typeof agentMessageContext?.fromAgentId === 'string'
          ? agentMessageContext.fromAgentId.trim()
          : '';
      const fromSessionId =
        typeof agentMessageContext?.fromSessionId === 'string'
          ? agentMessageContext.fromSessionId.trim()
          : '';
      const userEventBase = createChatEventBase({
        sessionId,
        ...(turnId ? { turnId } : {}),
      });
      if (!agentMessageContext && userInput?.type === 'audio') {
        events.push({
          ...userEventBase,
          type: 'user_audio',
          payload: {
            transcription: trimmedText,
            durationMs: userInput.durationMs,
          },
        });
      } else {
        const userPayload: { text: string; fromAgentId?: string; fromSessionId?: string } = {
          text: trimmedText,
        };
        if (fromAgentId) {
          userPayload.fromAgentId = fromAgentId;
        }
        if (fromSessionId) {
          userPayload.fromSessionId = fromSessionId;
        }
        events.push({
          ...userEventBase,
          type: 'user_message',
          payload: userPayload,
        });
      }
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

  const userBroadcast: ServerUserMessageMessage | ServerUserAudioMessage =
    !agentMessageContext && userInput?.type === 'audio'
      ? {
          type: 'user_audio',
          sessionId,
          transcription: trimmedText,
          durationMs: userInput.durationMs,
          requestId,
        }
      : {
          type: 'user_message',
          sessionId,
          text: trimmedText,
          requestId,
          ...(agentMessageContext
            ? {
                fromSessionId: agentMessageContext.fromSessionId,
                ...(agentMessageContext.fromAgentId
                  ? { fromAgentId: agentMessageContext.fromAgentId }
                  : {}),
                agentMessageType: logType === 'callback' ? 'agent_callback' : 'agent_message',
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
    historyTimestampMs: Date.now(),
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
  const onExternalAbort = () => abortController.abort(externalAbortSignal?.reason);
  if (externalAbortSignal) {
    if (externalAbortSignal.aborted) {
      abortController.abort(externalAbortSignal.reason);
    } else {
      externalAbortSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }
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
    requestId,
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

  const buildInterruptedAssistantEvents = (): ChatEvent[] => {
    const run = state.activeChatRun;
    const partialText = run?.accumulatedText?.trim() ?? '';
    if (!run?.turnId || !partialText) {
      return [];
    }
    return [
      {
        ...createChatEventBase({
          sessionId,
          turnId: run.turnId,
          ...(run.responseId ? { responseId: run.responseId } : {}),
        }),
        type: 'assistant_done',
        payload: {
          text: partialText,
          interrupted: true,
        },
      },
    ];
  };

  try {
    const output = createBroadcastOutputAdapter(sessionHub, sessionId);
    const runResult = await runChatCompletionCore({
      sessionId,
      state,
      text: trimmedText,
      requestId,
      responseId,
      provider: chatProvider,
      envConfig,
      chatCompletionTools,
      agentTools,
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
      const timedOut =
        runResult.abortReason === 'timeout' ||
        abortSignal.reason === 'timeout' ||
        externalAbortSignal?.reason === 'timeout';
      if (runResult.provider === 'pi' && runResult.piReplayMessages) {
        state.chatMessages = runResult.piReplayMessages;
      }
      if (piSessionWriter && runResult.provider === 'pi') {
        await persistInterruptedPiAssistantMessage({
          sessionId,
          state,
          sessionHub,
          agent,
          piSessionWriter,
          runResult,
          log,
        });
      }
      await finalizeChatTurn({
        sessionId,
        state,
        sessionHub,
        run: state.activeChatRun,
        log,
        ...(eventStore ? { eventStore } : {}),
        ...(timedOut
          ? {
              interruptReason: 'timeout' as const,
              error: {
                code: 'upstream_timeout',
                message: 'Chat backend request timed out',
              },
              prependEvents: buildInterruptedAssistantEvents(),
            }
          : {}),
        ...(runResult.provider === 'pi' ? { piTurnEndStatus: 'interrupted' as const } : {}),
      });
      if (timedOut) {
        throw new ChatRunError('upstream_timeout', 'Chat backend request timed out', {
          retryable: true,
        });
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
      const visibleAssistant = resolveVisibleAssistantText({
        fullText,
        ...(runResult.piSdkMessage ? { piSdkMessage: runResult.piSdkMessage } : {}),
      });

      const doneMessage: ServerTextDoneMessage = {
        type: 'text_done',
        responseId,
        requestId,
        text: visibleAssistant.text,
        ...(visibleAssistant.phase ? { phase: visibleAssistant.phase } : {}),
        ...(visibleAssistant.textSignature
          ? { textSignature: visibleAssistant.textSignature }
          : {}),
        ...(agentExchangeId ? { agentExchangeId } : {}),
      };
      console.log('[chatProcessor] broadcasting text_done', {
        sessionId,
        responseId,
        agentExchangeId: agentExchangeId ?? null,
      });
      sessionHub.broadcastToSession(sessionId, doneMessage);

      if (shouldEmitChatEvents && eventStore && turnId) {
        const assistantDoneEvents = buildAssistantDoneEvents({
          sessionId,
          turnId,
          responseId,
          fullText,
          piSdkMessage: runResult.piSdkMessage,
        }) as Array<Extract<ChatEvent, { type: 'assistant_done' }>>;
        for (const event of assistantDoneEvents) {
          logDebugChatEventRecord({
            enabled: envConfig.debugChatCompletions,
            dataDir: envConfig.dataDir,
            log,
            record: {
              timestamp: new Date().toISOString(),
              direction: 'event',
              eventType: 'assistant_done',
              provider: runResult.provider,
              sessionId,
              responseId,
              ...(turnId ? { turnId } : {}),
              phase: event.payload.phase ?? null,
              textLength: event.payload.text.length,
              textPreview: previewDebugText(event.payload.text),
              interrupted: event.payload.interrupted ?? false,
            },
          });
        }
        const events: ChatEvent[] = [
          ...assistantDoneEvents,
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
        visibleAssistant.text.length > 120
          ? `${visibleAssistant.text.slice(0, 117)}…`
          : visibleAssistant.text,
      );
      const assistantTimestampMs =
        (runResult.piSdkMessage &&
        runResult.piSdkMessage.role === 'assistant' &&
        Number.isFinite(runResult.piSdkMessage.timestamp)
          ? runResult.piSdkMessage.timestamp
          : undefined) ??
        (active?.textStartedAt ? Date.parse(active.textStartedAt) : undefined) ??
        Date.now();
      const finalAssistantMessage: ChatCompletionMessage & { role: 'assistant' } = {
        role: 'assistant',
        content: visibleAssistant.text,
        historyTimestampMs: assistantTimestampMs,
        ...(runResult.piSdkMessage ? { piSdkMessage: runResult.piSdkMessage } : {}),
      };
      if (runResult.provider === 'pi' && runResult.piReplayMessages) {
        state.chatMessages = runResult.piReplayMessages;
      }
      state.chatMessages.push(finalAssistantMessage);

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

    await finalizeChatTurn({
      sessionId,
      state,
      sessionHub,
      run: state.activeChatRun,
      log,
      ...(eventStore ? { eventStore } : {}),
      ...(chatProvider === 'pi' ? { piTurnEndStatus: 'completed' as const } : {}),
    });

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
  } catch (err) {
    const wasOutputCancelled = state.activeChatRun?.outputCancelled === true;
    const timedOut = abortSignal.reason === 'timeout' || externalAbortSignal?.reason === 'timeout';

    if (!wasOutputCancelled) {
      await finalizeChatTurn({
        sessionId,
        state,
        sessionHub,
        run: state.activeChatRun,
        log,
        ...(eventStore ? { eventStore } : {}),
        interruptReason: timedOut ? 'timeout' : 'error',
        error: {
          code: timedOut ? 'upstream_timeout' : isChatRunError(err) ? err.code : 'upstream_error',
          message:
            timedOut
              ? 'Chat backend request timed out'
              : isChatRunError(err)
                ? err.message
                : 'Chat backend error',
        },
        prependEvents: buildInterruptedAssistantEvents(),
        ...(chatProvider === 'pi' ? { piTurnEndStatus: 'interrupted' as const } : {}),
      });
    }

    if (timedOut) {
      throw new ChatRunError('upstream_timeout', 'Chat backend request timed out', {
        retryable: true,
      });
    }
    if (isChatRunError(err)) {
      throw err;
    }
    throw new ChatRunError('upstream_error', 'Chat backend error', {
      error: String(err),
      retryable: true,
    });
  } finally {
    if (externalAbortSignal) {
      externalAbortSignal.removeEventListener('abort', onExternalAbort);
    }
    if (state.activeChatRun && state.activeChatRun.responseId === responseId) {
      state.activeChatRun = undefined;
    }
    void sessionHub.processNextQueuedMessage(sessionId);
  }
}
