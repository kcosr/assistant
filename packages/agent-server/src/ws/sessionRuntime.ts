import { randomUUID } from 'node:crypto';
import type { RawData } from 'ws';

import type OpenAI from 'openai';

import type {
  ClientAudioCapabilities,
  ClientCancelQueuedMessage,
  ClientControlMessage,
  ClientHelloMessage,
  ClientPanelEventMessage,
  ClientPingMessage,
  ClientQuestionnaireCancelMessage,
  ClientQuestionnaireSubmitMessage,
  ClientSetInteractionModeMessage,
  ClientSetModesMessage,
  ClientSetSessionModelMessage,
  ClientSetSessionThinkingMessage,
  ClientSubscribeMessage,
  ClientTextInputMessage,
  ClientToolInteractionResponseMessage,
  ClientUnsubscribeMessage,
  ChatEvent,
  InputMode,
  OutputMode,
  ServerErrorMessage,
  ServerMessage,
  ServerSessionReadyMessage,
  ServerSubscribedMessage,
  ServerUnsubscribedMessage,
} from '@assistant/shared';
import {
  CURRENT_PROTOCOL_VERSION,
  PanelInventoryPayloadSchema,
  validateQuestionnaireInput,
} from '@assistant/shared';

import { createScopedToolHost, mapToolsToChatCompletionSpecs, type ToolHost } from '../tools';
import { RateLimiter } from '../rateLimit';
import type { SessionHub } from '../sessionHub';
import type { LogicalSessionState } from '../sessionHub';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import { getAgentAvailableModels, getAgentAvailableThinkingLevels } from '../sessionModel';
import type { ChatCompletionToolCallState } from '../chatCompletionTypes';
import type { SearchService } from '../search/searchService';
import type { TtsBackendFactory } from '../tts/types';
import { selectTtsBackendFactory } from '../tts/selectTtsBackendFactory';
import { removePanelInventoryForConnection, updatePanelInventory } from '../panels/panelInventoryStore';
import { resolveToolExposure } from '../skills';
import type { ScheduledSessionService } from '../scheduledSessions/scheduledSessionService';

import { handleTextInputWithChatCompletions } from './chatRunLifecycle';
import { handleClientTextMessage } from './clientMessageDispatch';
import {
  applyClientSetModes,
  buildPongMessage,
  isOutputCancelControl,
} from './clientModesAndPingHandling';
import { handleChatOutputCancel as handleChatOutputCancelInternal } from './chatOutputCancelHandling';
import { handleHello as handleHelloMessage } from './helloHandling';
import type { SessionConnection } from './sessionConnection';
import { handleChatToolCalls as handleChatToolCallsInternal } from './toolCallHandling';
import { updateSystemPromptWithTools } from '../systemPromptUpdater';
import { filterSessionSkills, getSelectedSessionSkillIds } from '../sessionConfig';
import type { WsTransport } from './wsTransport';
import { appendAndBroadcastChatEvents, createChatEventBase } from '../events/chatEventUtils';
import { processUserMessage } from '../chatProcessor';
import { buildQuestionnaireCallbackText, getQuestionnaireState } from '../questionnaires';

export interface SessionRuntimeOptions {
  transport: WsTransport;
  connection: SessionConnection;
  connectionId?: string;
  config: EnvConfig;
  toolHost: ToolHost;
  sessionHub: SessionHub;
  openaiClient?: OpenAI;
  eventStore: EventStore;
  scheduledSessionService?: ScheduledSessionService;
  searchService?: SearchService;
}

type ToolResolutionDebugDetails = {
  availableToolsCount: number;
  visibleToolsCount: number;
  skillCount: number;
  toolNamesSample: string[];
  visibleToolNamesSample: string[];
  skillsSample: string[];
  error?: string;
};

type ToolResolutionResult = {
  specs: ReturnType<typeof mapToolsToChatCompletionSpecs>;
  debug: ToolResolutionDebugDetails;
};

type PendingQuestionnaireState = Extract<
  NonNullable<ReturnType<typeof getQuestionnaireState>>,
  { status: 'pending' }
>;

export class SessionRuntime {
  private readonly transport: WsTransport;
  private readonly connection: SessionConnection;
  private readonly connectionId: string;
  private readonly config: EnvConfig;
  private readonly baseToolHost: ToolHost;
  private readonly openaiClient: OpenAI | undefined;
  private readonly sessionHub: SessionHub;
  private readonly eventStore: EventStore;
  private readonly scheduledSessionService: ScheduledSessionService | undefined;
  private readonly searchService: SearchService | undefined;
  private readonly activeRunStates = new Map<
    string,
    { sessionId: string; state: LogicalSessionState }
  >();
  private closed = false;
  private clientHelloReceived = false;
  private messageQueue: Array<() => Promise<void>> = [];
  private processing = false;

  private inputMode: InputMode = 'text';
  private outputMode: OutputMode = 'text';
  private clientAudioCapabilities: ClientAudioCapabilities | undefined;
  private interactionState: { supported: boolean; enabled: boolean } = {
    supported: false,
    enabled: false,
  };

  private readonly messageRateLimiter: RateLimiter | undefined;
  private readonly toolCallRateLimiter: RateLimiter | undefined;
  private readonly rateLimitWindowMs = 60_000;
  private nextAudioSeq = 0;
  private readonly ttsBackendFactory: TtsBackendFactory | null;
  private readonly readySessionIds = new Set<string>();

