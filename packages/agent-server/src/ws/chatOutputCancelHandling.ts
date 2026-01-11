import type { ClientControlMessage, ServerToolResultMessage } from '@assistant/shared';
import type { ChatEvent } from '@assistant/shared';

import type { ConversationStore } from '../conversationStore';
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
  conversationStore: ConversationStore;
  sessionHub: SessionHub;
  broadcastOutputCancelled: (sessionId: string, responseId?: string) => void;
  log: (message: string, details?: unknown) => void;
  eventStore?: EventStore;
}

export function handleChatOutputCancel(options: HandleChatOutputCancelOptions): void {
  const {
    message,
    activeRunState,
    conversationStore,
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

  const partialText = run.accumulatedText.trim();
  if (partialText.length > 0) {
    // Log assistant message AFTER tool calls so reconstruction attaches tools to this bubble.
    // Don't use textStartedAt - we want this to come after any tool_result records.
    void conversationStore.logAssistantMessage({
      sessionId,
      responseId: run.responseId,
      modality: 'text',
      text: partialText,
      interrupted: true,
    });

    state.chatMessages.push({
      role: 'assistant',
      content: partialText,
    });

    void sessionHub.recordSessionActivity(
      sessionId,
      partialText.length > 120 ? `${partialText.slice(0, 117)}…` : partialText,
    );
  }

  const activeToolCalls = run.activeToolCalls;
  if (activeToolCalls && activeToolCalls.size > 0) {
    for (const [, call] of activeToolCalls) {
      const errorPayload = {
        code: 'tool_interrupted',
        message: 'Tool call was interrupted by the user',
      };

      void conversationStore.logToolResult({
        sessionId,
        callId: call.callId,
        toolName: call.toolName,
        ok: false,
        error: errorPayload,
        ...(run.agentExchangeId ? { agentExchangeId: run.agentExchangeId } : {}),
      });

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
    }
    activeToolCalls.clear();
  }

  void conversationStore.logOutputCancelled({
    sessionId,
    ...(run.responseId ? { responseId: run.responseId } : {}),
  });

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

  broadcastOutputCancelled(sessionId, run.responseId);
}
