import type { ClientControlMessage, ServerToolResultMessage } from '@assistant/shared';
import type { ChatEvent } from '@assistant/shared';

import type { LogicalSessionState, SessionHub } from '../sessionHub';
import type { EventStore } from '../events';
import { appendAndBroadcastChatEvents, createChatEventBase } from '../events/chatEventUtils';

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
  const hadActiveToolCalls = !!(activeToolCalls && activeToolCalls.size > 0);

  const partialText = run.accumulatedText.trim();
  if (partialText.length > 0) {
    if (eventStore) {
      const events: ChatEvent[] = [
        {
          ...createChatEventBase({
            sessionId,
            ...(run.turnId ? { turnId: run.turnId } : {}),
            ...(run.responseId ? { responseId: run.responseId } : {}),
          }),
          type: 'assistant_done',
          payload: { text: partialText },
        },
      ];
      void appendAndBroadcastChatEvents(
        {
          eventStore,
          sessionHub,
          sessionId,
        },
        events,
      );
    }

    if (!hadActiveToolCalls) {
      state.chatMessages.push({
        role: 'assistant',
        content: partialText,
      });
    }

    void sessionHub.recordSessionActivity(
      sessionId,
      partialText.length > 120 ? `${partialText.slice(0, 117)}…` : partialText,
    );
  }

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
        void appendAndBroadcastChatEvents(
          {
            eventStore,
            sessionHub,
            sessionId,
          },
          [
            {
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
            },
          ],
        );
      }
    }
    activeToolCalls.clear();
  }

  // Best-effort: emit a unified interrupt event so ChatRenderer can render
  // cancellation consistently with other chat events.
  if (eventStore) {
    const turnId = run.turnId;
    const responseId = run.responseId;
    const events: ChatEvent[] = [
      {
        ...createChatEventBase({
          sessionId,
          ...(turnId ? { turnId } : {}),
          ...(responseId ? { responseId } : {}),
        }),
        type: 'interrupt',
        payload: { reason: 'user_cancel' },
      },
    ];
    void appendAndBroadcastChatEvents(
      {
        eventStore,
        sessionHub,
        sessionId,
      },
      events,
    );
  }

  const piSessionWriter = sessionHub.getPiSessionWriter?.();
  if (piSessionWriter) {
    const agentId = state.summary.agentId;
    const agent = agentId ? sessionHub.getAgentRegistry().getAgent(agentId) : undefined;
    if (agent?.chat?.provider === 'pi') {
      void piSessionWriter
        .appendAssistantEvent({
          summary: state.summary,
          eventType: 'interrupt',
          payload: { reason: 'user_cancel' },
          ...(run.turnId ? { turnId: run.turnId } : {}),
          ...(run.responseId ? { responseId: run.responseId } : {}),
          updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
        })
        .catch((err) => {
          log('failed to persist interrupt into Pi session history', err);
        });
    }
  }

  broadcastOutputCancelled(sessionId, run.responseId);
}
