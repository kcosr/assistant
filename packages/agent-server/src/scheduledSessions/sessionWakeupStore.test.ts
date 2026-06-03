import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SessionWakeupStore } from './sessionWakeupStore';

function createStoreDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'session-wakeup-store-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('SessionWakeupStore', () => {
  it('returns an empty list when the store file does not exist', async () => {
    const store = new SessionWakeupStore(createStoreDir());
    await expect(store.load()).resolves.toEqual([]);
  });

  it('persists and reloads wake-up records', async () => {
    const storeDir = createStoreDir();
    const store = new SessionWakeupStore(storeDir);

    await store.save([
      {
        wakeupId: 'wakeup-a',
        sessionId: 'session-a',
        agentId: 'agent',
        message: 'Check the issue',
        runAt: '2026-06-03T12:00:00.000Z',
        createdAt: '2026-06-03T11:00:00.000Z',
        status: 'pending',
      },
    ]);

    await expect(store.load()).resolves.toEqual([
      {
        wakeupId: 'wakeup-a',
        sessionId: 'session-a',
        agentId: 'agent',
        message: 'Check the issue',
        runAt: '2026-06-03T12:00:00.000Z',
        createdAt: '2026-06-03T11:00:00.000Z',
        status: 'pending',
      },
    ]);

    const raw = JSON.parse(
      await fs.readFile(path.join(storeDir, 'wakeups.json'), 'utf8'),
    ) as { version: number; wakeups: Array<{ wakeupId: string }> };
    expect(raw.version).toBe(1);
    expect(raw.wakeups[0]?.wakeupId).toBe('wakeup-a');
  });

  it('throws on invalid JSON content', async () => {
    const storeDir = createStoreDir();
    writeFileSync(path.join(storeDir, 'wakeups.json'), '{bad json\n', 'utf8');
    const store = new SessionWakeupStore(storeDir);

    await expect(store.load()).rejects.toThrow(/Failed to parse session wakeups store/i);
  });

  it('rejects invalid timestamps', async () => {
    const storeDir = createStoreDir();
    writeFileSync(
      path.join(storeDir, 'wakeups.json'),
      `${JSON.stringify({
        version: 1,
        wakeups: [
          {
            wakeupId: 'wakeup-a',
            sessionId: 'session-a',
            agentId: 'agent',
            message: 'Check the issue',
            runAt: 'not-a-date',
            createdAt: '2026-06-03T11:00:00.000Z',
            status: 'pending',
          },
        ],
      })}\n`,
      'utf8',
    );
    const store = new SessionWakeupStore(storeDir);

    await expect(store.load()).rejects.toThrow(/runAt must be a valid ISO timestamp/i);
  });
});
