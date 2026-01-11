import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { registerCliProcess } from './cliProcessRegistry';
import { buildCliEnv } from './cliEnv';
import type { CliWrapperConfig } from '../agents';

type ClaudeCliStreamEvent = Record<string, unknown>;

export interface ClaudeCliChatConfig {
  workdir?: string;
  extraArgs?: string[];
  wrapper?: CliWrapperConfig;
}

export interface ClaudeCliToolCallbacks {
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

export interface ClaudeCliSpawn {
  (
    command: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ): ChildProcessWithoutNullStreams;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function extractTextDelta(event: ClaudeCliStreamEvent): string | undefined {
  const eventField = event['event'];
  if (eventField && typeof eventField === 'object') {
    const nested = extractTextDelta(eventField as ClaudeCliStreamEvent);
    if (nested) {
      return nested;
    }
  }

  // Common Claude Code stream-json shape:
  // { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "..." } } }
  // or { type: "content_block_delta", delta: { type: "text_delta", text: "..." } }
  const type = event['type'];
  if (type === 'stream_event' || type === 'content_block_delta') {
    const maybeEvent = type === 'stream_event' ? event['event'] : event;
    if (maybeEvent && typeof maybeEvent === 'object') {
      const innerType = (maybeEvent as Record<string, unknown>)['type'];
      if (innerType === 'content_block_delta') {
        const innerDelta = (maybeEvent as Record<string, unknown>)['delta'];
        if (innerDelta && typeof innerDelta === 'object') {
          const deltaType = (innerDelta as Record<string, unknown>)['type'];
          const deltaText = (innerDelta as Record<string, unknown>)['text'];
          if (deltaType === 'text_delta' && isNonEmptyString(deltaText)) {
            return deltaText;
          }
        }
      }
    }
  }

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

  const deltaText = event['deltaText'];
  if (isNonEmptyString(deltaText)) {
    return deltaText;
  }

  return undefined;
}

function extractFullText(event: ClaudeCliStreamEvent): string | undefined {
  const completion = event['completion'];
  if (isNonEmptyString(completion)) {
    return completion;
  }

  const text = event['text'];
  if (isNonEmptyString(text)) {
    return text;
  }

  const message = event['message'];
  if (message && typeof message === 'object') {
    const content = (message as Record<string, unknown>)['content'];
    if (isNonEmptyString(content)) {
      return content;
    }
    if (Array.isArray(content)) {
      const chunks: string[] = [];
      for (const block of content) {
        if (block && typeof block === 'object') {
          const blockType = (block as Record<string, unknown>)['type'];
          const blockText = (block as Record<string, unknown>)['text'];
          if (blockType === 'text' && isNonEmptyString(blockText)) {
            chunks.push(blockText);
          }
        }
      }
      if (chunks.length > 0) {
        return chunks.join('');
      }
    }
  }

  return undefined;
}

function summarizeText(value: string, maxLen = 120): string {
  if (value.length <= maxLen) {
    return value;
  }
  const headLen = Math.floor(maxLen / 2);
  const tailLen = maxLen - headLen;
  return `${value.slice(0, headLen)}…${value.slice(-tailLen)}`;
}

export async function runClaudeCliChat(options: {
  sessionId: string;
  resumeSession: boolean;
  userText: string;
  config?: ClaudeCliChatConfig;
  abortSignal: AbortSignal;
  onTextDelta: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingStart?: () => void | Promise<void>;
  onThinkingDelta?: (delta: string, fullTextSoFar: string) => void | Promise<void>;
  onThinkingDone?: (text: string) => void | Promise<void>;
  onToolCallStart?: ClaudeCliToolCallbacks['onToolCallStart'];
  onToolResult?: ClaudeCliToolCallbacks['onToolResult'];
  log: (...args: unknown[]) => void;
  spawnFn?: ClaudeCliSpawn;
}): Promise<{ text: string; aborted: boolean }> {
  const {
    sessionId,
    resumeSession,
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

  log('runClaudeCliChat start', {
    sessionId,
    resumeSession,
    hasExtraArgs: (config?.extraArgs?.length ?? 0) > 0,
  });

  const args: string[] = [
    '-p',
    '--verbose',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
  ];

  if (config?.extraArgs?.length) {
    args.push(...config.extraArgs);
  }

  if (resumeSession) {
    args.push('--resume', sessionId);
  } else {
    args.push('--session-id', sessionId);
  }

  args.push(userText);

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
    // On POSIX, run Claude in its own process group so we can
    // reliably terminate any subprocesses it spawns on cancel.
    spawnOptions.detached = true;
  }

  const spawnCmd = wrapperEnabled && wrapperPath ? wrapperPath : 'claude';
  const spawnArgs = wrapperEnabled ? ['claude', ...args] : args;
  log('claude spawn', {
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
      child = spawnFn('claude', args, spawnOptions);
    }
    child.stdin.end();
    registerCliProcess(child, 'claude');
  } catch (err) {
    throw new Error(`Failed to spawn claude: ${String(err)}`);
  }

  let aborted = false;
  let fullText = '';
  let fullTextFromEvents = '';
  let claudeTextOnly = ''; // Track just Claude's text (without our injected blocks) for event comparison
  const toolUseNameById = new Map<string, string>();
  const toolCallIdByToolUseId = new Map<string, string>();
  const emittedToolCallIds = new Set<string>(); // Track tool calls we've already emitted to avoid duplicates
  const emittedToolResultIds = new Set<string>(); // Track tool results we've already emitted
  // Track active tool calls (started but not yet completed) so we can send interrupted results on abort
  const activeToolCalls = new Map<string, { callId: string; toolName: string }>();
  // Track pending tool calls with streaming input (input_json_delta)
  const pendingToolCalls = new Map<
    number,
    { toolUseId?: string | undefined; name?: string | undefined; inputJson: string }
  >();
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
        log('claude process group SIGTERM failed', { pid, error: String(err) });
      }
    }

