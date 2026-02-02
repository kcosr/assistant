import type { AgentDefinition } from './agents';
import type { SessionSummary } from './sessionIndex';

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

function normaliseThinkingLevels(levels: unknown): string[] {
  if (!Array.isArray(levels)) {
    return [];
  }
  const result: string[] = [];
  for (let i = 0; i < levels.length; i += 1) {
    const value = levels[i];
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
    agent.chat.provider === 'pi' ||
    agent.chat.provider === 'claude-cli' ||
    agent.chat.provider === 'codex-cli' ||
    agent.chat.provider === 'pi-cli'
      ? agent.chat.provider
      : 'pi';

  const models = (agent.chat as { models?: unknown }).models;
  return normaliseModels(models);
}

export function getAgentAvailableThinkingLevels(agent: AgentDefinition | undefined): string[] {
  if (!agent || !agent.chat) {
    return [];
  }

  if (
    agent.chat.provider !== 'pi' &&
    agent.chat.provider !== 'pi-cli' &&
    agent.chat.provider !== 'codex-cli'
  ) {
    return [];
  }

  const thinking = (agent.chat as { thinking?: unknown }).thinking;
  return normaliseThinkingLevels(thinking);
}

export function getDefaultModelForNewSession(
  agent: AgentDefinition | undefined,
): string | undefined {
  const models = getAgentAvailableModels(agent);
  return models.length > 0 ? models[0] : undefined;
}

export function getDefaultThinkingForNewSession(
  agent: AgentDefinition | undefined,
): string | undefined {
  const thinkingLevels = getAgentAvailableThinkingLevels(agent);
  return thinkingLevels.length > 0 ? thinkingLevels[0] : undefined;
}

export function resolveSessionModelForRun(options: {
  agent: AgentDefinition | undefined;
  summary: SessionSummary;
}): string | undefined {
  const { agent, summary } = options;
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
    return availableModels[0];
  }

  return undefined;
}

export function resolveSessionThinkingForRun(options: {
  agent: AgentDefinition | undefined;
  summary: SessionSummary;
}): string | undefined {
  const { agent, summary } = options;
  const availableThinking = getAgentAvailableThinkingLevels(agent);
  if (availableThinking.length === 0) {
    return undefined;
  }

  const sessionThinkingRaw = summary.thinking;
  const sessionThinking =
    typeof sessionThinkingRaw === 'string' && sessionThinkingRaw.trim().length > 0
      ? sessionThinkingRaw.trim()
      : undefined;

  if (sessionThinking && availableThinking.includes(sessionThinking)) {
    return sessionThinking;
  }

  return availableThinking[0];
}

export function resolveCliModelForRun(options: {
  agent: AgentDefinition | undefined;
  summary: SessionSummary;
}): string | undefined {
  const { agent, summary } = options;
  const availableModels = getAgentAvailableModels(agent);
  if (availableModels.length === 0) {
    return undefined;
  }

  const sessionModelRaw = summary.model;
  const sessionModel =
    typeof sessionModelRaw === 'string' && sessionModelRaw.trim().length > 0
      ? sessionModelRaw.trim()
      : undefined;

  if (sessionModel && availableModels.includes(sessionModel)) {
    return sessionModel;
  }

  return availableModels[0];
}
