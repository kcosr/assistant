import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';
import { normalizeTags } from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type {
  PluginModule,
  SearchProvider,
  SearchResult,
} from '../../../../agent-server/src/plugins/types';
import {
  DEFAULT_PLUGIN_INSTANCE_ID,
  normalizePluginInstanceId,
  resolvePluginInstanceDataDir,
  resolvePluginInstances,
  type PluginInstanceDefinition,
} from '../../../../agent-server/src/plugins/instances';
import { ListsStore } from './store';
import type { ListCustomFieldDefinition, ListDefinition, ListItem } from './types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

const LIST_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} is required and must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolError('invalid_arguments', `${field} cannot be empty`);
  }
  return trimmed;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  return value;
}

function parseOptionalTags(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolError('invalid_arguments', 'tags must be an array of strings');
  }
  return normalizeTags(value);
}

function parseRequiredTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolError('invalid_arguments', 'tags must be an array of strings');
  }
  const normalized = normalizeTags(value);
  if (normalized.length === 0) {
    throw new ToolError('invalid_arguments', 'tags cannot be empty');
  }
  return normalized;
}

function parseTagMatch(value: unknown): 'all' | 'any' | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'all' || value === 'any') {
    return value;
  }
  throw new ToolError('invalid_arguments', "tagMatch must be 'all' or 'any'");
}

function slugify(raw: string): string {
  const normalized = raw.normalize('NFKD').toLowerCase();
  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function safeSlugify(raw: string): string | null {
  const slug = slugify(raw);
  if (!slug || !LIST_ID_PATTERN.test(slug)) {
    return null;
  }
  return slug;
}

function requireSessionHub(ctx: ToolContext) {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_hub_unavailable', 'Session hub is not available');
  }
  return sessionHub;
}

type ListsUpdateAction =
  | 'list_created'
  | 'list_updated'
  | 'list_deleted'
  | 'item_added'
  | 'item_updated'
  | 'item_removed';

type ListsPanelUpdate = {
  instance_id: string;
  listId: string;
  action: ListsUpdateAction;
  list?: ListDefinition;
  item?: ListItem;
  itemId?: string;
  refresh?: boolean;
};

function broadcastListsUpdate(ctx: ToolContext, update: ListsPanelUpdate): void {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    return;
  }
  sessionHub.broadcastToAll({
    type: 'panel_event',
    panelId: '*',
    panelType: 'lists',
    sessionId: '*',
    payload: {
      type: 'panel_update',
      instance_id: update.instance_id,
      listId: update.listId,
      action: update.action,
      ...(update.list ? { list: update.list } : {}),
      ...(update.item ? { item: update.item } : {}),
      ...(update.itemId ? { itemId: update.itemId } : {}),
      ...(update.refresh ? { refresh: true } : {}),
    },
  });
}

