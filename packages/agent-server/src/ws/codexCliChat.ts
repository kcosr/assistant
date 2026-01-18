import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerCliProcess } from './cliProcessRegistry';
import { buildCliEnv } from './cliEnv';
import type { CliWrapperConfig } from '../agents';

type JsonRpcEvent = Record<string, unknown>;
type CodexEventMessage = Record<string, unknown>;

export interface CodexCliChatConfig {
  workdir?: string;
  extraArgs?: string[];
  wrapper?: CliWrapperConfig;
}

export interface CodexCliSpawn {
  (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ): ChildProcessWithoutNullStreams;
}

export interface CodexCliToolCallbacks {
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractMsgFromEvent(event: JsonRpcEvent): CodexEventMessage | undefined {
  // Direct event format: { type: 'item.completed', item: {...} }
  if (event['type']) {
    return event as CodexEventMessage;
  }
  return undefined;
}

function extractAgentDelta(msg: CodexEventMessage): string | undefined {
  const type = msg['type'];
  if (type === 'agent_message_delta') {
    const delta = msg['delta'];
    if (isNonEmptyString(delta)) {
      return delta;
    }
  }
  return undefined;
}

function extractTextFromContentItem(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }

  const record = item as Record<string, unknown>;
  const itemType = record['type'];

  if (itemType === 'reasoning') {
    // Reasoning content is intentionally not surfaced to the user.
    return undefined;
  }

  const text = record['text'];
  if (isNonEmptyString(text)) {
    return text;
  }

  return undefined;
}

function extractAgentMessageText(msg: CodexEventMessage): string | undefined {
  const directText = msg['text'];
  if (isNonEmptyString(directText)) {
    return directText;
  }

  const message = msg['message'];
  if (message && typeof message === 'object') {
    const messageRecord = message as Record<string, unknown>;
    const messageText = messageRecord['text'];
    if (isNonEmptyString(messageText)) {
      return messageText;
    }

    const content = messageRecord['content'];
    if (Array.isArray(content)) {
      const chunks: string[] = [];
      for (const item of content) {
        const chunk = extractTextFromContentItem(item);
        if (chunk) {
          chunks.push(chunk);
        }
      }
      if (chunks.length > 0) {
        return chunks.join('');
      }
    }
  }

  const lastAgentMessage = msg['last_agent_message'];
  if (lastAgentMessage && typeof lastAgentMessage === 'object') {
    return extractAgentMessageText(lastAgentMessage as CodexEventMessage);
  }

  return undefined;
}

function formatExecCommand(event: CodexEventMessage): string | undefined {
  const command = event['command'];
  if (isNonEmptyString(command)) {
    return `\n$ ${command}\n`;
  }

  const argv = event['argv'];
  if (Array.isArray(argv)) {
    const parts: string[] = [];
    for (const arg of argv) {
      if (typeof arg === 'string' && arg.length > 0) {
        parts.push(arg);
      }
    }
    if (parts.length > 0) {
      return `\n$ ${parts.join(' ')}\n`;
    }
  }

  return undefined;
}

function decodeBase64Stdout(event: CodexEventMessage): string | undefined {
  const stdout = event['stdout'];
  if (!isNonEmptyString(stdout)) {
    return undefined;
  }

  try {
    const bytes = Buffer.from(stdout, 'base64');
    if (!bytes.length) {
      return undefined;
    }
    return bytes.toString('utf8');
  } catch {
    return undefined;
  }
}

