import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCodexWebSearchArgs,
  buildCodexWebSearchEnv,
  CODEX_WEB_SEARCH_MODEL,
  runCodexWebSearch,
  type CodexWebSearchOptions,
} from './codexWebSearch';
import { getActiveCliProcessCount } from '../ws/cliProcessRegistry';

const SESSION_ID = '019abcde-1234-7890-8abc-123456789abc';
const fixtures: string[] = [];

async function createFixture(body: string): Promise<{
  root: string;
  options: CodexWebSearchOptions;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-research-test-'));
  fixtures.push(root);
  const cwd = path.join(root, 'workspace');
  const codexHome = path.join(root, 'auth');
  await fs.mkdir(cwd);
  await fs.mkdir(codexHome);
  const bin = path.join(root, 'fake-codex');
  await fs.writeFile(
    bin,
    `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(path.join(root, 'pid'))}, String(process.pid));
function emitAnswer(text = 'Research answer.', search = true, sessionId = ${JSON.stringify(SESSION_ID)}) {
  const events = [
    { type: 'thread.started', thread_id: sessionId },
    { type: 'turn.started' },
    ...(search ? [{ type: 'item.completed', item: { type: 'web_search', query: 'question' } }] : []),
    { type: 'item.completed', item: { type: 'agent_message', text } },
    { type: 'turn.completed' },
  ];
  process.stdout.write(events.map(event => JSON.stringify(event)).join('\\n') + '\\n');
}
let query = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { query += chunk; });
process.stdin.on('end', () => {
${body}
});
`,
    { mode: 0o700 },
  );
  return {
    root,
    options: {
      bin,
      codexHome,
      cwd,
      query: 'What changed today?',
      realtime: false,
      timeoutMs: 3_000,
    },
  };
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the fake Codex process');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

async function isRunning(pid: number): Promise<boolean> {
  if (process.platform === 'linux') {
    try {
      const stat = await fs.readFile(`/proc/${pid}/stat`, 'utf8');
      // Orphaned descendants may briefly remain zombies until the host reaps them.
      return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  const activeCount = getActiveCliProcessCount();
  for (const root of fixtures.splice(0)) {
    // Clean up only process groups started by this file if a failing assertion
    // prevented the usual runner cleanup.
    if (process.platform !== 'win32') {
      try {
        const pid = Number(await fs.readFile(path.join(root, 'pid'), 'utf8'));
        if (Number.isInteger(pid) && pid > 0) process.kill(-pid, 'SIGKILL');
      } catch {
        // Successful fixtures have already exited.
      }
    }
    await fs.rm(root, { recursive: true, force: true });
  }
  expect(activeCount).toBe(0);
  vi.restoreAllMocks();
});

describe('Codex research isolation', () => {
  it.each([undefined, SESSION_ID])(
    'keeps fresh and resumed requests isolated: %s',
    (resumeSessionId) => {
      const args = buildCodexWebSearchArgs({
        cwd: '/research/quoted "workspace"',
        runtimePaths: ['/runtime/codex', '/runtime/node'],
        realtime: false,
        ...(resumeSessionId ? { resumeSessionId } : {}),
      });
      expect(args.slice(0, resumeSessionId ? 3 : 1)).toEqual(
        resumeSessionId ? ['exec', 'resume', SESSION_ID] : ['exec'],
      );
      for (const flag of [
        '--ignore-user-config',
        '--ignore-rules',
        '--strict-config',
        '--skip-git-repo-check',
        '--json',
      ]) {
        expect(args).toContain(flag);
      }
      expect(CODEX_WEB_SEARCH_MODEL).toBe('gpt-6.1-sol');
      expect(args[args.indexOf('--model') + 1]).toBe(CODEX_WEB_SEARCH_MODEL);
      expect(args.at(-1)).toBe('-');
      const overrides = args.filter((_, index) => args[index - 1] === '-c');
      const instructions = overrides.filter((value) => value.startsWith('developer_instructions='));
      expect(instructions).toHaveLength(1);
      expect(overrides.filter((value) => !value.startsWith('developer_instructions='))).toEqual([
        'approval_policy="never"',
        'default_permissions="research"',
        'permissions.research.filesystem={":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny",' +
          JSON.stringify('/research/quoted "workspace"') +
          '="read","/runtime/codex"="read","/runtime/node"="read"}',
        'permissions.research.network.enabled=false',
        'web_search="live"',
        'features.code_mode_host=true',
        'model_reasoning_effort="low"',
        'project_doc_max_bytes=0',
        'cli_auth_credentials_store="file"',
        'shell_environment_policy.inherit="none"',
        'features.shell_tool=false',
        'features.shell_snapshot=false',
        'features.apps=false',
        'features.hooks=false',
        'features.plugins=false',
        'features.remote_plugin=false',
        'features.multi_agent=false',
        'features.multi_agent_v2=false',
        'features.browser_use=false',
        'features.computer_use=false',
        'features.image_generation=false',
        'features.view_image=false',
        'features.goals=false',
        'features.memories=false',
        'features.default_mode_request_user_input=false',
      ]);
    },
  );

  it('provides brief voice instructions without changing the tool permissions', () => {
    const args = buildCodexWebSearchArgs({ cwd: '/research', runtimePaths: [], realtime: true });
    const instructions = args.find((value) => value.startsWith('developer_instructions='));
    expect(instructions).toMatch(/1–3 sentences/);
    expect(instructions).toMatch(/ordinary Markdown links/);
    expect(instructions).toMatch(/without dedicated X\/Twitter/);
  });

  it('strips service secrets and runtime injection while separating HOME from Codex auth', () => {
    expect(
      buildCodexWebSearchEnv(
        { cwd: '/research', codexHome: '/private/auth' },
        {
          PATH: '/usr/bin',
          LANG: 'en_US.UTF-8',
          HTTPS_PROXY: 'http://proxy.example:8080',
          https_proxy: 'http://lowercase-proxy.example:8080',
          http_proxy: 'http://http-proxy.example:8080',
          all_proxy: 'socks5://proxy.example:1080',
          no_proxy: 'localhost',
          HOME: '/private/home',
          CODEX_HOME: '/other/codex',
          OPENAI_API_KEY: 'private-openai',
          XAI_API_KEY: 'private-xai',
          ASSISTANT_TOKEN: 'private-assistant',
          NODE_OPTIONS: '--require /private/inject.js',
          LD_PRELOAD: '/private/inject.so',
        },
      ),
    ).toEqual({
      PATH: '/usr/bin',
      LANG: 'en_US.UTF-8',
      HTTPS_PROXY: 'http://proxy.example:8080',
      https_proxy: 'http://lowercase-proxy.example:8080',
      http_proxy: 'http://http-proxy.example:8080',
      all_proxy: 'socks5://proxy.example:1080',
      no_proxy: 'localhost',
      HOME: '/research',
      CODEX_HOME: '/private/auth',
    });
  });
});

describe('runCodexWebSearch', () => {
  it.each(['directory', 'file'])(
    'rejects research under a Git checkout marker: %s',
    async (kind) => {
      const { root, options } = await createFixture('emitAnswer();');
      if (kind === 'directory') await fs.mkdir(path.join(root, '.git'));
      else await fs.writeFile(path.join(root, '.git'), 'gitdir: /other/worktree');
      await expect(runCodexWebSearch(options)).rejects.toMatchObject({
        code: 'configuration_error',
        message: expect.stringContaining('outside a Git checkout'),
      });
      expect(await exists(path.join(root, 'pid'))).toBe(false);
    },
  );

  it.each(['relative', 'missing', 'non-executable'])(
    'identifies invalid native runtime paths: %s',
    async (kind) => {
      const { root, options } = await createFixture('emitAnswer();');
      const runtimePath = kind === 'relative' ? 'codex' : path.join(root, 'native');
      if (kind === 'non-executable')
        await fs.writeFile(runtimePath, 'not executable', { mode: 0o600 });
      await expect(runCodexWebSearch({ ...options, runtimePath })).rejects.toMatchObject({
        code: 'configuration_error',
        message: expect.stringContaining('ASSISTANT_CODEX_RUNTIME_PATH'),
      });
      expect(await exists(path.join(root, 'pid'))).toBe(false);
    },
  );

  it('logs bounded stderr server-side while keeping the tool error generic', async () => {
    const { options } = await createFixture(
      "process.stderr.write('x'.repeat(20_000) + ' expired file authentication'); process.exitCode = 1;",
    );
    await expect(runCodexWebSearch(options)).rejects.toMatchObject({
      code: 'execution_failed',
      message: expect.not.stringContaining('expired file authentication'),
    });
    expect(console.error).toHaveBeenCalledWith(
      '[web_search] Codex research failed',
      expect.objectContaining({
        exitCode: 1,
        stderr: expect.stringContaining('expired file authentication'),
      }),
    );
    const details = vi.mocked(console.error).mock.calls[0]![1] as { stderr: string };
    expect(details.stderr.length).toBeLessThanOrEqual(16_000);
  });

  it('passes a large question verbatim through stdin with separate auth and workspace homes', async () => {
    const { options } = await createFixture(`
emitAnswer(JSON.stringify({ query, args: process.argv.slice(2), cwd: process.cwd(), home: process.env.HOME, codexHome: process.env.CODEX_HOME }));
`);
    const query =
      'Research "quotes", $HOME, $(commands), `backticks`, and Unicode: café.\n' +
      'detail '.repeat(30_000);
    const result = await runCodexWebSearch({ ...options, query });
    const received = JSON.parse(result.text) as Record<string, unknown>;
    expect(received['query']).toBe(query);
    expect(received['args']).not.toContain(query);
    expect(received['cwd']).toBe(options.cwd);
    expect(received['home']).toBe(options.cwd);
    expect(received['codexHome']).toBe(options.codexHome);
    expect(result.sessionId).toBe(SESSION_ID);
  });

  it('resumes the exact session and permits a follow-up that reuses sources', async () => {
    const { options } = await createFixture(`
emitAnswer(JSON.stringify(process.argv.slice(2)), false);
`);
    const result = await runCodexWebSearch({ ...options, resumeSessionId: SESSION_ID });
    expect((JSON.parse(result.text) as string[]).slice(0, 3)).toEqual([
      'exec',
      'resume',
      SESSION_ID,
    ]);
  });

  it.each(['same', 'inside', 'ancestor'])(
    'rejects auth home %s the workspace before execution',
    async (relationship) => {
      const { root, options } = await createFixture('emitAnswer();');
      const codexHome =
        relationship === 'same'
          ? options.cwd
          : relationship === 'inside'
            ? path.join(options.cwd, 'auth')
            : root;
      await fs.mkdir(codexHome, { recursive: true });
      await expect(runCodexWebSearch({ ...options, codexHome })).rejects.toMatchObject({
        code: 'configuration_error',
      });
      expect(await exists(path.join(root, 'pid'))).toBe(false);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'canonicalizes symlinks before checking auth/workspace overlap',
    async () => {
      const { root, options } = await createFixture('emitAnswer();');
      const authInsideWorkspace = path.join(options.cwd, 'auth');
      await fs.mkdir(authInsideWorkspace);
      const alias = path.join(root, 'auth-link');
      await fs.symlink(authInsideWorkspace, alias);
      await expect(runCodexWebSearch({ ...options, codexHome: alias })).rejects.toMatchObject({
        code: 'configuration_error',
      });
      const workspaceInsideAuth = path.join(options.codexHome, 'workspace');
      await fs.mkdir(workspaceInsideAuth);
      const cwdAlias = path.join(root, 'workspace-link');
      await fs.symlink(workspaceInsideAuth, cwdAlias);
      await expect(runCodexWebSearch({ ...options, cwd: cwdAlias })).rejects.toMatchObject({
        code: 'configuration_error',
      });
      expect(await exists(path.join(root, 'pid'))).toBe(false);
    },
  );

  it('rejects an unavailable auth home before execution', async () => {
    const { root, options } = await createFixture('emitAnswer();');
    await expect(
      runCodexWebSearch({ ...options, codexHome: path.join(root, 'missing-auth') }),
    ).rejects.toMatchObject({ code: 'configuration_error' });
    expect(await exists(path.join(root, 'pid'))).toBe(false);
  });

  it('rejects nonzero exit even when stdout contains a complete successful answer', async () => {
    const { options } = await createFixture('emitAnswer(); process.exitCode = 7;');
    await expect(runCodexWebSearch(options)).rejects.toMatchObject({ code: 'execution_failed' });
  });

  it.each([
    'process.stdout.write("not JSON\\n");',
    `process.stdout.write(JSON.stringify({ type: 'thread.started', thread_id: ${JSON.stringify(SESSION_ID)} }) + '\\n');`,
    'emitAnswer("No search was performed.", false);',
  ])('rejects malformed, incomplete, or unresearched output: %s', async (body) => {
    const { options } = await createFixture(body);
    await expect(runCodexWebSearch(options)).rejects.toMatchObject({ code: 'execution_failed' });
  });

  it('reports missing resume state without starting a fresh fallback', async () => {
    const { root, options } = await createFixture(`
fs.appendFileSync(process.cwd() + '/attempts', 'attempt\\n');
process.stderr.write('No rollout found for thread id ${SESSION_ID}');
process.exitCode = 1;
`);
    await expect(
      runCodexWebSearch({ ...options, resumeSessionId: SESSION_ID }),
    ).rejects.toMatchObject({ code: 'no_prior_search' });
    expect(await fs.readFile(path.join(root, 'workspace', 'attempts'), 'utf8')).toBe('attempt\n');
  });

  it('stops a process that exceeds the bounded stdout limit', async () => {
    const { options } = await createFixture(`
process.stdout.write('x'.repeat(2_000_001));
setInterval(() => {}, 1_000);
`);
    await expect(runCodexWebSearch(options)).rejects.toMatchObject({
      code: 'execution_failed',
      message: expect.stringMatching(/output limit/),
    });
  });

  it('honors a pre-aborted call before spawning or resolving the executable', async () => {
    const { root, options } = await createFixture('emitAnswer();');
    const controller = new AbortController();
    controller.abort();
    await expect(
      runCodexWebSearch({ ...options, bin: '/missing/executable', signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(await exists(path.join(root, 'pid'))).toBe(false);
  });

  it('cancels an active owned process and removes it from the CLI registry', async () => {
    const { root, options } = await createFixture(`
fs.writeFileSync(process.cwd() + '/ready', 'ready');
setInterval(() => {}, 1_000);
`);
    const controller = new AbortController();
    const running = runCodexWebSearch({ ...options, signal: controller.signal });
    const rejected = expect(running).rejects.toMatchObject({ code: 'cancelled' });
    await waitUntil(() => exists(path.join(root, 'workspace', 'ready')));
    expect(getActiveCliProcessCount()).toBe(1);
    controller.abort();
    await rejected;
    expect(getActiveCliProcessCount()).toBe(0);
  });

  it('enforces a real process timeout with a speakable error', async () => {
    const { options } = await createFixture('setInterval(() => {}, 1_000);');
    await expect(runCodexWebSearch({ ...options, timeoutMs: 80 })).rejects.toMatchObject({
      code: 'timeout',
      message: expect.stringMatching(/Research timed out/),
    });
  });

  it.skipIf(process.platform === 'win32')(
    'cleans up a SIGTERM-resistant descendant after the leader exits successfully',
    async () => {
      const { root, options } = await createFixture('');
      const descendantPid = path.join(root, 'descendant-pid');
      const descendant = `
process.on('SIGTERM', () => {});
require('node:fs').writeFileSync(${JSON.stringify(descendantPid)}, String(process.pid));
setInterval(() => {}, 1_000);
`;
      await fs.appendFile(
        options.bin,
        `
const descendant = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' });
descendant.unref();
const ready = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(descendantPid)})) {
    clearInterval(ready);
    emitAnswer();
  }
}, 10);
`,
      );
      await expect(runCodexWebSearch(options)).resolves.toEqual({
        text: 'Research answer.',
        sessionId: SESSION_ID,
      });
      const pid = Number(await fs.readFile(descendantPid, 'utf8'));
      await waitUntil(async () => !(await isRunning(pid)), 4_000);
      expect(getActiveCliProcessCount()).toBe(0);
    },
    7_000,
  );

  it.skipIf(process.platform === 'win32').each(['inherit', 'ignore'] as const)(
    'escalates cancellation across child and grandchild processes with %s pipes',
    async (pipeMode) => {
      const { root, options } = await createFixture('');
      const descendants = path.join(root, 'descendants');
      const stayAlive = `
process.on('SIGTERM', () => {});
require('node:fs').appendFileSync(${JSON.stringify(descendants)}, String(process.pid) + '\\n');
setInterval(() => {}, 1_000);
`;
      const grandchild = stayAlive;
      const child = `${stayAlive}
require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: ['ignore', '${pipeMode}', '${pipeMode}'] });`;
      // Ignored pipes allow the leader's close event before its descendants die.
      // The delayed group SIGKILL must survive that earlier close event.
      const leader =
        pipeMode === 'inherit'
          ? stayAlive
          : stayAlive.replace("process.on('SIGTERM', () => {});", '');
      await fs.appendFile(
        options.bin,
        `
${leader}
require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: ['ignore', '${pipeMode}', '${pipeMode}'] });
`,
      );
      const controller = new AbortController();
      const running = runCodexWebSearch({
        ...options,
        timeoutMs: 8_000,
        signal: controller.signal,
      });
      const rejected = expect(running).rejects.toMatchObject({ code: 'cancelled' });
      let pids: number[] = [];
      await waitUntil(async () => {
        if (!(await exists(descendants))) return false;
        pids = (await fs.readFile(descendants, 'utf8')).trim().split('\n').map(Number);
        return pids.length === 3;
      });
      controller.abort();
      await rejected;
      await waitUntil(
        async () => (await Promise.all(pids.map(isRunning))).every((running) => !running),
        4_000,
      );
      expect(getActiveCliProcessCount()).toBe(0);
    },
    10_000,
  );
});
