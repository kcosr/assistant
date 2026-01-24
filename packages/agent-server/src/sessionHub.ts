import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type {
  ChatEvent,
  ServerMessage,
  ServerMessageDequeuedMessage,
  ServerMessageQueuedMessage,
  ServerSessionClearedMessage,
  ServerSessionCreatedMessage,
  ServerSessionDeletedMessage,
  ServerSessionUpdatedMessage,
  SessionAttributesPatch,
} from '@assistant/shared';

import { AgentRegistry } from './agents';
import type { EventStore } from './events';
import type { HistoryProviderRegistry } from './history/historyProvider';
import { SessionIndex, type SessionSummary } from './sessionIndex';
import type { PluginRegistry } from './plugins/registry';
import type { ChatCompletionMessage } from './chatCompletionTypes';
import type { TtsStreamingSession } from './tts/types';
import type { SessionConnection } from './ws/sessionConnection';
import { buildChatMessagesFromEvents } from './sessionChatMessages';
import { SessionConnectionRegistry } from './sessionConnectionRegistry';
import { InteractionRegistry } from './ws/interactionRegistry';
import {
  CliToolCallRendezvous,
  type CliToolCallMatchOptions,
  type CliToolCallRecord,
} from './ws/cliToolCallRendezvous';

export interface LogicalSessionState {
  summary: SessionSummary;
  chatMessages: ChatCompletionMessage[];
  activeChatRun?:
    | {
        /**
         * Identifier for the current turn. Used to group
         * chat events (user message, assistant response,
         * tools, callbacks) in the unified event log.
         */
        turnId?: string;
        responseId: string;
        abortController: AbortController;
        ttsSession?: TtsStreamingSession;
        /**
         * Optional identifier used to group streaming messages and tool
         * calls that belong to a single agent-to-agent exchange initiated
         * via agents_message.
         *
         * When present, this value is propagated to server messages so
         * clients can render the entire exchange inside a single tool
         * block.
         */
        agentExchangeId?: string;
        /**
         * Approximate playback offset (in ms) where the client
         * requested output cancellation for the current response.
         */
        audioTruncatedAtMs?: number;
        /**
         * Accumulated text from the streaming response so far. Used to
         * save partial text when the response is interrupted.
         */
        accumulatedText: string;
        /**
         * Timestamp of the first text delta. Used to ensure interrupted
         * assistant messages are logged with correct ordering.
         */
        textStartedAt?: string;
        /**
         * Tool calls that have started during this chat run but have not
         * yet completed. Used so that output cancellation can mark them
         * as interrupted in the conversation log.
         */
        activeToolCalls?: Map<
          string,
          {
            callId: string;
            toolName: string;
            argsJson: string;
          }
        >;
        /**
         * True when this chat run was cancelled via an explicit output
         * cancel control message. This is used to distinguish user
         * interrupts from other abort reasons (for example, session
         * switching) so that only user cancels mark tool calls as
         * interrupted.
         */
        outputCancelled?: boolean;
      }
    | undefined;
  deleted?: boolean;
  messageQueue: QueuedMessage[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  queuedAt: string;
  source: 'user' | 'agent';
  fromAgentId?: string;
  fromSessionId?: string;
}

interface QueuedMessageTask extends QueuedMessage {
  sessionId: string;
  execute: () => Promise<void>;
}

export class SessionHub {
  private readonly sessionIndex: SessionIndex;
  private readonly agentRegistry: AgentRegistry;
  private readonly sessions = new Map<string, LogicalSessionState>();
  private readonly connections = new SessionConnectionRegistry();
  private readonly interactionRegistry = new InteractionRegistry();
  private readonly cliToolCallRendezvous = new CliToolCallRendezvous();
  private readonly pluginRegistry: PluginRegistry | undefined;
  private readonly queuedMessageTasks = new Map<string, QueuedMessageTask>();
  private readonly maxCachedSessions: number;
  private readonly sessionAccessOrder: string[] = [];
  private readonly historyProvider: HistoryProviderRegistry | undefined;
  private readonly eventStore: EventStore | undefined;

  private readonly resolveSessionWorkingDir: ((sessionId: string) => string | null) | undefined;

