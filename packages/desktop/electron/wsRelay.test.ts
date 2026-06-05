import { describe, expect, it, vi } from 'vitest';

import {
  flushPendingWsMessages,
  relayOrQueueWsMessage,
  type PendingWsMessage,
  type WsRelayTarget,
} from './wsRelay';

function createTarget(readyState: number): WsRelayTarget & {
  send: ReturnType<typeof vi.fn>;
} {
  return {
    readyState,
    send: vi.fn(),
  };
}

describe('wsRelay', () => {
  it('preserves the frame type when forwarding immediately', () => {
    const target = createTarget(1);
    const pendingMessages: PendingWsMessage[] = [];

    relayOrQueueWsMessage(target, 1, pendingMessages, Buffer.from('hello'), false);
    relayOrQueueWsMessage(target, 1, pendingMessages, Buffer.from([1, 2, 3]), true);

    expect(pendingMessages).toEqual([]);
    expect(target.send).toHaveBeenNthCalledWith(1, Buffer.from('hello'), { binary: false });
    expect(target.send).toHaveBeenNthCalledWith(2, Buffer.from([1, 2, 3]), { binary: true });
  });

  it('preserves the frame type when flushing queued messages', () => {
    const target = createTarget(0);
    const pendingMessages: PendingWsMessage[] = [];

    relayOrQueueWsMessage(target, 1, pendingMessages, Buffer.from('queued'), false);
    relayOrQueueWsMessage(target, 1, pendingMessages, Buffer.from([4, 5, 6]), true);

    target.readyState = 1;
    flushPendingWsMessages(target, pendingMessages);

    expect(pendingMessages).toEqual([]);
    expect(target.send).toHaveBeenNthCalledWith(1, Buffer.from('queued'), { binary: false });
    expect(target.send).toHaveBeenNthCalledWith(2, Buffer.from([4, 5, 6]), { binary: true });
  });
});