  constructor(options: SessionRuntimeOptions) {
    this.transport = options.transport;
    this.connection = options.connection;
    this.connectionId = options.connectionId ?? options.connection.id ?? 'unknown';
    this.config = options.config;
    this.baseToolHost = options.toolHost;
    this.sessionHub = options.sessionHub;
    this.openaiClient = options.openaiClient;
    this.eventStore = options.eventStore;
    this.scheduledSessionService = options.scheduledSessionService;
    this.searchService = options.searchService;

    this.messageRateLimiter =
      this.config.maxMessagesPerMinute > 0
        ? new RateLimiter({
            maxTokens: this.config.maxMessagesPerMinute,
            windowMs: this.rateLimitWindowMs,
          })
        : undefined;

    this.ttsBackendFactory = selectTtsBackendFactory({
      config: this.config,
      sendAudioFrame: (bytes: Uint8Array) => this.sendAudioFrameToClient(bytes),
      getNextSeq: () => this.nextAudioSeq++,
      log: (...args: unknown[]) => this.log(...args),
      sendTtsError: (details: unknown) =>
        this.sendError('tts_error', 'Failed to generate audio for assistant response', details),
      openaiClient: this.openaiClient ?? null,
    });

    this.toolCallRateLimiter =
      this.config.maxToolCallsPerMinute > 0
        ? new RateLimiter({
            maxTokens: this.config.maxToolCallsPerMinute,
            windowMs: this.rateLimitWindowMs,
          })
        : undefined;

    this.log('session started');
  }

  onSocketClosed(code: number, reason: Buffer): void {
    this.log('client closed', code, reason.toString('utf8'));
    this.closeInternal({ closeTransport: false });
  }

  onSocketError(err: unknown): void {
    this.log('client error', err);
    this.sendError('client_error', 'Client connection error');
    this.close();
  }

  onSocketMessage(data: RawData, isBinary: boolean): void {
    try {
      if (isBinary) {
        this.handleClientBinaryMessage(data);
        return;
      }

      const text = typeof data === 'string' ? data : data.toString('utf8');
      handleClientTextMessage({
        raw: text,
        messageRateLimiter: this.messageRateLimiter,
        maxMessagesPerMinute: this.config.maxMessagesPerMinute,
        rateLimitWindowMs: this.rateLimitWindowMs,
        sendError: (code, message, details, options) =>
          this.sendError(code, message, details, options),
        onHello: (message) => this.enqueue(() => this.handleHello(message)),
        onTextInput: (message) => this.handleTextInput(message),
        onSetModes: (message) => this.handleSetModes(message),
        onControl: (message) => this.handleControl(message),
        onPing: (message) => this.handlePing(message),
        onPanelEvent: (message) => this.enqueue(() => this.handlePanelEvent(message)),
        onSubscribe: (message) => this.enqueue(() => this.handleSubscribe(message)),
        onUnsubscribe: (message) => this.enqueue(() => this.handleUnsubscribe(message)),
        onSetSessionModel: (message) => this.enqueue(() => this.handleSetSessionModel(message)),
        onSetSessionThinking: (message) =>
          this.enqueue(() => this.handleSetSessionThinking(message)),
        onSetInteractionMode: (message) =>
          this.enqueue(() => this.handleSetInteractionMode(message)),
        onToolInteractionResponse: (message) =>
          this.enqueue(() => this.handleToolInteractionResponse(message)),
        onQuestionnaireSubmit: (message) =>
          this.enqueue(() => this.handleQuestionnaireSubmit(message)),
        onQuestionnaireCancel: (message) =>
          this.enqueue(() => this.handleQuestionnaireCancel(message)),
        onCancelQueuedMessage: (message) =>
          this.enqueue(() => this.handleCancelQueuedMessage(message)),
      });
    } catch (err) {
      this.log('unhandled error while processing client message', err);
      this.sendError(
        'internal_error',
        'Internal error while processing client message',
        undefined,
        {
          retryable: true,
        },
      );
    }
  }

  // Note: data parameter will be used when audio input is implemented
  private handleClientBinaryMessage(_data: RawData): void {
    this.sendError('audio_not_supported', 'Audio input is not supported by the current backend');
  }

