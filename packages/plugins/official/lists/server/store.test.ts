import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { ListsStore } from './store';

const testDataDir = os.tmpdir();

function createTempFilePath(): string {
  return path.join(
    testDataDir,
    `lists-store-test-${Date.now()}-${Math.random().toString(16)}.json`,
  );
}

function createStore(filePath: string): ListsStore {
  return new ListsStore(filePath);
}

describe('ListsStore (plugin)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();

    // Clean up any test files that were created.
    const pattern = /^lists-store-test-/;
    const dir = os.tmpdir();
    const entries = await fs.readdir(dir);
    await Promise.all(
      entries
        .filter((name) => pattern.test(name) && name.endsWith('.json'))
        .map((name) => fs.rm(path.join(dir, name), { force: true })),
    );
  });

  it('creates and retrieves a list', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    const created = await store.createList({
      id: 'reading',
      name: 'Reading List',
      tags: ['personal'],
    });

    expect(created.id).toBe('reading');
    expect(created.name).toBe('Reading List');
    expect(created.tags).toEqual(['personal']);
    expect(created.createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(created.updatedAt).toBe('2024-01-01T00:00:00.000Z');

    const fetched = await store.getList('reading');
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe('reading');
  });

  it('validates list IDs', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await expect(store.createList({ id: 'Invalid ID', name: 'Bad' })).rejects.toThrowError(
      /Invalid list ID/,
    );
  });

  it('prevents duplicate list IDs', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'reading', name: 'Reading' });
    await expect(store.createList({ id: 'reading', name: 'Duplicate' })).rejects.toThrowError(
      /List already exists/,
    );
  });

  it('normalizes tags for lists and items', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    const list = await store.createList({
      id: 'reading',
      name: 'Reading',
      tags: [' Personal ', 'READING', 'personal', ''],
    });

    expect(list.tags).toEqual(['personal', 'reading']);

    const item = await store.addItem({
      listId: 'reading',
      title: 'Item 1',
      tags: [' Work ', 'IMPORTANT', 'work'],
    });

    expect(item.tags).toEqual(['work', 'important']);
  });

  it('filters lists by tags with AND logic', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({
      id: 'reading',
      name: 'Reading',
      tags: ['personal', 'reading'],
    });
    await store.createList({
      id: 'shopping',
      name: 'Shopping',
      tags: ['personal'],
    });

    const all = await store.listLists();
    expect(all.map((list) => list.id).sort()).toEqual(['reading', 'shopping']);

    const filtered = await store.listLists({ tags: ['personal', 'reading'] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('reading');
  });

  it('filters lists by tags case-insensitively and supports tagMatch any', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({
      id: 'reading',
      name: 'Reading',
      tags: ['Personal', 'Reading'],
    });
    await store.createList({
      id: 'shopping',
      name: 'Shopping',
      tags: ['PERSONAL'],
    });

    const byPersonal = await store.listLists({ tags: ['personal'] });
    expect(byPersonal.map((list) => list.id).sort()).toEqual(['reading', 'shopping']);

    const allMatch = await store.listLists({ tags: ['personal', 'reading'] });
    expect(allMatch.map((list) => list.id)).toEqual(['reading']);

    const anyMatch = await store.listLists({ tags: ['personal', 'reading'], tagMatch: 'any' });
    expect(anyMatch.map((list) => list.id).sort()).toEqual(['reading', 'shopping']);
  });

  it('updates list metadata and clears description', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await store.createList({
      id: 'reading',
      name: 'Reading',
      description: 'Initial description',
      tags: ['personal'],
    });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    const updated = await store.updateList({
      id: 'reading',
      name: 'Updated Reading',
      description: '',
      tags: ['updated'],
    });

    expect(updated.name).toBe('Updated Reading');
    expect(updated.description).toBeUndefined();
    expect(updated.tags).toEqual(['updated']);
    expect(updated.updatedAt).toBe('2024-01-02T00:00:00.000Z');
  });

  it('deletes a list and its items', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'reading', name: 'Reading' });
    await store.addItem({ listId: 'reading', title: 'Item 1' });
    await store.addItem({ listId: 'reading', title: 'Item 2' });

    await store.deleteList('reading');

    const list = await store.getList('reading');
    expect(list).toBeUndefined();

    const items = await store.listItems({ listId: 'reading' });
    expect(items).toHaveLength(0);
  });

  it('refuses to add items to non-existent lists', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await expect(store.addItem({ listId: 'missing', title: 'Item' })).rejects.toThrowError(
      /List not found/,
    );
  });

  it('adds, updates, moves, and removes items while touching updatedAt', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await store.createList({ id: 'reading', name: 'Reading' });
    await store.createList({ id: 'shopping', name: 'Shopping' });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    const item = await store.addItem({
      listId: 'reading',
      title: 'Item 1',
      url: 'https://example.com',
      notes: 'Notes',
    });
    expect(item.updatedAt).toBe('2024-01-02T00:00:00.000Z');

    let readingList = await store.getList('reading');
    expect(readingList?.updatedAt).toBe('2024-01-02T00:00:00.000Z');

    vi.setSystemTime(new Date('2024-01-03T00:00:00.000Z'));
    const updatedItem = await store.updateItem({
      id: item.id,
      url: '',
      notes: 'Updated notes',
    });
    expect(updatedItem.url).toBeUndefined();
    expect(updatedItem.notes).toBe('Updated notes');
    expect(updatedItem.updatedAt).toBe('2024-01-03T00:00:00.000Z');

    readingList = await store.getList('reading');
    expect(readingList?.updatedAt).toBe('2024-01-03T00:00:00.000Z');

    vi.setSystemTime(new Date('2024-01-04T00:00:00.000Z'));
    const moved = await store.moveItem(item.id, 'shopping');
    expect(moved.listId).toBe('shopping');
    expect(moved.updatedAt).toBe('2024-01-04T00:00:00.000Z');

    const updatedReading = await store.getList('reading');
    const updatedShopping = await store.getList('shopping');
    expect(updatedReading?.updatedAt).toBe('2024-01-04T00:00:00.000Z');
    expect(updatedShopping?.updatedAt).toBe('2024-01-04T00:00:00.000Z');

    vi.setSystemTime(new Date('2024-01-05T00:00:00.000Z'));
    await store.removeItem(item.id);

    const shoppingList = await store.getList('shopping');
    expect(shoppingList?.updatedAt).toBe('2024-01-05T00:00:00.000Z');
  });

  it('copies items to another list while preserving fields', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));
    await store.createList({ id: 'reading', name: 'Reading' });
    await store.createList({ id: 'shopping', name: 'Shopping' });

    const original = await store.addItem({
      listId: 'reading',
      title: 'Paper',
      url: 'https://example.com',
      notes: 'Pick recycled',
      tags: ['Office', 'Supplies'],
      customFields: { priority: 'High', estimate: 2 },
    });

    await store.updateItem({ id: original.id, completed: true });

    vi.setSystemTime(new Date('2024-02-02T00:00:00.000Z'));
    const copied = await store.copyItem({
      id: original.id,
      sourceListId: 'reading',
      targetListId: 'shopping',
    });

    expect(copied.id).not.toBe(original.id);
    expect(copied.listId).toBe('shopping');
    expect(copied.title).toBe(original.title);
    expect(copied.url).toBe(original.url);
    expect(copied.notes).toBe(original.notes);
    expect(copied.tags).toEqual(original.tags);
    expect(copied.customFields).toEqual(original.customFields);
    expect(copied.completed).toBe(true);
    expect(copied.completedAt).toBeDefined();
    expect(copied.updatedAt).toBe('2024-02-02T00:00:00.000Z');

    const stillOriginal = await store.getItem(original.id);
    expect(stillOriginal?.listId).toBe('reading');

    const shoppingList = await store.getList('shopping');
    expect(shoppingList?.updatedAt).toBe('2024-02-02T00:00:00.000Z');
  });

  it('touches items without changing updatedAt', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    vi.setSystemTime(new Date('2024-03-01T00:00:00.000Z'));
    await store.createList({ id: 'reading', name: 'Reading' });
    const item = await store.addItem({ listId: 'reading', title: 'Touch me' });
    expect(item.updatedAt).toBe('2024-03-01T00:00:00.000Z');

    vi.setSystemTime(new Date('2024-03-05T00:00:00.000Z'));
    await store.updateItem({ id: item.id, notes: 'Updated' });

    vi.setSystemTime(new Date('2024-03-10T00:00:00.000Z'));
    const touched = await store.touchItem(item.id);
    expect(touched.touchedAt).toBe('2024-03-10T00:00:00.000Z');
    expect(touched.updatedAt).toBe('2024-03-05T00:00:00.000Z');
  });

  it('clears touchedAt without changing updatedAt', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    vi.setSystemTime(new Date('2024-03-01T00:00:00.000Z'));
    await store.createList({ id: 'reading', name: 'Reading' });
    const item = await store.addItem({ listId: 'reading', title: 'Touch me' });

    vi.setSystemTime(new Date('2024-03-05T00:00:00.000Z'));
    await store.updateItem({ id: item.id, notes: 'Updated' });

    vi.setSystemTime(new Date('2024-03-10T00:00:00.000Z'));
    await store.touchItem(item.id);

    vi.setSystemTime(new Date('2024-03-15T00:00:00.000Z'));
    const cleared = await store.updateItem({ id: item.id, touchedAt: null });
    expect(cleared.touchedAt).toBeUndefined();
    expect(cleared.updatedAt).toBe('2024-03-05T00:00:00.000Z');

    const list = await store.getList('reading');
    expect(list?.updatedAt).toBe('2024-03-05T00:00:00.000Z');
  });

  it('lists items with sorting and limits', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await store.createList({ id: 'reading', name: 'Reading' });

    vi.setSystemTime(new Date('2024-01-02T00:00:00.000Z'));
    const first = await store.addItem({
      listId: 'reading',
      title: 'First',
    });

    vi.setSystemTime(new Date('2024-01-03T00:00:00.000Z'));
    const second = await store.addItem({
      listId: 'reading',
      title: 'Second',
    });

    const defaultOrder = await store.listItems({ listId: 'reading' });
    expect(defaultOrder.map((item) => item.id)).toEqual([first.id, second.id]);
    expect(defaultOrder.map((item) => item.position)).toEqual([0, 1]);

    const newestFirst = await store.listItems({ listId: 'reading', sort: 'newest' });
    expect(newestFirst.map((item) => item.id)).toEqual([second.id, first.id]);

    const oldestFirst = await store.listItems({ listId: 'reading', sort: 'oldest' });
    expect(oldestFirst.map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it('filters items by tags with AND and ANY logic', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'reading', name: 'Reading' });

    await store.addItem({
      listId: 'reading',
      title: 'First',
      tags: ['personal', 'reading'],
    });
    await store.addItem({
      listId: 'reading',
      title: 'Second',
      tags: ['personal'],
    });

    const all = await store.listItems({ listId: 'reading' });
    expect(all.map((item) => item.title).sort()).toEqual(['First', 'Second']);

    const andMatch = await store.listItems({
      listId: 'reading',
      tags: ['personal', 'reading'],
    });
    expect(andMatch.map((item) => item.title)).toEqual(['First']);

    const anyMatch = await store.listItems({
      listId: 'reading',
      tags: ['personal', 'reading'],
      tagMatch: 'any',
    });
    expect(anyMatch.map((item) => item.title).sort()).toEqual(['First', 'Second']);
  });

  it('searches items by text and tags', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'reading', name: 'Reading' });

    await store.addItem({
      listId: 'reading',
      title: 'First Item',
      notes: 'Buy milk',
      tags: ['shopping', 'DAIRY'],
    });
    await store.addItem({
      listId: 'reading',
      title: 'Second Item',
      notes: 'Other notes',
      tags: ['other'],
    });

    const searchByText = await store.searchItems({ query: 'milk' });
    expect(searchByText.map((item) => item.title)).toEqual(['First Item']);

    const searchByTextAndTags = await store.searchItems({
      query: 'milk',
      tags: ['dairy'],
    });
    expect(searchByTextAndTags.map((item) => item.title)).toEqual(['First Item']);

    const searchScopedToList = await store.searchItems({
      query: 'milk',
      listId: 'reading',
      tags: ['shopping'],
      tagMatch: 'all',
    });
    expect(searchScopedToList.map((item) => item.title)).toEqual(['First Item']);
  });

  it('finds items by title (case-insensitive)', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'shopping', name: 'Shopping' });
    await store.createList({ id: 'reading', name: 'Reading' });

    const milkItem = await store.addItem({
      listId: 'shopping',
      title: 'Buy Milk',
    });
    await store.addItem({
      listId: 'reading',
      title: 'Read Book',
    });

    // Exact match
    const found = await store.findItemByTitle('shopping', 'Buy Milk');
    expect(found).toBeDefined();
    expect(found?.id).toBe(milkItem.id);
    expect(found?.title).toBe('Buy Milk');

    // Case-insensitive match
    const foundLower = await store.findItemByTitle('shopping', 'buy milk');
    expect(foundLower).toBeDefined();
    expect(foundLower?.id).toBe(milkItem.id);

    // Match with extra whitespace
    const foundTrimmed = await store.findItemByTitle('shopping', '  Buy Milk  ');
    expect(foundTrimmed).toBeDefined();
    expect(foundTrimmed?.id).toBe(milkItem.id);

    // Not found in wrong list
    const notFoundWrongList = await store.findItemByTitle('reading', 'Buy Milk');
    expect(notFoundWrongList).toBeUndefined();

    // Not found with non-existent title
    const notFoundBadTitle = await store.findItemByTitle('shopping', 'Non-existent');
    expect(notFoundBadTitle).toBeUndefined();
  });

  it('toggles item completion status', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'tasks', name: 'Tasks' });

    vi.setSystemTime(new Date('2024-01-01T10:00:00.000Z'));
    const item = await store.addItem({
      listId: 'tasks',
      title: 'Do laundry',
    });

    expect(item.completed).toBeUndefined();
    expect(item.completedAt).toBeUndefined();

    // Mark as completed
    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
    const completed = await store.updateItem({
      id: item.id,
      completed: true,
    });

    expect(completed.completed).toBe(true);
    expect(completed.completedAt).toBe('2024-01-01T12:00:00.000Z');

    // Mark as incomplete
    vi.setSystemTime(new Date('2024-01-01T14:00:00.000Z'));
    const uncompleted = await store.updateItem({
      id: item.id,
      completed: false,
    });

    expect(uncompleted.completed).toBeUndefined();
    expect(uncompleted.completedAt).toBeUndefined();
  });

  it('persists completion status across store reloads', async () => {
    const filePath = createTempFilePath();
    const store1 = createStore(filePath);

    await store1.createList({ id: 'tasks', name: 'Tasks' });

    vi.setSystemTime(new Date('2024-01-01T10:00:00.000Z'));
    const item = await store1.addItem({
      listId: 'tasks',
      title: 'Do laundry',
    });

    vi.setSystemTime(new Date('2024-01-01T12:00:00.000Z'));
    await store1.updateItem({
      id: item.id,
      completed: true,
    });

    // Load data in a new store instance
    const store2 = createStore(filePath);
    const loadedItem = await store2.getItem(item.id);

    expect(loadedItem).toBeDefined();
    expect(loadedItem?.completed).toBe(true);
    expect(loadedItem?.completedAt).toBe('2024-01-01T12:00:00.000Z');
  });
});

