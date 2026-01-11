import { WebSocket } from 'ws';

import type { ServerMessage } from '@assistant/shared';

export interface WsTransport {
  sendJson(message: ServerMessage): void;
  sendBinary(bytes: Uint8Array): void;
  close(code: number, reason: string): void;
  isOpen(): boolean;
  isOpenOrConnecting(): boolean;
}

export function createWsTransport(socket: WebSocket): WsTransport {
  return {
    sendJson(message) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // best-effort
      }
    },
    sendBinary(bytes) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        socket.send(Buffer.from(bytes));
      } catch {
        // best-effort
      }
    },
    close(code, reason) {
      if (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING) {
        return;
      }
      try {
        socket.close(code, reason);
      } catch {
        // best-effort
      }
    },
    isOpen() {
      return socket.readyState === WebSocket.OPEN;
    },
    isOpenOrConnecting() {
      return socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING;
    },
  };
}
