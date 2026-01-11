import type { ServerMessage } from '@assistant/shared';

import type { SessionConnection } from './ws/sessionConnection';

export class SessionConnectionRegistry {
  private readonly connectionsBySessionId = new Map<string, Set<SessionConnection>>();
  private readonly sessionIdsByConnection = new Map<SessionConnection, Set<string>>();
  private readonly allConnections = new Set<SessionConnection>();
  private readonly connectionsById = new Map<string, SessionConnection>();

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
    const connectionId = typeof connection.id === 'string' ? connection.id.trim() : '';
    if (connectionId && this.connectionsById.get(connectionId) === connection) {
      this.connectionsById.delete(connectionId);
    }
  }

  detach(sessionId: string, connection: SessionConnection): void {
    this.unsubscribe(sessionId, connection);
  }

  subscribe(sessionId: string, connection: SessionConnection): void {
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

    let sessionIds = this.sessionIdsByConnection.get(connection);
    if (!sessionIds) {
      sessionIds = new Set();
      this.sessionIdsByConnection.set(connection, sessionIds);
    }
    sessionIds.add(trimmed);
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

    const sessionIds = this.sessionIdsByConnection.get(connection);
    if (sessionIds) {
      sessionIds.delete(trimmed);
      if (sessionIds.size === 0) {
        this.sessionIdsByConnection.delete(connection);
      }
    }
  }

  unsubscribeAll(connection: SessionConnection): void {
    const sessionIds = this.sessionIdsByConnection.get(connection);
    if (!sessionIds) {
      return;
    }

    for (const sessionId of sessionIds) {
      const connections = this.connectionsBySessionId.get(sessionId);
      if (connections) {
        connections.delete(connection);
        if (connections.size === 0) {
          this.connectionsBySessionId.delete(sessionId);
        }
      }
    }

    this.sessionIdsByConnection.delete(connection);
  }

  getSubscriptions(connection: SessionConnection): ReadonlySet<string> {
    const ids = this.sessionIdsByConnection.get(connection);
    return ids ? new Set(ids) : new Set();
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

  broadcastToSession(sessionId: string, message: ServerMessage): void {
    const messageWithSessionId = this.withSessionId(message, sessionId);
    this.forEachInSession(sessionId, (connection) => {
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
      connection.sendServerMessageFromHub(messageWithSessionId);
    });
  }

  broadcastToAll(message: ServerMessage): void {
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
