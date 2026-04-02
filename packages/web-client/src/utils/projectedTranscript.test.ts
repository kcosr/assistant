import { describe, expect, it } from 'vitest';

import type { ProjectedTranscriptEvent } from '@assistant/shared';

import { projectedTranscriptToChatEvents } from './projectedTranscript';

describe('projectedTranscriptToChatEvents', () => {
  it('restores replayable chat events from projected transcript events', () => {
    const projected: ProjectedTranscriptEvent[] = [
      {
        sessionId: 'session-1',
        revision: 1000,
        sequence: 0,
        requestId: 'request-1',
        eventId: 'event-1',
        kind: 'request_start',
        timestamp: '2026-03-31T00:00:00.000Z',
        payload: {
          sourceEvent: {
            id: 'event-1',
            timestamp: 1000,
            sessionId: 'session-1',
            turnId: 'request-1',
            type: 'turn_start',
            payload: { trigger: 'user' },
          },
        },
      },
      {
        sessionId: 'session-1',
        revision: 1000,
        sequence: 1,
        requestId: 'request-1',
        eventId: 'event-2',
        kind: 'assistant_message',
        timestamp: '2026-03-31T00:00:01.000Z',
        payload: {
          sourceEvent: {
            id: 'event-2',
            timestamp: 1001,
            sessionId: 'session-1',
            turnId: 'request-1',
            responseId: 'response-1',
            type: 'assistant_done',
            payload: { text: 'Hello' },
          },
        },
      },
      {
        sessionId: 'session-1',
        revision: 1000,
        sequence: 2,
        requestId: 'request-1',
        eventId: 'event-3',
        kind: 'tool_output',
        timestamp: '2026-03-31T00:00:02.000Z',
        toolCallId: 'call-1',
        payload: {
          sourceEvent: {
            id: 'event-3',
            timestamp: 1002,
            sessionId: 'session-1',
            turnId: 'request-1',
            type: 'tool_output_chunk',
            payload: { toolCallId: 'call-1', toolName: 'bash', chunk: 'ls', offset: 2 },
          },
        },
      },
    ];

    expect(projectedTranscriptToChatEvents(projected)).toEqual([
      {
        id: 'event-1',
        timestamp: 1000,
        sessionId: 'session-1',
        turnId: 'request-1',
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        id: 'event-2',
        timestamp: 1001,
        sessionId: 'session-1',
        turnId: 'request-1',
        responseId: 'response-1',
        type: 'assistant_done',
        payload: { text: 'Hello' },
      },
      {
        id: 'event-3',
        timestamp: 1002,
        sessionId: 'session-1',
        turnId: 'request-1',
        type: 'tool_output_chunk',
        payload: { toolCallId: 'call-1', toolName: 'bash', chunk: 'ls', offset: 2 },
      },
    ]);
  });
});
