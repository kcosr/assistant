import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { AttachmentStore } from './store';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('AttachmentStore', () => {
  it('persists and reads attachment bytes and metadata', async () => {
    const baseDir = await createTempDir('attachment-store');
    const store = new AttachmentStore(baseDir);

    const created = await store.createAttachment({
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      fileName: 'note.txt',
      title: 'Note',
      contentType: 'text/plain',
      bytes: Buffer.from('hello world', 'utf8'),
    });

    expect(created.fileName).toBe('note.txt');
    expect(created.title).toBe('Note');
    expect(created.size).toBe(11);

    const file = await store.getAttachmentFile('session-1', created.attachmentId);
    expect(file?.attachment.attachmentId).toBe(created.attachmentId);
    expect(file?.content.toString('utf8')).toBe('hello world');
  });

  it('deletes attachments by dropped turn ids', async () => {
    const baseDir = await createTempDir('attachment-store-turn-delete');
    const store = new AttachmentStore(baseDir);

    const first = await store.createAttachment({
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      fileName: 'first.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('first', 'utf8'),
    });
    const second = await store.createAttachment({
      sessionId: 'session-1',
      turnId: 'turn-2',
      toolCallId: 'tool-2',
      fileName: 'second.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('second', 'utf8'),
    });

    const deletedCount = await store.deleteByTurnIds('session-1', ['turn-1']);

    expect(deletedCount).toBe(1);
    expect(await store.getAttachment('session-1', first.attachmentId)).toBeNull();
    expect(await store.getAttachment('session-1', second.attachmentId)).not.toBeNull();
  });

  it('deletes the whole session attachment directory', async () => {
    const baseDir = await createTempDir('attachment-store-session-delete');
    const store = new AttachmentStore(baseDir);

    await store.createAttachment({
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolCallId: 'tool-1',
      fileName: 'note.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('note', 'utf8'),
    });

    await store.deleteSession('session-1');

    await expect(fs.stat(path.join(baseDir, 'session-1'))).rejects.toThrow();
  });
});
