import { randomUUID } from 'node:crypto';
import path from 'node:path';

import Database from 'better-sqlite3';

export type Task = {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

export type Entry = {
  id: string;
  task_id: string;
  entry_date: string;
  duration_minutes: number;
  reported: boolean;
  note: string;
  entry_type: 'manual' | 'timer';
  start_time: string | null;
  end_time: string | null;
  created_at: string;
  updated_at: string;
};

export type ActiveTimer = {
  id: string;
  task_id: string;
  entry_date: string;
  accumulated_seconds: number;
  last_resumed_at: string;
  created_at: string;
};

export class TaskNotFoundError extends Error {}
export class EntryNotFoundError extends Error {}
export class TimerAlreadyActiveError extends Error {}
export class NoActiveTimerError extends Error {}
export class DuplicateTaskNameError extends Error {}
export class ValidationError extends Error {}

const MIGRATIONS: Array<{ version: number; up: (db: Database.Database) => void }> = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE COLLATE NOCASE,
          description TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tasks_name ON tasks(name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS entries (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          entry_date TEXT NOT NULL,
          duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 1),
          note TEXT NOT NULL DEFAULT '',
          entry_type TEXT NOT NULL CHECK (entry_type IN ('manual', 'timer')),
          start_time TEXT,
          end_time TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CHECK (
            (entry_type = 'manual' AND start_time IS NULL AND end_time IS NULL)
            OR
            (entry_type = 'timer' AND start_time IS NOT NULL AND end_time IS NOT NULL)
          )
        );

        CREATE INDEX IF NOT EXISTS idx_entries_task_id ON entries(task_id);
        CREATE INDEX IF NOT EXISTS idx_entries_entry_date ON entries(entry_date);
        CREATE INDEX IF NOT EXISTS idx_entries_updated_at ON entries(updated_at DESC);

        CREATE TABLE IF NOT EXISTS active_timer (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          entry_date TEXT NOT NULL,
          accumulated_seconds INTEGER NOT NULL DEFAULT 0,
          last_resumed_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`
        ALTER TABLE entries ADD COLUMN reported INTEGER NOT NULL DEFAULT 0;
      `);
    },
  },
];

function isSqliteConstraintError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const candidate = error as { code?: unknown };
  return candidate.code === 'SQLITE_CONSTRAINT' || candidate.code === 'SQLITE_CONSTRAINT_UNIQUE';
}

function nowIso(): string {
  return new Date().toISOString();
}

function ensurePositiveMinutes(value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    throw new ValidationError('duration_minutes must be an integer >= 1');
  }
}

function buildDbPath(dataDir: string): string {
  return path.join(dataDir, 'time-tracker.db');
}

export class TimeTrackerStore {
  private readonly db: Database.Database;
  private readonly dbPath: string;