  private enqueue(handler: () => Promise<void>): void {
    this.messageQueue.push(handler);
    if (!this.processing) {
      void this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.processing = true;
    while (this.messageQueue.length > 0) {
      const next = this.messageQueue.shift();
      if (!next) {
        continue;
      }
      try {
        await next();
      } catch (err) {
        this.log('error processing queued message', err);
      }
    }
    this.processing = false;
  }

  private async handleHello(message: ClientHelloMessage): Promise<void> {
    await handleHelloMessage({
      message,
      clientHelloReceived: this.clientHelloReceived,
      setClientHelloReceived: (received) => {
        this.clientHelloReceived = received;
      },
      setClientAudioCapabilities: (audio) => {
        this.clientAudioCapabilities = audio;
      },
      setInteractionState: (state) => {
        this.interactionState = state;
        this.sessionHub.setInteractionState(this.connection, state);
      },
      connection: this.connection,
      sessionHub: this.sessionHub,
      onSessionSubscribed: (state) => {
        this.sendSessionReadyMessage(state);
      },
      sendMessage: (serverMessage) => {
        this.sendToClient(serverMessage);
      },
      sendError: (code, errorMessage, details, options) =>
        this.sendError(code, errorMessage, details, options),
      close: () => this.close(),
    });
  }

  private handleTextInput(message: ClientTextInputMessage): void {
    if (!this.clientHelloReceived) {
      this.enqueue(() => this.handleTextInputWithChatCompletions(message));
      return;
    }

    // Run text input off the WS queue to keep panel events responsive during long chat runs.
    void this.handleTextInputWithChatCompletions(message).catch((err) => {
      this.log('error processing text_input', err);
      this.sendError(
        'internal_error',
        'Internal error while processing text input',
        { error: String(err) },
        { retryable: true },
      );
    });
  }

  private async resolveSubscribedSessionState(
    sessionId: string,
    operation: string,
  ): Promise<LogicalSessionState | undefined> {
    try {
      return (
        this.sessionHub.getSessionState(sessionId) ?? (await this.sessionHub.ensureSessionState(sessionId))
      );
    } catch (err) {
      this.log(`failed to resolve session state for ${operation}`, err);
      this.sendError(
        'internal_error',
        `Failed to resolve session for ${operation}`,
        { sessionId, error: String(err) },
        { retryable: true },
      );
      return undefined;
    }
  }

  private handleSetModes(message: ClientSetModesMessage): void {
    const result = applyClientSetModes(
      { inputMode: this.inputMode, outputMode: this.outputMode },
      message,
    );

    this.inputMode = result.next.inputMode;
    this.outputMode = result.next.outputMode;

    if (!result.modesUpdated) {
      return;
    }

    this.sendToClient(result.modesUpdated);
  }

  private handleControl(message: ClientControlMessage): void {
    if (isOutputCancelControl(message)) {
      this.handleChatOutputCancel(message);
      return;
    }
  }

  private handlePing(message: ClientPingMessage): void {
    this.sendToClient(buildPongMessage(message, Date.now()));
  }

  private async handleSetInteractionMode(
    message: ClientSetInteractionModeMessage,
  ): Promise<void> {
    const enabled = message.enabled === true;
    const nextState = {
      supported: this.interactionState.supported,
      enabled: this.interactionState.supported ? enabled : false,
    };
    this.interactionState = nextState;
    this.sessionHub.setInteractionState(this.connection, nextState);
  }

  private async handleToolInteractionResponse(
    message: ClientToolInteractionResponseMessage,
  ): Promise<void> {
    const sessionId = message.sessionId.trim();
    if (!sessionId) {
      this.sendError('invalid_session_id', 'Session id must not be empty');
      return;
    }
    if (typeof this.connection.isSubscribedTo === 'function') {
      const isSubscribed = this.connection.isSubscribedTo(sessionId);
      if (!isSubscribed) {
        this.sendError(
          'invalid_session_id',
          'Cannot respond to an interaction for a session that this connection is not subscribed to',
          { sessionId },
        );
        return;
      }
    }

    this.log('interaction response received', {
      sessionId,
      callId: message.callId,
      interactionId: message.interactionId,
      action: message.action,
      hasInput: Boolean(message.input),
    });

    const handled = this.sessionHub.getInteractionRegistry().resolveResponse({
      sessionId,
      callId: message.callId,
      interactionId: message.interactionId,
      response: {
        action: message.action,
        ...(message.approvalScope ? { approvalScope: message.approvalScope } : {}),
        ...(message.input ? { input: message.input } : {}),
        ...(message.reason ? { reason: message.reason } : {}),
      },
    });

    if (!handled) {
      this.log('interaction response not found', {
        sessionId,
        callId: message.callId,
        interactionId: message.interactionId,
      });
      this.sendError('interaction_not_found', 'Interaction response did not match a pending request');
    }
  }

  private async loadQuestionnaireState(
    sessionId: string,
    questionnaireRequestId: string,
    operation: string,
  ): Promise<ReturnType<typeof getQuestionnaireState> | undefined> {
    const state = await this.resolveSubscribedSessionState(sessionId, operation);
    if (!state) {
      this.sendError('session_not_ready', 'Session binding is not initialised yet');
      return undefined;
    }

    const events = this.sessionHub.shouldPersistSessionEvents(state.summary)
      ? await this.eventStore.getEvents(sessionId)
      : await this.sessionHub.loadSessionEvents(state.summary, true);
    return getQuestionnaireState(events, questionnaireRequestId);
  }

  private async resolvePendingQuestionnaire(options: {
    rawSessionId: string;
    rawQuestionnaireRequestId: string;
    action: 'submit' | 'cancel';
  }): Promise<
    | {
        sessionId: string;
        questionnaireRequestId: string;
        questionnaireState: PendingQuestionnaireState;
      }
    | undefined
  > {
    const { rawSessionId, rawQuestionnaireRequestId, action } = options;
    const sessionId = rawSessionId.trim();
    if (!sessionId) {
      this.sendError('invalid_session_id', 'Session id must not be empty');
      return undefined;
    }
    const questionnaireRequestId = rawQuestionnaireRequestId.trim();
    if (!questionnaireRequestId) {
      this.sendError(
        'invalid_questionnaire_request_id',
        'Questionnaire request id must not be empty',
      );
      return undefined;
    }
    if (typeof this.connection.isSubscribedTo === 'function') {
      const isSubscribed = this.connection.isSubscribedTo(sessionId);
      if (!isSubscribed) {
        this.sendError(
          'invalid_session_id',
          `Cannot ${action} a questionnaire for a session that this connection is not subscribed to`,
          { sessionId },
        );
        return undefined;
      }
    }

    const questionnaireState = await this.loadQuestionnaireState(
      sessionId,
      questionnaireRequestId,
      `questionnaire ${action}`,
    );
    if (questionnaireState === undefined) {
      return undefined;
    }
    if (!questionnaireState) {
      this.sendError('questionnaire_not_found', 'Questionnaire request was not found', {
        sessionId,
        questionnaireRequestId,
      });
      return undefined;
    }
    if (questionnaireState.status !== 'pending') {
      this.sendError('questionnaire_not_pending', 'Questionnaire is no longer pending', {
        sessionId,
        questionnaireRequestId,
        status: questionnaireState.status,
      });
      return undefined;
    }

    return {
      sessionId,
      questionnaireRequestId,
      questionnaireState,
    };
  }

  private async appendQuestionnaireEvent(sessionId: string, event: ChatEvent): Promise<void> {
    await appendAndBroadcastChatEvents(
      {
        eventStore: this.eventStore,
        sessionHub: this.sessionHub,
        sessionId,
      },
      [event],
    );
  }

  private async triggerQuestionnaireFollowUp(options: {
    sessionId: string;
    questionnaireRequestId: string;
    toolCallId: string;
    toolName: string;
    schemaTitle?: string;
    answers: Record<string, unknown>;
    interactionId?: string;
    submittedAt: string;
  }): Promise<void> {
    const {
      sessionId,
      questionnaireRequestId,
      toolCallId,
      toolName,
      schemaTitle,
      answers,
      interactionId,
      submittedAt,
    } = options;
    const callbackText = buildQuestionnaireCallbackText({
      questionnaireRequestId,
      toolCallId,
      toolName,
      ...(schemaTitle ? { schemaTitle } : {}),
      answers,
      ...(interactionId ? { interactionId } : {}),
      submittedAt,
    });
    const callbackResponseId = randomUUID();
    // Reuse the durable questionnaire id so the follow-up event can be correlated
    // back to the original async request in history and debugging output.
    const callbackMessageId = questionnaireRequestId;

    const executeCallback = async () => {
      try {
        const callbackState = await this.resolveSubscribedSessionState(
          sessionId,
          'questionnaire follow-up',
        );
        if (!callbackState) {
          return;
        }
        const callbackSessionToolHost = this.resolveSessionToolHost(callbackState);
        const callbackToolResolution = await this.resolveChatCompletionTools(
          callbackState,
          callbackSessionToolHost,
        );

        await processUserMessage({
          sessionId,
          state: callbackState,
          text: callbackText,
          responseId: callbackResponseId,
          sessionHub: this.sessionHub,
          envConfig: this.config,
          chatCompletionTools: callbackToolResolution.specs,
          handleChatToolCalls: (targetSessionId, targetState, toolCalls) =>
            this.handleChatToolCalls(
              targetSessionId,
              targetState,
              toolCalls,
              callbackSessionToolHost,
            ),
          outputMode: 'text',
          ttsBackendFactory: null,
          agentMessageContext: {
            fromSessionId: sessionId,
            responseId: callbackResponseId,
            callbackEvent: {
              messageId: callbackMessageId,
              fromSessionId: sessionId,
              result: callbackText,
            },
            logType: 'callback',
          },
          eventStore: this.eventStore,
          log: (...args) => this.log(...args),
        });
      } catch (err) {
        this.log('failed to process questionnaire follow-up', err);
      }
    };

    await this.sessionHub.queueMessage({
      sessionId,
      text: 'Questionnaire response received',
      source: 'user',
      execute: executeCallback,
    });
    void this.sessionHub.processNextQueuedMessage(sessionId);
  }

  private async handleQuestionnaireSubmit(
    message: ClientQuestionnaireSubmitMessage,
  ): Promise<void> {
    const resolved = await this.resolvePendingQuestionnaire({
      rawSessionId: message.sessionId,
      rawQuestionnaireRequestId: message.questionnaireRequestId,
      action: 'submit',
    });
    if (!resolved) {
      return;
    }
    const { sessionId, questionnaireRequestId, questionnaireState } = resolved;

    const answers = message.answers ?? {};
    if (questionnaireState.request.validate !== false) {
      const fieldErrors = validateQuestionnaireInput(questionnaireState.request.schema, answers);
      if (Object.keys(fieldErrors).length > 0) {
        const repromptEvent: ChatEvent = {
          ...createChatEventBase({ sessionId }),
          type: 'questionnaire_reprompt',
          payload: {
            questionnaireRequestId,
            toolCallId: questionnaireState.request.toolCallId,
            status: 'pending',
            updatedAt: new Date().toISOString(),
            errorSummary: 'Please correct the highlighted fields.',
            fieldErrors,
            initialValues: answers,
          },
        };
        await this.appendQuestionnaireEvent(sessionId, repromptEvent);
        return;
      }
    }

    const interactionId = randomUUID();
    const submittedAt = new Date().toISOString();
    const submissionEvent: ChatEvent = {
      ...createChatEventBase({ sessionId }),
      type: 'questionnaire_submission',
      payload: {
        questionnaireRequestId,
        toolCallId: questionnaireState.request.toolCallId,
        status: 'submitted',
        submittedAt,
        interactionId,
        answers,
      },
    };
    await this.appendQuestionnaireEvent(sessionId, submissionEvent);

    if (questionnaireState.request.autoResume !== false) {
      await this.triggerQuestionnaireFollowUp({
        sessionId,
        questionnaireRequestId,
        toolCallId: questionnaireState.request.toolCallId,
        toolName: questionnaireState.request.toolName,
        answers,
        interactionId,
        submittedAt,
        ...(questionnaireState.request.schema.title
          ? { schemaTitle: questionnaireState.request.schema.title }
          : {}),
      });
    }
  }

  private async handleQuestionnaireCancel(
    message: ClientQuestionnaireCancelMessage,
  ): Promise<void> {
    const resolved = await this.resolvePendingQuestionnaire({
      rawSessionId: message.sessionId,
      rawQuestionnaireRequestId: message.questionnaireRequestId,
      action: 'cancel',
    });
    if (!resolved) {
      return;
    }
    const { sessionId, questionnaireRequestId, questionnaireState } = resolved;

    const updateEvent: ChatEvent = {
      ...createChatEventBase({ sessionId }),
      type: 'questionnaire_update',
      payload: {
        questionnaireRequestId,
        toolCallId: questionnaireState.request.toolCallId,
        status: 'cancelled',
        updatedAt: new Date().toISOString(),
        ...(message.reason ? { reason: message.reason } : {}),
      },
    };
    await this.appendQuestionnaireEvent(sessionId, updateEvent);
  }

  private async handlePanelEvent(message: ClientPanelEventMessage): Promise<void> {
    const rawSessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() : '';
    const targetSessionId = rawSessionId || null;

    const rawPayload =
      message.payload && typeof message.payload === 'object'
        ? (message.payload as { type?: string })
        : null;

    if (rawPayload?.type === 'panel_inventory') {
      const parsed = PanelInventoryPayloadSchema.safeParse(message.payload);
      if (!parsed.success) {
        this.sendError('invalid_panel_event', 'Invalid panel inventory payload', {
          issues: parsed.error.issues,
        });
        return;
      }
      const windowId = typeof message.windowId === 'string' ? message.windowId : '';
      updatePanelInventory(parsed.data, {
        ...(windowId ? { windowId } : {}),
        connectionId: this.connectionId,
      });
      return;
    }

    if (targetSessionId && typeof this.connection.isSubscribedTo === 'function') {
      const isSubscribed = this.connection.isSubscribedTo(targetSessionId);
      if (!isSubscribed) {
        this.sendError(
          'invalid_session_id',
          'Cannot send panel events to a session that this connection is not subscribed to',
          { sessionId: targetSessionId },
        );
        return;
      }
    }

    const pluginHandler = this.sessionHub
      .getPluginRegistry()
      ?.getPanelEventHandler?.(message.panelType);
    if (pluginHandler) {
      await pluginHandler(message, {
        sessionId: targetSessionId,
        panelId: message.panelId,
        panelType: message.panelType,
        connectionId: this.connectionId,
        connection: this.connection,
        sessionHub: this.sessionHub,
        sessionIndex: this.sessionHub.getSessionIndex(),
        sendToClient: (response) => {
          this.sendToClient(response);
        },
        sendToSession: (sessionId, response) => {
          this.sessionHub.broadcastToSession(sessionId, response);
        },
        sendToAll: (response) => {
          this.sessionHub.broadcastToAll(response);
        },
      });
      return;
    }

    const payloadType =
      message.payload && typeof message.payload === 'object'
        ? (message.payload as { type?: unknown }).type
        : undefined;
    if (
      payloadType === 'panel_lifecycle' ||
      payloadType === 'panel_binding' ||
      payloadType === 'panel_session_changed'
    ) {
      return;
    }

    const eventMessage: ServerMessage = {
      type: 'panel_event',
      panelId: message.panelId,
      panelType: message.panelType,
      payload: message.payload,
      ...(targetSessionId ? { sessionId: targetSessionId } : {}),
    };

    if (targetSessionId) {
      this.sessionHub.broadcastToSession(targetSessionId, eventMessage);
      return;
    }

    this.sessionHub.broadcastToAll(eventMessage);
  }

  private async handleSubscribe(message: ClientSubscribeMessage): Promise<void> {
    const rawSessionId = message.sessionId;
    const trimmed = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    if (!trimmed) {
      this.sendError('invalid_session_id', 'Subscription session id must not be empty');
      return;
    }

    try {
      const state = await this.sessionHub.subscribeConnection(this.connection, trimmed, message.mask);
      const subscribedMessage: ServerSubscribedMessage = {
        type: 'subscribed',
        sessionId: state.summary.sessionId,
        ...(message.mask ? { mask: message.mask } : {}),
      };
      this.sendToClient(subscribedMessage);
      this.sendSessionReadyMessage(state);
    } catch (err) {
      this.log('failed to subscribe connection to session', err);
      this.sendError(
        'subscription_error',
        'Failed to subscribe to the requested session',
        { sessionId: trimmed, error: String(err) },
        { retryable: true },
      );
    }
  }

  private async handleUnsubscribe(message: ClientUnsubscribeMessage): Promise<void> {
    const rawSessionId = message.sessionId;
    const trimmed = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    if (!trimmed) {
      this.sendError('invalid_session_id', 'Unsubscription session id must not be empty');
      return;
    }

    this.sessionHub.unsubscribeConnection(this.connection, trimmed);
    this.readySessionIds.delete(trimmed);

    const unsubscribedMessage: ServerUnsubscribedMessage = {
      type: 'unsubscribed',
      sessionId: trimmed,
    };
    this.sendToClient(unsubscribedMessage);
  }

  private async handleSetSessionModel(message: ClientSetSessionModelMessage): Promise<void> {
    const rawModel = message.model;
    const trimmedModel = typeof rawModel === 'string' ? rawModel.trim() : '';
    if (!trimmedModel) {
      this.sendError('invalid_model', 'Model must be a non-empty string');
      return;
    }

    const sessionId = message.sessionId.trim();
    if (!sessionId) {
      this.sendError('invalid_session_id', 'Session id must not be empty');
      return;
    }

    if (typeof this.connection.isSubscribedTo === 'function') {
      const isSubscribed = this.connection.isSubscribedTo(sessionId);
      if (!isSubscribed) {
        this.sendError(
          'invalid_session_id',
          'Cannot update session model for a session that this connection is not subscribed to',
          { sessionId },
        );
        return;
      }
    }

    const state = await this.resolveSubscribedSessionState(sessionId, 'model update');

    if (!state) {
      this.sendError('session_not_ready', 'Session binding is not initialised yet');
      return;
    }

    const summary = state.summary;
    const agentId = summary.agentId;
    if (!agentId) {
      this.sendError(
        'model_not_supported',
        'Model selection is only supported for sessions bound to an agent',
      );
      return;
    }

    const registry = this.sessionHub.getAgentRegistry();
    const agent = registry.getAgent(agentId);
    if (!agent || !agent.chat) {
      this.sendError('model_not_supported', 'Agent does not support model selection');
      return;
    }

    const availableModelsList = getAgentAvailableModels(agent);
    if (availableModelsList.length === 0) {
      this.sendError(
        'model_not_supported',
        'Agent does not have any configured models for selection',
      );
      return;
    }

    if (!availableModelsList.includes(trimmedModel)) {
      this.sendError('model_not_allowed', 'Requested model is not allowed for this agent', {
        model: trimmedModel,
        availableModels: availableModelsList,
      });
      return;
    }

    try {
      const updatedSummary = await this.sessionHub.setSessionModel(sessionId, trimmedModel);
      if (updatedSummary) {
        state.summary = updatedSummary;
      }
    } catch (err) {
      this.log('failed to update session model', err);
      this.sendError(
        'internal_error',
        'Failed to update session model',
        { sessionId, error: String(err) },
        { retryable: true },
      );
    }
  }

  private async handleSetSessionThinking(
    message: ClientSetSessionThinkingMessage,
  ): Promise<void> {
    const rawThinking = message.thinking;
    const trimmedThinking = typeof rawThinking === 'string' ? rawThinking.trim() : '';
    if (!trimmedThinking) {
      this.sendError('invalid_thinking', 'Thinking level must be a non-empty string');
      return;
    }

    const sessionId = message.sessionId.trim();
    if (!sessionId) {
      this.sendError('invalid_session_id', 'Session id must not be empty');
      return;
    }

    if (typeof this.connection.isSubscribedTo === 'function') {
      const isSubscribed = this.connection.isSubscribedTo(sessionId);
      if (!isSubscribed) {
        this.sendError(
          'invalid_session_id',
          'Cannot update session thinking for a session that this connection is not subscribed to',
          { sessionId },
        );
        return;
      }
    }

    const state = await this.resolveSubscribedSessionState(sessionId, 'thinking update');

    if (!state) {
      this.sendError('session_not_ready', 'Session binding is not initialised yet');
      return;
    }

    const summary = state.summary;
    const agentId = summary.agentId;
    if (!agentId) {
      this.sendError(
        'thinking_not_supported',
        'Thinking selection is only supported for sessions bound to an agent',
      );
      return;
    }

    const registry = this.sessionHub.getAgentRegistry();
    const agent = registry.getAgent(agentId);
    if (!agent || !agent.chat) {
      this.sendError('thinking_not_supported', 'Agent does not support thinking selection');
      return;
    }

    const availableThinking = getAgentAvailableThinkingLevels(agent);
    if (availableThinking.length === 0) {
      this.sendError(
        'thinking_not_supported',
        'Agent does not have any configured thinking levels for selection',
      );
      return;
    }

    if (!availableThinking.includes(trimmedThinking)) {
      this.sendError('thinking_not_allowed', 'Requested thinking level is not allowed', {
        thinking: trimmedThinking,
        availableThinking,
      });
      return;
    }

    try {
      const updatedSummary = await this.sessionHub.setSessionThinking(sessionId, trimmedThinking);
      if (updatedSummary) {
        state.summary = updatedSummary;
      }
    } catch (err) {
      this.log('failed to update session thinking', err);
      this.sendError(
        'internal_error',
        'Failed to update session thinking',
        { sessionId, error: String(err) },
        { retryable: true },
      );
    }
  }

  private async handleCancelQueuedMessage(message: ClientCancelQueuedMessage): Promise<void> {
    const rawId = message.messageId;
    const trimmedId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!trimmedId) {
      this.sendError(
        'invalid_queued_message_id',
        'Queued message id must not be empty when cancelling',
      );
      return;
    }

    try {
      const result = await this.sessionHub.dequeueMessageById(trimmedId);
      if (!result) {
        this.sendError(
          'queued_message_not_found',
          'Queued message not found or already processed',
          { messageId: trimmedId },
        );
        return;
      }

      const { sessionId } = result;
      if (sessionId) {
        void this.sessionHub.processNextQueuedMessage(sessionId);
      }
    } catch (err) {
      this.sendError('queue_cancel_error', 'Failed to cancel queued message', {
        messageId: trimmedId,
        error: String(err),
      });
    }
  }

