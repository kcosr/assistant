import { randomUUID } from 'node:crypto';

import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';
import type {
  ChatEvent,
  ClientAudioCapabilities,
  ClientTextInputMessage,
  OutputMode,
  ServerTextDoneMessage,
  ServerUserMessageMessage,
} from '@assistant/shared';

import type { ChatCompletionMessage, ChatCompletionToolCallState } from '../chatCompletionTypes';
import type { AgentDefinition, PiSdkChatConfig } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { TtsBackendFactory } from '../tts/types';
import type { EventStore } from '../events';
import { appendAndBroadcastChatEvents, createChatEventBase } from '../events/chatEventUtils';

import type { SessionConnection } from './sessionConnection';
import { buildExternalCallbackUrl, postExternalUserInput } from '../externalAgents';
import {
  createBroadcastOutputAdapter,
  createTtsSession,
  logDebugChatEventRecord,
  previewDebugText,
  isChatRunError,
  resolveChatProvider,
  runChatCompletionCore,
} from '../chatRunCore';
import { finalizeChatTurn } from '../chatTurnFinalization';
import { extractAssistantTextBlocksFromPiMessage } from '../llm/piSdkProvider';
import { resolveVisibleAssistantText } from '../piAssistantText';
import { resolveSessionModelForRun, resolveSessionThinkingForRun } from '../sessionModel';
import { buildMessagesForPiSync } from '../history/piSessionSync';
import type { AgentTool } from '../tools';

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

