import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import type {
  NotificationRecord,
  NotificationSource,
  NotificationKind,
  NotificationVoiceMode,
  NotificationListOptions,
  NotificationListResult,
} from './types';

interface StoreData {
  notifications: NotificationRecord[];
}

export interface NotificationSnapshot {
  notifications: NotificationRecord[];
  total: number;
  revision: number;
}

export interface NotificationMutationResult<T> {
  value: T;
  revision: number;
}

const DEFAULT_MAX_NOTIFICATIONS = 500;
const DEFAULT_KIND: NotificationKind = 'notification';

function normalizeKind(value: unknown): NotificationKind {
  return value === 'session_attention' ? 'session_attention' : DEFAULT_KIND;
}

function normalizeSource(value: unknown): NotificationSource {
  switch (value) {
    case 'http':
    case 'cli':
    case 'system':
    case 'tool':
      return value;
    default:
      return 'tool';
  }
}

function normalizeVoiceMode(
  value: unknown,
  tts: boolean,
): NotificationVoiceMode {
  switch (value) {
    case 'speak':
    case 'speak_then_listen':
    case 'none':
      return value;
    default:
      return tts ? 'speak' : 'none';
  }
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

function normalizeStoredNotification(value: NotificationRecord): NotificationRecord {
  const tts = value.tts === true;
  return {
    id: value.id,
    kind: normalizeKind((value as NotificationRecord & { kind?: unknown }).kind),
    title: value.title,
    body: value.body,
    createdAt: value.createdAt,
    readAt: value.readAt ?? null,
    source: normalizeSource(value.source),
    sessionId: normalizeNullableString(value.sessionId),
    sessionTitle: normalizeNullableString(value.sessionTitle),
    tts,
    voiceMode: normalizeVoiceMode(
      (value as NotificationRecord & { voiceMode?: unknown }).voiceMode,
      tts,
    ),
    ttsText: normalizeNullableString((value as NotificationRecord & { ttsText?: unknown }).ttsText),
    sourceEventId: normalizeNullableString(
      (value as NotificationRecord & { sourceEventId?: unknown }).sourceEventId,
    ),
    sessionActivitySeq: normalizeNullableNumber(
      (value as NotificationRecord & { sessionActivitySeq?: unknown }).sessionActivitySeq,
    ),
  };
}

export class NotificationsStore {
  private dataPath: string;
  private data: StoreData = { notifications: [] };
  private loaded = false;
  private maxNotifications: number;
  private _revision = 0;

  // Mutex: all public methods that touch state run through this queue
  // so that load+mutate+save is fully serialized.
  private opQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    maxNotifications: number = DEFAULT_MAX_NOTIFICATIONS,
  ) {
    this.dataPath = path.join(dataDir, 'notifications.json');
    this.maxNotifications = maxNotifications;
  }

  get revision(): number {
    return this._revision;
  }

  /** Run `fn` exclusively — no other operation can interleave. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.opQueue.then(fn, fn);
    // Keep the queue going even if fn rejects; callers get the rejection.
    this.opQueue = next.catch(() => {});
    return next;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    await mkdir(this.dataDir, { recursive: true });
    try {
      const content = await readFile(this.dataPath, 'utf-8');
      const parsed = JSON.parse(content) as StoreData;
      if (Array.isArray(parsed.notifications)) {
        this.data = {
          notifications: parsed.notifications
            .filter((notification): notification is NotificationRecord => !!notification)
            .map(normalizeStoredNotification),
        };
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        throw err;
      }
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await writeFile(this.dataPath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private bumpRevision(): void {
    this._revision++;
  }

  private sortNewestFirst(): void {
    this.data.notifications.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  private pruneIfNeeded(): void {
    if (this.data.notifications.length <= this.maxNotifications) {
      return;
    }
    // Remove oldest read notifications first.
    // Note: unread notifications are never pruned — if unread count exceeds
    // the cap, the store grows beyond maxNotifications. This is intentional
    // to avoid silently discarding unread items.
    const read = this.data.notifications.filter((n) => n.readAt !== null);
    const unread = this.data.notifications.filter((n) => n.readAt === null);

    if (read.length + unread.length > this.maxNotifications) {
      const readToKeep = Math.max(0, this.maxNotifications - unread.length);
      const keptRead = read.slice(0, readToKeep);
      this.data.notifications = [...unread, ...keptRead];
      this.sortNewestFirst();
    }
  }

  async insert(
    input: {
      kind?: NotificationKind;
      title: string;
      body: string;
      sessionId?: string | null;
      sessionTitle?: string | null;
      tts?: boolean;
      voiceMode?: NotificationVoiceMode;
      ttsText?: string | null;
      sourceEventId?: string | null;
      sessionActivitySeq?: number | null;
    },
    source: NotificationSource,
  ): Promise<NotificationRecord> {
    const { value } = await this.insertWithRevision(input, source);
    return value;
  }

  async insertWithRevision(
    input: {
      kind?: NotificationKind;
      title: string;
      body: string;
      sessionId?: string | null;
      sessionTitle?: string | null;
      tts?: boolean;
      voiceMode?: NotificationVoiceMode;
      ttsText?: string | null;
      sourceEventId?: string | null;
      sessionActivitySeq?: number | null;
    },
    source: NotificationSource,
  ): Promise<NotificationMutationResult<NotificationRecord>> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      const tts = input.tts ?? false;
      const record: NotificationRecord = {
        id: crypto.randomUUID(),
        kind: input.kind ?? DEFAULT_KIND,
        title: input.title,
        body: input.body,
        createdAt: new Date().toISOString(),
        readAt: null,
        source,
        sessionId: input.sessionId ?? null,
        sessionTitle: input.sessionTitle ?? null,
        tts,
        voiceMode: input.voiceMode ?? (tts ? 'speak' : 'none'),
        ttsText: input.ttsText ?? null,
        sourceEventId: input.sourceEventId ?? null,
        sessionActivitySeq: input.sessionActivitySeq ?? null,
      };

      this.data.notifications.unshift(record);
      this.pruneIfNeeded();
      this.bumpRevision();
      await this.save();

      return { value: record, revision: this._revision };
    });
  }

  async upsertSessionAttention(
    input: {
      title: string;
      body: string;
      sessionId: string;
      sessionTitle?: string | null;
      tts?: boolean;
      voiceMode?: NotificationVoiceMode;
      ttsText?: string | null;
      sourceEventId?: string | null;
      sessionActivitySeq?: number | null;
    },
    source: NotificationSource,
  ): Promise<NotificationRecord> {
    const { value } = await this.upsertSessionAttentionWithRevision(input, source);
    return value;
  }

  async upsertSessionAttentionWithRevision(
    input: {
      title: string;
      body: string;
      sessionId: string;
      sessionTitle?: string | null;
      tts?: boolean;
      voiceMode?: NotificationVoiceMode;
      ttsText?: string | null;
      sourceEventId?: string | null;
      sessionActivitySeq?: number | null;
    },
    source: NotificationSource,
  ): Promise<NotificationMutationResult<NotificationRecord>> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      const sessionId = input.sessionId.trim();
      const existingIndex = this.data.notifications.findIndex(
        (notification) =>
          notification.kind === 'session_attention' && notification.sessionId === sessionId,
      );
      const tts = input.tts ?? false;
      const now = new Date().toISOString();

      const record: NotificationRecord =
        existingIndex >= 0
          ? {
              ...this.data.notifications[existingIndex]!,
              kind: 'session_attention',
              title: input.title,
              body: input.body,
              createdAt: now,
              readAt: null,
              source,
              sessionId,
              sessionTitle: input.sessionTitle ?? null,
              tts,
              voiceMode: input.voiceMode ?? (tts ? 'speak' : 'none'),
              ttsText: input.ttsText ?? null,
              sourceEventId: input.sourceEventId ?? null,
              sessionActivitySeq: input.sessionActivitySeq ?? null,
            }
          : {
              id: crypto.randomUUID(),
              kind: 'session_attention',
              title: input.title,
              body: input.body,
              createdAt: now,
              readAt: null,
              source,
              sessionId,
              sessionTitle: input.sessionTitle ?? null,
              tts,
              voiceMode: input.voiceMode ?? (tts ? 'speak' : 'none'),
              ttsText: input.ttsText ?? null,
              sourceEventId: input.sourceEventId ?? null,
              sessionActivitySeq: input.sessionActivitySeq ?? null,
            };

      if (existingIndex >= 0) {
        this.data.notifications.splice(existingIndex, 1);
      }
      this.data.notifications.unshift(record);
      this.pruneIfNeeded();
      this.bumpRevision();
      await this.save();

      return { value: record, revision: this._revision };
    });
  }

  async list(options: NotificationListOptions = {}): Promise<NotificationListResult> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      let filtered = this.data.notifications;
      if (options.unreadOnly) {
        filtered = filtered.filter((n) => n.readAt === null);
      }

      const total = filtered.length;
      const offset = options.offset ?? 0;
      const limit = options.limit ?? filtered.length;
      const notifications = filtered.slice(offset, offset + limit);

      return { notifications, total };
    });
  }

  /** Return the full notification list with the current revision, atomically. */
  async snapshot(options: NotificationListOptions = {}): Promise<NotificationSnapshot> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      let filtered = this.data.notifications;
      if (options.unreadOnly) {
        filtered = filtered.filter((n) => n.readAt === null);
      }

      const total = filtered.length;
      const offset = options.offset ?? 0;
      const limit = options.limit ?? filtered.length;
      const notifications = filtered.slice(offset, offset + limit);

      return { notifications, total, revision: this._revision };
    });
  }

  async get(id: string): Promise<NotificationRecord | null> {
    return this.exclusive(async () => {
      await this.ensureLoaded();
      return this.data.notifications.find((n) => n.id === id) ?? null;
    });
  }

  async toggleRead(id: string): Promise<NotificationRecord | null> {
    const result = await this.toggleReadWithRevision(id);
    return result?.value ?? null;
  }

  async toggleReadWithRevision(
    id: string,
  ): Promise<NotificationMutationResult<NotificationRecord> | null> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      const notification = this.data.notifications.find((n) => n.id === id);
      if (!notification) {
        return null;
      }

      notification.readAt = notification.readAt === null ? new Date().toISOString() : null;
      this.bumpRevision();
      await this.save();

      return { value: notification, revision: this._revision };
    });
  }

  async markAllRead(): Promise<number> {
    const result = await this.markAllReadSnapshot();
    return result.count;
  }

  async markAllReadSnapshot(): Promise<NotificationSnapshot & { count: number }> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      let count = 0;
      const now = new Date().toISOString();
      for (const notification of this.data.notifications) {
        if (notification.readAt === null) {
          notification.readAt = now;
          count++;
        }
      }

      if (count > 0) {
        this.bumpRevision();
        await this.save();
      }

      return {
        count,
        notifications: [...this.data.notifications],
        total: this.data.notifications.length,
        revision: this._revision,
      };
    });
  }

  async markAllUnread(): Promise<number> {
    const result = await this.markAllUnreadSnapshot();
    return result.count;
  }

  async markAllUnreadSnapshot(): Promise<NotificationSnapshot & { count: number }> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      let count = 0;
      for (const notification of this.data.notifications) {
        if (notification.readAt !== null) {
          notification.readAt = null;
          count++;
        }
      }

      if (count > 0) {
        this.bumpRevision();
        await this.save();
      }

      return {
        count,
        notifications: [...this.data.notifications],
        total: this.data.notifications.length,
        revision: this._revision,
      };
    });
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.removeWithRevision(id);
    return result !== null;
  }

  async removeWithRevision(id: string): Promise<NotificationMutationResult<true> | null> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      const index = this.data.notifications.findIndex((n) => n.id === id);
      if (index === -1) {
        return null;
      }

      this.data.notifications.splice(index, 1);
      this.bumpRevision();
      await this.save();

      return { value: true, revision: this._revision };
    });
  }

  async removeSessionAttention(sessionId: string): Promise<NotificationRecord | null> {
    const result = await this.removeSessionAttentionWithRevision(sessionId);
    return result?.value ?? null;
  }

  async removeSessionAttentionWithRevision(
    sessionId: string,
  ): Promise<NotificationMutationResult<NotificationRecord> | null> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      const normalizedSessionId = sessionId.trim();
      const index = this.data.notifications.findIndex(
        (notification) =>
          notification.kind === 'session_attention' &&
          notification.sessionId === normalizedSessionId,
      );
      if (index === -1) {
        return null;
      }

      const [removed] = this.data.notifications.splice(index, 1);
      this.bumpRevision();
      await this.save();

      return removed ? { value: removed, revision: this._revision } : null;
    });
  }

  async removeAll(): Promise<number> {
    const result = await this.removeAllSnapshot();
    return result.count;
  }

  async removeAllSnapshot(): Promise<NotificationSnapshot & { count: number }> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      const count = this.data.notifications.length;
      if (count === 0) {
        return {
          count: 0,
          notifications: [...this.data.notifications],
          total: this.data.notifications.length,
          revision: this._revision,
        };
      }

      this.data.notifications = [];
      this.bumpRevision();
      await this.save();

      return {
        count,
        notifications: [],
        total: 0,
        revision: this._revision,
      };
    });
  }

  async updateSessionTitleWithRevision(
    sessionId: string,
    sessionTitle: string | null,
  ): Promise<NotificationMutationResult<NotificationRecord[]> | null> {
    return this.exclusive(async () => {
      await this.ensureLoaded();

      const normalizedSessionId = sessionId.trim();
      if (!normalizedSessionId) {
        return null;
      }
      const normalizedSessionTitle = normalizeNullableString(sessionTitle);
      const updated: NotificationRecord[] = [];

      for (let index = 0; index < this.data.notifications.length; index += 1) {
        const notification = this.data.notifications[index];
        if (!notification || notification.sessionId !== normalizedSessionId) {
          continue;
        }
        if (notification.sessionTitle === normalizedSessionTitle) {
          continue;
        }

        const nextNotification: NotificationRecord = {
          ...notification,
          sessionTitle: normalizedSessionTitle,
        };
        this.data.notifications[index] = nextNotification;
        updated.push(nextNotification);
      }

      if (updated.length === 0) {
        return null;
      }

      this.bumpRevision();
      await this.save();

      return { value: updated, revision: this._revision };
    });
  }

  async unreadCount(): Promise<number> {
    return this.exclusive(async () => {
      await this.ensureLoaded();
      return this.data.notifications.filter((n) => n.readAt === null).length;
    });
  }
}
