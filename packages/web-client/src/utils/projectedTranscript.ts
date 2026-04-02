import {
  safeValidateChatEvent,
  type ChatEvent,
  type ProjectedTranscriptEvent,
} from '@assistant/shared';

export function projectedTranscriptEventToChatEvent(
  event: ProjectedTranscriptEvent,
): ChatEvent | null {
  const timestamp = Date.parse(event.timestamp);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  const candidate = {
    id: event.eventId,
    timestamp,
    sessionId: event.sessionId,
    turnId: event.requestId,
    type: event.chatEventType,
    payload: event.payload as ChatEvent['payload'],
    ...(typeof event.responseId === 'string' && event.responseId.trim().length > 0
      ? { responseId: event.responseId }
      : {}),
  };
  const parsed = safeValidateChatEvent(candidate);
  return parsed.success ? parsed.data : null;
}

export function projectedTranscriptToChatEvents(
  events: ProjectedTranscriptEvent[],
): ChatEvent[] {
  return events.flatMap((event): ChatEvent[] => {
    const replayedEvent = projectedTranscriptEventToChatEvent(event);
    if (!replayedEvent) {
      return [];
    }
    return [replayedEvent];
  });
}
