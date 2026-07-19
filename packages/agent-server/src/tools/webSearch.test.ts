import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ToolContext } from './types';
import { ToolError } from './errors';
import {
  buildGrokWebSearchArgs,
  clearWebSearchSessionsForTests,
  executeWebSearch,
  getWebSearchSessionForTests,
  GROK_WEB_SEARCH_DISALLOWED_TOOLS,
  parseGrokJsonStdout,
  parseWebSearchArgs,
  resolveWebSearchWorkdir,
  setGrokRunnerForTests,
  WEB_SEARCH_TOOL_NAME,
} from './webSearch';
import { isRealtimeToolSessionId, VOICE_TOOL_SESSION_PREFIX } from '../voice/constants';

function makeCtx(sessionId: string, dataDir?: string): ToolContext {
  return {
    sessionId,
    signal: new AbortController().signal,
    ...(dataDir
      ? {
          envConfig: {
            dataDir,
          } as ToolContext['envConfig'],
        }
      : {}),
  } as ToolContext;
}

describe('webSearch helpers', () => {
  afterEach(() => {
    clearWebSearchSessionsForTests();
    setGrokRunnerForTests(null);
  });

  it('exports the stable tool name', () => {
    expect(WEB_SEARCH_TOOL_NAME).toBe('web_search');
  });

  it('detects Realtime session keys via shared prefix', () => {
    expect(VOICE_TOOL_SESSION_PREFIX).toBe('voice:');
    expect(isRealtimeToolSessionId('voice:abc')).toBe(true);
    expect(isRealtimeToolSessionId('session-1')).toBe(false);
  });

  it('parses query and continue', () => {
    expect(parseWebSearchArgs({ query: '  What is up?  ' })).toEqual({
      query: 'What is up?',
      continueSession: false,
    });
    expect(parseWebSearchArgs({ query: 'again', continue: true }).continueSession).toBe(true);
    expect(() => parseWebSearchArgs({ query: '   ' })).toThrow(ToolError);
  });

  it('builds argv without shell interpolation and without restrictive --tools', () => {
    const args = buildGrokWebSearchArgs({
      query: 'weather in Austin; rm -rf /',
      maxTurns: 6,
      rules: 'be brief',
      cwd: '/tmp/work',
    });
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe('weather in Austin; rm -rf /');
    expect(args).toContain('--permission-mode');
    expect(args).toContain('bypassPermissions');
    expect(args).toContain('--disallowed-tools');
    expect(args).toContain(GROK_WEB_SEARCH_DISALLOWED_TOOLS);
    expect(GROK_WEB_SEARCH_DISALLOWED_TOOLS).toContain('run_terminal_cmd');
    expect(GROK_WEB_SEARCH_DISALLOWED_TOOLS).toContain('read_file');
    expect(GROK_WEB_SEARCH_DISALLOWED_TOOLS).toContain('memory_search');
    expect(args).not.toContain('--tools');
    expect(args).toContain('--deny');
    expect(args).toContain('MCPTool(*)');
    expect(args).toContain('--cwd');
    expect(args).toContain('/tmp/work');
  });

  it('includes --resume when continuing', () => {
    const args = buildGrokWebSearchArgs({
      query: 'and tomorrow?',
      resumeSessionId: 'sess-1',
      maxTurns: 6,
      rules: 'x',
      cwd: '/tmp/w',
    });
    const idx = args.indexOf('--resume');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('sess-1');
  });

  it('parses Grok JSON stdout including trailing noise and nested objects', () => {
    const raw = 'noise\n{"text":"Hello","sessionId":"s1","usage":{"input_tokens":10}}\n';
    expect(parseGrokJsonStdout(raw)).toEqual({ text: 'Hello', sessionId: 's1' });
  });

  it('resolves workdir under dataDir', () => {
    expect(resolveWebSearchWorkdir('/var/data')).toBe('/var/data/grok-web-search');
  });
});

