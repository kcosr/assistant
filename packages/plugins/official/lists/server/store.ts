import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

import { matchesTags, normalizeTags } from '@assistant/shared';

import type { ListCustomFieldDefinition, ListDefinition, ListItem, ListsData } from './types';
import { repositionItem, reflowPositions } from './positions';

const LIST_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ItemSortOrder = 'position' | 'newest' | 'oldest';
type TagMatchMode = 'all' | 'any';

export class ListsStore {
  private readonly filePath: string;
  private data: ListsData = { lists: [], items: [] };
  private loaded = false;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private normalizeTags(tags: string[] | undefined): string[] {
    return normalizeTags(tags);
  }

  private matchesTags(
    valueTags: string[] | undefined,
    filterTags: string[] | undefined,
    tagMatch: TagMatchMode | undefined,
  ): boolean {
    return matchesTags({
      ...(valueTags ? { valueTags } : {}),
      ...(filterTags ? { filterTags } : {}),
      ...(tagMatch ? { tagMatch } : {}),
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(content) as ListsData;
      if (parsed && Array.isArray(parsed.lists) && Array.isArray(parsed.items)) {
        this.data = parsed;
        // Normalize tags on load so existing data gets consistent casing and structure.
        this.data.lists.forEach((list) => {
          list.tags = this.normalizeTags(list.tags);
          list.defaultTags = this.normalizeTags(list.defaultTags);
        });
        this.data.items.forEach((item) => {
          item.tags = this.normalizeTags(item.tags);
          if (typeof item.updatedAt !== 'string' || !item.updatedAt.trim()) {
            item.updatedAt = item.addedAt ?? new Date().toISOString();
          }
          if (item.touchedAt !== undefined) {
            if (typeof item.touchedAt !== 'string' || !item.touchedAt.trim()) {
              delete item.touchedAt;
            }
          }
        });
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw err;
      }
      // File doesn't exist, start with empty data
    }
  }

  private async save(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private validateListId(id: string): void {
    if (!LIST_ID_PATTERN.test(id)) {
      throw new Error(`Invalid list ID: ${id}. Must be lowercase alphanumeric with hyphens.`);
    }
  }

  private touchList(listId: string, timestamp?: string): void {
    const list = this.data.lists.find((l) => l.id === listId);
    if (!list) {
      return;
    }
    list.updatedAt = timestamp ?? new Date().toISOString();
  }

  private reflowPositions(listId: string): void {
    reflowPositions(this.data.items, listId);
  }

  private repositionItem(listId: string, itemId: string, position?: number): void {
    repositionItem(this.data.items, listId, itemId, position);
  }

  // List operations

  async createList(params: {
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    defaultTags?: string[];
    customFields?: ListCustomFieldDefinition[];
  }): Promise<ListDefinition> {
    await this.ensureLoaded();

    this.validateListId(params.id);

    const existing = this.data.lists.find((l) => l.id === params.id);
    if (existing) {
      throw new Error(`List already exists: ${params.id}`);
    }

    const now = new Date().toISOString();
    const list: ListDefinition = {
      id: params.id,
      name: params.name,
      tags: this.normalizeTags(params.tags),
      defaultTags: this.normalizeTags(params.defaultTags),
      ...(params.customFields ? { customFields: params.customFields } : {}),
      createdAt: now,
      updatedAt: now,
      ...(params.description ? { description: params.description } : {}),
    };

    this.data.lists.push(list);
    await this.save();
    return list;
  }

  async getList(id: string): Promise<ListDefinition | undefined> {
    await this.ensureLoaded();
    return this.data.lists.find((l) => l.id === id);
  }

  async listLists(params?: {
    tags?: string[];
    tagMatch?: TagMatchMode;
  }): Promise<ListDefinition[]> {
    await this.ensureLoaded();

    let lists = [...this.data.lists];

    if (params?.tags && params.tags.length > 0) {
      lists = lists.filter((list) => this.matchesTags(list.tags, params.tags, params.tagMatch));
    }

    return lists;
  }

  async updateList(params: {
    id: string;
    name?: string;
    description?: string;
    tags?: string[];
    defaultTags?: string[];
    customFields?: ListCustomFieldDefinition[] | null;
  }): Promise<ListDefinition> {
    await this.ensureLoaded();

    const list = this.data.lists.find((l) => l.id === params.id);
    if (!list) {
      throw new Error(`List not found: ${params.id}`);
    }

    if (params.name !== undefined) {
      list.name = params.name;
    }

    if (params.description !== undefined) {
      if (params.description === '') {
        delete list.description;
      } else {
        list.description = params.description;
      }
    }

    if (params.tags !== undefined) {
      list.tags = this.normalizeTags(params.tags);
    }

    if (params.defaultTags !== undefined) {
      list.defaultTags = this.normalizeTags(params.defaultTags);
    }

    if (params.customFields !== undefined) {
      if (params.customFields === null) {
        delete list.customFields;
      } else {
        list.customFields = params.customFields;
      }
    }

    list.updatedAt = new Date().toISOString();
    await this.save();
    return list;
  }

  async deleteList(id: string): Promise<void> {
    await this.ensureLoaded();

    const index = this.data.lists.findIndex((l) => l.id === id);
    if (index === -1) {
      throw new Error(`List not found: ${id}`);
    }

    this.data.lists.splice(index, 1);
    this.data.items = this.data.items.filter((item) => item.listId !== id);
    await this.save();
  }

  // Item operations

  async addItem(params: {
    listId: string;
    title: string;
    url?: string;
    notes?: string;
    tags?: string[];
    position?: number;
    customFields?: Record<string, unknown>;
  }): Promise<ListItem> {
    await this.ensureLoaded();

    const list = this.data.lists.find((l) => l.id === params.listId);
    if (!list) {
      throw new Error(`List not found: ${params.listId}`);
    }

    const now = new Date().toISOString();
    const defaultTags = this.normalizeTags(list.defaultTags);
    const itemTags = this.normalizeTags(params.tags);
    const combinedTags = this.normalizeTags([...defaultTags, ...itemTags]);
    const item: ListItem = {
      id: randomUUID(),
      listId: params.listId,
      title: params.title,
      ...(params.url ? { url: params.url } : {}),
      ...(params.notes ? { notes: params.notes } : {}),
      tags: combinedTags,
      addedAt: now,
      updatedAt: now,
      ...(params.customFields ? { customFields: params.customFields } : {}),
      position: 0,
    };

    this.data.items.push(item);
    this.repositionItem(params.listId, item.id, params.position);
    this.touchList(params.listId, now);
    await this.save();
    return item;
  }

  async getItem(id: string): Promise<ListItem | undefined> {
    await this.ensureLoaded();
    return this.data.items.find((i) => i.id === id);
  }

  async findItemByTitle(listId: string, title: string): Promise<ListItem | undefined> {
    await this.ensureLoaded();
    const normalizedTitle = title.trim().toLowerCase();
    return this.data.items.find(
      (i) => i.listId === listId && i.title.trim().toLowerCase() === normalizedTitle,
    );
  }

  async updateItem(params: {
    id: string;
    title?: string;
    url?: string;
    notes?: string;
    tags?: string[];
    position?: number;
    completed?: boolean;
    customFields?: Record<string, unknown> | null;
    touchedAt?: string | null;
  }): Promise<ListItem> {
    await this.ensureLoaded();

    const item = this.data.items.find((i) => i.id === params.id);
    if (!item) {
      throw new Error(`Item not found: ${params.id}`);
    }

    const now = new Date().toISOString();
    let updatedContent = false;

    if (params.title !== undefined) {
      item.title = params.title;
      updatedContent = true;
    }

    if (params.url !== undefined) {
      if (params.url === '') {
        delete item.url;
      } else {
        item.url = params.url;
      }
      updatedContent = true;
    }

    if (params.notes !== undefined) {
      if (params.notes === '') {
        delete item.notes;
      } else {
        item.notes = params.notes;
      }
      updatedContent = true;
    }

    if (params.tags !== undefined) {
      item.tags = this.normalizeTags(params.tags);
      updatedContent = true;
    }

    if (params.customFields !== undefined) {
      if (params.customFields === null) {
        // Explicit null clears all custom fields
        delete item.customFields;
      } else {
        // Merge: update/add fields, null values remove individual fields
        const existing = item.customFields ?? {};
        const merged: Record<string, unknown> = { ...existing };
        for (const [key, value] of Object.entries(params.customFields)) {
          if (value === null) {
            delete merged[key];
          } else {
            merged[key] = value;
          }
        }
        if (Object.keys(merged).length > 0) {
          item.customFields = merged;
        } else {
          delete item.customFields;
        }
      }
      updatedContent = true;
    }

    if (params.completed !== undefined) {
      if (params.completed) {
        item.completed = true;
        item.completedAt = now;
      } else {
        delete item.completed;
        delete item.completedAt;
      }
      updatedContent = true;
    }

    if (params.position !== undefined) {
      this.repositionItem(item.listId, item.id, params.position);
      updatedContent = true;
    }

    if (params.touchedAt !== undefined) {
      if (params.touchedAt === null) {
        delete item.touchedAt;
      } else if (typeof params.touchedAt === 'string') {
        const trimmed = params.touchedAt.trim();
        if (trimmed) {
          item.touchedAt = trimmed;
        } else {
          delete item.touchedAt;
        }
      }
    }

    if (updatedContent) {
      item.updatedAt = now;
      this.touchList(item.listId, now);
    }
    await this.save();
    return item;
  }

  async touchItem(id: string, timestamp?: string): Promise<ListItem> {
    await this.ensureLoaded();

    const item = this.data.items.find((i) => i.id === id);
    if (!item) {
      throw new Error(`Item not found: ${id}`);
    }

    item.touchedAt = timestamp ?? new Date().toISOString();
    await this.save();
    return item;
  }

  async removeItem(id: string): Promise<void> {
    await this.ensureLoaded();

    const index = this.data.items.findIndex((i) => i.id === id);
    if (index === -1) {
      throw new Error(`Item not found: ${id}`);
    }

    const [item] = this.data.items.splice(index, 1);
    if (item) {
      this.reflowPositions(item.listId);
      this.touchList(item.listId);
    }
    await this.save();
  }

  async moveItem(id: string, targetListId: string, position?: number): Promise<ListItem> {
    await this.ensureLoaded();

    const item = this.data.items.find((i) => i.id === id);
    if (!item) {
      throw new Error(`Item not found: ${id}`);
    }

    const targetList = this.data.lists.find((l) => l.id === targetListId);
    if (!targetList) {
      throw new Error(`List not found: ${targetListId}`);
    }

    const originalListId = item.listId;
    item.listId = targetListId;

    const now = new Date().toISOString();
    this.reflowPositions(originalListId);
    this.repositionItem(targetListId, item.id, position);
    item.updatedAt = now;
    this.touchList(originalListId, now);
    this.touchList(targetListId, now);

    await this.save();
    return item;
  }

  async copyItem(params: {
    id: string;
    targetListId: string;
    position?: number;
    sourceListId?: string;
  }): Promise<ListItem> {
    await this.ensureLoaded();

    const item = this.data.items.find((i) => i.id === params.id);
    if (!item) {
      throw new Error(`Item not found: ${params.id}`);
    }

    if (params.sourceListId && item.listId !== params.sourceListId) {
      throw new Error(`Item not found in list: ${params.id}`);
    }

    const targetList = this.data.lists.find((l) => l.id === params.targetListId);
    if (!targetList) {
      throw new Error(`List not found: ${params.targetListId}`);
    }

    const now = new Date().toISOString();
    const copied: ListItem = {
      id: randomUUID(),
      listId: params.targetListId,
      title: item.title,
      tags: this.normalizeTags(item.tags),
      addedAt: now,
      updatedAt: now,
      position: 0,
      ...(item.url ? { url: item.url } : {}),
      ...(item.notes ? { notes: item.notes } : {}),
      ...(item.customFields ? { customFields: { ...item.customFields } } : {}),
      ...(item.touchedAt ? { touchedAt: item.touchedAt } : {}),
      ...(item.completed ? { completed: true, completedAt: item.completedAt ?? now } : {}),
    };

    this.data.items.push(copied);
    this.repositionItem(params.targetListId, copied.id, params.position);
    this.touchList(params.targetListId, now);
    await this.save();
    return copied;
  }

  // Query operations

  async listItems(params: {
    listId: string;
    limit?: number;
    sort?: ItemSortOrder;
    tags?: string[];
    tagMatch?: TagMatchMode;
  }): Promise<ListItem[]> {
    await this.ensureLoaded();

    let items = this.data.items.filter((item) => item.listId === params.listId);

    if (params.tags && params.tags.length > 0) {
      items = items.filter((item) => this.matchesTags(item.tags, params.tags, params.tagMatch));
    }

    const sort = params.sort ?? 'position';
    items.sort((a, b) => {
      if (sort === 'position') {
        const aPos = typeof a.position === 'number' ? a.position : 0;
        const bPos = typeof b.position === 'number' ? b.position : 0;
        return aPos - bPos;
      }

      const aTime = new Date(a.addedAt).getTime();
      const bTime = new Date(b.addedAt).getTime();
      return sort === 'newest' ? bTime - aTime : aTime - bTime;
    });

    const limit = params.limit ?? 20;
    if (limit > 0) {
      items = items.slice(0, limit);
    }

    return items;
  }

  async getItemsByIds(ids: string[]): Promise<ListItem[]> {
    await this.ensureLoaded();
    const idSet = new Set(ids);
    return this.data.items.filter((item) => idSet.has(item.id));
  }

  async searchItems(params: {
    query: string;
    listId?: string;
    limit?: number;
    tags?: string[];
    tagMatch?: TagMatchMode;
  }): Promise<ListItem[]> {
    await this.ensureLoaded();

    const query = params.query.trim().toLowerCase();
    if (!query) {
      return [];
    }

    let items = [...this.data.items];

    if (params.listId) {
      items = items.filter((item) => item.listId === params.listId);
    }

    items = items.filter((item) => {
      const title = item.title.toLowerCase();
      const url = item.url?.toLowerCase() ?? '';
      const notes = item.notes?.toLowerCase() ?? '';
      return title.includes(query) || url.includes(query) || notes.includes(query);
    });

    if (params.tags && params.tags.length > 0) {
      items = items.filter((item) => this.matchesTags(item.tags, params.tags, params.tagMatch));
    }

    // Default sort: newest first
    items.sort((a, b) => {
      const aTime = new Date(a.addedAt).getTime();
      const bTime = new Date(b.addedAt).getTime();
      return bTime - aTime;
    });

    const limit = params.limit ?? 20;
    if (limit > 0) {
      items = items.slice(0, limit);
    }

    return items;
  }
}
