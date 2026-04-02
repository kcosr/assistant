import type { ChatEvent, ProjectedTranscriptEvent, ProjectedTranscriptEventPayload } from '@assistant/shared';

type ReplayCursor = {
  revision: number;
  sequence: number;
};

function toRequestId(event: ChatEvent, activeRequestId: string | null): string {
  const explicit = typeof event.turnId === 'string' ? event.turnId.trim() : '';
  if (explicit) {
    return explicit;
  }
  const responseId = typeof event.responseId === 'string' ? event.responseId.trim() : '';
  if (responseId) {
    return responseId;
  }
  if (activeRequestId) {
    return activeRequestId;
  }
  return `request:${event.id}`;
}

function mapChatEventKind(event: ChatEvent): {
  kind: ProjectedTranscriptEvent['kind'];
  payload: ProjectedTranscriptEventPayload;
} {
  switch (event.type) {
    case 'turn_start':
      return { kind: 'request_start', payload: event.payload };
    case 'turn_end':
      return { kind: 'request_end', payload: event.payload };
    case 'user_message':
    case 'user_audio':
      return {
        kind: 'user_message',
        payload: event.payload,
      };
    case 'assistant_chunk':
      return {
        kind: 'assistant_message',
        payload: event.payload,
      };
    case 'assistant_done':
      return {
        kind: 'assistant_message',
        payload: event.payload,
      };
    case 'thinking_chunk':
      return {
        kind: 'thinking',
        payload: event.payload,
      };
    case 'thinking_done':
      return {
        kind: 'thinking',
        payload: event.payload,
      };
    case 'custom_message':
    case 'summary_message':
    case 'audio_chunk':
    case 'audio_done':
      return {
        kind: 'assistant_message',
        payload: event.payload,
      };
    case 'tool_input_chunk':
      return { kind: 'tool_input', payload: event.payload };
    case 'tool_output_chunk':
      return { kind: 'tool_output', payload: event.payload };
    case 'tool_call':
      return { kind: 'tool_call', payload: event.payload };
    case 'tool_result':
      return { kind: 'tool_result', payload: event.payload };
    case 'interaction_request':
    case 'questionnaire_request':
      return { kind: 'interaction_request', payload: event.payload };
    case 'interaction_pending':
    case 'questionnaire_reprompt':
    case 'questionnaire_update':
      return { kind: 'interaction_update', payload: event.payload };
    case 'interaction_response':
    case 'questionnaire_submission':
      return { kind: 'interaction_response', payload: event.payload };
    case 'agent_message':
      return { kind: 'interaction_request', payload: event.payload };
    case 'agent_callback':
      return { kind: 'interaction_response', payload: event.payload };
    case 'agent_switch':
      return { kind: 'interaction_update', payload: event.payload };
    case 'interrupt':
      return { kind: 'interrupt', payload: event.payload };
    case 'error':
      return { kind: 'error', payload: event.payload };
  }
  const exhaustive: never = event;
  return exhaustive;
}

function parseReplayCursor(cursor: string | undefined): ReplayCursor | null {
  if (typeof cursor !== 'string') {
    return null;
  }
  const trimmed = cursor.trim();
  if (!trimmed) {
    return null;
  }
  const separator = trimmed.lastIndexOf(':');
  if (separator === -1) {
    return null;
  }
  const revision = Number.parseInt(trimmed.slice(0, separator), 10);
  const rawSequence = trimmed.slice(separator + 1);
  const sequence = Number.parseInt(rawSequence, 10);
  if (!Number.isInteger(revision) || revision < 0 || !Number.isInteger(sequence) || sequence < 0) {
    return null;
  }
  return { revision, sequence };
}

export function formatReplayCursor(revision: number, sequence: number): string {
  return `${revision}:${sequence}`;
}

export function projectTranscriptEvents(options: {
  sessionId: string;
  revision: number;
  events: ChatEvent[];
}): ProjectedTranscriptEvent[] {
  const { sessionId, revision, events } = options;
  const projected: ProjectedTranscriptEvent[] = [];
  let activeRequestId: string | null = null;

  for (const event of events) {
    if (event.type === 'turn_start') {
      activeRequestId = toRequestId(event, activeRequestId);
    }

    const requestId = toRequestId(event, activeRequestId);
    const { kind, payload } = mapChatEventKind(event);

    projected.push({
      sessionId,
      revision,
      sequence: projected.length,
      requestId,
      eventId: event.id,
      kind,
      chatEventType: event.type,
      timestamp: new Date(event.timestamp).toISOString(),
      ...(typeof event.responseId === 'string' && event.responseId.trim().length > 0
        ? { responseId: event.responseId }
        : {}),
      ...(typeof event.turnId === 'string' && event.turnId.trim().length > 0
        ? { piTurnId: event.turnId }
        : {}),
      ...extractStableIds(event),
      payload,
    });

    if (event.type === 'turn_end' && activeRequestId === requestId) {
      activeRequestId = null;
    }
  }

  return projected;
}

function extractStableIds(event: ChatEvent): Partial<ProjectedTranscriptEvent> {
  switch (event.type) {
    case 'tool_call':
    case 'tool_input_chunk':
    case 'tool_output_chunk':
    case 'tool_result':
      return { toolCallId: event.payload.toolCallId };
    case 'interaction_request':
    case 'interaction_response':
      return {
        toolCallId: event.payload.toolCallId,
        interactionId: event.payload.interactionId,
      };
    case 'interaction_pending':
      return { toolCallId: event.payload.toolCallId };
    case 'questionnaire_request':
      return {
        toolCallId: event.payload.toolCallId,
        interactionId: event.payload.sourceInteractionId,
      };
    case 'questionnaire_submission':
    case 'questionnaire_reprompt':
    case 'questionnaire_update':
      return {
        toolCallId: event.payload.toolCallId,
        interactionId:
          'interactionId' in event.payload && typeof event.payload.interactionId === 'string'
            ? event.payload.interactionId
            : undefined,
      };
    case 'agent_message':
    case 'agent_callback':
      return {
        messageId: event.payload.messageId,
        exchangeId: event.payload.messageId,
      };
    default:
      return {};
  }
}

export function sliceProjectedTranscript(options: {
  revision: number;
  events: ProjectedTranscriptEvent[];
  afterCursor?: string;
  force?: boolean;
}): {
  reset: boolean;
  events: ProjectedTranscriptEvent[];
  nextCursor?: string;
} {
  const { revision, events, afterCursor, force = false } = options;
  const parsedCursor = parseReplayCursor(afterCursor);
  const nextCursor = events.length > 0 ? formatReplayCursor(revision, events.length - 1) : undefined;

  if (force || !parsedCursor) {
    return {
      reset: true,
      events,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  if (parsedCursor.revision !== revision) {
    return {
      reset: true,
      events,
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  if (parsedCursor.sequence >= events.length) {
    return {
      reset: false,
      events: [],
      ...(nextCursor ? { nextCursor } : {}),
    };
  }

  return {
    reset: false,
    events: events.filter((event) => event.sequence > parsedCursor.sequence),
    ...(nextCursor ? { nextCursor } : {}),
  };
}
