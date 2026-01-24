import { describe, expect, it, vi } from 'vitest';

import { ConnectionManager } from './connectionManager';

function ensureWebSocketGlobal(): void {
  if (typeof globalThis.WebSocket === 'undefined') {
    (globalThis as unknown as { WebSocket: { OPEN: number } }).WebSocket = { OPEN: 1 };
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
});
