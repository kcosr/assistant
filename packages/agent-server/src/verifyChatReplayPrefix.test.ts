import { describe, expect, it } from 'vitest';

// @ts-expect-error Development script does not publish TS declarations.
import { parseRequestRecords, verifyReplayPrefixes } from '../../../scripts/verify-chat-replay-prefix.mjs';

describe('parseRequestRecords', () => {
  it('filters to request records and session id when provided', () => {
    const jsonl = [
      JSON.stringify({ direction: 'request', sessionId: 'a', payload: { input: [{ role: 'user' }] } }),
      JSON.stringify({ direction: 'response', sessionId: 'a', payload: {} }),
      JSON.stringify({ direction: 'request', sessionId: 'b', payload: { input: [{ role: 'user' }] } }),
    ].join('\n');

    const records = parseRequestRecords(jsonl, 'a');

    expect(records).toHaveLength(1);
    expect(records[0].sessionId).toBe('a');
  });
});

describe('verifyReplayPrefixes', () => {
  it('passes when each request input preserves the previous request as an exact prefix', () => {
    const records = [
      {
        timestamp: 't1',
        responseId: 'r1',
        payload: {
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
        },
      },
      {
        timestamp: 't2',
        responseId: 'r2',
        payload: {
          input: [
            { role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] },
            { role: 'user', content: [{ type: 'input_text', text: 'Run date' }] },
          ],
        },
      },
    ];

    expect(verifyReplayPrefixes(records)).toEqual({
      requestCount: 2,
      mismatches: [],
      ok: true,
    });
  });

  it('reports the first mismatched prefix item with serialized values', () => {
    const records = [
      {
        timestamp: 't1',
        responseId: 'r1',
        payload: {
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Run date' }] }],
        },
      },
      {
        timestamp: 't2',
        responseId: 'r2',
        payload: {
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Run pwd' }] }],
        },
      },
    ];

    expect(verifyReplayPrefixes(records)).toEqual({
      requestCount: 2,
      ok: false,
      mismatches: [
        {
          type: 'prefix_mismatch',
          previousIndex: 0,
          currentIndex: 1,
          itemIndex: 0,
          previousResponseId: 'r1',
          currentResponseId: 'r2',
          previousTimestamp: 't1',
          currentTimestamp: 't2',
          previousItem: { role: 'user', content: [{ type: 'input_text', text: 'Run date' }] },
          currentItem: { role: 'user', content: [{ type: 'input_text', text: 'Run pwd' }] },
          previousSerialized: JSON.stringify({ role: 'user', content: [{ type: 'input_text', text: 'Run date' }] }),
          currentSerialized: JSON.stringify({ role: 'user', content: [{ type: 'input_text', text: 'Run pwd' }] }),
        },
      ],
    });
  });

  it('reports when the next request input is shorter than the previous one', () => {
    const records = [
      {
        timestamp: 't1',
        responseId: 'r1',
        payload: {
          input: [
            { role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
            { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello' }] },
          ],
        },
      },
      {
        timestamp: 't2',
        responseId: 'r2',
        payload: {
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Run date' }] }],
        },
      },
    ];

    expect(verifyReplayPrefixes(records)).toEqual({
      requestCount: 2,
      ok: false,
      mismatches: [
        {
          type: 'shorter_input',
          previousIndex: 0,
          currentIndex: 1,
          previousResponseId: 'r1',
          currentResponseId: 'r2',
          previousTimestamp: 't1',
          currentTimestamp: 't2',
          previousLength: 2,
          currentLength: 1,
        },
      ],
    });
  });
});
