import type { ChatEvent } from '@assistant/shared';

function stableSerialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeReplayComparablePayload(event: ChatEvent): unknown {
  if (event.type === 'user_message') {
    return { text: event.payload.text.trimEnd() };
  }
  if (event.type === 'user_audio') {
    return {
      transcription: event.payload.transcription.trimEnd(),
      durationMs: event.payload.durationMs,
    };
  }
  if (event.type === 'assistant_done') {
    return {
      text: event.payload.text.trimEnd(),
      ...(event.payload.phase ? { phase: event.payload.phase } : {}),
      ...(event.payload.interrupted === true ? { interrupted: true } : {}),
      ...(event.payload.textSignature ? { textSignature: event.payload.textSignature } : {}),
    };
  }
  if (event.type === 'thinking_done') {
    return { text: event.payload.text.trimEnd() };
  }
  if (event.type === 'tool_call') {
    return {
      toolName: event.payload.toolName,
      args: event.payload.args,
    };
  }
  if (event.type === 'tool_result') {
    return {
      result: event.payload.result,
      error: event.payload.error,
    };
  }
  if (event.type === 'interrupt') {
    return { reason: event.payload.reason };
  }
  if (event.type === 'error') {
    return { message: event.payload.message, code: event.payload.code };
  }
  if (event.type === 'turn_start') {
    return { trigger: event.payload.trigger };
  }
  return event.payload;
}

export function getChatEventReplayDedupKey(event: ChatEvent): string {
  return [
    event.type,
    event.turnId ?? '',
    event.responseId ?? '',
    stableSerialize(normalizeReplayComparablePayload(event)),
  ].join('|');
}

export function filterBufferedReplayEvents(
  pendingEvents: ChatEvent[],
  replayedEvents?: ChatEvent[],
): ChatEvent[] {
  if (!replayedEvents || replayedEvents.length === 0) {
    return pendingEvents;
  }

  const replayedIds = new Set(replayedEvents.map((event) => event.id));
  const replayedKeys = new Set(replayedEvents.map(getChatEventReplayDedupKey));

  return pendingEvents.filter((event) => {
    if (replayedIds.has(event.id)) {
      return false;
    }
    return !replayedKeys.has(getChatEventReplayDedupKey(event));
  });
}
