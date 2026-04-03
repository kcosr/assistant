import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import type {
  createBashTool as createBashToolType,
  createEditTool as createEditToolType,
  createFindTool as createFindToolType,
  createGrepTool as createGrepToolType,
  createLsTool as createLsToolType,
  createReadTool as createReadToolType,
  createWriteTool as createWriteToolType,
} from '@mariozechner/pi-coding-agent';

import type { ToolContext } from '../../tools';
import type { PluginConfig } from '../types';
import { createCodingPlugin } from './index';

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
  return (await import('@mariozechner/pi-coding-agent')) as CodingAgentModule;
}

function createTempDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

describe('coding plugin tools', () => {
  it('wires write and read tools through the plugin', async () => {
    const dataDir = createTempDir('coding-plugin-tools');

    const pluginConfig: PluginConfig = {
      enabled: true,
      mode: 'local',
      local: {
        workspaceRoot: path.join(dataDir, 'workspaces'),
      },
    };

    const plugin = createCodingPlugin({ loadCodingAgentModule });
    await plugin.initialize(dataDir, pluginConfig);

    const ctx: ToolContext = { sessionId: 'plugin-session', signal: new AbortController().signal };
    const nativeTools = await plugin.getAgentTools?.(ctx);
    const writeTool = nativeTools?.find((tool) => tool.name === 'write');
    const readTool = nativeTools?.find((tool) => tool.name === 'read');
    const lsTool = nativeTools?.find((tool) => tool.name === 'ls');

    if (!writeTool || !readTool || !lsTool) {
      throw new Error('Expected write, read, and ls tools to be registered');
    }

    const content = 'line-one\nline-two';
    const writeResult = await writeTool.execute('call-write', { path: 'plugin.txt', content }, ctx.signal);

    expect(Array.isArray(writeResult.content)).toBe(true);

    const readResult = await readTool.execute('call-read', { path: 'plugin.txt' }, ctx.signal);

    expect(readResult.content[0]?.type).toBe('text');
    expect((readResult.content[0] as { text?: string }).text).toContain('line-one');

    const lsResult = await lsTool.execute('call-ls', {}, ctx.signal);

    expect((lsResult.content[0] as { text?: string }).text).toContain('plugin.txt');
  });

  it('exposes a find tool that searches files relative to the search path', async () => {
    const dataDir = createTempDir('coding-plugin-find');

    const pluginConfig: PluginConfig = {
      enabled: true,
      mode: 'local',
      local: {
        workspaceRoot: path.join(dataDir, 'workspaces'),
      },
    };

    const plugin = createCodingPlugin({ loadCodingAgentModule });
    await plugin.initialize(dataDir, pluginConfig);

    const ctx: ToolContext = {
      sessionId: 'plugin-find-session',
      signal: new AbortController().signal,
    };
    const nativeTools = await plugin.getAgentTools?.(ctx);
    const writeTool = nativeTools?.find((tool) => tool.name === 'write');
    const findTool = nativeTools?.find((tool) => tool.name === 'find');

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
    const dataDir = createTempDir('coding-plugin-bash-abort');

    const pluginConfig: PluginConfig = {
      enabled: true,
      mode: 'local',
      local: {
        workspaceRoot: path.join(dataDir, 'workspaces'),
      },
    };

    const plugin = createCodingPlugin({ loadCodingAgentModule });
    await plugin.initialize(dataDir, pluginConfig);

    const nativeTools = await plugin.getAgentTools?.({
      sessionId: 'plugin-bash-abort-session',
      signal: new AbortController().signal,
    });
    const bashTool = nativeTools?.find((tool) => tool.name === 'bash');
    if (!bashTool) {
      throw new Error('Expected bash tool to be registered');
    }

    const abortController = new AbortController();
    const ctx: ToolContext = {
      sessionId: 'plugin-bash-abort-session',
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
    const dataDir = createTempDir('coding-plugin-session-cwd');
    const sessionWorkingDir = path.join(dataDir, 'picked-worktree');
    const outsidePath = path.join(dataDir, 'outside.txt');

    const pluginConfig: PluginConfig = {
      enabled: true,
      mode: 'local',
      local: {
        workspaceRoot: '${session.workingDir}',
      },
    };

    const plugin = createCodingPlugin({ loadCodingAgentModule });
    await plugin.initialize(dataDir, pluginConfig);

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

    const nativeTools = await plugin.getAgentTools?.(ctx);
    const writeTool = nativeTools?.find((tool) => tool.name === 'write');
    const readTool = nativeTools?.find((tool) => tool.name === 'read');
    const bashTool = nativeTools?.find((tool) => tool.name === 'bash');

    if (!writeTool || !readTool || !bashTool) {
      throw new Error('Expected write, read, and bash tools to be registered');
    }

    await writeTool.execute('relative-write', { path: 'relative.txt', content: 'relative file' }, ctx.signal);
    const readRelative = await readTool.execute('relative-read', { path: 'relative.txt' }, ctx.signal);
    const bashPwd = await bashTool.execute('pwd-call', { command: 'pwd' }, ctx.signal);

    await writeTool.execute('outside-write', { path: outsidePath, content: 'outside file' }, ctx.signal);
    const outsideContent = await fs.readFile(outsidePath, 'utf8');

    expect(readRelative.content[0]?.type).toBe('text');
    expect((readRelative.content[0] as { text?: string }).text).toContain('relative file');
    expect(await fs.readFile(path.join(sessionWorkingDir, 'relative.txt'), 'utf8')).toBe(
      'relative file',
    );
    expect((bashPwd.details as { fullOutputPath?: string } | undefined)?.fullOutputPath).toBeUndefined();
    expect((bashPwd.content[0] as { text?: string }).text?.trim().split('\n')[0]).toBe(sessionWorkingDir);
    expect(outsideContent).toBe('outside file');
  });
});
