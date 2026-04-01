import type { ChatEvent, InterruptReason } from '@assistant/shared';

import type { EventStore } from './events';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import { appendAndBroadcastChatEvents, createChatEventBase } from './events/chatEventUtils';

type ActiveChatRun = NonNullable<LogicalSessionState['activeChatRun']>;

export function claimRunTerminalEvents(run: ActiveChatRun | undefined): run is ActiveChatRun {
  if (!run || run.terminalEventsFinalized) {
    return false;
  }
  run.terminalEventsFinalized = true;
  return true;
}

export async function finalizeChatTurn(options: {
  sessionId: string;
  state: LogicalSessionState;
  sessionHub: SessionHub;
  run: ActiveChatRun | undefined;
  log: (message: string, details?: unknown) => void;
  eventStore?: EventStore;
  interruptReason?: InterruptReason;
  error?: { code: string; message: string };
  prependEvents?: ChatEvent[];
  piTurnEndStatus?: 'completed' | 'interrupted';
}): Promise<boolean> {
  const {
    sessionId,
    state,
    sessionHub,
    run,
    log,
    eventStore,
    interruptReason,
    error,
    prependEvents = [],
    piTurnEndStatus,
  } = options;

  if (!claimRunTerminalEvents(run)) {
    return false;
  }

  const turnId = run.turnId;
  const responseId = run.responseId;
  const overlayEvents: ChatEvent[] = [...prependEvents];

  if (turnId && error) {
    overlayEvents.push({
      ...createChatEventBase({
        sessionId,
        turnId,
        ...(responseId ? { responseId } : {}),
      }),
      type: 'error',
      payload: {
        code: error.code,
        message: error.message,
      },
    });
  }

  if (turnId && interruptReason) {
    overlayEvents.push({
      ...createChatEventBase({
        sessionId,
        turnId,
        ...(responseId ? { responseId } : {}),
      }),
      type: 'interrupt',
      payload: { reason: interruptReason },
    });
  }

  if (turnId) {
    overlayEvents.push({
      ...createChatEventBase({
        sessionId,
        turnId,
      }),
      type: 'turn_end',
      payload: {},
    });
  }

  if (eventStore && overlayEvents.length > 0) {
    await appendAndBroadcastChatEvents(
      {
        eventStore,
        sessionHub,
        sessionId,
      },
      overlayEvents,
    );
  }

  const piSessionWriter = sessionHub.getPiSessionWriter?.();
  if (!piSessionWriter || !turnId || !piTurnEndStatus) {
    return true;
  }

  try {
    if (!eventStore) {
      for (const event of overlayEvents) {
        if (event.type === 'turn_end') {
          continue;
        }
        await piSessionWriter.appendAssistantEvent({
          summary: state.summary,
          eventType: event.type,
          payload: event.payload,
          ...(event.turnId ? { turnId: event.turnId } : {}),
          ...(event.responseId ? { responseId: event.responseId } : {}),
          updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
        });
      }
    }

    const updatedSummary = await piSessionWriter.appendTurnEnd({
      summary: state.summary,
      turnId,
      status: piTurnEndStatus,
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
    });
    if (updatedSummary) {
      state.summary = updatedSummary;
    }
    await eventStore?.clearTransientSession?.(sessionId);
  } catch (err) {
    log('failed to persist terminal turn state into Pi session history', err);
  }

  return true;
}
