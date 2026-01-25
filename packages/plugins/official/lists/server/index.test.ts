import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../../../../agent-server/src/tools';
import manifestJson from '../manifest.json';
import { createPlugin } from './index';
import type { ListDefinition, ListItem } from './types';

function createTempDataDir(): string {
  return path.join(os.tmpdir(), `lists-plugin-test-${Date.now()}-${Math.random().toString(16)}`);
}

function createTestContext(): ToolContext {
  return {
    sessionId: 'session-1',
    signal: new AbortController().signal,
  };
}

function createTestPlugin() {
  return createPlugin({ manifest: manifestJson as CombinedPluginManifest });
}

describe('lists plugin operations', () => {
  it('manages lists and items', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();

    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    // Lists: create, list, update, get, delete
    const created = (await ops.create(
      {
        id: 'reading',
        name: 'Reading List',
        tags: ['personal'],
      },
      ctx,
    )) as ListDefinition;
    expect(created.id).toBe('reading');
    expect(created.name).toBe('Reading List');
    expect(created.tags).toEqual(['personal']);

    const allLists = (await ops.list({}, ctx)) as ListDefinition[];
    expect(allLists.map((list) => list.id)).toContain('reading');

    const filteredLists = (await ops.list(
      {
        tags: ['PERSONAL'],
        tagMatch: 'all',
      },
      ctx,
    )) as ListDefinition[];
    expect(filteredLists.map((list) => list.id)).toEqual(['reading']);

    const updatedList = (await ops.update(
      {
        id: 'reading',
        name: 'Updated Reading',
        description: 'Updated description',
        tags: ['updated'],
      },
      ctx,
    )) as ListDefinition;
    expect(updatedList.name).toBe('Updated Reading');
    expect(updatedList.description).toBe('Updated description');
    expect(updatedList.tags).toEqual(['updated']);

    const fetchedList = (await ops.get({ id: 'reading' }, ctx)) as ListDefinition;
    expect(fetchedList.id).toBe('reading');

    // Items: add, list, search, get, update, move, remove
    await ops.create({ id: 'shopping', name: 'Shopping' }, ctx);

    const firstItem = (await ops['item-add'](
      {
        listId: 'reading',
        title: 'First Item',
        notes: 'Buy milk',
        tags: ['shopping', 'DAIRY'],
      },
      ctx,
    )) as ListItem;
    expect(firstItem.id).toBeDefined();
    expect(firstItem.tags).toEqual(['shopping', 'dairy']);

    const secondItem = (await ops['item-add'](
      {
        listId: 'reading',
        title: 'Second Item',
        url: 'https://example.com',
        tags: ['other'],
        customFields: { priority: 'High' },
      },
      ctx,
    )) as ListItem;
    expect(secondItem.id).toBeDefined();

    await ops['item-update'](
      {
        id: secondItem.id,
        listId: 'reading',
        completed: true,
      },
      ctx,
    );

    const listedItems = (await ops['items-list'](
      {
        listId: 'reading',
        limit: 1,
        sort: 'position',
      },
      ctx,
    )) as ListItem[];
    expect(listedItems).toHaveLength(1);

    const listByTag = (await ops['items-list'](
      {
        listId: 'reading',
        tags: ['shopping'],
        tagMatch: 'all',
      },
      ctx,
    )) as ListItem[];
    expect(listByTag.map((item) => item.title)).toEqual(['First Item']);

    const searchItems = (await ops['items-search']({ query: 'milk' }, ctx)) as ListItem[];
    expect(searchItems.length).toBe(1);
    expect(searchItems[0]?.title).toBe('First Item');

    const searchWithTags = (await ops['items-search'](
      {
        query: 'milk',
        tags: ['DAIRY'],
        tagMatch: 'all',
      },
      ctx,
    )) as ListItem[];
    expect(searchWithTags.length).toBe(1);
    expect(searchWithTags[0]?.title).toBe('First Item');

    const fetchedItem = (await ops['item-get'](
      {
        id: firstItem.id,
        listId: 'reading',
      },
      ctx,
    )) as ListItem;
    expect(fetchedItem.id).toBe(firstItem.id);

    const updatedItem = (await ops['item-update'](
      {
        id: firstItem.id,
        listId: 'reading',
        url: '',
        notes: 'Updated notes',
        tags: ['updated'],
      },
      ctx,
    )) as ListItem;
    expect(updatedItem.id).toBe(firstItem.id);
    expect(updatedItem.url).toBeUndefined();
    expect(updatedItem.notes).toBe('Updated notes');
    expect(updatedItem.tags).toEqual(['updated']);

    const touchedItem = (await ops['item-touch'](
      {
        id: firstItem.id,
        listId: 'reading',
      },
      ctx,
    )) as ListItem;
    expect(typeof touchedItem.touchedAt).toBe('string');

    const clearedTouch = (await ops['item-update'](
      {
        id: firstItem.id,
        listId: 'reading',
        touchedAt: null,
      },
      ctx,
    )) as ListItem;
    expect(clearedTouch.touchedAt).toBeUndefined();

    const nullClearItem = (await ops['item-add'](
      {
        listId: 'reading',
        title: 'Null Clear Item',
        url: 'https://example.com',
        notes: 'Some notes',
        tags: ['one', 'two'],
        customFields: { time: '10m', duration: '30m' },
      },
      ctx,
    )) as ListItem;
    await ops['item-update'](
      {
        id: nullClearItem.id,
        listId: 'reading',
        completed: true,
      },
      ctx,
    );
    const nullCleared = (await ops['item-update'](
      {
        id: nullClearItem.id,
        listId: 'reading',
        url: null,
        notes: null,
        tags: null,
        completed: null,
        customFields: { time: null },
      },
      ctx,
    )) as ListItem;
    expect(nullCleared.url).toBeUndefined();
    expect(nullCleared.notes).toBeUndefined();
    expect(nullCleared.tags).toEqual([]);
    expect(nullCleared.completed).toBeUndefined();
    expect(nullCleared.customFields).toEqual({ duration: '30m' });

    const bulkFieldItem = (await ops['item-add'](
      {
        listId: 'reading',
        title: 'Bulk Field Item',
        customFields: { time: '5m', duration: '15m' },
      },
      ctx,
    )) as ListItem;
    await ops['items-bulk-update-fields'](
      {
        listId: 'reading',
        updates: [{ id: bulkFieldItem.id, customFields: { time: null } }],
      },
      ctx,
    );
    const bulkUpdated = (await ops['item-get'](
      {
        id: bulkFieldItem.id,
        listId: 'reading',
      },
      ctx,
    )) as ListItem;
    expect(bulkUpdated.customFields).toEqual({ duration: '15m' });

    await ops['items-bulk-update-fields'](
      {
        listId: 'reading',
        updates: [{ id: bulkFieldItem.id, customFields: null }],
      },
      ctx,
    );
    const bulkCleared = (await ops['item-get'](
      {
        id: bulkFieldItem.id,
        listId: 'reading',
      },
      ctx,
    )) as ListItem;
    expect(bulkCleared.customFields).toBeUndefined();

    const tagsAdded = (await ops['item-tags-add'](
      {
        id: firstItem.id,
        listId: 'reading',
        tags: ['Extra', 'extra'],
      },
      ctx,
    )) as ListItem;
    expect(tagsAdded.tags).toEqual(['updated', 'extra']);

    const tagsRemoved = (await ops['item-tags-remove'](
      {
        id: firstItem.id,
        listId: 'reading',
        tags: ['UPDATED'],
      },
      ctx,
    )) as ListItem;
    expect(tagsRemoved.tags).toEqual(['extra']);

    const thirdItem = (await ops['item-add'](
      {
        listId: 'reading',
        title: 'Third Item',
      },
      ctx,
    )) as ListItem;
    expect(thirdItem.id).toBeDefined();

    const bulkCopyResult = (await ops['items-bulk-copy'](
      {
        sourceListId: 'reading',
        targetListId: 'shopping',
        items: [{ id: firstItem.id }, { id: thirdItem.id }],
      },
      ctx,
    )) as {
      results: Array<{ index: number; itemId?: string; copiedItemId?: string; ok: boolean }>;
    };
    expect(bulkCopyResult.results).toHaveLength(2);
    expect(bulkCopyResult.results.filter((entry) => entry.ok)).toHaveLength(2);

    const copiedItem = (await ops['item-copy'](
      {
        id: secondItem.id,
        sourceListId: 'reading',
        targetListId: 'shopping',
      },
      ctx,
    )) as ListItem;
    expect(copiedItem.id).not.toBe(secondItem.id);
    expect(copiedItem.listId).toBe('shopping');
    expect(copiedItem.title).toBe(secondItem.title);
    expect(copiedItem.url).toBe(secondItem.url);
    expect(copiedItem.tags).toEqual(secondItem.tags);
    expect(copiedItem.customFields).toEqual(secondItem.customFields);
    expect(copiedItem.completed).toBe(true);

    const movedItem = (await ops['item-move'](
      {
        id: firstItem.id,
        targetListId: 'shopping',
      },
      ctx,
    )) as ListItem;
    expect(movedItem.id).toBe(firstItem.id);
    expect(movedItem.listId).toBe('shopping');

    const removeResult = (await ops['item-remove'](
      { id: firstItem.id, listId: 'shopping' },
      ctx,
    )) as { ok: boolean };
    expect(removeResult.ok).toBe(true);

    await expect(ops['item-get']({ id: firstItem.id, listId: 'shopping' }, ctx)).rejects.toThrow(
      /Item not found in list/,
    );

    const broadcastToAll = vi.fn();
    const showCtx: ToolContext = {
      ...ctx,
      sessionHub: { broadcastToAll } as ToolContext['sessionHub'],
    };
    const showResult = (await ops.show({ id: 'reading', panelId: 'lists-1' }, showCtx)) as {
      ok: true;
      panelId: string;
    };
    expect(showResult).toEqual({ ok: true, panelId: 'lists-1' });
    expect(broadcastToAll).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panel_event',
        panelId: 'lists-1',
        panelType: 'lists',
        payload: { type: 'lists_show', instance_id: 'default', listId: 'reading' },
      }),
    );

    await expect(ops.show({ id: 'nonexistent', panelId: 'lists-1' }, showCtx)).rejects.toThrow(
      /List not found: nonexistent/,
    );

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('search provider returns list and item matches', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();

    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.create(
      {
        id: 'reading',
        name: 'Reading List',
        description: 'Books to read soon',
      },
      ctx,
    );

    const item = (await ops['item-add'](
      {
        listId: 'reading',
        title: 'Reading Dune',
      },
      ctx,
    )) as ListItem;

    const searchProvider = plugin.searchProvider;
    if (!searchProvider) {
      throw new Error('Expected searchProvider to be defined');
    }

    const results = await searchProvider.search('reading', { limit: 10 });
    const listResult = results.find((result) => result.id === 'list:reading');
    expect(listResult?.title).toBe('Reading List');
    expect(listResult?.launch.payload).toMatchObject({
      type: 'lists_show',
      listId: 'reading',
    });

    const itemResult = results.find((result) => result.id === item.id);
    expect(itemResult?.subtitle).toBe('Reading List');
    expect(itemResult?.launch.payload).toMatchObject({
      type: 'lists_show',
      listId: 'reading',
      itemId: item.id,
    });
  });

  it('search provider returns list titles for empty query', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();

    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.create(
      {
        id: 'reading',
        name: 'Reading List',
        description: 'Books to read soon',
      },
      ctx,
    );

    const item = (await ops['item-add'](
      {
        listId: 'reading',
        title: 'Reading Dune',
      },
      ctx,
    )) as ListItem;

    const searchProvider = plugin.searchProvider;
    if (!searchProvider) {
      throw new Error('Expected searchProvider to be defined');
    }

    const results = await searchProvider.search('', { limit: 10 });
    const listResult = results.find((result) => result.id === 'list:reading');
    expect(listResult?.title).toBe('Reading List');

    const itemResult = results.find((result) => result.id === item.id);
    expect(itemResult).toBeUndefined();
  });

  it('manages saved AQL queries', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();

    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.create({ id: 'work', name: 'Work' }, ctx);

    const saved = (await ops['aql-query-save'](
      {
        listId: 'work',
        name: 'Ready',
        query: 'status = "Ready"',
        makeDefault: true,
      },
      ctx,
    )) as Array<{ id: string; name: string; isDefault?: boolean }>;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.isDefault).toBe(true);

    const listed = (await ops['aql-query-list']({ listId: 'work' }, ctx)) as Array<{
      id: string;
      name: string;
    }>;
    expect(listed.map((entry) => entry.name)).toEqual(['Ready']);

    const cleared = (await ops['aql-query-default']({ listId: 'work' }, ctx)) as Array<{
      id: string;
      isDefault?: boolean;
    }>;
    expect(cleared.some((entry) => entry.isDefault)).toBe(false);

    const afterDelete = (await ops['aql-query-delete'](
      { listId: 'work', id: saved[0]!.id },
      ctx,
    )) as Array<{ id: string }>;
    expect(afterDelete).toHaveLength(0);
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

    await ops.create({ instance_id: 'work', id: 'work-list', name: 'Work' }, ctx);

    const workLists = (await ops.list({ instance_id: 'work' }, ctx)) as ListDefinition[];
    expect(workLists.map((list) => list.id)).toContain('work-list');

    const personalLists = (await ops.list({ instance_id: 'personal' }, ctx)) as ListDefinition[];
    expect(personalLists).toEqual([]);

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('stores data under the default instance directory', async () => {
    const dataDir = createTempDataDir();
    const plugin = createTestPlugin();

    await plugin.initialize(dataDir);

    const ctx = createTestContext();
    const ops = plugin.operations;
    if (!ops) {
      throw new Error('Expected operations to be defined');
    }

    await ops.create({ id: 'daily', name: 'Daily' }, ctx);

    const defaultPath = path.join(dataDir, 'default', 'lists.json');
    await expect(fs.stat(defaultPath)).resolves.toBeDefined();

    const legacyPath = path.join(dataDir, 'lists.json');
    await expect(fs.stat(legacyPath)).rejects.toThrow(/ENOENT/);

    if (plugin.shutdown) {
      await plugin.shutdown();
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});
