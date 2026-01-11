import { describe, expect, it, vi } from 'vitest';

import type { ServerMessage } from '@assistant/shared';

import { SessionConnectionRegistry } from './sessionConnectionRegistry';
import type { SessionConnection } from './ws/sessionConnection';

function createTestConnection(): {
  connection: SessionConnection;
  sendServerMessageFromHub: ReturnType<typeof vi.fn>;
} {
  const sendServerMessageFromHub = vi.fn();
  const sendErrorFromHub = vi.fn();

  const connection: SessionConnection = {
    sendServerMessageFromHub,
    sendErrorFromHub,
  };

  return { connection, sendServerMessageFromHub };
}

describe('SessionConnectionRegistry', () => {
  it('tracks subscriptions and unsubscriptions in both directions', () => {
    const registry = new SessionConnectionRegistry();
    const { connection: connection1, sendServerMessageFromHub: send1 } = createTestConnection();
    const { connection: connection2, sendServerMessageFromHub: send2 } = createTestConnection();

    registry.subscribe('session-a', connection1);
    registry.subscribe('session-a', connection2);
    registry.subscribe('session-b', connection1);

    expect(Array.from(registry.getSubscriptions(connection1)).sort()).toEqual([
      'session-a',
      'session-b',
    ]);
    expect(Array.from(registry.getSubscriptions(connection2))).toEqual(['session-a']);

    const message: ServerMessage = { type: 'session_cleared', sessionId: 'session-a' };
    registry.broadcastToSession('session-a', message);

    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);

    registry.unsubscribe('session-a', connection1);

    expect(Array.from(registry.getSubscriptions(connection1))).toEqual(['session-b']);
    expect(Array.from(registry.getSubscriptions(connection2))).toEqual(['session-a']);
  });

  it('unsubscribeAll removes connection from all sessions', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.subscribe('session-a', connection);
    registry.subscribe('session-b', connection);

    expect(Array.from(registry.getSubscriptions(connection)).sort()).toEqual([
      'session-a',
      'session-b',
    ]);

    registry.unsubscribeAll(connection);

    expect(Array.from(registry.getSubscriptions(connection))).toEqual([]);

    const message: ServerMessage = { type: 'session_cleared', sessionId: 'session-a' };
    registry.broadcastToSession('session-a', message);

    expect(sendServerMessageFromHub).not.toHaveBeenCalled();
  });

  it('broadcastToAll delivers each message once per connection', () => {
    const registry = new SessionConnectionRegistry();
    const { connection: connection1, sendServerMessageFromHub: send1 } = createTestConnection();
    const { connection: connection2, sendServerMessageFromHub: send2 } = createTestConnection();

    registry.subscribe('session-a', connection1);
    registry.subscribe('session-b', connection1);
    registry.subscribe('session-b', connection2);

    const message: ServerMessage = { type: 'session_deleted', sessionId: 'session-a' };
    registry.broadcastToAll(message);

    expect(send1).toHaveBeenCalledTimes(1);
    expect(send2).toHaveBeenCalledTimes(1);
    expect(send1).toHaveBeenCalledWith(message);
    expect(send2).toHaveBeenCalledWith(message);
  });

  it('broadcastToAll reaches registered connections without subscriptions', () => {
    const registry = new SessionConnectionRegistry();
    const { connection, sendServerMessageFromHub } = createTestConnection();

    registry.registerConnection(connection);

    const message: ServerMessage = { type: 'session_deleted', sessionId: 'session-a' };
    registry.broadcastToAll(message);

    expect(sendServerMessageFromHub).toHaveBeenCalledTimes(1);
    expect(sendServerMessageFromHub).toHaveBeenCalledWith(message);
  });
});
