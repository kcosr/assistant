import { describe, expect, it, vi } from 'vitest';

import { CURRENT_PROTOCOL_VERSION } from '@assistant/shared/protocol';
import { ConnectionManager } from './connectionManager';

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event?: Event) => void>>();
  readyState = 0;
  binaryType = '';

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = WebSocket.OPEN;
  }

  addEventListener(type: string, listener: (event?: Event) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  dispatch(type: string): void {
    if (type === 'open') {
      this.readyState = WebSocket.OPEN;
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  static reset(): void {
    MockWebSocket.instances = [];
  }
}

function ensureWebSocketGlobal(): void {
  const globalWithWindow = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis;
  };
  if (typeof globalWithWindow.window === 'undefined') {
    globalWithWindow.window = globalThis as unknown as Window & typeof globalThis;
  }
  if (typeof globalThis.WebSocket === 'undefined') {
    (globalThis as unknown as { WebSocket: { OPEN: number; CONNECTING: number } }).WebSocket = {
      OPEN: 1,
      CONNECTING: 0,
    };
    return;
  }

  const socket = globalThis.WebSocket as unknown as { OPEN?: number; CONNECTING?: number };
  if (typeof socket.OPEN !== 'number') {
    socket.OPEN = 1;
  }
  if (typeof socket.CONNECTING !== 'number') {
    socket.CONNECTING = 0;
  }
}

describe('ConnectionManager', () => {
  it('sends protocol v5 hello with structured subscriptions on open', () => {
    ensureWebSocketGlobal();
    MockWebSocket.reset();

    const originalWebSocket = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      MockWebSocket as unknown as typeof WebSocket;

    let activeSocket: WebSocket | null = null;
    const manager = new ConnectionManager({
      createWebSocketUrl: () => 'ws://localhost',
      setStatus: () => undefined,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      supportsAudioOutput: () => false,
      onMessage: () => undefined,
      getInteractionEnabled: () => true,
      getSocket: () => activeSocket,
      setSocket: (socket) => {
        activeSocket = socket;
      },
      onConnectionLostCleanup: () => undefined,
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 2000,
    });

    try {
      manager.subscribe('session-a');
      manager.subscribe('session-b');
      manager.connect();

      const socket = MockWebSocket.instances[0];
      if (!socket) {
        throw new Error('Expected ConnectionManager to create a socket');
      }
      socket.dispatch('open');

      expect(socket.sent).toHaveLength(1);
      expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
        type: 'hello',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        interaction: { supported: true, enabled: true },
        subscriptions: [{ sessionId: 'session-a' }, { sessionId: 'session-b' }],
      });
    } finally {
      (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
    }
  });

  it('sends interaction mode updates when connected', () => {
    ensureWebSocketGlobal();
    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;

    const manager = new ConnectionManager({
      createWebSocketUrl: () => 'ws://localhost',
      setStatus: () => undefined,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      supportsAudioOutput: () => false,
      onMessage: () => undefined,
      getSocket: () => socket,
      setSocket: () => undefined,
      onConnectionLostCleanup: () => undefined,
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 2000,
    });

    manager.setInteractionEnabled(false);

    expect(send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'set_interaction_mode', enabled: false }),
    );
  });

  it('allows post-open subscription updates after the initial hello', () => {
    ensureWebSocketGlobal();
    MockWebSocket.reset();

    const originalWebSocket = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
      MockWebSocket as unknown as typeof WebSocket;

    let activeSocket: WebSocket | null = null;
    let manager: ConnectionManager;
    manager = new ConnectionManager({
      createWebSocketUrl: () => 'ws://localhost',
      setStatus: () => undefined,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      supportsAudioOutput: () => false,
      onMessage: () => undefined,
      getInteractionEnabled: () => true,
      onOpen: () => {
        manager.subscribe('session-after-open');
      },
      getSocket: () => activeSocket,
      setSocket: (socket) => {
        activeSocket = socket;
      },
      onConnectionLostCleanup: () => undefined,
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 2000,
    });

    try {
      manager.connect();

      const socket = MockWebSocket.instances[0];
      if (!socket) {
        throw new Error('Expected ConnectionManager to create a socket');
      }
      socket.dispatch('open');

      expect(socket.sent).toHaveLength(2);
      expect(JSON.parse(socket.sent[0] ?? '{}')).toMatchObject({
        type: 'hello',
        subscriptions: [],
      });
      expect(JSON.parse(socket.sent[1] ?? '{}')).toEqual({
        type: 'subscribe',
        sessionId: 'session-after-open',
      });
    } finally {
      (globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket = originalWebSocket;
    }
  });

  it('does not reconnect when socket is already open', () => {
    ensureWebSocketGlobal();
    const socket = { readyState: WebSocket.OPEN } as unknown as WebSocket;

    const manager = new ConnectionManager({
      createWebSocketUrl: () => 'ws://localhost',
      setStatus: () => undefined,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      supportsAudioOutput: () => false,
      onMessage: () => undefined,
      getSocket: () => socket,
      setSocket: () => undefined,
      onConnectionLostCleanup: () => undefined,
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 2000,
    });

    const connectSpy = vi.spyOn(manager, 'connect').mockImplementation(() => undefined);
    manager.ensureConnected('visibilitychange');

    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('clears pending reconnect timers and reconnects when disconnected', () => {
    ensureWebSocketGlobal();

    const manager = new ConnectionManager({
      createWebSocketUrl: () => 'ws://localhost',
      setStatus: () => undefined,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      supportsAudioOutput: () => false,
      onMessage: () => undefined,
      getSocket: () => null,
      setSocket: () => undefined,
      onConnectionLostCleanup: () => undefined,
      reconnectDelayMs: 1000,
      maxReconnectDelayMs: 2000,
    });

    const connectSpy = vi.spyOn(manager, 'connect').mockImplementation(() => undefined);
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    (manager as unknown as { reconnectTimeoutId: number | null }).reconnectTimeoutId = 123;

    manager.ensureConnected('visibilitychange');

    expect(clearSpy).toHaveBeenCalledWith(123);
    expect(connectSpy).toHaveBeenCalled();
  });
});
