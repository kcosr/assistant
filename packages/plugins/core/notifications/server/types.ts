export type NotificationKind = 'session_attention' | 'notification';
export type NotificationSource = 'tool' | 'http' | 'cli' | 'system';
export type NotificationVoiceMode = 'none' | 'speak' | 'speak_then_listen';

export interface NotificationRecord {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  source: NotificationSource;
  sessionId: string | null;
  sessionTitle: string | null;
  tts: boolean;
  voiceMode: NotificationVoiceMode;
  ttsText: string | null;
  sourceEventId: string | null;
  sessionActivitySeq: number | null;
}

export interface CreateNotificationInput {
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
