import { describe, expect, it } from 'vitest';

import type { ChatEvent, ProjectedTranscriptEvent } from '@assistant/shared';

import {
  formatReplayCursor,
  projectTranscriptEvents,
  sliceProjectedTranscript,
} from './transcriptProjection';

describe('transcriptProjection', () => {
  it('projects request groups and slices by replay cursor', () => {
    const events: ChatEvent[] = [
      {
        id: 'turn-start',
        timestamp: 1000,
        sessionId: 'session-1',
        turnId: 'request-1',
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        id: 'assistant-delta',
        timestamp: 1001,
        sessionId: 'session-1',
        turnId: 'request-1',
        responseId: 'response-1',
        type: 'assistant_chunk',
        payload: { text: 'Hi' },
      },
      {
        id: 'turn-end',
        timestamp: 1002,
        sessionId: 'session-1',
        turnId: 'request-1',
        type: 'turn_end',
        payload: {},
      },
    ];

    const projected = projectTranscriptEvents({
      sessionId: 'session-1',
      revision: 1,
      events,
    });

    expect(projected.map((event) => event.kind)).toEqual([
      'request_start',
      'assistant_message',
      'request_end',
    ]);
    expect(projected[1]).toMatchObject({
      requestId: 'request-1',
      sequence: 1,
      chatEventType: 'assistant_chunk',
      responseId: 'response-1',
      payload: {
        text: 'Hi',
      },
    });

    expect(
      sliceProjectedTranscript({
        revision: 1,
        events: projected,
        afterCursor: formatReplayCursor(1, 0),
      }),
    ).toMatchObject({
      reset: false,
      nextCursor: '1:2',
      events: [projected[1], projected[2]],
    });
  });

  it('forces a reset when the replay revision changed', () => {
    const projected = projectTranscriptEvents({
      sessionId: 'session-1',
      revision: 2,
      events: [],
    });

    const sliced = sliceProjectedTranscript({
      revision: 2,
      events: projected,
      afterCursor: formatReplayCursor(1, 4),
    });

    expect(sliced.reset).toBe(true);
    expect(sliced.nextCursor).toBeUndefined();
  });

  it('uses projected sequence values for replay cursors when sequences are sparse', () => {
    const events: ProjectedTranscriptEvent[] = [
      {
        sessionId: 'session-1',
        revision: 1,
        sequence: 0,
        eventId: 'evt-0',
        kind: 'request_start',
        requestId: 'request-1',
        timestamp: '2026-04-06T00:00:00.000Z',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        sessionId: 'session-1',
        revision: 1,
        sequence: 4,
        eventId: 'evt-4',
        kind: 'user_message',
        requestId: 'request-1',
        timestamp: '2026-04-06T00:00:01.000Z',
        chatEventType: 'user_message',
        payload: { text: 'hello' },
      },
      {
        sessionId: 'session-1',
        revision: 1,
        sequence: 9,
        eventId: 'evt-9',
        kind: 'assistant_message',
        requestId: 'request-1',
        responseId: 'response-1',
        timestamp: '2026-04-06T00:00:02.000Z',
        chatEventType: 'assistant_done',
        payload: { text: 'hi back' },
      },
    ];

    expect(
      sliceProjectedTranscript({
        revision: 1,
        events,
      }),
    ).toMatchObject({
      reset: true,
      nextCursor: '1:9',
      events,
    });

    expect(
      sliceProjectedTranscript({
        revision: 1,
        events,
        afterCursor: formatReplayCursor(1, 4),
      }),
    ).toMatchObject({
      reset: false,
      nextCursor: '1:9',
      events: [events[2]],
    });

    expect(
      sliceProjectedTranscript({
        revision: 1,
        events,
        afterCursor: formatReplayCursor(1, 9),
      }),
    ).toMatchObject({
      reset: false,
      nextCursor: '1:9',
      events: [],
    });
  });

  it('uses a live watermark when replayed events stop below the live sequence frontier', () => {
    const events: ProjectedTranscriptEvent[] = [
      {
        sessionId: 'session-1',
        revision: 1,
        sequence: 0,
        eventId: 'evt-0',
        kind: 'request_start',
        requestId: 'request-1',
        timestamp: '2026-04-06T00:00:00.000Z',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        sessionId: 'session-1',
        revision: 1,
        sequence: 23,
        eventId: 'evt-23',
        kind: 'assistant_message',
        requestId: 'request-1',
        responseId: 'response-1',
        timestamp: '2026-04-06T00:00:23.000Z',
        chatEventType: 'assistant_done',
        payload: { text: 'done' },
      },
    ];

    expect(
      sliceProjectedTranscript({
        revision: 1,
        events,
        cursorSequence: 55,
      }),
    ).toMatchObject({
      reset: true,
      nextCursor: '1:55',
      events,
    });

    expect(
      sliceProjectedTranscript({
        revision: 1,
        events,
        cursorSequence: 55,
        afterCursor: formatReplayCursor(1, 55),
      }),
    ).toMatchObject({
      reset: false,
      nextCursor: '1:55',
      events: [],
    });
  });

  it('prefers explicit exchangeId for agent message correlation', () => {
    const projected = projectTranscriptEvents({
      sessionId: 'session-1',
      revision: 3,
      events: [
        {
          id: 'agent-msg',
          timestamp: 1000,
          sessionId: 'session-1',
          turnId: 'request-1',
          type: 'agent_message',
          payload: {
            messageId: 'message-1',
            exchangeId: 'exchange-1',
            targetAgentId: 'agent-b',
            targetSessionId: 'session-b',
            message: 'hello',
            wait: false,
          },
        },
      ],
    });

    expect(projected[0]).toMatchObject({
      messageId: 'message-1',
      exchangeId: 'exchange-1',
    });
  });
});
