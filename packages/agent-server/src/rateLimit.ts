export interface RateLimiterOptions {
  /**
   * Maximum total cost allowed within the sliding window.
   * For simple count-based limits, this is the max number of events.
   * For byte-based limits, this is the max number of bytes.
   */
  maxTokens: number;
  /**
   * Sliding window size in milliseconds (for example, 60_000 for 1 minute).
   */
  windowMs: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  /**
   * When the request is not allowed, this is a hint in milliseconds for when
   * the caller may retry without being rate limited again.
   */
  retryAfterMs?: number;
}

interface RateLimitEvent {
  timestamp: number;
  cost: number;
}

/**
 * Simple sliding-window rate limiter used for per-session limits.
 *
 * It tracks events with an associated "cost" (for example, 1 message or N bytes)
 * and enforces that the total cost within the configured window does not exceed
 * `maxTokens`.
 *
 * This implementation is intentionally lightweight and keeps state in memory,
 * which is sufficient for a single-process, home-hosted environment.
 */
export class RateLimiter {
  private readonly maxTokens: number;
  private readonly windowMs: number;
  private events: RateLimitEvent[] = [];
  private totalCost = 0;

  constructor(options: RateLimiterOptions) {
    this.maxTokens = options.maxTokens;
    this.windowMs = options.windowMs;
  }

  /**
   * Checks whether an event with the given cost is allowed at the provided
   * timestamp (defaults to `Date.now()`).
   *
   * Returns an object indicating whether the event is allowed and, when not
   * allowed, a `retryAfterMs` hint.
   */
  check(cost = 1, now = Date.now()): RateLimitCheckResult {
    if (!Number.isFinite(this.maxTokens) || this.maxTokens <= 0) {
      // A non-positive maxTokens disables the limiter.
      return { allowed: true };
    }

    if (!Number.isFinite(cost) || cost <= 0) {
      return { allowed: true };
    }

    this.prune(now);

    if (this.totalCost + cost <= this.maxTokens) {
      this.events.push({ timestamp: now, cost });
      this.totalCost += cost;
      return { allowed: true };
    }

    const oldest = this.events[0];
    const retryAfterMs =
      oldest !== undefined ? Math.max(0, oldest.timestamp + this.windowMs - now) : this.windowMs;

    return {
      allowed: false,
      retryAfterMs,
    };
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    let index = 0;

    while (index < this.events.length && this.events[index]!.timestamp <= cutoff) {
      this.totalCost -= this.events[index]!.cost;
      index += 1;
    }

    if (index > 0) {
      this.events = this.events.slice(index);
      if (this.events.length === 0) {
        this.totalCost = 0;
      }
    }
  }
}
