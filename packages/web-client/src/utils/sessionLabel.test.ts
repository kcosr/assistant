import { describe, expect, it } from 'vitest';

import { formatSessionLabel, resolveSessionBaseLabel } from './sessionLabel';

describe('resolveSessionBaseLabel', () => {
  it('prefers explicit session names', () => {
    expect(
      resolveSessionBaseLabel({
        sessionId: 'session-1',
        name: 'Daily Assistant',
        attributes: {
          core: { autoTitle: 'Ignored auto title' },
        },
      }),
    ).toBe('Daily Assistant');
  });

  it('falls back to auto title and then agent display name', () => {
    expect(
      resolveSessionBaseLabel({
        sessionId: 'session-1',
        attributes: {
          core: { autoTitle: 'Sprint Review' },
        },
      }),
    ).toBe('Sprint Review');

    expect(
      resolveSessionBaseLabel(
        {
          sessionId: 'session-2',
          agentId: 'agent-1',
        },
        [{ agentId: 'agent-1', displayName: 'Assistant' }],
      ),
    ).toBe('Assistant');
  });

  it('returns an empty string when there is no human-readable label', () => {
    expect(resolveSessionBaseLabel({ sessionId: 'session-3' })).toBe('');
  });
});

describe('formatSessionLabel', () => {
  it('can omit the id suffix while keeping the base label', () => {
    expect(
      formatSessionLabel(
        {
          sessionId: 'session-12345678',
          name: 'Daily Assistant',
        },
        { includeId: false },
      ),
    ).toBe('Daily Assistant');
  });
});
