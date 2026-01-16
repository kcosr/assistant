import { mkdir } from 'node:fs/promises';

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
import type { Note, NoteMetadata, NoteSearchResult } from './types';
import { NotesStore } from './store';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Tool arguments must be an object');
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

function requireSessionHub(ctx: ToolContext) {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    throw new ToolError('session_hub_unavailable', 'Session hub is not available');
  }
  return sessionHub;
}

type NotesUpdateAction = 'note_updated' | 'note_deleted' | 'note_tags_updated';

type NotesPanelUpdate = {
  instance_id: string;
  title: string;
  action: NotesUpdateAction;
  note?: NoteMetadata;
};

function broadcastNotesUpdate(ctx: ToolContext, update: NotesPanelUpdate): void {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    return;
  }
  sessionHub.broadcastToAll({
    type: 'panel_event',
    panelId: '*',
    panelType: 'notes',
    sessionId: '*',
    payload: {
      type: 'panel_update',
      instance_id: update.instance_id,
      title: update.title,
      action: update.action,
      ...(update.note ? { note: update.note } : {}),
    },
  });
}

async function withNote(
  action: () => Promise<NoteMetadata | Note | void>,
  title: string,
): Promise<NoteMetadata | Note | void> {
  try {
    return await action();
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw new ToolError('note_not_found', `Note not found: ${title}`);
    }
    throw err;
  }
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let baseDataDir = '';
  let instances: PluginInstanceDefinition[] = [];
  let instanceById = new Map<string, PluginInstanceDefinition>();
  const stores = new Map<string, NotesStore>();

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

  const getStore = async (instanceId: string): Promise<NotesStore> => {
    const existing = stores.get(instanceId);
    if (existing) {
      return existing;
    }
    if (!baseDataDir) {
      throw new ToolError('plugin_not_initialized', 'Notes plugin has not been initialized');
    }
    const instanceDir = resolvePluginInstanceDataDir(baseDataDir, instanceId);
    await mkdir(instanceDir, { recursive: true });
    const store = new NotesStore(instanceDir);
    stores.set(instanceId, store);
    return store;
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
          const notes = await store.list();
          for (const note of notes) {
            results.push({
              id: note.title,
              title: note.title,
              subtitle: note.tags?.join(', '),
              launch: {
                panelType: 'notes',
                payload: {
                  type: 'notes_show',
                  instance_id: instId,
                  title: note.title,
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

      for (const instId of targetInstances) {
        if (!instanceById.has(instId)) {
          continue;
        }
        const store = await getStore(instId);
        const notes = await store.search({ query: trimmed, limit });
        for (const note of notes) {
          results.push({
            id: note.title,
            title: note.title,
            subtitle: note.tags?.join(', '),
            snippet: note.snippet,
            launch: {
              panelType: 'notes',
              payload: {
                type: 'notes_show',
                instance_id: instId,
                title: note.title,
              },
            },
          });
        }
      }

      return results.slice(0, limit);
    },
  };

  return {
    searchProvider,
    operations: {
      instance_list: async (): Promise<PluginInstanceDefinition[]> => instances,
      list: async (args): Promise<NoteMetadata[]> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const tags = parseOptionalTags(parsed['tags']);
        const store = await getStore(instanceId);
        return store.list(tags !== undefined ? { tags } : undefined);
      },
      read: async (args): Promise<Note> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        return (await withNote(
          async () => (await getStore(instanceId)).read(title),
          title,
        )) as Note;
      },
      show: async (args, ctx): Promise<{ ok: true; panelId: string }> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        const panelIdRaw = parsed['panelId'];
        if (panelIdRaw !== undefined && typeof panelIdRaw !== 'string') {
          throw new ToolError('invalid_arguments', 'panelId must be a string when provided');
        }
        const panelId = typeof panelIdRaw === 'string' ? panelIdRaw.trim() : '';
        if (!panelId) {
          throw new ToolError('panel_not_found', 'panelId is required to show a note.');
        }
        const sessionHub = requireSessionHub(ctx);

        sessionHub.broadcastToAll({
          type: 'panel_event',
          panelId,
          panelType: 'notes',
          payload: {
            type: 'notes_show',
            instance_id: instanceId,
            title,
          },
        });

        return { ok: true, panelId };
      },
      write: async (args, ctx): Promise<NoteMetadata> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        const content = requireNonEmptyString(parsed['content'], 'content');
        const tags = parseOptionalTags(parsed['tags']);
        const store = await getStore(instanceId);
        const result = await store.write({
          title,
          content,
          ...(tags !== undefined ? { tags } : {}),
        });
        broadcastNotesUpdate(ctx, {
          instance_id: instanceId,
          title: result.title,
          action: 'note_updated',
          note: result,
        });
        return result;
      },
      rename: async (args, ctx): Promise<NoteMetadata> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        const newTitle = requireNonEmptyString(parsed['new_title'], 'new_title');
        if (newTitle === title) {
          throw new ToolError('invalid_arguments', 'new_title must be different from title');
        }
        const overwriteRaw = parsed['overwrite'];
        let overwrite = false;
        if (overwriteRaw !== undefined) {
          if (typeof overwriteRaw !== 'boolean') {
            throw new ToolError('invalid_arguments', 'overwrite must be a boolean');
          }
          overwrite = overwriteRaw;
        }
        const store = await getStore(instanceId);
        try {
          const result = await store.rename({ title, newTitle, overwrite });
          broadcastNotesUpdate(ctx, { instance_id: instanceId, title, action: 'note_deleted' });
          broadcastNotesUpdate(ctx, {
            instance_id: instanceId,
            title: result.title,
            action: 'note_updated',
            note: result,
          });
          return result;
        } catch (err) {
          const error = err as NodeJS.ErrnoException;
          if (error.code === 'ENOENT') {
            throw new ToolError('note_not_found', `Note not found: ${title}`);
          }
          if (error.code === 'EEXIST') {
            throw new ToolError('invalid_arguments', `Note already exists: ${newTitle}`);
          }
          throw err;
        }
      },
      move: async (args, ctx): Promise<NoteMetadata> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const targetInstanceId = resolveTargetInstanceId(parsed['target_instance_id']);
        if (targetInstanceId === instanceId) {
          throw new ToolError(
            'invalid_arguments',
            'target_instance_id must be different from instance_id',
          );
        }
        const title = requireNonEmptyString(parsed['title'], 'title');
        const overwriteRaw = parsed['overwrite'];
        let overwrite = false;
        if (overwriteRaw !== undefined) {
          if (typeof overwriteRaw !== 'boolean') {
            throw new ToolError('invalid_arguments', 'overwrite must be a boolean');
          }
          overwrite = overwriteRaw;
        }

        const sourceStore = await getStore(instanceId);
        const note = (await withNote(async () => sourceStore.read(title), title)) as Note;

        const targetStore = await getStore(targetInstanceId);
        if (!overwrite) {
          try {
            await targetStore.read(title);
            throw new ToolError(
              'invalid_arguments',
              `Note already exists in target instance: ${title}`,
            );
          } catch (err) {
            const error = err as NodeJS.ErrnoException;
            if (error.code !== 'ENOENT') {
              throw err;
            }
          }
        }

        const result = await targetStore.writeWithMetadata(note);
        broadcastNotesUpdate(ctx, {
          instance_id: targetInstanceId,
          title: result.title,
          action: 'note_updated',
          note: result,
        });
        await sourceStore.delete(title);
        broadcastNotesUpdate(ctx, { instance_id: instanceId, title, action: 'note_deleted' });
        return result;
      },
      delete: async (args, ctx): Promise<{ ok: true }> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        await withNote(async () => (await getStore(instanceId)).delete(title), title);
        broadcastNotesUpdate(ctx, { instance_id: instanceId, title, action: 'note_deleted' });
        return { ok: true };
      },
      search: async (args): Promise<NoteSearchResult[]> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const query = requireNonEmptyString(parsed['query'], 'query');
        const tags = parseOptionalTags(parsed['tags']);
        const limitRaw = parsed['limit'];
        let limit: number | undefined;
        if (limitRaw !== undefined) {
          if (typeof limitRaw !== 'number' || Number.isNaN(limitRaw)) {
            throw new ToolError('invalid_arguments', 'limit must be a number');
          }
          limit = limitRaw;
        }
        const store = await getStore(instanceId);
        return store.search({
          query,
          ...(tags !== undefined ? { tags } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
      },
      'tags-add': async (args, ctx): Promise<NoteMetadata> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        const tags = parseRequiredTags(parsed['tags']);
        const result = (await withNote(
          async () => (await getStore(instanceId)).addTags(title, tags),
          title,
        )) as NoteMetadata;
        broadcastNotesUpdate(ctx, {
          instance_id: instanceId,
          title,
          action: 'note_tags_updated',
          note: result,
        });
        return result;
      },
      'tags-remove': async (args, ctx): Promise<NoteMetadata> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        const tags = parseRequiredTags(parsed['tags']);
        const result = (await withNote(
          async () => (await getStore(instanceId)).removeTags(title, tags),
          title,
        )) as NoteMetadata;
        broadcastNotesUpdate(ctx, {
          instance_id: instanceId,
          title,
          action: 'note_tags_updated',
          note: result,
        });
        return result;
      },
    },
    async initialize(dataDir, pluginConfig): Promise<void> {
      await mkdir(dataDir, { recursive: true });
      baseDataDir = dataDir;
      instances = resolvePluginInstances('notes', pluginConfig);
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