describe('customFields merge behavior', () => {
  it('merges custom fields instead of replacing', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'tasks', name: 'Tasks' });

    const item = await store.addItem({
      listId: 'tasks',
      title: 'Test item',
      customFields: { priority: 'high', duration: 30 },
    });

    expect(item.customFields).toEqual({ priority: 'high', duration: 30 });

    // Update only duration - priority should be preserved
    const updated = await store.updateItem({
      id: item.id,
      customFields: { duration: 60 },
    });

    expect(updated.customFields).toEqual({ priority: 'high', duration: 60 });
  });

  it('removes individual field with null value', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'tasks', name: 'Tasks' });

    const item = await store.addItem({
      listId: 'tasks',
      title: 'Test item',
      customFields: { priority: 'high', duration: 30, status: 'pending' },
    });

    // Remove duration, keep others
    const updated = await store.updateItem({
      id: item.id,
      customFields: { duration: null },
    });

    expect(updated.customFields).toEqual({ priority: 'high', status: 'pending' });
  });

  it('clears all custom fields with null', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'tasks', name: 'Tasks' });

    const item = await store.addItem({
      listId: 'tasks',
      title: 'Test item',
      customFields: { priority: 'high', duration: 30 },
    });

    // Clear all custom fields
    const updated = await store.updateItem({
      id: item.id,
      customFields: null,
    });

    expect(updated.customFields).toBeUndefined();
  });

  it('adds new fields to item without existing custom fields', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'tasks', name: 'Tasks' });

    const item = await store.addItem({
      listId: 'tasks',
      title: 'Test item',
    });

    expect(item.customFields).toBeUndefined();

    const updated = await store.updateItem({
      id: item.id,
      customFields: { priority: 'high' },
    });

    expect(updated.customFields).toEqual({ priority: 'high' });
  });

  it('filters out null values when adding items', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'tasks', name: 'Tasks' });

    // When adding an item with null custom field values (e.g., from edit dialog clearing fields),
    // the null values should be filtered out and not stored
    const item = await store.addItem({
      listId: 'tasks',
      title: 'Test item',
      customFields: { priority: 'high', duration: null, status: null },
    });

    // Only non-null values should be stored
    expect(item.customFields).toEqual({ priority: 'high' });
  });

  it('omits customFields entirely when all values are null', async () => {
    const filePath = createTempFilePath();
    const store = createStore(filePath);

    await store.createList({ id: 'tasks', name: 'Tasks' });

    // When all custom field values are null, customFields should not be set
    const item = await store.addItem({
      listId: 'tasks',
      title: 'Test item',
      customFields: { priority: null, duration: null },
    });

    expect(item.customFields).toBeUndefined();
  });

  it('exports and replaces lists with items', async () => {
    const sourcePath = createTempFilePath();
    const targetPath = createTempFilePath();
    const source = createStore(sourcePath);
    const target = createStore(targetPath);

    vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));
    await source.createList({
      id: 'alpha',
      name: 'Alpha',
      tags: ['Work'],
      defaultTags: ['base'],
    });

    const item = await source.addItem({
      listId: 'alpha',
      title: 'Task',
      notes: 'details',
      tags: ['Urgent'],
      customFields: { priority: 'high' },
    });

    await source.updateItem({
      id: item.id,
      completed: true,
      touchedAt: '2024-02-02T00:00:00.000Z',
    });

    const snapshot = await source.getListWithItems('alpha');
    await target.replaceListWithItems({ list: snapshot.list, items: snapshot.items });

    const list = await target.getList('alpha');
    expect(list?.name).toBe('Alpha');
    expect(list?.tags).toEqual(['work']);
    expect(list?.defaultTags).toEqual(['base']);

    const items = await target.listItems({ listId: 'alpha', limit: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Task');
    expect(items[0]?.tags.sort()).toEqual(['base', 'urgent'].sort());
    expect(items[0]?.completed).toBe(true);
    expect(items[0]?.touchedAt).toBe('2024-02-02T00:00:00.000Z');
    expect(items[0]?.customFields).toEqual({ priority: 'high' });
  });
});
