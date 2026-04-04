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

/**
 * Compute the set of unfinished request IDs from a projected transcript.
 *
 * Mirrors the bookkeeping in ServerMessageHandler: `request_start` events add
 * the request ID to the active set, and `request_end`/`interrupt`/`error`
 * events remove it (or clear everything when the event omits a request ID).
 * Used to seed the authoritative request state after a transcript replay.
 */
export function computeUnfinishedRequestIds(
  events: readonly ProjectedTranscriptEvent[],
): string[] {
  const active = new Set<string>();
  for (const event of events) {
    if (event.kind === 'request_start') {
      const id = typeof event.requestId === 'string' ? event.requestId.trim() : '';
      if (id) {
        active.add(id);
      }
    } else if (
      event.kind === 'request_end' ||
      event.kind === 'interrupt' ||
      event.kind === 'error'
    ) {
      const id = typeof event.requestId === 'string' ? event.requestId.trim() : '';
      if (id) {
        active.delete(id);
      } else {
        active.clear();
      }
    }
  }
  return Array.from(active);
}