export async function runCodexCliChat(options: {
  ourSessionId: string;
  existingCodexSessionId: string | undefined;
  userText: string;
  config?: CodexCliChatConfig;
  abortSignal: AbortSignal;
  onTextDelta: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingStart?: () => void | Promise<void>;
  onThinkingDelta?: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingDone?: (text: string) => void | Promise<void>;
  onToolCallStart?: CodexCliToolCallbacks['onToolCallStart'];
  onToolResult?: CodexCliToolCallbacks['onToolResult'];
  log: (...args: unknown[]) => void;
  spawnFn?: CodexCliSpawn;
}): Promise<{ text: string; aborted: boolean; codexSessionId?: string }> {
  const {
    ourSessionId,
    existingCodexSessionId,
    userText,
    config,
    abortSignal,
    onTextDelta,
    onThinkingStart,
    onThinkingDelta,
    onThinkingDone,
    onToolCallStart,
    onToolResult,
    log,
  } = options;
  const spawnFn = options.spawnFn ?? spawn;

  log('runCodexCliChat start', {
    ourSessionId,
    existingCodexSessionId,
    hasExtraArgs: (config?.extraArgs?.length ?? 0) > 0,
  });

  const args: string[] = ['exec'];

  if (existingCodexSessionId && existingCodexSessionId.trim().length > 0) {
    // --json must come before 'resume' subcommand
    args.push('--json');
    if (config?.extraArgs?.length) {
      args.push(...config.extraArgs);
    }
    args.push('resume', existingCodexSessionId.trim(), userText);
  } else {
    args.push('--json');
    if (config?.extraArgs?.length) {
      args.push(...config.extraArgs);
    }
    args.push(userText);
  }

  const wrapperPath = config?.wrapper?.path?.trim();
  const wrapperEnv = config?.wrapper?.env;
  const wrapperEnabled = Boolean(wrapperPath);

  const spawnEnv = buildCliEnv();
  if (wrapperEnabled && wrapperEnv) {
    for (const [key, value] of Object.entries(wrapperEnv)) {
      if (key && typeof value === 'string') {
        spawnEnv[key] = value;
      }
    }
  }
  const spawnOptions: SpawnOptionsWithoutStdio = { env: spawnEnv };
  if (config?.workdir && config.workdir.trim().length > 0) {
    spawnOptions.cwd = config.workdir.trim();
  }

  if (process.platform !== 'win32') {
    // On POSIX, run Codex in its own process group so we can
    // reliably terminate any subprocesses it spawns on cancel.
    spawnOptions.detached = true;
  }

  const spawnCmd = wrapperEnabled && wrapperPath ? wrapperPath : 'codex';
  const spawnArgs = wrapperEnabled ? ['codex', ...args] : args;
  log('codex spawn', {
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
      child = spawnFn('codex', args, spawnOptions);
    }
    if (child.stdin) {
      child.stdin.end();
    }
    registerCliProcess(child, 'codex');
  } catch (err) {
    log('codex spawn failed', { error: String(err) });
    throw new Error(`Failed to spawn codex CLI for session ${ourSessionId}: ${String(err)}`);
  }

  log('codex spawned', { pid: child.pid });

  let aborted = false;
  let fullText = '';
  let lastAgentMessageText = '';
  let codexSessionId = existingCodexSessionId;
  const toolCallIdByItemId = new Map<string, string>();
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
        log('codex process group SIGTERM failed', { pid, error: String(err) });
      }
    }

    try {
      child.kill('SIGTERM');
    } catch (err) {
      log('codex child SIGTERM failed', { error: String(err) });
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

  const emitThinkingStart = async (): Promise<void> => {
    if (thinkingStarted) {
      return;
    }
    thinkingStarted = true;
    if (!onThinkingStart) {
      return;
    }
    try {
      await onThinkingStart();
    } catch (err) {
      log('codex onThinkingStart error', { error: String(err) });
    }
  };

  const emitThinkingDelta = async (delta: string): Promise<void> => {
    if (!delta) {
      return;
    }
    thinkingAccumulated += delta;
    if (!onThinkingDelta) {
      return;
    }
    try {
      await onThinkingDelta(delta, thinkingAccumulated);
    } catch (err) {
      log('codex onThinkingDelta error', { error: String(err) });
    }
  };

  const emitThinkingDone = async (finalText: string): Promise<void> => {
    if (thinkingDone) {
      return;
    }
    thinkingDone = true;
    thinkingAccumulated = finalText;
    if (!onThinkingDone) {
      return;
    }
    try {
      await onThinkingDone(finalText);
    } catch (err) {
      log('codex onThinkingDone error', { error: String(err) });
    }
  };

  const abortListener = (): void => {
    aborted = true;
    log('codex aborted, sending interrupted results for active tool calls', {
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
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    log('codex stderr', { text: text.slice(0, 500) });
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(text));
  });

  let leftover = '';
  let lineCount = 0;

  const getOrCreateToolCallId = (rawItemId: unknown): string => {
    const itemId =
      typeof rawItemId === 'string' && rawItemId.trim().length > 0 ? rawItemId.trim() : undefined;
    if (itemId) {
      const existing = toolCallIdByItemId.get(itemId);
      if (existing) {
        return existing;
      }
      const callId = randomUUID();
      toolCallIdByItemId.set(itemId, callId);
      return callId;
    }
    return randomUUID();
  };

  const emitToolCallStart = async (options: {
    itemId?: unknown;
    toolName: string;
    args: Record<string, unknown>;
  }): Promise<void> => {
    if (!onToolCallStart) {
      return;
    }

    const callId = getOrCreateToolCallId(options.itemId);
    if (emittedToolCallIds.has(callId)) {
      return;
    }
    emittedToolCallIds.add(callId);

    // Track active tool call
    activeToolCalls.set(callId, { callId, toolName: options.toolName });

    try {
      await onToolCallStart(callId, options.toolName, options.args);
    } catch (err) {
      log('codex onToolCallStart error', { error: String(err) });
    }
  };

  const emitToolResult = async (options: {
    itemId?: unknown;
    toolName: string;
    ok: boolean;
    result: unknown;
  }): Promise<void> => {
    if (!onToolResult) {
      return;
    }

    const callId = getOrCreateToolCallId(options.itemId);
    if (emittedToolResultIds.has(callId)) {
      return;
    }
    emittedToolResultIds.add(callId);

    // Tool call completed, remove from active tracking
    activeToolCalls.delete(callId);

    try {
      await onToolResult(callId, options.toolName, options.ok, options.result);
    } catch (err) {
      log('codex onToolResult error', { error: String(err) });
    }
  };

  const processLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    lineCount++;
    if (lineCount <= 5 || lineCount % 20 === 0) {
      log('codex line', { lineCount, preview: trimmed.slice(0, 200) });
    }

    let event: JsonRpcEvent;
    try {
      event = JSON.parse(trimmed) as JsonRpcEvent;
    } catch (_err) {
      log('codex non-JSON line', { line: trimmed.slice(0, 200) });
      throw new Error(`Unexpected codex CLI output (non-JSON): ${trimmed}`);
    }

    const msg = extractMsgFromEvent(event);
    if (!msg) {
      log('codex no msg extracted', { eventKeys: Object.keys(event).slice(0, 10) });
      return;
    }

    const msgType = msg['type'];
    // Log full message for debugging
    log('codex msg', { type: msgType, msg: JSON.stringify(msg).slice(0, 500) });

    // Handle error events
    if (msgType === 'error') {
      const errorMessage = msg['message'];
      if (isNonEmptyString(errorMessage)) {
        log('codex error event', { message: errorMessage });
        const formatted = `\n\n> **Error:** ${errorMessage}\n`;
        fullText += formatted;
        await onTextDelta(formatted, fullText);
      }
      return;
    }

    if (msgType === 'turn.failed') {
      const error = msg['error'];
      if (error && typeof error === 'object') {
        const errorObj = error as Record<string, unknown>;
        const errorMessage = errorObj['message'];
        if (isNonEmptyString(errorMessage)) {
          log('codex turn.failed', { message: errorMessage });
          const formatted = `\n\n> **Error:** ${errorMessage}\n`;
          fullText += formatted;
          await onTextDelta(formatted, fullText);
        }
      }
      return;
    }

    if (msgType === 'session_configured') {
      const sessionIdValue = msg['session_id'];
      if (isNonEmptyString(sessionIdValue)) {
        codexSessionId = sessionIdValue.trim();
      }
      return;
    }

    if (msgType === 'session_meta') {
      const payload = msg['payload'];
      if (payload && typeof payload === 'object') {
        const payloadRecord = payload as Record<string, unknown>;
        const sessionIdValue = payloadRecord['id'];
        if (isNonEmptyString(sessionIdValue)) {
          codexSessionId = sessionIdValue.trim();
        }
      }
      return;
    }

    if (msgType === 'thread.started') {
      const threadId = msg['thread_id'];
      if (isNonEmptyString(threadId)) {
        codexSessionId = threadId.trim();
      }
      return;
    }

    // Handle item.started with command_execution - show the command as a tool call block
    if (msgType === 'item.started') {
      const item = msg['item'];
      if (item && typeof item === 'object') {
        const itemObj = item as Record<string, unknown>;
        if (itemObj['type'] === 'command_execution') {
          const command = itemObj['command'];
          const args: Record<string, unknown> = isNonEmptyString(command) ? { command } : {};
          log('codex command_execution started -> emitToolCallStart', {
            itemId: itemObj['id'],
            command,
          });
          await emitToolCallStart({
            itemId: itemObj['id'],
            toolName: 'shell',
            args,
          });
        }
      }
      return;
    }

    // Handle item.completed
    if (msgType === 'item.completed') {
      const item = msg['item'];
      if (item && typeof item === 'object') {
        const itemObj = item as Record<string, unknown>;
        const itemType = itemObj['type'];

        // Reasoning - show as thinking block
        if (itemType === 'reasoning') {
          const text = itemObj['text'];
          if (isNonEmptyString(text)) {
            await emitThinkingStart();
            await emitThinkingDelta(text);
            await emitThinkingDone(text);
          }
        }

        // Agent message - show the text
        if (itemType === 'agent_message') {
          const text = itemObj['text'];
          if (isNonEmptyString(text)) {
            fullText += text + '\n\n';
            log('codex agent_message -> onTextDelta', { textPreview: text.slice(0, 80) });
            await onTextDelta(text + '\n\n', fullText);
          }
        }

        // Command execution - show output as tool result
        if (itemType === 'command_execution') {
          log('codex command_execution completed -> emitToolResult', { itemId: itemObj['id'] });
          const outputRaw = itemObj['aggregated_output'];
          const exitCodeRaw = itemObj['exit_code'];
          const output = isNonEmptyString(outputRaw) ? outputRaw : '';
          const exitCode = typeof exitCodeRaw === 'number' ? exitCodeRaw : 0;
          const ok = exitCode === 0;
          const result: { output: string; exitCode: number } = {
            output,
            exitCode,
          };
          await emitToolResult({
            itemId: itemObj['id'],
            toolName: 'shell',
            ok,
            result,
          });
        }

        // File change - show as tool call/result
        if (itemType === 'file_change') {
          const changes = itemObj['changes'];
          if (Array.isArray(changes) && changes.length > 0) {
            const args: Record<string, unknown> = {
              changes,
            };
            await emitToolCallStart({
              itemId: itemObj['id'],
              toolName: 'file',
              args,
            });

            const lines: string[] = [];
            for (const change of changes) {
              if (!change || typeof change !== 'object') {
                continue;
              }
              const changeObj = change as Record<string, unknown>;
              const path = changeObj['path'];
              const kind = changeObj['kind'];
              if (isNonEmptyString(path)) {
                const kindLabel = isNonEmptyString(kind) ? kind : String(kind || 'change');
                lines.push(`${kindLabel}: ${path}`);
              }
            }
            const resultText = lines.join('\n');
            await emitToolResult({
              itemId: itemObj['id'],
              toolName: 'file',
              ok: true,
              result: resultText,
            });
          }
        }
      }
      return;
    }

    if (msgType === 'function_call') {
      const nameValue = msg['name'];
      const callIdValue = msg['call_id'];
      log('codex function_call', {
        name: isNonEmptyString(nameValue) ? nameValue : undefined,
        callId: isNonEmptyString(callIdValue) ? callIdValue : undefined,
      });
      return;
    }

    if (msgType === 'exec_command_begin') {
      const commandText = formatExecCommand(msg);
      if (commandText) {
        fullText += commandText;
        await onTextDelta(commandText, fullText);
      }
      return;
    }

    if (msgType === 'exec_command_output_delta') {
      const decoded = decodeBase64Stdout(msg);
      if (decoded && decoded.length > 0) {
        fullText += decoded;
        await onTextDelta(decoded, fullText);
      }
      return;
    }

    if (msgType === 'exec_command_end') {
      const exitCodeValue = msg['exit_code'];
      if (typeof exitCodeValue === 'number') {
        const suffix = `\n[process exited with code ${exitCodeValue}]\n`;
        fullText += suffix;
        await onTextDelta(suffix, fullText);
      }
      return;
    }

    const deltaText = extractAgentDelta(msg);
    if (deltaText !== undefined && deltaText.length > 0) {
      fullText += deltaText;
      await onTextDelta(deltaText, fullText);
      return;
    }

    const agentMessageText = extractAgentMessageText(msg);
    if (agentMessageText !== undefined) {
      lastAgentMessageText = agentMessageText;
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
    log('codex waiting for exit');
    const [{ code, signal }] = await Promise.all([exitPromise, stdoutPromise]);
    log('codex exited', { code, signal, lineCount, fullTextLength: fullText.length });

    const remaining = leftover.trim();
    if (remaining) {
      log('codex processing remaining', { length: remaining.length });
      await processLine(remaining);
    }

    if (aborted || abortSignal.aborted) {
      log('codex aborted', { fullTextLength: fullText.length });
      if (codexSessionId) {
        await ensureCodexSessionMetaSource(codexSessionId, log);
      }
      return {
        text: lastAgentMessageText || fullText,
        aborted: true,
        ...(codexSessionId ? { codexSessionId } : {}),
      };
    }

    if (code !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      log('codex CLI exited non-zero', { code, signal, stderr });
      throw new Error(
        stderr ? `Codex CLI failed: ${stderr}` : `Codex CLI exited with code ${code}`,
      );
    }

    const finalText = fullText || lastAgentMessageText;
    log('codex success', { finalTextLength: finalText.length, codexSessionId });
    if (codexSessionId) {
      await ensureCodexSessionMetaSource(codexSessionId, log);
    }
    return {
      text: finalText,
      aborted: false,
      ...(codexSessionId ? { codexSessionId } : {}),
    };
  } finally {
    abortSignal.removeEventListener('abort', abortListener);
  }
}

