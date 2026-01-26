import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TimeTrackerStore,
  DuplicateTaskNameError,
  TimerAlreadyActiveError,
  NoActiveTimerError,
} from './store';

async function createTempDir(): Promise<string> {
  const dir = path.join(
    os.tmpdir(),
    `time-tracker-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

describe('TimeTrackerStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initializes schema and version', async () => {
    const dir = await createTempDir();
    const store = new TimeTrackerStore(dir);

    expect(store.getSchemaVersion()).toBe(2);
    expect(store.listTasks()).toHaveLength(0);

    store.close();
  });

  it('creates tasks and enforces unique names', async () => {
    const dir = await createTempDir();
    const store = new TimeTrackerStore(dir);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const task = store.createTask({ name: 'Project X', description: 'Main work' });

    expect(task.name).toBe('Project X');
    expect(task.description).toBe('Main work');
    expect(task.created_at).toBe('2024-01-01T00:00:00.000Z');
    expect(task.updated_at).toBe('2024-01-01T00:00:00.000Z');

    expect(() => store.createTask({ name: 'project x' })).toThrow(DuplicateTaskNameError);

    store.close();
  });

  it('touches task timestamps when entries change', async () => {
    const dir = await createTempDir();
    const store = new TimeTrackerStore(dir);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const task = store.createTask({ name: 'Planning' });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    store.createEntry({
      taskId: task.id,
      entryDate: '2024-01-02',
      durationMinutes: 30,
      note: 'Initial work',
      entryType: 'manual',
    });

    const updated = store.getTask(task.id);
    expect(updated?.updated_at).toBe('2024-01-02T00:00:00.000Z');

    store.close();
  });

  it('updates entry and touches both tasks when moved', async () => {
    const dir = await createTempDir();
    const store = new TimeTrackerStore(dir);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const taskA = store.createTask({ name: 'Alpha' });
    const taskB = store.createTask({ name: 'Beta' });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    const entry = store.createEntry({
      taskId: taskA.id,
      entryDate: '2024-01-02',
      durationMinutes: 60,
      note: 'Work',
      entryType: 'manual',
    });

    vi.setSystemTime(new Date('2024-01-03T00:00:00.000Z'));
    store.updateEntry({
      id: entry.id,
      taskId: taskB.id,
      durationMinutes: 45,
      note: 'Moved',
    });

    const updatedA = store.getTask(taskA.id);
    const updatedB = store.getTask(taskB.id);
    expect(updatedA?.updated_at).toBe('2024-01-03T00:00:00.000Z');
    expect(updatedB?.updated_at).toBe('2024-01-03T00:00:00.000Z');

    store.close();
  });

  it('starts and stops timers with rounded duration', async () => {
    const dir = await createTempDir();
    const store = new TimeTrackerStore(dir);

    const task = store.createTask({ name: 'Timer Task' });

    vi.setSystemTime(new Date('2024-01-05T10:00:00.000Z'));
    store.startTimer({ taskId: task.id, entryDate: '2024-01-05' });

    vi.setSystemTime(new Date('2024-01-05T10:01:30.000Z'));
    const result = store.stopTimer('Timer note');

    expect(result.entry.entry_type).toBe('timer');
    expect(result.entry.duration_minutes).toBe(2);
    expect(result.entry.note).toBe('Timer note');
    expect(result.entry.start_time).toBe('2024-01-05T10:00:00.000Z');
    expect(result.entry.end_time).toBe('2024-01-05T10:01:30.000Z');
    expect(store.getActiveTimer()).toBeNull();

    store.close();
  });

  it('stores and filters reported entries', async () => {
    const dir = await createTempDir();
    const store = new TimeTrackerStore(dir);

    const task = store.createTask({ name: 'Reporting' });

    const reportedEntry = store.createEntry({
      taskId: task.id,
      entryDate: '2024-01-10',
      durationMinutes: 30,
      note: 'Reported work',
      entryType: 'manual',
      reported: true,
    });

    const unreportedEntry = store.createEntry({
      taskId: task.id,
      entryDate: '2024-01-11',
      durationMinutes: 45,
      note: 'Unreported work',
      entryType: 'manual',
    });

    const defaultList = store.listEntries();
    expect(defaultList).toHaveLength(1);
    expect(defaultList[0]?.id).toBe(unreportedEntry.id);

    const fullList = store.listEntries({ includeReported: true });
    expect(fullList).toHaveLength(2);

    const updated = store.updateEntry({ id: unreportedEntry.id, reported: true });
    expect(updated.reported).toBe(true);

    const updatedEntry = store.getEntry(reportedEntry.id);
    expect(updatedEntry?.reported).toBe(true);

    store.close();
  });

  it('rejects duplicate timers and discard without active timer', async () => {
    const dir = await createTempDir();
    const store = new TimeTrackerStore(dir);

    const task = store.createTask({ name: 'Timer Task' });
    store.startTimer({ taskId: task.id, entryDate: '2024-01-05' });

    expect(() => store.startTimer({ taskId: task.id, entryDate: '2024-01-05' })).toThrow(
      TimerAlreadyActiveError,
    );

    store.discardTimer();
    expect(() => store.discardTimer()).toThrow(NoActiveTimerError);

    store.close();
  });
});
