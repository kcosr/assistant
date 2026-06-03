import fs from 'node:fs/promises';
import path from 'node:path';

import type { PersistedSessionWakeupRecord } from './types';

type PersistedWakeupsFile = {
  version: 1;
  wakeups: PersistedSessionWakeupRecord[];
};

const CURRENT_VERSION = 1 as const;

export class SessionWakeupStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'wakeups.json');
  }

  getFilePath(): string {
    return this.filePath;
  }

  async load(): Promise<PersistedSessionWakeupRecord[]> {
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
        `Failed to parse session wakeups store at ${this.filePath}: ${(error as Error).message}`,
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Session wakeups store at ${this.filePath} must be a JSON object`);
    }

    const file = parsed as Partial<PersistedWakeupsFile>;
    if (file.version !== CURRENT_VERSION) {
      throw new Error(
        `Session wakeups store at ${this.filePath} has unsupported version: ${String(file.version)}`,
      );
    }
    if (!Array.isArray(file.wakeups)) {
      throw new Error(`Session wakeups store at ${this.filePath} must contain a wakeups array`);
    }

    return file.wakeups.map((entry, index) => this.validateRecord(entry, index));
  }

  async save(records: PersistedSessionWakeupRecord[]): Promise<void> {
    const normalized = records
      .map((record) => this.validateRecord(record, -1))
      .sort((left, right) => left.runAt.localeCompare(right.runAt));

    const next = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.dataDir, { recursive: true });
        const payload: PersistedWakeupsFile = {
          version: CURRENT_VERSION,
          wakeups: normalized,
        };
        const content = `${JSON.stringify(payload, null, 2)}\n`;
        const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
        await fs.writeFile(tempPath, content, 'utf8');
        await fs.rename(tempPath, this.filePath);
      });

    this.writeQueue = next;
    await next;
  }

  private validateRecord(value: unknown, index: number): PersistedSessionWakeupRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(this.describeError(index, 'must be an object'));
    }
    const record = value as Partial<PersistedSessionWakeupRecord>;
    const requireString = (field: keyof PersistedSessionWakeupRecord): string => {
      const raw = record[field];
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        throw new Error(this.describeError(index, `${String(field)} must be a non-empty string`));
      }
      return raw.trim();
    };
    const runAt = requireString('runAt');
    const createdAt = requireString('createdAt');
    const status = requireString('status');
    this.requireValidIsoDate(runAt, index, 'runAt');
    this.requireValidIsoDate(createdAt, index, 'createdAt');
    if (status !== 'pending' && status !== 'queued' && status !== 'delivering') {
      throw new Error(
        this.describeError(index, 'status must be pending, queued, or delivering'),
      );
    }
    return {
      wakeupId: requireString('wakeupId'),
      sessionId: requireString('sessionId'),
      agentId: requireString('agentId'),
      message: requireString('message'),
      runAt,
      createdAt,
      status,
    };
  }

  private requireValidIsoDate(value: string, index: number, field: string): void {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
      throw new Error(this.describeError(index, `${field} must be a valid ISO timestamp`));
    }
  }

  private describeError(index: number, message: string): string {
    return index >= 0
      ? `Session wakeups store record ${index} ${message}`
      : `Session wakeups store record ${message}`;
  }
}