  private resolveSessionToolHost(state: LogicalSessionState | undefined): ToolHost {
    if (!state) {
      return this.baseToolHost;
    }

    const agentId = state.summary.agentId;
    if (!agentId) {
      return this.baseToolHost;
    }

    const registry = this.sessionHub.getAgentRegistry();
    const agent = registry.getAgent(agentId);
    if (!agent) {
      return this.baseToolHost;
    }

    const allowlist = agent.toolAllowlist;
    const denylist = agent.toolDenylist;
    const capabilityAllowlist = agent.capabilityAllowlist;
    const capabilityDenylist = agent.capabilityDenylist;

    return createScopedToolHost(
      this.baseToolHost,
      allowlist,
      denylist,
      capabilityAllowlist,
      capabilityDenylist,
    );
  }

  private async resolveChatCompletionTools(
    state: LogicalSessionState | undefined,
    sessionToolHost: ToolHost,
  ): Promise<ToolResolutionResult> {
    try {
      const availableTools = await sessionToolHost.listTools();
      const agentId = state?.summary.agentId;
      const agent = agentId ? this.sessionHub.getAgentRegistry().getAgent(agentId) : undefined;
      const manifests = this.sessionHub.getPluginRegistry()?.getManifests?.() ?? [];
      const { visibleTools, skills } = resolveToolExposure({
        tools: availableTools,
        ...(agent ? { agent } : {}),
        manifests,
      });
      const selectedSkills = filterSessionSkills({
        availableSkills: skills,
        selectedSkillIds: getSelectedSessionSkillIds(state?.summary.attributes),
      });
      const specs = visibleTools.length > 0 ? mapToolsToChatCompletionSpecs(visibleTools) : [];
      if (visibleTools.length > 0 || (selectedSkills && selectedSkills.length > 0)) {
        await updateSystemPromptWithTools({
          state,
          sessionHub: this.sessionHub,
          tools: visibleTools,
          ...(selectedSkills && selectedSkills.length > 0 ? { skills: selectedSkills } : {}),
          log: (...args) => this.log(...args),
        });
      }
      return {
        specs,
        debug: {
          availableToolsCount: availableTools.length,
          visibleToolsCount: visibleTools.length,
          skillCount: selectedSkills?.length ?? 0,
          toolNamesSample: availableTools.slice(0, 10).map((tool) => tool.name),
          visibleToolNamesSample: visibleTools.slice(0, 10).map((tool) => tool.name),
          skillsSample: (selectedSkills ?? []).slice(0, 10).map((skill) => skill.id),
        },
      };
    } catch (err) {
      this.log('failed to list tools from ToolHost for chat completions', err);
      return {
        specs: [],
        debug: {
          availableToolsCount: 0,
          visibleToolsCount: 0,
          skillCount: 0,
          toolNamesSample: [],
          visibleToolNamesSample: [],
          skillsSample: [],
          error: String(err),
        },
      };
    }
  }

