import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '@mariozechner/pi-ai';

import {
  buildSessionContextUsage,
  calculateContextTokens,
  extractSessionContextUsageFromAssistantMessage,
  isSessionContextUsageEqual,
} from './contextUsage';

describe('contextUsage', () => {
  it('prefers totalTokens when available', () => {
    expect(
      calculateContextTokens({
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 40,
        totalTokens: 55,
      }),
    ).toBe(55);
  });

  it('falls back to summed token fields when totalTokens is zero', () => {
    expect(
      calculateContextTokens({
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 40,
        totalTokens: 0,
      }),
    ).toBe(100);
  });

  it('builds availablePercent from usage and contextWindow', () => {
    expect(
      buildSessionContextUsage({
        contextWindow: 200,
        usage: {
          input: 20,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 30,
        },
      }),
    ).toEqual({
      availablePercent: 85,
      contextWindow: 200,
      usage: {
        input: 20,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 30,
      },
    });
  });

  it('ignores aborted assistant messages', () => {
    const message = {
      role: 'assistant',
      content: [],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 10,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'aborted',
      timestamp: Date.now(),
    } satisfies AssistantMessage;

    expect(
      extractSessionContextUsageFromAssistantMessage({
        contextWindow: 100,
        message,
      }),
    ).toBeNull();
  });

  it('ignores error assistant messages', () => {
    const message = {
      role: 'assistant',
      content: [],
      api: 'anthropic-messages',
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 10,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'error',
      timestamp: Date.now(),
    } satisfies AssistantMessage;

    expect(
      extractSessionContextUsageFromAssistantMessage({
        contextWindow: 100,
        message,
      }),
    ).toBeNull();
  });

  it('compares context usage payloads structurally', () => {
    const usage = {
      availablePercent: 73,
      contextWindow: 200000,
      usage: {
        input: 12000,
        output: 1800,
        cacheRead: 35000,
        cacheWrite: 5200,
        totalTokens: 54000,
      },
    };

    expect(isSessionContextUsageEqual(usage, { ...usage, usage: { ...usage.usage } })).toBe(true);
    expect(
      isSessionContextUsageEqual(usage, {
        ...usage,
        usage: { ...usage.usage, totalTokens: 54001 },
      }),
    ).toBe(false);
  });
});
