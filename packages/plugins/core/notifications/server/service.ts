import type { ServerMessage } from '@assistant/shared';

import type { SessionHub } from '../../../../agent-server/src/sessionHub';
import type { SessionIndex, SessionSummary } from '../../../../agent-server/src/sessionIndex';
import { NotificationsStore } from './store';
import type {
  CreateNotificationInput,
  NotificationRecord,
  NotificationSource,
} from './types';

const PANEL_TYPE = 'notifications';

type NotificationMutationEvent = 'created' | 'upserted' | 'updated' | 'removed' | 'snapshot';

interface NotificationEventPayload {
  type: 'notification_update';
  event: NotificationMutationEvent;
  revision: number;
  notification?: NotificationRecord;
  id?: string;
  notifications?: NotificationRecord[];
}

const NOTIFICATIONS_SERVICE_STATE_KEY = Symbol.for('assistant.notifications.service');

interface NotificationsServiceState {
  store: NotificationsStore | null;
}

type SessionTitleSummary = Pick<SessionSummary, 'name' | 'attributes'>;

function getNotificationsServiceState(): NotificationsServiceState {
  const globalState = globalThis as typeof globalThis & {
    [NOTIFICATIONS_SERVICE_STATE_KEY]?: NotificationsServiceState;
  };
  const existing = globalState[NOTIFICATIONS_SERVICE_STATE_KEY];
  if (existing) {
    return existing;
  }
  const created: NotificationsServiceState = { store: null };
  globalState[NOTIFICATIONS_SERVICE_STATE_KEY] = created;
  return created;
}

function requireStore(): NotificationsStore {
  const store = getNotificationsServiceState().store;
  if (!store) {
    throw new Error('Notifications service has not been initialized');
  }
  return store;
}

function buildPanelEvent(
  event: NotificationMutationEvent,
  revision: number,
  payload: Omit<NotificationEventPayload, 'type' | 'event' | 'revision'>,
): NotificationEventPayload {
  return { type: 'notification_update', event, revision, ...payload };
}

function buildPanelEventMessage(
  event: NotificationMutationEvent,
  revision: number,
  payload: Omit<NotificationEventPayload, 'type' | 'event' | 'revision'>,
): ServerMessage {
  return {
    type: 'panel_event',
    panelId: '*',
    panelType: PANEL_TYPE,
    sessionId: '*',
    payload: buildPanelEvent(event, revision, payload),
  };
}

async function resolveSessionTitle(
  sessionIndex: SessionIndex | undefined,
  sessionId: string | null | undefined,
): Promise<string | null> {
  if (!sessionId || !sessionIndex) {
    return null;
  }
  try {
    const session = await sessionIndex.getSession(sessionId);
    if (!session) {
      return sessionId;
    }
    return resolvePersistedSessionTitle(session);
  } catch {
    return sessionId;
  }
}

function resolvePersistedSessionTitle(summary: SessionTitleSummary | null | undefined): string | null {
  const name = typeof summary?.name === 'string' ? summary.name.trim() : '';
  if (name) {
    return name;
  }
  const attrs = summary?.attributes as
    | { core?: { autoTitle?: string | null } }
    | undefined;
  const autoTitle = typeof attrs?.core?.autoTitle === 'string' ? attrs.core.autoTitle.trim() : '';
  return autoTitle || null;
}

function broadcast(
  sessionHub: SessionHub | undefined,
  event: NotificationMutationEvent,
  revision: number,
  payload: Omit<NotificationEventPayload, 'type' | 'event' | 'revision'>,
): void {
  if (!sessionHub) {
    return;
  }
  sessionHub.broadcastToAll(buildPanelEventMessage(event, revision, payload));
}

export function initializeNotificationsService(dataDir: string): void {
  getNotificationsServiceState().store = new NotificationsStore(dataDir);
}

export function shutdownNotificationsService(): void {
  getNotificationsServiceState().store = null;
}

export function getNotificationsStore(): NotificationsStore {
  return requireStore();
}

export async function syncSessionNotificationTitles(options: {
  sessionId: string;
  summary: SessionTitleSummary | null | undefined;
  sessionHub?: SessionHub;
}): Promise<NotificationRecord[]> {
  const store = getNotificationsServiceState().store;
  if (!store) {
    return [];
  }

  const result = await store.updateSessionTitleWithRevision(
    options.sessionId,
    resolvePersistedSessionTitle(options.summary),
  );
  if (!result) {
    return [];
  }

  const snapshot = await store.snapshot();
  broadcast(options.sessionHub, 'snapshot', snapshot.revision, {
    notifications: snapshot.notifications,
  });
  return result.value;
}

export function buildNotificationPanelEventMessage(options: {
  event: NotificationMutationEvent;
  revision: number;
  notification?: NotificationRecord;
  id?: string;
  notifications?: NotificationRecord[];
}): ServerMessage {
  return buildPanelEventMessage(options.event, options.revision, {
    ...(options.notification ? { notification: options.notification } : {}),
    ...(options.id ? { id: options.id } : {}),
    ...(options.notifications ? { notifications: options.notifications } : {}),
  });
}

export async function createNotificationRecord(options: {
  input: CreateNotificationInput;
  source: NotificationSource;
  sessionHub?: SessionHub;
  sessionIndex?: SessionIndex;
}): Promise<{ notification: NotificationRecord; event: 'created' | 'upserted'; revision: number }> {
  const store = requireStore();
  const sessionId =
    typeof options.input.sessionId === 'string' && options.input.sessionId.trim().length > 0
      ? options.input.sessionId.trim()
      : null;
  const sessionTitle =
    options.input.sessionTitle !== undefined
      ? options.input.sessionTitle
      : await resolveSessionTitle(options.sessionIndex, sessionId);

  if (options.input.kind === 'session_attention') {
    if (!sessionId) {
      throw new Error('session_attention notifications require sessionId');
    }
    const { value: notification, revision } = await store.upsertSessionAttentionWithRevision(
      {
        title: options.input.title,
        body: options.input.body,
        sessionId,
        ...(sessionTitle !== undefined ? { sessionTitle } : {}),
        ...(options.input.tts !== undefined ? { tts: options.input.tts } : {}),
        ...(options.input.voiceMode !== undefined ? { voiceMode: options.input.voiceMode } : {}),
        ...(options.input.ttsText !== undefined ? { ttsText: options.input.ttsText } : {}),
        ...(options.input.sourceEventId !== undefined
          ? { sourceEventId: options.input.sourceEventId }
          : {}),
        ...(options.input.sessionActivitySeq !== undefined
          ? { sessionActivitySeq: options.input.sessionActivitySeq }
          : {}),
      },
      options.source,
    );
    broadcast(options.sessionHub, 'upserted', revision, { notification });
    return { notification, event: 'upserted', revision };
  }

  const { value: notification, revision } = await store.insertWithRevision(
    {
      ...options.input,
      sessionId,
      sessionTitle,
    },
    options.source,
  );
  broadcast(options.sessionHub, 'created', revision, { notification });
  return { notification, event: 'created', revision };
}

export async function clearSessionAttentionForReply(options: {
  sessionId: string;
  sessionHub?: SessionHub;
}): Promise<NotificationRecord | null> {
  const store = requireStore();
  const removed = await store.removeSessionAttentionWithRevision(options.sessionId);
  if (removed) {
    broadcast(options.sessionHub, 'removed', removed.revision, { id: removed.value.id });
  }
  return removed?.value ?? null;
}
