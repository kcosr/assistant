import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rateLimit';

describe('RateLimiter', () => {
  it('allows events up to the configured limit within the window', () => {
    const limiter = new RateLimiter({
      maxTokens: 2,
      windowMs: 1_000,
    });

    const t0 = 0;
    expect(limiter.check(1, t0).allowed).toBe(true);
    expect(limiter.check(1, t0).allowed).toBe(true);

    const result = limiter.check(1, t0);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  it('frees capacity after the window has passed', () => {
    const limiter = new RateLimiter({
      maxTokens: 2,
      windowMs: 1_000,
    });

    const t0 = 0;
    expect(limiter.check(1, t0).allowed).toBe(true);
    expect(limiter.check(1, t0).allowed).toBe(true);

    const tLater = 1_001;
    const result = limiter.check(1, tLater);
    expect(result.allowed).toBe(true);
  });

  it('supports cost-based limits (for example, bytes)', () => {
    const limiter = new RateLimiter({
      maxTokens: 10,
      windowMs: 60_000,
    });

    const t0 = 0;
    expect(limiter.check(4, t0).allowed).toBe(true);
    expect(limiter.check(6, t0).allowed).toBe(true);

    const result = limiter.check(1, t0);
    expect(result.allowed).toBe(false);
  });

  it('is effectively disabled when maxTokens is non-positive', () => {
    const limiter = new RateLimiter({
      maxTokens: 0,
      windowMs: 60_000,
    });

    for (let i = 0; i < 100; i += 1) {
      const result = limiter.check(1, i * 100);
      expect(result.allowed).toBe(true);
    }
  });
});