    try {
      child.kill('SIGTERM');
    } catch (err) {
      log('claude child SIGTERM failed', err);
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
    log('claude aborted, sending interrupted results for active tool calls', {
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
    if (!onThinkingStart) {
      return;
    }
    try {
      await onThinkingStart();
    } catch (err) {
      log('claude onThinkingStart error', err);
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
      log('claude onThinkingDelta error', err);
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
      log('claude onThinkingDone error', err);
    }
  };

  const finalizeThinking = async (): Promise<void> => {
    if (!thinkingStarted || thinkingDone) {
      return;
    }
    await emitThinkingDone(thinkingAccumulated);
  };

  const getOrCreateToolCallId = (toolUseId: string | undefined): string => {
    if (toolUseId && toolUseId.trim().length > 0) {
      const existing = toolCallIdByToolUseId.get(toolUseId);
      if (existing) {
        return existing;
      }
      const callId = randomUUID();
      toolCallIdByToolUseId.set(toolUseId, callId);
      return callId;
    }
    return randomUUID();
  };

  const emitToolCallStart = async (options: {
    toolUseId?: string;
    name?: string;
    input: unknown;
  }): Promise<void> => {
    if (!onToolCallStart) {
      return;
    }

    const name = options.name?.trim() || 'tool';
    const callId = getOrCreateToolCallId(options.toolUseId);
    log('claude emitToolCallStart', { callId, name, toolUseId: options.toolUseId });
    if (emittedToolCallIds.has(callId)) {
      log('claude emitToolCallStart SKIPPED (already emitted)', { callId });
      return;
    }
    emittedToolCallIds.add(callId);

    if (options.toolUseId) {
      toolUseNameById.set(options.toolUseId, name);
    }

    // Track active tool call
    activeToolCalls.set(callId, { callId, toolName: name });

    let args: Record<string, unknown>;
    if (options.input && typeof options.input === 'object') {
      args = options.input as Record<string, unknown>;
    } else {
      args = {};
    }

    try {
      await onToolCallStart(callId, name, args);
    } catch (err) {
      log('claude onToolCallStart error', err);
    }
  };

  const emitToolResult = async (options: {
    toolUseId?: string;
    name?: string;
    resultPayload: unknown;
  }): Promise<void> => {
    if (!onToolResult) {
      return;
    }

    const callId = getOrCreateToolCallId(options.toolUseId);
    log('claude emitToolResult', { callId, toolUseId: options.toolUseId });
    if (emittedToolResultIds.has(callId)) {
      log('claude emitToolResult SKIPPED (already emitted)', { callId });
      return;
    }
    emittedToolResultIds.add(callId);

    let toolName: string | undefined = options.name;
    if ((!toolName || !toolName.trim()) && options.toolUseId) {
      toolName = toolUseNameById.get(options.toolUseId);
    }
    const finalToolName = toolName?.trim() || 'tool';

    const resultPayload = options.resultPayload;
    let ok = true;
    if (resultPayload && typeof resultPayload === 'object' && 'ok' in resultPayload) {
      ok = (resultPayload as { ok?: unknown }).ok === true;
    }

    // Tool call completed, remove from active tracking
    activeToolCalls.delete(callId);

    try {
      await onToolResult(callId, finalToolName, ok, resultPayload);
    } catch (err) {
      log('claude onToolResult error', err);
    }
  };

  const processLine = async (line: string): Promise<void> => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let event: ClaudeCliStreamEvent;
    try {
      event = JSON.parse(trimmed) as ClaudeCliStreamEvent;
    } catch (_err) {
      throw new Error(`Unexpected claude output (non-JSON): ${trimmed}`);
    }

    const coreEvent =
      event &&
      typeof event === 'object' &&
      (event as { type?: unknown }).type === 'stream_event' &&
      (event as { event?: unknown }).event &&
      typeof (event as { event?: unknown }).event === 'object'
        ? ((event as { event: ClaudeCliStreamEvent }).event as ClaudeCliStreamEvent)
        : event;

    const coreType = (coreEvent as { type?: unknown }).type;

    // Handle full assistant message format: {"type":"assistant","message":{"content":[{"type":"tool_use",...}]}}
    if (coreType === 'assistant') {
      const message = (coreEvent as { message?: unknown }).message;
      if (message && typeof message === 'object') {
        const content = (message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            const blockType = (block as { type?: unknown }).type;
            if (blockType === 'tool_use') {
              const nameRaw = (block as { name?: unknown }).name;
              const idRaw = (block as { id?: unknown }).id;
              const name = typeof nameRaw === 'string' ? nameRaw.trim() : undefined;
              const id =
                typeof idRaw === 'string' && idRaw.trim().length > 0 ? idRaw.trim() : undefined;
              const input = (block as { input?: unknown }).input;
              const emitOptions: { toolUseId?: string; name?: string; input: unknown } = {
                input,
              };
              if (name) {
                emitOptions.name = name;
              }
              if (id) {
                emitOptions.toolUseId = id;
              }
              await emitToolCallStart(emitOptions);
            }
          }
        }
      }
      return;
    }

    // Handle user message with tool results: {"type":"user","message":{"content":[{"type":"tool_result",...}]}}
    if (coreType === 'user') {
      const message = (coreEvent as { message?: unknown }).message;
      if (message && typeof message === 'object') {
        const content = (message as { content?: unknown }).content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (!block || typeof block !== 'object') continue;
            const blockType = (block as { type?: unknown }).type;
            if (blockType === 'tool_result') {
              const toolUseIdRaw = (block as { tool_use_id?: unknown }).tool_use_id;
              const toolUseId =
                typeof toolUseIdRaw === 'string' && toolUseIdRaw.trim().length > 0
                  ? toolUseIdRaw.trim()
                  : undefined;
              const resultPayload =
                (block as { content?: unknown }).content ?? (block as { result?: unknown }).result;
              const emitOptions: { toolUseId?: string; resultPayload: unknown } = {
                resultPayload,
              };
              if (toolUseId) {
                emitOptions.toolUseId = toolUseId;
              }
              await emitToolResult(emitOptions);
            }
          }
        }
      }
      return;
    }

    if (coreType === 'content_block_start') {
      const indexRaw = (coreEvent as { index?: unknown }).index;
      const index = typeof indexRaw === 'number' ? indexRaw : -1;
      const contentBlock = (coreEvent as { [key: string]: unknown })['content_block'];
      if (contentBlock && typeof contentBlock === 'object') {
        const block = contentBlock as { [key: string]: unknown };
        const blockTypeRaw = block['type'];
        const blockType = typeof blockTypeRaw === 'string' ? blockTypeRaw : undefined;

        if (blockType === 'tool_use' || blockType === 'server_tool_use') {
          const nameRaw = block['name'];
          const idRaw = block['id'];
          const name = typeof nameRaw === 'string' ? nameRaw.trim() : undefined;
          const id =
            typeof idRaw === 'string' && idRaw.trim().length > 0 ? idRaw.trim() : undefined;

          // Check if input is present and non-empty.
          // In streaming mode, content_block_start has input: {}, and the actual input
          // comes via content_block_delta. In non-streaming or tests, input may be complete.
          const input = block['input'];
          const hasInput =
            input !== undefined &&
            input !== null &&
            !(typeof input === 'object' && Object.keys(input as object).length === 0);

          if (hasInput) {
            const emitOptions: { toolUseId?: string; name?: string; input: unknown } = {
              input,
            };
            if (name) {
              emitOptions.name = name;
            }
            if (id) {
              emitOptions.toolUseId = id;
            }
            await emitToolCallStart(emitOptions);
          } else if (index >= 0) {
            // Track pending tool call - input will arrive via input_json_delta
            pendingToolCalls.set(index, { toolUseId: id, name, inputJson: '' });
          }
        } else if (
          blockType === 'tool_result' ||
          (typeof blockType === 'string' && blockType.endsWith('_tool_result'))
        ) {
          // Check if content/result is present (content is real Claude, result is test format)
          const content = block['content'] ?? block['result'];
          const hasContent = content !== undefined && content !== null && content !== '';

          if (hasContent) {
            const toolUseIdRaw = block['tool_use_id'];
            const toolUseId =
              typeof toolUseIdRaw === 'string' && toolUseIdRaw.trim().length > 0
                ? toolUseIdRaw.trim()
                : undefined;
            const emitOptions: { toolUseId?: string; resultPayload: unknown } = {
              resultPayload: content,
            };
            if (toolUseId) {
              emitOptions.toolUseId = toolUseId;
            }
            await emitToolResult(emitOptions);
          }
          // If content is empty, we'll emit from the full user message later
        }
      }
    } else if (coreType === 'content_block_delta') {
      const delta = (coreEvent as { [key: string]: unknown })['delta'];
      if (delta && typeof delta === 'object') {
        const deltaObj = delta as { [key: string]: unknown };
        const deltaTypeRaw = deltaObj['type'];
        const deltaType = typeof deltaTypeRaw === 'string' ? deltaTypeRaw : undefined;
        if (deltaType === 'thinking_delta') {
          const thinkingRaw = deltaObj['thinking'];
          if (typeof thinkingRaw === 'string' && thinkingRaw.trim()) {
            await emitThinkingStart();
            await emitThinkingDelta(thinkingRaw);
          }
        } else if (deltaType === 'input_json_delta') {
          // Accumulate tool input JSON for pending tool calls
          const indexRaw = (coreEvent as { index?: unknown }).index;
          const index = typeof indexRaw === 'number' ? indexRaw : -1;
          const pending = pendingToolCalls.get(index);
          if (pending) {
            const partialJson = deltaObj['partial_json'];
            if (typeof partialJson === 'string') {
              pending.inputJson += partialJson;
            }
          }
        }
      }
    } else if (coreType === 'content_block_stop') {
      // Emit pending tool call when its content block completes
      const indexRaw = (coreEvent as { index?: unknown }).index;
      const index = typeof indexRaw === 'number' ? indexRaw : -1;
      const pending = pendingToolCalls.get(index);
      if (pending) {
        pendingToolCalls.delete(index);
        let input: Record<string, unknown> = {};
        if (pending.inputJson) {
          try {
            input = JSON.parse(pending.inputJson) as Record<string, unknown>;
          } catch {
            log('failed to parse tool input JSON', { inputJson: pending.inputJson });
          }
        }
        const emitOptions: { toolUseId?: string; name?: string; input: unknown } = { input };
        if (pending.toolUseId) {
          emitOptions.toolUseId = pending.toolUseId;
        }
        if (pending.name) {
          emitOptions.name = pending.name;
        }
        await emitToolCallStart(emitOptions);
      }
    }

    const eventKeys = Object.keys(event);

    const explicitDelta = extractTextDelta(event);
    if (explicitDelta) {
      fullText += explicitDelta;
      claudeTextOnly += explicitDelta;
      fullTextFromEvents = fullText;
      await onTextDelta(explicitDelta, fullText);
      return;
    }

    const nextFullText = extractFullText(event);
    if (nextFullText !== undefined) {
      // Compare against claudeTextOnly (Claude's text without our injected tool blocks)
      // since Claude's full text events won't include our injected content.
      if (nextFullText === claudeTextOnly) {
        return;
      }

      // Some versions of `claude --output-format stream-json` emit partial "full text so far"
      // that is not a strict prefix-append update (e.g., whitespace normalization or mid-stream
      // rewrites). Our UI protocol only supports appending deltas, so in that case we skip
      // incremental updates and rely on the final `text_done` message to render the full answer.
      if (!nextFullText.startsWith(claudeTextOnly)) {
        log('claude stream-json non-prefix update; skipping delta', {
          previousLength: claudeTextOnly.length,
          nextLength: nextFullText.length,
          previousPreview: summarizeText(claudeTextOnly),
          nextPreview: summarizeText(nextFullText),
          eventKeys: eventKeys.slice(0, 12),
        });
        claudeTextOnly = nextFullText;
        return;
      }

      const delta = nextFullText.slice(claudeTextOnly.length);
      claudeTextOnly = nextFullText;
      if (delta) {
        fullText += delta;
        fullTextFromEvents = fullText;
        log('claude onTextDelta', { deltaLength: delta.length, deltaPreview: delta.slice(0, 50) });
        await onTextDelta(delta, fullText);
      }
      return;
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
    const [{ code, signal }] = await Promise.all([exitPromise, stdoutPromise]);

    const remaining = leftover.trim();
    if (remaining) {
      await processLine(remaining);
    }

    if (aborted || abortSignal.aborted) {
      return { text: fullTextFromEvents || fullText, aborted: true };
    }

    await finalizeThinking();

    if (code !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      log('claude exited non-zero', { code, signal, stderr });
      throw new Error(
        stderr ? `Claude CLI failed: ${stderr}` : `Claude CLI exited with code ${code}`,
      );
    }

    const resultText = fullTextFromEvents || fullText;
    log('runClaudeCliChat complete', {
      sessionId,
      textLength: resultText.length,
      aborted: false,
    });
    return { text: resultText, aborted: false };
  } finally {
    abortSignal.removeEventListener('abort', abortListener);
  }
}
