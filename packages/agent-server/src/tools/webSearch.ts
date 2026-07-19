import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { BuiltInToolDefinition, ToolContext } from './types';
import { ToolError } from './errors';
import { isRealtimeToolSessionId } from '../voice/constants';

export const WEB_SEARCH_TOOL_NAME = 'web_search';

/** Dangerous / out-of-scope Grok tools removed for research-only invocations. */
export const GROK_WEB_SEARCH_DISALLOWED_TOOLS = [
  'run_terminal_cmd',
  'Agent',
  'search_replace',
  'write',
  'read_file',
  'list_dir',
  'grep',
  'memory_search',
  'image_gen',
  'image_edit',
  'image_to_video',
  'reference_to_video',
].join(',');

// Realtime does not block spoken turns while tools run, so use the same wall-clock
// budget as text agents. (Earlier design assumed synchronous dead air; that was wrong.)
const TEXT_TIMEOUT_MS = 100_000;
const REALTIME_TIMEOUT_MS = TEXT_TIMEOUT_MS;
const REALTIME_MAX_TURNS = 6;
const TEXT_MAX_TURNS = 14;

const FIXED_RULES =
  'Use web_search and web_fetch for general web facts. ' +
  'Use X tools for posts, accounts, and threads when the question is about X/Twitter. ' +
  'Do not run shell commands or edit files. Prefer current information over stale knowledge.';

const REALTIME_RULES =
  `${FIXED_RULES} Answer for spoken voice in 1–3 sentences unless the user asked for detail.`;

/** In-memory Grok session ids keyed by Assistant tool conversation key. */
const grokSessionByConversation = new Map<string, string>();

export function clearWebSearchSessionsForTests(): void {
  grokSessionByConversation.clear();
}

export function getWebSearchSessionForTests(conversationKey: string): string | undefined {
  return grokSessionByConversation.get(conversationKey);
}

export type GrokRunnerResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted?: boolean;
};

export type GrokRunner = (options: {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}) => Promise<GrokRunnerResult>;

let grokRunner: GrokRunner = defaultGrokRunner;

export function setGrokRunnerForTests(runner: GrokRunner | null): void {
  grokRunner = runner ?? defaultGrokRunner;
}

export function resolveGrokBin(): string {
  const fromEnv = process.env['ASSISTANT_GROK_BIN']?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'grok';
}

export function resolveWebSearchWorkdir(dataDir: string | undefined): string {
  if (dataDir && dataDir.trim().length > 0) {
    return path.join(dataDir.trim(), 'grok-web-search');
  }
  return path.join(os.tmpdir(), 'assistant-grok-web-search');
}

export function buildGrokWebSearchArgs(options: {
  query: string;
  resumeSessionId?: string;
  maxTurns: number;
  rules: string;
  cwd: string;
}): string[] {
  const args = [
    '-p',
    options.query,
    '--permission-mode',
    'bypassPermissions',
    '--disallowed-tools',
    GROK_WEB_SEARCH_DISALLOWED_TOOLS,
    '--deny',
    'MCPTool(*)',
    '--output-format',
    'json',
    '--cwd',
    options.cwd,
    '--max-turns',
    String(options.maxTurns),
    '--rules',
    options.rules,
  ];
  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }
  return args;
}

export function parseWebSearchArgs(raw: unknown): { query: string; continueSession: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  const record = raw as Record<string, unknown>;
  const queryRaw = record['query'];
  if (typeof queryRaw !== 'string' || queryRaw.trim().length === 0) {
    throw new ToolError('invalid_arguments', 'query is required and must be a non-empty string');
  }
  const continueSession = record['continue'] === true;
  return { query: queryRaw.trim(), continueSession };
}

export function parseGrokJsonStdout(stdout: string): { text: string; sessionId?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new ToolError('execution_failed', 'Grok returned empty output');
  }
  // Headless may print non-JSON lines before the final JSON object; prefer the last
  // full line that parses as JSON (nested objects break lastIndexOf('{') fallbacks).
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let found: unknown;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]!;
      if (!line.startsWith('{')) {
        continue;
      }
      try {
        found = JSON.parse(line);
        break;
      } catch {
        // try previous line
      }
    }
    if (found === undefined) {
      throw new ToolError('execution_failed', 'Grok returned non-JSON output');
    }
    parsed = found;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolError('execution_failed', 'Grok JSON result was not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const text = typeof obj['text'] === 'string' ? obj['text'].trim() : '';
  if (!text) {
    throw new ToolError('execution_failed', 'Grok returned no answer text');
  }
  const sessionId =
    typeof obj['sessionId'] === 'string' && obj['sessionId'].trim().length > 0
      ? obj['sessionId'].trim()
      : undefined;
  return sessionId ? { text, sessionId } : { text };
}

