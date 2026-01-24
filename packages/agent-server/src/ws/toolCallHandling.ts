import { randomUUID } from 'node:crypto';

import type { ServerToolCallStartMessage, ServerToolResultMessage } from '@assistant/shared';

import { ToolError, type ToolContext, type ToolHost } from '../tools';
import type { InteractionRequest, UserResponse } from '../tools/types';
import type { RateLimiter } from '../rateLimit';
import type { SessionHub, LogicalSessionState } from '../sessionHub';
import type { ChatCompletionToolCallState } from '../chatCompletionTypes';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { ScheduledSessionService } from '../scheduledSessions/scheduledSessionService';
import type { SearchService } from '../search/searchService';
import {
  emitToolCallEvent,
  emitToolOutputChunkEvent,
  emitToolResultEvent,
  emitInteractionRequestEvent,
  emitInteractionResponseEvent,
} from '../events/chatEventUtils';
import { InteractionRegistryError } from './interactionRegistry';

function normaliseToolError(error: unknown): { code: string; message: string } {
  if (error instanceof ToolError) {
    return { code: error.code, message: error.message };
  }

  if (error && typeof error === 'object') {
    const anyError = error as { code?: unknown; message?: unknown };
    const code = typeof anyError.code === 'string' ? anyError.code : 'tool_error';
    const message = typeof anyError.message === 'string' ? anyError.message : 'Tool call failed';
    return { code, message };
  }

  return {
    code: 'tool_error',
    message: 'Tool call failed',
  };
}

interface ToolTruncationSummary {
  truncated: boolean;
  truncatedBy?: 'lines' | 'bytes';
  totalLines?: number;
  totalBytes?: number;
  outputLines?: number;
  outputBytes?: number;
}

function extractTruncationSummary(result: unknown): ToolTruncationSummary | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const anyResult = result as {
    truncation?: unknown;
    details?: { truncation?: unknown } | unknown;
    hasMore?: unknown;
    totalLines?: unknown;
    content?: unknown;
  };

  let truncation: Record<string, unknown> | null = null;

  if (anyResult.truncation && typeof anyResult.truncation === 'object') {
    truncation = anyResult.truncation as Record<string, unknown>;
  } else if (anyResult.details && typeof anyResult.details === 'object') {
    const details = anyResult.details as { truncation?: unknown };
    if (details.truncation && typeof details.truncation === 'object') {
      truncation = details.truncation as Record<string, unknown>;
    }
  }

  // Fallback for legacy read results that only expose hasMore/totalLines/content.
  if (!truncation && anyResult.hasMore === true) {
    const totalLinesValue = anyResult.totalLines;
    const contentValue = anyResult.content;

    const totalLines =
      typeof totalLinesValue === 'number' && Number.isFinite(totalLinesValue)
        ? totalLinesValue
        : undefined;

    let outputLines: number | undefined;
    if (typeof contentValue === 'string' && contentValue.length > 0) {
      outputLines = contentValue.split('\n').length;
    }

    if (totalLines !== undefined || outputLines !== undefined) {
      const summary: ToolTruncationSummary = {
        truncated: true,
        truncatedBy: 'lines',
      };
      if (totalLines !== undefined) {
        summary.totalLines = totalLines;
      }
      if (outputLines !== undefined) {
        summary.outputLines = outputLines;
      }
      return summary;
    }
  }

  if (!truncation) {
    return null;
  }

  const truncatedFlag = truncation['truncated'];
  const truncatedByRaw = truncation['truncatedBy'];
  const totalLinesRaw = truncation['totalLines'];
  const totalBytesRaw = truncation['totalBytes'];
  const outputLinesRaw = truncation['outputLines'];
  const outputBytesRaw = truncation['outputBytes'];

  const truncated = truncatedFlag === true;
  const truncatedBy =
    truncatedByRaw === 'lines' || truncatedByRaw === 'bytes'
      ? (truncatedByRaw as 'lines' | 'bytes')
      : undefined;

  if (!truncated && !truncatedBy) {
    return null;
  }

  const summary: ToolTruncationSummary = {
    truncated: true,
  };

  if (truncatedBy) {
    summary.truncatedBy = truncatedBy;
  }

  if (typeof totalLinesRaw === 'number' && Number.isFinite(totalLinesRaw)) {
    summary.totalLines = totalLinesRaw;
  }
  if (typeof totalBytesRaw === 'number' && Number.isFinite(totalBytesRaw)) {
    summary.totalBytes = totalBytesRaw;
  }
  if (typeof outputLinesRaw === 'number' && Number.isFinite(outputLinesRaw)) {
    summary.outputLines = outputLinesRaw;
  }
  if (typeof outputBytesRaw === 'number' && Number.isFinite(outputBytesRaw)) {
    summary.outputBytes = outputBytesRaw;
  }

  return summary;
}

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
    responseId?: string;
    signal?: AbortSignal;
  };
}): Promise<unknown> {
  const {
    request,
    context: { sessionId, callId, toolName, sessionHub, eventStore, turnId, responseId, signal },
  } = options;
  const registry = sessionHub.getInteractionRegistry();

  let currentRequest: InteractionRequest = request;

  while (true) {
    const interactionId = randomUUID();
    const availability = sessionHub.getInteractionAvailability(sessionId);

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
              return {
                pending: true,
                message: outcome.pending.message,
                ...(outcome.pending.queued ? { queued: true } : {}),
              };
            }
          }
          throw new ToolError('interaction_timeout', 'Interaction timed out');
        }
        if (err.code === 'cancelled') {
          currentRequest.onCancel?.();
          throw new ToolError('tool_aborted', 'Tool execution aborted');
        }
      }
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
      return {
        pending: true,
        message: outcome.pending.message,
        ...(outcome.pending.queued ? { queued: true } : {}),
      };
    }
  }
}

