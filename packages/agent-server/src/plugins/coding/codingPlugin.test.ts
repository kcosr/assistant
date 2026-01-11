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

  it('initializes in container mode when configured', async () => {
    const dataDir = createTempDir('coding-plugin-container');

    const pluginConfig: PluginConfig = {
      enabled: true,
      mode: 'container',
      container: {
        image: 'ghcr.io/example/assistant-sidecar:latest',
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
});
