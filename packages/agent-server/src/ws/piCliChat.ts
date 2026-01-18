import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { registerCliProcess } from './cliProcessRegistry';
import { buildCliEnv } from './cliEnv';
import type { CliWrapperConfig } from '../agents';

type PiCliEvent = Record<string, unknown>;

export interface PiCliChatConfig {
  /**
   * Optional working directory for the Pi CLI process.
   */
  workdir?: string;
  /**
   * Extra CLI args for the Pi CLI process.
   */
  extraArgs?: string[];
  /**
   * Optional wrapper configuration for running the CLI in a container.
   */
  wrapper?: CliWrapperConfig;
}

export interface PiSessionInfo {
  sessionId: string;
  cwd?: string;
}

export interface PiCliToolCallbacks {
  onToolCallStart?: (
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => void | Promise<void>;
  onToolResult?: (
    callId: string,
    toolName: string,
    ok: boolean,
    result: unknown,
  ) => void | Promise<void>;
  onToolOutputChunk?: (
    callId: string,
    toolName: string,
    chunk: string,
    offset: number,
    stream?: 'stdout' | 'stderr' | 'output',
  ) => void | Promise<void>;
}

export interface PiCliSpawn {
  (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ): ChildProcessWithoutNullStreams;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractTextDelta(event: PiCliEvent): string | undefined {
  const type = event['type'];

  // Primary Pi CLI streaming shape:
  // { "type": "message_update",
  //   "assistantMessageEvent": { "type": "text_delta", "delta": "Hello", "contentIndex": 0 } }
  if (type === 'message_update') {
    const assistantMessageEvent = event['assistantMessageEvent'];
    if (assistantMessageEvent && typeof assistantMessageEvent === 'object') {
      const inner = assistantMessageEvent as Record<string, unknown>;
      const innerType = inner['type'];
      if (innerType === 'text_delta') {
        const delta = inner['delta'];
        if (isNonEmptyString(delta)) {
          return delta;
        }
      }
    }
  }

  // Fallbacks for any alternative shapes that might surface text directly.
  const delta = event['delta'];
  if (isNonEmptyString(delta)) {
    return delta;
  }

  if (delta && typeof delta === 'object') {
    const deltaText = (delta as Record<string, unknown>)['text'];
    if (isNonEmptyString(deltaText)) {
      return deltaText;
    }
  }

  return undefined;
}

function extractToolResultText(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const content = (result as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') {
      continue;
    }
    const blockObj = block as Record<string, unknown>;
    const blockType = blockObj['type'];
    const blockText = blockObj['text'];
    if (blockType === 'text' && isNonEmptyString(blockText)) {
      chunks.push(blockText);
    }
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return chunks.join('');
}

function extractToolOutputText(result: unknown): string | undefined {
  if (isNonEmptyString(result)) {
    return result;
  }

  return extractToolResultText(result);
}

function extractToolOutputStream(result: unknown): 'stdout' | 'stderr' | 'output' | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }
  const details = (result as Record<string, unknown>)['details'];
  if (!details || typeof details !== 'object') {
    return undefined;
  }
  const stream = (details as Record<string, unknown>)['stream'];
  if (stream === 'stdout' || stream === 'stderr' || stream === 'output') {
    return stream;
  }
  return undefined;
}

function computeToolOutputDelta(previousText: string, nextText: string): string {
  if (!nextText) {
    return '';
  }
  if (!previousText) {
    return nextText;
  }
  if (nextText.startsWith(previousText)) {
    return nextText.slice(previousText.length);
  }

  const maxOverlap = Math.min(previousText.length, nextText.length, 8192);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (previousText.slice(-overlap) === nextText.slice(0, overlap)) {
      return nextText.slice(overlap);
    }
  }

  return nextText;
}

function extractSessionInfo(event: PiCliEvent): PiSessionInfo | null {
  const type = event['type'];
  if (type !== 'session' && type !== 'session_header') {
    return null;
  }
  const id = event['id'];
  if (!isNonEmptyString(id)) {
    return null;
  }
  const cwd = event['cwd'];
  return {
    sessionId: id.trim(),
    ...(isNonEmptyString(cwd) ? { cwd: cwd.trim() } : {}),
  };
}