export async function handleTextInputWithChatCompletions(options: {
  message: ClientTextInputMessage;
  state: LogicalSessionState | undefined;
  sessionId: string | undefined;
  connection: SessionConnection;
  sessionHub: SessionHub;
  config: EnvConfig;
  chatCompletionTools: unknown[];
  agentTools?: AgentTool[];
  outputMode: OutputMode;
  clientAudioCapabilities: ClientAudioCapabilities | undefined;
  ttsBackendFactory: TtsBackendFactory | null;
  handleChatToolCalls: (
    sessionId: string,
    state: LogicalSessionState,
    toolCalls: ChatCompletionToolCallState[],
  ) => Promise<void>;
  setActiveRunState: (active: { sessionId: string; state: LogicalSessionState }) => void;
  clearActiveRunState: (expected: { sessionId: string; state: LogicalSessionState }) => void;
  sendError: (
    code: string,
    message: string,
    details?: unknown,
    options?: { retryable?: boolean },
  ) => void;
  log: (...args: unknown[]) => void;
  eventStore: EventStore;
  debugChatCompletionsContext?: unknown;
}): Promise<void> {
  const {
    message,
    state,
    sessionId,
    connection,
    sessionHub,
    config: envConfig,
    chatCompletionTools,
    agentTools = [],
    outputMode,
    clientAudioCapabilities,
    ttsBackendFactory,
    handleChatToolCalls,
    setActiveRunState,
    clearActiveRunState,
    sendError,
    log,
    eventStore,
    debugChatCompletionsContext,
  } = options;

  if (!state || !sessionId) {
    sendError('session_not_ready', 'Session is not ready yet');
    return;
  }

  if (state.deleted || state.summary.deleted) {
    sendError(
      'session_deleted',
      'This session has been deleted; please switch to another session.',
    );
    return;
  }

  const text = message.text.trim();
  if (!text) {
    sendError('empty_text', 'Text input must not be empty');
    return;
  }

  const requestId = randomUUID();

  if (state.activeChatRun) {
    const queuedMessage: ClientTextInputMessage = { ...message, text };
    try {
      await sessionHub.queueMessage({
        sessionId,
        text,
        source: 'user',
        ...(message.clientMessageId ? { clientMessageId: message.clientMessageId } : {}),
        execute: async () => {
          const latestState =
            sessionHub.getSessionState(sessionId) ??
            (await sessionHub.ensureSessionState(sessionId));
          await handleTextInputWithChatCompletions({
            ...options,
            message: queuedMessage,
            state: latestState,
            sessionId,
          });
        },
      });
    } catch (err) {
      sendError(
        'queue_error',
        'Failed to queue message while assistant was busy.',
        { error: String(err) },
        { retryable: true },
      );
    }
    return;
  }

  const agentId = state.summary.agentId;
  const agent = agentId ? sessionHub.getAgentRegistry().getAgent(agentId) : undefined;
  const { agentType, provider: chatProvider } = resolveChatProvider(agent);
  const piSessionWriter = sessionHub.getPiSessionWriter?.();

  const shouldEmitChatEvents = !!eventStore || chatProvider === 'pi';
  const turnId = shouldEmitChatEvents ? randomUUID() : undefined;

  if (piSessionWriter && chatProvider === 'pi' && turnId) {
    try {
      const updatedSummary = await piSessionWriter.appendTurnStart({
        summary: state.summary,
        turnId,
        trigger: 'user',
        updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
      });
      if (updatedSummary) {
        state.summary = updatedSummary;
      }
    } catch (err) {
      log('failed to append Pi turn start', err);
    }
  }

  void sessionHub.recordSessionActivity(
    sessionId,
    text.length > 120 ? `${text.slice(0, 117)}…` : text,
  );

  const userBroadcast: ServerUserMessageMessage = {
    type: 'user_message',
    sessionId,
    text,
    requestId,
  };
  if (chatProvider !== 'pi') {
    sessionHub.broadcastToSessionExcluding(sessionId, userBroadcast, connection);
  }

  if ((shouldEmitChatEvents && eventStore && sessionId) || (chatProvider === 'pi' && turnId)) {
    const events: ChatEvent[] = [
      {
        ...createChatEventBase({
          sessionId,
          ...(turnId ? { turnId } : {}),
        }),
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        ...createChatEventBase({
          sessionId,
          ...(turnId ? { turnId } : {}),
        }),
        type: 'user_message',
        payload: { text },
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

  // User message text now includes context line from client
  const userMessage: ChatCompletionMessage = {
    role: 'user',
    content: text,
    historyTimestampMs: Date.now(),
  };
  state.chatMessages.push(userMessage);

  if (agentType === 'external') {
    const external = agent?.external;
    if (!agentId || !external) {
      sendError('external_agent_error', 'External agent configuration is missing');
      return;
    }

    const callbackUrl = buildExternalCallbackUrl({
      callbackBaseUrl: external.callbackBaseUrl,
      sessionId,
    });

    try {
      await postExternalUserInput({
        inputUrl: external.inputUrl,
        payload: {
          sessionId,
          agentId,
          callbackUrl,
          message: {
            type: 'user',
            text,
            createdAt: new Date().toISOString(),
          },
        },
        timeoutMs: 5000,
      });
    } catch (err) {
      sendError('external_agent_error', 'Failed to forward message to external agent', {
        error: String(err),
      });
    }

    return;
  }

  const responseId = randomUUID();
  const abortController = new AbortController();
  const ttsAudioOut =
    typeof clientAudioCapabilities?.audioOut === 'boolean'
      ? { audioOut: clientAudioCapabilities.audioOut }
      : undefined;
  const ttsSession = createTtsSession({
    sessionId,
    responseId,
    abortSignal: abortController.signal,
    outputMode,
    ttsBackendFactory,
    ...(ttsAudioOut ? { clientAudioCapabilities: ttsAudioOut } : {}),
  });

  state.activeChatRun = {
    requestId,
    responseId,
    abortController,
    accumulatedText: '',
    ...(turnId ? { turnId } : {}),
    ...(ttsSession ? { ttsSession } : {}),
  };

  const activeRunState = { sessionId, state };
  setActiveRunState(activeRunState);

  let fullText = '';
  let thinkingText = '';
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
      text,
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
      includeAgentExchangeIdInMessages: false,
      trackTextStartedAt: true,
      ...(debugChatCompletionsContext !== undefined
        ? { debugChatCompletionsContext }
        : {}),
      log,
      ...(agent ? { agent } : {}),
      ...(eventStore ? { eventStore } : {}),
      ...(turnId ? { turnId } : {}),
    });

    const wasAborted = runResult.aborted || abortController.signal.aborted;
    if (wasAborted) {
      const timedOut =
        runResult.abortReason === 'timeout' || abortController.signal.reason === 'timeout';
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
        eventStore,
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
        sendError(
          'upstream_timeout',
          'Chat backend request timed out',
          undefined,
          { retryable: true },
        );
      }
      return;
    }

    fullText = runResult.fullText;
    thinkingText = runResult.thinkingText;

    const shouldLogAssistant =
      !abortController.signal.aborted && (fullText.length > 0 || thinkingText.length > 0);

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
        ...(visibleAssistant.textSignature ? { textSignature: visibleAssistant.textSignature } : {}),
      };
      sessionHub.broadcastToSession(sessionId, doneMessage);

      if (shouldEmitChatEvents && turnId) {
        const events = buildAssistantDoneEvents({
          sessionId,
          turnId,
          responseId,
          fullText,
          piSdkMessage: runResult.piSdkMessage,
        }) as Array<Extract<ChatEvent, { type: 'assistant_done' }>>;
        for (const event of events) {
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
              ...(debugChatCompletionsContext !== undefined
                ? { debugContext: debugChatCompletionsContext }
                : {}),
              phase: event.payload.phase ?? null,
              textLength: event.payload.text.length,
              textPreview: previewDebugText(event.payload.text),
              interrupted: event.payload.interrupted ?? false,
            },
          });
        }
        void appendAndBroadcastChatEvents(
          {
            ...(eventStore ? { eventStore } : {}),
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
      eventStore,
      ...(chatProvider === 'pi' ? { piTurnEndStatus: 'completed' as const } : {}),
    });
  } catch (err) {
    const timedOut = abortController.signal.reason === 'timeout';
    if (state.activeChatRun?.outputCancelled === true) {
      return;
    }
    await finalizeChatTurn({
      sessionId,
      state,
      sessionHub,
      run: state.activeChatRun,
      log,
      eventStore,
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
    if (timedOut) {
      sendError(
        'upstream_timeout',
        'Chat backend request timed out',
        undefined,
        {
          retryable: true,
        },
      );
      return;
    }
    if (isChatRunError(err)) {
      sendError(err.code, err.message, err.details);
      return;
    }
    log('chat completions error', err);
    sendError(
      'upstream_error',
      'Chat backend error',
      { error: String(err) },
      {
        retryable: true,
      },
    );
  } finally {
    if (state.activeChatRun && state.activeChatRun.abortController === abortController) {
      state.activeChatRun = undefined;
    }
    const currentState = sessionHub.getSessionState?.(sessionId);
    if (
      currentState &&
      currentState.activeChatRun &&
      currentState.activeChatRun.abortController === abortController
    ) {
      currentState.activeChatRun = undefined;
    }
    clearActiveRunState(activeRunState);
    void sessionHub.processNextQueuedMessage(sessionId);
  }
}
