import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolError } from './errors';
import type { CodexThreadsToolConfig, ToolContext } from './types';
import {
  CODEX_THREADS_BOUNDS,
  CODEX_THREADS_TOOL_NAMES,
  createCodexThreadsToolDefinitions,
  type CodexThreadsRunner,
} from './codexThreads';

const tempDirs: string[] = [];

function makeConfig(overrides: Partial<CodexThreadsToolConfig> = {}): CodexThreadsToolConfig {
  return {
    allowedServers: ['main'],
    binary: 'codex-threads',
    permissionMode: 'app-server-default',
    allowedCwdRoots: [],
    ...overrides,
  };
}

function makeContext(): ToolContext {
  return {
    sessionId: 'session-1',
    signal: new AbortController().signal,
  };
}

function success(output: unknown) {
  return {
    exitCode: 0,
    stdout: JSON.stringify(output),
    stderr: '',
    timedOut: false,
    aborted: false,
    outputTooLarge: false,
  };
}

function queuedRunner(outputs: unknown[]) {
  const queue = [...outputs];
  const runner = vi.fn<CodexThreadsRunner>(async () => success(queue.shift()));
  return runner;
}

function definitions(config: CodexThreadsToolConfig | undefined, runner: CodexThreadsRunner) {
  return new Map(
    createCodexThreadsToolDefinitions(config, runner).map((tool) => [tool.name, tool]),
  );
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    }),
  );
});

describe('Codex Threads tool definitions', () => {
  it('uses expanded bounded transcript and process output ceilings', () => {
    expect(CODEX_THREADS_BOUNDS).toMatchObject({
      maxMessageChars: 64_000,
      maxTranscriptChars: 256_000,
      maxFinalResponseChars: 64_000,
      maxStdoutBytes: 4_000_000,
    });
  });

  it('registers a stable bounded read/write tool family', () => {
    const tools = createCodexThreadsToolDefinitions(undefined, queuedRunner([]));
    expect(tools.map((tool) => tool.name)).toEqual(Object.values(CODEX_THREADS_TOOL_NAMES));
    expect(tools.filter((tool) => tool.capabilities?.includes('codex_threads.read'))).toHaveLength(
      4,
    );
    expect(tools.filter((tool) => tool.capabilities?.includes('codex_threads.write'))).toHaveLength(
      4,
    );
  });

  it('requires a host-allowed server on every tool schema', () => {
    const tools = createCodexThreadsToolDefinitions(makeConfig(), queuedRunner([]));
    for (const tool of tools) {
      const schema = tool.parameters as {
        properties?: Record<string, { enum?: string[] }>;
        required?: string[];
      };
      expect(schema.required).toContain('server');
      expect(schema.properties?.['server']?.enum).toEqual(['main']);
    }
  });

  it('keeps tools registered but returns a clear error when unconfigured', async () => {
    const tool = definitions(undefined, queuedRunner([])).get(CODEX_THREADS_TOOL_NAMES.list)!;
    await expect(tool.handler({}, makeContext())).rejects.toMatchObject({
      code: 'not_configured',
    });
  });
});