  constructor(dataDir: string) {
    this.dbPath = buildDbPath(dataDir);
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  close(): void {
    this.db.close();
  }

  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  getSchemaVersion(): number {
    this.ensureMigrationsTable();
    const row = this.db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as
      | { version?: number | null }
      | undefined;
    return row?.version ?? 0;
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
  }

  private initialize(): void {
    this.ensureMigrationsTable();
    const currentVersion = this.getSchemaVersion();
    const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion).sort(
      (a, b) => a.version - b.version,
    );
    if (pending.length === 0) {
      return;
    }
    const apply = this.db.transaction((migration: (typeof MIGRATIONS)[number]) => {
      migration.up(this.db);
      this.db
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, nowIso());
    });
    for (const migration of pending) {
      apply(migration);
    }
  }

  private touchTask(taskId: string, timestamp?: string): void {
    const updatedAt = timestamp ?? nowIso();
    this.db.prepare('UPDATE tasks SET updated_at = ? WHERE id = ?').run(updatedAt, taskId);
  }

  listTasks(query?: string): Task[] {
    if (query && query.trim().length > 0) {
      const pattern = `%${query.trim()}%`;
      return this.db
        .prepare(
          `SELECT id, name, description, created_at, updated_at
           FROM tasks
           WHERE name LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC`,
        )
        .all(pattern) as Task[];
    }
    return this.db
      .prepare(
        `SELECT id, name, description, created_at, updated_at
         FROM tasks
         ORDER BY updated_at DESC`,
      )
      .all() as Task[];
  }

  getTask(id: string): Task | null {
    const row = this.db
      .prepare(
        `SELECT id, name, description, created_at, updated_at
         FROM tasks
         WHERE id = ?`,
      )
      .get(id) as Task | undefined;
    return row ?? null;
  }

  createTask(params: { name: string; description?: string }): Task {
    const now = nowIso();
    const task: Task = {
      id: randomUUID(),
      name: params.name,
      description: params.description ?? '',
      created_at: now,
      updated_at: now,
    };
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (id, name, description, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(task.id, task.name, task.description, task.created_at, task.updated_at);
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        throw new DuplicateTaskNameError('Task name already exists');
      }
      throw error;
    }
    return task;
  }

  updateTask(params: { id: string; name?: string; description?: string }): Task {
    const existing = this.getTask(params.id);
    if (!existing) {
      throw new TaskNotFoundError(`Task not found: ${params.id}`);
    }
    const now = nowIso();
    const updated: Task = {
      ...existing,
      name: params.name ?? existing.name,
      description: params.description ?? existing.description,
      updated_at: now,
    };
    try {
      this.db
        .prepare(
          `UPDATE tasks
           SET name = ?, description = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(updated.name, updated.description, updated.updated_at, updated.id);
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        throw new DuplicateTaskNameError('Task name already exists');
      }
      throw error;
    }
    return updated;
  }

  deleteTask(id: string): void {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new TaskNotFoundError(`Task not found: ${id}`);
    }
  }

  listEntries(params?: {
    startDate?: string;
    endDate?: string;
    taskId?: string;
    includeReported?: boolean;
  }): Entry[] {
    const clauses: string[] = [];
    const values: Array<string> = [];

    if (!params?.includeReported) {
      clauses.push('reported = 0');
    }

    if (params?.taskId) {
      clauses.push('task_id = ?');
      values.push(params.taskId);
    }
    if (params?.startDate) {
      clauses.push('entry_date >= ?');
      values.push(params.startDate);
    }
    if (params?.endDate) {
      clauses.push('entry_date <= ?');
      values.push(params.endDate);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT id, task_id, entry_date, duration_minutes, reported, note, entry_type, start_time, end_time,
                created_at, updated_at
         FROM entries
         ${where}
         ORDER BY updated_at DESC`,
      )
      .all(...values)
      .map((row) => ({
        ...row,
        reported: Boolean((row as { reported?: number }).reported),
      })) as Entry[];
  }

  getEntry(id: string): Entry | null {
    const row = this.db
      .prepare(
        `SELECT id, task_id, entry_date, duration_minutes, reported, note, entry_type, start_time, end_time,
                created_at, updated_at
         FROM entries
         WHERE id = ?`,
      )
      .get(id) as Entry | undefined;
    if (!row) {
      return null;
    }
    return { ...row, reported: Boolean((row as { reported?: number }).reported) };
  }

  createEntry(params: {
    taskId: string;
    entryDate: string;
    durationMinutes: number;
    reported?: boolean;
    note?: string;
    entryType: Entry['entry_type'];
    startTime?: string | null;
    endTime?: string | null;
    timestamp?: string;
  }): Entry {
    const task = this.getTask(params.taskId);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${params.taskId}`);
    }
    ensurePositiveMinutes(params.durationMinutes);

    const now = params.timestamp ?? nowIso();
    const entry: Entry = {
      id: randomUUID(),
      task_id: params.taskId,
      entry_date: params.entryDate,
      duration_minutes: params.durationMinutes,
      reported: params.reported ?? false,
      note: params.note ?? '',
      entry_type: params.entryType,
      start_time: params.startTime ?? null,
      end_time: params.endTime ?? null,
      created_at: now,
      updated_at: now,
    };

    this.db
      .prepare(
        `INSERT INTO entries
         (id, task_id, entry_date, duration_minutes, reported, note, entry_type, start_time, end_time, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.task_id,
        entry.entry_date,
        entry.duration_minutes,
        entry.reported ? 1 : 0,
        entry.note,
        entry.entry_type,
        entry.start_time,
        entry.end_time,
        entry.created_at,
        entry.updated_at,
      );

    this.touchTask(entry.task_id, entry.updated_at);
    return entry;
  }

  updateEntry(params: {
    id: string;
    taskId?: string;
    entryDate?: string;
    durationMinutes?: number;
    reported?: boolean;
    note?: string;
  }): Entry {
    const updatedAt = nowIso();
    const entry = this.getEntry(params.id);
    if (!entry) {
      throw new EntryNotFoundError(`Entry not found: ${params.id}`);
    }

    const targetTaskId = params.taskId ?? entry.task_id;
    if (targetTaskId !== entry.task_id) {
      const targetTask = this.getTask(targetTaskId);
      if (!targetTask) {
        throw new TaskNotFoundError(`Task not found: ${targetTaskId}`);
      }
    }

    const durationMinutes = params.durationMinutes ?? entry.duration_minutes;
    ensurePositiveMinutes(durationMinutes);

    const reported = params.reported ?? entry.reported;
    const entryDate = params.entryDate ?? entry.entry_date;
    const note = params.note ?? entry.note;

    this.db
      .prepare(
        `UPDATE entries
         SET task_id = ?, entry_date = ?, duration_minutes = ?, reported = ?, note = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(targetTaskId, entryDate, durationMinutes, reported ? 1 : 0, note, updatedAt, entry.id);

    this.touchTask(entry.task_id, updatedAt);
    if (targetTaskId !== entry.task_id) {
      this.touchTask(targetTaskId, updatedAt);
    }

    return {
      ...entry,
      task_id: targetTaskId,
      entry_date: entryDate,
      duration_minutes: durationMinutes,
      reported,
      note,
      updated_at: updatedAt,
    };
  }

  deleteEntry(id: string): Entry {
    const entry = this.getEntry(id);
    if (!entry) {
      throw new EntryNotFoundError(`Entry not found: ${id}`);
    }
    this.db.prepare('DELETE FROM entries WHERE id = ?').run(id);
    this.touchTask(entry.task_id);
    return entry;
  }

  getActiveTimer(): ActiveTimer | null {
    const row = this.db
      .prepare(
        `SELECT id, task_id, entry_date, accumulated_seconds, last_resumed_at, created_at
         FROM active_timer
         LIMIT 1`,
      )
      .get() as ActiveTimer | undefined;
    return row ?? null;
  }

  startTimer(params: { taskId: string; entryDate: string }): ActiveTimer {
    const active = this.getActiveTimer();
    if (active) {
      throw new TimerAlreadyActiveError('Timer already active');
    }
    const task = this.getTask(params.taskId);
    if (!task) {
      throw new TaskNotFoundError(`Task not found: ${params.taskId}`);
    }
    const now = nowIso();
    const timer: ActiveTimer = {
      id: randomUUID(),
      task_id: params.taskId,
      entry_date: params.entryDate,
      accumulated_seconds: 0,
      last_resumed_at: now,
      created_at: now,
    };
    this.db
      .prepare(
        `INSERT INTO active_timer
         (id, task_id, entry_date, accumulated_seconds, last_resumed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        timer.id,
        timer.task_id,
        timer.entry_date,
        timer.accumulated_seconds,
        timer.last_resumed_at,
        timer.created_at,
      );
    return timer;
  }

  stopTimer(note?: string): { timerId: string; entry: Entry } {
    const timer = this.getActiveTimer();
    if (!timer) {
      throw new NoActiveTimerError('No active timer');
    }
    const endTime = new Date();
    const elapsedSeconds = this.getElapsedSeconds(timer, endTime);
    const durationMinutes = Math.max(1, Math.ceil(elapsedSeconds / 60));
    const endIso = endTime.toISOString();

    const finalize = this.db.transaction(() => {
      const entry = this.createEntry({
        taskId: timer.task_id,
        entryDate: timer.entry_date,
        durationMinutes,
        note: note ?? '',
        entryType: 'timer',
        startTime: timer.last_resumed_at,
        endTime: endIso,
        timestamp: endIso,
      });
      this.db.prepare('DELETE FROM active_timer WHERE id = ?').run(timer.id);
      return entry;
    });

    const entry = finalize();
    return { timerId: timer.id, entry };
  }

  discardTimer(): { timerId: string } {
    const timer = this.getActiveTimer();
    if (!timer) {
      throw new NoActiveTimerError('No active timer');
    }
    this.db.prepare('DELETE FROM active_timer WHERE id = ?').run(timer.id);
    return { timerId: timer.id };
  }

  getElapsedSeconds(timer: ActiveTimer, now = new Date()): number {
    const resumedAt = new Date(timer.last_resumed_at);
    const delta = Math.max(0, now.getTime() - resumedAt.getTime());
    return timer.accumulated_seconds + Math.floor(delta / 1000);
  }
}
