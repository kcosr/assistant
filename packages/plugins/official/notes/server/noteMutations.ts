import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class NotesConflictError extends Error {
  readonly code = 'note_conflict';
}

export class InvalidNotePatchError extends Error {
  readonly code = 'invalid_arguments';
}

export function noteRevision(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function checkRevision(raw: string | undefined, expected: string | undefined): void {
  if (
    expected === undefined ? raw !== undefined : raw === undefined || noteRevision(raw) !== expected
  ) {
    throw new NotesConflictError(
      'Note changed or a revision is missing. Read the note and retry with its current revision.',
    );
  }
}

// Shared across store instances. Multi-path operations acquire locks in the same order.
const pending = new Map<string, Promise<void>>();
export async function withNoteLocks<T>(paths: string[], action: () => Promise<T>): Promise<T> {
  const keys = [...new Set(paths.map((file) => path.resolve(file)))].sort();
  async function acquire(index: number): Promise<T> {
    const key = keys[index];
    if (key === undefined) return action();
    const previous = pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    pending.set(key, current);
    await previous;
    try {
      return await acquire(index + 1);
    } finally {
      release();
      if (pending.get(key) === current) pending.delete(key);
    }
  }
  return acquire(0);
}

export async function atomicWrite(file: string, raw: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, raw, { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export interface NoteEdit {
  oldText: string;
  newText: string;
}

export function patchNoteBody(body: string, edits: NoteEdit[]): string {
  if (!Array.isArray(edits) || edits.length < 1 || edits.length > 100) {
    throw new InvalidNotePatchError('Provide between 1 and 100 edits.');
  }
  const ranges = edits
    .map((edit) => {
      if (
        !edit ||
        typeof edit.oldText !== 'string' ||
        edit.oldText.length === 0 ||
        typeof edit.newText !== 'string'
      ) {
        throw new InvalidNotePatchError('Each edit requires nonempty oldText and string newText.');
      }
      const start = body.indexOf(edit.oldText);
      if (start < 0 || body.indexOf(edit.oldText, start + 1) !== -1) {
        throw new NotesConflictError(
          'Each oldText must match exactly once. Read the note and provide a unique exact passage.',
        );
      }
      return { start, end: start + edit.oldText.length, replacement: edit.newText };
    })
    .sort((a, b) => a.start - b.start);
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index]!.start < ranges[index - 1]!.end) {
      throw new InvalidNotePatchError('Edits must not overlap in the original note.');
    }
  }
  let result = body;
  for (const edit of ranges.reverse()) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }
  return result;
}