describe('Codex Threads read tools', () => {
  it('lists recent updated-desc threads and projects status plus cwd', async () => {
    const runner = queuedRunner([
      {
        threads: [
          {
            id: 'thread-1',
            name: 'Tool design',
            cwd: '/home/kevin/worktrees/assistant',
            preview: 'Build a bounded integration',
            status: { type: 'active', activeFlags: ['waiting'] },
            updatedAt: 1_784_670_402,
            path: '/secret/rollout.jsonl',
            gitInfo: { originUrl: 'private' },
          },
        ],
        nextCursor: 'more',
      },
    ]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.list)!;
    const result = (await tool.handler(
      { server: 'main', updatedWithinHours: 48, limit: 1 },
      makeContext(),
    )) as Record<string, unknown>;

    const invocation = runner.mock.calls[0]![0];
    expect(invocation.args).toEqual([
      '--no-yolo',
      'list',
      '--limit',
      '1',
      '--since',
      '48h',
      '--sort',
      'updated',
      '--desc',
      '--server',
      'main',
      '--json',
    ]);
    expect(result).toMatchObject({
      server: 'main',
      updatedWithinHours: 48,
      truncated: true,
      threads: [
        {
          threadId: 'thread-1',
          cwd: '/home/kevin/worktrees/assistant',
          project: 'assistant',
          status: 'active',
          activeFlags: ['waiting'],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('rollout');
    expect(JSON.stringify(result)).not.toContain('originUrl');
  });

  it('finds bounded recent metadata without invoking CLI full-text search', async () => {
    const runner = queuedRunner([
      {
        threads: [
          {
            id: 'a',
            cwd: '/work/assistant',
            name: 'Codex thread tools',
            preview: 'Implement recent metadata lookup',
            status: { type: 'idle' },
            updatedAt: 200,
          },
          {
            id: 'b',
            cwd: '/work/other',
            preview: 'Unrelated task',
            status: { type: 'idle' },
            updatedAt: 100,
          },
        ],
        nextCursor: null,
      },
    ]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.find)!;
    const result = await tool.handler({ server: 'main', query: 'codex tools' }, makeContext());

    expect(runner.mock.calls[0]![0].args).toContain('list');
    expect(runner.mock.calls[0]![0].args).not.toContain('search');
    expect(result).toMatchObject({
      server: 'main',
      matches: [{ threadId: 'a', matchedFields: expect.arrayContaining(['name']) }],
      truncated: false,
    });
  });

  it('loads focused status and reports the active turn', async () => {
    const runner = queuedRunner([
      {
        thread: {
          id: 'thread-1',
          cwd: '/work/a',
          status: { type: 'active' },
          updatedAt: 100,
        },
        activeTurnId: 'turn-1',
        truncated: false,
      },
    ]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.status)!;
    const result = await tool.handler({ server: 'main', threadId: 'thread-1' }, makeContext());
    expect(runner.mock.calls[0]![0].args).toEqual([
      '--no-yolo',
      'status',
      'thread-1',
      '--load',
      '--server',
      'main',
      '--json',
    ]);
    expect(result).toMatchObject({ server: 'main', active: true, activeTurnId: 'turn-1' });
  });

  it('bounds transcript scan, final messages, and returned text', async () => {
    const longText = 'x'.repeat(CODEX_THREADS_BOUNDS.maxMessageChars + 500);
    const runner = queuedRunner([
      {
        messages: Array.from({ length: 12 }, (_, index) => ({
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: longText,
          turnId: `turn-${index}`,
          turnStartedAt: 100 + index,
        })),
        truncated: true,
      },
    ]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.messages)!;
    const result = (await tool.handler(
      { server: 'main', threadId: 'thread-1', last: 12, role: 'assistant' },
      makeContext(),
    )) as { messages: Array<{ text: string }>; textTruncated: boolean };
    const args = runner.mock.calls[0]![0].args;
    expect(args).toContain('--last');
    expect(args[args.indexOf('--last') + 1]).toBe('12');
    expect(args).toContain('--max-turns');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('50');
    expect(args).toContain('--role');
    expect(result.textTruncated).toBe(true);
    expect(
      result.messages.reduce((sum, message) => sum + message.text.length, 0),
    ).toBeLessThanOrEqual(CODEX_THREADS_BOUNDS.maxTranscriptChars);
    expect(
      result.messages.every(
        (message) => message.text.length <= CODEX_THREADS_BOUNDS.maxMessageChars,
      ),
    ).toBe(true);
  });

  it('rejects missing or disallowed server selection before invoking the CLI', async () => {
    const runner = queuedRunner([]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.status)!;

    await expect(tool.handler({ threadId: 'thread-1' }, makeContext())).rejects.toMatchObject({
      code: 'invalid_arguments',
    });
    await expect(
      tool.handler({ server: 'work', threadId: 'thread-1' }, makeContext()),
    ).rejects.toMatchObject({ code: 'server_not_allowed' });
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('Codex Threads write tools', () => {
  it('queues a send without prechecking or rejecting an active thread', async () => {
    const runner = queuedRunner([
      { threadId: 'thread-1', turnId: 'turn-queued', status: 'accepted' },
    ]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.send)!;
    const result = await tool.handler(
      { server: 'main', threadId: 'thread-1', message: 'Queue this' },
      makeContext(),
    );

    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]![0].args).toContain('--no-wait');
    expect(result).toMatchObject({ status: 'accepted', turnId: 'turn-queued' });
  });

  it('sends without waiting by default', async () => {
    const runner = queuedRunner([{ threadId: 'thread-1', turnId: 'turn-new', status: 'accepted' }]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.send)!;
    const result = await tool.handler(
      { server: 'main', threadId: 'thread-1', message: 'Follow up' },
      makeContext(),
    );
    expect(runner.mock.calls[0]![0].args).toEqual([
      '--no-yolo',
      'send',
      'thread-1',
      'Follow up',
      '--no-wait',
      '--server',
      'main',
      '--json',
    ]);
    expect(result).toEqual({
      server: 'main',
      status: 'accepted',
      threadId: 'thread-1',
      turnId: 'turn-new',
    });
  });

  it('rejects a send response that does not confirm an accepted turn', async () => {
    const runner = queuedRunner([{ threadId: 'thread-1', status: 'accepted' }]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.send)!;

    await expect(
      tool.handler({ server: 'main', threadId: 'thread-1', message: 'Follow up' }, makeContext()),
    ).rejects.toMatchObject({ code: 'execution_failed' });
  });

  it('waits up to 120 seconds and projects bounded terminal assistant text', async () => {
    const longText = 'x'.repeat(CODEX_THREADS_BOUNDS.maxFinalResponseChars + 100);
    const runner = vi.fn<CodexThreadsRunner>(async () => ({
      exitCode: 0,
      stdout: [
        JSON.stringify({
          type: 'accepted',
          server: 'main',
          threadId: 'thread-1',
          turnId: 'turn-wait',
          status: 'accepted',
        }),
        JSON.stringify({
          server: 'main',
          threadId: 'thread-1',
          turnId: 'turn-wait',
          status: 'completed',
          finalAssistantText: longText,
        }),
      ].join('\n'),
      stderr: '',
      timedOut: false,
      aborted: false,
      outputTooLarge: false,
    }));
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.send)!;
    const result = (await tool.handler(
      { server: 'main', threadId: 'thread-1', message: 'Wait for this', wait: true },
      makeContext(),
    )) as { finalAssistantText: string; textTruncated: boolean };

    expect(runner.mock.calls[0]![0]).toMatchObject({ timeoutMs: 120_000 });
    expect(runner.mock.calls[0]![0].args).toContain('--stream');
    expect(runner.mock.calls[0]![0].args).not.toContain('--no-wait');
    expect(result.finalAssistantText.length).toBe(CODEX_THREADS_BOUNDS.maxFinalResponseChars);
    expect(result.textTruncated).toBe(true);
  });

  it('returns pending identifiers when the 120-second local wait expires', async () => {
    const runner = vi.fn<CodexThreadsRunner>(async () => ({
      exitCode: null,
      stdout: `${JSON.stringify({
        type: 'accepted',
        threadId: 'thread-1',
        turnId: 'turn-pending',
        status: 'accepted',
      })}\n`,
      stderr: '',
      timedOut: true,
      aborted: false,
      outputTooLarge: false,
    }));
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.send)!;

    await expect(
      tool.handler(
        { server: 'main', threadId: 'thread-1', message: 'Long task', wait: true },
        makeContext(),
      ),
    ).resolves.toMatchObject({
      server: 'main',
      status: 'pending',
      threadId: 'thread-1',
      turnId: 'turn-pending',
      waitTimedOut: true,
    });
  });

  it('keeps accepted identifiers when the bounded stream ends on a partial line', async () => {
    const runner = vi.fn<CodexThreadsRunner>(async () => ({
      exitCode: null,
      stdout: `${JSON.stringify({
        type: 'accepted',
        threadId: 'thread-1',
        turnId: 'turn-limited',
        status: 'accepted',
      })}\n{"type":"progress"`,
      stderr: '',
      timedOut: false,
      aborted: false,
      outputTooLarge: true,
    }));
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.send)!;

    await expect(
      tool.handler(
        { server: 'main', threadId: 'thread-1', message: 'Verbose task', wait: true },
        makeContext(),
      ),
    ).resolves.toMatchObject({
      status: 'pending',
      turnId: 'turn-limited',
      outputLimitReached: true,
    });
  });

  it('steers the exact active turn', async () => {
    const runner = queuedRunner([
      { threadId: 'thread-1', turnId: 'turn-active', status: 'accepted' },
    ]);
    const tool = definitions(makeConfig(), runner).get(CODEX_THREADS_TOOL_NAMES.steer)!;
    const result = await tool.handler(
      {
        server: 'main',
        threadId: 'thread-1',
        turnId: 'turn-active',
        message: 'Focus on the tests',
      },
      makeContext(),
    );

    expect(runner.mock.calls[0]![0].args).toEqual([
      '--no-yolo',
      'steer',
      'thread-1',
      'turn-active',
      'Focus on the tests',
      '--server',
      'main',
      '--json',
    ]);
    expect(result).toEqual({
      server: 'main',
      status: 'accepted',
      threadId: 'thread-1',
      turnId: 'turn-active',
    });
  });

  it('creates, names, and starts a thread inside an allowed root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-threads-root-'));
    tempDirs.push(root);
    const cwd = path.join(root, 'project');
    await fs.mkdir(cwd);
    const runner = queuedRunner([
      { threadId: 'thread-new' },
      { threadId: 'thread-new', name: 'Readable', status: 'accepted' },
      { threadId: 'thread-new', turnId: 'turn-new', status: 'accepted' },
    ]);
    const tool = definitions(makeConfig({ allowedCwdRoots: [root] }), runner).get(
      CODEX_THREADS_TOOL_NAMES.create,
    )!;
    const result = await tool.handler(
      { server: 'main', cwd, prompt: 'Implement the task', name: 'Readable' },
      makeContext(),
    );

    expect(runner.mock.calls.map((call) => call[0].args[1])).toEqual(['new', 'name', 'send']);
    expect(runner.mock.calls[2]![0].args).toContain('--no-wait');
    expect(result).toEqual({
      server: 'main',
      status: 'accepted',
      threadId: 'thread-new',
      turnId: 'turn-new',
      nameRequested: true,
      nameSet: true,
      promptAccepted: true,
    });
  });

  it('returns the created id when naming partially fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-threads-partial-'));
    tempDirs.push(root);
    const runner = vi.fn<CodexThreadsRunner>(async (options) => {
      if (options.args.includes('name')) {
        return {
          ...success({}),
          exitCode: 3,
          stderr: 'name failed',
        };
      }
      if (options.args.includes('new')) {
        return success({ threadId: 'thread-partial' });
      }
      return success({ threadId: 'thread-partial', turnId: 'turn-1', status: 'accepted' });
    });
    const tool = definitions(makeConfig({ allowedCwdRoots: [root] }), runner).get(
      CODEX_THREADS_TOOL_NAMES.create,
    )!;
    const result = await tool.handler(
      { server: 'main', cwd: root, prompt: 'Start anyway', name: 'Name' },
      makeContext(),
    );

    expect(result).toMatchObject({
      server: 'main',
      status: 'partial',
      threadId: 'thread-partial',
      nameSet: false,
      promptAccepted: true,
      errors: [{ step: 'name', code: 'execution_failed' }],
    });
  });

  it('rejects create outside configured roots and rejects empty rename', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-threads-allowed-'));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-threads-outside-'));
    tempDirs.push(root, outside);
    const runner = queuedRunner([]);
    const tools = definitions(makeConfig({ allowedCwdRoots: [root] }), runner);

    await expect(
      tools
        .get(CODEX_THREADS_TOOL_NAMES.create)!
        .handler({ server: 'main', cwd: outside, prompt: 'No' }, makeContext()),
    ).rejects.toMatchObject({ code: 'cwd_not_allowed' });
    await expect(
      tools
        .get(CODEX_THREADS_TOOL_NAMES.rename)!
        .handler({ server: 'main', threadId: 'thread-1', name: '  ' }, makeContext()),
    ).rejects.toBeInstanceOf(ToolError);
    expect(runner).not.toHaveBeenCalled();
  });

  it('uses CLI full-access behavior only when host configuration opts in', async () => {
    const runner = queuedRunner([
      {
        thread: { id: 'thread-1', status: { type: 'idle' }, updatedAt: 100 },
        activeTurnId: null,
        truncated: false,
      },
    ]);
    const tool = definitions(makeConfig({ permissionMode: 'full-access' }), runner).get(
      CODEX_THREADS_TOOL_NAMES.status,
    )!;
    await tool.handler({ server: 'main', threadId: 'thread-1' }, makeContext());
    expect(runner.mock.calls[0]![0].args).not.toContain('--no-yolo');
  });
});
