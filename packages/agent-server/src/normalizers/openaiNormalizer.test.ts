import { describe, expect, it } from 'vitest';

import type { NormalizerContext } from './types';
import { OpenAINormalizer } from './openaiNormalizer';

function createTestContext(): NormalizerContext {
  let nextId = 1;
  let currentTimestamp = 1_700_000_000_000;

  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    responseId: 'response-1',
    generateEventId: () => {
      const id = `event-${nextId}`;
      nextId += 1;
      return id;
    },
    timestamp: () => {
      const value = currentTimestamp;
      currentTimestamp += 1;
      return value;
    },
  };
}

describe('OpenAINormalizer', () => {
  it('emits assistant_chunk and assistant_done events for content deltas and stop', () => {
    const normalizer = new OpenAINormalizer();
    const context = createTestContext();

    const firstChunk: unknown = {
      choices: [
        {
          delta: {
            content: 'Hel',
          },
        },
      ],
    };

    const secondChunk: unknown = {
      choices: [
        {
          delta: {
            content: 'lo',
          },
        },
      ],
    };

    const finalChunk: unknown = {
      choices: [
        {
          delta: {
            content: '!',
          },
          finish_reason: 'stop',
        },
      ],
    };

    const events: unknown[] = [];
    events.push(...normalizer.normalize(firstChunk, context));
    events.push(...normalizer.normalize(secondChunk, context));
    events.push(...normalizer.normalize(finalChunk, context));

    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      'assistant_chunk',
      'assistant_chunk',
      'assistant_chunk',
      'assistant_done',
    ]);

    expect((events[0] as { payload: { text: string } }).payload.text).toBe('Hel');
    expect((events[1] as { payload: { text: string } }).payload.text).toBe('lo');
    expect((events[2] as { payload: { text: string } }).payload.text).toBe('!');
    expect((events[3] as { payload: { text: string } }).payload.text).toBe('Hello!');

    for (const event of events) {
      const typedEvent = event as {
        sessionId?: unknown;
        turnId?: unknown;
        responseId?: unknown;
      };
      expect(typedEvent.sessionId).toBe('session-1');
      expect(typedEvent.turnId).toBe('turn-1');
      expect(typedEvent.responseId).toBe('response-1');
    }
  });

  it('accumulates tool_calls across chunks and emits tool_call events when finished', () => {
    const normalizer = new OpenAINormalizer();
    const context = createTestContext();

    const firstChunk: unknown = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                function: {
                  name: 'get_weather',
                  arguments: '{ "city": "San',
                },
              },
            ],
          },
        },
      ],
    };

    const secondChunk: unknown = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: ' Francisco" }',
                },
              },
            ],
          },
        },
      ],
    };

    const finalChunk: unknown = {
      choices: [
        {
          delta: {},
          finish_reason: 'tool_calls',
        },
      ],
    };

    const firstEvents = normalizer.normalize(firstChunk, context);
    const secondEvents = normalizer.normalize(secondChunk, context);
    const finalEvents = normalizer.normalize(finalChunk, context);

    expect(firstEvents).toHaveLength(0);
    expect(secondEvents).toHaveLength(0);
    expect(finalEvents).toHaveLength(1);

    const toolCallEvent = finalEvents[0];
    if (!toolCallEvent) {
      throw new Error('Expected a tool_call event in finalEvents');
    }
    expect(toolCallEvent.type).toBe('tool_call');

    expect(toolCallEvent.payload).toEqual({
      toolCallId: 'call_1',
      toolName: 'get_weather',
      args: {
        city: 'San Francisco',
      },
    });

    expect(toolCallEvent.sessionId).toBe('session-1');
    expect(toolCallEvent.turnId).toBe('turn-1');
    expect(toolCallEvent.responseId).toBe('response-1');
  });
});