  constructor(options: {
    sessionIndex: SessionIndex;
    agentRegistry: AgentRegistry;
    pluginRegistry?: PluginRegistry;
    maxCachedSessions?: number;
    /** Optional resolver for core.workingDir when a session is created/loaded */
    resolveSessionWorkingDir?: (sessionId: string) => string | null;
    historyProvider?: HistoryProviderRegistry;
    eventStore?: EventStore;
  }) {
    this.sessionIndex = options.sessionIndex;
    this.agentRegistry = options.agentRegistry;
    this.pluginRegistry = options.pluginRegistry;
    this.resolveSessionWorkingDir = options.resolveSessionWorkingDir;
    this.historyProvider = options.historyProvider;
    this.eventStore = options.eventStore;

    const rawMaxCached = options.maxCachedSessions;
    if (rawMaxCached !== undefined && Number.isFinite(rawMaxCached) && rawMaxCached > 0) {
      this.maxCachedSessions = Math.floor(rawMaxCached);
    } else {
      this.maxCachedSessions = 100;
    }
  }

  getSessionIndex(): SessionIndex {
    return this.sessionIndex;
  }

  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  getPluginRegistry(): PluginRegistry | undefined {
    return this.pluginRegistry;
  }

  async listSessionSummaries(): Promise<SessionSummary[]> {
    const summaries = await this.sessionIndex.listSessions();
    return summaries.filter((session) => !session.deleted);
  }

  getMessageQueue(sessionId: string): QueuedMessage[] {
    const state = this.sessions.get(sessionId);
    return state?.messageQueue ?? [];
  }

  getInteractionRegistry(): InteractionRegistry {
    return this.interactionRegistry;
  }

