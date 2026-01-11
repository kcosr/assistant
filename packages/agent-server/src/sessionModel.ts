import type { AgentDefinition, OpenAiCompatibleChatConfig } from './agents';
import type { SessionSummary } from './sessionIndex';
import type { EnvConfig } from './envConfig';

function normaliseModels(models: unknown): string[] {
  if (!Array.isArray(models)) {
    return [];
  }
  const result: string[] = [];
  for (let i = 0; i < models.length; i += 1) {
    const value = models[i];
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    result.push(trimmed);
  }
  return result;
}

export function getAgentAvailableModels(agent: AgentDefinition | undefined): string[] {
  if (!agent || !agent.chat) {
    return [];
  }

  const provider =
    agent.chat.provider === 'claude-cli' ||
    agent.chat.provider === 'codex-cli' ||
    agent.chat.provider === 'pi-cli' ||
    agent.chat.provider === 'openai-compatible'
      ? agent.chat.provider
      : 'openai';

  if (provider === 'openai') {
    const models = (agent.chat as { models?: unknown }).models;
    return normaliseModels(models);
  }

  if (provider === 'openai-compatible') {
    const config = agent.chat.config as OpenAiCompatibleChatConfig | undefined;
    return config ? normaliseModels(config.models) : [];
  }

  return [];
}

export function getDefaultModelForNewSession(
  agent: AgentDefinition | undefined,
): string | undefined {
  const models = getAgentAvailableModels(agent);
  return models.length > 0 ? models[0] : undefined;
}

export function resolveSessionModelForRun(options: {
  agent: AgentDefinition | undefined;
  summary: SessionSummary;
  envConfig: EnvConfig;
}): string | undefined {
  const { agent, summary, envConfig } = options;
  const availableModels = getAgentAvailableModels(agent);

  const sessionModelRaw = summary.model;
  const sessionModel =
    typeof sessionModelRaw === 'string' && sessionModelRaw.trim().length > 0
      ? sessionModelRaw.trim()
      : undefined;

  if (sessionModel && (availableModels.length === 0 || availableModels.includes(sessionModel))) {
    return sessionModel;
  }

  if (availableModels.length > 0) {
    return availableModels[0] ?? envConfig.chatModel;
  }

  return envConfig.chatModel;
}
