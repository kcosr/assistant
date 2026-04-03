import { randomUUID } from 'node:crypto';

import type { ChatEvent, ProjectedTranscriptEvent, ServerMessage } from '@assistant/shared';

import type { EventStore } from './eventStore';
import type { SessionHub } from '../sessionHub';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for emitting tool_call and tool_result ChatEvents.
// Reduces duplication across chatProcessor.ts, toolCallHandling.ts, etc.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmitToolCallEventParams {
  eventStore: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
  turnId: string;
  responseId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface EmitToolResultEventParams {
  eventStore: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
  turnId: string;
  responseId: string;
  toolCallId: string;
  result: unknown;
  error?: { code: string; message: string } | undefined;
}

export interface EmitInteractionRequestEventParams {
  eventStore?: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
  turnId?: string;
  responseId?: string;
  toolCallId: string;
  interactionId: string;
  toolName: string;
  interactionType: 'approval' | 'input';
  presentation?: 'tool' | 'questionnaire';
  prompt?: string;
  approvalScopes?: Array<'once' | 'session' | 'always'>;
  inputSchema?: unknown;
  timeoutMs?: number;
  completedView?: { showInputs?: boolean; summaryTemplate?: string };
  errorSummary?: string;
  fieldErrors?: Record<string, string>;
}

export interface EmitInteractionResponseEventParams {
  eventStore?: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
  turnId?: string;
  responseId?: string;
  toolCallId: string;
  interactionId: string;
  action: 'approve' | 'deny' | 'submit' | 'cancel';
  approvalScope?: 'once' | 'session' | 'always';
  input?: Record<string, unknown>;
  reason?: string;
}

export interface EmitInteractionPendingEventParams {
  eventStore?: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
  turnId?: string;
  responseId?: string;
  toolCallId: string;
  toolName: string;
  pending: boolean;
  presentation?: 'tool' | 'questionnaire';
}

export interface EmitToolOutputChunkParams {
  sessionHub: SessionHub;
  sessionId: string;
  turnId?: string;
  responseId?: string;
  toolCallId: string;
  toolName: string;
  chunk: string;
  offset: number;
  stream?: 'stdout' | 'stderr' | 'output';
}

export interface EmitToolInputChunkParams {
  sessionHub: SessionHub;
  sessionId: string;
  turnId?: string;
  responseId?: string;
  toolCallId: string;
  toolName: string;
  chunk: string;
  offset: number;
}

/**
 * Emit a tool_call ChatEvent and broadcast to clients.
 */
export function emitToolCallEvent(params: EmitToolCallEventParams): void {
  const { eventStore, sessionHub, sessionId, turnId, responseId, toolCallId, toolName, args } =
    params;

  const events: ChatEvent[] = [
    {
      ...createChatEventBase({
        sessionId,
        turnId,
        responseId,
      }),
      type: 'tool_call',
      payload: {
        toolCallId,
        toolName,
        args,
      },
    },
  ];

  void appendAndBroadcastChatEvents({ eventStore, sessionHub, sessionId }, events);
}

/**
 * Emit a tool_output_chunk ChatEvent and broadcast to clients.
 * This is transient - NOT persisted to event store.
 */
export function emitToolOutputChunkEvent(params: EmitToolOutputChunkParams): void {
  const { sessionHub, sessionId, turnId, responseId, toolCallId, toolName, chunk, offset, stream } =
    params;

  const event: ChatEvent = {
    ...createChatEventBase({
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...(responseId ? { responseId } : {}),
    }),
    type: 'tool_output_chunk',
    payload: {
      toolCallId,
      toolName,
      chunk,
      offset,
      ...(stream ? { stream } : {}),
    },
  };

  // Broadcast only - not persisted (transient event)
  broadcastLiveChatEvents(sessionHub, sessionId, [event]);
}

/**
 * Emit a tool_input_chunk ChatEvent and broadcast to clients.
 * This is transient - NOT persisted to event store.
 */
