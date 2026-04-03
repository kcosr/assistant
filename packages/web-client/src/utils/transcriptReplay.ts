import type { ProjectedTranscriptEvent } from '@assistant/shared';

function compareProjectedTranscriptEvents(
  left: ProjectedTranscriptEvent,
  right: ProjectedTranscriptEvent,
): number {
  if (left.revision !== right.revision) {
    return left.revision - right.revision;
  }
  if (left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.eventId.localeCompare(right.eventId);
}

export function sortProjectedTranscriptEvents(
  events: readonly ProjectedTranscriptEvent[],
): ProjectedTranscriptEvent[] {
  return [...events].sort(compareProjectedTranscriptEvents);
}

export function dedupeProjectedTranscriptEvents(
  events: readonly ProjectedTranscriptEvent[],
): ProjectedTranscriptEvent[] {
  const normalized = sortProjectedTranscriptEvents(events);
  const deduped: ProjectedTranscriptEvent[] = [];
  const seen = new Set<string>();
  for (const event of normalized) {
    const key = `${event.revision}:${event.sequence}:${event.eventId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(event);
  }
  return deduped;
}

export function finishTranscriptHydration(
  state: { hydratingCount: number },
  flushBufferedEvents: () => void,
): void {
  state.hydratingCount = Math.max(0, state.hydratingCount - 1);
  flushBufferedEvents();
}
