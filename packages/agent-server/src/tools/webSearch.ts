import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import type { BuiltInToolDefinition, ToolContext } from './types';
import { ToolError } from './errors';
import { isRealtimeToolSessionId } from '../voice/constants';
import { runCodexWebSearch, type CodexWebSearchRunner } from './codexWebSearch';

export const WEB_SEARCH_TOOL_NAME = 'web_search';
const SEARCH_TIMEOUT_MS = 100_000;

// A change of native home, workspace, or executable invalidates continuation.
const sessions = new Map<string, { id: string; identity: string }>();
const conversationTurns = new Map<string, Promise<void>>();
let runner: CodexWebSearchRunner = runCodexWebSearch;

export function clearWebSearchSessionsForTests(): void {
  sessions.clear();
  conversationTurns.clear();
}

export function getWebSearchSessionForTests(conversationKey: string): string | undefined {
  return sessions.get(conversationKey)?.id;
}

export function setCodexWebSearchRunnerForTests(value: CodexWebSearchRunner | null): void {
  runner = value ?? runCodexWebSearch;
}

export function resolveWebSearchWorkdir(
  dataDir: string | undefined,
  conversationKey: string,
): string {
  if (!dataDir?.trim()) {
    throw new ToolError('configuration_error', 'Web search requires a configured data directory.');
  }
  const root = path.join(path.resolve(dataDir.trim()), 'codex-web-search');
  // Caller-controlled session IDs must never become filesystem paths.
  return path.join(root, createHash('sha256').update(conversationKey).digest('hex'));
}

export function parseWebSearchArgs(raw: unknown): { query: string; continueSession: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolError('invalid_arguments', 'Arguments must be an object');
  }
  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== 'query' && key !== 'continue')) {
    throw new ToolError('invalid_arguments', 'Only query and continue are supported');
  }
  if (typeof record['query'] !== 'string' || !record['query'].trim()) {
    throw new ToolError('invalid_arguments', 'query is required and must be a non-empty string');
  }
  if (record['continue'] !== undefined && typeof record['continue'] !== 'boolean') {
    throw new ToolError('invalid_arguments', 'continue must be a boolean');
  }
  return { query: record['query'].trim(), continueSession: record['continue'] === true };
}

export async function executeWebSearch(
  args: unknown,
  ctx: ToolContext,
): Promise<{ text: string; continued: boolean }> {
  const parsed = parseWebSearchArgs(args);
  const conversationKey = ctx.sessionId?.trim();
  if (!conversationKey) {
    throw new ToolError('session_unavailable', 'Current session is not available');
  }
  if (ctx.signal?.aborted) {
    throw new ToolError('cancelled', 'Web search was cancelled');
  }

  // Native thread rollouts have one writer. Read the session mapping only once
  // this conversation's preceding call has settled, including failed calls.
  const previousTurn = conversationTurns.get(conversationKey) ?? Promise.resolve();
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const turn = previousTurn.then(() => released);
  conversationTurns.set(conversationKey, turn);
  try {
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new ToolError('cancelled', 'Web search was cancelled'));
      };
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
      if (ctx.signal?.aborted) onAbort();
      void previousTurn.then(() => {
        ctx.signal?.removeEventListener('abort', onAbort);
        resolve();
      });
    });
    if (ctx.signal?.aborted) {
      throw new ToolError('cancelled', 'Web search was cancelled');
    }
    return await executeWebSearchTurn(parsed, conversationKey, ctx);
  } finally {
    release();
    // An aborted queued call must not release its successors ahead of the
    // active predecessor. The chained turn resolves only after both settle.
    void turn.then(() => {
      if (conversationTurns.get(conversationKey) === turn)
        conversationTurns.delete(conversationKey);
    });
  }
}

async function executeWebSearchTurn(
  { query, continueSession }: { query: string; continueSession: boolean },
  conversationKey: string,
  ctx: ToolContext,
): Promise<{ text: string; continued: boolean }> {
  const bin = process.env['ASSISTANT_CODEX_BIN']?.trim() || 'codex';
  const codexHome = process.env['CODEX_HOME']?.trim() || path.join(os.homedir(), '.codex');
  const runtimePath = process.env['ASSISTANT_CODEX_RUNTIME_PATH']?.trim();
  if (!path.isAbsolute(codexHome)) {
    throw new ToolError('configuration_error', 'CODEX_HOME must be an absolute path');
  }
  const cwd = resolveWebSearchWorkdir(ctx.envConfig?.dataDir, conversationKey);
  const identity = JSON.stringify([bin, codexHome, runtimePath, cwd]);
  const previous = sessions.get(conversationKey);
  if (continueSession && (!previous || previous.identity !== identity)) {
    throw new ToolError(
      'no_prior_search',
      'No previous web search in this conversation. Call web_search without continue first.',
    );
  }

  const result = await runner({
    bin,
    codexHome,
    ...(runtimePath ? { runtimePath } : {}),
    cwd,
    query,
    realtime: isRealtimeToolSessionId(conversationKey),
    ...(continueSession && previous ? { resumeSessionId: previous.id } : {}),
    timeoutMs: SEARCH_TIMEOUT_MS,
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
  if (ctx.signal?.aborted) {
    throw new ToolError('cancelled', 'Web search was cancelled');
  }
  sessions.set(conversationKey, { id: result.sessionId, identity });
  return { text: result.text, continued: continueSession };
}

export function createWebSearchToolDefinition(): BuiltInToolDefinition {
  return {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      'Search the live public web for current information and source links. ' +
      'Pass query as a full natural-language question or request ' +
      '(e.g. "What is the weather in Austin today?"). ' +
      'Do not pass bare keyword lists. ' +
      'Set continue to true only when following up on the previous search in this conversation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language research question or request (not a bare keyword list).',
        },
        continue: {
          type: 'boolean',
          description:
            'When true, resume the previous research session for this conversation. Default false.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: executeWebSearch,
  };
}