  private buildToolResolutionDebugContext(options: {
    targetSessionId: string;
    state: LogicalSessionState | undefined;
    systemPromptHasTools: boolean;
    resolution: ToolResolutionResult | null;
  }): Record<string, unknown> {
    const {
      targetSessionId,
      state,
      systemPromptHasTools,
      resolution,
    } = options;

    return {
      connectionId: this.connectionId,
      subscribedSessionCount: this.sessionHub.getConnectionSubscriptions(this.connection).size,
      targetSessionId,
      agentId: state?.summary.agentId ?? null,
      systemPromptHasTools,
      resolutionPath: 'resolved',
      finalToolSpecCount: resolution?.specs.length ?? 0,
      availableToolsCount: resolution?.debug.availableToolsCount ?? null,
      visibleToolsCount: resolution?.debug.visibleToolsCount ?? null,
      skillCount: resolution?.debug.skillCount ?? null,
      toolNamesSample: resolution?.debug.toolNamesSample ?? null,
      visibleToolNamesSample: resolution?.debug.visibleToolNamesSample ?? null,
      skillsSample: resolution?.debug.skillsSample ?? null,
      ...(resolution?.debug.error ? { error: resolution.debug.error } : {}),
    };
  }

  private sendSessionReadyMessage(state: LogicalSessionState): void {
    const sessionId = state.summary.sessionId;
    if (this.readySessionIds.has(sessionId)) {
      return;
    }

    let availableModels: string[] | undefined;
    let currentModel: string | undefined;
    let availableThinking: string[] | undefined;
    let currentThinking: string | undefined;

    const summary = state.summary;
    const agentId = summary.agentId;
    if (agentId) {
      const registry = this.sessionHub.getAgentRegistry();
      const agent = registry.getAgent(agentId);
      const models = getAgentAvailableModels(agent);
      if (models.length > 0) {
        availableModels = models;
      }
      const thinkingLevels = getAgentAvailableThinkingLevels(agent);
      if (thinkingLevels.length > 0) {
        availableThinking = thinkingLevels;
      }
    }

    if (typeof summary.model === 'string' && summary.model.trim().length > 0) {
      currentModel = summary.model.trim();
    }
    if (typeof summary.thinking === 'string' && summary.thinking.trim().length > 0) {
      currentThinking = summary.thinking.trim();
    }

    const readyMessage: ServerSessionReadyMessage = {
      type: 'session_ready',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sessionId,
      inputMode: this.inputMode,
      outputMode: this.outputMode,
      ...(availableModels ? { availableModels } : {}),
      ...(currentModel ? { currentModel } : {}),
      ...(availableThinking ? { availableThinking } : {}),
      ...(currentThinking ? { currentThinking } : {}),
    };

    this.sendToClient(readyMessage);
    this.readySessionIds.add(sessionId);
  }