export async function handleChatToolCalls(options: {
  sessionId: string;
  state: LogicalSessionState;
  toolCalls: ChatCompletionToolCallState[];
  baseToolHost: ToolHost;
  sessionToolHost: ToolHost;
  sessionHub: SessionHub;
  toolCallRateLimiter?: RateLimiter;
  maxToolCallsPerMinute: number;
  rateLimitWindowMs: number;
  envConfig: EnvConfig;
  eventStore?: EventStore;
  scheduledSessionService?: ScheduledSessionService;
  searchService?: SearchService;
  /** Forward tool output chunks to another session (for agent-to-agent streaming) */
  forwardChunksTo?: {
    sessionId: string;
    toolCallId: string;
  };
  sendError: (
    code: string,
    message: string,
    details?: unknown,
    options?: { retryable?: boolean },
  ) => void;
  log: (...args: unknown[]) => void;
}): Promise<void> {
  const {
    sessionId,
    state,
    toolCalls,
    baseToolHost,
    sessionToolHost,
    sessionHub,
    envConfig,
    toolCallRateLimiter,
    maxToolCallsPerMinute,
    rateLimitWindowMs,
    sendError,
    log,
    eventStore,
    scheduledSessionService,
    searchService,
    forwardChunksTo,
  } = options;

  const shouldEmitChatEvents = !!eventStore;
  const turnId = state.activeChatRun?.turnId;
  const responseId = state.activeChatRun?.responseId;

  log('handleChatToolCalls', {
    sessionId,
    toolCount: toolCalls.length,
    tools: toolCalls.map((c) => c.name),
  });

  const agentExchangeId = state.activeChatRun?.agentExchangeId;

  const abortSignal = state.activeChatRun?.abortController.signal ?? new AbortController().signal;
  const runForSignal =
    state.activeChatRun && state.activeChatRun.abortController.signal === abortSignal
      ? state.activeChatRun
      : undefined;
  const runToolCalls =
    runForSignal?.activeToolCalls ??
    (runForSignal ? (runForSignal.activeToolCalls = new Map()) : undefined);

  // Use a shared timestamp for all tool calls in this batch so they're grouped together
  // when rebuilding chat messages from transcript
  const batchTimestamp = new Date().toISOString();

  for (const call of toolCalls) {
    // Track cumulative offset for tool output streaming
    let toolOutputOffset = 0;

    const interactionAvailability = sessionHub.getInteractionAvailability(sessionId);

    const toolContext: ToolContext = {
      signal: abortSignal,
      sessionId,
      toolCallId: call.id,
      ...(turnId ? { turnId } : {}),
      ...(responseId ? { responseId } : {}),
      agentRegistry: sessionHub.getAgentRegistry(),
      sessionIndex: sessionHub.getSessionIndex(),
      envConfig,
      sessionHub,
      baseToolHost,
      ...(eventStore ? { eventStore } : {}),
      ...(scheduledSessionService ? { scheduledSessionService } : {}),
      ...(searchService ? { searchService } : {}),
      interaction: interactionAvailability,
      requestInteraction: async (request) => {
        const availability = sessionHub.getInteractionAvailability(sessionId);
        if (!availability.available) {
          throw interactionUnavailableError(request);
        }
        return executeInteraction({
          request,
          context: {
            sessionId,
            callId: call.id,
            toolName: call.name,
            sessionHub,
            ...(turnId ? { turnId } : {}),
            ...(responseId ? { responseId } : {}),
            ...(eventStore ? { eventStore } : {}),
            ...(abortSignal ? { signal: abortSignal } : {}),
          },
        });
      },
      onUpdate: (update) => {
        if (!update || typeof update.delta !== 'string') {
          return;
        }
        // Update cumulative offset
        toolOutputOffset += update.delta.length;

        // Emit tool_output_chunk ChatEvent (transient, not persisted)
        const details = update.details as Record<string, unknown> | undefined;
        const streamValue = details?.['stream'];
        const streamType =
          streamValue === 'stdout' || streamValue === 'stderr' ? streamValue : undefined;

        emitToolOutputChunkEvent({
          sessionHub,
          sessionId,
          ...(turnId ? { turnId } : {}),
          ...(responseId ? { responseId } : {}),
          toolCallId: call.id,
          toolName: call.name,
          chunk: update.delta,
          offset: toolOutputOffset,
          ...(streamType ? { stream: streamType } : {}),
        });

        // Forward chunks to caller session (for agent-to-agent streaming)
        if (forwardChunksTo) {
          emitToolOutputChunkEvent({
            sessionHub,
            sessionId: forwardChunksTo.sessionId,
            toolCallId: forwardChunksTo.toolCallId,
            toolName: `agent:${call.name}`,
            chunk: update.delta,
            offset: toolOutputOffset,
            ...(streamType ? { stream: streamType } : {}),
          });
        }
      },
    };

    const argsJson = call.argumentsJson.trim() || '{}';

    const rateLimited = toolCallRateLimiter ? toolCallRateLimiter.check(1) : { allowed: true };

    // Notify client that tool call is starting
    const toolCallStartMessage: ServerToolCallStartMessage = {
      type: 'tool_call_start',
      callId: call.id,
      toolName: call.name,
      arguments: argsJson,
      ...(agentExchangeId ? { agentExchangeId } : {}),
    };
    sessionHub.broadcastToSession(sessionId, toolCallStartMessage);

    if (shouldEmitChatEvents && eventStore && turnId && responseId) {
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(argsJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // Ignore parse errors and fall back to empty args object.
      }

      emitToolCallEvent({
        eventStore,
        sessionHub,
        sessionId,
        turnId,
        responseId,
        toolCallId: call.id,
        toolName: call.name,
        args,
      });
    }

    if (runToolCalls) {
      runToolCalls.set(call.id, {
        callId: call.id,
        toolName: call.name,
        argsJson,
      });
    }

    if (toolCallRateLimiter && !rateLimited.allowed) {
      const errorPayload = {
        code: 'rate_limit_tools',
        message: 'Too many tool calls in a short period; please try again later.',
      };

      const toolMessageContent = JSON.stringify({
        ok: false,
        result: undefined,
        error: errorPayload,
      });

      state.chatMessages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolMessageContent,
      });

      sendError(
        'rate_limit_tools',
        'Too many tool calls in a short period; please try again later.',
        {
          limit: maxToolCallsPerMinute,
          windowMs: rateLimitWindowMs,
          retryAfterMs: rateLimited.retryAfterMs,
        },
        {
          retryable: true,
        },
      );

      continue;
    }

    let ok = false;
    let result: unknown;
    let error:
      | {
          code: string;
          message: string;
        }
      | undefined;

    try {
      result = await sessionToolHost.callTool(call.name, argsJson, toolContext);
      // If the result has an explicit `ok` field, use that; otherwise assume success
      if (result && typeof result === 'object' && 'ok' in result) {
        ok = (result as { ok: unknown }).ok === true;
        // Set error for failed tool calls (e.g., non-zero exit code)
        if (!ok && !error) {
          error = { code: 'tool_failed', message: 'Tool call returned failure' };
        }
      } else {
        ok = true;
      }
    } catch (err) {
      const normalised = normaliseToolError(err);
      error = { code: normalised.code, message: normalised.message };
      result = undefined;
    }

    const runAfterCall = state.activeChatRun;
    const cancelledByOutput = runAfterCall?.outputCancelled === true;

    if (cancelledByOutput) {
      if (runToolCalls) {
        runToolCalls.delete(call.id);
      }
      break;
    }

    const truncationSummary = result !== undefined ? extractTruncationSummary(result) : null;

    // Broadcast tool result to client
    const toolResultMessage: ServerToolResultMessage = {
      type: 'tool_result',
      callId: call.id,
      toolName: call.name,
      ok,
      ...(truncationSummary
        ? {
            truncated: truncationSummary.truncated,
            truncatedBy: truncationSummary.truncatedBy,
            totalLines: truncationSummary.totalLines,
            totalBytes: truncationSummary.totalBytes,
            outputLines: truncationSummary.outputLines,
            outputBytes: truncationSummary.outputBytes,
          }
        : {}),
      ...(result !== undefined ? { result } : {}),
      ...(error ? { error } : {}),
      ...(agentExchangeId ? { agentExchangeId } : {}),
    };
    sessionHub.broadcastToSession(sessionId, toolResultMessage);

    if (shouldEmitChatEvents && eventStore && turnId && responseId) {
      emitToolResultEvent({
        eventStore,
        sessionHub,
        sessionId,
        turnId,
        responseId,
        toolCallId: call.id,
        result,
        error,
      });
    }

    const toolMessageContent = JSON.stringify({
      ok,
      result,
      error,
    });

    state.chatMessages.push({
      role: 'tool',
      tool_call_id: call.id,
      content: toolMessageContent,
    });

    if (runToolCalls) {
      runToolCalls.delete(call.id);
    }
  }

  return;
}
