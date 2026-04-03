import { describe, expect, it } from 'vitest';

import type { ProjectedTranscriptEvent } from '@assistant/shared';
import { dedupeProjectedTranscriptEvents } from './transcriptReplay';

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
