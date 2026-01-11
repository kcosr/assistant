import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

export interface AssistantCliConfig {
  baseUrl: string;
  token?: string;
  /**
   * Optional agent identifier used by agent-specific commands.
   * Populated from the ASSISTANT_AGENT_ID environment variable.
   */
  agentId?: string;
}

const DEFAULT_CONFIG_FILENAMES = [
  'assistant.config.json',
  'assistant.config.yaml',
  'assistant.config.yml',
];

export function loadConfig(cwd: string = process.cwd()): AssistantCliConfig | undefined {
  const envUrl = process.env['ASSISTANT_URL'];
  const envToken = process.env['ASSISTANT_TOKEN'];
  const envAgentId = process.env['ASSISTANT_AGENT_ID'];

  if (envUrl) {
    const config: AssistantCliConfig = {
      baseUrl: envUrl,
    };
    if (envToken) {
      config.token = envToken;
    }
    if (envAgentId) {
      config.agentId = envAgentId;
    }
    return config;
  }

  const configPath = findConfigFile(cwd);
  if (!configPath) return undefined;

  const content = fs.readFileSync(configPath, 'utf8');
  if (configPath.endsWith('.json')) {
    const parsed = JSON.parse(content) as Partial<AssistantCliConfig>;
    if (!parsed.baseUrl) {
      throw new Error('Config file must include baseUrl');
    }
    const config: AssistantCliConfig = {
      baseUrl: parsed.baseUrl,
    };
    if (parsed.token) {
      config.token = parsed.token;
    }
    if (envAgentId) {
      config.agentId = envAgentId;
    }
    return config;
  }

  const parsed = yaml.parse(content) as Partial<AssistantCliConfig>;
  if (!parsed.baseUrl) {
    throw new Error('Config file must include baseUrl');
  }
  const config: AssistantCliConfig = {
    baseUrl: parsed.baseUrl,
  };
  if (parsed.token) {
    config.token = parsed.token;
  }
  if (envAgentId) {
    config.agentId = envAgentId;
  }
  return config;
}

function findConfigFile(cwd: string): string | undefined {
  for (const filename of DEFAULT_CONFIG_FILENAMES) {
    const fullPath = path.join(cwd, filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  return undefined;
}
