import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ToolContext } from '../../tools';
import type { PluginConfig } from '../types';
import { createCodingPlugin } from './index';

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

    const plugin = createCodingPlugin();
    await plugin.initialize(dataDir, pluginConfig);

    const writeTool = plugin.tools.find((tool) => tool.name === 'write');
    const readTool = plugin.tools.find((tool) => tool.name === 'read');
    const lsTool = plugin.tools.find((tool) => tool.name === 'ls');

    if (!writeTool || !readTool || !lsTool) {
      throw new Error('Expected write, read, and ls tools to be registered');
    }

    const ctx: ToolContext = { sessionId: 'plugin-session', signal: new AbortController().signal };

    const content = 'line-one\nline-two';
    const writeResult = (await writeTool.handler({ path: 'plugin.txt', content }, ctx)) as {
      ok?: boolean;
    };

    expect(writeResult.ok).toBe(true);

    const readResult = (await readTool.handler({ path: 'plugin.txt' }, ctx)) as {
      type?: string;
      content?: string;
    };

    expect(readResult.type).toBe('text');
    expect(readResult.content).toContain('line-one');

    const lsResult = (await lsTool.handler({}, ctx)) as {
      output?: string;
    };

    expect(typeof lsResult.output).toBe('string');
    expect(lsResult.output).toContain('plugin.txt');
  });

  it('initializes in sidecar mode when configured', async () => {
    const dataDir = createTempDir('coding-plugin-sidecar');

    const pluginConfig: PluginConfig = {
      enabled: true,
      mode: 'sidecar',
      sidecar: {
        socketPath: '/var/run/assistant/coding-sidecar.sock',
      },
    };

    const plugin = createCodingPlugin();
    await plugin.initialize(dataDir, pluginConfig);

    expect(plugin.name).toBe('coding');
    expect(plugin.tools.length).toBeGreaterThan(0);
    expect(plugin.tools.find((tool) => tool.name === 'grep')).toBeDefined();
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

    const plugin = createCodingPlugin();
    await plugin.initialize(dataDir, pluginConfig);

    const writeTool = plugin.tools.find((tool) => tool.name === 'write');
    const findTool = plugin.tools.find((tool) => tool.name === 'find');

    if (!writeTool || !findTool) {
      throw new Error('Expected write and find tools to be registered');
    }

    const ctx: ToolContext = {
      sessionId: 'plugin-find-session',
      signal: new AbortController().signal,
    };

    await writeTool.handler({ path: 'src/a.ts', content: 'a' }, ctx);
    await writeTool.handler({ path: 'src/nested/b.ts', content: 'b' }, ctx);
    await writeTool.handler({ path: 'notes/readme.md', content: 'ignore' }, ctx);

    const result = (await findTool.handler({ pattern: '**/*.ts', path: 'src' }, ctx)) as {
      files?: string[];
    };

    expect(Array.isArray(result.files)).toBe(true);
    expect(result.files).toContain('a.ts');
    expect(result.files).toContain('nested/b.ts');
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

    const plugin = createCodingPlugin();
    await plugin.initialize(dataDir, pluginConfig);

    const bashTool = plugin.tools.find((tool) => tool.name === 'bash');
    if (!bashTool) {
      throw new Error('Expected bash tool to be registered');
    }

    const abortController = new AbortController();
    const ctx: ToolContext = {
      sessionId: 'plugin-bash-abort-session',
      signal: abortController.signal,
    };

    const promise = bashTool.handler({ command: 'node -e "setTimeout(() => {}, 100000)"' }, ctx);

    abortController.abort();

    await expect(promise).rejects.toMatchObject({
      code: 'tool_aborted',
      message: 'Tool execution aborted',
    });
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
        allowOutsideWorkspaceRoot: true,
      },
    };

    const plugin = createCodingPlugin();
    await plugin.initialize(dataDir, pluginConfig);

    const writeTool = plugin.tools.find((tool) => tool.name === 'write');
    const readTool = plugin.tools.find((tool) => tool.name === 'read');
    const bashTool = plugin.tools.find((tool) => tool.name === 'bash');

    if (!writeTool || !readTool || !bashTool) {
      throw new Error('Expected write, read, and bash tools to be registered');
    }

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

    await writeTool.handler({ path: 'relative.txt', content: 'relative file' }, ctx);
    const readRelative = (await readTool.handler({ path: 'relative.txt' }, ctx)) as {
      type?: string;
      content?: string;
    };
    const bashPwd = (await bashTool.handler({ command: 'pwd' }, ctx)) as {
      exitCode?: number;
      output?: string;
    };

    await writeTool.handler({ path: outsidePath, content: 'outside file' }, ctx);
    const outsideContent = await fs.readFile(outsidePath, 'utf8');

    expect(readRelative.type).toBe('text');
    expect(readRelative.content).toContain('relative file');
    expect(await fs.readFile(path.join(sessionWorkingDir, 'relative.txt'), 'utf8')).toBe(
      'relative file',
    );
    expect(bashPwd.exitCode).toBe(0);
    expect(bashPwd.output?.trim().split('\n')[0]).toBe(sessionWorkingDir);
    expect(outsideContent).toBe('outside file');
  });
});
