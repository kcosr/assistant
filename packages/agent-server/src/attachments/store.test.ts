import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_ATTACHMENT_SIZE_BYTES } from './constants';
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
      requestId: 'request-1',
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

  it('deletes attachments by dropped request ids', async () => {
    const baseDir = await createTempDir('attachment-store-turn-delete');
    const store = new AttachmentStore(baseDir);

    const first = await store.createAttachment({
      sessionId: 'session-1',
      requestId: 'request-1',
      toolCallId: 'tool-1',
      fileName: 'first.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('first', 'utf8'),
    });
    const second = await store.createAttachment({
      sessionId: 'session-1',
      requestId: 'request-2',
      toolCallId: 'tool-2',
      fileName: 'second.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('second', 'utf8'),
    });

    const deletedCount = await store.deleteByRequestIds('session-1', ['request-1']);

    expect(deletedCount).toBe(1);
    expect(await store.getAttachment('session-1', first.attachmentId)).toBeNull();
    expect(await store.getAttachment('session-1', second.attachmentId)).not.toBeNull();
  });

  it('deletes the whole session attachment directory', async () => {
    const baseDir = await createTempDir('attachment-store-session-delete');
    const store = new AttachmentStore(baseDir);

    await store.createAttachment({
      sessionId: 'session-1',
      requestId: 'request-1',
      toolCallId: 'tool-1',
      fileName: 'note.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('note', 'utf8'),
    });

    await store.deleteSession('session-1');

    await expect(fs.stat(path.join(baseDir, 'session-1'))).rejects.toThrow();
  });

  it('deletes a single attachment by id', async () => {
    const baseDir = await createTempDir('attachment-store-delete-one');
    const store = new AttachmentStore(baseDir);

    const created = await store.createAttachment({
      sessionId: 'session-1',
      requestId: 'request-1',
      toolCallId: 'tool-1',
      fileName: 'note.txt',
      contentType: 'text/plain',
      bytes: Buffer.from('note', 'utf8'),
    });

    await expect(store.deleteAttachment('session-1', created.attachmentId)).resolves.toBe(true);
    await expect(store.getAttachment('session-1', created.attachmentId)).resolves.toBeNull();
    await expect(
      fs.stat(path.join(baseDir, 'session-1', 'files', created.storageFileName)),
    ).rejects.toThrow();
  });

  it('rejects oversized attachments before writing them', async () => {
    const baseDir = await createTempDir('attachment-store-too-large');
    const store = new AttachmentStore(baseDir);

    await expect(
      store.createAttachment({
        sessionId: 'session-1',
        requestId: 'request-1',
        toolCallId: 'tool-1',
        fileName: 'big.txt',
        contentType: 'text/plain',
        bytes: Buffer.alloc(MAX_ATTACHMENT_SIZE_BYTES + 1, 0x61),
      }),
    ).rejects.toThrow('Attachment exceeds the 4 MB limit');

    await expect(fs.stat(path.join(baseDir, 'session-1'))).rejects.toThrow();
  });

  it('serializes concurrent writes for the same session', async () => {
    const baseDir = await createTempDir('attachment-store-concurrent');
    const store = new AttachmentStore(baseDir);
    const sessionId = 'session-1';

    const created = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.createAttachment({
          sessionId,
          requestId: `request-${index}`,
          toolCallId: `tool-${index}`,
          fileName: `file-${index}.txt`,
          contentType: 'text/plain',
          bytes: Buffer.from(`attachment-${index}`, 'utf8'),
        }),
      ),
    );

    const metadataPath = path.join(baseDir, sessionId, 'metadata.json');
    const rawMetadata = await fs.readFile(metadataPath, 'utf8');
    const parsed = JSON.parse(rawMetadata) as { attachments?: Array<{ attachmentId: string }> };
    expect(parsed.attachments).toHaveLength(20);
    expect(
      new Set(parsed.attachments?.map((attachment) => attachment.attachmentId)).size,
    ).toBe(20);

    await Promise.all(
      created.map(async (attachment, index) => {
        const file = await store.getAttachmentFile(sessionId, attachment.attachmentId);
        expect(file?.content.toString('utf8')).toBe(`attachment-${index}`);
      }),
    );
  });
});
