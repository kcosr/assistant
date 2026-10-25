import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ToolContext } from './types';
import type { CodexWebSearchOptions } from './codexWebSearch';
import { ToolError } from './errors';
import {
  clearWebSearchSessionsForTests,
  createWebSearchToolDefinition,
  executeWebSearch,
  getWebSearchSessionForTests,
  parseWebSearchArgs,
  resolveWebSearchWorkdir,
  setCodexWebSearchRunnerForTests,
  WEB_SEARCH_TOOL_NAME,
} from './webSearch';

const SESSION_ID = '0199a213-81c0-7800-8aa1-bbab2a035a53';

function makeCtx(sessionId = 'chat-1', signal = new AbortController().signal): ToolContext {
  return {
    sessionId,
    signal,
    envConfig: { dataDir: '/var/assistant-test' } as ToolContext['envConfig'],
  } as ToolContext;
}

function stubRunner() {
  const run = vi.fn(async (_options: CodexWebSearchOptions) => ({
    text: 'Answer with [source](https://example.com).',
    sessionId: SESSION_ID,
  }));
  setCodexWebSearchRunnerForTests(run);
  return run;
}

afterEach(() => {
  clearWebSearchSessionsForTests();
  setCodexWebSearchRunnerForTests(null);
  vi.unstubAllEnvs();
});

describe('web_search contract', () => {
  it('preserves the tool name and API while advertising public-web research', () => {
    const tool = createWebSearchToolDefinition();
    expect(tool.name).toBe(WEB_SEARCH_TOOL_NAME);
    expect(tool.name).toBe('web_search');
    expect(tool.parameters).toMatchObject({
      properties: { query: { type: 'string' }, continue: { type: 'boolean' } },
      required: ['query'],
      additionalProperties: false,
    });
    expect(tool.description).toContain('live public web');
    expect(tool.description).not.toMatch(/Grok|Twitter|X tools/);
  });

  it('parses natural-language queries and explicit follow-ups', () => {
    expect(parseWebSearchArgs({ query: '  What changed today?  ' })).toEqual({
      query: 'What changed today?',
      continueSession: false,
    });
    expect(parseWebSearchArgs({ query: 'More detail', continue: true }).continueSession).toBe(true);
  });

  it.each([
    null,
    [],
    'question',
    {},
    { query: '' },
    { query: 1 },
    { query: 'x', continue: 'yes' },
    { query: 'x', model: 'other' },
  ])('rejects invalid arguments %j', (args) =>
    expect(() => parseWebSearchArgs(args)).toThrow(ToolError),
  );

  it('isolates conversation workspaces without using caller-controlled paths', () => {
    const cwd = resolveWebSearchWorkdir('/var/data', '../../secret');
    expect(path.dirname(cwd)).toBe('/var/data/codex-web-search');
    expect(path.basename(cwd)).toMatch(/^[a-f0-9]{64}$/);
    expect(cwd).toBe(resolveWebSearchWorkdir('/var/data', '../../secret'));
    expect(cwd).not.toBe(resolveWebSearchWorkdir('/var/data', 'different'));
    expect(() => resolveWebSearchWorkdir(undefined, 'x')).toThrow(
      expect.objectContaining({ code: 'configuration_error' }),
    );
  });
});

