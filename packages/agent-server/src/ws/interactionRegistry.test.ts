import { describe, expect, it, vi } from 'vitest';

import { InteractionRegistry, InteractionRegistryError } from './interactionRegistry';

describe('InteractionRegistry', () => {
  it('resolves a pending interaction response', async () => {
    const registry = new InteractionRegistry();
    const waitPromise = registry.waitForResponse({
      sessionId: 's1',
      callId: 'c1',
      interactionId: 'i1',
      timeoutMs: 1000,
    });

    const handled = registry.resolveResponse({
      sessionId: 's1',
      callId: 'c1',
      interactionId: 'i1',
      response: { action: 'approve', approvalScope: 'once' },
    });

    expect(handled).toBe(true);
    await expect(waitPromise).resolves.toEqual({ action: 'approve', approvalScope: 'once' });
  });

  it('rejects with timeout when no response arrives', async () => {
    vi.useFakeTimers();
    const registry = new InteractionRegistry();
    const waitPromise = registry.waitForResponse({
      sessionId: 's1',
      callId: 'c1',
      interactionId: 'i2',
      timeoutMs: 50,
    });

    vi.advanceTimersByTime(60);
    await expect(waitPromise).rejects.toBeInstanceOf(InteractionRegistryError);
    vi.useRealTimers();
  });

  it('rejects when aborted', async () => {
    const registry = new InteractionRegistry();
    const controller = new AbortController();
    const waitPromise = registry.waitForResponse({
      sessionId: 's1',
      callId: 'c1',
      interactionId: 'i3',
      timeoutMs: 1000,
      signal: controller.signal,
    });

    controller.abort();
    await expect(waitPromise).rejects.toBeInstanceOf(InteractionRegistryError);
  });
});
