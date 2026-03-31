import type {
  AssistantTextPhase,
  ChatEvent,
  ChatEventType,
  ServerMessage,
  SessionSubscriptionMask,
  ServerMessageType,
} from '@assistant/shared';

import type { SessionConnection } from './ws/sessionConnection';

export class SessionConnectionRegistry {
  private readonly connectionsBySessionId = new Map<string, Set<SessionConnection>>();
  private readonly subscriptionsByConnection = new Map<
    SessionConnection,
    Map<string, SessionSubscriptionMask | null>
  >();
  private readonly allConnections = new Set<SessionConnection>();
  private readonly connectionsById = new Map<string, SessionConnection>();
  private readonly interactionStateByConnection = new Map<
    SessionConnection,
    { supported: boolean; enabled: boolean }
  >();

  private withSessionId(message: ServerMessage, sessionId: string): ServerMessage {
    switch (message.type) {
      case 'text_delta':
      case 'text_done':
      case 'thinking_start':
      case 'thinking_delta':
      case 'thinking_done':
      case 'tool_call_start':
      case 'tool_output_delta':
      case 'tool_result':
      case 'output_cancelled':
      case 'panel_event':
        if (message.sessionId === undefined) {
          return { ...message, sessionId };
        }
        return message;
      default:
        return message;
    }
  }

  attach(sessionId: string, connection: SessionConnection): void {
    this.subscribe(sessionId, connection);
  }

  registerConnection(connection: SessionConnection): void {
    this.allConnections.add(connection);
    const connectionId = typeof connection.id === 'string' ? connection.id.trim() : '';
    if (connectionId) {
      this.connectionsById.set(connectionId, connection);
    }
  }

  unregisterConnection(connection: SessionConnection): void {
    this.allConnections.delete(connection);
    this.interactionStateByConnection.delete(connection);
    this.subscriptionsByConnection.delete(connection);
    const connectionId = typeof connection.id === 'string' ? connection.id.trim() : '';
    if (connectionId && this.connectionsById.get(connectionId) === connection) {
      this.connectionsById.delete(connectionId);
    }
  }

  detach(sessionId: string, connection: SessionConnection): void {
    this.unsubscribe(sessionId, connection);
  }