export function emitToolInputChunkEvent(params: EmitToolInputChunkParams): void {
  const { sessionHub, sessionId, turnId, responseId, toolCallId, toolName, chunk, offset } = params;

  const event: ChatEvent = {
    ...createChatEventBase({
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...(responseId ? { responseId } : {}),
    }),
    type: 'tool_input_chunk',
    payload: {
      toolCallId,
      toolName,
      chunk,
      offset,
    },
  };

  // Broadcast only - not persisted (transient event)
  broadcastLiveChatEvents(sessionHub, sessionId, [event]);
}

/**
 * Emit a tool_result ChatEvent and broadcast to clients.
 */
export function emitToolResultEvent(params: EmitToolResultEventParams): void {
  const { eventStore, sessionHub, sessionId, turnId, responseId, toolCallId, result, error } =
    params;

  const events: ChatEvent[] = [
    {
      ...createChatEventBase({
        sessionId,
        turnId,
        responseId,
      }),
      type: 'tool_result',
      payload: {
        toolCallId,
        result: result ?? null,
        ...(error ? { error } : {}),
      },
    },
  ];

  void appendAndBroadcastChatEvents({ eventStore, sessionHub, sessionId }, events);
}

export function emitInteractionRequestEvent(params: EmitInteractionRequestEventParams): void {
  const {
    eventStore,
    sessionHub,
    sessionId,
    turnId,
    responseId,
    toolCallId,
    interactionId,
    toolName,
    interactionType,
    presentation,
    prompt,
    approvalScopes,
    inputSchema,
    timeoutMs,
    completedView,
    errorSummary,
    fieldErrors,
  } = params;

  const events: ChatEvent[] = [
    {
      ...createChatEventBase({
        sessionId,
        ...(turnId ? { turnId } : {}),
        ...(responseId ? { responseId } : {}),
      }),
      type: 'interaction_request',
      payload: {
        toolCallId,
        interactionId,
        toolName,
        interactionType,
        ...(presentation ? { presentation } : {}),
        ...(prompt ? { prompt } : {}),
        ...(approvalScopes ? { approvalScopes } : {}),
        ...(inputSchema ? { inputSchema } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
        ...(completedView ? { completedView } : {}),
        ...(errorSummary ? { errorSummary } : {}),
        ...(fieldErrors ? { fieldErrors } : {}),
      },
    },
  ];

  if (eventStore) {
    void appendAndBroadcastChatEvents({ eventStore, sessionHub, sessionId }, events);
    return;
  }

  broadcastLiveChatEvents(sessionHub, sessionId, events);
}

export function emitInteractionResponseEvent(params: EmitInteractionResponseEventParams): void {
  const {
    eventStore,
    sessionHub,
    sessionId,
    turnId,
    responseId,
    toolCallId,
    interactionId,
    action,
    approvalScope,
    input,
    reason,
  } = params;

  const events: ChatEvent[] = [
    {
      ...createChatEventBase({
        sessionId,
        ...(turnId ? { turnId } : {}),
        ...(responseId ? { responseId } : {}),
      }),
      type: 'interaction_response',
      payload: {
        toolCallId,
        interactionId,
        action,
        ...(approvalScope ? { approvalScope } : {}),
        ...(input ? { input } : {}),
        ...(reason ? { reason } : {}),
      },
    },
  ];

  if (eventStore) {
    void appendAndBroadcastChatEvents({ eventStore, sessionHub, sessionId }, events);
    return;
  }

  broadcastLiveChatEvents(sessionHub, sessionId, events);
}

export function emitInteractionPendingEvent(params: EmitInteractionPendingEventParams): void {
  const {
    eventStore,
    sessionHub,
    sessionId,
    turnId,
    responseId,
    toolCallId,
    toolName,
    pending,
    presentation,
  } = params;

  const events: ChatEvent[] = [
    {
      ...createChatEventBase({
        sessionId,
        ...(turnId ? { turnId } : {}),
        ...(responseId ? { responseId } : {}),
      }),
      type: 'interaction_pending',
      payload: {
        toolCallId,
        toolName,
        pending,
        ...(presentation ? { presentation } : {}),
      },
    },
  ];

  if (eventStore) {
    void appendAndBroadcastChatEvents({ eventStore, sessionHub, sessionId }, events);
    return;
  }

  broadcastLiveChatEvents(sessionHub, sessionId, events);
}

export interface ChatEventContext {
  eventStore: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
}

const liveTranscriptStateBySession = new Map<
  string,
  {
    revision: number;
    nextSequence: number;
    activeRequestId: string | null;
  }
>();

function getProjectedTranscriptRevision(sessionHub: SessionHub, sessionId: string): number {
  if (typeof sessionHub.getSessionState !== 'function') {
    return 0;
  }
  return Math.max(0, sessionHub.getSessionState(sessionId)?.summary.revision ?? 0);
}

function getDirectPiPersistenceState(sessionHub: SessionHub, sessionId: string): {
  summary: NonNullable<ReturnType<SessionHub['getSessionState']>>['summary'];
} | null {
  if (typeof sessionHub.getSessionState !== 'function') {
    return null;
  }
  const state = sessionHub.getSessionState(sessionId);
  const summary = state?.summary;
  if (!summary?.agentId) {
    return null;
  }
  const agent = sessionHub.getAgentRegistry().getAgent(summary.agentId);
  const providerId = agent?.chat?.provider;
  if (providerId !== 'pi' && providerId !== 'pi-cli') {
    return null;
  }
  if (!sessionHub.getPiSessionWriter?.()) {
    return null;
  }
  return { summary };
}

function resolveLiveRequestId(event: ChatEvent, activeRequestId: string | null): string {
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
  payload: ProjectedTranscriptEvent['payload'];
} {
  switch (event.type) {
    case 'turn_start':
      return { kind: 'request_start', payload: event.payload };
    case 'turn_end':
      return { kind: 'request_end', payload: event.payload };
    case 'user_message':
    case 'user_audio':
      return { kind: 'user_message', payload: event.payload };
    case 'assistant_chunk':
    case 'assistant_done':
    case 'custom_message':
    case 'summary_message':
    case 'audio_chunk':
    case 'audio_done':
      return { kind: 'assistant_message', payload: event.payload };
    case 'thinking_chunk':
    case 'thinking_done':
      return { kind: 'thinking', payload: event.payload };
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
    case 'agent_message':
      return { kind: 'interaction_request', payload: event.payload };
    case 'interaction_pending':
    case 'questionnaire_reprompt':
    case 'questionnaire_update':
    case 'agent_switch':
      return { kind: 'interaction_update', payload: event.payload };
    case 'interaction_response':
    case 'questionnaire_submission':
    case 'agent_callback':
      return { kind: 'interaction_response', payload: event.payload };
    case 'interrupt':
      return { kind: 'interrupt', payload: event.payload };
    case 'error':
      return { kind: 'error', payload: event.payload };
  }
  const exhaustive: never = event;
  return exhaustive;
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
        ...(typeof event.payload.exchangeId === 'string' && event.payload.exchangeId.trim().length > 0
          ? { exchangeId: event.payload.exchangeId }
          : { exchangeId: event.payload.messageId }),
      };
    default:
      return {};
  }
}

