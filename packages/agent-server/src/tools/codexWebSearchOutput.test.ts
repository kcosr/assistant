import { describe, expect, it } from 'vitest';

import { parseCodexWebSearchOutput } from './codexWebSearchOutput';

const SESSION_ID = '019abcde-1234-7890-8abc-123456789abc';
const OTHER_SESSION_ID = '019abcde-1234-7890-8abc-123456789abd';
const THREAD_STARTED = { type: 'thread.started', thread_id: SESSION_ID };
const TURN_STARTED = { type: 'turn.started' };
const TURN_COMPLETED = { type: 'turn.completed', usage: { input_tokens: 100 } };
const WEB_SEARCH = { type: 'item.completed', item: { type: 'web_search', query: 'current news' } };

function answer(text: unknown, phase?: string): Record<string, unknown> {
  return {
    type: 'item.completed',
    item: { type: 'agent_message', text, ...(phase ? { phase } : {}) },
  };
}

function jsonl(events: unknown[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n');
}

function successfulOutput(text = 'The result is [here](https://example.com/source).'): string {
  return jsonl([THREAD_STARTED, TURN_STARTED, WEB_SEARCH, answer(text), TURN_COMPLETED]);
}

function expectFailure(stdout: string, options = { requireSearch: true }): void {
  expect(() => parseCodexWebSearchOutput(stdout, options)).toThrow(
    expect.objectContaining({ code: 'execution_failed', message: expect.stringMatching(/^Codex/) }),
  );
}

describe('parseCodexWebSearchOutput', () => {
  it('returns the completed answer and session ID from native exec JSONL', () => {
    expect(parseCodexWebSearchOutput(successfulOutput(), { requireSearch: true })).toEqual({
      text: 'The result is [here](https://example.com/source).',
      sessionId: SESSION_ID,
    });
  });

  it('allows blank lines and unknown well-formed events', () => {
    const stdout = `\n${jsonl([THREAD_STARTED, { type: 'new.event', data: 1 }, WEB_SEARCH, answer('ok'), TURN_COMPLETED])}\n\n`;
    expect(parseCodexWebSearchOutput(stdout, { requireSearch: true }).text).toBe('ok');
  });

  it('allows a continuation without a new web search', () => {
    const stdout = jsonl([
      THREAD_STARTED,
      TURN_STARTED,
      answer('Follow-up answer.'),
      TURN_COMPLETED,
    ]);
    expect(
      parseCodexWebSearchOutput(stdout, { requireSearch: false, expectedSessionId: SESSION_ID }),
    ).toEqual({ text: 'Follow-up answer.', sessionId: SESSION_ID });
  });

  it('requires an actually completed search for a new search', () => {
    expectFailure(jsonl([THREAD_STARTED, answer('Unsourced answer.'), TURN_COMPLETED]));
    expectFailure(
      jsonl([
        THREAD_STARTED,
        { type: 'item.started', item: { type: 'web_search', query: 'news' } },
        answer('Unsourced answer.'),
        TURN_COMPLETED,
      ]),
    );
  });

  it('does not require source links in a valid no-results response', () => {
    expect(
      parseCodexWebSearchOutput(successfulOutput('No matching public results were found.'), {
        requireSearch: true,
      }).text,
    ).toBe('No matching public results were found.');
  });

  it('returns the last answer while ignoring explicit commentary', () => {
    const stdout = jsonl([
      THREAD_STARTED,
      WEB_SEARCH,
      answer('Earlier answer.'),
      answer('Final answer.', 'final_answer'),
      answer('I will keep investigating.', 'commentary'),
      TURN_COMPLETED,
    ]);
    expect(parseCodexWebSearchOutput(stdout, { requireSearch: true }).text).toBe('Final answer.');
  });

  it('does not substitute commentary when the final answer is missing', () => {
    expectFailure(
      jsonl([THREAD_STARTED, WEB_SEARCH, answer('Searching now.', 'commentary'), TURN_COMPLETED]),
    );
  });

  it('allows recoverable completed error items followed by a successful answer', () => {
    const stdout = jsonl([
      THREAD_STARTED,
      { type: 'item.completed', item: { type: 'error', message: 'Retrying a source.' } },
      WEB_SEARCH,
      answer('Recovered answer.'),
      TURN_COMPLETED,
    ]);
    expect(parseCodexWebSearchOutput(stdout, { requireSearch: true }).text).toBe(
      'Recovered answer.',
    );
  });

  it.each(['error', 'turn.failed'])('rejects terminal %s even with later completion', (type) => {
    expectFailure(jsonl([THREAD_STARTED, WEB_SEARCH, answer('partial'), { type }, TURN_COMPLETED]));
  });

  it('rejects missing, invalid, and changed session IDs', () => {
    expectFailure(jsonl([WEB_SEARCH, answer('ok'), TURN_COMPLETED]));
    expectFailure(
      jsonl([
        { type: 'thread.started', thread_id: 'not-a-uuid' },
        WEB_SEARCH,
        answer('ok'),
        TURN_COMPLETED,
      ]),
    );
    expectFailure(
      jsonl([
        THREAD_STARTED,
        { type: 'thread.started', thread_id: OTHER_SESSION_ID },
        WEB_SEARCH,
        answer('ok'),
        TURN_COMPLETED,
      ]),
    );
  });

  it('rejects a resumed session that differs from the requested session', () => {
    expect(() =>
      parseCodexWebSearchOutput(successfulOutput(), {
        expectedSessionId: OTHER_SESSION_ID,
        requireSearch: false,
      }),
    ).toThrow(expect.objectContaining({ code: 'execution_failed' }));
  });

  it('allows repeated announcements of the same session', () => {
    const stdout = jsonl([
      THREAD_STARTED,
      THREAD_STARTED,
      WEB_SEARCH,
      answer('ok'),
      TURN_COMPLETED,
    ]);
    expect(parseCodexWebSearchOutput(stdout, { requireSearch: true }).sessionId).toBe(SESSION_ID);
  });

  it.each(['', '   \n\n', 'not JSON', '{"type":', '[]', 'null', '1', '{}', '{"type":3}'])(
    'rejects blank, malformed, or invalid event output: %j',
    (stdout) => expectFailure(stdout),
  );

  it('does not accept a valid prefix followed by malformed trailing output', () => {
    expectFailure(`${successfulOutput()}\n{"type":`);
  });

  it('rejects incomplete turns and a new turn that never completes', () => {
    expectFailure(jsonl([THREAD_STARTED, WEB_SEARCH, answer('unfinished')]));
    expectFailure(`${successfulOutput()}\n${jsonl([TURN_STARTED, answer('unfinished')])}`);
    expectFailure(
      `${successfulOutput()}\n${jsonl([{ type: 'item.started', item: { type: 'web_search' } }])}`,
    );
  });

  it('does not reuse the answer or search from an earlier completed turn', () => {
    expectFailure(`${successfulOutput()}\n${jsonl([TURN_STARTED, TURN_COMPLETED])}`);
    expectFailure(`${successfulOutput()}\n${jsonl([TURN_STARTED, answer('new'), TURN_COMPLETED])}`);
  });

  it.each([undefined, null, 123, '   '])('rejects missing or unusable final text: %j', (text) => {
    expectFailure(jsonl([THREAD_STARTED, WEB_SEARCH, answer(text), TURN_COMPLETED]));
  });

  it('does not reuse earlier text when the last answer is empty', () => {
    expectFailure(
      jsonl([THREAD_STARTED, WEB_SEARCH, answer('Earlier answer.'), answer(''), TURN_COMPLETED]),
    );
  });

  it.each([undefined, [], {}, { type: 12 }])('rejects invalid completed items: %j', (item) => {
    expectFailure(
      jsonl([
        THREAD_STARTED,
        WEB_SEARCH,
        { type: 'item.completed', item },
        answer('ok'),
        TURN_COMPLETED,
      ]),
    );
  });

  it.each([
    'A citation \uE200cite\uE202turn0search0\uE201',
    'A citation \uE200cite\uE201',
    'Source turn12search3',
    '[source](turn2view0)',
    'See turn10fetch12.',
  ])('rejects unresolved Codex source references: %s', (text) => {
    expectFailure(successfulOutput(text));
  });
});
