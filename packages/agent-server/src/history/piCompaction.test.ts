import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PI_COMPACTION_SETTINGS,
  estimatePiMessageTokens,
  preparePiCompaction,
  shouldCompactPiContext,
} from './piCompaction';

describe('piCompaction', () => {
  it('uses the Pi threshold rule', () => {
    expect(
      shouldCompactPiContext({
        contextTokens: 112,
        contextWindow: 128,
        settings: { ...DEFAULT_PI_COMPACTION_SETTINGS, reserveTokens: 16 },
      }),
    ).toBe(false);
    expect(
      shouldCompactPiContext({
        contextTokens: 113,
        contextWindow: 128,
        settings: { ...DEFAULT_PI_COMPACTION_SETTINGS, reserveTokens: 16 },
      }),
    ).toBe(true);
  });

  it('selects a kept entry and previous summary for later compactions', () => {
    const entries = [
      {
        type: 'message' as const,
        id: 'old',
        parentId: null,
        timestamp: '2026-05-10T00:00:00.000Z',
        message: {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'old request '.repeat(100) }],
          timestamp: 1,
        },
      },
      {
        type: 'compaction' as const,
        id: 'compact-1',
        parentId: 'old',
        timestamp: '2026-05-10T00:00:01.000Z',
        summary: 'Previous summary.',
        firstKeptEntryId: 'old',
        tokensBefore: 400,
        details: { readFiles: ['a.ts'], modifiedFiles: [] },
      },
      {
        type: 'message' as const,
        id: 'summarized',
        parentId: 'compact-1',
        timestamp: '2026-05-10T00:00:02.000Z',
        message: {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'middle request '.repeat(100) }],
          timestamp: 2,
        },
      },
      {
        type: 'message' as const,
        id: 'kept',
        parentId: 'summarized',
        timestamp: '2026-05-10T00:00:03.000Z',
        message: {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: 'recent' }],
          timestamp: 3,
        },
      },
    ];

    const preparation = preparePiCompaction(entries, {
      enabled: true,
      reserveTokens: 16,
      keepRecentTokens: 2,
    });

    expect(preparation).toMatchObject({
      firstKeptEntryId: 'kept',
      previousSummary: 'Previous summary.',
    });
    expect(preparation?.messagesToSummarize).toHaveLength(1);
    expect(estimatePiMessageTokens(entries[0]!.message!)).toBeGreaterThan(0);
  });
});
