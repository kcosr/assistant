import type { SessionHub } from './sessionHub';
import type { SessionSummary } from './sessionIndex';
import type { ToolContext } from './tools';
import {
  clearSessionAttentionForReply,
  createNotificationRecord,
} from '../../plugins/core/notifications/server/service';

function getSessionActivitySeq(
  summary: Pick<SessionSummary, 'revision'> | null | undefined,
): number | null {
  return typeof summary?.revision === 'number' ? Math.max(0, summary.revision) : null;
}

export async function publishFinalResponseNotification(options: {
  sessionId: string;
  responseId: string;
  text: string;
  sessionHub?: SessionHub;
  sessionIndex?: ToolContext['sessionIndex'];
  summary?: Pick<SessionSummary, 'revision'> | null;
}): Promise<void> {
  if (!options.text.trim()) {
    return;
  }
  try {
    await createNotificationRecord({
      input: {
        kind: 'session_attention',
        title: 'Latest assistant reply',
        body: options.text,
        sessionId: options.sessionId,
        tts: true,
        voiceMode: 'speak_then_listen',
        ttsText: options.text,
        sourceEventId: options.responseId,
        ...(getSessionActivitySeq(options.summary) !== null
          ? { sessionActivitySeq: getSessionActivitySeq(options.summary) }
          : {}),
      },
      source: 'system',
      ...(options.sessionHub ? { sessionHub: options.sessionHub } : {}),
      ...(options.sessionIndex ? { sessionIndex: options.sessionIndex } : {}),
    });
  } catch {
    // Notification transport is optional relative to the chat response.
  }
}

export async function clearReplyAttentionNotification(options: {
  sessionId: string;
  sessionHub?: SessionHub;
}): Promise<void> {
  try {
    await clearSessionAttentionForReply(options);
  } catch {
    // Notification transport is optional relative to the chat input.
  }
}