  recordCliToolCall(options: {
    sessionId: string;
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): void {
    this.cliToolCallRendezvous.record(options);
  }

  matchCliToolCall(options: CliToolCallMatchOptions): Promise<CliToolCallRecord | undefined> {
    return this.cliToolCallRendezvous.match(options);
  }

  setInteractionState(
    connection: SessionConnection,
    state: { supported: boolean; enabled: boolean },
  ): void {
    this.connections.setInteractionState(connection, state);
  }

  getInteractionAvailability(sessionId: string): {
    supportedCount: number;
    enabledCount: number;
    available: boolean;
  } {
    const { supportedCount, enabledCount } = this.connections.getInteractionSummary(sessionId);
    return {
      supportedCount,
      enabledCount,
      available: enabledCount > 0,
    };
  }

  async attachConnection(
    connection: SessionConnection,
    requestedSessionId?: string,
    forceReload?: boolean,
  ): Promise<LogicalSessionState> {
    const targetSummary = await this.resolveTargetSession(requestedSessionId);
    const state = await this.ensureSessionState(
      targetSummary.sessionId,
      targetSummary,
      forceReload,
    );

    this.subscribeConnection(connection, state.summary.sessionId);

    return state;
  }

  detachConnection(connection: SessionConnection, sessionId: string | undefined): void {
    if (!sessionId) {
      return;
    }
    this.unsubscribeConnection(connection, sessionId);
  }

  async subscribeConnection(
    connection: SessionConnection,
    sessionId: string,
  ): Promise<LogicalSessionState> {
    this.connections.registerConnection(connection);
    const state = await this.ensureSessionState(sessionId);
    this.connections.subscribe(sessionId, connection);
    if (typeof connection.subscribe === 'function') {
      connection.subscribe(sessionId);
    }
    return state;
  }

  unsubscribeConnection(connection: SessionConnection, sessionId: string): void {
    this.connections.unsubscribe(sessionId, connection);
    if (typeof connection.unsubscribe === 'function') {
      connection.unsubscribe(sessionId);
    }
  }

  detachConnectionFromAllSessions(connection: SessionConnection): void {
    const sessionIds = this.connections.getSubscriptions(connection);
    this.connections.unsubscribeAll(connection);
    if (typeof connection.unsubscribe === 'function') {
      for (const sessionId of sessionIds) {
        connection.unsubscribe(sessionId);
      }
    }
    this.connections.unregisterConnection(connection);
  }

  getConnectionSubscriptions(connection: SessionConnection): ReadonlySet<string> {
    return this.connections.getSubscriptions(connection);
  }

  async recordSessionActivity(
    sessionId: string,
    lastSnippet?: string,
  ): Promise<SessionSummary | undefined> {
    const summary = await this.sessionIndex.markSessionActivity(sessionId, lastSnippet);
    const state = this.sessions.get(sessionId);
    if (state) {
      state.summary = summary;
    }

    // Broadcast session_updated to ALL clients so they can update sidebar sorting
    if (summary) {
      const updatedMessage: ServerSessionUpdatedMessage = {
        type: 'session_updated',
        sessionId,
        updatedAt: summary.updatedAt,
        ...(typeof summary.name === 'string' ? { name: summary.name } : {}),
        ...(typeof summary.pinnedAt === 'string' ? { pinnedAt: summary.pinnedAt } : {}),
      };
      this.connections.broadcastToAll(updatedMessage);
    }

    return summary;
  }

  async pinSession(
    sessionId: string,
    pinnedAt: string | null,
  ): Promise<SessionSummary | undefined> {
    const summary = await this.sessionIndex.pinSession(sessionId, pinnedAt);
    if (!summary) {
      return undefined;
    }

    const state = this.sessions.get(sessionId);
    if (state) {
      state.summary = summary;
    }

    const updatedMessage: ServerSessionUpdatedMessage = {
      type: 'session_updated',
      sessionId,
      updatedAt: summary.updatedAt,
      ...(typeof summary.name === 'string' ? { name: summary.name } : {}),
      ...(typeof summary.pinnedAt === 'string'
        ? { pinnedAt: summary.pinnedAt }
        : { pinnedAt: null }),
    };
    this.connections.broadcastToAll(updatedMessage);

    return summary;
  }

  async updateSessionAttributes(
    sessionId: string,
    patch: SessionAttributesPatch,
  ): Promise<SessionSummary | undefined> {
    const summary = await this.sessionIndex.updateSessionAttributes(sessionId, patch);
    if (!summary) {
      return undefined;
    }

    const state = this.sessions.get(sessionId);
    if (state) {
      state.summary = summary;
    }

    const updatedMessage: ServerSessionUpdatedMessage = {
      type: 'session_updated',
      sessionId,
      updatedAt: summary.updatedAt,
      ...(typeof summary.name === 'string' ? { name: summary.name } : {}),
      ...(typeof summary.pinnedAt === 'string' ? { pinnedAt: summary.pinnedAt } : {}),
      attributes: summary.attributes ?? null,
    };
    this.connections.broadcastToAll(updatedMessage);

    return summary;
  }

  async deleteSession(sessionId: string): Promise<SessionSummary | undefined> {
    console.log('[sessionHub] deleteSession', { sessionId });
    const summary = await this.sessionIndex.markSessionDeleted(sessionId);
    this.interactionRegistry.clearSession(sessionId);
    this.cliToolCallRendezvous.clearSession(sessionId);
    try {
      if (this.eventStore) {
        await this.eventStore.deleteSession(sessionId);
      }
    } catch (err) {
      console.error('[sessionHub] Failed to delete session history for deleted session', err);
    }
    const state = this.sessions.get(sessionId);
    if (state) {
      state.deleted = true;
      const active = state.activeChatRun;
      if (active) {
        console.log('[sessionHub] aborting active chat run on deleted session', {
          sessionId,
          responseId: active.responseId,
        });
        active.abortController.abort();
        state.activeChatRun = undefined;
        const message: ServerMessage = {
          type: 'output_cancelled',
          ...(active.responseId ? { responseId: active.responseId } : {}),
        } as ServerMessage;
        this.connections.broadcastToSession(sessionId, message);
      }
    }

    this.connections.forEachInSession(sessionId, (connection) => {
      connection.sendErrorFromHub(
        'session_deleted',
        'This session has been deleted. Please switch to another session.',
      );
    });

    // Broadcast session_deleted to ALL clients so they can update their sidebar
    const deletedMessage: ServerSessionDeletedMessage = {
      type: 'session_deleted',
      sessionId,
    };
    this.connections.broadcastToAll(deletedMessage);

    if (this.pluginRegistry?.handleSessionDeleted) {
      try {
        await this.pluginRegistry.handleSessionDeleted(sessionId);
      } catch (err) {
        console.error('[sessionHub] Failed to notify plugins of session deletion', err);
      }
    }

    return summary;
  }

  async clearSession(sessionId: string): Promise<SessionSummary> {
    console.log('[sessionHub] clearSession', { sessionId });
    const existing = await this.sessionIndex.getSession(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (existing.deleted) {
      throw new Error(`Cannot clear deleted session: ${sessionId}`);
    }

    if (this.eventStore) {
      await this.eventStore.clearSession(sessionId);
    }
    this.cliToolCallRendezvous.clearSession(sessionId);
    const summary = await this.sessionIndex.clearSession(sessionId);

    const state = this.sessions.get(sessionId);
    if (state) {
      const chatMessages = await this.resolveChatMessages(summary, true);
      state.summary = summary;
      state.chatMessages = chatMessages;
    }

    // Broadcast session_cleared to all clients connected to this session
    const clearedMessage: ServerSessionClearedMessage = {
      type: 'session_cleared',
      sessionId,
    };
    this.connections.broadcastToSession(sessionId, clearedMessage);

    return summary;
  }

  async touchSession(sessionId: string): Promise<SessionSummary | undefined> {
    const summary = await this.sessionIndex.touchSession(sessionId);
    if (!summary) {
      return undefined;
    }

    const state = this.sessions.get(sessionId);
    if (state) {
      state.summary = summary;
    }

    // Broadcast session_updated to ALL clients so they can update sidebar sorting
    const updatedMessage: ServerSessionUpdatedMessage = {
      type: 'session_updated',
      sessionId,
      updatedAt: summary.updatedAt,
      ...(typeof summary.name === 'string' ? { name: summary.name } : {}),
      ...(typeof summary.pinnedAt === 'string' ? { pinnedAt: summary.pinnedAt } : {}),
    };
    this.connections.broadcastToAll(updatedMessage);

    return summary;
  }

  broadcastToSession(sessionId: string, message: ServerMessage): void {
    this.connections.broadcastToSession(sessionId, message);
  }

  broadcastToSessionExcluding(
    sessionId: string,
    message: ServerMessage,
    excludeConnection: SessionConnection,
  ): void {
    this.connections.broadcastToSessionExcluding(sessionId, message, excludeConnection);
  }

  /**
   * Broadcast a message to ALL connected clients (across all sessions).
   * Used for session list updates (delete, touch) that affect the sidebar.
   */
  broadcastToAll(message: ServerMessage): void {
    this.connections.broadcastToAll(message);
  }

  sendToConnection(connectionId: string, message: ServerMessage): boolean {
    return this.connections.sendToConnection(connectionId, message);
  }

  registerConnection(connection: SessionConnection): void {
    this.connections.registerConnection(connection);
  }

  unregisterConnection(connection: SessionConnection): void {
    this.connections.unregisterConnection(connection);
  }

  /**
   * Broadcast that a new session was created to all connected clients.
   * Used when agents create sessions via agents_message.
   */
  broadcastSessionCreated(summary: SessionSummary): void {
    const message: ServerSessionCreatedMessage = {
      type: 'session_created',
      sessionId: summary.sessionId,
      ...(summary.agentId ? { agentId: summary.agentId } : {}),
      createdAt: summary.createdAt,
    };
    this.connections.broadcastToAll(message);
  }

  getSessionState(sessionId: string): LogicalSessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (state) {
      this.touchSessionAccess(sessionId);
    }
    return state;
  }

  shouldPersistSessionEvents(summary: SessionSummary): boolean {
    if (!this.historyProvider) {
      return true;
    }
    const agentId = summary.agentId;
    const agent = agentId ? this.agentRegistry.getAgent(agentId) : undefined;
    const providerId = agent?.chat?.provider;
    return this.historyProvider.shouldPersist({
      sessionId: summary.sessionId,
      ...(agentId ? { agentId } : {}),
      ...(agent ? { agent } : {}),
      ...(providerId ? { providerId } : {}),
      ...(summary.attributes ? { attributes: summary.attributes } : {}),
    });
  }

  async ensureSessionState(
    sessionId: string,
    summaryHint?: SessionSummary,
    forceReload?: boolean,
  ): Promise<LogicalSessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing && !forceReload) {
      this.touchSessionAccess(sessionId);
      return existing;
    }

