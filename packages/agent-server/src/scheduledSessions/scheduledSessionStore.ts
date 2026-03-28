import fs from 'node:fs/promises';
import path from 'node:path';

import { parseSessionConfigInput } from '../sessionConfig';
import type { PersistedScheduleRecord } from './types';

type PersistedSchedulesFile = {
  version: 1;
  schedules: PersistedScheduleRecord[];
};

const CURRENT_VERSION = 1 as const;

export class ScheduledSessionStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.filePath = path.join(dataDir, 'schedules.json');
  }

  getDataDir(): string {
    return this.dataDir;
  }

  getFilePath(): string {
    return this.filePath;
  }

  async load(): Promise<PersistedScheduleRecord[]> {
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
        `Failed to parse scheduled sessions store at ${this.filePath}: ${(error as Error).message}`,
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Scheduled sessions store at ${this.filePath} must be a JSON object`);
    }

    const file = parsed as Partial<PersistedSchedulesFile>;
    if (file.version !== CURRENT_VERSION) {
      throw new Error(
        `Scheduled sessions store at ${this.filePath} has unsupported version: ${String(file.version)}`,
      );
    }
    if (!Array.isArray(file.schedules)) {
      throw new Error(`Scheduled sessions store at ${this.filePath} must contain a schedules array`);
    }

    return file.schedules.map((entry, index) => this.validateRecord(entry, index));
  }

  async save(records: PersistedScheduleRecord[]): Promise<void> {
    const normalized = records
      .map((record) => this.validateRecord(record, -1))
      .sort((left, right) =>
        left.agentId.localeCompare(right.agentId) ||
        left.scheduleId.localeCompare(right.scheduleId),
      );

    const next = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.dataDir, { recursive: true });
        const payload: PersistedSchedulesFile = {
          version: CURRENT_VERSION,
          schedules: normalized,
        };
        const content = `${JSON.stringify(payload, null, 2)}\n`;
        const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
        await fs.writeFile(tempPath, content, 'utf8');
        await fs.rename(tempPath, this.filePath);
      });

    this.writeQueue = next;
    await next;
  }

  private validateRecord(value: unknown, index: number): PersistedScheduleRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(this.describeError(index, 'must be an object'));
    }
    const record = value as Partial<PersistedScheduleRecord>;
    const requireString = (field: keyof PersistedScheduleRecord): string => {
      const raw = record[field];
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        throw new Error(this.describeError(index, `${String(field)} must be a non-empty string`));
      }
      return raw.trim();
    };
    const optionalString = (field: keyof PersistedScheduleRecord): string | undefined => {
      const raw = record[field];
      if (raw === undefined) {
        return undefined;
      }
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        throw new Error(this.describeError(index, `${String(field)} must be a non-empty string`));
      }
      return raw.trim();
    };
    const requireBoolean = (field: keyof PersistedScheduleRecord): boolean => {
      const raw = record[field];
      if (typeof raw !== 'boolean') {
        throw new Error(this.describeError(index, `${String(field)} must be a boolean`));
      }
      return raw;
    };
    const requireInteger = (field: keyof PersistedScheduleRecord): number => {
      const raw = record[field];
      if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw < 1) {
        throw new Error(this.describeError(index, `${String(field)} must be an integer >= 1`));
      }
      return raw;
    };

    const prompt = optionalString('prompt');
    const preCheck = optionalString('preCheck');
    const sessionTitle = optionalString('sessionTitle');
    const sessionConfig = this.validateSessionConfig(record['sessionConfig'], index);

    return {
      agentId: requireString('agentId'),
      scheduleId: requireString('scheduleId'),
      cron: requireString('cron'),
      ...(prompt !== undefined ? { prompt } : {}),
      ...(preCheck !== undefined ? { preCheck } : {}),
      ...(sessionTitle !== undefined ? { sessionTitle } : {}),
      ...(sessionConfig ? { sessionConfig } : {}),
      enabled: requireBoolean('enabled'),
      reuseSession: requireBoolean('reuseSession'),
      maxConcurrent: requireInteger('maxConcurrent'),
    };
  }

  private validateSessionConfig(
    value: unknown,
    index: number,
  ): PersistedScheduleRecord['sessionConfig'] | undefined {
    try {
      return (
        parseSessionConfigInput({
          value,
          allowSessionTitle: false,
        }) ?? undefined
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid sessionConfig';
      throw new Error(this.describeError(index, message));
    }
  }

  private describeError(index: number, message: string): string {
    return index >= 0
      ? `Scheduled sessions store record ${index} ${message}`
      : `Scheduled sessions store record ${message}`;
  }
}
