export type NotificationSource = 'tool' | 'http' | 'cli';

export interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  source: NotificationSource;
  sessionId: string | null;
  sessionTitle: string | null;
  tts: boolean;
}

export interface CreateNotificationInput {
  title: string;
  body: string;
  sessionId?: string | null;
  tts?: boolean;
}

export interface NotificationListOptions {
  unreadOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface NotificationListResult {
  notifications: NotificationRecord[];
  total: number;
}
