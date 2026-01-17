import { randomUUID } from 'node:crypto';

import OpenAI from 'openai';

import type {
  ChatEvent,
  ClientAudioCapabilities,
  ClientTextInputMessage,
  OutputMode,
  ServerTextDoneMessage,
  ServerUserMessageMessage,
} from '@assistant/shared';

import type { ChatCompletionMessage, ChatCompletionToolCallState } from '../chatCompletionTypes';
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
  ensureOpenAiConfigured,
  isChatRunError,
  resolveChatProvider,
  runChatCompletionCore,
} from '../chatRunCore';

export async function handleTextInputWithChatCompletions(options: {
  ready: boolean;
  message: ClientTextInputMessage;
  state: LogicalSessionState | undefined;
  sessionId: string | undefined;
  connection: SessionConnection;
  sessionHub: SessionHub;
  openaiClient?: OpenAI;
  config: EnvConfig;
  chatCompletionTools: unknown[];
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
}): Promise<void> {
  const {
    ready,
    message,
    state,
    sessionId,
    connection,
    sessionHub,
    openaiClient,
    config: envConfig,
    chatCompletionTools,
    outputMode,
    clientAudioCapabilities,
    ttsBackendFactory,
    handleChatToolCalls,
    setActiveRunState,
    clearActiveRunState,
    sendError,
    log,
    eventStore,
  } = options;

  if (!ready) {
    sendError('session_not_ready', 'Session is not ready yet');
    return;
  }

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
  const hadPriorUserMessages = state.chatMessages.some(
    (chatMessage) => chatMessage.role === 'user',
  );

  const shouldEmitChatEvents = !!eventStore;
  const turnId = shouldEmitChatEvents ? randomUUID() : undefined;

  void sessionHub.recordSessionActivity(
    sessionId,
    text.length > 120 ? `${text.slice(0, 117)}…` : text,
  );

  const userBroadcast: ServerUserMessageMessage = {
    type: 'user_message',
    sessionId,
    text,
  };
  sessionHub.broadcastToSessionExcluding(sessionId, userBroadcast, connection);

  if (shouldEmitChatEvents && eventStore && sessionId) {
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
        eventStore,
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

  if (chatProvider === 'openai') {
    try {
      ensureOpenAiConfigured(envConfig);
    } catch (err) {
      if (isChatRunError(err)) {
        sendError(err.code, err.message, err.details);
        return;
      }
      throw err;
    }
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

  try {
    const output = createBroadcastOutputAdapter(sessionHub, sessionId);
    const runResult = await runChatCompletionCore({
      sessionId,
      state,
      text,
      responseId,
      provider: chatProvider,
      hadPriorUserMessages,
      envConfig,
      chatCompletionTools,
      handleChatToolCalls,
      sessionHub,
      output,
      abortController,
      shouldEmitChatEvents,
      includeAgentExchangeIdInMessages: false,
      trackTextStartedAt: true,
      log,
      ...(agent ? { agent } : {}),
      ...(openaiClient ? { openaiClient } : {}),
      ...(eventStore ? { eventStore } : {}),
      ...(turnId ? { turnId } : {}),
    });

    if (runResult.aborted) {
      return;
    }

    fullText = runResult.fullText;
    thinkingText = runResult.thinkingText;

    const shouldLogAssistant =
      !abortController.signal.aborted && (fullText.length > 0 || thinkingText.length > 0);

    if (shouldLogAssistant) {
      const active = state.activeChatRun;
      const ttsSessionForRun = active?.ttsSession;

      const doneMessage: ServerTextDoneMessage = {
        type: 'text_done',
        responseId,
        text: fullText,
      };
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
      const ttsGenerated = ttsSessionForRun?.hasOutput() ?? false;
      const audioTruncatedAtMs =
        active && typeof active.audioTruncatedAtMs === 'number'
          ? active.audioTruncatedAtMs
          : undefined;
      void sessionHub.recordSessionActivity(
        sessionId,
        fullText.length > 120 ? `${fullText.slice(0, 117)}…` : fullText,
      );
      state.chatMessages.push({
        role: 'assistant',
        content: fullText,
      });
    }

    // Always send turn_end when the run completes (not aborted) to hide typing indicators
    if (!abortController.signal.aborted && shouldEmitChatEvents && eventStore && turnId) {
      void appendAndBroadcastChatEvents(
        {
          eventStore,
          sessionHub,
          sessionId,
        },
        [
          {
            ...createChatEventBase({
              sessionId,
              ...(turnId ? { turnId } : {}),
            }),
            type: 'turn_end',
            payload: {},
          },
        ],
      );
    }
  } catch (err) {
    if (abortController.signal.aborted) {
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