  private async handleTextInputWithChatCompletions(message: ClientTextInputMessage): Promise<void> {
    const targetSessionId = message.sessionId.trim();

    if (!targetSessionId) {
      this.sendError('invalid_session_id', 'Session id must not be empty');
      return;
    }

    if (typeof this.connection.isSubscribedTo === 'function') {
      const isSubscribed = this.connection.isSubscribedTo(targetSessionId);
      if (!isSubscribed) {
        this.sendError(
          'invalid_session_id',
          'Cannot send input to a session that this connection is not subscribed to',
          { sessionId: targetSessionId },
        );
        return;
      }
    }

    const stateForRun = await this.resolveSubscribedSessionState(targetSessionId, 'text input');
    const sessionIdForRun = targetSessionId;

    const shouldResolveTools = !!stateForRun && !!sessionIdForRun;
    const sessionToolHostForRun = stateForRun
      ? this.resolveSessionToolHost(stateForRun)
      : this.baseToolHost;
    const firstMessageContent =
      stateForRun?.chatMessages?.[0] && typeof stateForRun.chatMessages[0].content === 'string'
        ? stateForRun.chatMessages[0].content
        : '';
    const systemPromptHasTools = firstMessageContent.includes('Available tools:');
    let chatCompletionToolsForRun: ReturnType<typeof mapToolsToChatCompletionSpecs> = [];
    let toolResolution: ToolResolutionResult | null = null;
    if (shouldResolveTools) {
      toolResolution = await this.resolveChatCompletionTools(
        stateForRun,
        sessionToolHostForRun,
      );
      chatCompletionToolsForRun = toolResolution.specs;
    }

    const debugChatCompletionsContext = this.buildToolResolutionDebugContext({
      targetSessionId,
      state: stateForRun,
      systemPromptHasTools,
      resolution: toolResolution,
    });

    if (chatCompletionToolsForRun.length === 0 && stateForRun?.summary.agentId) {
      this.log('chat completion tools resolved empty', debugChatCompletionsContext);
    }

    return this.runChatInputWithCompletions({
      message,
      state: stateForRun,
      sessionId: sessionIdForRun,
      connection: this.connection,
      sessionHub: this.sessionHub,
      config: this.config,
      chatCompletionTools: chatCompletionToolsForRun,
      debugChatCompletionsContext,
      outputMode: this.outputMode,
      clientAudioCapabilities: this.clientAudioCapabilities,
      ttsBackendFactory: this.ttsBackendFactory,
      eventStore: this.eventStore,
      handleChatToolCalls: (sessionId, state, toolCalls) =>
        this.handleChatToolCalls(sessionId, state, toolCalls, sessionToolHostForRun),
      setActiveRunState: (active) => {
        this.activeRunStates.set(active.sessionId, active);
      },
      clearActiveRunState: (expected) => {
        const current = this.activeRunStates.get(expected.sessionId);
        if (current && current.state === expected.state) {
          this.activeRunStates.delete(expected.sessionId);
        }
      },
      sendError: (code, message, details, options) =>
        this.sendError(code, message, details, options),
      log: (...args) => this.log(...args),
    });
  }

