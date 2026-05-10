import type { SessionHub } from './sessionHub';
import type { SessionSummary } from './sessionIndex';
import type { ToolContext } from './tools';
import { createNotificationRecord } from '../../plugins/core/notifications/server/service';

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
  const sessionIndex = options.sessionIndex ?? options.sessionHub?.getSessionIndex();
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
      ...(sessionIndex ? { sessionIndex } : {}),
    });
  } catch (error) {
    console.warn('[notifications] failed to publish final response notification', {
      sessionId: options.sessionId,
      responseId: options.responseId,
      error,
    });
  }
}
