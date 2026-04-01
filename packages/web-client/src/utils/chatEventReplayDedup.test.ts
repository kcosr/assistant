import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import {
  filterBufferedReplayEvents,
  getChatEventReplayDedupKey,
} from './chatEventReplayDedup';

describe('chatEventReplayDedup', () => {
  it('drops buffered duplicates even when replay rebuilt the events with new ids', () => {
    const replayedEvents: ChatEvent[] = [
      {
        id: 'replayed-user',
        timestamp: 1000,
        sessionId: 'session-1',
        turnId: 'turn-1',
        type: 'user_message',
        payload: { text: 'hello' },
      },
      {
        id: 'replayed-tool',
        timestamp: 1001,
        sessionId: 'session-1',
        turnId: 'turn-1',
        responseId: 'response-1',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-1',
          toolName: 'bash',
          args: { command: 'ls', timeout: 300 },
        },
      },
    ];

    const bufferedEvents: ChatEvent[] = [
      {
        id: 'buffered-user',
        timestamp: 2000,
        sessionId: 'session-1',
        turnId: 'turn-1',
        type: 'user_message',
        payload: { text: 'hello' },
      },
      {
        id: 'buffered-tool',
        timestamp: 2001,
        sessionId: 'session-1',
        turnId: 'turn-1',
        responseId: 'response-1',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-1',
          toolName: 'bash',
          args: { timeout: 300, command: 'ls' },
        },
      },
      {
        id: 'buffered-result',
        timestamp: 2002,
        sessionId: 'session-1',
        turnId: 'turn-1',
        responseId: 'response-1',
        type: 'tool_result',
        payload: {
          toolCallId: 'call-1',
          result: { ok: true, output: 'done' },
        },
      },
    ];

    expect(filterBufferedReplayEvents(bufferedEvents, replayedEvents)).toEqual([
      bufferedEvents[2],
    ]);
  });

  it('normalizes trailing assistant whitespace in replay dedupe keys', () => {
    const replayedEvent: ChatEvent = {
      id: 'replayed-assistant',
      timestamp: 1000,
      sessionId: 'session-1',
      turnId: 'turn-1',
      responseId: 'response-1',
      type: 'assistant_done',
      payload: { text: 'Done.' },
    };

    const bufferedEvent: ChatEvent = {
      id: 'buffered-assistant',
      timestamp: 1001,
      sessionId: 'session-1',
      turnId: 'turn-1',
      responseId: 'response-1',
      type: 'assistant_done',
      payload: { text: 'Done.\n\n' },
    };

    expect(getChatEventReplayDedupKey(bufferedEvent)).toBe(
      getChatEventReplayDedupKey(replayedEvent),
    );
  });
});
