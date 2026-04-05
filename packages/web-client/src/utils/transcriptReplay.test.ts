import { describe, expect, it } from 'vitest';

import type { ProjectedTranscriptEvent } from '@assistant/shared';
import {
  computeUnfinishedRequestIds,
  dedupeProjectedTranscriptEvents,
  filterBufferedTranscriptEventsAfterReplay,
  finishTranscriptHydration,
} from './transcriptReplay';

function createEvent(
  sequence: number,
  overrides: Partial<ProjectedTranscriptEvent> = {},
): ProjectedTranscriptEvent {
  return {
    sessionId: 's1',
    revision: 1,
    sequence,
    requestId: 'r1',
    eventId: `e${sequence}`,
    kind: 'assistant_message',
    chatEventType: 'assistant_done',
    timestamp: new Date(1000 + sequence).toISOString(),
    payload: { text: `message ${sequence}` },
    ...overrides,
  };
}

describe('dedupeProjectedTranscriptEvents', () => {
  it('sorts by revision and sequence while removing exact duplicates', () => {
    const events = dedupeProjectedTranscriptEvents([
      createEvent(2),
      createEvent(1),
      createEvent(2),
      createEvent(0, { revision: 0, eventId: 'e-old' }),
    ]);

    expect(
      events.map((event) => ({
        revision: event.revision,
        sequence: event.sequence,
        eventId: event.eventId,
      })),
    ).toEqual([
      { revision: 0, sequence: 0, eventId: 'e-old' },
      { revision: 1, sequence: 1, eventId: 'e1' },
      { revision: 1, sequence: 2, eventId: 'e2' },
    ]);
  });
});

describe('finishTranscriptHydration', () => {
  it('marks hydration complete before flushing buffered events', () => {
    const state = { hydratingCount: 1 };
    const seenCounts: number[] = [];

    finishTranscriptHydration(state, () => {
      seenCounts.push(state.hydratingCount);
    });

    expect(state.hydratingCount).toBe(0);
    expect(seenCounts).toEqual([0]);
  });

  it('never decrements hydration below zero', () => {
    const state = { hydratingCount: 0 };

    finishTranscriptHydration(state, () => {});

    expect(state.hydratingCount).toBe(0);
  });
});

describe('computeUnfinishedRequestIds', () => {
  it('returns an empty list when every request has ended', () => {
    const events: ProjectedTranscriptEvent[] = [
      createEvent(0, { kind: 'request_start', requestId: 'r1', chatEventType: 'turn_start' }),
      createEvent(1, { kind: 'request_end', requestId: 'r1', chatEventType: 'turn_end' }),
    ];

    expect(computeUnfinishedRequestIds(events)).toEqual([]);
  });

  it('returns request IDs for requests that started but never finished', () => {
    const events: ProjectedTranscriptEvent[] = [
      createEvent(0, { kind: 'request_start', requestId: 'r1', chatEventType: 'turn_start' }),
      createEvent(1, { kind: 'request_end', requestId: 'r1', chatEventType: 'turn_end' }),
      createEvent(2, { kind: 'request_start', requestId: 'r2', chatEventType: 'turn_start' }),
    ];

    expect(computeUnfinishedRequestIds(events)).toEqual(['r2']);
  });

  it('treats interrupt and error events as request terminators', () => {
    const interruptEvents: ProjectedTranscriptEvent[] = [
      createEvent(0, { kind: 'request_start', requestId: 'r1', chatEventType: 'turn_start' }),
      createEvent(1, {
        kind: 'interrupt',
        requestId: 'r1',
        chatEventType: 'interrupt',
        payload: { reason: 'user' },
      }),
    ];
    expect(computeUnfinishedRequestIds(interruptEvents)).toEqual([]);

    const errorEvents: ProjectedTranscriptEvent[] = [
      createEvent(0, { kind: 'request_start', requestId: 'r2', chatEventType: 'turn_start' }),
      createEvent(1, {
        kind: 'error',
        requestId: 'r2',
        chatEventType: 'error',
        payload: { code: 'FAIL', message: 'nope' },
      }),
    ];
    expect(computeUnfinishedRequestIds(errorEvents)).toEqual([]);
  });

  it('clears all active requests when a terminator event omits its request ID', () => {
    const events: ProjectedTranscriptEvent[] = [
      createEvent(0, { kind: 'request_start', requestId: 'r1', chatEventType: 'turn_start' }),
      createEvent(1, { kind: 'request_start', requestId: 'r2', chatEventType: 'turn_start' }),
      createEvent(2, {
        kind: 'interrupt',
        requestId: '',
        chatEventType: 'interrupt',
        payload: { reason: 'shutdown' },
      }),
    ];

    expect(computeUnfinishedRequestIds(events)).toEqual([]);
  });

  it('ignores request_start events that have no request ID', () => {
    const events: ProjectedTranscriptEvent[] = [
      createEvent(0, { kind: 'request_start', requestId: '', chatEventType: 'turn_start' }),
      createEvent(1, { kind: 'request_start', requestId: 'r1', chatEventType: 'turn_start' }),
    ];

    expect(computeUnfinishedRequestIds(events)).toEqual(['r1']);
  });
});

describe('filterBufferedTranscriptEventsAfterReplay', () => {
  it('drops buffered events for requests already terminated by canonical replay', () => {
    const renderedEvents: ProjectedTranscriptEvent[] = [
      createEvent(0, {
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        requestId: 'r1',
        responseId: 'resp-1',
      }),
      createEvent(1, {
        kind: 'request_end',
        chatEventType: 'turn_end',
        requestId: 'r1',
      }),
    ];
    const bufferedEvents: ProjectedTranscriptEvent[] = [
      createEvent(5, {
        kind: 'assistant_message',
        chatEventType: 'assistant_chunk',
        requestId: 'r1',
        responseId: 'resp-1',
        payload: { text: 'stale' },
      }),
      createEvent(6, {
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        requestId: 'r1',
        responseId: 'resp-1',
        payload: { text: 'stale final' },
      }),
      createEvent(7, {
        kind: 'request_end',
        chatEventType: 'turn_end',
        requestId: 'r1',
      }),
      createEvent(8, {
        kind: 'assistant_message',
        chatEventType: 'assistant_chunk',
        requestId: 'r2',
        responseId: 'resp-2',
        payload: { text: 'fresh' },
      }),
    ];

    expect(
      filterBufferedTranscriptEventsAfterReplay(bufferedEvents, renderedEvents, 1).map(
        (event) => event.requestId,
      ),
    ).toEqual(['r2']);
  });

  it('drops stale assistant text for a finalized response even before request_end is rendered', () => {
    const renderedEvents: ProjectedTranscriptEvent[] = [
      createEvent(0, {
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        requestId: 'r1',
        responseId: 'resp-1',
      }),
    ];
    const bufferedEvents: ProjectedTranscriptEvent[] = [
      createEvent(5, {
        kind: 'assistant_message',
        chatEventType: 'assistant_chunk',
        requestId: 'r1',
        responseId: 'resp-1',
        payload: { text: 'stale' },
      }),
      createEvent(6, {
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        requestId: 'r1',
        responseId: 'resp-1',
      }),
      createEvent(7, {
        kind: 'request_end',
        chatEventType: 'turn_end',
        requestId: 'r1',
      }),
    ];

    expect(
      filterBufferedTranscriptEventsAfterReplay(bufferedEvents, renderedEvents, 0).map(
        (event) => event.chatEventType,
      ),
    ).toEqual(['turn_end']);
  });
});
