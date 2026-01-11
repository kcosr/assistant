import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';
import { loadConfig } from './config';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.json`);
}

const originalEnv = { ...process.env };

afterEach(() => {
  // Restore environment variables mutated during tests.
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

describe('loadConfig', () => {
  it('loads a valid config file with agents, plugins, and mcpServers', async () => {
    const filePath = createTempFile('config-valid');
    const configJson = {
      agents: [
        {
          agentId: 'reading-list',
          displayName: 'Reading List Manager',
          description: 'Manages a reading list of articles and links.',
          systemPrompt: ' You manage a reading list. ',
          toolAllowlist: ['reading_list_*'],
          toolDenylist: ['reading_list_delete'],
          toolExposure: 'skills',
          skillAllowlist: ['lists'],
          skillDenylist: ['lists-private'],
          capabilityAllowlist: ['lists.*'],
          capabilityDenylist: ['lists.write'],
        },
      ],
      plugins: {
        lists: { enabled: true },
        notes: { enabled: false },
      },
      mcpServers: [
        {
          name: 'github',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
        },
      ],
    };

    process.env['GITHUB_TOKEN'] = 'test-token';

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);

    expect(config.agents).toHaveLength(1);
    const [agent] = config.agents;
    if (!agent) {
      throw new Error('Expected agent to be defined');
    }
    expect(agent.agentId).toBe('reading-list');
    expect(agent.displayName).toBe('Reading List Manager');
    expect(agent.description).toBe('Manages a reading list of articles and links.');
    expect(agent.systemPrompt).toBe('You manage a reading list.');
    expect(agent.toolAllowlist).toEqual(['reading_list_*']);
    expect(agent.toolDenylist).toEqual(['reading_list_delete']);
    expect(agent.toolExposure).toBe('skills');
    expect(agent.skillAllowlist).toEqual(['lists']);
    expect(agent.skillDenylist).toEqual(['lists-private']);
    expect(agent.capabilityAllowlist).toEqual(['lists.*']);
    expect(agent.capabilityDenylist).toEqual(['lists.write']);

    const listsPlugin = config.plugins['lists'];
    const notesPlugin = config.plugins['notes'];
    expect(listsPlugin).toBeDefined();
    expect(listsPlugin?.enabled).toBe(true);
    expect(notesPlugin).toBeDefined();
    expect(notesPlugin?.enabled).toBe(false);

    expect(config.mcpServers).toHaveLength(1);
    const [server] = config.mcpServers;
    if (!server) {
      throw new Error('Expected MCP server to be defined');
    }
    expect(server.name).toBe('github');
    expect(server.command).toBe('npx');
    expect(server.args).toEqual(['-y', '@modelcontextprotocol/server-github']);
    expect(server.env).toEqual({ GITHUB_TOKEN: 'test-token' });
  });

  it('performs env var substitution for multiple variables within a value', async () => {
    const filePath = createTempFile('config-env-substitution');
    const configJson = {
      mcpServers: [
        {
          command: 'my-server',
          env: {
            COMPLEX: 'prefix-${FIRST}-${SECOND}-suffix',
          },
        },
      ],
    };

    process.env['FIRST'] = 'one';
    process.env['SECOND'] = 'two';

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.mcpServers).toHaveLength(1);
    const [server] = config.mcpServers;
    if (!server) {
      throw new Error('Expected MCP server to be defined');
    }
    expect(server.env?.['COMPLEX']).toBe('prefix-one-two-suffix');
  });

  it('parses coding plugin configuration with local workspace root', async () => {
    const filePath = createTempFile('config-coding-plugin');
    const configJson = {
      plugins: {
        coding: {
          enabled: true,
          mode: 'local',
          local: {
            workspaceRoot: '/var/lib/assistant/coding-workspaces',
            sharedWorkspace: true,
          },
        },
      },
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    const codingPlugin = config.plugins['coding'];

    expect(codingPlugin).toBeDefined();
    expect(codingPlugin?.enabled).toBe(true);
    expect(codingPlugin?.mode).toBe('local');
    expect(codingPlugin?.local?.workspaceRoot).toBe('/var/lib/assistant/coding-workspaces');
    expect(codingPlugin?.local?.sharedWorkspace).toBe(true);
  });

  it('parses coding plugin configuration for container mode', async () => {
    const filePath = createTempFile('config-coding-plugin-container');
    const configJson = {
      plugins: {
        coding: {
          enabled: true,
          mode: 'container',
          container: {
            runtime: 'podman',
            socketPath: '/run/user/1000/podman/podman.sock',
            image: 'ghcr.io/example/assistant-sidecar:latest',
            socketDir: '/var/run/assistant',
            workspaceVolume: '/var/lib/assistant/coding-workspaces',
            sharedWorkspace: true,
            resources: {
              memory: '2g',
              cpus: 2,
            },
          },
        },
      },
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    const codingPlugin = config.plugins['coding'];

    expect(codingPlugin).toBeDefined();
    expect(codingPlugin?.enabled).toBe(true);
    expect(codingPlugin?.mode).toBe('container');
    expect(codingPlugin?.container?.runtime).toBe('podman');
    expect(codingPlugin?.container?.socketPath).toBe('/run/user/1000/podman/podman.sock');
    expect(codingPlugin?.container?.image).toBe('ghcr.io/example/assistant-sidecar:latest');
    expect(codingPlugin?.container?.socketDir).toBe('/var/run/assistant');
    expect(codingPlugin?.container?.workspaceVolume).toBe(
      '/var/lib/assistant/coding-workspaces',
    );
    expect(codingPlugin?.container?.sharedWorkspace).toBe(true);
    expect(codingPlugin?.container?.resources?.memory).toBe('2g');
    expect(codingPlugin?.container?.resources?.cpus).toBe(2);
  });

  it('preserves plugin-specific configuration fields', async () => {
    const filePath = createTempFile('config-plugin-extras');
    const configJson = {
      plugins: {
        terminal: {
          enabled: true,
          debug: true,
          shell: '/bin/bash',
        },
      },
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    const terminalPlugin = config.plugins['terminal'] as Record<string, unknown> | undefined;

    expect(terminalPlugin).toBeDefined();
    expect(terminalPlugin?.['enabled']).toBe(true);
    expect(terminalPlugin?.['debug']).toBe(true);
    expect(terminalPlugin?.['shell']).toBe('/bin/bash');
  });

  it('returns empty arrays/objects for missing optional sections', async () => {
    const filePath = createTempFile('config-missing-sections');
    const configJson = {};

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.agents).toEqual([]);
    expect(config.mcpServers).toEqual([]);
    expect(config.plugins).toEqual({});
  });

  it('parses sessions.maxCached configuration', async () => {
    const filePath = createTempFile('config-sessions');
    const configJson = {
      sessions: {
        maxCached: 42,
      },
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.sessions).toBeDefined();
    expect(config.sessions?.maxCached).toBe(42);
  });

  it('supports claude-cli chat provider config', async () => {
    const filePath = createTempFile('config-claude-cli');
    const configJson = {
      agents: [
        {
          agentId: 'claude-cli',
          displayName: 'Claude CLI',
          description: 'Claude via CLI',
          chat: {
            provider: 'claude-cli',
            config: {
              extraArgs: [
                '--model',
                'opus',
                '--agent',
                'template-y',
                '--dangerously-skip-permissions',
              ],
              workdir: '/path/to/claude',
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.agents).toHaveLength(1);
    const [agent] = config.agents;
    if (!agent) {
      throw new Error('Expected agent to be defined');
    }
    expect(agent.chat).toEqual({
      provider: 'claude-cli',
      config: {
        extraArgs: ['--model', 'opus', '--agent', 'template-y', '--dangerously-skip-permissions'],
        workdir: '/path/to/claude',
      },
    });
  });

  it('supports codex-cli chat provider config', async () => {
    const filePath = createTempFile('config-codex-cli');
    const configJson = {
      agents: [
        {
          agentId: 'codex-cli',
          displayName: 'Codex CLI',
          description: 'Codex via CLI',
          chat: {
            provider: 'codex-cli',
            config: {
              extraArgs: [
                '--model',
                'o3',
                '--config',
                'model_reasoning_effort=xhigh',
                '--full-auto',
                '--dangerously-bypass-approvals-and-sandbox',
              ],
              workdir: '/path/to/repo',
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.agents).toHaveLength(1);
    const [agent] = config.agents;
    if (!agent) {
      throw new Error('Expected agent to be defined');
    }
    expect(agent.chat).toEqual({
      provider: 'codex-cli',
      config: {
        extraArgs: [
          '--model',
          'o3',
          '--config',
          'model_reasoning_effort=xhigh',
          '--full-auto',
          '--dangerously-bypass-approvals-and-sandbox',
        ],
        workdir: '/path/to/repo',
      },
    });
  });

  it('supports pi-cli chat provider config', async () => {
    const filePath = createTempFile('config-pi-cli');
    const configJson = {
      agents: [
        {
          agentId: 'pi-cli',
          displayName: 'Pi CLI',
          description: 'Pi via CLI',
          chat: {
            provider: 'pi-cli',
            config: {
              extraArgs: [
                '--provider',
                'google',
                '--model',
                'pi-model',
                '--thinking',
                'medium',
                '--tools',
                'bash,fs',
              ],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.agents).toHaveLength(1);
    const [agent] = config.agents;
    if (!agent) {
      throw new Error('Expected agent to be defined');
    }
    expect(agent.chat).toEqual({
      provider: 'pi-cli',
      config: {
        extraArgs: [
          '--provider',
          'google',
          '--model',
          'pi-model',
          '--thinking',
          'medium',
          '--tools',
          'bash,fs',
        ],
      },
    });
  });

  it('supports CLI wrapper config with env substitution', async () => {
    const filePath = createTempFile('config-cli-wrapper');
    const configJson = {
      agents: [
        {
          agentId: 'claude-cli',
          displayName: 'Claude CLI',
          description: 'Claude via CLI',
          chat: {
            provider: 'claude-cli',
            config: {
              workdir: '/tmp/claude-workdir',
              extraArgs: ['--model', 'sonnet'],
              wrapper: {
                path: '/tmp/claude-wrapper',
                env: {
                  PERSISTENT: '1',
                  WRAPPER_TOKEN: '${WRAPPER_TOKEN}',
                },
              },
            },
          },
        },
      ],
    };

    process.env['WRAPPER_TOKEN'] = 'test-wrapper-token';

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.agents).toHaveLength(1);
    const [agent] = config.agents;
    if (!agent) {
      throw new Error('Expected agent to be defined');
    }
    expect(agent.chat).toEqual({
      provider: 'claude-cli',
      config: {
        workdir: '/tmp/claude-workdir',
        extraArgs: ['--model', 'sonnet'],
        wrapper: {
          path: '/tmp/claude-wrapper',
          env: {
            PERSISTENT: '1',
            WRAPPER_TOKEN: 'test-wrapper-token',
          },
        },
      },
    });
  });

  it.each([
    { provider: 'claude-cli', reservedArg: '--output-format' },
    { provider: 'codex-cli', reservedArg: '--json' },
    { provider: 'pi-cli', reservedArg: '--session' },
  ])('rejects reserved extraArgs for $provider', async ({ provider, reservedArg }) => {
    const filePath = createTempFile(`config-${provider}-reserved`);
    const configJson = {
      agents: [
        {
          agentId: `${provider}-agent`,
          displayName: 'Reserved Args Agent',
          description: 'Tests reserved args validation',
          chat: {
            provider,
            config: {
              extraArgs: [reservedArg, 'value'],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    expect(() => loadConfig(filePath)).toThrow(/extraArgs must not include reserved/i);
  });

  it('supports openai-compatible chat provider config with env substitution', async () => {
    const filePath = createTempFile('config-openai-compatible');
    const configJson = {
      agents: [
        {
          agentId: 'local-llama',
          displayName: 'Local LLaMA',
          description: 'Local LLaMA via OpenAI-compatible endpoint.',
          chat: {
            provider: 'openai-compatible',
            config: {
              baseUrl: 'http://localhost:8080/v1',
              apiKey: '${LOCAL_LLM_KEY}',
              model: 'llama-3.1-70b',
              maxTokens: 4096,
              temperature: 0.7,
            },
          },
        },
      ],
    };

    process.env['LOCAL_LLM_KEY'] = 'test-local-key';

    await fs.writeFile(filePath, JSON.stringify(configJson), 'utf8');

    const config = loadConfig(filePath);
    expect(config.agents).toHaveLength(1);
    const [agent] = config.agents;
    if (!agent) {
      throw new Error('Expected agent to be defined');
    }
    expect(agent.chat).toEqual({
      provider: 'openai-compatible',
      config: {
        baseUrl: 'http://localhost:8080/v1',
        apiKey: 'test-local-key',
        models: ['llama-3.1-70b'],
        maxTokens: 4096,
        temperature: 0.7,
      },
    });
  });

  it('throws a descriptive error for invalid JSON', async () => {
    const filePath = createTempFile('config-invalid-json');
    await fs.writeFile(filePath, '{ "agents": [ }', 'utf8');

    expect(() => loadConfig(filePath)).toThrow(/not valid JSON/i);
  });

  it('throws when the configuration file does not exist', () => {
    const missingPath = path.join(
      os.tmpdir(),
      `config-missing-${Date.now()}-${Math.random().toString(16)}.json`,
    );

    expect(() => loadConfig(missingPath)).toThrow(/Configuration file not found/i);
  });
});
