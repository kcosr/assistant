import type { CombinedPluginManifest } from '@assistant/shared';

import type { ToolContext } from '../../../../agent-server/src/tools';
import { ToolError } from '../../../../agent-server/src/tools';
import type {
  PluginModule,
  PanelEventHandler,
  PanelEventHandlerContext,
} from '../../../../agent-server/src/plugins/types';
import { NotificationsStore } from './store';
import type { NotificationRecord, NotificationSource } from './types';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

const PANEL_TYPE = 'notifications';

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

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

interface NotificationEventPayload {
  type: 'notification_update';
  event: 'created' | 'updated' | 'removed' | 'snapshot';
  revision: number;
  notification?: NotificationRecord;
  id?: string;
  notifications?: NotificationRecord[];
}

function buildPanelEvent(
  event: NotificationEventPayload['event'],
  revision: number,
  payload: Omit<NotificationEventPayload, 'type' | 'event' | 'revision'>,
): NotificationEventPayload {
  return { type: 'notification_update', event, revision, ...payload };
}

function broadcastNotificationEvent(
  ctx: ToolContext,
  event: NotificationEventPayload['event'],
  revision: number,
  payload: Omit<NotificationEventPayload, 'type' | 'event' | 'revision'>,
): void {
  const sessionHub = ctx.sessionHub;
  if (!sessionHub) {
    return;
  }
  sessionHub.broadcastToAll({
    type: 'panel_event',
    panelId: '*',
    panelType: PANEL_TYPE,
    sessionId: '*',
    payload: buildPanelEvent(event, revision, payload),
  });
}

function broadcastFromPanelCtx(
  ctx: PanelEventHandlerContext,
  event: NotificationEventPayload['event'],
  revision: number,
  payload: Omit<NotificationEventPayload, 'type' | 'event' | 'revision'>,
): void {
  ctx.sendToAll({
    type: 'panel_event',
    panelId: '*',
    panelType: PANEL_TYPE,
    sessionId: '*',
    payload: buildPanelEvent(event, revision, payload),
  });
}

async function resolveSessionTitle(
  ctx: ToolContext,
  sessionId: string | null | undefined,
): Promise<string | null> {
  if (!sessionId || !ctx.sessionIndex) {
    return null;
  }
  try {
    const session = await ctx.sessionIndex.getSession(sessionId);
    if (!session) {
      return sessionId;
    }
    const attrs = session.attributes as
      | { core?: { autoTitle?: string } }
      | undefined;
    return (
      session.name ??
      attrs?.core?.autoTitle ??
      session.lastSnippet ??
      sessionId
    );
  } catch {
    return sessionId;
  }
}

const VALID_SOURCES = new Set<string>(['tool', 'http', 'cli']);

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  let store: NotificationsStore;

  const panelEventHandler: PanelEventHandler = async (event, ctx) => {
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const eventType = payload['type'];

    if (eventType === 'request_snapshot') {
      const { notifications, revision } = await store.snapshot();
      ctx.sendToClient({
        type: 'panel_event',
        panelId: event.panelId,
        panelType: PANEL_TYPE,
        payload: buildPanelEvent('snapshot', revision, { notifications }),
      });
    } else if (eventType === 'toggle_read') {
      const id = payload['id'];
      if (typeof id !== 'string') {
        return;
      }
      const notification = await store.toggleRead(id);
      if (notification) {
        broadcastFromPanelCtx(ctx, 'updated', store.revision, { notification });
      }
    } else if (eventType === 'mark_all_read') {
      await store.markAllRead();
      const { notifications, revision } = await store.snapshot();
      broadcastFromPanelCtx(ctx, 'snapshot', revision, { notifications });
    } else if (eventType === 'clear') {
      const id = payload['id'];
      if (typeof id !== 'string') {
        return;
      }
      const removed = await store.remove(id);
      if (removed) {
        broadcastFromPanelCtx(ctx, 'removed', store.revision, { id });
      }
    } else if (eventType === 'clear_all') {
      await store.removeAll();
      broadcastFromPanelCtx(ctx, 'snapshot', store.revision, { notifications: [] });
    }
  };

  return {
    operations: {
      create: async (args, ctx) => {
        const parsed = asObject(args);
        const title = requireNonEmptyString(parsed['title'], 'title');
        const body = requireNonEmptyString(parsed['body'], 'body');
        const sessionId =
          typeof parsed['sessionId'] === 'string' && parsed['sessionId'].trim()
            ? parsed['sessionId'].trim()
            : null;
        const tts = parsed['tts'] === true;
        const rawSource = typeof parsed['source'] === 'string' ? parsed['source'] : 'tool';
        const source: NotificationSource = VALID_SOURCES.has(rawSource)
          ? (rawSource as NotificationSource)
          : 'tool';

        const sessionTitle = await resolveSessionTitle(ctx, sessionId);

        const notification = await store.insert(
          { title, body, sessionId, sessionTitle, tts },
          source,
        );

        broadcastNotificationEvent(ctx, 'created', store.revision, { notification });

        return notification;
      },

      list: async (args) => {
        const parsed = asObject(args);
        const unreadOnly = parsed['unreadOnly'] === true;
        const limit =
          typeof parsed['limit'] === 'number' && parsed['limit'] > 0
            ? Math.floor(parsed['limit'])
            : undefined;
        const offset =
          typeof parsed['offset'] === 'number' && parsed['offset'] >= 0
            ? Math.floor(parsed['offset'])
            : undefined;

        return store.list({ unreadOnly, limit, offset });
      },

      get: async (args) => {
        const parsed = asObject(args);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const notification = await store.get(id);
        if (!notification) {
          throw new ToolError('not_found', `Notification not found: ${id}`);
        }
        return notification;
      },

      toggle_read: async (args, ctx) => {
        const parsed = asObject(args);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const notification = await store.toggleRead(id);
        if (!notification) {
          throw new ToolError('not_found', `Notification not found: ${id}`);
        }
        broadcastNotificationEvent(ctx, 'updated', store.revision, { notification });
        return notification;
      },

      mark_all_read: async (_args, ctx) => {
        const count = await store.markAllRead();
        const { notifications, revision } = await store.snapshot();
        broadcastNotificationEvent(ctx, 'snapshot', revision, { notifications });
        return { marked: count };
      },

      clear: async (args, ctx) => {
        const parsed = asObject(args);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const removed = await store.remove(id);
        if (!removed) {
          throw new ToolError('not_found', `Notification not found: ${id}`);
        }
        broadcastNotificationEvent(ctx, 'removed', store.revision, { id });
        return { ok: true };
      },

      clear_all: async (_args, ctx) => {
        const count = await store.removeAll();
        broadcastNotificationEvent(ctx, 'snapshot', store.revision, { notifications: [] });
        return { cleared: count };
      },
    },

    panelEventHandlers: {
      notifications: panelEventHandler,
    },

    async initialize(dataDir): Promise<void> {
      store = new NotificationsStore(dataDir);
    },

    async shutdown(): Promise<void> {
      // No cleanup needed — store is file-based
    },
  };
}