  private runChatInputWithCompletions(
    options: Parameters<typeof handleTextInputWithChatCompletions>[0],
  ): Promise<void> {
    return handleTextInputWithChatCompletions(options);
  }

  async handleChatToolCalls(
    sessionId: string,
    state: LogicalSessionState,
    toolCalls: ChatCompletionToolCallState[],
    sessionToolHost: ToolHost,
  ): Promise<void> {
    return handleChatToolCallsInternal({
      sessionId,
      state,
      toolCalls,
      baseToolHost: this.baseToolHost,
      sessionToolHost,
      sessionHub: this.sessionHub,
      eventStore: this.eventStore,
      maxToolCallsPerMinute: this.config.maxToolCallsPerMinute,
      rateLimitWindowMs: this.rateLimitWindowMs,
      envConfig: this.config,
      ...(this.searchService ? { searchService: this.searchService } : {}),
      ...(this.scheduledSessionService
        ? { scheduledSessionService: this.scheduledSessionService }
        : {}),
      sendError: (code, message, details, options) =>
        this.sendError(code, message, details, options),
      log: (...args) => this.log(...args),
      ...(this.toolCallRateLimiter ? { toolCallRateLimiter: this.toolCallRateLimiter } : {}),
    });
  }

  sendServerMessageFromHub(message: ServerMessage): void {
    this.sendToClient(message);
  }

