import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { ToolError } from './errors';
import type { BuiltInToolDefinition, CodexThreadsToolConfig, ToolContext } from './types';

export const CODEX_THREADS_TOOL_NAMES = {
  list: 'codex_threads_list',
  find: 'codex_threads_find',
  status: 'codex_threads_status',
  messages: 'codex_threads_messages',
  send: 'codex_threads_send',
  steer: 'codex_threads_steer',
  create: 'codex_threads_create',
  rename: 'codex_threads_rename',
} as const;

export const CODEX_THREADS_BOUNDS = {
  defaultLookbackHours: 24,
  maxLookbackHours: 720,
  defaultListLimit: 10,
  maxListLimit: 25,
  findCandidateLimit: 100,
  defaultFindLimit: 5,
  maxFindLimit: 10,
  maxFindQueryChars: 200,
  defaultMessageLimit: 6,
  maxMessageLimit: 12,
  messageTurnScan: 50,
  maxMessageChars: 64_000,
  maxTranscriptChars: 256_000,
  maxPromptChars: 8_000,
  maxFinalResponseChars: 64_000,
  maxStdoutBytes: 4_000_000,
  maxNameChars: 100,
  maxServerNameChars: 100,
  maxThreadIdChars: 128,
  maxPreviewChars: 400,
} as const;

const READ_TIMEOUT_MS = 25_000;
const MUTATION_TIMEOUT_MS = 25_000;
const TURN_WAIT_TIMEOUT_MS = 120_000;
const MAX_STDERR_BYTES = 64_000;

type RunnerResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  outputTooLarge: boolean;
};

export type CodexThreadsRunner = (options: {
  binary: string;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<RunnerResult>;

type ThreadSummary = {
  threadId: string;
  name: string | null;
  cwd: string | null;
  project: string | null;
  preview: string | null;
  status: string;
  activeFlags: string[];
  updatedAt: string | null;
};

const activeMutationKeys = new Set<string>();

function asObject(raw: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  const value = raw as Record<string, unknown>;
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ToolError('invalid_arguments', `Unknown argument: ${unknown[0]}`);
  }
  return value;
}

function requireString(
  raw: unknown,
  field: string,
  maxChars: number,
  options: { trim?: boolean } = {},
): string {
  if (typeof raw !== 'string') {
    throw new ToolError('invalid_arguments', `${field} is required and must be a string`);
  }
  const value = options.trim === false ? raw : raw.trim();
  if (!value.trim()) {
    throw new ToolError('invalid_arguments', `${field} must not be empty`);
  }
  if (value.length > maxChars) {
    throw new ToolError('invalid_arguments', `${field} must be at most ${maxChars} characters`);
  }
  return value;
}

function optionalString(raw: unknown, field: string, maxChars: number): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return requireString(raw, field, maxChars);
}

function boundedInteger(
  raw: unknown,
  field: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) {
    return defaultValue;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    throw new ToolError('invalid_arguments', `${field} must be an integer from ${min} to ${max}`);
  }
  return raw;
}

function requireThreadId(raw: unknown): string {
  return requireString(raw, 'threadId', CODEX_THREADS_BOUNDS.maxThreadIdChars);
}

function requireServer(raw: unknown, config: CodexThreadsToolConfig): string {
  const server = requireString(raw, 'server', CODEX_THREADS_BOUNDS.maxServerNameChars);
  if (!config.allowedServers.includes(server)) {
    throw new ToolError('server_not_allowed', `Codex Threads server is not allowed: ${server}`);
  }
  return server;
}

function requireConfig(config: CodexThreadsToolConfig | undefined): CodexThreadsToolConfig {
  if (!config) {
    throw new ToolError(
      'not_configured',
      'Codex Threads is not configured on the Assistant server',
    );
  }
  return config;
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  if (maxChars <= 1) {
    return { text: value.slice(0, maxChars), truncated: true };
  }
  return { text: `${value.slice(0, maxChars - 1)}…`, truncated: true };
}

function compactText(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.replace(/\s+/g, ' ').trim();
  return normalized ? truncateText(normalized, maxChars).text : null;
}

function timestampToIso(raw: unknown): string | null {
  let millis: number;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    millis = raw < 1_000_000_000_000 ? raw * 1_000 : raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    millis = Date.parse(raw);
  } else {
    return null;
  }
  if (!Number.isFinite(millis)) {
    return null;
  }
  try {
    return new Date(millis).toISOString();
  } catch {
    return null;
  }
}

