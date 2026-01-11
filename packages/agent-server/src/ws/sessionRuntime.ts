import type { RawData } from 'ws';

import type OpenAI from 'openai';

import type {
  ClientAudioCapabilities,
  ClientCancelQueuedMessage,
  ClientControlMessage,
  ClientHelloMessage,
  ClientPanelEventMessage,
  ClientPingMessage,
  ClientSetModesMessage,
  ClientSetSessionModelMessage,
  ClientSubscribeMessage,
  ClientTextInputMessage,
  ClientUnsubscribeMessage,
  InputMode,
  OutputMode,
  ServerErrorMessage,
  ServerMessage,
  ServerSessionReadyMessage,
  ServerSubscribedMessage,
  ServerUnsubscribedMessage,
} from '@assistant/shared';
import { CURRENT_PROTOCOL_VERSION, PanelInventoryPayloadSchema } from '@assistant/shared';

import { createScopedToolHost, mapToolsToChatCompletionSpecs, type ToolHost } from '../tools';
import type { ConversationStore } from '../conversationStore';
import { RateLimiter } from '../rateLimit';
import type { SessionHub } from '../sessionHub';
import type { LogicalSessionState } from '../sessionHub';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import { getAgentAvailableModels } from '../sessionModel';
import type { ChatCompletionToolCallState } from '../chatCompletionTypes';
import type { TtsBackendFactory } from '../tts/types';
import { selectTtsBackendFactory } from '../tts/selectTtsBackendFactory';
import { updatePanelInventory } from '../panels/panelInventoryStore';
import { resolveToolExposure } from '../skills';

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
import type { WsTransport } from './wsTransport';

export interface SessionRuntimeOptions {
  transport: WsTransport;
  connection: SessionConnection;
  connectionId?: string;
  config: EnvConfig;
  toolHost: ToolHost;
  conversationStore: ConversationStore;
  sessionHub: SessionHub;
  openaiClient?: OpenAI;
  eventStore: EventStore;
}

export class SessionRuntime {
  private sessionId: string | undefined;
  private readonly transport: WsTransport;
  private readonly connection: SessionConnection;
  private readonly connectionId: string;
  private readonly config: EnvConfig;
  private readonly baseToolHost: ToolHost;
  private sessionToolHost: ToolHost;
  private readonly conversationStore: ConversationStore;
  private readonly openaiClient: OpenAI | undefined;
  private readonly sessionHub: SessionHub;
  private readonly eventStore: EventStore;
  private sessionState: LogicalSessionState | undefined;
  private readonly activeRunStates = new Map<
    string,
    { sessionId: string; state: LogicalSessionState }
  >();
  private closed = false;
  private clientHelloReceived = false;
  private ready = false;
  private messageQueue: Array<() => Promise<void>> = [];
  private processing = false;

