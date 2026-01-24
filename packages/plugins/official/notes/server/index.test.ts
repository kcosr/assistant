import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../../../../agent-server/src/tools';
import type { CombinedPluginManifest } from '@assistant/shared';
import manifestJson from '../manifest.json';
import { createPlugin } from './index';

function createTempDataDir(): string {
  return path.join(os.tmpdir(), `notes-plugin-test-${Date.now()}-${Math.random().toString(16)}`);
}

function createTestContext(): ToolContext {
  return {
    sessionId: 'test-session',
    signal: new AbortController().signal,
  };
}

function createTestPlugin() {
  return createPlugin({ manifest: manifestJson as CombinedPluginManifest });
}

describe('notes plugin operations', () => {
  it('writes, lists, reads, searches, tags, and deletes notes', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const writeResult = (await ops.write(
      {
        title: 'Test Note',
        content: 'Hello world',
        tags: ['Personal', 'test'],
        description: 'Sample description',
      },
      ctx,
    )) as { title?: string; tags?: string[]; description?: string };

    expect(writeResult.title).toBe('Test Note');
    expect(writeResult.tags).toEqual(['personal', 'test']);
    expect(writeResult.description).toBe('Sample description');

    const listResult = (await ops.list({}, ctx)) as Array<{
      title?: string;
      tags?: string[];
      description?: string;
    }>;
    const titles = listResult.map((note) => note.title);
    expect(titles).toContain('Test Note');
    expect(listResult[0]?.description).toBe('Sample description');

    const readResult = (await ops.read({ title: 'Test Note' }, ctx)) as {
      title?: string;
      tags?: string[];
      content?: string;
      description?: string;
    };
    expect(readResult.title).toBe('Test Note');
    expect(readResult.tags).toEqual(['personal', 'test']);
    expect(readResult.content).toBe('Hello world');
    expect(readResult.description).toBe('Sample description');

    const searchResult = (await ops.search({ query: 'hello', limit: 5 }, ctx)) as Array<{
      title?: string;
    }>;
    expect(searchResult.length).toBeGreaterThan(0);
    expect(searchResult[0]?.title).toBe('Test Note');

    const descriptionSearch = (await ops.search({ query: 'sample', limit: 5 }, ctx)) as Array<{
      title?: string;
      description?: string;
    }>;
    expect(descriptionSearch[0]?.title).toBe('Test Note');
    expect(descriptionSearch[0]?.description).toBe('Sample description');

    const afterAdd = (await ops['tags-add']({ title: 'Test Note', tags: ['Extra'] }, ctx)) as {
      tags?: string[];
    };
    expect(afterAdd.tags).toEqual(['personal', 'test', 'extra']);

    const afterRemove = (await ops['tags-remove']({ title: 'Test Note', tags: ['TEST'] }, ctx)) as {
      tags?: string[];
    };
    expect(afterRemove.tags).toEqual(['personal', 'extra']);

    await ops.delete({ title: 'Test Note' }, ctx);

    await expect(ops.read({ title: 'Test Note' }, ctx)).rejects.toThrow(
      'Note not found: Test Note',
    );

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it('filters lists by tags and applies search limits', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.write(
      { title: 'Shopping List', content: 'Buy milk', tags: ['personal', 'shopping'] },
      ctx,
    );
    await ops.write({ title: 'Work Notes', content: 'Quarterly review', tags: ['work'] }, ctx);
    await ops.write(
      { title: 'Personal Journal', content: 'Notes about tools', tags: ['personal'] },
      ctx,
    );

    const listPersonal = (await ops.list({ tags: ['personal'] }, ctx)) as Array<{
      tags?: string[];
    }>;
    expect(listPersonal.length).toBeGreaterThanOrEqual(2);
    for (const note of listPersonal) {
      expect(note.tags).toContain('personal');
    }

    const searchLimited = (await ops.search({ query: 'notes', limit: 1 }, ctx)) as Array<{
      title?: string;
    }>;
    expect(searchLimited.length).toBe(1);

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it('search provider returns note titles for empty query', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.write(
      { title: 'Alpha Note', content: 'First', tags: ['alpha'], description: 'Alpha desc' },
      ctx,
    );
    await ops.write({ title: 'Beta Note', content: 'Second', tags: ['beta'] }, ctx);

    const searchProvider = plugin.searchProvider;
    if (!searchProvider) {
      throw new Error('Expected searchProvider to be defined');
    }

    const results = await searchProvider.search('', { limit: 10 });
    const titles = results.map((result) => result.title);
    expect(titles).toContain('Alpha Note');
    expect(titles).toContain('Beta Note');
    const alphaResult = results.find((result) => result.title === 'Alpha Note');
    expect(alphaResult?.snippet).toBe('Alpha desc');

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it('supports multiple instances and isolates data', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir, {
      enabled: true,
      instances: ['work', 'personal'],
    });

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const instances = (await ops.instance_list({}, ctx)) as Array<{ id?: string }>;
    const ids = instances.map((instance) => instance.id);
    expect(ids).toContain('default');
    expect(ids).toContain('work');
    expect(ids).toContain('personal');

    await ops.write({ instance_id: 'work', title: 'Work Note', content: 'Quarterly review' }, ctx);

    const workNotes = (await ops.list({ instance_id: 'work' }, ctx)) as Array<{ title?: string }>;
    expect(workNotes.map((note) => note.title)).toContain('Work Note');

    const personalNotes = (await ops.list({ instance_id: 'personal' }, ctx)) as Array<{
      title?: string;
    }>;
    expect(personalNotes).toEqual([]);

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it('moves notes between instances', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir, {
      enabled: true,
      instances: ['work', 'personal'],
    });

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.write({ instance_id: 'work', title: 'Move Me', content: 'Hello from work' }, ctx);

    await ops.move({ instance_id: 'work', target_instance_id: 'personal', title: 'Move Me' }, ctx);

    const workNotes = (await ops.list({ instance_id: 'work' }, ctx)) as Array<{ title?: string }>;
    expect(workNotes).toEqual([]);

    const personalNotes = (await ops.list({ instance_id: 'personal' }, ctx)) as Array<{
      title?: string;
    }>;
    expect(personalNotes.map((note) => note.title)).toContain('Move Me');

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it('renames notes within an instance', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.write({ title: 'Old Title', content: 'Hello' }, ctx);

    const renamed = (await ops.rename({ title: 'Old Title', new_title: 'New Title' }, ctx)) as {
      title?: string;
    };
    expect(renamed.title).toBe('New Title');

    const list = (await ops.list({}, ctx)) as Array<{ title?: string }>;
    const titles = list.map((note) => note.title);
    expect(titles).toContain('New Title');
    expect(titles).not.toContain('Old Title');

    await expect(ops.read({ title: 'Old Title' }, ctx)).rejects.toThrow(
      'Note not found: Old Title',
    );

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it('broadcasts panel events for show', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir);

    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const broadcastToAll = vi.fn();
    const ctx: ToolContext = {
      ...createTestContext(),
      sessionHub: { broadcastToAll } as ToolContext['sessionHub'],
    };

    await ops.show({ title: 'Test Note', panelId: 'notes-1' }, ctx);

    expect(broadcastToAll).toHaveBeenCalledTimes(1);
    const [message] = broadcastToAll.mock.calls[0] ?? [];
    expect(message).toMatchObject({
      type: 'panel_event',
      panelId: 'notes-1',
      panelType: 'notes',
      payload: { type: 'notes_show', instance_id: 'default', title: 'Test Note' },
    });

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });

  it('broadcasts notes updates on write and delete', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();
    await plugin.initialize(dataDir);

    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    const broadcastToAll = vi.fn();
    const ctx: ToolContext = {
      ...createTestContext(),
      sessionHub: { broadcastToAll } as ToolContext['sessionHub'],
    };

    await ops.write({ title: 'Change Note', content: 'Hello' }, ctx);
    expect(broadcastToAll).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panel_event',
        panelId: '*',
        panelType: 'notes',
        sessionId: '*',
        payload: expect.objectContaining({
          type: 'panel_update',
          instance_id: 'default',
          title: 'Change Note',
          action: 'note_updated',
          note: expect.objectContaining({ title: 'Change Note' }),
        }),
      }),
    );

    await ops.delete({ title: 'Change Note' }, ctx);
    expect(broadcastToAll).toHaveBeenCalledWith({
      type: 'panel_event',
      panelId: '*',
      panelType: 'notes',
      sessionId: '*',
      payload: {
        type: 'panel_update',
        instance_id: 'default',
        title: 'Change Note',
        action: 'note_deleted',
      },
    });

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
  });
});