function projectThread(raw: unknown): ThreadSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const threadId = typeof value['id'] === 'string' ? value['id'].trim() : '';
  if (!threadId) {
    return null;
  }
  const cwdRaw = typeof value['cwd'] === 'string' ? value['cwd'].trim() : '';
  const cwd = cwdRaw ? truncateText(cwdRaw, 1_024).text : null;
  const statusValue = value['status'];
  const statusRecord =
    statusValue && typeof statusValue === 'object' && !Array.isArray(statusValue)
      ? (statusValue as Record<string, unknown>)
      : undefined;
  const status =
    typeof statusRecord?.['type'] === 'string'
      ? statusRecord['type']
      : typeof statusValue === 'string'
        ? statusValue
        : 'unknown';
  const activeFlags = Array.isArray(statusRecord?.['activeFlags'])
    ? statusRecord['activeFlags']
        .filter((item): item is string => typeof item === 'string')
        .slice(0, 10)
    : [];
  const rawName = typeof value['name'] === 'string' ? value['name'].trim() : '';
  return {
    threadId: truncateText(threadId, CODEX_THREADS_BOUNDS.maxThreadIdChars).text,
    name: rawName ? truncateText(rawName, CODEX_THREADS_BOUNDS.maxNameChars).text : null,
    cwd,
    project: cwd ? path.basename(cwd) || cwd : null,
    preview: compactText(value['preview'], CODEX_THREADS_BOUNDS.maxPreviewChars),
    status,
    activeFlags,
    updatedAt: timestampToIso(value['updatedAt']),
  };
}

function buildInvocationArgs(
  config: CodexThreadsToolConfig,
  server: string,
  commandArgs: string[],
): string[] {
  return [
    ...(config.permissionMode === 'app-server-default' ? ['--no-yolo'] : []),
    ...commandArgs,
    '--server',
    server,
    '--json',
  ];
}

async function defaultRunner(options: {
  binary: string;
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<RunnerResult> {
  if (options.signal?.aborted) {
    throw new ToolError('cancelled', 'Codex Threads operation was cancelled');
  }
  return await new Promise<RunnerResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let outputTooLarge = false;
    let settled = false;
    let terminating = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const child = spawn(options.binary, options.args, {
      shell: false,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const terminate = () => {
      if (terminating) {
        return;
      }
      terminating = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 2_000).unref?.();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    const onAbort = () => {
      aborted = true;
      terminate();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const appendBounded = (
      current: string,
      currentBytes: number,
      chunk: string,
      maxBytes: number,
    ): { text: string; bytes: number } => {
      const chunkBytes = Buffer.byteLength(chunk);
      if (currentBytes + chunkBytes <= maxBytes) {
        return { text: current + chunk, bytes: currentBytes + chunkBytes };
      }
      outputTooLarge = true;
      terminate();
      const remainingBytes = Math.max(0, maxBytes - currentBytes);
      return {
        text: current + Buffer.from(chunk).subarray(0, remainingBytes).toString('utf8'),
        bytes: maxBytes,
      };
    };

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      const appended = appendBounded(
        stdout,
        stdoutBytes,
        chunk,
        CODEX_THREADS_BOUNDS.maxStdoutBytes,
      );
      stdout = appended.text;
      stdoutBytes = appended.bytes;
    });
    child.stderr?.on('data', (chunk: string) => {
      const appended = appendBounded(stderr, stderrBytes, chunk, MAX_STDERR_BYTES);
      stderr = appended.text;
      stderrBytes = appended.bytes;
    });
    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new ToolError(
          'execution_failed',
          `Failed to start Codex Threads (${options.binary}): ${error.message}`,
        ),
      );
    });
    child.on('close', (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ exitCode, stdout, stderr, timedOut, aborted, outputTooLarge });
    });
  });
}

