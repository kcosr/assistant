import { describe, expect, it } from 'vitest';

import type { ProjectedTranscriptEvent } from '@assistant/shared';

import { projectedTranscriptEventToChatEvent } from './projectedTranscript';

describe('projectedTranscriptEventToChatEvent', () => {
  it('restores a replayable chat event from a projected transcript event', () => {
    const projected: ProjectedTranscriptEvent = {
      sessionId: 'session-1',
      revision: 1000,
      sequence: 1,
      requestId: 'request-1',
      eventId: 'event-2',
      kind: 'assistant_message',
      chatEventType: 'assistant_done',
      responseId: 'response-1',
      timestamp: '2026-03-31T00:00:01.000Z',
      payload: { text: 'Hello' },
    };

    expect(projectedTranscriptEventToChatEvent(projected)).toEqual({
      id: 'event-2',
      timestamp: Date.parse('2026-03-31T00:00:01.000Z'),
      sessionId: 'session-1',
      turnId: 'request-1',
      responseId: 'response-1',
      type: 'assistant_done',
      payload: { text: 'Hello' },
    });
  });
});