async function ensureCodexSessionMetaSource(
  codexSessionId: string,
  log: (message: string, data?: Record<string, unknown>) => void,
): Promise<void> {
  const baseDir = resolveCodexSessionsDir();
  const sessionPath = await findCodexSessionFile(baseDir, codexSessionId, log);
  if (!sessionPath) {
    return;
  }

  let content: string;
  try {
    content = await fs.readFile(sessionPath, 'utf8');
  } catch (err) {
    log('codex session meta read failed', {
      sessionId: codexSessionId,
      path: sessionPath,
      error: String(err),
    });
    return;
  }

  const newlineIndex = content.indexOf('\n');
  if (newlineIndex <= 0) {
    return;
  }

  const hasCarriageReturn = content[newlineIndex - 1] === '\r';
  const lineEnding = hasCarriageReturn ? '\r\n' : '\n';
  const lineEndIndex = hasCarriageReturn ? newlineIndex - 1 : newlineIndex;
  const firstLine = content.slice(0, lineEndIndex).trim();
  if (!firstLine) {
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(firstLine) as Record<string, unknown>;
  } catch (err) {
    log('codex session meta parse failed', {
      sessionId: codexSessionId,
      path: sessionPath,
      error: String(err),
    });
    return;
  }

  if (parsed['type'] !== 'session_meta') {
    return;
  }

  const payload = parsed['payload'];
  if (!payload || typeof payload !== 'object') {
    return;
  }

  const payloadRecord = payload as Record<string, unknown>;
  const rawSource = payloadRecord['source'];
  const existingSource = isNonEmptyString(rawSource) ? rawSource.trim() : '';
  if (existingSource && existingSource !== 'exec' && existingSource !== 'unknown') {
    return;
  }

  payloadRecord['source'] = 'cli';
  parsed['payload'] = payloadRecord;
  const updatedFirstLine = JSON.stringify(parsed);
  if (updatedFirstLine === firstLine) {
    return;
  }

  const rest = content.slice(newlineIndex + 1);
  try {
    await fs.writeFile(sessionPath, `${updatedFirstLine}${lineEnding}${rest}`, 'utf8');
  } catch (err) {
    log('codex session meta write failed', {
      sessionId: codexSessionId,
      path: sessionPath,
      error: String(err),
    });
    return;
  }

  log('codex session meta source updated', {
    sessionId: codexSessionId,
    path: sessionPath,
    source: 'cli',
  });
}

function resolveCodexSessionsDir(): string {
  const codexHome = process.env['CODEX_HOME'];
  if (isNonEmptyString(codexHome)) {
    return path.join(codexHome.trim(), 'sessions');
  }
  return path.join(os.homedir(), '.codex', 'sessions');
}

async function findCodexSessionFile(
  baseDir: string,
  sessionId: string,
  log: (message: string, data?: Record<string, unknown>) => void,
): Promise<string | null> {
  const suffix = `${sessionId}.jsonl`;
  const queue = [baseDir];
  let bestPath: string | null = null;
  let bestMtime = -1;

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        log('codex sessions dir read failed', { path: current, error: error.message });
      }
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(suffix)) {
        continue;
      }
      try {
        const stat = await fs.stat(entryPath);
        if (!stat.isFile()) {
          continue;
        }
        if (stat.mtimeMs >= bestMtime) {
          bestMtime = stat.mtimeMs;
          bestPath = entryPath;
        }
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== 'ENOENT') {
          log('codex session file stat failed', { path: entryPath, error: error.message });
        }
      }
    }
  }

  return bestPath;
}
