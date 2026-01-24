import { describe, expect, it, vi } from 'vitest';

import { CliToolCallRendezvous } from './cliToolCallRendezvous';

describe('CliToolCallRendezvous', () => {
  it('matches a recorded call by score', async () => {
    const rendezvous = new CliToolCallRendezvous({ ttlMs: 10_000 });
    rendezvous.record({
      sessionId: 's1',
      callId: 'c1',
      toolName: 'bash',
      args: { command: 'assistant plugins run questions ask' },
      turnId: 't1',
      responseId: 'r1',
    });

    const match = await rendezvous.match({
      sessionId: 's1',
      score: (call) =>
        call.args['command'] === 'assistant plugins run questions ask' ? 2 : 0,
    });

    expect(match?.callId).toBe('c1');
    expect(match?.turnId).toBe('t1');
    expect(match?.responseId).toBe('r1');
  });

  it('waits for a matching call to arrive', async () => {
    const rendezvous = new CliToolCallRendezvous({ ttlMs: 10_000 });

    const matchPromise = rendezvous.match({
      sessionId: 's1',
      waitMs: 1000,
      score: (call) => (call.toolName === 'bash' ? 1 : 0),
    });

    rendezvous.record({
      sessionId: 's1',
      callId: 'c2',
      toolName: 'bash',
      args: { command: 'echo ok' },
    });

    const match = await matchPromise;
    expect(match?.callId).toBe('c2');
  });

  it('falls back on timeout when no scored match appears', async () => {
    vi.useFakeTimers();
    const rendezvous = new CliToolCallRendezvous({ ttlMs: 10_000 });

    const matchPromise = rendezvous.match({
      sessionId: 's1',
      waitMs: 1000,
      score: () => 0,
      fallback: (call) => call.toolName === 'bash',
    });

    rendezvous.record({
      sessionId: 's1',
      callId: 'c3',
      toolName: 'bash',
      args: { command: 'curl /api/plugins/questions/operations/ask' },
    });

    await vi.advanceTimersByTimeAsync(1000);

    const match = await matchPromise;
    expect(match?.callId).toBe('c3');
    vi.useRealTimers();
  });
});
