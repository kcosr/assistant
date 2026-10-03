import { describe, expect, it, vi } from 'vitest';

import * as piSdkRuntime from '../llm/piSdkRuntime';
import type { Model, Api } from '@earendil-works/pi-ai';

import {
  compactPiMessages,
  DEFAULT_PI_COMPACTION_SETTINGS,
  estimatePiMessageTokens,
  estimatePiContextTokens,
  preparePiCompaction,
  shouldCompactPiContext,
} from './piCompaction';

describe('piCompaction', () => {
  it('compacts edited context with checkpoint token costs and a real retained entry', () => {
    const timestamp = '2026-10-03T00:00:00.000Z';
    const checkpoint = {
      role: 'system' as const,
      content: 'Instructions '.repeat(100),
      sections: { assistant_instructions: 'Preserve this' },
      timestamp: 1,
      toolsAdded: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
    };
    const entries = [
      {
        type: 'message' as const,
        id: 'old',
        parentId: null,
        timestamp,
        message: { role: 'user' as const, content: 'Old request', timestamp: 2 },
      },
      {
        type: 'compaction' as const,
        id: 'compaction',
        parentId: 'old',
        timestamp,
        summary: 'Previous summary',
        firstKeptEntryId: 'old',
        tokensBefore: 500,
        systemMessage: checkpoint,
      },
      {
        type: 'message' as const,
        id: 'kept',
        parentId: 'compaction',
        timestamp,
        message: { role: 'user' as const, content: 'Recent', timestamp: 3 },
      },
      {
        type: 'context_edit',
        id: 'edit',
        parentId: 'kept',
        timestamp,
        targetId: 'old',
        replacement: { content: 'Corrected request' },
      },
    ];
    const preparation = preparePiCompaction(entries, {
      enabled: true,
      reserveTokens: 16,
      keepRecentTokens: 1,
    })!;
    expect(preparation.firstKeptEntryId).toBe('kept');
    expect(preparation.messagesToSummarize).toEqual([
      { role: 'user', content: 'Corrected request', timestamp: 2 },
    ]);
    expect(preparation.systemMessages).toEqual([checkpoint]);
    expect(preparation.tokensBefore).toBe(
      estimatePiContextTokens([
        checkpoint,
        {
          role: 'compactionSummary',
          summary: 'Previous summary',
          tokensBefore: 500,
          timestamp: Date.parse(timestamp),
        },
        { role: 'user', content: 'Corrected request', timestamp: 2 },
        { role: 'user', content: 'Recent', timestamp: 3 },
      ]),
    );
    expect(
      preparePiCompaction(
        [{ type: 'message', id: 'only-system', parentId: null, timestamp, message: checkpoint }],
        DEFAULT_PI_COMPACTION_SETTINGS,
      ),
    ).toBeUndefined();
  });
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
    expect(preparation?.messagesToSummarize).toHaveLength(2);
    expect(estimatePiMessageTokens(entries[0]!.message!)).toBeGreaterThan(0);
  });
});

describe('compaction reasoning and limits', () => {
  it.each(['xhigh', 'medium', 'none'])(
    'uses selected %s reasoning and the registry output limit',
    async (thinkingLevel) => {
      const complete = vi.spyOn(piSdkRuntime, 'completePiSdkModel').mockResolvedValue({
        role: 'assistant',
        content: [{ type: 'text', text: 'Summary' }],
        stopReason: 'stop',
      } as never);
      const model = { reasoning: true, maxTokens: 512 } as Model<Api>;
      try {
        await compactPiMessages({
          model,
          thinkingLevel,
          preparation: {
            firstKeptEntryId: 'keep',
            messagesToSummarize: [],
            turnPrefixMessages: [],
            systemMessages: [],
            isSplitTurn: false,
            tokensBefore: 100,
            fileOps: { read: new Set(), written: new Set(), edited: new Set() },
            settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
          },
        });
        expect(complete).toHaveBeenCalledWith(model, expect.anything(), {
          maxTokens: 512,
          ...(thinkingLevel === 'none' ? {} : { reasoning: thinkingLevel }),
        });
      } finally {
        complete.mockRestore();
      }
    },
  );
});
