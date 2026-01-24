import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from './connectionManager';

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
  it('sends interaction mode updates when connected', () => {
    ensureWebSocketGlobal();
    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;

    const manager = new ConnectionManager({
      createWebSocketUrl: () => 'ws://localhost',
      setStatus: () => undefined,
      protocolVersion: 2,
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

  it('does not reconnect when socket is already open', () => {
    ensureWebSocketGlobal();
    const socket = { readyState: WebSocket.OPEN } as unknown as WebSocket;

    const manager = new ConnectionManager({
      createWebSocketUrl: () => 'ws://localhost',
      setStatus: () => undefined,
      protocolVersion: 2,
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
      protocolVersion: 2,
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
