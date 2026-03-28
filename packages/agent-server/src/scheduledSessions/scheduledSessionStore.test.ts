import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ScheduledSessionStore } from './scheduledSessionStore';

function createStoreDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'scheduled-session-store-'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('ScheduledSessionStore', () => {
  it('returns an empty list when the store file does not exist', async () => {
    const store = new ScheduledSessionStore(createStoreDir());
    await expect(store.load()).resolves.toEqual([]);
  });

  it('persists and reloads schedule records', async () => {
    const storeDir = createStoreDir();
    const store = new ScheduledSessionStore(storeDir);

    await store.save([
      {
        agentId: 'assistant',
        scheduleId: 'schedule-a',
        cron: '*/5 * * * *',
        prompt: 'Run date',
        enabled: true,
        reuseSession: true,
        maxConcurrent: 1,
      },
    ]);

    await expect(store.load()).resolves.toEqual([
      {
        agentId: 'assistant',
        scheduleId: 'schedule-a',
        cron: '*/5 * * * *',
        prompt: 'Run date',
        enabled: true,
        reuseSession: true,
        maxConcurrent: 1,
      },
    ]);

    const raw = JSON.parse(
      await fs.readFile(path.join(storeDir, 'schedules.json'), 'utf8'),
    ) as { version: number; schedules: Array<{ agentId: string }> };
    expect(raw.version).toBe(1);
    expect(raw.schedules[0]?.agentId).toBe('assistant');
  });

  it('throws on invalid JSON content', async () => {
    const storeDir = createStoreDir();
    writeFileSync(path.join(storeDir, 'schedules.json'), '{bad json\n', 'utf8');
    const store = new ScheduledSessionStore(storeDir);

    await expect(store.load()).rejects.toThrow(/Failed to parse scheduled sessions store/i);
  });
});
