import { describe, expect, it } from 'vitest';

import { formatContextUsagePercent, getContextUsageTone } from './contextUsage';

describe('formatContextUsagePercent', () => {
  it('returns null when context usage is missing', () => {
    expect(formatContextUsagePercent(undefined)).toBeNull();
    expect(formatContextUsagePercent(null)).toBeNull();
  });

  it('formats whole-number percentages', () => {
    expect(
      formatContextUsagePercent({
        availablePercent: 73,
        contextWindow: 200000,
        usage: {
          input: 12000,
          output: 1800,
          cacheRead: 35000,
          cacheWrite: 5200,
          totalTokens: 54000,
        },
      }),
    ).toBe('73%');
  });

  it('returns null for NaN values', () => {
    expect(
      formatContextUsagePercent({
        availablePercent: Number.NaN,
        contextWindow: 200000,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
        },
      }),
    ).toBeNull();
  });
});

describe('getContextUsageTone', () => {
  it('returns null when context usage is missing or invalid', () => {
    expect(getContextUsageTone(undefined)).toBeNull();
    expect(getContextUsageTone(null)).toBeNull();
    expect(
      getContextUsageTone({
        availablePercent: Number.NaN,
        contextWindow: 200000,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
        },
      }),
    ).toBeNull();
  });

  it('maps inverted Pi thresholds to warning and error states', () => {
    expect(
      getContextUsageTone({
        availablePercent: 75,
        contextWindow: 200000,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 1,
          cacheWrite: 1,
          totalTokens: 1,
        },
      }),
    ).toBe('normal');
    expect(
      getContextUsageTone({
        availablePercent: 25,
        contextWindow: 200000,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 1,
          cacheWrite: 1,
          totalTokens: 1,
        },
      }),
    ).toBe('warning');
    expect(
      getContextUsageTone({
        availablePercent: 5,
        contextWindow: 200000,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 1,
          cacheWrite: 1,
          totalTokens: 1,
        },
      }),
    ).toBe('error');
  });
});