    let summary = summaryHint ?? (await this.sessionIndex.getSession(sessionId));
    if (!summary) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    summary = await this.ensureSessionWorkingDir(summary);

    const chatMessages = await this.resolveChatMessages(summary, forceReload);

    const state: LogicalSessionState = {
      summary,
      chatMessages,
      activeChatRun: existing?.activeChatRun, // Preserve active run if reloading
      messageQueue: existing?.messageQueue ?? [],
    };
    this.sessions.set(sessionId, state);
    this.touchSessionAccess(sessionId);
    return state;
  }

  private async resolveChatMessages(
    summary: SessionSummary,
    forceReload?: boolean,
  ): Promise<ChatCompletionMessage[]> {
    const events = await this.loadSessionEvents(summary, forceReload);
    return buildChatMessagesFromEvents(
      events,
      this.agentRegistry,
      summary.agentId,
      undefined,
      summary.sessionId,
    );
  }

  private async loadSessionEvents(
    summary: SessionSummary,
    forceReload?: boolean,
  ): Promise<ChatEvent[]> {
    if (!this.historyProvider) {
      return [];
    }
    const agentId = summary.agentId;
    const agent = agentId ? this.agentRegistry.getAgent(agentId) : undefined;
    const providerId = agent?.chat?.provider;
    return this.historyProvider.getHistory({
      sessionId: summary.sessionId,
      ...(agentId ? { agentId } : {}),
      ...(agent ? { agent } : {}),
      ...(providerId ? { providerId } : {}),
      ...(summary.attributes ? { attributes: summary.attributes } : {}),
      ...(forceReload ? { force: true } : {}),
    });
  }

