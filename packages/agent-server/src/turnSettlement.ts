import type { ChatEvent, ServerTurnSettledMessage, TurnSettlementStatus } from '@assistant/shared';

import type { LogicalSessionState, SessionHub } from './sessionHub';

export interface TurnSettlementCandidate {
  requestId: string;
  responseId: string;
  status: TurnSettlementStatus;
  hasSpeakableOutput: boolean;
  turnOriginId?: string;
}

export function hasSpeakableAssistantOutput(events: readonly ChatEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === 'assistant_done' &&
      event.payload.text.trim().length > 0 &&
      (!event.payload.phase || event.payload.phase === 'final_answer'),
  );
}

export function broadcastTurnSettledIfIdle(options: {
  sessionId: string;
  state: LogicalSessionState;
  sessionHub: SessionHub;
  candidate: TurnSettlementCandidate | null;
  additionalState?: LogicalSessionState;
}): boolean {
  const { sessionId, state, sessionHub, candidate, additionalState } = options;
  if (
    !candidate ||
    state.activeChatRun ||
    additionalState?.activeChatRun ||
    (state.messageQueue?.length ?? 0) > 0 ||
    (additionalState?.messageQueue?.length ?? 0) > 0
  ) {
    return false;
  }

  const message: ServerTurnSettledMessage = {
    type: 'turn_settled',
    sessionId,
    requestId: candidate.requestId,
    responseId: candidate.responseId,
    status: candidate.status,
    hasSpeakableOutput: candidate.hasSpeakableOutput,
    ...(candidate.turnOriginId ? { turnOriginId: candidate.turnOriginId } : {}),
  };
  sessionHub.broadcastToSession(sessionId, message);
  return true;
}