describe('executeWebSearch', () => {
  afterEach(() => {
    clearWebSearchSessionsForTests();
    setGrokRunnerForTests(null);
  });

  it('runs a new search and stores session id', async () => {
    const captured: { args: string[]; timeoutMs: number } = { args: [], timeoutMs: 0 };
    setGrokRunnerForTests(async (opts) => {
      captured.args = opts.args;
      captured.timeoutMs = opts.timeoutMs;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ text: 'Sunny and 75F', sessionId: 'grok-1' }),
        stderr: '',
        timedOut: false,
      };
    });

    const result = await executeWebSearch(
      { query: 'What is the weather in Austin today?' },
      makeCtx('chat-session-1', '/tmp/assistant-test-data'),
    );
    expect(result).toEqual({ text: 'Sunny and 75F', continued: false });
    expect(getWebSearchSessionForTests('chat-session-1')).toBe('grok-1');
    expect(captured.args[1]).toBe('What is the weather in Austin today?');
    expect(captured.timeoutMs).toBe(100_000);
    expect(captured.args).not.toContain('--tools');
  });

  it('uses Realtime timeout and max-turns for voice session keys', async () => {
    let timeoutMs = 0;
    let args: string[] = [];
    setGrokRunnerForTests(async (opts) => {
      timeoutMs = opts.timeoutMs;
      args = opts.args;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ text: 'ok', sessionId: 'g2' }),
        stderr: '',
        timedOut: false,
      };
    });
    await executeWebSearch({ query: 'ping' }, makeCtx('voice:conv-1'));
    expect(timeoutMs).toBe(18_000);
    const mt = args.indexOf('--max-turns');
    expect(args[mt + 1]).toBe('6');
  });

  it('uses text max-turns for non-voice sessions', async () => {
    let args: string[] = [];
    setGrokRunnerForTests(async (opts) => {
      args = opts.args;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ text: 'ok', sessionId: 'g3' }),
        stderr: '',
        timedOut: false,
      };
    });
    await executeWebSearch({ query: 'ping' }, makeCtx('chat-1'));
    const mt = args.indexOf('--max-turns');
    expect(args[mt + 1]).toBe('14');
  });

  it('rejects empty query through executeWebSearch', async () => {
    await expect(executeWebSearch({ query: '  ' }, makeCtx('s'))).rejects.toMatchObject({
      code: 'invalid_arguments',
    });
  });

  it('maps abort to cancelled', async () => {
    setGrokRunnerForTests(async () => ({
      exitCode: 143,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: true,
    }));
    await expect(executeWebSearch({ query: 'x' }, makeCtx('s'))).rejects.toMatchObject({
      code: 'cancelled',
    });
  });

  it('continues with --resume when continue is true', async () => {
    setGrokRunnerForTests(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ text: 'first', sessionId: 'grok-cont' }),
      stderr: '',
      timedOut: false,
    }));
    await executeWebSearch({ query: 'first' }, makeCtx('s1'));

    let args: string[] = [];
    setGrokRunnerForTests(async (opts) => {
      args = opts.args;
      return {
        exitCode: 0,
        stdout: JSON.stringify({ text: 'second', sessionId: 'grok-cont' }),
        stderr: '',
        timedOut: false,
      };
    });
    const result = await executeWebSearch({ query: 'and tomorrow?', continue: true }, makeCtx('s1'));
    expect(result.continued).toBe(true);
    expect(result.text).toBe('second');
    expect(args).toContain('--resume');
    expect(args).toContain('grok-cont');
  });

  it('errors when continue has no prior session', async () => {
    await expect(
      executeWebSearch({ query: 'again', continue: true }, makeCtx('empty')),
    ).rejects.toMatchObject({ code: 'no_prior_search' });
  });

  it('maps timeout to speakable error', async () => {
    setGrokRunnerForTests(async () => ({
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: true,
    }));
    await expect(executeWebSearch({ query: 'slow' }, makeCtx('voice:x'))).rejects.toMatchObject({
      code: 'timeout',
      message: expect.stringMatching(/timed out/i),
    });
  });

  it('maps non-zero exit to execution_failed', async () => {
    setGrokRunnerForTests(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'auth missing',
      timedOut: false,
    }));
    await expect(executeWebSearch({ query: 'x' }, makeCtx('s'))).rejects.toMatchObject({
      code: 'execution_failed',
    });
  });

  it('defaultGrokRunner spawns shell:false via a fake binary', async () => {
    setGrokRunnerForTests(null);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-grok-'));
    const bin = path.join(dir, 'fake-grok');
    // argv-array only: print first -p value and exit 0 with JSON
    await fs.writeFile(
      bin,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const p = args.indexOf('-p');
const q = p >= 0 ? args[p + 1] : '';
process.stdout.write(JSON.stringify({ text: 'echo:' + q, sessionId: 'fake-sess' }));
`,
      { mode: 0o755 },
    );
    const prev = process.env['ASSISTANT_GROK_BIN'];
    process.env['ASSISTANT_GROK_BIN'] = bin;
    try {
      const result = await executeWebSearch(
        { query: 'hello;world' },
        makeCtx('fake-sess-key', dir),
      );
      expect(result.text).toBe('echo:hello;world');
      expect(getWebSearchSessionForTests('fake-sess-key')).toBe('fake-sess');
    } finally {
      if (prev === undefined) {
        delete process.env['ASSISTANT_GROK_BIN'];
      } else {
        process.env['ASSISTANT_GROK_BIN'] = prev;
      }
    }
  });
});