export async function runPiCliChat(options: {
  sessionId: string;
  piSessionId?: string;
  userText: string;
  config?: PiCliChatConfig;
  abortSignal: AbortSignal;
  onTextDelta: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingStart?: () => void | Promise<void>;
  onThinkingDelta?: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingDone?: (text: string) => void | Promise<void>;
  onToolCallStart?: PiCliToolCallbacks['onToolCallStart'];
  onToolResult?: PiCliToolCallbacks['onToolResult'];
  onToolOutputChunk?: PiCliToolCallbacks['onToolOutputChunk'];
  onSessionInfo?: (info: PiSessionInfo) => void | Promise<void>;
  log: (...args: unknown[]) => void;
  spawnFn?: PiCliSpawn;
}): Promise<{ text: string; aborted: boolean; sessionInfo?: PiSessionInfo }> {
  const {
    sessionId,
    piSessionId,
    userText,
    config,
    abortSignal,
    onTextDelta,
    onToolCallStart,
    onToolResult,
    onToolOutputChunk,
    onSessionInfo,
    log,
  } = options;

  const spawnFn = options.spawnFn ?? spawn;

  log('runPiCliChat start', {
    sessionId,
    piSessionId,
    hasExtraArgs: (config?.extraArgs?.length ?? 0) > 0,
  });

  const wrapperPath = config?.wrapper?.path?.trim();
  const wrapperEnv = config?.wrapper?.env;
  const wrapperEnabled = Boolean(wrapperPath);
  const resolvedWorkdir = config?.workdir?.trim();
  const workdir = resolvedWorkdir && resolvedWorkdir.length > 0 ? resolvedWorkdir : undefined;

  const args: string[] = ['--mode', 'json'];
  if (piSessionId) {
    args.push('--session', piSessionId);
  }

  if (config?.extraArgs?.length) {
    args.push(...config.extraArgs);
  }

  // -p (print/non-interactive mode) must come right before the message
  args.push('-p', userText);

  const spawnEnv = buildCliEnv();
  if (wrapperEnabled && wrapperEnv) {
    for (const [key, value] of Object.entries(wrapperEnv)) {
      if (key && typeof value === 'string') {
        spawnEnv[key] = value;
      }
    }
  }
  const spawnOptions: SpawnOptionsWithoutStdio = { env: spawnEnv };
  if (workdir) {
    spawnOptions.cwd = workdir;
  }

  if (process.platform !== 'win32') {
    // On POSIX, run Pi in its own process group so we can
    // reliably terminate any subprocesses it spawns on cancel.
    spawnOptions.detached = true;
  }

  const spawnCmd = wrapperEnabled && wrapperPath ? wrapperPath : 'pi';
  const spawnArgs = wrapperEnabled ? ['pi', ...args] : args;
  log('pi spawn', {
    command: spawnCmd,
    args: spawnArgs,
    wrapper: wrapperPath ?? 'none',
    persistent: spawnEnv['PERSISTENT'] ?? 'no',
    containerName: spawnEnv['CONTAINER_NAME'] ?? 'none',
  });

  let child: ChildProcessWithoutNullStreams;
  try {
    if (wrapperEnabled && wrapperPath) {
      child = spawnFn(wrapperPath, spawnArgs, spawnOptions);
    } else {
      child = spawnFn('pi', args, spawnOptions);
    }
    if (child.stdin) {
      child.stdin.end();
    }
    registerCliProcess(child, 'pi');
  } catch (err) {
    log('pi spawn failed', { error: String(err) });
    throw new Error(`Failed to spawn Pi CLI for session ${sessionId}: ${String(err)}`);
  }

  let aborted = false;
  let fullText = '';
  let sessionInfo: PiSessionInfo | undefined;
  const emittedToolCallIds = new Set<string>();
  const emittedToolResultIds = new Set<string>();
  // Track active tool calls (started but not yet completed) so we can send interrupted results on abort
  const activeToolCalls = new Map<string, { callId: string; toolName: string }>();
  const toolOutputStates = new Map<string, { text: string; offset: number }>();
  const stderrChunks: Buffer[] = [];

  let thinkingAccumulated = '';
  let thinkingStarted = false;
  let thinkingDone = false;

  let terminateRequested = false;
  const terminateChildProcessTree = (): void => {
    if (terminateRequested) {
      return;
    }
    terminateRequested = true;

    const pid = child.pid;
    const isPosix = process.platform !== 'win32';

    if (isPosix && typeof pid === 'number' && pid > 0) {
      try {
        // Kill the entire process group so any tool subprocesses are also terminated.
        process.kill(-pid, 'SIGTERM');
      } catch (err) {
        log('pi process group SIGTERM failed', { pid, error: String(err) });
      }
    }

    try {
      child.kill('SIGTERM');
    } catch (err) {
      log('pi child SIGTERM failed', err);
    }

    setTimeout(() => {
      if (isPosix && typeof pid === 'number' && pid > 0) {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }

      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 2000).unref();
  };

  const abortListener = (): void => {
    aborted = true;
    log('pi aborted, sending interrupted results for active tool calls', {
      activeToolCallCount: activeToolCalls.size,
    });
    // Send interrupted results for any active tool calls
    for (const [callId, call] of activeToolCalls) {
      if (onToolResult) {
        void onToolResult(callId, call.toolName, false, {
          error: {
            code: 'tool_interrupted',
            message: 'Tool call was interrupted by the user',
          },
        });
      }
    }
    activeToolCalls.clear();
    toolOutputStates.clear();
    terminateChildProcessTree();
  };

  abortSignal.addEventListener('abort', abortListener, { once: true });

  child.stderr.on('data', (chunk) => {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  });

  let leftover = '';

  const emitThinkingStart = async (): Promise<void> => {
    if (thinkingStarted) {
      return;
    }
    thinkingStarted = true;
    if (!options.onThinkingStart) {
      return;
    }
    try {
      await options.onThinkingStart();
    } catch (err) {
      log('pi onThinkingStart error', err);
    }
  };

  const emitThinkingDelta = async (delta: string): Promise<void> => {
    if (!delta) {
      return;
    }
    thinkingAccumulated += delta;
    if (!options.onThinkingDelta) {
      return;
    }
    try {
      await options.onThinkingDelta(delta, thinkingAccumulated);
    } catch (err) {
      log('pi onThinkingDelta error', err);
    }
  };

  const emitThinkingDone = async (finalText: string): Promise<void> => {
    if (thinkingDone) {
      return;
    }
    thinkingDone = true;
    thinkingAccumulated = finalText;
    if (!options.onThinkingDone) {
      return;
    }
    try {
      await options.onThinkingDone(finalText);
    } catch (err) {
      log('pi onThinkingDone error', err);
    }
  };

  const recordSessionInfo = async (info: PiSessionInfo): Promise<void> => {
    if (
      sessionInfo &&
      sessionInfo.sessionId === info.sessionId &&
      sessionInfo.cwd === info.cwd
    ) {
      return;
    }
    sessionInfo = info;
    if (!onSessionInfo) {
      return;
    }
    try {
      await onSessionInfo(info);
    } catch (err) {
      log('pi onSessionInfo error', err);
    }
  };

  const normalizeToolCallMeta = (
    event: PiCliEvent,
  ): { callId: string; toolName: string; args: Record<string, unknown> } | null => {
    const toolCallIdRaw = event['toolCallId'];
    const toolNameRaw = event['toolName'];
    const callId =
      typeof toolCallIdRaw === 'string' && toolCallIdRaw.trim().length > 0
        ? toolCallIdRaw.trim()
        : '';
    const toolName =
      typeof toolNameRaw === 'string' && toolNameRaw.trim().length > 0 ? toolNameRaw.trim() : '';

    if (!callId || !toolName) {
      return null;
    }

    const argsField = event['args'];
    const args =
      argsField && typeof argsField === 'object' ? (argsField as Record<string, unknown>) : {};

    return { callId, toolName, args };
  };

  const emitToolCallStartIfNeeded = async (
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> => {
    if (!activeToolCalls.has(callId)) {
      activeToolCalls.set(callId, { callId, toolName });
    }

    if (!onToolCallStart || emittedToolCallIds.has(callId)) {
      return;
    }

    emittedToolCallIds.add(callId);
    try {
      await onToolCallStart(callId, toolName, args);
    } catch (err) {
      log('pi onToolCallStart error', err);
    }
  };

  const emitToolOutputDelta = async (
    callId: string,
    toolName: string,
    partialResult: unknown,
  ): Promise<void> => {
    if (!onToolOutputChunk) {
      return;
    }

    const outputText = extractToolOutputText(partialResult);
    if (outputText === undefined) {
      return;
    }

    const previousState = toolOutputStates.get(callId) ?? { text: '', offset: 0 };
    const delta = computeToolOutputDelta(previousState.text, outputText);
    const nextOffset = previousState.offset + delta.length;
    toolOutputStates.set(callId, { text: outputText, offset: nextOffset });

    if (!delta) {
      return;
    }

    const stream = extractToolOutputStream(partialResult);
    try {
      await onToolOutputChunk(callId, toolName, delta, nextOffset, stream);
    } catch (err) {
      log('pi onToolOutputChunk error', err);
    }
  };

  const processLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let event: PiCliEvent;
    try {
      event = JSON.parse(trimmed) as PiCliEvent;
    } catch (_err) {
      throw new Error(`Unexpected Pi CLI output (non-JSON): ${trimmed}`);
    }

    const type = event['type'];
    const sessionInfoPayload = extractSessionInfo(event);
    if (sessionInfoPayload) {
      await recordSessionInfo(sessionInfoPayload);
      return;
    }

    if (type === 'tool_execution_start') {
      const meta = normalizeToolCallMeta(event);
      if (meta) {
        await emitToolCallStartIfNeeded(meta.callId, meta.toolName, meta.args);
      }
      return;
    }

    if (type === 'tool_execution_update') {
      const meta = normalizeToolCallMeta(event);
      if (meta) {
        await emitToolCallStartIfNeeded(meta.callId, meta.toolName, meta.args);
        await emitToolOutputDelta(meta.callId, meta.toolName, event['partialResult']);
      }
      return;
    }

    if (type === 'tool_execution_end' && onToolResult) {
      const meta = normalizeToolCallMeta(event);
      const callId = meta?.callId ?? '';
      const toolName = meta?.toolName ?? '';
      if (callId && toolName && !emittedToolResultIds.has(callId)) {
        emittedToolResultIds.add(callId);

        // Tool call completed, remove from active tracking
        activeToolCalls.delete(callId);
        toolOutputStates.delete(callId);

        const isErrorRaw = event['isError'];
        const ok = isErrorRaw === true ? false : true;

        const resultField = event['result'];
        const resultText = extractToolResultText(resultField);
        const result: unknown = resultText !== undefined ? resultText : resultField;

        try {
          await onToolResult(callId, toolName, ok, result);
        } catch (err) {
          log('pi onToolResult error', err);
        }
      }

      return;
    }

    if (type === 'message_update') {
      const assistantMessageEvent = event['assistantMessageEvent'];
      if (assistantMessageEvent && typeof assistantMessageEvent === 'object') {
        const inner = assistantMessageEvent as Record<string, unknown>;
        const innerType = inner['type'];

        if (innerType === 'thinking_start') {
          await emitThinkingStart();
          return;
        }

        if (innerType === 'thinking_delta') {
          const delta = inner['delta'];
          if (isNonEmptyString(delta)) {
            await emitThinkingStart();
            await emitThinkingDelta(delta);
          }
          return;
        }

        if (innerType === 'thinking_end') {
          const content = inner['content'];
          const text = isNonEmptyString(content) ? content : thinkingAccumulated;
          if (text) {
            await emitThinkingStart();
            await emitThinkingDone(text);
          }
          return;
        }
      }
    }

    const delta = extractTextDelta(event);
    if (delta) {
      fullText += delta;
      await onTextDelta(delta, fullText);
    }
  };

  const stdoutPromise = (async (): Promise<void> => {
    try {
      for await (const chunk of child.stdout) {
        leftover += chunk.toString('utf8');
        while (true) {
          const idx = leftover.indexOf('\n');
          if (idx === -1) {
            break;
          }
          const line = leftover.slice(0, idx);
          leftover = leftover.slice(idx + 1);
          await processLine(line);
        }
      }
    } catch (_err) {
      terminateChildProcessTree();
      throw _err;
    }
  })();

  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', (err) => reject(err));
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );

  try {
    const [{ code }] = await Promise.all([exitPromise, stdoutPromise]);

    const remaining = leftover.trim();
    if (remaining) {
      await processLine(remaining);
    }

    if (aborted || abortSignal.aborted) {
      return { text: fullText, aborted: true };
    }

    if (code !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      log('pi exited non-zero', { code, stderr });
      throw new Error(
        stderr ? `Pi CLI failed: ${stderr}` : `Pi CLI exited with code ${String(code)}`,
      );
    }

    log('runPiCliChat complete', {
      sessionId,
      textLength: fullText.length,
      aborted: false,
    });
    return { text: fullText, aborted: false, ...(sessionInfo ? { sessionInfo } : {}) };
  } finally {
    abortSignal.removeEventListener('abort', abortListener);
  }
}