function errorDetail(stderr: string): string {
  return stderr.replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function runJson(
  config: CodexThreadsToolConfig,
  runner: CodexThreadsRunner,
  server: string,
  commandArgs: string[],
  ctx: ToolContext,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const result = await runner({
    binary: config.binary,
    args: buildInvocationArgs(config, server, commandArgs),
    timeoutMs,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  if (result.aborted || ctx.signal?.aborted) {
    throw new ToolError('cancelled', 'Codex Threads operation was cancelled');
  }
  if (result.timedOut) {
    throw new ToolError('timeout', 'Codex Threads did not respond in time');
  }
  if (result.outputTooLarge) {
    throw new ToolError('output_too_large', 'Codex Threads returned too much data');
  }
  if (result.exitCode !== 0) {
    const detail = errorDetail(result.stderr);
    throw new ToolError(
      'execution_failed',
      detail ? `Codex Threads failed: ${detail}` : 'Codex Threads operation failed',
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim());
  } catch {
    throw new ToolError('execution_failed', 'Codex Threads returned invalid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolError('execution_failed', 'Codex Threads returned an invalid result');
  }
  return parsed as Record<string, unknown>;
}

function parseJsonLines(
  stdout: string,
  options: { allowTrailingPartial?: boolean } = {},
): Record<string, unknown>[] {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const events: Record<string, unknown>[] = [];
  for (const [index, line] of lines.entries()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (options.allowTrailingPartial && index === lines.length - 1) {
        break;
      }
      throw new ToolError('execution_failed', 'Codex Threads returned invalid stream JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ToolError('execution_failed', 'Codex Threads returned an invalid stream event');
    }
    events.push(parsed as Record<string, unknown>);
  }
  return events;
}

function projectWaitedTurn(output: Record<string, unknown>, server: string) {
  const threadId = requireThreadId(output['threadId']);
  const accepted = acceptedTurn(output, threadId);
  const rawText =
    typeof output['finalAssistantText'] === 'string' ? output['finalAssistantText'] : '';
  const clipped = truncateText(rawText.trim(), CODEX_THREADS_BOUNDS.maxFinalResponseChars);
  return {
    server,
    status: typeof output['status'] === 'string' ? output['status'] : 'unknown',
    threadId: accepted.threadId,
    turnId: accepted.turnId,
    finalAssistantText: clipped.text || null,
    textTruncated: clipped.truncated,
  };
}

async function runTurnAndWait(
  config: CodexThreadsToolConfig,
  runner: CodexThreadsRunner,
  input: { server: string; threadId: string; message: string },
  ctx: ToolContext,
) {
  const result = await runner({
    binary: config.binary,
    args: buildInvocationArgs(config, input.server, [
      'send',
      input.threadId,
      input.message,
      '--stream',
    ]),
    timeoutMs: TURN_WAIT_TIMEOUT_MS,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  if (result.aborted || ctx.signal?.aborted) {
    throw new ToolError('cancelled', 'Codex Threads operation was cancelled');
  }
  const events = parseJsonLines(result.stdout, { allowTrailingPartial: result.outputTooLarge });
  const acceptance = events.find(
    (event) => event['status'] === 'accepted' || event['type'] === 'accepted',
  );
  const terminal = [...events]
    .reverse()
    .find((event) => ['completed', 'failed', 'interrupted'].includes(String(event['status'])));
  if (terminal) {
    return projectWaitedTurn(terminal, input.server);
  }
  if (acceptance && (result.timedOut || result.outputTooLarge)) {
    const accepted = acceptedTurn(acceptance, input.threadId);
    return {
      server: input.server,
      status: 'pending',
      threadId: accepted.threadId,
      turnId: accepted.turnId,
      waitTimedOut: result.timedOut,
      outputLimitReached: result.outputTooLarge,
    };
  }
  if (result.timedOut) {
    throw new ToolError('timeout', 'Codex Threads did not accept the turn before wait timeout');
  }
  if (result.outputTooLarge) {
    throw new ToolError('output_too_large', 'Codex Threads returned too much turn data');
  }
  if (result.exitCode !== 0) {
    const detail = errorDetail(result.stderr);
    throw new ToolError(
      'execution_failed',
      detail ? `Codex Threads failed: ${detail}` : 'Codex Threads turn failed',
    );
  }
  throw new ToolError('execution_failed', 'Codex Threads returned no terminal turn result');
}

function parseListArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): {
  server: string;
  updatedWithinHours: number;
  limit: number;
  cwd?: string;
} {
  const args = asObject(raw, ['server', 'updatedWithinHours', 'limit', 'cwd']);
  const updatedWithinHours = boundedInteger(
    args['updatedWithinHours'],
    'updatedWithinHours',
    CODEX_THREADS_BOUNDS.defaultLookbackHours,
    1,
    CODEX_THREADS_BOUNDS.maxLookbackHours,
  );
  const limit = boundedInteger(
    args['limit'],
    'limit',
    CODEX_THREADS_BOUNDS.defaultListLimit,
    1,
    CODEX_THREADS_BOUNDS.maxListLimit,
  );
  const cwd = optionalString(args['cwd'], 'cwd', 2_048);
  if (cwd && !path.isAbsolute(cwd)) {
    throw new ToolError('invalid_arguments', 'cwd must be an absolute path');
  }
  return {
    server: requireServer(args['server'], config),
    updatedWithinHours,
    limit,
    ...(cwd ? { cwd } : {}),
  };
}

async function listRecent(
  config: CodexThreadsToolConfig,
  runner: CodexThreadsRunner,
  input: { server: string; updatedWithinHours: number; limit: number; cwd?: string },
  ctx: ToolContext,
): Promise<{ threads: ThreadSummary[]; truncated: boolean }> {
  const output = await runJson(
    config,
    runner,
    input.server,
    [
      'list',
      '--limit',
      String(input.limit),
      '--since',
      `${input.updatedWithinHours}h`,
      '--sort',
      'updated',
      '--desc',
      ...(input.cwd ? ['--cwd', input.cwd] : []),
    ],
    ctx,
    READ_TIMEOUT_MS,
  );
  const rawThreads = Array.isArray(output['threads']) ? output['threads'] : [];
  const threads = rawThreads.map(projectThread).filter((item): item is ThreadSummary => !!item);
  return {
    threads,
    truncated:
      typeof output['nextCursor'] === 'string' &&
      output['nextCursor'].length > 0 &&
      threads.length >= input.limit,
  };
}

function parseFindArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): {
  server: string;
  query: string;
  updatedWithinHours: number;
  limit: number;
} {
  const args = asObject(raw, ['server', 'query', 'updatedWithinHours', 'limit']);
  return {
    server: requireServer(args['server'], config),
    query: requireString(args['query'], 'query', CODEX_THREADS_BOUNDS.maxFindQueryChars),
    updatedWithinHours: boundedInteger(
      args['updatedWithinHours'],
      'updatedWithinHours',
      CODEX_THREADS_BOUNDS.defaultLookbackHours,
      1,
      CODEX_THREADS_BOUNDS.maxLookbackHours,
    ),
    limit: boundedInteger(
      args['limit'],
      'limit',
      CODEX_THREADS_BOUNDS.defaultFindLimit,
      1,
      CODEX_THREADS_BOUNDS.maxFindLimit,
    ),
  };
}

function matchThread(
  thread: ThreadSummary,
  query: string,
): { score: number; matchedFields: string[] } | null {
  const normalized = query.toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const fields = [
    ['name', thread.name ?? ''],
    ['preview', thread.preview ?? ''],
    ['cwd', thread.cwd ?? ''],
  ] as const;
  const haystack = fields.map(([, value]) => value.toLowerCase()).join('\n');
  if (!tokens.every((token) => haystack.includes(token))) {
    return null;
  }
  const matchedFields = fields
    .filter(([, value]) => tokens.some((token) => value.toLowerCase().includes(token)))
    .map(([field]) => field);
  let score = matchedFields.length;
  if ((thread.name ?? '').toLowerCase().includes(normalized)) {
    score += 6;
  }
  if ((thread.preview ?? '').toLowerCase().includes(normalized)) {
    score += 3;
  }
  if ((thread.cwd ?? '').toLowerCase().includes(normalized)) {
    score += 2;
  }
  return { score, matchedFields };
}

function parseStatusArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): { server: string; threadId: string } {
  const args = asObject(raw, ['server', 'threadId']);
  return {
    server: requireServer(args['server'], config),
    threadId: requireThreadId(args['threadId']),
  };
}

async function loadStatus(
  config: CodexThreadsToolConfig,
  runner: CodexThreadsRunner,
  server: string,
  threadId: string,
  ctx: ToolContext,
): Promise<{
  server: string;
  thread: ThreadSummary;
  active: boolean;
  activeTurnId: string | null;
  historyScanTruncated: boolean;
}> {
  const output = await runJson(
    config,
    runner,
    server,
    ['status', threadId, '--load'],
    ctx,
    READ_TIMEOUT_MS,
  );
  const thread = projectThread(output['thread']);
  if (!thread) {
    throw new ToolError('execution_failed', 'Codex Threads status returned no thread');
  }
  const activeTurnId =
    typeof output['activeTurnId'] === 'string' && output['activeTurnId'].trim()
      ? output['activeTurnId'].trim()
      : null;
  return {
    server,
    thread,
    active: activeTurnId !== null,
    activeTurnId,
    historyScanTruncated: output['truncated'] === true,
  };
}

function parseMessagesArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): {
  server: string;
  threadId: string;
  last: number;
  role?: 'user' | 'assistant';
} {
  const args = asObject(raw, ['server', 'threadId', 'last', 'role']);
  const roleRaw = args['role'];
  if (roleRaw !== undefined && roleRaw !== 'user' && roleRaw !== 'assistant') {
    throw new ToolError('invalid_arguments', 'role must be user or assistant');
  }
  return {
    server: requireServer(args['server'], config),
    threadId: requireThreadId(args['threadId']),
    last: boundedInteger(
      args['last'],
      'last',
      CODEX_THREADS_BOUNDS.defaultMessageLimit,
      1,
      CODEX_THREADS_BOUNDS.maxMessageLimit,
    ),
    ...(roleRaw ? { role: roleRaw } : {}),
  };
}

function projectMessages(rawMessages: unknown[]): {
  messages: Array<{
    role: 'user' | 'assistant';
    text: string;
    turnId: string | null;
    timestamp: string | null;
  }>;
  textTruncated: boolean;
} {
  const messages: Array<{
    role: 'user' | 'assistant';
    text: string;
    turnId: string | null;
    timestamp: string | null;
  }> = [];
  let remaining = CODEX_THREADS_BOUNDS.maxTranscriptChars;
  let textTruncated = false;
  for (let index = rawMessages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const raw = rawMessages[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue;
    }
    const value = raw as Record<string, unknown>;
    const role = value['role'];
    const text = typeof value['text'] === 'string' ? value['text'].trim() : '';
    if ((role !== 'user' && role !== 'assistant') || !text) {
      continue;
    }
    const budget = Math.min(CODEX_THREADS_BOUNDS.maxMessageChars, remaining);
    const clipped = truncateText(text, budget);
    textTruncated ||= clipped.truncated;
    messages.unshift({
      role,
      text: clipped.text,
      turnId: typeof value['turnId'] === 'string' ? value['turnId'] : null,
      timestamp: timestampToIso(value['turnStartedAt'] ?? value['turnCompletedAt']),
    });
    remaining -= clipped.text.length;
  }
  if (messages.length < rawMessages.length) {
    textTruncated = true;
  }
  return { messages, textTruncated };
}

function parseSendArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): { server: string; threadId: string; message: string; wait: boolean } {
  const args = asObject(raw, ['server', 'threadId', 'message', 'wait']);
  if (args['wait'] !== undefined && typeof args['wait'] !== 'boolean') {
    throw new ToolError('invalid_arguments', 'wait must be a boolean');
  }
  return {
    server: requireServer(args['server'], config),
    threadId: requireThreadId(args['threadId']),
    message: requireString(args['message'], 'message', CODEX_THREADS_BOUNDS.maxPromptChars, {
      trim: false,
    }),
    wait: args['wait'] === true,
  };
}

function parseSteerArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): { server: string; threadId: string; turnId: string; message: string } {
  const args = asObject(raw, ['server', 'threadId', 'turnId', 'message']);
  return {
    server: requireServer(args['server'], config),
    threadId: requireThreadId(args['threadId']),
    turnId: requireString(args['turnId'], 'turnId', CODEX_THREADS_BOUNDS.maxThreadIdChars),
    message: requireString(args['message'], 'message', CODEX_THREADS_BOUNDS.maxPromptChars, {
      trim: false,
    }),
  };
}

