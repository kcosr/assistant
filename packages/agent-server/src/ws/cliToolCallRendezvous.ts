export interface CliToolCallRecord {
  sessionId: string;
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
  createdAt: number;
}

export interface CliToolCallMatchOptions {
  sessionId: string;
  score?: (call: CliToolCallRecord) => number;
  fallback?: (call: CliToolCallRecord) => boolean;
  waitMs?: number;
}

interface CliToolCallWaiter {
  options: CliToolCallMatchOptions;
  resolve: (call: CliToolCallRecord | undefined) => void;
  timeoutId: NodeJS.Timeout;
}

export class CliToolCallRendezvous {
  private readonly ttlMs: number;
  private readonly pending = new Map<string, CliToolCallRecord[]>();
  private readonly waiters = new Map<string, Set<CliToolCallWaiter>>();

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 30_000;
  }

  record(options: {
    sessionId: string;
    callId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): void {
    const call: CliToolCallRecord = {
      sessionId: options.sessionId,
      callId: options.callId,
      toolName: options.toolName,
      args: options.args ?? {},
      createdAt: Date.now(),
    };

    const waiters = this.waiters.get(options.sessionId);
    if (waiters && waiters.size > 0) {
      for (const waiter of waiters) {
        const score = waiter.options.score ? waiter.options.score(call) : 0;
        if (score > 0) {
          clearTimeout(waiter.timeoutId);
          waiters.delete(waiter);
          waiter.resolve(call);
          return;
        }
      }
    }

    const calls = this.prune(options.sessionId);
    calls.push(call);
    this.pending.set(options.sessionId, calls);
  }

  async match(options: CliToolCallMatchOptions): Promise<CliToolCallRecord | undefined> {
    const immediate = this.selectBest(options);
    if (immediate) {
      return immediate;
    }

    const waitMs = options.waitMs ?? 0;
    if (waitMs <= 0) {
      return undefined;
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const waiters = this.waiters.get(options.sessionId);
        if (waiters) {
          for (const waiter of waiters) {
            if (waiter.resolve === resolve) {
              waiters.delete(waiter);
              break;
            }
          }
          if (waiters.size === 0) {
            this.waiters.delete(options.sessionId);
          }
        }
        resolve(this.selectBest(options));
      }, waitMs);

      const waiter: CliToolCallWaiter = { options, resolve, timeoutId };
      const set = this.waiters.get(options.sessionId) ?? new Set<CliToolCallWaiter>();
      set.add(waiter);
      this.waiters.set(options.sessionId, set);
    });
  }

  clearSession(sessionId: string): void {
    this.pending.delete(sessionId);
    const waiters = this.waiters.get(sessionId);
    if (waiters) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeoutId);
        waiter.resolve(undefined);
      }
    }
    this.waiters.delete(sessionId);
  }

  private selectBest(options: CliToolCallMatchOptions): CliToolCallRecord | undefined {
    const calls = this.prune(options.sessionId);
    if (calls.length === 0) {
      return undefined;
    }

    if (options.score) {
      let bestIndex = -1;
      let bestScore = 0;
      for (let i = 0; i < calls.length; i += 1) {
        const score = options.score(calls[i] as CliToolCallRecord);
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0) {
        const [matched] = calls.splice(bestIndex, 1);
        this.updatePending(options.sessionId, calls);
        return matched;
      }
    }

    if (options.fallback) {
      for (let i = calls.length - 1; i >= 0; i -= 1) {
        if (options.fallback(calls[i] as CliToolCallRecord)) {
          const [matched] = calls.splice(i, 1);
          this.updatePending(options.sessionId, calls);
          return matched;
        }
      }
    }

    return undefined;
  }

  private prune(sessionId: string): CliToolCallRecord[] {
    const calls = this.pending.get(sessionId) ?? [];
    if (calls.length === 0) {
      return [];
    }
    const now = Date.now();
    const filtered = calls.filter((call) => now - call.createdAt <= this.ttlMs);
    this.updatePending(sessionId, filtered);
    return filtered;
  }

  private updatePending(sessionId: string, calls: CliToolCallRecord[]): void {
    if (calls.length === 0) {
      this.pending.delete(sessionId);
    } else {
      this.pending.set(sessionId, calls);
    }
  }
}
