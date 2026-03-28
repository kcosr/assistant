import path from 'node:path';

import type { SessionAttributes, SessionAttributesPatch, SessionConfig } from '@assistant/shared';

import type { AgentDefinition } from './agents';
import { getAgentAvailableModels, getAgentAvailableThinkingLevels } from './sessionModel';
import { type ToolHost } from './tools';
import type { SessionHub } from './sessionHub';
import { listInstructionSkills } from './instructionSkills';

export interface SessionConfigCapabilities {
  models: string[];
  thinking: string[];
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}

export interface ResolvedSessionConfig {
  model?: string;
  thinking?: string;
  workingDir?: string;
  skills?: string[];
  sessionTitle?: string;
}

export function parseSessionConfigInput(options: {
  value: unknown;
  allowNull?: boolean;
  allowSessionTitle?: boolean;
}): SessionConfig | null | undefined {
  const { value, allowNull = false, allowSessionTitle = true } = options;
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    if (allowNull) {
      return null;
    }
    throw new Error('sessionConfig must be an object');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`sessionConfig must be an object${allowNull ? ' or null' : ''}`);
  }

  const config = value as Record<string, unknown>;
  const parseOptionalString = (field: keyof SessionConfig): string | undefined => {
    const raw = config[field];
    if (raw === undefined) {
      return undefined;
    }
    if (typeof raw !== 'string') {
      throw new Error(`sessionConfig.${field} must be a string`);
    }
    return raw;
  };

  const rawSkills = config['skills'];
  if (
    rawSkills !== undefined &&
    (!Array.isArray(rawSkills) || rawSkills.some((entry) => typeof entry !== 'string'))
  ) {
    throw new Error('sessionConfig.skills must be an array of strings');
  }

  const model = parseOptionalString('model');
  const thinking = parseOptionalString('thinking');
  const workingDir = parseOptionalString('workingDir');
  const sessionTitle = parseOptionalString('sessionTitle');
  if (!allowSessionTitle && sessionTitle !== undefined) {
    throw new Error('sessionConfig.sessionTitle is not supported here; use sessionTitle instead');
  }

  return {
    ...(model !== undefined ? { model } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
    ...(workingDir !== undefined ? { workingDir } : {}),
    ...(rawSkills !== undefined ? { skills: rawSkills as string[] } : {}),
    ...(sessionTitle !== undefined ? { sessionTitle } : {}),
  };
}

export async function resolveSessionConfigCapabilities(options: {
  agent: AgentDefinition | undefined;
  sessionHub?: SessionHub;
  baseToolHost?: ToolHost;
}): Promise<SessionConfigCapabilities> {
  const { agent } = options;
  const models = getAgentAvailableModels(agent);
  const thinking = getAgentAvailableThinkingLevels(agent);
  const skills = agent ? listInstructionSkills(agent) : [];

  return {
    models,
    thinking,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
    })),
  };
}

export async function resolveSessionConfigForAgent(options: {
  agent: AgentDefinition | undefined;
  sessionConfig?: SessionConfig;
  sessionHub?: SessionHub;
  baseToolHost?: ToolHost;
}): Promise<ResolvedSessionConfig> {
  const { agent, sessionConfig } = options;
  const capabilities = await resolveSessionConfigCapabilities(options);
  const resolved: ResolvedSessionConfig = {};

  const model = normalizeOptionalString(sessionConfig?.model);
  if (model) {
    if (capabilities.models.length === 0 || !capabilities.models.includes(model)) {
      throw new Error(`Model "${model}" is not allowed for agent "${agent?.agentId ?? 'unknown'}"`);
    }
    resolved.model = model;
  }

  const thinking = normalizeOptionalString(sessionConfig?.thinking);
  if (thinking) {
    if (capabilities.thinking.length === 0 || !capabilities.thinking.includes(thinking)) {
      throw new Error(
        `Thinking level "${thinking}" is not allowed for agent "${agent?.agentId ?? 'unknown'}"`,
      );
    }
    resolved.thinking = thinking;
  }

  const workingDir = normalizeOptionalString(sessionConfig?.workingDir);
  if (workingDir) {
    if (!path.isAbsolute(workingDir)) {
      throw new Error('sessionConfig.workingDir must be an absolute path');
    }
    resolved.workingDir = workingDir;
  }

  const skills = normalizeSkills(sessionConfig?.skills);
  if (skills) {
    const availableSkillIds = new Set(capabilities.skills.map((skill) => skill.id));
    for (const skillId of skills) {
      if (!availableSkillIds.has(skillId)) {
        throw new Error(
          `Skill "${skillId}" is not allowed for agent "${agent?.agentId ?? 'unknown'}"`,
        );
      }
    }
    resolved.skills = skills;
  }

  const sessionTitle = normalizeOptionalString(sessionConfig?.sessionTitle);
  if (sessionTitle) {
    resolved.sessionTitle = sessionTitle;
  }

  return resolved;
}

export function buildSessionAttributesPatchFromConfig(
  config: ResolvedSessionConfig,
  options?: { clearMissing?: boolean },
): SessionAttributesPatch | undefined {
  const patch: SessionAttributesPatch = {};
  const clearMissing = options?.clearMissing === true;
  if (config.workingDir || clearMissing) {
    patch['core'] = { workingDir: config.workingDir ?? null };
  }
  if ((config.skills && config.skills.length > 0) || clearMissing) {
    patch['agent'] = { skills: config.skills ?? null };
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

export function filterSessionSkills<T>(options: {
  availableSkills: T[] | undefined;
  selectedSkillIds: string[] | undefined;
}): T[] | undefined {
  const { availableSkills } = options;
  return availableSkills;
}

export function getSelectedSessionSkillIds(attributes: SessionAttributes | undefined): string[] | undefined {
  const rawAgent = attributes?.agent;
  if (!rawAgent || typeof rawAgent !== 'object' || Array.isArray(rawAgent)) {
    return undefined;
  }
  const rawSkills = (rawAgent as { skills?: unknown }).skills;
  return normalizeSkills(rawSkills);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSkills(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}
