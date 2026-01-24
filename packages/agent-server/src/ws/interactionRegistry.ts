export type InteractionResponse = {
  action: 'approve' | 'deny' | 'submit' | 'cancel';
  approvalScope?: 'once' | 'session' | 'always';
  input?: Record<string, unknown>;
  reason?: string;
};

type PendingEntry = {
  resolve: (response: InteractionResponse) => void;
  reject: (error: InteractionRegistryError) => void;
  timeoutId?: NodeJS.Timeout;
  abortListener?: (() => void) | undefined;
  signal?: AbortSignal | undefined;
};

export class InteractionRegistryError extends Error {
  code: 'timeout' | 'cancelled';

  constructor(code: 'timeout' | 'cancelled', message: string) {
    super(message);
    this.code = code;
  }
}

export class InteractionRegistry {
  private readonly pending = new Map<string, PendingEntry>();

  private createKey(sessionId: string, callId: string, interactionId: string): string {
    return `${sessionId}:${callId}:${interactionId}`;
  }

  waitForResponse(options: {
    sessionId: string;
    callId: string;
    interactionId: string;
    timeoutMs: number;
    signal?: AbortSignal;
  }): Promise<InteractionResponse> {
    const { sessionId, callId, interactionId, timeoutMs, signal } = options;
    const key = this.createKey(sessionId, callId, interactionId);

    return new Promise<InteractionResponse>((resolve, reject) => {
      const entry: PendingEntry = {
        resolve,
        reject,
      };

      if (timeoutMs > 0) {
        entry.timeoutId = setTimeout(() => {
          this.pending.delete(key);
          if (entry.abortListener && entry.signal) {
            entry.signal.removeEventListener('abort', entry.abortListener);
            entry.abortListener = undefined;
            entry.signal = undefined;
          }
          reject(new InteractionRegistryError('timeout', 'Interaction timed out'));
        }, timeoutMs);
      }

      if (signal) {
        entry.signal = signal;
        entry.abortListener = () => {
          this.pending.delete(key);
          reject(new InteractionRegistryError('cancelled', 'Interaction cancelled'));
        };
        if (signal.aborted) {
          entry.abortListener();
          return;
        }
        signal.addEventListener('abort', entry.abortListener, { once: true });
      }

      this.pending.set(key, entry);
    });
  }

  resolveResponse(options: {
    sessionId: string;
    callId: string;
    interactionId: string;
    response: InteractionResponse;
  }): boolean {
    const { sessionId, callId, interactionId, response } = options;
    const key = this.createKey(sessionId, callId, interactionId);
    const entry = this.pending.get(key);
    if (!entry) {
      return false;
    }
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
    }
    if (entry.abortListener && entry.signal) {
      entry.signal.removeEventListener('abort', entry.abortListener);
      entry.abortListener = undefined;
      entry.signal = undefined;
    }
    this.pending.delete(key);
    entry.resolve(response);
    return true;
  }

  clearSession(sessionId: string): void {
    const prefix = `${sessionId}:`;
    for (const [key, entry] of this.pending.entries()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      if (entry.timeoutId) {
        clearTimeout(entry.timeoutId);
      }
      if (entry.abortListener && entry.signal) {
        entry.signal.removeEventListener('abort', entry.abortListener);
        entry.abortListener = undefined;
        entry.signal = undefined;
      }
      this.pending.delete(key);
      entry.reject(new InteractionRegistryError('cancelled', 'Session closed'));
    }
  }
}
