import { applyToolApprovalPolicy } from '../toolApprovalPolicy';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';
import type {
  createBashTool as createBashToolType,
  createEditTool as createEditToolType,
  createFindTool as createFindToolType,
  createGrepTool as createGrepToolType,
  createLsTool as createLsToolType,
  createReadTool as createReadToolType,
  createWriteTool as createWriteToolType,
} from '@earendil-works/pi-coding-agent';

import type { ToolContext } from './types';
import { CodingToolHost } from './codingToolHost';

type CodingAgentModule = {
  createBashTool: typeof createBashToolType;
  createReadTool: typeof createReadToolType;
  createWriteTool: typeof createWriteToolType;
  createEditTool: typeof createEditToolType;
  createLsTool: typeof createLsToolType;
  createFindTool: typeof createFindToolType;
  createGrepTool: typeof createGrepToolType;
};

async function loadCodingAgentModule(): Promise<CodingAgentModule> {
  return (await import('@earendil-works/pi-coding-agent')) as CodingAgentModule;
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

describe('CodingToolHost', () => {
  it('keeps approval path normalization aligned with native write and edit tools', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'coding-approval-parity-'));
    try {
      const workspaceRoot = path.join(dataDir, 'workspace');
      const host = new CodingToolHost({
        dataDir,
        pluginConfig: { enabled: true, mode: 'local', local: { workspaceRoot } },
        loadCodingAgentModule,
      });
      const ctx: ToolContext = {
        sessionId: 'path-parity',
        signal: new AbortController().signal,
      };
      const tools = await host.listAgentTools(ctx);
      const nativeWrite = tools.find((tool) => tool.name === 'write')!;
      const nativeEdit = tools.find((tool) => tool.name === 'edit')!;
      const [allowedWrite, allowedEdit] = applyToolApprovalPolicy({
        tools: [nativeWrite, nativeEdit],
        required: ['write', 'edit'],
        writeAllowDirectories: [workspaceRoot],
        context: ctx,
      });
      const forms: Array<(target: string) => string> = [
        (target) => target,
        (target) => path.relative(workspaceRoot, target),
        (target) => `~/${path.relative(os.homedir(), target)}`,
        (target) => `@${target}`,
        (target) => pathToFileURL(target).href,
        (target) => target.replace('file name', 'file\u202fname'),
        (target) => `unused/../${path.basename(target)}`,
      ];

      for (const [index, form] of forms.entries()) {
        const target = path.join(workspaceRoot, `file name-${index}.txt`);
        const args = { path: form(target), content: 'before' };
        // Establish the real native tool's destination, then verify the same call
        // bypasses approval and edits that file without an interactive session.
        await nativeWrite.execute(`native-${index}`, args, ctx.signal);
        expect(await fs.readFile(target, 'utf8')).toBe('before');
        await allowedWrite!.execute(`allowed-write-${index}`, args, ctx.signal);
        await allowedEdit!.execute(
          `allowed-edit-${index}`,
          { path: args.path, edits: [{ oldText: 'before', newText: 'after' }] },
          ctx.signal,
        );
        expect(await fs.readFile(target, 'utf8')).toBe('after');
      }

      // A traversing relative path still points outside the allowed directory
      // for both the native tool and the approval policy.
      const outside = { path: '../outside.txt', content: 'outside' };
      await nativeWrite.execute('native-outside', outside, ctx.signal);
      expect(await fs.readFile(path.join(dataDir, 'outside.txt'), 'utf8')).toBe('outside');
      await expect(allowedWrite!.execute('blocked-write', outside)).rejects.toMatchObject({
        code: 'interaction_unavailable',
      });
      await expect(
        allowedEdit!.execute('blocked-edit', {
          path: outside.path,
          edits: [{ oldText: 'outside', newText: 'changed' }],
        }),
      ).rejects.toMatchObject({ code: 'interaction_unavailable' });
      expect(await fs.readFile(path.join(dataDir, 'outside.txt'), 'utf8')).toBe('outside');
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  }, 15_000);

  it('wires write and read tools through the host', async () => {
    const dataDir = createTempDir('coding-tool-host-tools');

    const host = new CodingToolHost({
      dataDir,
      pluginConfig: {
        enabled: true,
        mode: 'local',
        local: {
          workspaceRoot: path.join(dataDir, 'workspaces'),
        },
      },
      loadCodingAgentModule,
    });

    const ctx: ToolContext = { sessionId: 'coding-session', signal: new AbortController().signal };
    const nativeTools = await host.listAgentTools(ctx);
    const writeTool = nativeTools.find((tool) => tool.name === 'write');
    const readTool = nativeTools.find((tool) => tool.name === 'read');
    const lsTool = nativeTools.find((tool) => tool.name === 'ls');

    if (!writeTool || !readTool || !lsTool) {
      throw new Error('Expected write, read, and ls tools to be registered');
    }

    const content = 'line-one\nline-two';
    const writeResult = await writeTool.execute(
      'call-write',
      { path: 'plugin.txt', content },
      ctx.signal,
    );

    expect(Array.isArray(writeResult.content)).toBe(true);

    const readResult = await readTool.execute('call-read', { path: 'plugin.txt' }, ctx.signal);

    expect(readResult.content[0]?.type).toBe('text');
    expect((readResult.content[0] as { text?: string }).text).toContain('line-one');

    const lsResult = await lsTool.execute('call-ls', {}, ctx.signal);

    expect((lsResult.content[0] as { text?: string }).text).toContain('plugin.txt');
  }, 15_000);

  it('exposes a find tool that searches files relative to the search path', async () => {
    const dataDir = createTempDir('coding-tool-host-find');

    const host = new CodingToolHost({
      dataDir,
      pluginConfig: {
        enabled: true,
        mode: 'local',
        local: {
          workspaceRoot: path.join(dataDir, 'workspaces'),
        },
      },
      loadCodingAgentModule,
    });

    const ctx: ToolContext = {
      sessionId: 'coding-find-session',
      signal: new AbortController().signal,
    };
    const nativeTools = await host.listAgentTools(ctx);
    const writeTool = nativeTools.find((tool) => tool.name === 'write');
    const findTool = nativeTools.find((tool) => tool.name === 'find');

    if (!writeTool || !findTool) {
      throw new Error('Expected write and find tools to be registered');
    }

    await writeTool.execute('write-a', { path: 'src/a.ts', content: 'a' }, ctx.signal);
    await writeTool.execute('write-b', { path: 'src/nested/b.ts', content: 'b' }, ctx.signal);
    await writeTool.execute('write-c', { path: 'notes/readme.md', content: 'ignore' }, ctx.signal);

    const result = await findTool.execute(
      'find-ts',
      { pattern: '**/*.ts', path: 'src' },
      ctx.signal,
    );
    const text = (result.content[0] as { text?: string }).text ?? '';

    expect(text).toContain('a.ts');
    expect(text).toContain('nested/b.ts');
  });

  it('aborts bash tool execution when context signal aborts', async () => {
    const dataDir = createTempDir('coding-tool-host-bash-abort');

    const host = new CodingToolHost({
      dataDir,
      pluginConfig: {
        enabled: true,
        mode: 'local',
        local: {
          workspaceRoot: path.join(dataDir, 'workspaces'),
        },
      },
      loadCodingAgentModule,
    });

    const nativeTools = await host.listAgentTools({
      sessionId: 'coding-bash-abort-session',
      signal: new AbortController().signal,
    });
    const bashTool = nativeTools.find((tool) => tool.name === 'bash');
    if (!bashTool) {
      throw new Error('Expected bash tool to be registered');
    }

    const abortController = new AbortController();
    const ctx: ToolContext = {
      sessionId: 'coding-bash-abort-session',
      signal: abortController.signal,
    };

    const promise = bashTool.execute(
      'abort-call',
      { command: 'node -e "setTimeout(() => {}, 100000)"' },
      ctx.signal,
    );

    abortController.abort();

    await expect(promise).rejects.toThrow(/aborted/i);
  });

  it('uses session working dir for local-mode relative file tools and bash when configured with the macro', async () => {
    const dataDir = createTempDir('coding-tool-host-session-cwd');
    const sessionWorkingDir = path.join(dataDir, 'picked-worktree');
    const outsidePath = path.join(dataDir, 'outside.txt');

    const host = new CodingToolHost({
      dataDir,
      pluginConfig: {
        enabled: true,
        mode: 'local',
        local: {
          workspaceRoot: '${session.workingDir}',
        },
      },
      loadCodingAgentModule,
    });

    const sessionSummary = {
      sessionId: 'coding-session',
      title: 'Coding Session',
      createdAt: '',
      updatedAt: '',
      deleted: false,
      attributes: {
        core: { workingDir: sessionWorkingDir },
      },
    };

    const ctx: ToolContext = {
      sessionId: 'coding-session',
      signal: new AbortController().signal,
      sessionHub: {
        getSessionState: () => ({ summary: sessionSummary, chatMessages: [], messageQueue: [] }),
        ensureSessionState: async () => ({
          summary: sessionSummary,
          chatMessages: [],
          messageQueue: [],
        }),
      } as never,
    };

    const nativeTools = await host.listAgentTools(ctx);
    const writeTool = nativeTools.find((tool) => tool.name === 'write');
    const readTool = nativeTools.find((tool) => tool.name === 'read');
    const bashTool = nativeTools.find((tool) => tool.name === 'bash');

    if (!writeTool || !readTool || !bashTool) {
      throw new Error('Expected write, read, and bash tools to be registered');
    }

    const [approvedWriteTool] = applyToolApprovalPolicy({
      tools: [writeTool],
      required: ['write'],
      writeAllowDirectories: [sessionWorkingDir],
      context: ctx,
    });
    await approvedWriteTool!.execute(
      'relative-write',
      { path: 'relative.txt', content: 'relative file' },
      ctx.signal,
    );
    const readRelative = await readTool.execute(
      'relative-read',
      { path: 'relative.txt' },
      ctx.signal,
    );
    const bashPwd = await bashTool.execute('pwd-call', { command: 'pwd' }, ctx.signal);

    await writeTool.execute(
      'outside-write',
      { path: outsidePath, content: 'outside file' },
      ctx.signal,
    );
    const outsideContent = await fs.readFile(outsidePath, 'utf8');

    expect(readRelative.content[0]?.type).toBe('text');
    expect((readRelative.content[0] as { text?: string }).text).toContain('relative file');
    expect(await fs.readFile(path.join(sessionWorkingDir, 'relative.txt'), 'utf8')).toBe(
      'relative file',
    );
    expect(
      (bashPwd.details as { fullOutputPath?: string } | undefined)?.fullOutputPath,
    ).toBeUndefined();
    expect((bashPwd.content[0] as { text?: string }).text?.trim().split('\n')[0]).toBe(
      sessionWorkingDir,
    );
    expect(outsideContent).toBe('outside file');
  });

  it('uses the fallback workspace for realtime voice tool contexts', async () => {
    const dataDir = createTempDir('coding-tool-host-realtime');
    const fallbackWorkspace = path.join(dataDir, 'coding-workspaces');
    const host = new CodingToolHost({
      dataDir,
      pluginConfig: {
        enabled: true,
        mode: 'local',
        local: {
          workspaceRoot: '${session.workingDir}',
        },
      },
      loadCodingAgentModule,
    });

    const ctx: ToolContext = {
      sessionId: 'voice:conversation-id',
      signal: new AbortController().signal,
      sessionHub: {
        getSessionState: () => undefined,
        ensureSessionState: async () => {
          throw new Error('Session not found: voice:conversation-id');
        },
      } as never,
    };

    await host.callTool('write', JSON.stringify({ path: 'voice.txt', content: 'voice file' }), ctx);
    const result = await host.callTool('read', JSON.stringify({ path: 'voice.txt' }), ctx);

    expect(await fs.readFile(path.join(fallbackWorkspace, 'voice.txt'), 'utf8')).toBe('voice file');
    expect((result as { content: Array<{ text?: string }> }).content[0]?.text).toContain(
      'voice file',
    );
  });

  it('rejects unknown tool names through callTool', async () => {
    const dataDir = createTempDir('coding-tool-host-unknown');
    const host = new CodingToolHost({
      dataDir,
      pluginConfig: {
        enabled: true,
        mode: 'local',
      },
      loadCodingAgentModule,
    });

    await expect(
      host.callTool('unknown_tool', '{}', {
        sessionId: 'coding-session',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      code: 'tool_not_found',
      message: 'Tool not found: unknown_tool',
    });
  });
});
