import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type {
  PluginModule,
  PanelEventHandler,
} from '../../../../agent-server/src/plugins/types';
import {
  DEFAULT_PLUGIN_INSTANCE_ID,
  normalizePluginInstanceId,
  resolvePluginInstanceDataDir,
  resolvePluginInstances,
  type PluginInstanceDefinition,
} from '../../../../agent-server/src/plugins/instances';
import { ArtifactsStore, type ArtifactMetadata } from './store';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

const DEFAULT_MAX_FILE_SIZE_MB = 64;

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

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} must be a string`);
  }
  return value.trim() || undefined;
}

type ArtifactsUpdateAction = 'artifact_uploaded' | 'artifact_updated' | 'artifact_renamed' | 'artifact_deleted';

type ArtifactsPanelUpdate = {
  instance_id: string;
  action: ArtifactsUpdateAction;
  artifact?: ArtifactMetadata;
  artifactId?: string;
};

function broadcastArtifactsUpdate(ctx: ToolContext, update: ArtifactsPanelUpdate): void {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    return;
  }
  sessionHub.broadcastToAll({
    type: 'panel_event',
    panelId: '*',
    panelType: 'artifacts',
    sessionId: '*',
    payload: {
      type: 'panel_update',
      ...update,
    },
  });
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let baseDataDir = '';
  let instances: PluginInstanceDefinition[] = [];
  let instanceById = new Map<string, PluginInstanceDefinition>();
  let maxFileSizeMb = DEFAULT_MAX_FILE_SIZE_MB;
  const stores = new Map<string, ArtifactsStore>();

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

  const getStore = async (instanceId: string): Promise<ArtifactsStore> => {
    const existing = stores.get(instanceId);
    if (existing) {
      return existing;
    }
    if (!baseDataDir) {
      throw new ToolError('plugin_not_initialized', 'Artifacts plugin has not been initialized');
    }
    const instanceDir = resolvePluginInstanceDataDir(baseDataDir, instanceId);
    await mkdir(instanceDir, { recursive: true });
    const store = new ArtifactsStore(instanceDir, maxFileSizeMb);
    stores.set(instanceId, store);
    return store;
  };

  const panelEventHandler: PanelEventHandler = async (event, ctx) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const eventType = payload['type'];

    if (eventType === 'request_list') {
      const instanceId = resolveInstanceId(payload['instance_id']);
      const store = await getStore(instanceId);
      const artifacts = await store.list();
      ctx.sendToClient({
        type: 'panel_event',
        panelId: event.panelId,
        panelType: 'artifacts',
        payload: {
          type: 'list_response',
          instance_id: instanceId,
          artifacts,
        },
      });
    } else if (eventType === 'request_instances') {
      ctx.sendToClient({
        type: 'panel_event',
        panelId: event.panelId,
        panelType: 'artifacts',
        payload: {
          type: 'instances_response',
          instances: instances.map((i) => ({ id: i.id, label: i.label })),
        },
      });
    } else if (eventType === 'upload') {
      const instanceId = resolveInstanceId(payload['instance_id']);
      const title = requireNonEmptyString(payload['title'], 'title');
      const filename = requireNonEmptyString(payload['filename'], 'filename');
      const contentBase64 = requireNonEmptyString(payload['content'], 'content');
      const mimeType = parseOptionalString(payload['mimeType'], 'mimeType');

      const content = Buffer.from(contentBase64, 'base64');
      const store = await getStore(instanceId);
      
      try {
        const artifact = await store.upload({ title, filename, content, mimeType });
        ctx.sendToClient({
          type: 'panel_event',
          panelId: event.panelId,
          panelType: 'artifacts',
          payload: {
            type: 'upload_response',
            ok: true,
            artifact,
          },
        });
        // Broadcast to all panels
        ctx.sendToAll({
          type: 'panel_event',
          panelId: '*',
          panelType: 'artifacts',
          sessionId: '*',
          payload: {
            type: 'panel_update',
            instance_id: instanceId,
            action: 'artifact_uploaded',
            artifact,
          },
        });
      } catch (err) {
        ctx.sendToClient({
          type: 'panel_event',
          panelId: event.panelId,
          panelType: 'artifacts',
          payload: {
            type: 'upload_response',
            ok: false,
            error: err instanceof Error ? err.message : 'Upload failed',
          },
        });
      }
    } else if (eventType === 'rename') {
      const instanceId = resolveInstanceId(payload['instance_id']);
      const id = requireNonEmptyString(payload['id'], 'id');
      const title = requireNonEmptyString(payload['title'], 'title');

      const store = await getStore(instanceId);
      
      try {
        const artifact = await store.rename(id, title);
        ctx.sendToClient({
          type: 'panel_event',
          panelId: event.panelId,
          panelType: 'artifacts',
          payload: {
            type: 'rename_response',
            ok: true,
            artifact,
          },
        });
        ctx.sendToAll({
          type: 'panel_event',
          panelId: '*',
          panelType: 'artifacts',
          sessionId: '*',
          payload: {
            type: 'panel_update',
            instance_id: instanceId,
            action: 'artifact_renamed',
            artifact,
          },
        });
      } catch (err) {
        ctx.sendToClient({
          type: 'panel_event',
          panelId: event.panelId,
          panelType: 'artifacts',
          payload: {
            type: 'rename_response',
            ok: false,
            error: err instanceof Error ? err.message : 'Rename failed',
          },
        });
      }
    } else if (eventType === 'delete') {
      const instanceId = resolveInstanceId(payload['instance_id']);
      const id = requireNonEmptyString(payload['id'], 'id');

      const store = await getStore(instanceId);
      
      try {
        await store.delete(id);
        ctx.sendToClient({
          type: 'panel_event',
          panelId: event.panelId,
          panelType: 'artifacts',
          payload: {
            type: 'delete_response',
            ok: true,
          },
        });
        ctx.sendToAll({
          type: 'panel_event',
          panelId: '*',
          panelType: 'artifacts',
          sessionId: '*',
          payload: {
            type: 'panel_update',
            instance_id: instanceId,
            action: 'artifact_deleted',
            artifactId: id,
          },
        });
      } catch (err) {
        ctx.sendToClient({
          type: 'panel_event',
          panelId: event.panelId,
          panelType: 'artifacts',
          payload: {
            type: 'delete_response',
            ok: false,
            error: err instanceof Error ? err.message : 'Delete failed',
          },
        });
      }
    }
  };

  return {
    operations: {
      instance_list: async (): Promise<{ id: string; label: string }[]> => {
        return instances.map((i) => ({ id: i.id, label: i.label }));
      },

      list: async (args, _ctx): Promise<ArtifactMetadata[]> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const store = await getStore(instanceId);
        return store.list();
      },

      upload: async (args, ctx): Promise<ArtifactMetadata & { url: string }> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const title = requireNonEmptyString(parsed['title'], 'title');
        const filename = requireNonEmptyString(parsed['filename'], 'filename');
        const contentBase64 = requireNonEmptyString(parsed['content'], 'content');
        const mimeType = parseOptionalString(parsed['mimeType'], 'mimeType');

        const content = Buffer.from(contentBase64, 'base64');
        const store = await getStore(instanceId);
        const artifact = await store.upload({ title, filename, content, mimeType });

        broadcastArtifactsUpdate(ctx, {
          instance_id: instanceId,
          action: 'artifact_uploaded',
          artifact,
        });

        return {
          ...artifact,
          url: `/api/plugins/artifacts/files/${instanceId}/${artifact.id}`,
        };
      },

      get: async (args, _ctx): Promise<{
        id: string;
        title: string;
        filename: string;
        mimeType: string;
        size: number;
        content: string;
      }> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');

        const store = await getStore(instanceId);
        const { content, artifact } = await store.getFileContent(id);

        return {
          id: artifact.id,
          title: artifact.title,
          filename: artifact.filename,
          mimeType: artifact.mimeType,
          size: artifact.size,
          content: content.toString('base64'),
        };
      },

      update: async (args, ctx): Promise<ArtifactMetadata & { url: string }> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const filename = requireNonEmptyString(parsed['filename'], 'filename');
        const contentBase64 = requireNonEmptyString(parsed['content'], 'content');
        const mimeType = parseOptionalString(parsed['mimeType'], 'mimeType');

        const content = Buffer.from(contentBase64, 'base64');
        const store = await getStore(instanceId);
        const artifact = await store.update(id, { filename, content, mimeType });

        broadcastArtifactsUpdate(ctx, {
          instance_id: instanceId,
          action: 'artifact_updated',
          artifact,
        });

        return {
          ...artifact,
          url: `/api/plugins/artifacts/files/${instanceId}/${artifact.id}`,
        };
      },

      rename: async (args, ctx): Promise<ArtifactMetadata> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const title = requireNonEmptyString(parsed['title'], 'title');

        const store = await getStore(instanceId);
        const artifact = await store.rename(id, title);

        broadcastArtifactsUpdate(ctx, {
          instance_id: instanceId,
          action: 'artifact_renamed',
          artifact,
        });

        return artifact;
      },

      delete: async (args, ctx): Promise<{ ok: true }> => {
        const parsed = asObject(args);
        const instanceId = resolveInstanceId(parsed['instance_id']);
        const id = requireNonEmptyString(parsed['id'], 'id');

        const store = await getStore(instanceId);
        await store.delete(id);

        broadcastArtifactsUpdate(ctx, {
          instance_id: instanceId,
          action: 'artifact_deleted',
          artifactId: id,
        });

        return { ok: true };
      },
    },

    extraHttpRoutes: [
      async (_context, req, res, url, segments, _helpers) => {
        // Handle file serving: GET /api/plugins/artifacts/files/:instanceId/:artifactId
        // Use ?download=1 to force download, otherwise serve inline for viewing
        if (
          req.method === 'GET' &&
          segments.length === 6 &&
          segments[0] === 'api' &&
          segments[1] === 'plugins' &&
          segments[2] === 'artifacts' &&
          segments[3] === 'files'
        ) {
          const instanceId = segments[4];
          const artifactId = segments[5];
          const forceDownload = url.searchParams.get('download') === '1';

          try {
            const normalizedInstanceId = normalizePluginInstanceId(instanceId);
            if (!normalizedInstanceId || !instanceById.has(normalizedInstanceId)) {
              res.statusCode = 404;
              res.end('Instance not found');
              return true;
            }

            const store = await getStore(normalizedInstanceId);
            const { content, artifact } = await store.getFileContent(artifactId);

            res.setHeader('Content-Type', artifact.mimeType);
            res.setHeader('Content-Length', content.length);
            
            // Use 'inline' to display in browser, 'attachment' to force download
            const disposition = forceDownload ? 'attachment' : 'inline';
            res.setHeader(
              'Content-Disposition',
              `${disposition}; filename="${encodeURIComponent(artifact.filename)}"`,
            );
            res.statusCode = 200;
            res.end(content);
            return true;
          } catch {
            res.statusCode = 404;
            res.end('Artifact not found');
            return true;
          }
        }

        return false;
      },
    ],

    panelEventHandlers: {
      artifacts: panelEventHandler,
    },

    async initialize(dataDir, pluginConfig): Promise<void> {
      baseDataDir = dataDir;
      instances = resolvePluginInstances(pluginConfig);
      instanceById = new Map(instances.map((i) => [i.id, i]));

      // Read max file size from config
      const configMaxSize = pluginConfig?.maxFileSizeMb;
      if (typeof configMaxSize === 'number' && configMaxSize > 0) {
        maxFileSizeMb = configMaxSize;
      }
    },

    async shutdown(): Promise<void> {
      stores.clear();
    },
  };
}
