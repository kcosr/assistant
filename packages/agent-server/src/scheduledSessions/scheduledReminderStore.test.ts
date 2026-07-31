import { mkdtempSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ScheduledReminderStore } from './scheduledReminderStore';
import { SCHEDULED_REMINDER_MAX_TEXT_LENGTH } from './types';

function createStoreDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'scheduled-reminders-'));
}

describe('ScheduledReminderStore', () => {
  it('returns an empty list when the store does not exist', async () => {
    const store = new ScheduledReminderStore(createStoreDir());

    await expect(store.load()).resolves.toEqual([]);
  });

  it('saves validated reminders in run order and loads them', async () => {
    const storeDir = createStoreDir();
    const store = new ScheduledReminderStore(storeDir);
    await store.save([
      {
        reminderId: 'reminder-later',
        text: 'Take out the trash',
        runAt: '2026-08-01T13:00:00.000Z',
        createdAt: '2026-07-31T12:00:00.000Z',
      },
      {
        reminderId: 'reminder-sooner',
        text: 'Start the laundry',
        runAt: '2026-08-01T12:30:00.000Z',
        createdAt: '2026-07-31T12:01:00.000Z',
      },
    ]);

    await expect(store.load()).resolves.toEqual([
      expect.objectContaining({ reminderId: 'reminder-sooner' }),
      expect.objectContaining({ reminderId: 'reminder-later' }),
    ]);
    const raw = JSON.parse(await fs.readFile(path.join(storeDir, 'reminders.json'), 'utf8')) as {
      version: number;
      reminders: Array<{ reminderId: string }>;
    };
    expect(raw.version).toBe(1);
    expect(raw.reminders.map((reminder) => reminder.reminderId)).toEqual([
      'reminder-sooner',
      'reminder-later',
    ]);
  });

  it('rejects malformed files and out-of-bounds text', async () => {
    const storeDir = createStoreDir();
    const store = new ScheduledReminderStore(storeDir);
    writeFileSync(path.join(storeDir, 'reminders.json'), '{bad json\n', 'utf8');

    await expect(store.load()).rejects.toThrow(/Failed to parse scheduled reminders store/i);
    await expect(
      store.save([
        {
          reminderId: 'reminder-long',
          text: 'x'.repeat(SCHEDULED_REMINDER_MAX_TEXT_LENGTH + 1),
          runAt: '2026-08-01T13:00:00.000Z',
          createdAt: '2026-07-31T12:00:00.000Z',
        },
      ]),
    ).rejects.toThrow(/at most 2000 characters/i);
  });
});