function buildLiveProjectedTranscriptEvents(options: {
  sessionId: string;
  revision: number;
  startSequence: number;
  activeRequestId: string | null;
  events: ChatEvent[];
}): {
  events: ProjectedTranscriptEvent[];
  nextSequence: number;
  activeRequestId: string | null;
} {
  const { sessionId, revision, startSequence, events } = options;
  let activeRequestId = options.activeRequestId;
  let nextSequence = startSequence;
  const projected: ProjectedTranscriptEvent[] = [];

  for (const event of events) {
    if (event.type === 'turn_start') {
      activeRequestId = resolveLiveRequestId(event, activeRequestId);
    }

    const requestId = resolveLiveRequestId(event, activeRequestId);
    const { kind, payload } = mapChatEventKind(event);
    projected.push({
      sessionId,
      revision,
      sequence: nextSequence,
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
    nextSequence += 1;

    if (event.type === 'turn_end' && activeRequestId === requestId) {
      activeRequestId = null;
    }
  }

  return { events: projected, nextSequence, activeRequestId };
}

function broadcastProjectedTranscriptEvents(sessionHub: SessionHub, sessionId: string, events: ChatEvent[]): void {
  if (!events.length) {
    return;
  }
  const revision = getProjectedTranscriptRevision(sessionHub, sessionId);
  const liveState = liveTranscriptStateBySession.get(sessionId);
  const nextState =
    liveState && liveState.revision === revision
      ? liveState
      : { revision, nextSequence: 0, activeRequestId: null as string | null };
  const projected = buildLiveProjectedTranscriptEvents({
    sessionId,
    revision,
    startSequence: nextState.nextSequence,
    activeRequestId: nextState.activeRequestId,
    events,
  });
  liveTranscriptStateBySession.set(sessionId, {
    revision,
    nextSequence: projected.nextSequence,
    activeRequestId: projected.activeRequestId,
  });
  for (const event of projected.events) {
    const message: ServerMessage = {
      type: 'transcript_event',
      event,
    };
    sessionHub.broadcastToSession(sessionId, message);
  }
}

function broadcastLiveChatEvents(
  sessionHub: SessionHub,
  sessionId: string,
  events: ChatEvent[],
): void {
  if (!events.length) {
    return;
  }
  broadcastProjectedTranscriptEvents(sessionHub, sessionId, events);
}

export function createChatEventBase(options: {
  sessionId: string;
  turnId?: string;
  responseId?: string;
}): Omit<ChatEvent, 'type' | 'payload'> {
  const { sessionId, turnId, responseId } = options;
  const base: Omit<ChatEvent, 'type' | 'payload'> = {
    id: randomUUID(),
    timestamp: Date.now(),
    sessionId,
  };

  const trimmedTurnId = typeof turnId === 'string' ? turnId.trim() : '';
  if (trimmedTurnId) {
    base.turnId = trimmedTurnId;
  }

  const trimmedResponseId = typeof responseId === 'string' ? responseId.trim() : '';
  if (trimmedResponseId) {
    base.responseId = trimmedResponseId;
  }

  return base;
}

export async function appendAndBroadcastChatEvents(
  context: ChatEventContext,
  events: ChatEvent[],
): Promise<void> {
  const { eventStore, sessionHub, sessionId } = context;
  if (!events || events.length === 0) {
    return;
  }

  const piState = getDirectPiPersistenceState(sessionHub, sessionId);
  try {
    if (piState) {
      const writer = sessionHub.getPiSessionWriter?.();
      if (writer) {
        for (const event of events) {
          if (event.type === 'turn_start' || event.type === 'turn_end') {
            continue;
          }
          const updatedSummary = await writer.appendAssistantEvent({
            summary: piState.summary,
            eventType: event.type,
            payload: event.payload,
            ...(event.turnId ? { turnId: event.turnId } : {}),
            ...(event.responseId ? { responseId: event.responseId } : {}),
            updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
          });
          if (updatedSummary) {
            piState.summary = updatedSummary;
          }
        }
      }
    } else if (events.length === 1) {
      const [single] = events;
      if (!single) {
        return;
      }
      await eventStore.append(sessionId, single);
    } else {
      await eventStore.appendBatch(sessionId, events);
    }
  } catch (err) {
    // Event logging is best-effort only; failures must not break chat flows.
    console.error('[events] Failed to append chat events', {
      sessionId,
      error: err,
    });
    return;
  }

  broadcastLiveChatEvents(sessionHub, sessionId, events);
}
