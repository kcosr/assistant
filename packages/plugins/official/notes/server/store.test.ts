import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotesStore } from './store';

const testDataDir = os.tmpdir();

async function createTempDir(): Promise<string> {
  const dir = path.join(
    testDataDir,
    `notes-store-test-${Date.now()}-${Math.random().toString(16)}`,
  );
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function createStore(baseDir: string): NotesStore {
  return new NotesStore(baseDir);
}

describe('NotesStore (plugin)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes, lists, and reads notes with frontmatter', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const meta = await store.write({
      title: 'Meeting Notes',
      content: 'First line of the meeting.',
      tags: ['work', 'meetings'],
    });

    expect(meta.title).toBe('Meeting Notes');
    expect(meta.tags).toEqual(['work', 'meetings']);
    expect(meta.created).toBe('2024-01-01T00:00:00.000Z');
    expect(meta.updated).toBe('2024-01-01T00:00:00.000Z');

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe('Meeting Notes');
    expect(list[0]?.tags).toEqual(['work', 'meetings']);

    const filtered = await store.list({ tags: ['work', 'meetings'] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe('Meeting Notes');

    const note = await store.read('Meeting Notes');
    expect(note.title).toBe('Meeting Notes');
    expect(note.tags).toEqual(['work', 'meetings']);
    expect(note.content).toBe('First line of the meeting.');
  });

  it('preserves created timestamp and updates updated on write', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const first = await store.write({
      title: 'Daily Log',
      content: 'Day 1',
      tags: ['log'],
    });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    const second = await store.write({
      title: 'Daily Log',
      content: 'Day 2',
    });

    expect(second.created).toBe(first.created);
    expect(second.updated).toBe('2024-01-02T00:00:00.000Z');
    expect(second.tags).toEqual(['log']);

    const note = await store.read('Daily Log');
    expect(note.created).toBe(first.created);
    expect(note.updated).toBe(second.updated);
  });

  it('appends content and updates updated timestamp', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await store.write({
      title: 'Journal',
      content: 'Entry 1',
      tags: ['personal'],
    });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    const meta = await store.append('Journal', 'Entry 2');

    expect(meta.created).toBe('2024-01-01T00:00:00.000Z');
    expect(meta.updated).toBe('2024-01-02T00:00:00.000Z');
    expect(meta.tags).toEqual(['personal']);

    const note = await store.read('Journal');
    expect(note.content).toBe('Entry 1\nEntry 2');
  });

  it('deletes notes', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    await store.write({
      title: 'Temp Note',
      content: 'To be deleted',
    });

    await store.delete('Temp Note');

    const list = await store.list();
    expect(list).toHaveLength(0);
    await expect(store.read('Temp Note')).rejects.toThrowError();
  });

  it('parses and serializes frontmatter correctly', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await store.write({
      title: 'Frontmatter Note',
      content: 'Body content',
      tags: ['a', 'b'],
    });

    const slug = (store as unknown as { slugify(title: string): string }).slugify(
      'Frontmatter Note',
    );
    const filePath = path.join(baseDir, `${slug}.md`);
    const raw = await fs.readFile(filePath, 'utf8');

    expect(raw).toContain('---');
    expect(raw).toContain('title: Frontmatter Note');
    expect(raw).toContain('tags:');
    expect(raw).toContain('- a');
    expect(raw).toContain('- b');
    expect(raw).toContain('created: 2024-01-01T00:00:00.000Z');
    expect(raw).toContain('updated: 2024-01-01T00:00:00.000Z');
    expect(raw).toContain('Body content');

    const note = await store.read('Frontmatter Note');
    expect(note.title).toBe('Frontmatter Note');
    expect(note.tags).toEqual(['a', 'b']);
    expect(note.content).toBe('Body content');
  });

  it('filters notes by tags with AND logic', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    await store.write({
      title: 'Work Note',
      content: 'Work stuff',
      tags: ['work', 'project'],
    });
    await store.write({
      title: 'Personal Note',
      content: 'Personal stuff',
      tags: ['personal'],
    });

    const all = await store.list();
    expect(all.map((n) => n.title).sort()).toEqual(['Personal Note', 'Work Note']);

    const filtered = await store.list({ tags: ['work', 'project'] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.title).toBe('Work Note');

    const none = await store.list({ tags: ['work', 'personal'] });
    expect(none).toHaveLength(0);
  });

  it('searches content with snippets and tag filtering', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    await store.write({
      title: 'Groceries',
      content: 'Shopping list: milk, eggs, bread.',
      tags: ['personal', 'shopping'],
    });
    await store.write({
      title: 'Work Plan',
      content: 'Prepare quarterly report and buy milk for office.',
      tags: ['work'],
    });

    const milkResults = await store.search({ query: 'milk' });
    expect(milkResults.length).toBeGreaterThanOrEqual(2);
    expect(milkResults.every((r) => r.snippet.toLowerCase().includes('milk'))).toBe(true);

    const tagged = await store.search({ query: 'milk', tags: ['personal', 'shopping'] });
    expect(tagged).toHaveLength(1);
    expect(tagged[0]?.title).toBe('Groceries');
  });

  it('enforces slug validation and prevents path traversal', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);
    const internal = store as unknown as {
      validateSlug(slug: string): void;
      slugify(title: string): string;
    };

    expect(() => internal.validateSlug('..')).toThrowError(/Path traversal|Invalid slug/);
    expect(() => internal.validateSlug('../secret')).toThrowError(/Path traversal|Invalid slug/);
    expect(() => internal.validateSlug('/etc/passwd')).toThrowError(/Path traversal/);
    expect(() => internal.validateSlug('C:\\windows')).toThrowError(/Path traversal/);
    expect(() => internal.validateSlug('bad slug!')).toThrowError(/Invalid slug/);

    expect(() => internal.validateSlug('valid-slug')).not.toThrow();
    expect(internal.slugify('Hello World')).toBe('hello-world');
  });

  it('previewWrite returns a unified diff without modifying files', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    const diff = await store.previewWrite('Preview Note', 'Preview content');
    expect(diff).toContain('@@');
    expect(diff).toContain('Preview content');

    const files = await fs.readdir(baseDir);
    expect(files).toHaveLength(0);
  });

  it('previewWrite shows differences for existing notes', async () => {
    const baseDir = await createTempDir();
    const store = createStore(baseDir);

    await store.write({
      title: 'Diff Note',
      content: 'Old content',
      tags: ['tag'],
    });

    const diff = await store.previewWrite('Diff Note', 'New content');
    expect(diff).toContain('-Old content');
    expect(diff).toContain('+New content');
  });
});
