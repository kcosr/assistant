import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

import type { SessionHub } from './sessionHub';
import type { SessionSummary } from './sessionIndex';
import type { EventStore } from './events';
import {
  appendAndBroadcastChatEvents,
  createChatEventBase,
  emitToolCallEvent,
  emitToolOutputChunkEvent,
  emitToolResultEvent,
} from './events/chatEventUtils';
import type { ChatEvent } from '@assistant/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reserved tool name for bang shell commands. The `_assistant_` prefix marks
 *  it as internal — events with this prefix are excluded from LLM replay. */
export const BANG_SHELL_TOOL_NAME = '_assistant_shell';

/** Prefix used to identify internal assistant tool events that should be
 *  suppressed from LLM message history. */
export const ASSISTANT_INTERNAL_TOOL_PREFIX = '_assistant_';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512 * 1024; // 512 KB

// ---------------------------------------------------------------------------
// Bang command detection / extraction
// ---------------------------------------------------------------------------

export interface BangParseResult {
  /** The raw input was a bang command. */
  isBang: true;
  /** The shell command to execute (trimmed). */
  command: string;
}

export interface BangEscapeResult {
  /** The raw input used the `!!` escape — forward to LLM as `!...`. */
  isBang: false;
  isEscape: true;
  /** The text to forward to the LLM (with leading `!` preserved). */
  text: string;
}

export interface BangNoneResult {
  isBang: false;
  isEscape: false;
}

export type BangDetectResult = BangParseResult | BangEscapeResult | BangNoneResult;

/** Regex matching the client-prepended `<context ... />` line. */
const CONTEXT_LINE_RE = /^\s*<context(?:\s[^>]*?)?\s*\/>(?:\r?\n)?/;

/**
 * Strip a leading `<context ... />` line if present, returning the user's
 * actual text. The client prepends this metadata line before sending over
 * the websocket; we need to look past it for bang detection.
 */
export function stripLeadingContextLine(text: string): string {
  const match = text.match(CONTEXT_LINE_RE);
  return match ? text.slice(match[0].length) : text;
}

/**
 * Detect whether trimmed user input is a bang command, a `!!` escape, or
 * neither.
 *
 * The function automatically strips a leading `<context ... />` line (added
 * by the client) before checking for the bang prefix.
 *
 * Rules:
 * - Input must start with `!` (after any context line).
 * - `!!...` → escape: returns the remainder prefixed with `!` as normal text.
 * - `!` or `!   ` (empty after trimming) → treated as bang with empty command
 *   (caller should reject).
 * - `!<command>` → bang command with leading whitespace after `!` stripped.
 */
export function detectBangCommand(trimmedText: string): BangDetectResult {
  const userText = stripLeadingContextLine(trimmedText);

  if (!userText.startsWith('!')) {
    return { isBang: false, isEscape: false };
  }

  // `!!` escape — send `!` + rest as normal text to LLM
  if (userText.startsWith('!!')) {
    return {
      isBang: false,
      isEscape: true,
      text: userText.slice(1), // remove first `!`, keep second
    };
  }

  // Strip leading whitespace after `!`
  const command = userText.slice(1).trimStart();

  return { isBang: true, command };
}

// ---------------------------------------------------------------------------
// Shell execution
// ---------------------------------------------------------------------------

export interface ShellExecutionResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
}

export interface ExecuteShellCommandOptions {
  command: string;
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  /** Called with each chunk of combined stdout/stderr output. */
  onChunk?: (chunk: string) => void;
  signal?: AbortSignal;
}

/**
 * Execute a shell command via `/bin/sh -c`, streaming combined stdout/stderr
 * through the `onChunk` callback. Enforces timeout and output-size limits
 * during execution (not just on the final result).
 */
