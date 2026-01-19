import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { AgentRegistry, loadAgentDefinitionsFromFile } from './agents';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.json`);
}

describe('AgentRegistry', () => {
  it('stores and retrieves agent definitions by id', () => {
    const registry = new AgentRegistry([
      {
        agentId: 'reading-list',
        displayName: 'Reading List Manager',
        description: 'Manages a reading list of articles and links.',
        systemPrompt: 'You manage a reading list.',
        toolAllowlist: ['reading_list_*'],
      },
      {
        agentId: 'journal',
        displayName: 'Journal',
        description: 'Helps the user reflect and journal.',
        systemPrompt: 'You are a journal assistant.',
      },
    ]);

    expect(registry.hasAgent('reading-list')).toBe(true);
    expect(registry.hasAgent('missing')).toBe(false);

    const readingList = registry.getAgent('reading-list');
    expect(readingList).toBeDefined();
    expect(readingList?.displayName).toBe('Reading List Manager');

    const allAgents = registry.listAgents();
    const ids = allAgents.map((agent) => agent.agentId).sort();
    expect(ids).toEqual(['journal', 'reading-list']);
  });
});

describe('loadAgentDefinitionsFromFile', () => {
  it('loads valid agent definitions from a JSON file', async () => {
    const filePath = createTempFile('agents-config-valid');
    const config = {
      agents: [
        {
          agentId: 'reading-list',
          displayName: 'Reading List Manager',
          description: 'Manages a reading list of articles and links.',
          systemPrompt: 'You manage a reading list.',
          toolAllowlist: ['reading_list_*'],
          toolDenylist: ['reading_list_delete'],
          toolExposure: 'mixed',
          skillAllowlist: ['notes', 'lists'],
          skillDenylist: ['lists-private'],
          capabilityAllowlist: ['lists.*'],
          capabilityDenylist: ['lists.write'],
        },
        {
          agentId: 'general',
          displayName: 'General Assistant',
          description: 'A helpful general-purpose assistant for everyday tasks.',
          systemPrompt: 'You are a helpful assistant.',
          toolAllowlist: null,
          capabilityAllowlist: null,
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(2);

    const readingList = definitions.find((agent) => agent.agentId === 'reading-list');
    expect(readingList).toBeDefined();
    expect(readingList?.toolAllowlist).toEqual(['reading_list_*']);
    expect(readingList?.toolDenylist).toEqual(['reading_list_delete']);
    expect(readingList?.toolExposure).toBe('mixed');
    expect(readingList?.skillAllowlist).toEqual(['notes', 'lists']);
    expect(readingList?.skillDenylist).toEqual(['lists-private']);
    expect(readingList?.capabilityAllowlist).toEqual(['lists.*']);
    expect(readingList?.capabilityDenylist).toEqual(['lists.write']);

    const general = definitions.find((agent) => agent.agentId === 'general');
    expect(general).toBeDefined();
    expect(general?.toolAllowlist).toBeUndefined();
    expect(general?.toolDenylist).toBeUndefined();
    expect(general?.toolExposure).toBeUndefined();
    expect(general?.skillAllowlist).toBeUndefined();
    expect(general?.skillDenylist).toBeUndefined();
    expect(general?.capabilityAllowlist).toBeUndefined();
    expect(general?.capabilityDenylist).toBeUndefined();
  });

  it('loads chat provider configuration for claude-cli', async () => {
    const filePath = createTempFile('agents-config-claude-cli');
    const config = {
      agents: [
        {
          agentId: 'claude',
          displayName: 'Claude',
          description: 'Uses local claude CLI.',
          chat: {
            provider: 'claude-cli',
            config: {
              extraArgs: ['--model', 'claude-3-5-sonnet', '--agent', 'test-agent'],
              workdir: '/tmp/claude-workdir',
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.chat).toEqual({
      provider: 'claude-cli',
      config: {
        extraArgs: ['--model', 'claude-3-5-sonnet', '--agent', 'test-agent'],
        workdir: '/tmp/claude-workdir',
      },
    });
  });

  it('loads chat provider configuration for pi-cli', async () => {
    const filePath = createTempFile('agents-config-pi-cli');
    const config = {
      agents: [
        {
          agentId: 'pi',
          displayName: 'Pi',
          description: 'Uses local Pi CLI.',
          chat: {
            provider: 'pi-cli',
            models: ['pi-model'],
            thinking: ['medium'],
            config: {
              extraArgs: ['--tools', 'bash,fs'],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.chat).toEqual({
      provider: 'pi-cli',
      models: ['pi-model'],
      thinking: ['medium'],
      config: {
        extraArgs: ['--tools', 'bash,fs'],
      },
    });
  });

  it('rejects pi-cli --model extraArgs when models are configured', async () => {
    const filePath = createTempFile('agents-config-pi-cli-models-conflict');
    const config = {
      agents: [
        {
          agentId: 'pi',
          displayName: 'Pi',
          description: 'Uses local Pi CLI.',
          chat: {
            provider: 'pi-cli',
            models: ['pi-model'],
            config: {
              extraArgs: ['--model', 'pi-model'],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(/reserved pi-cli flags: --model/);
  });

  it('rejects pi-cli --provider extraArgs when models are configured', async () => {
    const filePath = createTempFile('agents-config-pi-cli-provider-conflict');
    const config = {
      agents: [
        {
          agentId: 'pi',
          displayName: 'Pi',
          description: 'Uses local Pi CLI.',
          chat: {
            provider: 'pi-cli',
            models: ['pi-model'],
            config: {
              extraArgs: ['--provider', 'google'],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /reserved pi-cli flags: --provider/,
    );
  });

  it('rejects pi-cli --thinking extraArgs when thinking is configured', async () => {
    const filePath = createTempFile('agents-config-pi-cli-thinking-conflict');
    const config = {
      agents: [
        {
          agentId: 'pi',
          displayName: 'Pi',
          description: 'Uses local Pi CLI.',
          chat: {
            provider: 'pi-cli',
            thinking: ['medium'],
            config: {
              extraArgs: ['--thinking', 'high'],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /reserved pi-cli flags: --thinking/,
    );
  });

  it('rejects codex-cli model_reasoning_effort extraArgs when thinking is configured', async () => {
    const filePath = createTempFile('agents-config-codex-cli-thinking-conflict');
    const config = {
      agents: [
        {
          agentId: 'codex',
          displayName: 'Codex',
          description: 'Uses local Codex CLI.',
          chat: {
            provider: 'codex-cli',
            thinking: ['high'],
            config: {
              extraArgs: ['--config', 'model_reasoning_effort=high'],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(/model_reasoning_effort/);
  });

  it('loads codex-cli thinking config', async () => {
    const filePath = createTempFile('agents-config-codex-cli-thinking');
    const config = {
      agents: [
        {
          agentId: 'codex',
          displayName: 'Codex',
          description: 'Uses local Codex CLI.',
          chat: {
            provider: 'codex-cli',
            thinking: ['low', 'high'],
            config: {
              extraArgs: ['--full-auto'],
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.chat).toEqual({
      provider: 'codex-cli',
      thinking: ['low', 'high'],
      config: {
        extraArgs: ['--full-auto'],
      },
    });
  });

  it('loads chat provider configuration for openai-compatible', async () => {
    const filePath = createTempFile('agents-config-openai-compatible');
    const config = {
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

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.chat).toEqual({
      provider: 'openai-compatible',
      config: {
        baseUrl: 'http://localhost:8080/v1',
        apiKey: '${LOCAL_LLM_KEY}',
        models: ['llama-3.1-70b'],
        maxTokens: 4096,
        temperature: 0.7,
      },
    });
  });

  it('loads openai-compatible config with custom headers', async () => {
    const filePath = createTempFile('agents-config-openai-compatible-headers');
    const config = {
      agents: [
        {
          agentId: 'custom-llm',
          displayName: 'Custom LLM',
          description: 'LLM with custom headers.',
          chat: {
            provider: 'openai-compatible',
            config: {
              baseUrl: 'https://api.example.com/v1',
              model: 'custom-model',
              headers: {
                'X-Custom-Auth': 'token123',
                'X-Request-Source': 'assistant',
              },
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.chat).toEqual({
      provider: 'openai-compatible',
      config: {
        baseUrl: 'https://api.example.com/v1',
        models: ['custom-model'],
        headers: {
          'X-Custom-Auth': 'token123',
          'X-Request-Source': 'assistant',
        },
      },
    });
  });

  it('rejects openai-compatible headers with non-string values', async () => {
    const filePath = createTempFile('agents-config-openai-compatible-bad-headers');
    const config = {
      agents: [
        {
          agentId: 'bad-headers',
          displayName: 'Bad Headers',
          description: 'Invalid headers config.',
          chat: {
            provider: 'openai-compatible',
            config: {
              baseUrl: 'https://api.example.com/v1',
              model: 'custom-model',
              headers: {
                'X-Valid': 'string',
                'X-Invalid': 123,
              },
            },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /headers\["X-Invalid"\] must be a string/,
    );
  });

  it('defaults chat provider to openai when omitted', async () => {
    const filePath = createTempFile('agents-config-chat-default');
    const config = {
      agents: [
        {
          agentId: 'default-chat',
          displayName: 'Default',
          description: 'Defaults to openai.',
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.chat).toBeUndefined();
  });

  it('loads agentAllowlist and agentDenylist from configuration', async () => {
    const filePath = createTempFile('agents-config-agent-visibility');
    const config = {
      agents: [
        {
          agentId: 'primary',
          displayName: 'Primary Agent',
          description: 'Primary agent with scoped visibility.',
          systemPrompt: 'You are the primary agent.',
          agentAllowlist: ['helper-*'],
          agentDenylist: ['helper-secret'],
        },
        {
          agentId: 'helper-1',
          displayName: 'Helper One',
          description: 'First helper agent.',
          systemPrompt: 'You are helper one.',
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(2);

    const primary = definitions.find((agent) => agent.agentId === 'primary');
    expect(primary).toBeDefined();
    expect(primary?.agentAllowlist).toEqual(['helper-*']);
    expect(primary?.agentDenylist).toEqual(['helper-secret']);
  });

  it('loads uiVisible when provided', async () => {
    const filePath = createTempFile('agents-config-ui-visible');
    const config = {
      agents: [
        {
          agentId: 'hidden',
          displayName: 'Hidden Agent',
          description: 'Should be hidden from built-in clients.',
          systemPrompt: 'You are hidden.',
          uiVisible: false,
        },
        {
          agentId: 'visible',
          displayName: 'Visible Agent',
          description: 'Visible by default.',
          systemPrompt: 'You are visible.',
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(2);

    const hidden = definitions.find((agent) => agent.agentId === 'hidden');
    expect(hidden?.uiVisible).toBe(false);

    const visible = definitions.find((agent) => agent.agentId === 'visible');
    expect(visible?.uiVisible).toBeUndefined();
  });

  it('loads apiExposed when provided', async () => {
    const filePath = createTempFile('agents-config-api-exposed');
    const config = {
      agents: [
        {
          agentId: 'external',
          displayName: 'External Agent',
          description: 'Reachable via HTTP tools API.',
          systemPrompt: 'You are external.',
          apiExposed: true,
        },
        {
          agentId: 'internal',
          displayName: 'Internal Agent',
          description: 'Not reachable via HTTP tools API by default.',
          systemPrompt: 'You are internal.',
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(2);

    const external = definitions.find((agent) => agent.agentId === 'external');
    expect(external?.apiExposed).toBe(true);

    const internal = definitions.find((agent) => agent.agentId === 'internal');
    expect(internal?.apiExposed).toBeUndefined();
  });

  it('returns an empty array when the config file does not exist', () => {
    const missingPath = path.join(
      os.tmpdir(),
      `agents-config-missing-${Date.now()}-${Math.random().toString(16)}.json`,
    );

    const definitions = loadAgentDefinitionsFromFile(missingPath);
    expect(definitions).toEqual([]);
  });

  it('throws for invalid agent definitions', async () => {
    const filePath = createTempFile('agents-config-invalid');
    const invalidConfig = {
      agents: [
        {
          agentId: '',
          displayName: 'Missing Id',
          description: 'Description for invalid agent.',
          systemPrompt: 'Prompt',
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(/agentId must be a non-empty/i);
  });

  it('throws when description is missing or empty', async () => {
    const filePath = createTempFile('agents-config-missing-description');
    const invalidConfig = {
      agents: [
        {
          agentId: 'agent-without-description',
          displayName: 'Agent Without Description',
          systemPrompt: 'Prompt',
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /description must be a non-empty string/i,
    );
  });

  it('validates that toolDenylist entries are non-empty strings when provided', async () => {
    const filePath = createTempFile('agents-config-invalid-toolDenylist');
    const invalidConfig = {
      agents: [
        {
          agentId: 'agent-with-invalid-denylist',
          displayName: 'Agent With Invalid Denylist',
          description: 'Has an invalid denylist entry.',
          systemPrompt: 'Prompt',
          toolDenylist: ['valid_pattern', ''],
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /toolDenylist\[1] must be a non-empty string when provided/i,
    );
  });

  it('validates toolExposure values when provided', async () => {
    const filePath = createTempFile('agents-config-invalid-toolExposure');
    const invalidConfig = {
      agents: [
        {
          agentId: 'agent-with-invalid-toolExposure',
          displayName: 'Agent With Invalid Tool Exposure',
          description: 'Has an invalid toolExposure value.',
          systemPrompt: 'Prompt',
          toolExposure: 'toolz',
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(/toolExposure/i);
  });

  it('validates that skillAllowlist entries are non-empty strings when provided', async () => {
    const filePath = createTempFile('agents-config-invalid-skillAllowlist');
    const invalidConfig = {
      agents: [
        {
          agentId: 'agent-with-invalid-skillAllowlist',
          displayName: 'Agent With Invalid Skill Allowlist',
          description: 'Has an invalid skill allowlist entry.',
          systemPrompt: 'Prompt',
          skillAllowlist: ['notes', ''],
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /skillAllowlist\[1] must be a non-empty string when provided/i,
    );
  });

  it('validates that capabilityAllowlist entries are non-empty strings when provided', async () => {
    const filePath = createTempFile('agents-config-invalid-capabilityAllowlist');
    const invalidConfig = {
      agents: [
        {
          agentId: 'agent-with-invalid-capabilityAllowlist',
          displayName: 'Agent With Invalid Capability Allowlist',
          description: 'Has an invalid capability allowlist entry.',
          systemPrompt: 'Prompt',
          capabilityAllowlist: ['valid_pattern', ''],
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /capabilityAllowlist\[1] must be a non-empty string when provided/i,
    );
  });

  it('validates that agentAllowlist entries are non-empty strings when provided', async () => {
    const filePath = createTempFile('agents-config-invalid-agentAllowlist');
    const invalidConfig = {
      agents: [
        {
          agentId: 'agent-with-invalid-agentAllowlist',
          displayName: 'Agent With Invalid AgentAllowlist',
          description: 'Has an invalid agentAllowlist entry.',
          systemPrompt: 'Prompt',
          agentAllowlist: ['valid_pattern', ''],
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /agentAllowlist\[1] must be a non-empty string when provided/i,
    );
  });

  it('validates that agentDenylist entries are non-empty strings when provided', async () => {
    const filePath = createTempFile('agents-config-invalid-agentDenylist');
    const invalidConfig = {
      agents: [
        {
          agentId: 'agent-with-invalid-agentDenylist',
          displayName: 'Agent With Invalid AgentDenylist',
          description: 'Has an invalid agentDenylist entry.',
          systemPrompt: 'Prompt',
          agentDenylist: ['valid_pattern', ''],
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /agentDenylist\[1] must be a non-empty string when provided/i,
    );
  });

  it('allows systemPrompt to be omitted', async () => {
    const filePath = createTempFile('agents-config-no-systemprompt');
    const config = {
      agents: [
        {
          agentId: 'reading-list',
          displayName: 'Reading List Manager',
          description: 'Manages your reading queue of articles and links.',
          toolAllowlist: ['reading_list_*'],
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(config), 'utf8');

    const definitions = loadAgentDefinitionsFromFile(filePath);
    expect(definitions).toHaveLength(1);

    const readingList = definitions[0];
    expect(readingList?.agentId).toBe('reading-list');
    expect(readingList?.displayName).toBe('Reading List Manager');
    expect(readingList?.description).toBe('Manages your reading queue of articles and links.');
    expect(readingList?.systemPrompt).toBeUndefined();
    expect(readingList?.toolAllowlist).toEqual(['reading_list_*']);
  });

  it('throws when chat.config is provided for openai provider', async () => {
    const filePath = createTempFile('agents-config-invalid-chat-openai-config');
    const invalidConfig = {
      agents: [
        {
          agentId: 'bad',
          displayName: 'Bad',
          description: 'Bad config.',
          chat: {
            provider: 'openai',
            config: { model: 'should-not-be-allowed' },
          },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /chat\.config is only valid when chat\.provider is "claude-cli", "codex-cli", "pi-cli", or "openai-compatible"/,
    );
  });

  it('throws when chat is provided for external agents', async () => {
    const filePath = createTempFile('agents-config-invalid-chat-external');
    const invalidConfig = {
      agents: [
        {
          agentId: 'ext',
          displayName: 'External',
          description: 'External agent.',
          type: 'external',
          external: {
            inputUrl: 'https://example.com/in',
            callbackBaseUrl: 'https://example.com/cb',
          },
          chat: { provider: 'claude-cli' },
        },
      ],
    };

    await fs.writeFile(filePath, JSON.stringify(invalidConfig), 'utf8');

    expect(() => loadAgentDefinitionsFromFile(filePath)).toThrow(
      /chat is only valid when type is "chat"/,
    );
  });
});