async function withMutationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  if (activeMutationKeys.has(key)) {
    throw new ToolError('thread_busy', 'Another Codex Threads mutation is already in progress');
  }
  activeMutationKeys.add(key);
  try {
    return await task();
  } finally {
    activeMutationKeys.delete(key);
  }
}

function acceptedTurn(output: Record<string, unknown>, fallbackThreadId: string) {
  const turnId =
    typeof output['turnId'] === 'string' && output['turnId'].trim()
      ? output['turnId'].trim()
      : null;
  if (!turnId) {
    throw new ToolError('execution_failed', 'Codex Threads did not return an accepted turn id');
  }
  return {
    status: typeof output['status'] === 'string' ? output['status'] : 'accepted',
    threadId:
      typeof output['threadId'] === 'string' && output['threadId'].trim()
        ? output['threadId'].trim()
        : fallbackThreadId,
    turnId,
  };
}

function parseCreateArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): { server: string; cwd: string; prompt: string; name?: string } {
  const args = asObject(raw, ['server', 'cwd', 'prompt', 'name']);
  const cwd = requireString(args['cwd'], 'cwd', 2_048);
  if (!path.isAbsolute(cwd)) {
    throw new ToolError('invalid_arguments', 'cwd must be an absolute path');
  }
  const name = optionalString(args['name'], 'name', CODEX_THREADS_BOUNDS.maxNameChars);
  return {
    server: requireServer(args['server'], config),
    cwd,
    prompt: requireString(args['prompt'], 'prompt', CODEX_THREADS_BOUNDS.maxPromptChars, {
      trim: false,
    }),
    ...(name ? { name } : {}),
  };
}