export function executeShellCommand(
  options: ExecuteShellCommandOptions,
): Promise<ShellExecutionResult> {
  const {
    command,
    cwd,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    onChunk,
    signal,
  } = options;

  return new Promise<ShellExecutionResult>((resolve) => {
    let output = '';
    let totalBytes = 0;
    let truncated = false;
    let timedOut = false;
    let killed = false;

    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    const kill = () => {
      if (!killed) {
        killed = true;
        child.kill('SIGKILL');
      }
    };

    // Timeout
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);

    // External abort
    if (signal) {
      if (signal.aborted) {
        kill();
      } else {
        signal.addEventListener('abort', () => kill(), { once: true });
      }
    }

    const handleData = (data: Buffer) => {
      if (truncated) return;

      const chunk = data.toString('utf-8');
      const chunkBytes = data.byteLength;

      if (totalBytes + chunkBytes > maxOutputBytes) {
        // Take only what fits
        const remaining = maxOutputBytes - totalBytes;
        const partial = data.subarray(0, remaining).toString('utf-8');
        output += partial;
        totalBytes = maxOutputBytes;
        truncated = true;
        onChunk?.(partial);
        kill();
        return;
      }

      output += chunk;
      totalBytes += chunkBytes;
      onChunk?.(chunk);
    };

    child.stdout?.on('data', handleData);
    child.stderr?.on('data', handleData);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        output: output || `Failed to execute command: ${err.message}`,
        exitCode: null,
        timedOut: false,
        truncated,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        output,
        exitCode: code,
        timedOut,
        truncated,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Bang command orchestration — emit tool events + execute
// ---------------------------------------------------------------------------

export interface HandleBangCommandOptions {
  command: string;
  sessionId: string;
  sessionHub: SessionHub;
  summary: SessionSummary;
  eventStore?: EventStore;
  /** Session working directory (from core.workingDir), or undefined. */
  workingDir?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

/**
 * Full bang command handler: emits tool_call_start, streams output chunks,
 * then persists tool_call + tool_result events.
 */
export async function handleBangCommand(options: HandleBangCommandOptions): Promise<void> {
  const {
    command,
    sessionId,
    sessionHub,
    summary,
    eventStore,
    workingDir,
    timeoutMs,
    maxOutputBytes,
  } = options;

  const cwd = workingDir || process.cwd();
  const toolCallId = randomUUID() as string;
  const turnId = randomUUID() as string;
  const responseId = randomUUID() as string;

  // 1. Emit turn_start so clients see the spinner and Pi gets request boundaries
  //    for turn deletion support.
  const piSessionWriter = sessionHub.getPiSessionWriter?.();
  let currentSummary = summary;
  if (piSessionWriter) {
    const updatedSummary = await piSessionWriter.appendTurnStart({
      summary: currentSummary,
      turnId,
      trigger: 'user',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
    });
    if (updatedSummary) {
      currentSummary = updatedSummary;
    }
  }

  const turnStartEvents: ChatEvent[] = [
    {
      ...createChatEventBase({ sessionId, turnId }),
      type: 'turn_start',
      payload: { trigger: 'user' },
    },
  ];
  await appendAndBroadcastChatEvents(
    { ...(eventStore ? { eventStore } : {}), sessionHub, sessionId },
    turnStartEvents,
  );

  // Broadcast tool_call_start ServerMessage so clients see the spinner immediately
  sessionHub.broadcastToSession(sessionId, {
    type: 'tool_call_start',
    sessionId,
    callId: toolCallId,
    toolName: BANG_SHELL_TOOL_NAME,
    arguments: JSON.stringify({ command, cwd }),
  });

  // 2. Persist tool_call event BEFORE execution so the renderer creates the
  //    terminal bubble and can receive streaming tool_output_chunk events.
  await emitToolCallEvent({
    ...(eventStore ? { eventStore } : {}),
    sessionHub,
    sessionId,
    turnId,
    responseId,
    toolCallId,
    toolName: BANG_SHELL_TOOL_NAME,
    args: { command, cwd },
  });

  // 3. Execute and stream output
  let chunkOffset = 0;
  const result = await executeShellCommand({
    command,
    cwd,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(maxOutputBytes !== undefined ? { maxOutputBytes } : {}),
    onChunk: (chunk) => {
      emitToolOutputChunkEvent({
        sessionHub,
        sessionId,
        turnId,
        responseId,
        toolCallId,
        toolName: BANG_SHELL_TOOL_NAME,
        chunk,
        offset: chunkOffset,
      });
      chunkOffset += chunk.length;
    },
  });

  // 4. Build rendered markdown for the output only (command is in tool_call args
  //    and rendered separately by the client in the input block)
  const outputLines: string[] = [];
  if (result.output) {
    outputLines.push('```');
    outputLines.push(result.output.trimEnd());
    outputLines.push('```');
  }
  if (result.truncated) {
    outputLines.push('\n*Output truncated (size limit reached)*');
  }
  if (result.timedOut) {
    outputLines.push('\n*Command timed out*');
  }

  const renderedOutput = outputLines.join('\n');

  const toolError = result.timedOut
    ? { error: { code: 'timeout', message: 'Command timed out' } }
    : result.exitCode !== 0 && result.exitCode !== null
      ? { error: { code: 'non_zero_exit', message: `Exit code: ${result.exitCode}` } }
      : {};

  await emitToolResultEvent({
    ...(eventStore ? { eventStore } : {}),
    sessionHub,
    sessionId,
    turnId,
    responseId,
    toolCallId,
    toolName: BANG_SHELL_TOOL_NAME,
    result: {
      output: renderedOutput,
      exitCode: result.exitCode,
      truncated: result.truncated,
      timedOut: result.timedOut,
    },
    ...toolError,
  });

  // 5. Close the turn — write Pi request boundary for turn deletion support
  if (piSessionWriter) {
    await piSessionWriter.appendTurnEnd({
      summary: currentSummary,
      turnId,
      status: 'completed',
      updateAttributes: (patch) => sessionHub.updateSessionAttributes(sessionId, patch),
    });
  }

  const turnEndEvents: ChatEvent[] = [
    {
      ...createChatEventBase({ sessionId, turnId, responseId }),
      type: 'turn_end',
      payload: {},
    },
  ];
  await appendAndBroadcastChatEvents(
    { ...(eventStore ? { eventStore } : {}), sessionHub, sessionId },
    turnEndEvents,
  );
}