function broadcastListsUpdateForAll(
  ctx: ToolContext,
  listIds: Array<string | undefined>,
  update: Omit<ListsPanelUpdate, 'listId'>,
): void {
  const unique = Array.from(new Set(listIds.filter((id): id is string => !!id)));
  for (const listId of unique) {
    broadcastListsUpdate(ctx, { ...update, listId });
  }
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let baseDataDir = '';
  let instances: PluginInstanceDefinition[] = [];
  let instanceById = new Map<string, PluginInstanceDefinition>();
  const stores = new Map<string, ListsStore>();

  const resolveInstanceId = (value: unknown): string => {
    if (value === undefined) {
      return DEFAULT_PLUGIN_INSTANCE_ID;
    }
    if (typeof value !== 'string') {
      throw new ToolError('invalid_arguments', 'instance_id must be a string');
    }
    const normalized = normalizePluginInstanceId(value);
    if (!normalized) {
      throw new ToolError(
        'invalid_arguments',
        'instance_id must be a slug (letters, numbers, hyphens, underscores)',
      );
    }
    if (!instanceById.has(normalized)) {
      throw new ToolError('invalid_arguments', `Unknown instance_id: ${normalized}`);
    }
    return normalized;
  };

  const resolveTargetInstanceId = (value: unknown): string => {
    if (value === undefined) {
      throw new ToolError('invalid_arguments', 'target_instance_id is required');
    }
    if (typeof value !== 'string') {
      throw new ToolError('invalid_arguments', 'target_instance_id must be a string');
    }
    const normalized = normalizePluginInstanceId(value);
    if (!normalized) {
      throw new ToolError(
        'invalid_arguments',
        'target_instance_id must be a slug (letters, numbers, hyphens, underscores)',
      );
    }
    if (!instanceById.has(normalized)) {
      throw new ToolError('invalid_arguments', `Unknown target_instance_id: ${normalized}`);
    }
    return normalized;
  };

  const getStore = async (instanceId: string): Promise<ListsStore> => {
    const existing = stores.get(instanceId);
    if (existing) {
      return existing;
    }
    if (!baseDataDir) {
      throw new ToolError('plugin_not_initialized', 'Lists plugin has not been initialized');
    }
    const instanceDir = resolvePluginInstanceDataDir(baseDataDir, instanceId);
    await mkdir(instanceDir, { recursive: true });
    const filePath = path.join(instanceDir, 'lists.json');
    const store = new ListsStore(filePath);
    stores.set(instanceId, store);
    return store;
  };

  const truncateSnippet = (value: string, limit = 140): string => {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (trimmed.length <= limit) {
      return trimmed;
    }
    return `${trimmed.slice(0, Math.max(0, limit - 3))}...`;
  };

  const searchProvider: SearchProvider = {
    async search(query, options) {
      const trimmed = query.trim();
      const { instanceId, limit = 10 } = options;
      const targetInstances = instanceId ? [instanceId] : Array.from(instanceById.keys());
      const results: SearchResult[] = [];

      if (!trimmed) {
        for (const instId of targetInstances) {
          if (!instanceById.has(instId)) {
            continue;
          }
          const store = await getStore(instId);
          const lists = await store.listLists();
          for (const list of lists) {
            results.push({
              id: `list:${list.id}`,
              title: list.name,
              subtitle: list.id,
              snippet: list.description ? truncateSnippet(list.description) : undefined,
              launch: {
                panelType: 'lists',
                payload: {
                  type: 'lists_show',
                  instance_id: instId,
                  listId: list.id,
                },
              },
            });
          }
          if (results.length >= limit) {
            break;
          }
        }
        return results.slice(0, limit);
      }

      const normalizedQuery = trimmed.toLowerCase();
      for (const instId of targetInstances) {
        if (!instanceById.has(instId)) {
          continue;
        }
        const store = await getStore(instId);
        const lists = await store.listLists();
        const listLookup = new Map(lists.map((list) => [list.id, list.name]));
        const listResults = lists
          .filter((list) => {
            const name = list.name.toLowerCase();
            const id = list.id.toLowerCase();
            const description = list.description?.toLowerCase() ?? '';
            return (
              name.includes(normalizedQuery) ||
              id.includes(normalizedQuery) ||
              description.includes(normalizedQuery)
            );
          })
          .map<SearchResult>((list) => ({
            id: `list:${list.id}`,
            title: list.name,
            subtitle: list.id,
            snippet: list.description ? truncateSnippet(list.description) : undefined,
            launch: {
              panelType: 'lists',
              payload: {
                type: 'lists_show',
                instance_id: instId,
                listId: list.id,
              },
            },
          }));

        const itemLimit = Math.max(limit - listResults.length, 0);
        const items =
          itemLimit > 0 ? await store.searchItems({ query: trimmed, limit: itemLimit }) : [];
        const itemResults: SearchResult[] = [];
        for (const item of items) {
          const subtitle = listLookup.get(item.listId) ?? item.listId;
          const snippetSource = item.notes?.trim() || item.url?.trim() || '';
          itemResults.push({
            id: item.id,
            title: item.title,
            subtitle,
            snippet: snippetSource ? truncateSnippet(snippetSource) : undefined,
            launch: {
              panelType: 'lists',
              payload: {
                type: 'lists_show',
                instance_id: instId,
                listId: item.listId,
                itemId: item.id,
              },
            },
          });
        }

        results.push(...listResults, ...itemResults);
      }

      return results.slice(0, limit);
    },
  };

  const resolveStore = async (
    parsed: Record<string, unknown>,
  ): Promise<{ instanceId: string; store: ListsStore }> => {
    const instanceId = resolveInstanceId(parsed['instance_id']);
    return { instanceId, store: await getStore(instanceId) };
  };

  return {
    searchProvider,
    operations: {
      instance_list: async (): Promise<PluginInstanceDefinition[]> => instances,
      list: async (args): Promise<unknown> => {
        const parsed = asObject(args);
        const { store: listsStore } = await resolveStore(parsed);
        const tags = parseOptionalTags(parsed['tags']);
        const tagMatch = parseTagMatch(parsed['tagMatch']);
        return listsStore.listLists({ ...(tags ? { tags } : {}), tagMatch });
      },
      get: async (args): Promise<unknown> => {
        const parsed = asObject(args);
        const { store: listsStore } = await resolveStore(parsed);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const list = await listsStore.getList(id);
        if (!list) {
          throw new ToolError('list_not_found', `List not found: ${id}`);
        }
        return list;
      },
      show: async (args, ctx): Promise<{ ok: true; panelId: string }> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const panelId = requireNonEmptyString(parsed['panelId'], 'panelId');
        const list = await listsStore.getList(id);
        if (!list) {
          throw new ToolError('list_not_found', `List not found: ${id}`);
        }
        const sessionHub = requireSessionHub(ctx);
        sessionHub.broadcastToAll({
          type: 'panel_event',
          panelId,
          panelType: 'lists',
          payload: {
            type: 'lists_show',
            instance_id: instanceId,
            listId: id,
          },
        });
        return { ok: true, panelId };
      },
      create: async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const name = requireNonEmptyString(parsed['name'], 'name');
        const idRaw = parseOptionalString(parsed['id'], 'id');
        const idSource = idRaw && idRaw.trim().length > 0 ? idRaw : name;
        const id = safeSlugify(idSource);
        if (!id) {
          throw new ToolError('invalid_arguments', 'List id cannot be slugified into a valid id');
        }
        const description = parseOptionalString(parsed['description'], 'description');
        const tags = parseOptionalTags(parsed['tags']);
        const defaultTags = parseOptionalTags(parsed['defaultTags']);
        const customFieldsRaw = parsed['customFields'];
        let customFields: Array<ListCustomFieldDefinition> | undefined;
        if (customFieldsRaw !== undefined) {
          if (!Array.isArray(customFieldsRaw)) {
            throw new ToolError('invalid_arguments', 'customFields must be an array');
          }
          customFields = customFieldsRaw as Array<ListCustomFieldDefinition>;
        }
        const result = await listsStore.createList({
          id,
          name,
          ...(description !== undefined ? { description } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(defaultTags !== undefined ? { defaultTags } : {}),
          ...(customFields !== undefined ? { customFields } : {}),
        });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: result.id,
          action: 'list_created',
          list: result,
        });
        return result;
      },
      update: async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const name = parseOptionalString(parsed['name'], 'name');
        const description = parseOptionalString(parsed['description'], 'description');
        const tags = parseOptionalTags(parsed['tags']);
        const defaultTags = parseOptionalTags(parsed['defaultTags']);
        const customFieldsRaw = parsed['customFields'];
        let customFields: Array<ListCustomFieldDefinition> | null | undefined;
        if (customFieldsRaw !== undefined) {
          if (customFieldsRaw !== null && !Array.isArray(customFieldsRaw)) {
            throw new ToolError('invalid_arguments', 'customFields must be an array or null');
          }
          customFields = customFieldsRaw as Array<ListCustomFieldDefinition> | null;
        }
        if (
          name === undefined &&
          description === undefined &&
          tags === undefined &&
          defaultTags === undefined &&
          customFields === undefined
        ) {
          throw new ToolError('invalid_arguments', 'No updates provided');
        }
        const result = await listsStore.updateList({
          id,
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(defaultTags !== undefined ? { defaultTags } : {}),
          ...(customFields !== undefined ? { customFields } : {}),
        });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: id,
          action: 'list_updated',
          list: result,
        });
        return result;
      },
      move: async (args, ctx): Promise<ListDefinition> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const targetInstanceId = resolveTargetInstanceId(parsed['target_instance_id']);
        if (targetInstanceId === instanceId) {
          throw new ToolError(
            'invalid_arguments',
            'target_instance_id must be different from instance_id',
          );
        }
        const id = requireNonEmptyString(parsed['id'], 'id');
        const overwriteRaw = parsed['overwrite'];
        let overwrite = false;
        if (overwriteRaw !== undefined) {
          if (typeof overwriteRaw !== 'boolean') {
            throw new ToolError('invalid_arguments', 'overwrite must be a boolean');
          }
          overwrite = overwriteRaw;
        }

        const sourceStore = await getStore(instanceId);
        let snapshot: { list: ListDefinition; items: ListItem[] };
        try {
          snapshot = await sourceStore.getListWithItems(id);
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.message?.includes('List not found')) {
            throw new ToolError('list_not_found', `List not found: ${id}`);
          }
          throw err;
        }

        const targetStore = await getStore(targetInstanceId);
        if (!overwrite) {
          const existing = await targetStore.getList(id);
          if (existing) {
            throw new ToolError(
              'invalid_arguments',
              `List already exists in target instance: ${id}`,
            );
          }
        }

        const moved = await targetStore.replaceListWithItems({
          list: snapshot.list,
          items: snapshot.items,
          overwrite,
        });

        await sourceStore.deleteList(id);

        broadcastListsUpdate(ctx, {
          instance_id: targetInstanceId,
          listId: id,
          action: 'list_created',
          list: moved,
        });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: id,
          action: 'list_deleted',
        });

        return moved;
      },
      delete: async (args, ctx): Promise<{ ok: true }> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const id = requireNonEmptyString(parsed['id'], 'id');
        await listsStore.deleteList(id);
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: id,
          action: 'list_deleted',
        });
        return { ok: true };
      },
      'tags-add': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const tags = parseRequiredTags(parsed['tags']);
        const existing = await listsStore.getList(id);
        if (!existing) {
          throw new ToolError('list_not_found', `List not found: ${id}`);
        }
        const combined = normalizeTags([...(existing.tags ?? []), ...tags]);
        const result = await listsStore.updateList({ id, tags: combined });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: id,
          action: 'list_updated',
          list: result,
        });
        return result;
      },
      'tags-remove': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const tags = parseRequiredTags(parsed['tags']);
        const existing = await listsStore.getList(id);
        if (!existing) {
          throw new ToolError('list_not_found', `List not found: ${id}`);
        }
        const removeNormalized = normalizeTags(tags);
        const current = normalizeTags(existing.tags);
        const remaining = current.filter((tag) => !removeNormalized.includes(tag));
        const result = await listsStore.updateList({ id, tags: remaining });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: id,
          action: 'list_updated',
          list: result,
        });
        return result;
      },
      'items-list': async (args): Promise<unknown> => {
        const parsed = asObject(args);
        const { store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const limit = parsed['limit'];
        if (limit !== undefined && typeof limit !== 'number') {
          throw new ToolError('invalid_arguments', 'limit must be a number');
        }
        const sort = parsed['sort'];
        if (sort !== undefined && sort !== 'position' && sort !== 'newest' && sort !== 'oldest') {
          throw new ToolError('invalid_arguments', 'sort must be position, newest, or oldest');
        }
        const tags = parseOptionalTags(parsed['tags']);
        const tagMatch = parseTagMatch(parsed['tagMatch']);
        return listsStore.listItems({
          listId,
          ...(limit !== undefined ? { limit: limit as number } : {}),
          ...(sort !== undefined ? { sort: sort as 'position' | 'newest' | 'oldest' } : {}),
          ...(tags !== undefined ? { tags } : {}),
          tagMatch,
        });
      },
      'items-search': async (args): Promise<unknown> => {
        const parsed = asObject(args);
        const { store: listsStore } = await resolveStore(parsed);
        const query = requireNonEmptyString(parsed['query'], 'query');
        const listId = parseOptionalString(parsed['listId'], 'listId');
        const limit = parsed['limit'];
        if (limit !== undefined && typeof limit !== 'number') {
          throw new ToolError('invalid_arguments', 'limit must be a number');
        }
        const tags = parseOptionalTags(parsed['tags']);
        const tagMatch = parseTagMatch(parsed['tagMatch']);
        return listsStore.searchItems({
          query,
          ...(listId ? { listId } : {}),
          ...(limit !== undefined ? { limit: limit as number } : {}),
          ...(tags !== undefined ? { tags } : {}),
          tagMatch,
        });
      },
      'item-get': async (args): Promise<unknown> => {
        const parsed = asObject(args);
        const { store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const id = parseOptionalString(parsed['id'], 'id');
        const title = parseOptionalString(parsed['title'], 'title');
        if (!id && !title) {
          throw new ToolError('invalid_arguments', 'Either id or title must be provided');
        }
        if (id) {
          const item = await listsStore.getItem(id);
          if (!item || item.listId !== listId) {
            throw new ToolError('item_not_found', `Item not found in list: ${id}`);
          }
          return item;
        }
        const item = await listsStore.findItemByTitle(listId, title ?? '');
        if (!item) {
          throw new ToolError('item_not_found', `Item with title "${title}" not found`);
        }
        return item;
      },
      'item-add': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const title = requireNonEmptyString(parsed['title'], 'title');
        const position = parsed['position'];
        if (position !== undefined && typeof position !== 'number') {
          throw new ToolError('invalid_arguments', 'position must be a number');
        }
        const url = parseOptionalString(parsed['url'], 'url');
        const notes = parseOptionalString(parsed['notes'], 'notes');
        const tags = parseOptionalTags(parsed['tags']);
        const customFieldsRaw = parsed['customFields'];
        let customFields: Record<string, unknown> | undefined;
        if (customFieldsRaw !== undefined) {
          if (
            !customFieldsRaw ||
            typeof customFieldsRaw !== 'object' ||
            Array.isArray(customFieldsRaw)
          ) {
            throw new ToolError('invalid_arguments', 'customFields must be an object');
          }
          customFields = customFieldsRaw as Record<string, unknown>;
        }
        const item = await listsStore.addItem({
          listId,
          title,
          ...(position !== undefined ? { position: position as number } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(customFields !== undefined ? { customFields } : {}),
        });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_added',
          item,
          itemId: item.id,
          refresh: true,
        });
        return item;
      },
      'item-update': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const id = parseOptionalString(parsed['id'], 'id');
        const lookupTitle = parseOptionalString(parsed['lookupTitle'], 'lookupTitle');
        if (!id && !lookupTitle) {
          throw new ToolError('invalid_arguments', 'Either id or lookupTitle must be provided');
        }
        let itemId: string;
        if (id) {
          const item = await listsStore.getItem(id);
          if (!item || item.listId !== listId) {
            throw new ToolError('item_not_found', `Item not found in list: ${id}`);
          }
          itemId = item.id;
        } else {
          const item = await listsStore.findItemByTitle(listId, lookupTitle ?? '');
          if (!item) {
            throw new ToolError('item_not_found', `Item with title "${lookupTitle}" not found`);
          }
          itemId = item.id;
        }
        const rawTitle = parsed['title'];
        const title = typeof rawTitle === 'string' ? rawTitle : undefined;
        const rawPosition = parsed['position'];
        const position = typeof rawPosition === 'number' ? rawPosition : undefined;
        const rawUrl = parsed['url'];
        const url = rawUrl === null ? '' : typeof rawUrl === 'string' ? rawUrl : undefined;
        const rawNotes = parsed['notes'];
        const notes = rawNotes === null ? '' : typeof rawNotes === 'string' ? rawNotes : undefined;
        const rawTags = parsed['tags'];
        const tags =
          rawTags === null ? [] : Array.isArray(rawTags) ? (rawTags as string[]) : undefined;
        const rawCompleted = parsed['completed'];
        const completed =
          rawCompleted === null
            ? false
            : typeof rawCompleted === 'boolean'
              ? rawCompleted
              : undefined;
        const rawCustomFields = parsed['customFields'];
        const customFields =
          rawCustomFields === null
            ? null
            : rawCustomFields &&
                typeof rawCustomFields === 'object' &&
                !Array.isArray(rawCustomFields)
              ? (rawCustomFields as Record<string, unknown>)
              : undefined;
        const rawTouchedAt = parsed['touchedAt'];
        const touchedAt =
          rawTouchedAt === null
            ? null
            : typeof rawTouchedAt === 'string'
              ? rawTouchedAt
              : undefined;
        const updated = await listsStore.updateItem({
          id: itemId,
          ...(title !== undefined ? { title } : {}),
          ...(position !== undefined ? { position } : {}),
          ...(url !== undefined ? { url } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(tags !== undefined ? { tags } : {}),
          ...(completed !== undefined ? { completed } : {}),
          ...(customFields !== undefined ? { customFields } : {}),
          ...(touchedAt !== undefined ? { touchedAt } : {}),
        });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_updated',
          item: updated,
          itemId: updated.id,
          ...(position !== undefined ? { refresh: true } : {}),
        });
        return updated;
      },
      'item-remove': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const id = parseOptionalString(parsed['id'], 'id');
        const title = parseOptionalString(parsed['title'], 'title');
        if (!id && !title) {
          throw new ToolError('invalid_arguments', 'Either id or title must be provided');
        }
        let itemId: string;
        if (id) {
          const item = await listsStore.getItem(id);
          if (!item || item.listId !== listId) {
            throw new ToolError('item_not_found', `Item not found in list: ${id}`);
          }
          itemId = item.id;
        } else {
          const item = await listsStore.findItemByTitle(listId, title ?? '');
          if (!item) {
            throw new ToolError('item_not_found', `Item with title "${title}" not found`);
          }
          itemId = item.id;
        }
        await listsStore.removeItem(itemId);
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_removed',
          itemId,
          refresh: true,
        });
        return { ok: true };
      },
      'item-touch': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const id = parseOptionalString(parsed['id'], 'id');
        const lookupTitle = parseOptionalString(parsed['lookupTitle'], 'lookupTitle');
        if (!id && !lookupTitle) {
          throw new ToolError('invalid_arguments', 'Either id or lookupTitle must be provided');
        }
        let itemId: string;
        if (id) {
          const item = await listsStore.getItem(id);
          if (!item || item.listId !== listId) {
            throw new ToolError('item_not_found', `Item not found in list: ${id}`);
          }
          itemId = item.id;
        } else {
          const item = await listsStore.findItemByTitle(listId, lookupTitle ?? '');
          if (!item) {
            throw new ToolError('item_not_found', `Item with title "${lookupTitle}" not found`);
          }
          itemId = item.id;
        }
        const updated = await listsStore.touchItem(itemId);
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_updated',
          item: updated,
          itemId: updated.id,
        });
        return updated;
      },
      'item-tags-add': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const id = parseOptionalString(parsed['id'], 'id');
        const lookupTitle = parseOptionalString(parsed['lookupTitle'], 'lookupTitle');
        const tags = parseRequiredTags(parsed['tags']);
        if (!id && !lookupTitle) {
          throw new ToolError('invalid_arguments', 'Either id or lookupTitle must be provided');
        }
        let itemId: string;
        if (id) {
          const item = await listsStore.getItem(id);
          if (!item || item.listId !== listId) {
            throw new ToolError('item_not_found', `Item not found in list: ${id}`);
          }
          itemId = item.id;
        } else {
          const item = await listsStore.findItemByTitle(listId, lookupTitle ?? '');
          if (!item) {
            throw new ToolError('item_not_found', `Item with title "${lookupTitle}" not found`);
          }
          itemId = item.id;
        }
        const existing = await listsStore.getItem(itemId);
        if (!existing || existing.listId !== listId) {
          throw new ToolError('item_not_found', `Item not found in list: ${itemId}`);
        }
        const combined = normalizeTags([...(existing.tags ?? []), ...tags]);
        const updated = await listsStore.updateItem({ id: itemId, tags: combined });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_updated',
          item: updated,
          itemId: updated.id,
        });
        return updated;
      },
      'item-tags-remove': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const id = parseOptionalString(parsed['id'], 'id');
        const lookupTitle = parseOptionalString(parsed['lookupTitle'], 'lookupTitle');
        const tags = parseRequiredTags(parsed['tags']);
        if (!id && !lookupTitle) {
          throw new ToolError('invalid_arguments', 'Either id or lookupTitle must be provided');
        }
        let itemId: string;
        if (id) {
          const item = await listsStore.getItem(id);
          if (!item || item.listId !== listId) {
            throw new ToolError('item_not_found', `Item not found in list: ${id}`);
          }
          itemId = item.id;
        } else {
          const item = await listsStore.findItemByTitle(listId, lookupTitle ?? '');
          if (!item) {
            throw new ToolError('item_not_found', `Item with title "${lookupTitle}" not found`);
          }
          itemId = item.id;
        }
        const existing = await listsStore.getItem(itemId);
        if (!existing || existing.listId !== listId) {
          throw new ToolError('item_not_found', `Item not found in list: ${itemId}`);
        }
        const removeNormalized = normalizeTags(tags);
        const current = normalizeTags(existing.tags);
        const remaining = current.filter((tag) => !removeNormalized.includes(tag));
        const updated = await listsStore.updateItem({ id: itemId, tags: remaining });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_updated',
          item: updated,
          itemId: updated.id,
        });
        return updated;
      },
      'item-copy': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const id = parseOptionalString(parsed['id'], 'id');
        const lookupTitle = parseOptionalString(parsed['lookupTitle'], 'lookupTitle');
        const sourceListId = requireNonEmptyString(parsed['sourceListId'], 'sourceListId');
        const targetListId = requireNonEmptyString(parsed['targetListId'], 'targetListId');
        const position = parsed['position'];
        if (position !== undefined && typeof position !== 'number') {
          throw new ToolError('invalid_arguments', 'position must be a number');
        }
        if (!id && !lookupTitle) {
          throw new ToolError('invalid_arguments', 'Either id or lookupTitle must be provided');
        }
        let itemId: string;
        if (id) {
          const item = await listsStore.getItem(id);
          if (!item || item.listId !== sourceListId) {
            throw new ToolError('item_not_found', `Item not found in list: ${id}`);
          }
          itemId = item.id;
        } else {
          const item = await listsStore.findItemByTitle(sourceListId, lookupTitle ?? '');
          if (!item) {
            throw new ToolError('item_not_found', `Item with title "${lookupTitle}" not found`);
          }
          itemId = item.id;
        }
        const copied = await listsStore.copyItem({
          id: itemId,
          sourceListId,
          targetListId,
          ...(position !== undefined ? { position: position as number } : {}),
        });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: targetListId,
          action: 'item_added',
          item: copied,
          itemId: copied.id,
          refresh: true,
        });
        return copied;
      },
      'item-move': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const targetListId = requireNonEmptyString(parsed['targetListId'], 'targetListId');
        const position = parsed['position'];
        if (position !== undefined && typeof position !== 'number') {
          throw new ToolError('invalid_arguments', 'position must be a number');
        }
        const existing = await listsStore.getItem(id);
        if (!existing) {
          throw new ToolError('item_not_found', `Item not found: ${id}`);
        }
        const sourceListId = existing.listId;
        const moved = await listsStore.moveItem(id, targetListId, position as number | undefined);
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: sourceListId,
          action: 'item_removed',
          itemId: moved.id,
          refresh: true,
        });
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: targetListId,
          action: 'item_added',
          item: moved,
          itemId: moved.id,
          refresh: true,
        });
        return moved;
      },
      'items-bulk-update-tags': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const rawItems = Array.isArray(parsed['items']) ? (parsed['items'] as unknown[]) : [];
        const results: Array<{ index: number; itemId?: string; ok: boolean; error?: string }> = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const op = rawItems[index] as Record<string, unknown>;
          try {
            const id = parseOptionalString(op['id'], 'id');
            const lookupTitle = parseOptionalString(op['lookupTitle'], 'lookupTitle');
            if (!id && !lookupTitle) {
              results.push({
                index,
                ok: false,
                error: 'Either id or lookupTitle must be provided',
              });
              continue;
            }
            let itemId: string | undefined;
            if (id) {
              const item = await listsStore.getItem(id);
              if (!item || item.listId !== listId) {
                results.push({ index, ok: false, error: `Item not found in list: ${id}` });
                continue;
              }
              itemId = item.id;
            } else {
              const item = await listsStore.findItemByTitle(listId, lookupTitle ?? '');
              if (!item) {
                results.push({
                  index,
                  ok: false,
                  error: `Item with title "${lookupTitle}" not found in list`,
                });
                continue;
              }
              itemId = item.id;
            }
            if (!itemId) {
              results.push({ index, ok: false, error: 'Item not found' });
              continue;
            }
            const existing = await listsStore.getItem(itemId);
            if (!existing || existing.listId !== listId) {
              results.push({ index, ok: false, error: `Item not found in list: ${itemId}` });
              continue;
            }
            let nextTags = normalizeTags(existing.tags);
            const setTags = op['setTags'];
            if (Array.isArray(setTags)) {
              nextTags = normalizeTags(setTags as string[]);
            }
            const addTags = op['addTags'];
            if (Array.isArray(addTags)) {
              nextTags = normalizeTags([...nextTags, ...(addTags as string[])]);
            }
            const removeTags = op['removeTags'];
            if (Array.isArray(removeTags)) {
              const removeNormalized = normalizeTags(removeTags as string[]);
              nextTags = nextTags.filter((tag) => !removeNormalized.includes(tag));
            }
            await listsStore.updateItem({ id: itemId, tags: nextTags });
            results.push({ index, itemId, ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ index, ok: false, error: message });
          }
        }
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_updated',
          refresh: true,
        });
        return { results };
      },
      'items-bulk-move': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const rawOps = Array.isArray(parsed['operations'])
          ? (parsed['operations'] as unknown[])
          : [];
        const results: Array<{
          index: number;
          itemId?: string;
          sourceListId?: string;
          targetListId?: string;
          ok: boolean;
          error?: string;
        }> = [];
        for (let index = 0; index < rawOps.length; index += 1) {
          const op = rawOps[index] as Record<string, unknown>;
          try {
            const id = requireNonEmptyString(op['id'], 'id');
            const targetListId = requireNonEmptyString(op['targetListId'], 'targetListId');
            const position = op['position'];
            if (position !== undefined && typeof position !== 'number') {
              throw new ToolError('invalid_arguments', 'position must be a number');
            }
            const existing = await listsStore.getItem(id);
            if (!existing) {
              results.push({ index, ok: false, error: `Item not found: ${id}` });
              continue;
            }
            const sourceListId = existing.listId;
            const moved = await listsStore.moveItem(
              id,
              targetListId,
              position as number | undefined,
            );
            results.push({
              index,
              itemId: moved.id,
              sourceListId,
              targetListId,
              ok: true,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ index, ok: false, error: message });
          }
        }
        const affected = results.flatMap((r) => [r.sourceListId, r.targetListId]);
        broadcastListsUpdateForAll(ctx, affected, {
          instance_id: instanceId,
          action: 'item_updated',
          refresh: true,
        });
        return { results };
      },
      'items-bulk-copy': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const sourceListId = requireNonEmptyString(parsed['sourceListId'], 'sourceListId');
        const targetListId = requireNonEmptyString(parsed['targetListId'], 'targetListId');
        const rawItems = Array.isArray(parsed['items']) ? (parsed['items'] as unknown[]) : [];
        const results: Array<{
          index: number;
          itemId?: string;
          copiedItemId?: string;
          ok: boolean;
          error?: string;
        }> = [];
        for (let index = 0; index < rawItems.length; index += 1) {
          const entry = rawItems[index] as Record<string, unknown>;
          try {
            const id = requireNonEmptyString(entry['id'], 'id');
            const existing = await listsStore.getItem(id);
            if (!existing || existing.listId !== sourceListId) {
              results.push({ index, ok: false, error: `Item not found in list: ${id}` });
              continue;
            }
            const copied = await listsStore.copyItem({ id, sourceListId, targetListId });
            results.push({ index, itemId: id, copiedItemId: copied.id, ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ index, ok: false, error: message });
          }
        }
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId: targetListId,
          action: 'item_added',
          refresh: true,
        });
        return { results };
      },
      'items-bulk-update-fields': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const rawUpdates = Array.isArray(parsed['updates']) ? (parsed['updates'] as unknown[]) : [];
        const results: Array<{ index: number; itemId?: string; ok: boolean; error?: string }> = [];
        for (let index = 0; index < rawUpdates.length; index += 1) {
          const update = rawUpdates[index] as Record<string, unknown>;
          try {
            const id = parseOptionalString(update['id'], 'id');
            const lookupTitle = parseOptionalString(update['lookupTitle'], 'lookupTitle');
            if (!id && !lookupTitle) {
              results.push({
                index,
                ok: false,
                error: 'Either id or lookupTitle must be provided',
              });
              continue;
            }
            let itemId: string | undefined;
            if (id) {
              const item = await listsStore.getItem(id);
              if (!item || item.listId !== listId) {
                results.push({ index, ok: false, error: `Item not found in list: ${id}` });
                continue;
              }
              itemId = item.id;
            } else {
              const item = await listsStore.findItemByTitle(listId, lookupTitle ?? '');
              if (!item) {
                results.push({
                  index,
                  ok: false,
                  error: `Item with title "${lookupTitle}" not found in list`,
                });
                continue;
              }
              itemId = item.id;
            }
            const rawCustomFields = update['customFields'];
            const rawTouchedAt = update['touchedAt'];
            if (rawCustomFields === undefined && rawTouchedAt === undefined) {
              results.push({ index, ok: false, error: 'customFields or touchedAt is required' });
              continue;
            }
            const updateParams: {
              id: string;
              customFields?: Record<string, unknown> | null;
              touchedAt?: string | null;
            } = { id: itemId ?? '' };
            if (rawCustomFields !== undefined) {
              if (rawCustomFields === null) {
                updateParams.customFields = null;
              } else if (typeof rawCustomFields !== 'object' || Array.isArray(rawCustomFields)) {
                results.push({ index, ok: false, error: 'customFields must be an object or null' });
                continue;
              } else {
                updateParams.customFields = rawCustomFields as Record<string, unknown>;
              }
            }
            if (rawTouchedAt !== undefined) {
              if (rawTouchedAt === null) {
                updateParams.touchedAt = null;
              } else if (typeof rawTouchedAt === 'string') {
                updateParams.touchedAt = rawTouchedAt;
              } else {
                results.push({ index, ok: false, error: 'touchedAt must be a string or null' });
                continue;
              }
            }
            await listsStore.updateItem(updateParams);
            results.push({ index, itemId, ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ index, ok: false, error: message });
          }
        }
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_updated',
          refresh: true,
        });
        return { results };
      },
      'items-bulk-update-completed': async (args, ctx): Promise<unknown> => {
        const parsed = asObject(args);
        const { instanceId, store: listsStore } = await resolveStore(parsed);
        const listId = requireNonEmptyString(parsed['listId'], 'listId');
        const itemIds = Array.isArray(parsed['itemIds']) ? (parsed['itemIds'] as unknown[]) : [];
        const completed = parsed['completed'];
        if (typeof completed !== 'boolean') {
          throw new ToolError('invalid_arguments', 'completed must be a boolean');
        }
        const results: Array<{ index: number; itemId?: string; ok: boolean; error?: string }> = [];
        for (let index = 0; index < itemIds.length; index += 1) {
          const rawId = itemIds[index];
          try {
            if (typeof rawId !== 'string' || rawId.trim().length === 0) {
              results.push({ index, ok: false, error: 'Item id is required' });
              continue;
            }
            const item = await listsStore.getItem(rawId);
            if (!item || item.listId !== listId) {
              results.push({ index, ok: false, error: `Item not found in list: ${rawId}` });
              continue;
            }
            const updated = await listsStore.updateItem({ id: item.id, completed });
            results.push({ index, itemId: updated.id, ok: true });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            results.push({ index, ok: false, error: message });
          }
        }
        broadcastListsUpdate(ctx, {
          instance_id: instanceId,
          listId,
          action: 'item_updated',
          refresh: true,
        });
        return { results };
      },
    },
    async initialize(dataDir, pluginConfig): Promise<void> {
      baseDataDir = dataDir;
      instances = resolvePluginInstances('lists', pluginConfig);
      instanceById = new Map(instances.map((instance) => [instance.id, instance]));
    },
    async shutdown(): Promise<void> {
      stores.clear();
      instances = [];
      instanceById.clear();
      baseDataDir = '';
    },
  };
}
