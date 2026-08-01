import { randomUUID } from 'node:crypto';

import type { EventStore } from './events';
import {
  emitInteractionPendingEvent,
  emitInteractionRequestEvent,
  emitInteractionResponseEvent,
} from './events/chatEventUtils';
import type { SessionHub } from './sessionHub';
import { ToolError } from './tools/errors';
import type { InteractionRequest, UserResponse } from './tools/types';
import { InteractionRegistryError } from './ws/interactionRegistry';

const DEFAULT_INTERACTION_TIMEOUT_MS = 5 * 60_000;

export function interactionUnavailableError(request: InteractionRequest): ToolError {
  const message =
    request.type === 'approval'
      ? 'Approval required but no interactive client is available to respond.'
      : 'Input required but no interactive client is available to respond. Ask the user in chat.';
  return new ToolError('interaction_unavailable', message);
}

export async function executeInteraction(options: {
  request: InteractionRequest;
  context: {
    sessionId: string;
    callId: string;
    toolName: string;
    sessionHub: SessionHub;
    eventStore?: EventStore;
    turnId?: string;
    requestId?: string;
    responseId?: string;
    signal?: AbortSignal;
  };
}): Promise<unknown> {
  const {
    request,
    context: {
      sessionId,
      callId,
      toolName,
      sessionHub,
      eventStore,
      turnId,
      requestId: _requestId,
      responseId,
      signal,
    },
  } = options;
  const registry = sessionHub.getInteractionRegistry();

  let currentRequest: InteractionRequest = request;
  let pendingActive = false;
  const setPending = (
    pending: boolean,
    presentation?: 'tool' | 'questionnaire' | 'composer',
  ): void => {
    if (pendingActive === pending) {
      return;
    }
    pendingActive = pending;
    emitInteractionPendingEvent({
      ...(eventStore ? { eventStore } : {}),
      sessionHub,
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...(responseId ? { responseId } : {}),
      toolCallId: callId,
      toolName,
      pending,
      ...(presentation ? { presentation } : {}),
    });
  };

  while (true) {
    const interactionId = randomUUID();
    const availability = sessionHub.getInteractionAvailability(sessionId);
    setPending(true, currentRequest.presentation);

    console.log('[interaction] request', {
      sessionId,
      callId,
      toolName,
      interactionId,
      type: currentRequest.type,
      presentation: currentRequest.presentation ?? 'tool',
      hasInputSchema: Boolean(currentRequest.inputSchema),
      timeoutMs: currentRequest.timeoutMs ?? DEFAULT_INTERACTION_TIMEOUT_MS,
      turnId: turnId ?? null,
      responseId: responseId ?? null,
      available: availability.available,
      supportedCount: availability.supportedCount,
      enabledCount: availability.enabledCount,
    });

    emitInteractionRequestEvent({
      ...(eventStore ? { eventStore } : {}),
      sessionHub,
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...(responseId ? { responseId } : {}),
      toolCallId: callId,
      interactionId,
      toolName,
      interactionType: currentRequest.type,
      ...(currentRequest.presentation ? { presentation: currentRequest.presentation } : {}),
      ...(currentRequest.prompt ? { prompt: currentRequest.prompt } : {}),
      ...(currentRequest.approvalScopes ? { approvalScopes: currentRequest.approvalScopes } : {}),
      ...(currentRequest.inputSchema ? { inputSchema: currentRequest.inputSchema } : {}),
      ...(currentRequest.timeoutMs ? { timeoutMs: currentRequest.timeoutMs } : {}),
      ...(currentRequest.completedView ? { completedView: currentRequest.completedView } : {}),
      ...(currentRequest.errorSummary ? { errorSummary: currentRequest.errorSummary } : {}),
      ...(currentRequest.fieldErrors ? { fieldErrors: currentRequest.fieldErrors } : {}),
    });

    let userResponse: UserResponse;
    try {
      console.log('[interaction] awaiting response', {
        sessionId,
        callId,
        interactionId,
      });
      userResponse = await registry.waitForResponse({
        sessionId,
        callId,
        interactionId,
        timeoutMs: currentRequest.timeoutMs ?? DEFAULT_INTERACTION_TIMEOUT_MS,
        ...(signal ? { signal } : {}),
      });
    } catch (err) {
      if (err instanceof InteractionRegistryError) {
        if (err.code === 'timeout') {
          if (currentRequest.onTimeout) {
            const outcome = await currentRequest.onTimeout();
            if ('complete' in outcome) {
              setPending(false, currentRequest.presentation);
              return outcome.complete;
            }
            if ('reprompt' in outcome) {
              currentRequest = {
                ...outcome.reprompt,
                onResponse: currentRequest.onResponse,
                ...(currentRequest.onTimeout ? { onTimeout: currentRequest.onTimeout } : {}),
                ...(currentRequest.onCancel ? { onCancel: currentRequest.onCancel } : {}),
              };
              continue;
            }
            if ('pending' in outcome) {
              setPending(false, currentRequest.presentation);
              return {
                pending: true,
                message: outcome.pending.message,
                ...(outcome.pending.queued ? { queued: true } : {}),
              };
            }
          }
          setPending(false, currentRequest.presentation);
          throw new ToolError('interaction_timeout', 'Interaction timed out');
        }
        if (err.code === 'cancelled') {
          currentRequest.onCancel?.();
          setPending(false, currentRequest.presentation);
          throw new ToolError('tool_aborted', 'Tool execution aborted');
        }
      }
      setPending(false, currentRequest.presentation);
      throw err;
    }

    emitInteractionResponseEvent({
      ...(eventStore ? { eventStore } : {}),
      sessionHub,
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...(responseId ? { responseId } : {}),
      toolCallId: callId,
      interactionId,
      action: userResponse.action,
      ...(userResponse.approvalScope ? { approvalScope: userResponse.approvalScope } : {}),
      ...(userResponse.input ? { input: userResponse.input } : {}),
      ...(userResponse.reason ? { reason: userResponse.reason } : {}),
    });

    console.log('[interaction] response received', {
      sessionId,
      callId,
      interactionId,
      action: userResponse.action,
      hasInput: Boolean(userResponse.input),
    });

    const outcome = await currentRequest.onResponse(userResponse);

    if ('complete' in outcome) {
      console.log('[interaction] outcome complete', { sessionId, callId, interactionId });
      setPending(false, currentRequest.presentation);
      return outcome.complete;
    }

    if ('reprompt' in outcome) {
      console.log('[interaction] outcome reprompt', { sessionId, callId, interactionId });
      currentRequest = {
        ...outcome.reprompt,
        onResponse: currentRequest.onResponse,
        ...(currentRequest.onTimeout ? { onTimeout: currentRequest.onTimeout } : {}),
        ...(currentRequest.onCancel ? { onCancel: currentRequest.onCancel } : {}),
      };
      continue;
    }

    if ('pending' in outcome) {
      console.log('[interaction] outcome pending', { sessionId, callId, interactionId });
      setPending(false, currentRequest.presentation);
      return {
        pending: true,
        message: outcome.pending.message,
        ...(outcome.pending.queued ? { queued: true } : {}),
      };
    }
  }
}
