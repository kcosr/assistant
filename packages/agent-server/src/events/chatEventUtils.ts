import { randomUUID } from 'node:crypto';

import type {
  ChatEvent,
  ProjectedTranscriptEvent,
  ServerMessage,
  SessionAttributes,
} from '@assistant/shared';

import type { EventStore } from './eventStore';
import type { SessionHub } from '../sessionHub';
import type { SessionSummary } from '../sessionIndex';
import { loadCanonicalPiTranscriptEvents } from '../history/historyProvider';
import { getPiTranscriptRevision } from '../history/piTranscriptRevision';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers for emitting tool_call and tool_result ChatEvents.
// Reduces duplication across chatProcessor.ts, toolCallHandling.ts, etc.
// ─────────────────────────────────────────────────────────────────────────────

export interface EmitToolCallEventParams {
  eventStore?: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
  turnId: string;
  responseId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface EmitToolResultEventParams {
  eventStore?: EventStore;
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
export function emitToolCallEvent(params: EmitToolCallEventParams): Promise<void> {
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

  return appendAndBroadcastChatEvents(
    {
      ...(eventStore ? { eventStore } : {}),
      sessionHub,
      sessionId,
    },
    events,
  );
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
export function emitToolResultEvent(params: EmitToolResultEventParams): Promise<void> {
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

  return appendAndBroadcastChatEvents(
    {
      ...(eventStore ? { eventStore } : {}),
      sessionHub,
      sessionId,
    },
    events,
  );
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
  eventStore?: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
}

type LiveTranscriptSessionState = {
  revision: number;
  nextSequence: number;
  activeRequestId: string | null;
  replayOverlay: ProjectedTranscriptEvent[];
};

const LIVE_TRANSCRIPT_STATE_GLOBAL_KEY = '__assistantLiveTranscriptStateBySession';

function getLiveTranscriptStateStore(): Map<string, LiveTranscriptSessionState> {
  const scope = globalThis as typeof globalThis & {
    [LIVE_TRANSCRIPT_STATE_GLOBAL_KEY]?: Map<string, LiveTranscriptSessionState>;
  };
  if (!scope[LIVE_TRANSCRIPT_STATE_GLOBAL_KEY]) {
    scope[LIVE_TRANSCRIPT_STATE_GLOBAL_KEY] = new Map<string, LiveTranscriptSessionState>();
  }
  return scope[LIVE_TRANSCRIPT_STATE_GLOBAL_KEY];
}

// Use a process-global store instead of a module-local singleton because the compiled
// server can load this module through multiple import paths (runtime + plugin replay),
// and reconnect/replay must see the same in-flight Pi overlay state.
const liveTranscriptStateBySession = getLiveTranscriptStateStore();

function normalizeLiveTranscriptState(
  state:
    | (LiveTranscriptSessionState & {
        replayOverlay?: ProjectedTranscriptEvent[];
      })
    | undefined,
): LiveTranscriptSessionState | null {
  if (!state) {
    return null;
  }
  return {
    revision: Math.max(0, state.revision),
    nextSequence: Math.max(0, state.nextSequence),
    activeRequestId: state.activeRequestId ?? null,
    replayOverlay: Array.isArray(state.replayOverlay) ? [...state.replayOverlay] : [],
  };
}

function isTransientPiReplayEventType(eventType: ChatEvent['type']): boolean {
  return (
    eventType === 'assistant_chunk' ||
    eventType === 'thinking_chunk' ||
    eventType === 'tool_input_chunk' ||
    eventType === 'tool_output_chunk'
  );
}

function shouldPersistPiAssistantEvent(event: ChatEvent): boolean {
  return !isTransientPiReplayEventType(event.type);
}

export function resetLiveTranscriptSessionState(sessionId: string): void {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return;
  }
  liveTranscriptStateBySession.delete(trimmed);
}

export function seedLiveTranscriptSessionState(options: {
  sessionId: string;
  revision: number;
  nextSequence: number;
  activeRequestId?: string | null;
}): void {
  const trimmed = options.sessionId.trim();
  if (!trimmed) {
    return;
  }
  const targetRevision = Math.max(0, options.revision);
  const existing = normalizeLiveTranscriptState(liveTranscriptStateBySession.get(trimmed));
  const sameRevision = !!existing && existing.revision === targetRevision;
  const preservedOverlay = sameRevision ? existing.replayOverlay : [];
  const highestOverlaySequence = preservedOverlay.reduce(
    (highest, event) => Math.max(highest, event.sequence),
    -1,
  );
  const existingNextSequence = sameRevision ? existing.nextSequence : 0;
  liveTranscriptStateBySession.set(trimmed, {
    revision: targetRevision,
    nextSequence: Math.max(
      0,
      options.nextSequence,
      highestOverlaySequence + 1,
      existingNextSequence,
    ),
    activeRequestId:
      options.activeRequestId ??
      (sameRevision ? existing.activeRequestId : null),
    replayOverlay: preservedOverlay,
  });
}

export function getBufferedLiveTranscriptEvents(options: {
  sessionId: string;
  revision: number;
}): ProjectedTranscriptEvent[] {
  const trimmed = options.sessionId.trim();
  if (!trimmed) {
    return [];
  }
  const state = liveTranscriptStateBySession.get(trimmed);
  const normalized = normalizeLiveTranscriptState(state);
  if (
    !normalized ||
    normalized.revision !== Math.max(0, options.revision) ||
    normalized.replayOverlay.length === 0
  ) {
    return [];
  }
  return [...normalized.replayOverlay].sort((left, right) => left.sequence - right.sequence);
}

export function getLiveTranscriptSequenceWatermark(options: {
  sessionId: string;
  revision: number;
}): number | undefined {
  const trimmed = options.sessionId.trim();
  if (!trimmed) {
    return undefined;
  }
  const normalized = normalizeLiveTranscriptState(liveTranscriptStateBySession.get(trimmed));
  if (!normalized || normalized.revision !== Math.max(0, options.revision)) {
    return undefined;
  }
  return normalized.nextSequence > 0 ? normalized.nextSequence - 1 : undefined;
}

function trimProjectedId(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function reconcileReplayOverlayEvents(
  overlay: readonly ProjectedTranscriptEvent[],
  canonicalEvents: readonly ProjectedTranscriptEvent[],
): ProjectedTranscriptEvent[] {
  if (overlay.length === 0) {
    return [];
  }

  const canonicalSequences = new Set<number>();
  const completedRequestIds = new Set<string>();
  const finalizedResponseIds = new Set<string>();
  for (const event of canonicalEvents) {
    canonicalSequences.add(event.sequence);
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

  return overlay.filter((event) => {
    if (canonicalSequences.has(event.sequence)) {
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

export function getActiveLiveTranscriptRevision(sessionId: string): number | undefined {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    return undefined;
  }
  const state = normalizeLiveTranscriptState(liveTranscriptStateBySession.get(trimmed));
  return state?.revision;
}

export function mergeBufferedLiveTranscriptEvents(options: {
  sessionId: string;
  revision: number;
  events: ProjectedTranscriptEvent[];
}): ProjectedTranscriptEvent[] {
  const trimmed = options.sessionId.trim();
  if (!trimmed) {
    return options.events;
  }
  const existing = normalizeLiveTranscriptState(liveTranscriptStateBySession.get(trimmed));
  const overlay =
    existing && existing.revision === Math.max(0, options.revision)
      ? reconcileReplayOverlayEvents(existing.replayOverlay, options.events)
      : [];
  if (existing && existing.revision === Math.max(0, options.revision)) {
    liveTranscriptStateBySession.set(trimmed, {
      ...existing,
      replayOverlay: overlay,
    });
  }
  if (overlay.length === 0) {
    return options.events;
  }

  const mergedBySequence = new Map<number, ProjectedTranscriptEvent>();
  for (const event of options.events) {
    mergedBySequence.set(event.sequence, event);
  }
  for (const event of overlay) {
    if (!mergedBySequence.has(event.sequence)) {
      mergedBySequence.set(event.sequence, event);
    }
  }
  return [...mergedBySequence.values()].sort((left, right) => left.sequence - right.sequence);
}

export async function syncLiveTranscriptSessionStateFromPiHistory(options: {
  sessionHub: SessionHub;
  sessionId: string;
  summary?: Pick<SessionSummary, 'sessionId' | 'agentId' | 'attributes' | 'revision'>;
}): Promise<Pick<SessionSummary, 'sessionId' | 'agentId' | 'attributes' | 'revision'> | undefined> {
  const trimmed = options.sessionId.trim();
  if (!trimmed) {
    return undefined;
  }

  const latestSummary =
    (await options.sessionHub.getSessionIndex().getSession(trimmed)) ??
    options.summary ??
    options.sessionHub.getSessionState(trimmed)?.summary;
  if (!latestSummary?.agentId) {
    return latestSummary;
  }

  const agent = options.sessionHub.getAgentRegistry().getAgent(latestSummary.agentId);
  const providerId = agent?.chat?.provider;
  if (providerId !== 'pi' && providerId !== 'pi-cli') {
    return latestSummary;
  }

  const revision = getPiTranscriptRevision(latestSummary.attributes as SessionAttributes | undefined);
  const existingState = normalizeLiveTranscriptState(liveTranscriptStateBySession.get(trimmed));
  const writer = options.sessionHub.getPiSessionWriter?.();
  const projected = await loadCanonicalPiTranscriptEvents({
    sessionId: trimmed,
    revision,
    providerId,
    ...(latestSummary.attributes
      ? { attributes: latestSummary.attributes as SessionAttributes }
      : {}),
    ...(writer ? { baseDir: writer.getBaseDir() } : {}),
  });
  if (existingState) {
    const hasActiveLiveState =
      !!existingState.activeRequestId || existingState.replayOverlay.length > 0;
    if (hasActiveLiveState || existingState.nextSequence >= projected.length) {
      return latestSummary;
    }
  }
  seedLiveTranscriptSessionState({
    sessionId: trimmed,
    revision,
    nextSequence: projected.length,
  });

  return latestSummary;
}

function getProjectedTranscriptRevision(sessionHub: SessionHub, sessionId: string): number {
  if (typeof sessionHub.getSessionState !== 'function') {
    return 0;
  }
  const summary = sessionHub.getSessionState(sessionId)?.summary;
  if (!summary) {
    return 0;
  }
  const agent = summary.agentId ? sessionHub.getAgentRegistry().getAgent(summary.agentId) : undefined;
  const providerId = agent?.chat?.provider;
  if (providerId === 'pi' || providerId === 'pi-cli') {
    return getPiTranscriptRevision(summary.attributes);
  }
  return Math.max(0, summary.revision ?? 0);
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
  const liveState = normalizeLiveTranscriptState(liveTranscriptStateBySession.get(sessionId));
  const revision = liveState?.revision ?? getProjectedTranscriptRevision(sessionHub, sessionId);
  const nextState =
    liveState ?? { revision, nextSequence: 0, activeRequestId: null as string | null, replayOverlay: [] };
  const projected = buildLiveProjectedTranscriptEvents({
    sessionId,
    revision,
    startSequence: nextState.nextSequence,
    activeRequestId: nextState.activeRequestId,
    events,
  });
  const replayOverlay = [...nextState.replayOverlay];
  for (const [index, sourceEvent] of events.entries()) {
    const projectedEvent = projected.events[index];
    if (!projectedEvent) {
      continue;
    }
    const existingIndex = replayOverlay.findIndex((event) => event.sequence === projectedEvent.sequence);
    if (existingIndex === -1) {
      replayOverlay.push(projectedEvent);
    } else {
      replayOverlay[existingIndex] = projectedEvent;
    }
  }
  liveTranscriptStateBySession.set(sessionId, {
    revision,
    nextSequence: projected.nextSequence,
    activeRequestId: projected.activeRequestId,
    replayOverlay,
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
          if (!shouldPersistPiAssistantEvent(event)) {
            continue;
          }
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
    } else if (!eventStore) {
      // Non-Pi callers should normally provide an EventStore. If not, fall back to
      // broadcast-only behavior so live transcript updates still work.
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
