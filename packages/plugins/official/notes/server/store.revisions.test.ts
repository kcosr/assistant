import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotesStore } from './store';

let directory: string;
let store: NotesStore;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'note-revisions-'));
  store = new NotesStore(directory);
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});
async function seed(content = 'one two three') {
  await store.write({
    title: 'Note',
    content,
    tags: ['work'],
    favorite: true,
    description: 'Summary',
  });
  return store.read('Note');
}

describe('note revisions and patches', () => {
  it('appends exact text and returns revisions without requiring a read', async () => {
    const original = await seed('Body');
    const result = await store.append({ title: 'Note', text: '  suffix\r\n' });
    const note = await store.read('Note');
    expect(note).toMatchObject({
      content: 'Body  suffix\r\n',
      revision: result.revision,
      tags: original.tags,
      favorite: true,
      description: original.description,
      created: original.created,
    });
    expect(result.revision).not.toBe(original.revision);
    await expect(
      store.append({ title: 'Note', text: 'lost', expectedRevision: original.revision }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
    expect(await store.read('Note')).toEqual(note);
    const noop = await store.append({ title: 'Note', text: '', expectedRevision: note.revision });
    expect(noop.revision).toBe(note.revision);
    await store.append({ title: 'Note', text: 'next', expectedRevision: result.revision! });
    expect((await store.read('Note')).content).toBe('Body  suffix\r\nnext');
    await expect(store.append({ title: 'Missing', text: 'no creation' })).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps simultaneous appends and fences a stale replacement', async () => {
    const original = await seed('');
    await Promise.all([
      store.append({ title: 'Note', text: 'first' }),
      new NotesStore(directory).append({ title: 'Note', text: 'second' }),
    ]);
    expect((await store.read('Note')).content).toBe('firstsecond');
    await expect(
      store.write({ title: 'Note', content: 'lost', expectedRevision: original.revision }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
  });

  it('requires the current revision for replacement and never recreates a deleted note', async () => {
    const note = await seed();
    await expect(store.write({ title: 'Note', content: 'wrong' })).rejects.toMatchObject({
      code: 'note_conflict',
    });
    const updated = await store.write({
      title: 'Note',
      content: 'new',
      expectedRevision: note.revision,
    });
    expect(updated.revision).not.toBe(note.revision);
    await expect(
      store.write({ title: 'Note', content: 'stale', expectedRevision: note.revision }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
    await store.delete('Note');
    await expect(
      store.write({ title: 'Note', content: 'recreate', expectedRevision: updated.revision! }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
    await expect(
      store.patch({
        title: 'Note',
        expectedRevision: updated.revision!,
        edits: [{ oldText: 'new', newText: 'x' }],
      }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
    expect(await store.list()).toEqual([]);
  });

  it('applies simultaneous edits against original content and preserves whitespace and metadata', async () => {
    const original = await seed('\n  one\r\ntwo three  \n');
    const result = await store.patch({
      title: 'Note',
      expectedRevision: original.revision,
      edits: [
        { oldText: 'one', newText: 'two' },
        { oldText: 'two', newText: '' },
      ],
    });
    const note = await store.read('Note');
    expect(note.content).toBe('\n  two\r\n three  \n');
    expect(note).toMatchObject({
      tags: ['work'],
      favorite: true,
      description: 'Summary',
      created: original.created,
      revision: result.revision,
    });
    expect(note.revision).not.toBe(original.revision);
    await expect(
      store.patch({
        title: 'Note',
        expectedRevision: original.revision,
        edits: [{ oldText: 'three', newText: 'four' }],
      }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
  });

  it.each([
    ['missing', [{ oldText: 'absent', newText: 'x' }], 'note_conflict'],
    ['ambiguous overlapping occurrences', [{ oldText: 'aa', newText: 'x' }], 'note_conflict'],
    [
      'overlap',
      [
        { oldText: 'aaa', newText: 'x' },
        { oldText: 'aa b', newText: 'y' },
      ],
      'invalid_arguments',
    ],
    [
      'duplicate',
      [
        { oldText: 'bbb', newText: 'x' },
        { oldText: 'bbb', newText: 'y' },
      ],
      'invalid_arguments',
    ],
    ['empty anchor', [{ oldText: '', newText: 'x' }], 'invalid_arguments'],
    ['empty batch', [], 'invalid_arguments'],
  ])('rejects %s without partial edits', async (_name, edits, code) => {
    const original = await seed('aaa bbb');
    await expect(
      store.patch({ title: 'Note', expectedRevision: original.revision, edits }),
    ).rejects.toMatchObject({ code });
    expect(await store.read('Note')).toEqual(original);
  });

  it('validates the whole batch before writing and rejects oversized batches', async () => {
    const original = await seed();
    await expect(
      store.patch({
        title: 'Note',
        expectedRevision: original.revision,
        edits: [
          { oldText: 'one', newText: '1' },
          { oldText: 'missing', newText: '2' },
        ],
      }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
    await expect(
      store.patch({
        title: 'Note',
        expectedRevision: original.revision,
        edits: Array.from({ length: 101 }, () => ({ oldText: 'one', newText: '1' })),
      }),
    ).rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(await store.read('Note')).toEqual(original);
    expect(await fs.readdir(directory)).toEqual(['note.md']);
  });

  it('protects concurrent creation across store instances', async () => {
    const other = new NotesStore(directory);
    const results = await Promise.allSettled(
      [store, other].map((instance, index) =>
        instance.write({ title: 'New note', content: String(index) }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed).toMatchObject({ status: 'rejected', reason: { code: 'note_conflict' } });
    expect(await fs.readdir(directory)).toEqual(['new-note.md']);
  });

  it('keeps no-op patches unchanged and permits deleting the entire body', async () => {
    const original = await seed();
    const noop = await store.patch({
      title: 'Note',
      expectedRevision: original.revision,
      edits: [{ oldText: 'one', newText: 'one' }],
    });
    expect(noop.revision).toBe(original.revision);
    const deleted = await store.patch({
      title: 'Note',
      expectedRevision: original.revision,
      edits: [{ oldText: original.content, newText: '' }],
    });
    expect((await store.read('Note')).content).toBe('');
    expect(deleted.revision).not.toBe(original.revision);
  });

  it('detects external file changes through the raw-file revision', async () => {
    const original = await seed();
    await fs.appendFile(path.join(directory, 'note.md'), '\nexternal');
    await expect(
      store.patch({
        title: 'Note',
        expectedRevision: original.revision,
        edits: [{ oldText: 'one', newText: '1' }],
      }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
  });

  it('serializes competing writes across store instances', async () => {
    const original = await seed();
    const other = new NotesStore(directory);
    const results = await Promise.allSettled(
      [store, other].map((instance, index) =>
        instance.patch({
          title: 'Note',
          expectedRevision: original.revision,
          edits: [{ oldText: 'one', newText: String(index) }],
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(await fs.readdir(directory)).toEqual(['note.md']);
  });

  it('serializes metadata changes and appends without losing either update', async () => {
    await seed();
    await Promise.all([
      store.addTags('Note', ['new']),
      new NotesStore(directory).append({ title: 'Note', text: '\nappended' }),
    ]);
    const note = await store.read('Note');
    expect(note.tags).toEqual(['work', 'new']);
    expect(note.content).toBe('one two three\nappended');
    expect(note.favorite).toBe(true);
  });

  it('checks revisions for renames and moves, preserving metadata', async () => {
    const original = await seed();
    await store.addTags('Note', ['new']);
    await expect(
      store.rename({ title: 'Note', newTitle: 'New', expectedRevision: original.revision }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
    const renamed = await store.rename({ title: 'Note', newTitle: 'New' });
    expect(renamed.favorite).toBe(true);
    const target = new NotesStore(path.join(directory, 'other'));
    await expect(
      store.moveTo(target, { title: 'New', expectedRevision: original.revision }),
    ).rejects.toMatchObject({ code: 'note_conflict' });
    const moved = await store.moveTo(target, { title: 'New', expectedRevision: renamed.revision! });
    expect(await target.read('New')).toMatchObject({
      ...moved,
      content: original.content,
      favorite: true,
    });
    await expect(store.read('New')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
