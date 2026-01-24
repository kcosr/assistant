/**
 * Shared callback factory for CLI-based chat providers (Claude CLI, Codex CLI, Pi CLI).
 * Used by both chatProcessor.ts (HTTP path) and chatRunLifecycle.ts (WebSocket path).
 */

import type {
  ServerMessage,
  ServerToolCallStartMessage,
  ServerToolResultMessage,
} from '@assistant/shared';

import type { SessionHub } from '../sessionHub';
import type { EventStore } from '../events';
import { emitToolCallEvent, emitToolResultEvent } from '../events/chatEventUtils';

export interface CliToolCallbackOptions {
  sessionId: string;
  responseId: string;
  sessionHub: SessionHub;
  sendMessage: (message: ServerMessage) => void;
  log: (...args: unknown[]) => void;

  // Optional - for ChatEvent emission
  eventStore?: EventStore | undefined;
  turnId?: string | undefined;
  shouldEmitChatEvents?: boolean | undefined;

  // Optional - for agent exchange tracking
  getAgentExchangeId?: () => string | undefined;

  // Optional - for tool call metrics
  onToolCallMetric?: (toolName: string, durationMs: number) => void;

  // Provider name for log messages
  providerName: string;
}

export interface CliToolCallbacks {
  onToolCallStart: (
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<void>;
  onToolResult: (callId: string, toolName: string, ok: boolean, result: unknown) => Promise<void>;
}

/**
 * Creates shared onToolCallStart and onToolResult callbacks for CLI providers.
 */
export function createCliToolCallbacks(options: CliToolCallbackOptions): CliToolCallbacks {
  const {
    sessionId,
    responseId,
    sessionHub,
    sendMessage,
    log,
    eventStore,
    turnId,
    shouldEmitChatEvents,
    getAgentExchangeId,
    onToolCallMetric,
    providerName,
  } = options;

  const toolCallStartTimes = new Map<string, number>();

  const onToolCallStart = async (
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> => {
    const command =
      args && typeof args === 'object' && typeof (args as { command?: unknown }).command === 'string'
        ? String((args as { command?: unknown }).command)
        : undefined;
    console.log('[cli tools] tool_call_start', {
      sessionId,
      callId,
      toolName,
      provider: providerName,
      ...(command ? { command } : {}),
      args,
    });
    sessionHub.recordCliToolCall({
      sessionId,
      callId,
      toolName,
      args: args ?? {},
      ...(turnId ? { turnId } : {}),
      ...(responseId ? { responseId } : {}),
    });
    let argsJson = '{}';
    try {
      argsJson = JSON.stringify(args ?? {});
    } catch (err) {
      log(`failed to serialise ${providerName} tool args`, err);
    }

    const agentExchangeId = getAgentExchangeId?.();

    const message: ServerToolCallStartMessage = {
      type: 'tool_call_start',
      callId,
      toolName,
      arguments: argsJson,
      ...(agentExchangeId ? { agentExchangeId } : {}),
    };
    sendMessage(message);

    // Emit tool_call ChatEvent
    if (shouldEmitChatEvents && eventStore && turnId) {
      emitToolCallEvent({
        eventStore,
        sessionHub,
        sessionId,
        turnId,
        responseId,
        toolCallId: callId,
        toolName,
        args: args ?? {},
      });
    }

    toolCallStartTimes.set(callId, Date.now());
  };

  const onToolResult = async (
    callId: string,
    toolName: string,
    ok: boolean,
    result: unknown,
  ): Promise<void> => {
    // Track metrics
    const start = toolCallStartTimes.get(callId);
    if (start !== undefined) {
      const durationMs = Date.now() - start;
      toolCallStartTimes.delete(callId);
      onToolCallMetric?.(toolName, durationMs);
    }

    // Extract error object if present in result
    const isErrorResult =
      !ok &&
      result &&
      typeof result === 'object' &&
      'error' in result &&
      typeof (result as { error?: unknown }).error === 'object';

    let errorObj = isErrorResult
      ? (result as { error: { code: string; message: string } }).error
      : undefined;

    // For failed tool calls without an explicit error, generate one
    // Handle exit codes from shell commands (Codex CLI pattern)
    if (!ok && !errorObj) {
      let messageText = 'Tool call failed';
      if (result && typeof result === 'object') {
        const r = result as { exitCode?: unknown };
        const exitCode = typeof r.exitCode === 'number' ? r.exitCode : undefined;
        if (typeof exitCode === 'number') {
          messageText = `Command exited with code ${exitCode}`;
        }
      }
      errorObj = { code: 'tool_error', message: messageText };
    }

    const agentExchangeId = getAgentExchangeId?.();

    const message: ServerToolResultMessage = {
      type: 'tool_result',
      callId,
      toolName,
      ok,
      ...(result !== undefined ? { result } : {}),
      ...(errorObj ? { error: errorObj } : {}),
      ...(agentExchangeId ? { agentExchangeId } : {}),
    };
    sendMessage(message);

    // Emit tool_result ChatEvent
    if (shouldEmitChatEvents && eventStore && turnId) {
      emitToolResultEvent({
        eventStore,
        sessionHub,
        sessionId,
        turnId,
        responseId,
        toolCallId: callId,
        result: result ?? null,
        error:
          ok === false
            ? (errorObj ?? { code: 'tool_error', message: 'Tool call failed' })
            : undefined,
      });
    }
  };

  return { onToolCallStart, onToolResult };
}
