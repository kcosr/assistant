import type { ChatEvent, ProjectedTranscriptEvent } from '@assistant/shared';

function getSourceEvent(event: ProjectedTranscriptEvent): ChatEvent | null {
  const payload = event.payload as { sourceEvent?: unknown };
  if (!payload.sourceEvent || typeof payload.sourceEvent !== 'object') {
    return null;
  }
  return payload.sourceEvent as ChatEvent;
}

export function projectedTranscriptToChatEvents(
  events: ProjectedTranscriptEvent[],
): ChatEvent[] {
  return events.flatMap((event): ChatEvent[] => {
    const sourceEvent = getSourceEvent(event);
    if (!sourceEvent) {
      return [];
    }
    const replayedEvent: ChatEvent = {
      ...sourceEvent,
      id: event.eventId,
      sessionId: event.sessionId,
      turnId: event.requestId,
    };
    return [replayedEvent];
  });
}
