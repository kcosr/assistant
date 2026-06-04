import type WebSocket from 'ws';

export interface PendingWsMessage {
  data: WebSocket.RawData;
  isBinary: boolean;
}

export interface WsRelayTarget {
  readyState: number;
  send(data: WebSocket.RawData, options: { binary: boolean }): void;
}

export function relayOrQueueWsMessage(
  target: WsRelayTarget,
  targetOpenState: number,
  pendingMessages: PendingWsMessage[],
  data: WebSocket.RawData,
  isBinary: boolean,
): void {
  if (target.readyState === targetOpenState) {
    target.send(data, { binary: isBinary });
    return;
  }

  pendingMessages.push({ data, isBinary });
}

export function flushPendingWsMessages(
  target: WsRelayTarget,
  pendingMessages: PendingWsMessage[],
): void {
  while (pendingMessages.length > 0) {
    const message = pendingMessages.shift();
    if (message !== undefined) {
      target.send(message.data, { binary: message.isBinary });
    }
  }
}