  private chatCompletionTools: ReturnType<typeof mapToolsToChatCompletionSpecs> = [];
  private inputMode: InputMode = 'text';
  private outputMode: OutputMode = 'text';
  private clientAudioCapabilities: ClientAudioCapabilities | undefined;

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
    this.sessionToolHost = options.toolHost;
    this.conversationStore = options.conversationStore;
    this.sessionHub = options.sessionHub;
    this.openaiClient = options.openaiClient;
    this.eventStore = options.eventStore;

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
      connection: this.connection,
      sessionHub: this.sessionHub,
      setSessionState: (state) => {
        this.sessionState = state;
      },
      setSessionId: (sessionId) => {
        this.sessionId = sessionId;
      },
      configureChatCompletionsSession: () => {
        void this.configureChatCompletionsSession();
      },
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
    if (!this.ready) {
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
      updatePanelInventory(parsed.data);
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
      const state = await this.sessionHub.subscribeConnection(this.connection, trimmed);
      const subscribedMessage: ServerSubscribedMessage = {
        type: 'subscribed',
        sessionId: state.summary.sessionId,
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

    let state = this.sessionState;
    if (!state || state.summary.sessionId !== sessionId) {
      try {
        state =
          this.sessionHub.getSessionState(sessionId) ??
          (await this.sessionHub.ensureSessionState(sessionId));
        if (this.sessionId === sessionId) {
          this.sessionState = state;
        }
      } catch (err) {
        this.log('failed to resolve session state for set_session_model', err);
        this.sendError(
          'internal_error',
          'Failed to resolve session for model update',
          { sessionId, error: String(err) },
          { retryable: true },
        );
        return;
      }
    }

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
      const updatedSummary = await this.sessionHub
        .getSessionIndex()
        .setSessionModel(sessionId, trimmedModel);
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

  private configureSessionToolHost(): void {
    this.sessionToolHost = this.resolveSessionToolHost(this.sessionState);
  }

  private async resolveChatCompletionTools(
    state: LogicalSessionState | undefined,
    sessionToolHost: ToolHost,
  ): Promise<ReturnType<typeof mapToolsToChatCompletionSpecs>> {
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
      const specs = visibleTools.length > 0 ? mapToolsToChatCompletionSpecs(visibleTools) : [];
      if (visibleTools.length > 0 || skills.length > 0) {
        await updateSystemPromptWithTools({
          state,
          sessionHub: this.sessionHub,
          tools: visibleTools,
          ...(skills.length > 0 ? { skills } : {}),
          log: (...args) => this.log(...args),
        });
      }
      return specs;
    } catch (err) {
      this.log('failed to list tools from ToolHost for chat completions', err);
      return [];
    }
  }

  private async refreshChatCompletionsTools(): Promise<void> {
    this.chatCompletionTools = await this.resolveChatCompletionTools(
      this.sessionState,
      this.sessionToolHost,
    );
  }

  private async configureChatCompletionsSession(): Promise<void> {
    if (this.ready) {
      return;
    }

    const sessionId = this.sessionId;
    const state = this.sessionState;
    if (!sessionId || !state) {
      return;
    }

    this.configureSessionToolHost();

    await this.refreshChatCompletionsTools();

    this.ready = true;
    this.sendSessionReadyMessage(state);
  }

  private sendSessionReadyMessage(state: LogicalSessionState): void {
    const sessionId = state.summary.sessionId;
    if (this.readySessionIds.has(sessionId)) {
      return;
    }

    let availableModels: string[] | undefined;
    let currentModel: string | undefined;

    const summary = state.summary;
    const agentId = summary.agentId;
    if (agentId) {
      const registry = this.sessionHub.getAgentRegistry();
      const agent = registry.getAgent(agentId);
      const models = getAgentAvailableModels(agent);
      if (models.length > 0) {
        availableModels = models;
      }
    }

    if (typeof summary.model === 'string' && summary.model.trim().length > 0) {
      currentModel = summary.model.trim();
    }

    const readyMessage: ServerSessionReadyMessage = {
      type: 'session_ready',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sessionId,
      inputMode: this.inputMode,
      outputMode: this.outputMode,
      ...(availableModels ? { availableModels } : {}),
      ...(currentModel ? { currentModel } : {}),
    };

    this.sendToClient(readyMessage);
    this.readySessionIds.add(sessionId);
    this.ready = true;
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

    let stateForRun: LogicalSessionState | undefined = this.sessionState;
    let sessionIdForRun: string | undefined = this.sessionId;

    sessionIdForRun = targetSessionId;

    if (!stateForRun || stateForRun.summary.sessionId !== targetSessionId) {
      try {
        stateForRun =
          this.sessionHub.getSessionState(targetSessionId) ??
          (await this.sessionHub.ensureSessionState(targetSessionId));
      } catch (err) {
        this.log('failed to resolve session state for text_input', err);
        this.sendError(
          'internal_error',
          'Failed to resolve session for text input',
          { sessionId: targetSessionId, error: String(err) },
          { retryable: true },
        );
        return;
      }
    }

    const shouldResolveTools = !!stateForRun && !!sessionIdForRun;
    const useActiveSessionTools =
      shouldResolveTools &&
      !!this.sessionState &&
      this.sessionState.summary.sessionId === sessionIdForRun;
    const sessionToolHostForRun = useActiveSessionTools
      ? this.sessionToolHost
      : this.resolveSessionToolHost(stateForRun);
    const firstMessageContent =
      stateForRun?.chatMessages?.[0] && typeof stateForRun.chatMessages[0].content === 'string'
        ? stateForRun.chatMessages[0].content
        : '';
    const systemPromptHasTools = firstMessageContent.includes('Available tools:');
    const needsPromptRefresh = shouldResolveTools && !systemPromptHasTools;

    let chatCompletionToolsForRun = this.chatCompletionTools;
    if (!useActiveSessionTools || needsPromptRefresh) {
      chatCompletionToolsForRun = await this.resolveChatCompletionTools(
        stateForRun,
        sessionToolHostForRun,
      );
      if (useActiveSessionTools) {
        this.chatCompletionTools = chatCompletionToolsForRun;
      }
    }

    return this.runChatInputWithCompletions({
      ready: this.ready,
      message,
      state: stateForRun,
      sessionId: sessionIdForRun,
      connection: this.connection,
      conversationStore: this.conversationStore,
      sessionHub: this.sessionHub,
      ...(this.openaiClient ? { openaiClient: this.openaiClient } : {}),
      config: this.config,
      chatCompletionTools: chatCompletionToolsForRun,
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
      conversationStore: this.conversationStore,
      sessionHub: this.sessionHub,
      eventStore: this.eventStore,
      maxToolCallsPerMinute: this.config.maxToolCallsPerMinute,
      rateLimitWindowMs: this.rateLimitWindowMs,
      envConfig: this.config,
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

  private sendOutputCancelled(sessionId: string, responseId?: string): void {
    const message: ServerMessage = {
      type: 'output_cancelled',
      sessionId,
      ...(responseId ? { responseId } : {}),
    } as ServerMessage;
    this.sessionHub.broadcastToSession(sessionId, message);
  }

  private handleChatOutputCancel(message: ClientControlMessage): void {
    const sessionId = typeof message.sessionId === 'string' ? message.sessionId.trim() : '';
    const activeRunState = sessionId ? this.activeRunStates.get(sessionId) : undefined;
    handleChatOutputCancelInternal({
      message,
      activeRunState,
      conversationStore: this.conversationStore,
      sessionHub: this.sessionHub,
      broadcastOutputCancelled: (sessionId, responseId) => {
        this.sendOutputCancelled(sessionId, responseId);
      },
      log: (logMessage, details) => {
        this.log(logMessage, details);
      },
      eventStore: this.eventStore,
    });
  }

  private log(...args: unknown[]): void {
    console.log(`[session ${this.sessionId ?? 'unbound'}]`, ...args);
  }
}