  private touchSessionAccess(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    const index = this.sessionAccessOrder.indexOf(trimmed);
    if (index !== -1) {
      this.sessionAccessOrder.splice(index, 1);
    }
    this.sessionAccessOrder.push(trimmed);
    this.evictIfNeeded();
  }

  private async ensureSessionWorkingDir(summary: SessionSummary): Promise<SessionSummary> {
    if (summary.deleted) {
      return summary;
    }
    const resolver = this.resolveSessionWorkingDir;
    if (!resolver) {
      return summary;
    }
    const existing = summary.attributes?.core?.workingDir;
    if (typeof existing === 'string' && existing.trim().length > 0) {
      if (path.isAbsolute(existing)) {
        try {
          await mkdir(existing, { recursive: true });
        } catch (err) {
          console.error('[sessionHub] Failed to ensure core.workingDir', {
            sessionId: summary.sessionId,
            workingDir: existing,
            error: err instanceof Error ? err.message : err,
          });
        }
      }
      return summary;
    }
    const resolved = resolver(summary.sessionId);
    if (!resolved || resolved.trim().length === 0) {
      return summary;
    }
    try {
      await mkdir(resolved, { recursive: true });
      const updated = await this.updateSessionAttributes(summary.sessionId, {
        core: { workingDir: resolved },
      });
      return updated ?? summary;
    } catch (err) {
      console.error('[sessionHub] Failed to set core.workingDir', {
        sessionId: summary.sessionId,
        workingDir: resolved,
        error: err instanceof Error ? err.message : err,
      });
      return summary;
    }
  }

  private evictIfNeeded(): void {
    if (this.maxCachedSessions <= 0) {
      return;
    }
    if (this.sessions.size <= this.maxCachedSessions) {
      return;
    }

    const maxAttempts = this.sessionAccessOrder.length;
    let attempts = 0;

    while (this.sessions.size > this.maxCachedSessions && attempts < maxAttempts) {
      const oldest = this.sessionAccessOrder.shift();
      if (!oldest) {
        break;
      }
      attempts += 1;

      const state = this.sessions.get(oldest);
      if (!state) {
        continue;
      }
      if (state.activeChatRun || this.connections.hasConnections(oldest)) {
        this.sessionAccessOrder.push(oldest);
        continue;
      }

      this.sessions.delete(oldest);
    }
  }

  private async resolveTargetSession(requestedSessionId?: string): Promise<SessionSummary> {
    if (requestedSessionId) {
      const existing = await this.sessionIndex.getSession(requestedSessionId);
      if (existing && !existing.deleted) {
        return existing;
      }
    }

    const summaries = await this.sessionIndex.listSessions();
    const activeSessions = summaries.filter((session) => !session.deleted);

    if (activeSessions.length > 0) {
      activeSessions.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const latest = activeSessions[0];
      if (latest) {
        return latest;
      }
    }

    throw new Error('No sessions available. Please create a session first.');
  }

