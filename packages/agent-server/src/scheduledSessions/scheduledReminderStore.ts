import fs from 'node:fs/promises';
import path from 'node:path';

import { SCHEDULED_REMINDER_MAX_TEXT_LENGTH, type PersistedScheduledReminderRecord } from './types';

interface PersistedRemindersFile {
  version: 1;
  reminders: PersistedScheduledReminderRecord[];
}

const CURRENT_VERSION = 1 as const;

export class ScheduledReminderStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'reminders.json');
  }

  getFilePath(): string {
    return this.filePath;
  }

  async load(): Promise<PersistedScheduledReminderRecord[]> {
    await this.writeQueue.catch(() => undefined);

    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(
        `Failed to parse scheduled reminders store at ${this.filePath}: ${(error as Error).message}`,
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Scheduled reminders store at ${this.filePath} must be a JSON object`);
    }

    const file = parsed as Partial<PersistedRemindersFile>;
    if (file.version !== CURRENT_VERSION) {
      throw new Error(
        `Scheduled reminders store at ${this.filePath} has unsupported version: ${String(file.version)}`,
      );
    }
    if (!Array.isArray(file.reminders)) {
      throw new Error(
        `Scheduled reminders store at ${this.filePath} must contain a reminders array`,
      );
    }
    return file.reminders.map((entry, index) => this.validateRecord(entry, index));
  }

  async save(records: PersistedScheduledReminderRecord[]): Promise<void> {
    const normalized = records
      .map((record) => this.validateRecord(record, -1))
      .sort((left, right) => left.runAt.localeCompare(right.runAt));
    const next = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.dataDir, { recursive: true });
        const payload: PersistedRemindersFile = {
          version: CURRENT_VERSION,
          reminders: normalized,
        };
        const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
        await fs.writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        await fs.rename(temporaryPath, this.filePath);
      });
    this.writeQueue = next;
    await next;
  }

  private validateRecord(value: unknown, index: number): PersistedScheduledReminderRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(this.describeError(index, 'must be an object'));
    }
    const record = value as Partial<PersistedScheduledReminderRecord>;
    const reminderId = this.requireString(record.reminderId, index, 'reminderId');
    const text = this.requireString(record.text, index, 'text');
    if (Array.from(text).length > SCHEDULED_REMINDER_MAX_TEXT_LENGTH) {
      throw new Error(
        this.describeError(
          index,
          `text must be at most ${SCHEDULED_REMINDER_MAX_TEXT_LENGTH} characters`,
        ),
      );
    }
    const runAt = this.requireString(record.runAt, index, 'runAt');
    const createdAt = this.requireString(record.createdAt, index, 'createdAt');
    this.requireValidIsoDate(runAt, index, 'runAt');
    this.requireValidIsoDate(createdAt, index, 'createdAt');
    return { reminderId, text, runAt, createdAt };
  }

  private requireString(value: unknown, index: number, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(this.describeError(index, `${field} must be a non-empty string`));
    }
    return value.trim();
  }

  private requireValidIsoDate(value: string, index: number, field: string): void {
    if (!Number.isFinite(Date.parse(value))) {
      throw new Error(this.describeError(index, `${field} must be a valid ISO timestamp`));
    }
  }

  private describeError(index: number, message: string): string {
    return index >= 0
      ? `Scheduled reminders store record ${index} ${message}`
      : `Scheduled reminders store record ${message}`;
  }
}
