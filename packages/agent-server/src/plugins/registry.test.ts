import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../config';
import type { ToolContext } from '../tools/types';
import { DefaultPluginRegistry, PluginToolHost } from './registry';
import type { ToolPlugin } from './types';

function createTempDataDir(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}`);
}

async function createTempPluginPackage(): Promise<string> {
  const root = createTempDataDir('plugin-fixture');
  await fs.mkdir(root, { recursive: true });

  const manifest = {
    id: 'fixture',
    version: '0.1.0',
    description: 'Fixture plugin for registry tests.',
    surfaces: { tool: true, http: true, cli: false },
    operations: [
      {
        id: 'echo',
        summary: 'Echo text.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to echo.' },
          },
          required: ['text'],
        },
      },
    ],
  };

  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const serverJs = `
module.exports = async function createPlugin() {
  return {
    operations: {
      echo: async (args) => ({ text: args.text }),
    },
  };
};
`;

  await fs.writeFile(path.join(root, 'server.js'), serverJs, 'utf8');

  return root;
}

describe('DefaultPluginRegistry', () => {
  it('initialises enabled plugins and exposes tools', async () => {
    const dataDir = createTempDataDir('plugin-registry');
    const pluginRoot = await createTempPluginPackage();

    const config: AppConfig = {
      agents: [],
      plugins: {
        fixture: { enabled: true, source: { path: pluginRoot } },
      },
      mcpServers: [],
    };

    const registry = new DefaultPluginRegistry();
    await registry.initialize(config, dataDir);

    const tools = registry.getTools();
    const toolNames = tools.map((tool) => tool.name).sort();

    expect(toolNames).toContain('fixture_echo');
    await registry.shutdown();
  });

  it('does not enable plugins when no plugin config entries are provided', async () => {
    const dataDir = createTempDataDir('plugin-registry-defaults');

    const config: AppConfig = {
      agents: [],
      plugins: {},
      mcpServers: [],
    };

    const registry = new DefaultPluginRegistry();
    await registry.initialize(config, dataDir);

    const manifests = registry.getManifests();
    expect(manifests).toEqual([]);

    await registry.shutdown();
  });

  it('logs a consolidated warning for plugin config issues', async () => {
    const dataDir = createTempDataDir('plugin-registry-warnings');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const registry = new DefaultPluginRegistry();
    const factories = (registry as unknown as { factories: Map<string, () => ToolPlugin> })
      .factories;
    factories.set('custom', () => ({
      name: 'custom',
      manifest: {
        id: 'custom',
        version: '0.1.0',
        panels: [{ type: 'custom', title: 'Custom Panel' }],
      },
      tools: [],
      async initialize(): Promise<void> {},
    }));

    const config: AppConfig = {
      agents: [],
      plugins: {
        lists: { enabled: false },
        notes: { enabled: false },
        unknown: { enabled: true },
        custom: { enabled: true },
      },
      mcpServers: [],
    };

    await registry.initialize(config, dataDir);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0];
    expect(message).toContain('Unknown plugins in config: unknown');
    expect(message).toContain(
      'Plugin "custom" defines panels (custom) but does not declare web.bundlePath.',
    );

    warnSpy.mockRestore();
    await registry.shutdown();
  });

  it('reports invalid plugin manifests in config warnings', async () => {
    const dataDir = createTempDataDir('plugin-registry-manifest-invalid');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const registry = new DefaultPluginRegistry();
    const factories = (registry as unknown as { factories: Map<string, () => ToolPlugin> })
      .factories;
    factories.set('broken', () => ({
      name: 'broken',
      manifest: {
        id: '',
        version: '',
        panels: [{ type: '', title: '' }],
      } as CombinedPluginManifest,
      tools: [],
      async initialize(): Promise<void> {},
    }));

    const config: AppConfig = {
      agents: [],
      plugins: {
        broken: { enabled: true },
      },
      mcpServers: [],
    };

    await registry.initialize(config, dataDir);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0];
    expect(message).toContain('manifest is invalid');
    expect(message).toContain('version');
    expect(message).toContain('panels');

    warnSpy.mockRestore();
    await registry.shutdown();
  });
});

describe('PluginToolHost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes plugin tools via ToolHost and delegates calls', async () => {
    const dataDir = createTempDataDir('plugin-tool-host');
    const pluginRoot = await createTempPluginPackage();

    const config: AppConfig = {
      agents: [],
      plugins: {
        fixture: { enabled: true, source: { path: pluginRoot } },
      },
      mcpServers: [],
    };

    const registry = new DefaultPluginRegistry();
    await registry.initialize(config, dataDir);

    const host = new PluginToolHost(registry);

    const tools = await host.listTools();
    expect(tools).toHaveLength(1);

    const [tool] = tools;
    expect(tool?.name).toBe('fixture_echo');
    expect(tool?.description).toMatch(/Echo text/i);

    const ctx: ToolContext = {
      sessionId: 'fixture-session',
      signal: new AbortController().signal,
    };
    const result = (await host.callTool(
      'fixture_echo',
      JSON.stringify({ text: 'hello' }),
      ctx,
    )) as { text?: string };

    expect(result.text).toBe('hello');

    await registry.shutdown();
  });
});
