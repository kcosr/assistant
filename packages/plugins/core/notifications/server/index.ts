import type { CombinedPluginManifest } from '@assistant/shared';

import { ToolError } from '../../../../agent-server/src/tools';
import type {
  PluginModule,
  PanelEventHandler,
} from '../../../../agent-server/src/plugins/types';
import type { NotificationSource } from './types';
import {
  buildNotificationPanelEventMessage,
  clearSessionAttentionForReply,
  createNotificationRecord,
  getNotificationsStore,
  initializeNotificationsService,
  shutdownNotificationsService,
} from './service';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

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

const VALID_SOURCES = new Set<string>(['tool', 'http', 'cli', 'system']);

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  const panelEventHandler: PanelEventHandler = async (event, ctx) => {
    const store = getNotificationsStore();
    const payload = event.payload as Record<string, unknown> | undefined;
    if (!payload || typeof payload !== 'object') {
      return;
    }

    const eventType = payload['type'];

    if (eventType === 'request_snapshot') {
      const { notifications, revision } = await store.snapshot();
      ctx.sendToClient({
        ...buildNotificationPanelEventMessage({
          event: 'snapshot',
          revision,
          notifications,
        }),
        panelId: event.panelId,
      });
    } else if (eventType === 'toggle_read') {
      const id = payload['id'];
      if (typeof id !== 'string') {
        return;
      }
      const result = await store.toggleReadWithRevision(id);
      if (result) {
        ctx.sendToAll(
          buildNotificationPanelEventMessage({
            event: 'updated',
            revision: result.revision,
            notification: result.value,
          }),
        );
      }
    } else if (eventType === 'mark_all_read') {
      const { notifications, revision } = await store.markAllReadSnapshot();
      ctx.sendToAll(
        buildNotificationPanelEventMessage({
          event: 'snapshot',
          revision,
          notifications,
        }),
      );
    } else if (eventType === 'clear') {
      const id = payload['id'];
      if (typeof id !== 'string') {
        return;
      }
      const removed = await store.removeWithRevision(id);
      if (removed) {
        ctx.sendToAll(
          buildNotificationPanelEventMessage({
            event: 'removed',
            revision: removed.revision,
            id,
          }),
        );
      }
    } else if (eventType === 'clear_session_attention') {
      const sessionId = payload['sessionId'];
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        return;
      }
      await clearSessionAttentionForReply({ sessionId, sessionHub: ctx.sessionHub });
    } else if (eventType === 'clear_all') {
      const { count, notifications, revision } = await store.removeAllSnapshot();
      if (count > 0) {
        ctx.sendToAll(
          buildNotificationPanelEventMessage({
            event: 'snapshot',
            revision,
            notifications,
          }),
        );
      }
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
        const kind =
          parsed['kind'] === 'session_attention' ? 'session_attention' : 'notification';
        const voiceMode =
          parsed['voiceMode'] === 'speak' ||
          parsed['voiceMode'] === 'speak_then_listen' ||
          parsed['voiceMode'] === 'none'
            ? parsed['voiceMode']
            : undefined;
        const ttsText =
          typeof parsed['ttsText'] === 'string' && parsed['ttsText'].trim()
            ? parsed['ttsText'].trim()
            : null;
        const sourceEventId =
          typeof parsed['sourceEventId'] === 'string' && parsed['sourceEventId'].trim()
            ? parsed['sourceEventId'].trim()
            : null;
        const sessionActivitySeq =
          typeof parsed['sessionActivitySeq'] === 'number' &&
          Number.isFinite(parsed['sessionActivitySeq'])
            ? Math.trunc(parsed['sessionActivitySeq'])
            : null;

        const { notification } = await createNotificationRecord({
          input: {
            kind,
            title,
            body,
            sessionId,
            tts,
            ...(voiceMode ? { voiceMode } : {}),
            ...(ttsText ? { ttsText } : {}),
            ...(sourceEventId ? { sourceEventId } : {}),
            ...(sessionActivitySeq !== null ? { sessionActivitySeq } : {}),
          },
          source,
          sessionHub: ctx.sessionHub,
          sessionIndex: ctx.sessionIndex,
        });
        return notification;
      },

      list: async (args) => {
        const store = getNotificationsStore();
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
        const store = getNotificationsStore();
        const parsed = asObject(args);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const notification = await store.get(id);
        if (!notification) {
          throw new ToolError('not_found', `Notification not found: ${id}`);
        }
        return notification;
      },

      toggle_read: async (args, ctx) => {
        const store = getNotificationsStore();
        const parsed = asObject(args);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const result = await store.toggleReadWithRevision(id);
        if (!result) {
          throw new ToolError('not_found', `Notification not found: ${id}`);
        }
        ctx.sessionHub?.broadcastToAll(
          buildNotificationPanelEventMessage({
            event: 'updated',
            revision: result.revision,
            notification: result.value,
          }),
        );
        return result.value;
      },

      mark_all_read: async (_args, ctx) => {
        const store = getNotificationsStore();
        const { count, notifications, revision } = await store.markAllReadSnapshot();
        ctx.sessionHub?.broadcastToAll(
          buildNotificationPanelEventMessage({
            event: 'snapshot',
            revision,
            notifications,
          }),
        );
        return { marked: count };
      },

      clear: async (args, ctx) => {
        const store = getNotificationsStore();
        const parsed = asObject(args);
        const id = requireNonEmptyString(parsed['id'], 'id');
        const removed = await store.removeWithRevision(id);
        if (!removed) {
          throw new ToolError('not_found', `Notification not found: ${id}`);
        }
        ctx.sessionHub?.broadcastToAll(
          buildNotificationPanelEventMessage({
            event: 'removed',
            revision: removed.revision,
            id,
          }),
        );
        return { ok: true };
      },

      clear_all: async (_args, ctx) => {
        const store = getNotificationsStore();
        const { count, notifications, revision } = await store.removeAllSnapshot();
        if (count > 0) {
          ctx.sessionHub?.broadcastToAll(
            buildNotificationPanelEventMessage({
              event: 'snapshot',
              revision,
              notifications,
            }),
          );
        }
        return { cleared: count };
      },
    },

    panelEventHandlers: {
      notifications: panelEventHandler,
    },

    async initialize(dataDir): Promise<void> {
      initializeNotificationsService(dataDir);
    },

    async shutdown(): Promise<void> {
      shutdownNotificationsService();
    },
  };
}
