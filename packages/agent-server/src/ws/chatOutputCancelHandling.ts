import type { ClientControlMessage, ServerToolResultMessage } from '@assistant/shared';
import type { ChatEvent } from '@assistant/shared';

import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { EventStore } from '../events';
import { createChatEventBase } from '../events/chatEventUtils';
import { finalizeChatTurn } from '../chatTurnFinalization';

export interface ActiveChatRunState {
  sessionId: string;
  state: LogicalSessionState;
}

export interface HandleChatOutputCancelOptions {
  message: ClientControlMessage;
  activeRunState: ActiveChatRunState | undefined;
  sessionHub: SessionHub;
  broadcastOutputCancelled: (sessionId: string, responseId?: string) => void;
  log: (message: string, details?: unknown) => void;
  eventStore?: EventStore;
}

export function handleChatOutputCancel(options: HandleChatOutputCancelOptions): void {
  const {
    message,
    activeRunState,
    sessionHub,
    broadcastOutputCancelled,
    log,
    eventStore,
  } = options;

  const active = activeRunState;
  if (!active) {
    return;
  }

  const { state, sessionId } = active;
  const run: NonNullable<LogicalSessionState['activeChatRun']> | undefined = state.activeChatRun;
  if (!run) {
    return;
  }

  log('handling chat completions output cancel', {
    responseId: run.responseId,
    audioEndMs: message.audioEndMs,
  });

  if (
    typeof message.audioEndMs === 'number' &&
    Number.isFinite(message.audioEndMs) &&
    message.audioEndMs >= 0
  ) {
    run.audioTruncatedAtMs = message.audioEndMs;
  }

  run.outputCancelled = true;

  run.abortController.abort();

  if (run.ttsSession) {
    void run.ttsSession.cancel();
  }

  const activeToolCalls = run.activeToolCalls;

  const partialText = run.accumulatedText;
  const hasPartialText = partialText.trim().length > 0;
  const shouldEmitInterrupt = Boolean(run.turnId);

  const toolResultEvents: ChatEvent[] = [];
  if (activeToolCalls && activeToolCalls.size > 0) {
    for (const [, call] of activeToolCalls) {
      const errorPayload = {
        code: 'tool_interrupted',
        message: 'Tool call was interrupted by the user',
      };

      // Add tool result to chat messages so OpenAI API doesn't complain about missing tool response
      const toolMessageContent = JSON.stringify({
        ok: false,
        result: undefined,
        error: errorPayload,
      });
      state.chatMessages.push({
        role: 'tool',
        tool_call_id: call.callId,
        content: toolMessageContent,
        historyTimestampMs: Date.now(),
      });

      const messagePayload: ServerToolResultMessage = {
        type: 'tool_result',
        callId: call.callId,
        toolName: call.toolName,
        ok: false,
        error: errorPayload,
      };
      sessionHub.broadcastToSession(sessionId, messagePayload);

      if (eventStore && run.turnId && run.responseId) {
        toolResultEvents.push({
          ...createChatEventBase({
            sessionId,
            ...(run.turnId ? { turnId: run.turnId } : {}),
            ...(run.responseId ? { responseId: run.responseId } : {}),
          }),
          type: 'tool_result',
          payload: {
            toolCallId: call.callId,
            result: null,
            error: errorPayload,
          },
        });
      }
    }
    activeToolCalls.clear();
  }

  const events: ChatEvent[] = [];
  if (hasPartialText) {
    events.push({
      ...createChatEventBase({
        sessionId,
        ...(run.turnId ? { turnId: run.turnId } : {}),
        ...(run.responseId ? { responseId: run.responseId } : {}),
      }),
      type: 'assistant_done',
      payload: {
        text: partialText,
        interrupted: true,
      },
    });
  }
  events.push(...toolResultEvents);

  const agentId = state.summary.agentId;
  const agent = agentId ? sessionHub.getAgentRegistry().getAgent(agentId) : undefined;
  const shouldPersistPiTurnEnd = agent?.chat?.provider === 'pi' || agent?.chat?.provider === 'pi-cli';
  void finalizeChatTurn({
    sessionId,
    state,
    sessionHub,
    run,
    log,
    ...(eventStore ? { eventStore } : {}),
    ...(shouldEmitInterrupt ? { interruptReason: 'user_cancel' as const } : {}),
    ...(events.length > 0 ? { prependEvents: events } : {}),
    ...(shouldPersistPiTurnEnd ? { piTurnEndStatus: 'interrupted' as const } : {}),
  });

  broadcastOutputCancelled(sessionId, run.responseId);
}
