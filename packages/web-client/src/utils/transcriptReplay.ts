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

function trimProjectedId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Filter buffered live transcript events after a canonical replay has rendered.
 *
 * Live WS events and canonical replay do not share a strict sequence space for
 * Pi-backed sessions because transient chunks are omitted from canonical
 * history. Sequence filtering alone can therefore re-apply stale chunks or a
 * duplicate assistant_done after canonical replay. Drop buffered events that
 * belong to requests already terminated in the rendered transcript, or
 * assistant text events for responses already finalized by canonical replay.
 */
export function filterBufferedTranscriptEventsAfterReplay(
  bufferedEvents: readonly ProjectedTranscriptEvent[],
  renderedEvents: readonly ProjectedTranscriptEvent[],
  highestAppliedSequence: number,
): ProjectedTranscriptEvent[] {
  const completedRequestIds = new Set<string>();
  const finalizedResponseIds = new Set<string>();

  for (const event of renderedEvents) {
    const requestId = trimProjectedId(event.requestId);
    if (
      requestId &&
      (event.kind === 'request_end' || event.kind === 'interrupt' || event.kind === 'error')
    ) {
      completedRequestIds.add(requestId);
    }
    const responseId = trimProjectedId(event.responseId);
    if (responseId && event.chatEventType === 'assistant_done') {
      finalizedResponseIds.add(responseId);
    }
  }

  return bufferedEvents.filter((event) => {
    if (highestAppliedSequence >= 0 && event.sequence <= highestAppliedSequence) {
      return false;
    }
    const requestId = trimProjectedId(event.requestId);
    if (requestId && completedRequestIds.has(requestId)) {
      return false;
    }
    const responseId = trimProjectedId(event.responseId);
    if (
      responseId &&
      finalizedResponseIds.has(responseId) &&
      (event.chatEventType === 'assistant_chunk' || event.chatEventType === 'assistant_done')
    ) {
      return false;
    }
    return true;
  });
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