async function resolveAllowedCwd(config: CodexThreadsToolConfig, cwd: string): Promise<string> {
  if (config.allowedCwdRoots.length === 0) {
    throw new ToolError(
      'not_configured',
      'Codex Threads create requires at least one allowedCwdRoots entry',
    );
  }
  let resolvedCwd: string;
  try {
    resolvedCwd = await fs.realpath(cwd);
    const stat = await fs.stat(resolvedCwd);
    if (!stat.isDirectory()) {
      throw new ToolError('invalid_arguments', 'cwd must be a directory');
    }
  } catch (error) {
    if (error instanceof ToolError) {
      throw error;
    }
    throw new ToolError('invalid_arguments', 'cwd does not exist or is not readable');
  }
  for (const root of config.allowedCwdRoots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = await fs.realpath(root);
    } catch {
      throw new ToolError(
        'not_configured',
        `Configured Codex Threads cwd root is unavailable: ${root}`,
      );
    }
    const relative = path.relative(resolvedRoot, resolvedCwd);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return resolvedCwd;
    }
  }
  throw new ToolError('cwd_not_allowed', 'cwd is outside the configured Codex Threads roots');
}

function parseRenameArgs(
  raw: unknown,
  config: CodexThreadsToolConfig,
): { server: string; threadId: string; name: string } {
  const args = asObject(raw, ['server', 'threadId', 'name']);
  return {
    server: requireServer(args['server'], config),
    threadId: requireThreadId(args['threadId']),
    name: requireString(args['name'], 'name', CODEX_THREADS_BOUNDS.maxNameChars),
  };
}

