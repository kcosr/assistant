import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import type {
  NotificationRecord,
  NotificationSource,
  NotificationListOptions,
  NotificationListResult,
} from './types';

interface StoreData {
  notifications: NotificationRecord[];
}

const DEFAULT_MAX_NOTIFICATIONS = 500;

export class NotificationsStore {
  private dataPath: string;
  private data: StoreData = { notifications: [] };
  private loaded = false;
  private maxNotifications: number;

  constructor(
    private readonly dataDir: string,
    maxNotifications: number = DEFAULT_MAX_NOTIFICATIONS,
  ) {
    this.dataPath = path.join(dataDir, 'notifications.json');
    this.maxNotifications = maxNotifications;
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
        this.data = parsed;
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

  private sortNewestFirst(): void {
    this.data.notifications.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  private pruneIfNeeded(): void {
    if (this.data.notifications.length <= this.maxNotifications) {
      return;
    }
    // Remove oldest read notifications first
    const read = this.data.notifications.filter((n) => n.readAt !== null);
    const unread = this.data.notifications.filter((n) => n.readAt === null);

    if (read.length + unread.length > this.maxNotifications) {
      // Keep all unread, trim oldest read
      const readToKeep = Math.max(0, this.maxNotifications - unread.length);
      // read is already sorted newest-first (from sortNewestFirst), keep the newest ones
      const keptRead = read.slice(0, readToKeep);
      this.data.notifications = [...unread, ...keptRead];
      this.sortNewestFirst();
    }
  }

  async insert(
    input: { title: string; body: string; sessionId?: string | null; sessionTitle?: string | null; tts?: boolean },
    source: NotificationSource,
  ): Promise<NotificationRecord> {
    await this.ensureLoaded();

    const record: NotificationRecord = {
      id: crypto.randomUUID(),
      title: input.title,
      body: input.body,
      createdAt: new Date().toISOString(),
      readAt: null,
      source,
      sessionId: input.sessionId ?? null,
      sessionTitle: input.sessionTitle ?? null,
      tts: input.tts ?? false,
    };

    this.data.notifications.unshift(record);
    this.pruneIfNeeded();
    await this.save();

    return record;
  }

  async list(options: NotificationListOptions = {}): Promise<NotificationListResult> {
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
  }

  async get(id: string): Promise<NotificationRecord | null> {
    await this.ensureLoaded();
    return this.data.notifications.find((n) => n.id === id) ?? null;
  }

  async toggleRead(id: string): Promise<NotificationRecord | null> {
    await this.ensureLoaded();

    const notification = this.data.notifications.find((n) => n.id === id);
    if (!notification) {
      return null;
    }

    notification.readAt = notification.readAt === null ? new Date().toISOString() : null;
    await this.save();

    return notification;
  }

  async markAllRead(): Promise<number> {
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
      await this.save();
    }

    return count;
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureLoaded();

    const index = this.data.notifications.findIndex((n) => n.id === id);
    if (index === -1) {
      return false;
    }

    this.data.notifications.splice(index, 1);
    await this.save();

    return true;
  }

  async removeAll(): Promise<number> {
    await this.ensureLoaded();

    const count = this.data.notifications.length;
    if (count === 0) {
      return 0;
    }

    this.data.notifications = [];
    await this.save();

    return count;
  }

  async unreadCount(): Promise<number> {
    await this.ensureLoaded();
    return this.data.notifications.filter((n) => n.readAt === null).length;
  }
}
