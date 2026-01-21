import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ArtifactsStore } from './store';

describe('ArtifactsStore', () => {
  let tempDir: string;
  let store: ArtifactsStore;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `artifacts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    store = new ArtifactsStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('uploads and lists artifacts', async () => {
    const artifact = await store.upload({
      title: 'Test File',
      filename: 'test.txt',
      content: Buffer.from('Hello, world!'),
      mimeType: 'text/plain',
    });

    expect(artifact.id).toBeDefined();
    expect(artifact.title).toBe('Test File');
    expect(artifact.filename).toBe('test.txt');
    expect(artifact.mimeType).toBe('text/plain');
    expect(artifact.size).toBe(13);

    const list = await store.list();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(artifact.id);
  });

  it('downloads artifact content', async () => {
    const originalContent = Buffer.from('Test content for download');
    const artifact = await store.upload({
      title: 'Download Test',
      filename: 'download.txt',
      content: originalContent,
    });

    const { content, artifact: meta } = await store.getFileContent(artifact.id);
    expect(content.toString()).toBe('Test content for download');
    expect(meta.title).toBe('Download Test');
  });

  it('renames artifacts', async () => {
    const artifact = await store.upload({
      title: 'Original Title',
      filename: 'file.txt',
      content: Buffer.from('content'),
    });

    const renamed = await store.rename(artifact.id, 'New Title');
    expect(renamed.title).toBe('New Title');
    expect(renamed.filename).toBe('file.txt');

    const list = await store.list();
    expect(list[0].title).toBe('New Title');
  });

  it('updates artifact content', async () => {
    const artifact = await store.upload({
      title: 'Update Test',
      filename: 'original.txt',
      content: Buffer.from('original'),
    });

    const updated = await store.update(artifact.id, {
      filename: 'updated.txt',
      content: Buffer.from('updated content'),
    });

    expect(updated.filename).toBe('updated.txt');
    expect(updated.size).toBe(15);
    expect(updated.title).toBe('Update Test'); // Title unchanged

    const { content } = await store.getFileContent(artifact.id);
    expect(content.toString()).toBe('updated content');
  });

  it('deletes artifacts', async () => {
    const artifact = await store.upload({
      title: 'Delete Test',
      filename: 'delete.txt',
      content: Buffer.from('to be deleted'),
    });

    await store.delete(artifact.id);

    const list = await store.list();
    expect(list).toHaveLength(0);

    await expect(store.getFileContent(artifact.id)).rejects.toThrow('Artifact not found');
  });

  it('enforces max file size', async () => {
    const smallStore = new ArtifactsStore(tempDir, 0.001); // 1KB max
    const largeContent = Buffer.alloc(2000); // 2KB

    await expect(
      smallStore.upload({
        title: 'Too Large',
        filename: 'large.bin',
        content: largeContent,
      }),
    ).rejects.toThrow('exceeds maximum');
  });

  it('guesses MIME types from extension', async () => {
    const pdfArtifact = await store.upload({
      title: 'PDF File',
      filename: 'document.pdf',
      content: Buffer.from('fake pdf'),
    });
    expect(pdfArtifact.mimeType).toBe('application/pdf');

    const jsonArtifact = await store.upload({
      title: 'JSON File',
      filename: 'data.json',
      content: Buffer.from('{}'),
    });
    expect(jsonArtifact.mimeType).toBe('application/json');

    const unknownArtifact = await store.upload({
      title: 'Unknown File',
      filename: 'file.xyz',
      content: Buffer.from('unknown'),
    });
    expect(unknownArtifact.mimeType).toBe('application/octet-stream');
  });

  it('sorts list by date (newest first)', async () => {
    await store.upload({
      title: 'First',
      filename: 'first.txt',
      content: Buffer.from('1'),
    });

    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    await store.upload({
      title: 'Second',
      filename: 'second.txt',
      content: Buffer.from('2'),
    });

    const list = await store.list();
    expect(list[0].title).toBe('Second');
    expect(list[1].title).toBe('First');
  });
});
