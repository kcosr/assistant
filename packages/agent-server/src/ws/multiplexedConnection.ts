import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';

import type { ServerMessage } from '@assistant/shared';

import type { ToolHost } from '../tools';
import type { EventStore } from '../events';
import type { SessionHub, LogicalSessionState } from '../sessionHub';
import type { EnvConfig } from '../envConfig';
import type { ChatCompletionToolCallState } from '../chatCompletionTypes';
import type { ScheduledSessionService } from '../scheduledSessions/scheduledSessionService';
import type { SearchService } from '../search/searchService';

import type { SessionConnection } from './sessionConnection';
import { SessionRuntime } from './sessionRuntime';
import { createWsTransport } from './wsTransport';

export interface MultiplexedConnectionOptions {
  clientSocket: WebSocket;
  config: EnvConfig;
  toolHost: ToolHost;
  sessionHub: SessionHub;
  eventStore: EventStore;
  scheduledSessionService?: ScheduledSessionService;
  searchService?: SearchService;
  connectionId?: string;
}

/**
 * MultiplexedConnection represents a single physical WebSocket connection
 * that can subscribe to updates for multiple logical sessions.
 *
 * It owns a SessionRuntime instance that manages per-session state
 * for the connection while tracking additional session subscriptions
 * for multiplexed broadcasts.
 */
export class MultiplexedConnection implements SessionConnection {
  readonly id: string;
  private readonly runtime: SessionRuntime;
  private readonly subscriptions = new Set<string>();

  constructor(options: MultiplexedConnectionOptions) {
    this.id = options.connectionId ?? randomUUID();
    const transport = createWsTransport(options.clientSocket);
    const openaiClient = options.config.apiKey
      ? new OpenAI({ apiKey: options.config.apiKey })
      : undefined;

    this.runtime = new SessionRuntime({
      transport,
      connection: this,
      connectionId: this.id,
      config: options.config,
      toolHost: options.toolHost,
      sessionHub: options.sessionHub,
      eventStore: options.eventStore,
      ...(options.searchService ? { searchService: options.searchService } : {}),
      ...(options.scheduledSessionService
        ? { scheduledSessionService: options.scheduledSessionService }
        : {}),
      ...(openaiClient ? { openaiClient } : {}),
    });

    options.clientSocket.on('message', (data: RawData, isBinary: boolean) => {
      try {
        this.runtime.onSocketMessage(data, isBinary);
      } catch {
        // runtime should handle errors, but avoid crashing ws event loop
      }
    });

    options.clientSocket.on('close', (code: number, reason: Buffer) => {
      try {
        this.runtime.onSocketClosed(code, reason);
      } catch {
        // ignore
      }
    });

    options.clientSocket.on('error', (err) => {
      try {
        this.runtime.onSocketError(err);
      } catch {
        // ignore
      }
    });
  }

  /**
   * Subscribe this connection to the given logical session.
   *
   * This only updates local subscription state; the caller is
   * responsible for updating SessionHub / SessionConnectionRegistry.
   */
  subscribe(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    this.subscriptions.add(trimmed);
  }

  /**
   * Unsubscribe this connection from the given logical session.
   *
   * This only updates local subscription state; the caller is
   * responsible for updating SessionHub / SessionConnectionRegistry.
   */
  unsubscribe(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    this.subscriptions.delete(trimmed);
  }

  /**
   * Clear all local subscriptions for this connection.
   *
   * SessionHub is responsible for detaching the connection from all
   * sessions in the SessionConnectionRegistry.
   */
  unsubscribeAll(): void {
    this.subscriptions.clear();
  }

  getSubscriptions(): ReadonlySet<string> {
    return this.subscriptions;
  }

  isSubscribedTo(sessionId: string): boolean {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return false;
    }
    return this.subscriptions.has(trimmed);
  }

  /**
   * Send a message only if this connection is subscribed to the given
   * logical session id.
   */
  sendIfSubscribed(sessionId: string, message: ServerMessage): void {
    if (!this.isSubscribedTo(sessionId)) {
      return;
    }
    this.sendServerMessageFromHub(message);
  }

  sendServerMessageFromHub(message: ServerMessage): void {
    this.runtime.sendServerMessageFromHub(message);
  }

  sendErrorFromHub(code: string, message: string): void {
    this.runtime.sendErrorFromHub(code, message);
  }

  close(): void {
    this.runtime.close();
  }

  get sessionId(): string | undefined {
    return (this.runtime as unknown as { sessionId?: string }).sessionId;
  }

  set sessionId(value: string | undefined) {
    (this.runtime as unknown as { sessionId?: string | undefined }).sessionId = value;
  }

  get sessionState(): LogicalSessionState | undefined {
    return (this.runtime as unknown as { sessionState?: LogicalSessionState }).sessionState;
  }

  set sessionState(value: LogicalSessionState | undefined) {
    (this.runtime as unknown as { sessionState?: LogicalSessionState | undefined }).sessionState =
      value;
  }

  get chatCompletionTools(): unknown[] | undefined {
    return (this.runtime as unknown as { chatCompletionTools?: unknown[] }).chatCompletionTools;
  }

  get sessionToolHost(): ToolHost | undefined {
    return (this.runtime as unknown as { sessionToolHost?: ToolHost }).sessionToolHost;
  }

  configureSessionToolHost(): void {
    (
      this.runtime as unknown as {
        configureSessionToolHost(): void;
      }
    ).configureSessionToolHost();
  }

  configureChatCompletionsSession(): Promise<void> {
    return (
      this.runtime as unknown as {
        configureChatCompletionsSession(): Promise<void>;
      }
    ).configureChatCompletionsSession();
  }

  async handleChatToolCalls(
    sessionId: string,
    state: LogicalSessionState,
    toolCalls: ChatCompletionToolCallState[],
    sessionToolHost?: ToolHost,
  ): Promise<void> {
    const resolvedToolHost =
      sessionToolHost ??
      this.sessionToolHost ??
      (this.runtime as unknown as { baseToolHost?: ToolHost }).baseToolHost;
    if (!resolvedToolHost) {
      throw new Error('Session tool host is not initialised');
    }
    return this.runtime.handleChatToolCalls(sessionId, state, toolCalls, resolvedToolHost);
  }
}