  subscribe(
    sessionId: string,
    connection: SessionConnection,
    mask?: SessionSubscriptionMask,
  ): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }

    this.allConnections.add(connection);

    let connections = this.connectionsBySessionId.get(trimmed);
    if (!connections) {
      connections = new Set();
      this.connectionsBySessionId.set(trimmed, connections);
    }
    connections.add(connection);

    let subscriptions = this.subscriptionsByConnection.get(connection);
    if (!subscriptions) {
      subscriptions = new Map();
      this.subscriptionsByConnection.set(connection, subscriptions);
    }
    subscriptions.set(trimmed, mask ?? null);
  }

  unsubscribe(sessionId: string, connection: SessionConnection): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }

    const connections = this.connectionsBySessionId.get(trimmed);
    if (connections) {
      connections.delete(connection);
      if (connections.size === 0) {
        this.connectionsBySessionId.delete(trimmed);
      }
    }

    const subscriptions = this.subscriptionsByConnection.get(connection);
    if (subscriptions) {
      subscriptions.delete(trimmed);
      if (subscriptions.size === 0) {
        this.subscriptionsByConnection.delete(connection);
      }
    }
  }

  unsubscribeAll(connection: SessionConnection): void {
    const subscriptions = this.subscriptionsByConnection.get(connection);
    if (!subscriptions) {
      return;
    }

    for (const sessionId of subscriptions.keys()) {
      const connections = this.connectionsBySessionId.get(sessionId);
      if (connections) {
        connections.delete(connection);
        if (connections.size === 0) {
          this.connectionsBySessionId.delete(sessionId);
        }
      }
    }

    this.subscriptionsByConnection.delete(connection);
  }

  setInteractionState(
    connection: SessionConnection,
    state: { supported: boolean; enabled: boolean },
  ): void {
    this.interactionStateByConnection.set(connection, state);
  }

  getInteractionState(connection: SessionConnection): { supported: boolean; enabled: boolean } {
    return this.interactionStateByConnection.get(connection) ?? { supported: false, enabled: false };
  }

  getInteractionSummary(sessionId: string): { supportedCount: number; enabledCount: number } {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return { supportedCount: 0, enabledCount: 0 };
    }
    const connections = this.connectionsBySessionId.get(trimmed);
    if (!connections) {
      return { supportedCount: 0, enabledCount: 0 };
    }

    let supportedCount = 0;
    let enabledCount = 0;
    for (const connection of connections) {
      const state = this.getInteractionState(connection);
      if (state.supported) {
        supportedCount += 1;
      }
      if (state.enabled) {
        enabledCount += 1;
      }
    }

    return { supportedCount, enabledCount };
  }

  getSubscriptions(connection: SessionConnection): ReadonlySet<string> {
    const subscriptions = this.subscriptionsByConnection.get(connection);
    return subscriptions ? new Set(subscriptions.keys()) : new Set();
  }

  getSubscriptionMask(
    connection: SessionConnection,
    sessionId: string,
  ): SessionSubscriptionMask | null | undefined {
    return this.subscriptionsByConnection.get(connection)?.get(sessionId.trim());
  }

  hasConnections(sessionId: string): boolean {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return false;
    }
    const connections = this.connectionsBySessionId.get(trimmed);
    return !!connections && connections.size > 0;
  }

  forEachInSession(sessionId: string, fn: (connection: SessionConnection) => void): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    const connections = this.connectionsBySessionId.get(trimmed);
    if (!connections) {
      return;
    }
    for (const connection of connections) {
      fn(connection);
    }
  }

  private matchesSubscriptionMask(
    message: ServerMessage,
    mask: SessionSubscriptionMask | null | undefined,
  ): boolean {
    if (!mask) {
      return true;
    }

    if (mask.serverMessageTypes && !mask.serverMessageTypes.includes(message.type as ServerMessageType)) {
      return false;
    }

    if (message.type !== 'chat_event') {
      // chatEventTypes only constrains chat_event payloads. Non-chat-event
      // messages are filtered solely by the dimensions that apply to them.
      const topLevelToolName = this.getTopLevelToolName(message);
      if (topLevelToolName && mask.toolNames && !mask.toolNames.includes(topLevelToolName)) {
        return false;
      }
      const topLevelPhase = this.getTopLevelAssistantPhase(message);
      if (topLevelPhase && mask.messagePhases && !mask.messagePhases.includes(topLevelPhase)) {
        return false;
      }
      return true;
    }

    const event = message.event;
    if (mask.chatEventTypes && !mask.chatEventTypes.includes(event.type as ChatEventType)) {
      return false;
    }

    const eventToolName = this.getChatEventToolName(event);
    if (eventToolName && mask.toolNames && !mask.toolNames.includes(eventToolName)) {
      return false;
    }

    const eventPhase = this.getChatEventAssistantPhase(event);
    if (eventPhase && mask.messagePhases && !mask.messagePhases.includes(eventPhase)) {
      return false;
    }

    return true;
  }

  private getTopLevelToolName(message: ServerMessage): string | null {
    switch (message.type) {
      case 'tool_call':
      case 'tool_call_start':
      case 'tool_output_delta':
      case 'tool_result':
        return message.toolName;
      default:
        return null;
    }
  }

  private getTopLevelAssistantPhase(message: ServerMessage): AssistantTextPhase | null {
    switch (message.type) {
      case 'text_delta':
      case 'text_done':
        return message.phase ?? null;
      default:
        return null;
    }
  }

  private getChatEventToolName(event: ChatEvent): string | null {
    switch (event.type) {
      case 'tool_call':
      case 'tool_input_chunk':
      case 'tool_output_chunk':
        return event.payload.toolName;
      default:
        return null;
    }
  }

  private getChatEventAssistantPhase(event: ChatEvent): AssistantTextPhase | null {
    switch (event.type) {
      case 'assistant_chunk':
      case 'assistant_done':
        return event.payload.phase ?? null;
      default:
        return null;
    }
  }

  broadcastToSession(sessionId: string, message: ServerMessage): void {
    const messageWithSessionId = this.withSessionId(message, sessionId);
    this.forEachInSession(sessionId, (connection) => {
      const mask = this.getSubscriptionMask(connection, sessionId);
      if (!this.matchesSubscriptionMask(messageWithSessionId, mask)) {
        return;
      }
      connection.sendServerMessageFromHub(messageWithSessionId);
    });
  }

  broadcastToSessionExcluding(
    sessionId: string,
    message: ServerMessage,
    excludeConnection: SessionConnection,
  ): void {
    const messageWithSessionId = this.withSessionId(message, sessionId);
    this.forEachInSession(sessionId, (connection) => {
      if (connection === excludeConnection) {
        return;
      }
      const mask = this.getSubscriptionMask(connection, sessionId);
      if (!this.matchesSubscriptionMask(messageWithSessionId, mask)) {
        return;
      }
      connection.sendServerMessageFromHub(messageWithSessionId);
    });
  }

  broadcastToAll(message: ServerMessage): void {
    // Global broadcasts are not scoped through per-session subscriptions and
    // therefore intentionally bypass session masks.
    for (const connection of this.allConnections) {
      connection.sendServerMessageFromHub(message);
    }
  }

  sendToConnection(connectionId: string, message: ServerMessage): boolean {
    const trimmed = connectionId.trim();
    if (!trimmed) {
      return false;
    }
    const connection = this.connectionsById.get(trimmed);
    if (!connection) {
      return false;
    }
    connection.sendServerMessageFromHub(message);
    return true;
  }
}