function errorShape(error: unknown): { code: string; message: string } {
  if (error instanceof ToolError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'execution_failed',
    message: error instanceof Error ? error.message : 'Codex Threads operation failed',
  };
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

export function createCodexThreadsToolDefinitions(
  configured: CodexThreadsToolConfig | undefined,
  runner: CodexThreadsRunner = defaultRunner,
): BuiltInToolDefinition[] {
  const readCapability = ['codex_threads.read'];
  const writeCapability = ['codex_threads.write'];
  const lookbackProperty = {
    type: 'integer',
    minimum: 1,
    maximum: CODEX_THREADS_BOUNDS.maxLookbackHours,
    description: 'Updated-within window in hours. Defaults to 24; maximum 720 (30 days).',
  };
  const threadIdProperty = {
    type: 'string',
    maxLength: CODEX_THREADS_BOUNDS.maxThreadIdChars,
    description: 'Opaque Codex thread id returned by another Codex Threads tool.',
  };
  const serverProperty = {
    type: 'string',
    maxLength: CODEX_THREADS_BOUNDS.maxServerNameChars,
    ...(configured ? { enum: configured.allowedServers } : {}),
    description: 'Codex Threads server alias configured by the host.',
  };

  return [
    {
      name: CODEX_THREADS_TOOL_NAMES.list,
      description:
        'List recently updated Codex threads with id, name, project folder, preview, status, and update time. Defaults to the last 24 hours and 10 results.',
      capabilities: readCapability,
      parameters: objectSchema(
        {
          server: serverProperty,
          updatedWithinHours: lookbackProperty,
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: CODEX_THREADS_BOUNDS.maxListLimit,
            description: 'Maximum threads to return. Defaults to 10; maximum 25.',
          },
          cwd: { type: 'string', description: 'Optional exact absolute project folder filter.' },
        },
        ['server'],
      ),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const input = parseListArgs(raw, config);
        const result = await listRecent(config, runner, input, ctx);
        return { server: input.server, updatedWithinHours: input.updatedWithinHours, ...result };
      },
    },
    {
      name: CODEX_THREADS_TOOL_NAMES.find,
      description:
        'Find recent Codex threads by matching a short query against bounded name, preview, and project-folder metadata. This is not full transcript search.',
      capabilities: readCapability,
      parameters: objectSchema(
        {
          server: serverProperty,
          query: {
            type: 'string',
            maxLength: CODEX_THREADS_BOUNDS.maxFindQueryChars,
            description: 'Words expected in the recent thread name, preview, or project folder.',
          },
          updatedWithinHours: lookbackProperty,
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: CODEX_THREADS_BOUNDS.maxFindLimit,
            description: 'Maximum matches to return. Defaults to 5; maximum 10.',
          },
        },
        ['server', 'query'],
      ),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const input = parseFindArgs(raw, config);
        const candidates = await listRecent(
          config,
          runner,
          {
            server: input.server,
            updatedWithinHours: input.updatedWithinHours,
            limit: CODEX_THREADS_BOUNDS.findCandidateLimit,
          },
          ctx,
        );
        const matches = candidates.threads
          .map((thread) => {
            const match = matchThread(thread, input.query);
            return match ? { thread, ...match } : null;
          })
          .filter((item): item is NonNullable<typeof item> => !!item)
          .sort((left, right) => {
            if (right.score !== left.score) {
              return right.score - left.score;
            }
            return (right.thread.updatedAt ?? '').localeCompare(left.thread.updatedAt ?? '');
          });
        return {
          server: input.server,
          query: input.query,
          updatedWithinHours: input.updatedWithinHours,
          matches: matches.slice(0, input.limit).map(({ thread, matchedFields }) => ({
            ...thread,
            matchedFields,
          })),
          truncated: candidates.truncated || matches.length > input.limit,
        };
      },
    },
    {
      name: CODEX_THREADS_TOOL_NAMES.status,
      description:
        'Load and inspect one Codex thread, returning its project, status, and active turn if any.',
      capabilities: readCapability,
      parameters: objectSchema({ server: serverProperty, threadId: threadIdProperty }, [
        'server',
        'threadId',
      ]),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const { server, threadId } = parseStatusArgs(raw, config);
        return await loadStatus(config, runner, server, threadId, ctx);
      },
    },
    {
      name: CODEX_THREADS_TOOL_NAMES.messages,
      description:
        'Read a compact recent user/assistant transcript from one Codex thread. Defaults to 6 messages and never returns more than 12.',
      capabilities: readCapability,
      parameters: objectSchema(
        {
          server: serverProperty,
          threadId: threadIdProperty,
          last: {
            type: 'integer',
            minimum: 1,
            maximum: CODEX_THREADS_BOUNDS.maxMessageLimit,
            description: 'Final number of recent messages. Defaults to 6; maximum 12.',
          },
          role: {
            type: 'string',
            enum: ['user', 'assistant'],
            description: 'Optional role filter applied inside the bounded recent turn scan.',
          },
        },
        ['server', 'threadId'],
      ),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const input = parseMessagesArgs(raw, config);
        const output = await runJson(
          config,
          runner,
          input.server,
          [
            'messages',
            input.threadId,
            '--last',
            String(input.last),
            '--max-turns',
            String(CODEX_THREADS_BOUNDS.messageTurnScan),
            ...(input.role ? ['--role', input.role] : []),
          ],
          ctx,
          READ_TIMEOUT_MS,
        );
        const rawMessages = Array.isArray(output['messages']) ? output['messages'] : [];
        const projected = projectMessages(rawMessages);
        return {
          server: input.server,
          threadId: input.threadId,
          ...projected,
          historyTruncated: output['truncated'] === true,
          scannedTurns: CODEX_THREADS_BOUNDS.messageTurnScan,
        };
      },
    },
    {
      name: CODEX_THREADS_TOOL_NAMES.send,
      description:
        'Send a new Codex turn, queueing behind an active turn when needed. By default returns immediately; set wait true to wait up to 120 seconds for bounded final text.',
      capabilities: writeCapability,
      parameters: objectSchema(
        {
          server: serverProperty,
          threadId: threadIdProperty,
          message: {
            type: 'string',
            maxLength: CODEX_THREADS_BOUNDS.maxPromptChars,
            description: 'Follow-up message to start as a new turn.',
          },
          wait: {
            type: 'boolean',
            description:
              'Wait up to 120 seconds for terminal status and final assistant text. Defaults to false.',
          },
        },
        ['server', 'threadId', 'message'],
      ),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const input = parseSendArgs(raw, config);
        return await withMutationLock(`${input.server}:thread:${input.threadId}`, async () => {
          if (input.wait) {
            return await runTurnAndWait(config, runner, input, ctx);
          }
          const output = await runJson(
            config,
            runner,
            input.server,
            ['send', input.threadId, input.message, '--no-wait'],
            ctx,
            MUTATION_TIMEOUT_MS,
          );
          return { server: input.server, ...acceptedTurn(output, input.threadId) };
        });
      },
    },
    {
      name: CODEX_THREADS_TOOL_NAMES.steer,
      description:
        'Add guidance to the currently active Codex turn. Requires the exact active turn id from codex_threads_status and fails if that turn is no longer active.',
      capabilities: writeCapability,
      parameters: objectSchema(
        {
          server: serverProperty,
          threadId: threadIdProperty,
          turnId: {
            type: 'string',
            maxLength: CODEX_THREADS_BOUNDS.maxThreadIdChars,
            description: 'Exact active turn id returned by codex_threads_status.',
          },
          message: {
            type: 'string',
            maxLength: CODEX_THREADS_BOUNDS.maxPromptChars,
            description: 'Additional guidance for the active turn.',
          },
        },
        ['server', 'threadId', 'turnId', 'message'],
      ),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const input = parseSteerArgs(raw, config);
        return await withMutationLock(`${input.server}:thread:${input.threadId}`, async () => {
          const output = await runJson(
            config,
            runner,
            input.server,
            ['steer', input.threadId, input.turnId, input.message],
            ctx,
            MUTATION_TIMEOUT_MS,
          );
          return { server: input.server, ...acceptedTurn(output, input.threadId) };
        });
      },
    },
    {
      name: CODEX_THREADS_TOOL_NAMES.create,
      description:
        'Create a Codex thread in an allowed absolute project folder, optionally set its name, and start its initial prompt without waiting for completion.',
      capabilities: writeCapability,
      parameters: objectSchema(
        {
          server: serverProperty,
          cwd: { type: 'string', description: 'Absolute project folder allowed by server config.' },
          prompt: {
            type: 'string',
            maxLength: CODEX_THREADS_BOUNDS.maxPromptChars,
            description: 'Initial task for the new Codex thread.',
          },
          name: {
            type: 'string',
            maxLength: CODEX_THREADS_BOUNDS.maxNameChars,
            description: 'Optional readable thread name.',
          },
        },
        ['server', 'cwd', 'prompt'],
      ),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const input = parseCreateArgs(raw, config);
        const cwd = await resolveAllowedCwd(config, input.cwd);
        return await withMutationLock(`${input.server}:create:${cwd}`, async () => {
          const created = await runJson(
            config,
            runner,
            input.server,
            ['new', '--cwd', cwd],
            ctx,
            MUTATION_TIMEOUT_MS,
          );
          const threadId = requireThreadId(created['threadId']);
          const errors: Array<{ step: 'name' | 'prompt'; code: string; message: string }> = [];
          let nameSet = false;
          if (input.name) {
            try {
              await runJson(
                config,
                runner,
                input.server,
                ['name', threadId, input.name],
                ctx,
                MUTATION_TIMEOUT_MS,
              );
              nameSet = true;
            } catch (error) {
              errors.push({ step: 'name', ...errorShape(error) });
            }
          }
          let promptAccepted = false;
          let turnId: string | null = null;
          try {
            const sent = await runJson(
              config,
              runner,
              input.server,
              ['send', threadId, input.prompt, '--no-wait'],
              ctx,
              MUTATION_TIMEOUT_MS,
            );
            const accepted = acceptedTurn(sent, threadId);
            promptAccepted = true;
            turnId = accepted.turnId;
          } catch (error) {
            errors.push({ step: 'prompt', ...errorShape(error) });
          }
          return {
            server: input.server,
            status: errors.length > 0 ? 'partial' : 'accepted',
            threadId,
            turnId,
            nameRequested: !!input.name,
            nameSet,
            promptAccepted,
            ...(errors.length > 0 ? { errors } : {}),
          };
        });
      },
    },
    {
      name: CODEX_THREADS_TOOL_NAMES.rename,
      description: 'Set a non-empty readable name on one Codex thread.',
      capabilities: writeCapability,
      parameters: objectSchema(
        {
          server: serverProperty,
          threadId: threadIdProperty,
          name: {
            type: 'string',
            maxLength: CODEX_THREADS_BOUNDS.maxNameChars,
            description: 'New non-empty thread name. Clearing names is not supported.',
          },
        },
        ['server', 'threadId', 'name'],
      ),
      handler: async (raw, ctx) => {
        const config = requireConfig(configured);
        const input = parseRenameArgs(raw, config);
        return await withMutationLock(`${input.server}:thread:${input.threadId}`, async () => {
          const output = await runJson(
            config,
            runner,
            input.server,
            ['name', input.threadId, input.name],
            ctx,
            MUTATION_TIMEOUT_MS,
          );
          return {
            server: input.server,
            status: typeof output['status'] === 'string' ? output['status'] : 'accepted',
            threadId: input.threadId,
            name: input.name,
          };
        });
      },
    },
  ];
}