describe('executeWebSearch', () => {
  it('serializes overlapping calls and reads the continuation ID after the preceding call', async () => {
    const run = stubRunner();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(async () => {
      await blocked;
      return { text: 'First answer', sessionId: SESSION_ID };
    });
    const first = executeWebSearch({ query: 'First' }, makeCtx());
    const second = executeWebSearch({ query: 'Follow-up', continue: true }, makeCtx());
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    release();
    await first;
    await second;
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0].resumeSessionId).toBe(SESSION_ID);
  });

  it('records parallel fresh searches in issue order', async () => {
    const run = stubRunner();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lastId = '0199a213-81c0-7800-8aa1-bbab2a035a54';
    run
      .mockImplementationOnce(async () => {
        await blocked;
        return { text: 'First answer', sessionId: SESSION_ID };
      })
      .mockResolvedValueOnce({ text: 'Second answer', sessionId: lastId });
    const first = executeWebSearch({ query: 'First' }, makeCtx());
    const second = executeWebSearch({ query: 'Second' }, makeCtx());
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(getWebSearchSessionForTests('chat-1')).toBe(lastId);
    expect(run.mock.calls[1]![0].resumeSessionId).toBeUndefined();
  });

  it('releases queued requests after failure without losing prior successful research', async () => {
    const run = stubRunner();
    await executeWebSearch({ query: 'Seed' }, makeCtx());
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(async () => {
      await blocked;
      throw new ToolError('execution_failed', 'Research failed');
    });
    const first = expect(
      executeWebSearch({ query: 'Failed new search' }, makeCtx()),
    ).rejects.toMatchObject({ code: 'execution_failed' });
    const second = executeWebSearch({ query: 'Follow-up', continue: true }, makeCtx());
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    release();
    await first;
    await second;
    expect(run.mock.calls[2]![0].resumeSessionId).toBe(SESSION_ID);
  });

  it('cancels a queued call promptly without letting later calls overtake the active turn', async () => {
    const run = stubRunner();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(async () => {
      await blocked;
      return { text: 'First answer', sessionId: SESSION_ID };
    });
    const first = executeWebSearch({ query: 'First' }, makeCtx());
    const controller = new AbortController();
    const cancelled = expect(
      executeWebSearch({ query: 'Cancelled' }, makeCtx('chat-1', controller.signal)),
    ).rejects.toMatchObject({ code: 'cancelled' });
    const third = executeWebSearch({ query: 'Follow-up', continue: true }, makeCtx());
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    controller.abort();
    await cancelled;
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, third]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1]![0].resumeSessionId).toBe(SESSION_ID);
  });

  it('allows different conversations to research concurrently', async () => {
    const run = stubRunner();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(async () => {
      await blocked;
      return { text: 'First answer', sessionId: SESSION_ID };
    });
    const first = executeWebSearch({ query: 'First' }, makeCtx('first'));
    await executeWebSearch({ query: 'Other' }, makeCtx('other'));
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await first;
  });

  it('requires configured private workspace storage', async () => {
    const run = stubRunner();
    const ctx = makeCtx();
    delete ctx.envConfig;
    await expect(executeWebSearch({ query: 'Question' }, ctx)).rejects.toMatchObject({
      code: 'configuration_error',
    });
    expect(run).not.toHaveBeenCalled();
  });
  it('passes the question to Codex and retains only the stable model-facing result', async () => {
    const run = stubRunner();
    const ctx = makeCtx();
    await expect(executeWebSearch({ query: 'What changed today?' }, ctx)).resolves.toEqual({
      text: 'Answer with [source](https://example.com).',
      continued: false,
    });
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'What changed today?',
        realtime: false,
        timeoutMs: 100_000,
        signal: ctx.signal,
        cwd: resolveWebSearchWorkdir('/var/assistant-test', 'chat-1'),
      }),
    );
    expect(run.mock.calls[0]![0].resumeSessionId).toBeUndefined();
    expect(getWebSearchSessionForTests('chat-1')).toBe(SESSION_ID);
  });

  it('uses voice brevity with the same deadline and a separate conversation', async () => {
    const run = stubRunner();
    await executeWebSearch({ query: 'What changed?' }, makeCtx('voice:chat-1'));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ realtime: true, timeoutMs: 100_000 }),
    );
    expect(getWebSearchSessionForTests('chat-1')).toBeUndefined();
    expect(getWebSearchSessionForTests('voice:chat-1')).toBe(SESSION_ID);
  });

  it('resumes the exact prior native thread only when continue is true', async () => {
    const run = stubRunner();
    await executeWebSearch({ query: 'First question' }, makeCtx());
    await expect(
      executeWebSearch({ query: 'More detail', continue: true }, makeCtx()),
    ).resolves.toMatchObject({ continued: true });
    expect(run.mock.calls[1]![0].resumeSessionId).toBe(SESSION_ID);
    await executeWebSearch({ query: 'New question' }, makeCtx());
    expect(run.mock.calls[2]![0].resumeSessionId).toBeUndefined();
  });

  it('does not reuse another text or voice conversation session', async () => {
    const run = stubRunner();
    await executeWebSearch({ query: 'First' }, makeCtx());
    for (const key of ['other', 'voice:chat-1']) {
      await expect(
        executeWebSearch({ query: 'Follow-up', continue: true }, makeCtx(key)),
      ).rejects.toMatchObject({ code: 'no_prior_search' });
    }
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each(['CODEX_HOME', 'ASSISTANT_CODEX_BIN', 'ASSISTANT_CODEX_RUNTIME_PATH'])(
    'invalidates continuation when %s changes',
    async (name) => {
      const run = stubRunner();
      await executeWebSearch({ query: 'First' }, makeCtx());
      vi.stubEnv(name, '/different/native-setting');
      await expect(
        executeWebSearch({ query: 'Follow-up', continue: true }, makeCtx()),
      ).rejects.toMatchObject({ code: 'no_prior_search' });
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it('does not start a fresh search after a missing native session', async () => {
    const run = stubRunner();
    await executeWebSearch({ query: 'First' }, makeCtx());
    run.mockRejectedValueOnce(new ToolError('no_prior_search', 'Session unavailable'));
    await expect(
      executeWebSearch({ query: 'Follow-up', continue: true }, makeCtx()),
    ).rejects.toMatchObject({ code: 'no_prior_search' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('preserves the last successful session after a failed new request', async () => {
    const run = stubRunner();
    await executeWebSearch({ query: 'First' }, makeCtx());
    run.mockRejectedValueOnce(new ToolError('execution_failed', 'Failed'));
    await expect(
      executeWebSearch({ query: 'Failed new request' }, makeCtx()),
    ).rejects.toMatchObject({ code: 'execution_failed' });
    expect(getWebSearchSessionForTests('chat-1')).toBe(SESSION_ID);
  });

  it('rejects missing sessions and invalid native homes before invoking the runner', async () => {
    const run = stubRunner();
    await expect(executeWebSearch({ query: 'x' }, makeCtx(' '))).rejects.toMatchObject({
      code: 'session_unavailable',
    });
    vi.stubEnv('CODEX_HOME', 'relative');
    await expect(executeWebSearch({ query: 'x' }, makeCtx())).rejects.toMatchObject({
      code: 'configuration_error',
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('honors cancellation before execution and before retaining a result', async () => {
    const run = stubRunner();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeWebSearch({ query: 'x' }, makeCtx('chat-1', controller.signal)),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(run).not.toHaveBeenCalled();
    const active = new AbortController();
    run.mockImplementationOnce(async () => {
      active.abort();
      return { text: 'Too late', sessionId: SESSION_ID };
    });
    await expect(
      executeWebSearch({ query: 'x' }, makeCtx('chat-1', active.signal)),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(getWebSearchSessionForTests('chat-1')).toBeUndefined();
  });
});
