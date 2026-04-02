import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

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
});