  async queueMessage(options: {
    sessionId: string;
    text: string;
    source: 'user' | 'agent';
    fromAgentId?: string;
    fromSessionId?: string;
    clientMessageId?: string;
    execute: () => Promise<void>;
  }): Promise<QueuedMessage> {
    const { sessionId, text, source, fromAgentId, fromSessionId, clientMessageId, execute } =
      options;

    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      throw new Error('queueMessage requires a non-empty sessionId');
    }

    const state = await this.ensureSessionState(trimmedSessionId);
    const id = randomUUID();
    const queuedAt = new Date().toISOString();

    console.log('[sessionHub] queueMessage', {
      sessionId: trimmedSessionId,
      messageId: id,
      source,
      fromAgentId,
      fromSessionId,
      textPreview: text.slice(0, 100),
    });

    const base: QueuedMessage = {
      id,
      text,
      queuedAt,
      source,
      ...(source === 'agent' && fromAgentId ? { fromAgentId } : {}),
      ...(source === 'agent' && fromSessionId ? { fromSessionId } : {}),
    };

    state.messageQueue.push(base);

    const task: QueuedMessageTask = {
      ...base,
      sessionId: trimmedSessionId,
      execute,
    };
    this.queuedMessageTasks.set(id, task);

    const queuedMessage: ServerMessageQueuedMessage = {
      type: 'message_queued',
      messageId: id,
      text,
      position: state.messageQueue.length,
      sessionId: trimmedSessionId,
      source,
      ...(fromAgentId ? { fromAgentId } : {}),
      ...(fromSessionId ? { fromSessionId } : {}),
      ...(clientMessageId ? { clientMessageId } : {}),
    };
    this.connections.broadcastToSession(trimmedSessionId, queuedMessage);

    return base;
  }

  async dequeueMessageById(
    messageId: string,
  ): Promise<{ message: QueuedMessage; sessionId: string } | undefined> {
    const trimmedId = messageId.trim();
    if (!trimmedId) {
      return undefined;
    }

    for (const [sessionId, state] of this.sessions.entries()) {
      const queue = state.messageQueue;
      if (!queue || queue.length === 0) {
        continue;
      }
      const index = queue.findIndex((entry) => entry.id === trimmedId);
      if (index === -1) {
        continue;
      }

      const [removed] = queue.splice(index, 1);
      if (!removed) {
        return undefined;
      }
      this.queuedMessageTasks.delete(trimmedId);

      const message: ServerMessageDequeuedMessage = {
        type: 'message_dequeued',
        messageId: trimmedId,
        sessionId,
      };
      this.connections.broadcastToSession(sessionId, message);

      return { message: removed, sessionId };
    }

    return undefined;
  }

  async processNextQueuedMessage(sessionId: string): Promise<boolean> {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return false;
    }

    const state = await this.ensureSessionState(trimmed);
    if (state.activeChatRun) {
      return false;
    }

    const queue = state.messageQueue;
    if (!queue || queue.length === 0) {
      return false;
    }

    const next = queue.shift();
    if (!next) {
      return false;
    }

    console.log('[sessionHub] processNextQueuedMessage', {
      sessionId: trimmed,
      messageId: next.id,
      source: next.source,
      remainingInQueue: queue.length,
    });

    const task = this.queuedMessageTasks.get(next.id);
    this.queuedMessageTasks.delete(next.id);

    const dequeuedMessage: ServerMessageDequeuedMessage = {
      type: 'message_dequeued',
      messageId: next.id,
      sessionId: trimmed,
    };
    this.connections.broadcastToSession(trimmed, dequeuedMessage);

    if (!task) {
      console.warn('[sessionHub] processNextQueuedMessage: no task found for message', {
        sessionId: trimmed,
        messageId: next.id,
      });
      return false;
    }

    try {
      await task.execute();
    } catch (err) {
      console.error('[sessionHub] Error processing queued message', {
        sessionId: trimmed,
        messageId: next.id,
        error: err,
      });
    }

    return true;
  }
}
