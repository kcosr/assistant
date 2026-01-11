import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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

export async function runPiCliChat(options: {
  sessionId: string;
  resumeSession: boolean;
  userText: string;
  config?: PiCliChatConfig;
  dataDir: string;
  abortSignal: AbortSignal;
  onTextDelta: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingStart?: () => void | Promise<void>;
  onThinkingDelta?: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingDone?: (text: string) => void | Promise<void>;
  onToolCallStart?: PiCliToolCallbacks['onToolCallStart'];
  onToolResult?: PiCliToolCallbacks['onToolResult'];
  log: (...args: unknown[]) => void;
  spawnFn?: PiCliSpawn;
}): Promise<{ text: string; aborted: boolean }> {
  const {
    sessionId,
    resumeSession,
    userText,
    config,
    dataDir,
    abortSignal,
    onTextDelta,
    onToolCallStart,
    onToolResult,
    log,
  } = options;

  const spawnFn = options.spawnFn ?? spawn;

  log('runPiCliChat start', {
    sessionId,
    resumeSession,
    hasExtraArgs: (config?.extraArgs?.length ?? 0) > 0,
  });

  const wrapperPath = config?.wrapper?.path?.trim();
  const wrapperEnv = config?.wrapper?.env;
  const wrapperEnabled = Boolean(wrapperPath);
  const resolvedWorkdir = config?.workdir?.trim();
  const workdir = resolvedWorkdir && resolvedWorkdir.length > 0 ? resolvedWorkdir : undefined;

  // When using a wrapper, use a relative path so it resolves inside the container.
  // The container's cwd should map to the workspace root on the host.
  // When not using a wrapper, use the absolute dataDir path.
  let sessionFilePath: string;
  if (wrapperEnabled) {
    const sessionRoot = workdir ?? process.cwd();
    const resolvedSessionDir = path.join(sessionRoot, '.assistant', 'pi-sessions');
    try {
      fs.mkdirSync(resolvedSessionDir, { recursive: true });
    } catch (err) {
      log('pi failed to create session directory', { dir: resolvedSessionDir, error: String(err) });
    }
    sessionFilePath = `.assistant/pi-sessions/${sessionId}.jsonl`;
  } else {
    const resolvedSessionDir = path.join(dataDir, 'pi-sessions');
    try {
      fs.mkdirSync(resolvedSessionDir, { recursive: true });
    } catch (err) {
      log('pi failed to create session directory', { dir: resolvedSessionDir, error: String(err) });
    }
    sessionFilePath = path.join(resolvedSessionDir, `${sessionId}.jsonl`);
  }

  const args: string[] = ['--mode', 'json', '--session', sessionFilePath];

  if (resumeSession) {
    args.push('--continue');
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
  const emittedToolCallIds = new Set<string>();
  const emittedToolResultIds = new Set<string>();
  // Track active tool calls (started but not yet completed) so we can send interrupted results on abort
  const activeToolCalls = new Map<string, { callId: string; toolName: string }>();
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

    if (type === 'tool_execution_start' && onToolCallStart) {
      const toolCallIdRaw = event['toolCallId'];
      const toolNameRaw = event['toolName'];
      const callId =
        typeof toolCallIdRaw === 'string' && toolCallIdRaw.trim().length > 0
          ? toolCallIdRaw.trim()
          : '';
      const toolName =
        typeof toolNameRaw === 'string' && toolNameRaw.trim().length > 0 ? toolNameRaw.trim() : '';

      if (callId && toolName && !emittedToolCallIds.has(callId)) {
        emittedToolCallIds.add(callId);

        // Track active tool call
        activeToolCalls.set(callId, { callId, toolName });

        const argsField = event['args'];
        const args =
          argsField && typeof argsField === 'object' ? (argsField as Record<string, unknown>) : {};

        try {
          await onToolCallStart(callId, toolName, args);
        } catch (err) {
          log('pi onToolCallStart error', err);
        }
      }

      return;
    }

    if (type === 'tool_execution_end' && onToolResult) {
      const toolCallIdRaw = event['toolCallId'];
      const toolNameRaw = event['toolName'];
      const callId =
        typeof toolCallIdRaw === 'string' && toolCallIdRaw.trim().length > 0
          ? toolCallIdRaw.trim()
          : '';
      const toolName =
        typeof toolNameRaw === 'string' && toolNameRaw.trim().length > 0 ? toolNameRaw.trim() : '';

      if (callId && toolName && !emittedToolResultIds.has(callId)) {
        emittedToolResultIds.add(callId);

        // Tool call completed, remove from active tracking
        activeToolCalls.delete(callId);

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
    return { text: fullText, aborted: false };
  } finally {
    abortSignal.removeEventListener('abort', abortListener);
  }
}