  sendErrorFromHub(code: string, message: string): void {
    this.sendError(code, message);
  }

  close(): void {
    this.closeInternal({ closeTransport: true });
  }

  private closeInternal(options: { closeTransport: boolean }): void {
    if (this.closed) {
      return;
    }

    this.closed = true;

    this.sessionHub.detachConnectionFromAllSessions(this.connection);
    removePanelInventoryForConnection(this.connectionId);

    if (options.closeTransport) {
      this.transport.close(1000, 'session closed');
    }

    this.log('session closed');
  }

  private sendToClient(message: ServerMessage): void {
    this.transport.sendJson(message);
  }

  private sendAudioFrameToClient(bytes: Uint8Array): void {
    this.transport.sendBinary(bytes);
  }

  private sendError(
    code: string,
    message: string,
    details?: unknown,
    options?: { retryable?: boolean },
  ): void {
    const payload: ServerErrorMessage = {
      type: 'error',
      code,
      message,
      ...(typeof options?.retryable === 'boolean' ? { retryable: options.retryable } : {}),
      ...(details !== undefined ? { details } : {}),
    };
    this.sendToClient(payload);
  }

  private sendOutputCancelled(sessionId: string, responseId?: string, requestId?: string): void {
    const message: ServerMessage = {
      type: 'output_cancelled',
      sessionId,
      ...(responseId ? { responseId } : {}),
      ...(requestId ? { requestId } : {}),
    } as ServerMessage;
    this.sessionHub.broadcastToSession(sessionId, message);
  }

  private handleChatOutputCancel(message: ClientControlMessage): void {
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() : '';
    let activeRunState = sessionId ? this.activeRunStates.get(sessionId) : undefined;
    if (!activeRunState && sessionId) {
      const isSubscribed =
        typeof this.connection.isSubscribedTo === 'function'
          ? this.connection.isSubscribedTo(sessionId)
          : true;
      if (isSubscribed) {
        const state = this.sessionHub.getSessionState(sessionId);
        if (state?.activeChatRun) {
          activeRunState = { sessionId, state };
        }
      }
    }
    handleChatOutputCancelInternal({
      message,
      activeRunState,
      sessionHub: this.sessionHub,
      broadcastOutputCancelled: (sessionId, responseId) => {
        this.sendOutputCancelled(sessionId, responseId, activeRunState?.state.activeChatRun?.requestId);
      },
      log: (logMessage, details) => {
        this.log(logMessage, details);
      },
      eventStore: this.eventStore,
    });
  }

  private log(...args: unknown[]): void {
    console.log(`[connection ${this.connectionId}]`, ...args);
  }
}