async function defaultGrokRunner(options: {
  bin: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<GrokRunnerResult> {
  if (options.signal?.aborted) {
    throw new ToolError('cancelled', 'Web search was cancelled');
  }

  await fs.mkdir(options.cwd, { recursive: true });

  return await new Promise<GrokRunnerResult>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const child = spawn(options.bin, options.args, {
      shell: false,
      cwd: options.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const escalateKill = () => {
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 2_000).unref?.();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      escalateKill();
    }, options.timeoutMs);

    const onAbort = () => {
      aborted = true;
      child.kill('SIGTERM');
      escalateKill();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > 2_000_000) {
        stdout = stdout.slice(-1_500_000);
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 500_000) {
        stderr = stderr.slice(-400_000);
      }
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
          `Failed to start Grok (${options.bin}): ${error.message}`,
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        aborted,
      });
    });
  });
}

export async function executeWebSearch(
  args: unknown,
  ctx: ToolContext,
): Promise<{ text: string; continued: boolean }> {
  const { query, continueSession } = parseWebSearchArgs(args);
  const conversationKey = ctx.sessionId?.trim();
  if (!conversationKey) {
    throw new ToolError('session_unavailable', 'Current session is not available');
  }

  const realtime = isRealtimeToolSessionId(conversationKey);
  const timeoutMs = realtime ? REALTIME_TIMEOUT_MS : TEXT_TIMEOUT_MS;
  const maxTurns = realtime ? REALTIME_MAX_TURNS : TEXT_MAX_TURNS;
  const rules = realtime ? REALTIME_RULES : FIXED_RULES;

  let resumeSessionId: string | undefined;
  if (continueSession) {
    resumeSessionId = grokSessionByConversation.get(conversationKey);
    if (!resumeSessionId) {
      throw new ToolError(
        'no_prior_search',
        'No previous web search in this conversation. Call web_search without continue first.',
      );
    }
  }

  const workdir = resolveWebSearchWorkdir(ctx.envConfig?.dataDir);
  const argsList = buildGrokWebSearchArgs({
    query,
    ...(resumeSessionId ? { resumeSessionId } : {}),
    maxTurns,
    rules,
    cwd: workdir,
  });

  const result = await grokRunner({
    bin: resolveGrokBin(),
    args: argsList,
    cwd: workdir,
    timeoutMs,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });

  if (result.aborted || ctx.signal?.aborted) {
    throw new ToolError('cancelled', 'Web search was cancelled');
  }

  if (result.timedOut) {
    throw new ToolError(
      'timeout',
      realtime
        ? 'Research timed out. Try a shorter question.'
        : 'Research timed out before Grok finished.',
    );
  }

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim().slice(0, 200);
    throw new ToolError(
      'execution_failed',
      detail
        ? `Grok research failed: ${detail}`
        : 'Grok research failed. Check host Grok auth and configuration.',
    );
  }

  const parsed = parseGrokJsonStdout(result.stdout);
  if (parsed.sessionId) {
    grokSessionByConversation.set(conversationKey, parsed.sessionId);
  }

  return {
    text: parsed.text,
    continued: continueSession,
  };
}

export function createWebSearchToolDefinition(): BuiltInToolDefinition {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      'Search the live public web and public X/Twitter for current information. ' +
      'Pass query as a full natural-language question or request ' +
      '(e.g. "What is the weather in Austin today?" or "What has @user posted recently about robots?"). ' +
      'Do not pass bare keyword lists. ' +
      'Set continue to true only when following up on the previous search in this conversation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Natural-language research question or request (not a bare keyword list).',
        },
        continue: {
          type: 'boolean',
          description:
            'When true, resume the previous Grok research session for this conversation. Default false.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => executeWebSearch(args, ctx),
  };
}
