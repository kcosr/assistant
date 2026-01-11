import { randomUUID } from 'node:crypto';

import type { ChatEvent, ServerChatEventMessage } from '@assistant/shared';

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
  const message: ServerChatEventMessage = {
    type: 'chat_event',
    sessionId,
    event,
  };
  sessionHub.broadcastToSession(sessionId, message);
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
  const message: ServerChatEventMessage = {
    type: 'chat_event',
    sessionId,
    event,
  };
  sessionHub.broadcastToSession(sessionId, message);
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

export interface ChatEventContext {
  eventStore: EventStore;
  sessionHub: SessionHub;
  sessionId: string;
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

  try {
    if (events.length === 1) {
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

  for (const event of events) {
    const message: ServerChatEventMessage = {
      type: 'chat_event',
      sessionId,
      event,
    };
    sessionHub.broadcastToSession(sessionId, message);
  }
}
