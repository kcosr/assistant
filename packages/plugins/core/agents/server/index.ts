import fs from 'node:fs/promises';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';

import type { AgentDefinition } from '../../../../agent-server/src/agents';
import type { PluginModule } from '../../../../agent-server/src/plugins/types';
import { ToolError, type ToolContext } from '../../../../agent-server/src/tools';
import { matchesGlobPattern } from '../../../../agent-server/src/tools/scoping';
import { handleAgentMessage } from '../../../../agent-server/src/builtInTools';

type PluginFactoryArgs = { manifest: CombinedPluginManifest };

type AgentSummary = {
  agentId: string;
  displayName: string;
  description?: string;
  type?: 'chat' | 'external';
  supportedArtifactTypes?: string[];
  sessionWorkingDirMode?: 'auto' | 'prompt';
  sessionWorkingDirRoots?: string[];
};

type ListAgentsResult = {
  agents: AgentSummary[];
};

type ListAgentsArgs = {
  includeAll?: boolean;
};

type ListWorkingDirsArgs = {
  agentId: string;
  query?: string;
};

type WorkingDirRootEntry = {
  root: string;
  directories: string[];
};

type ListWorkingDirsResult = {
  roots: WorkingDirRootEntry[];
};

const ARTIFACT_TYPE_TOOL_PREFIXES: Record<string, string> = {
  list: 'lists_',
  note: 'notes_',
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ToolError('invalid_arguments', `${field} is required and must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new ToolError('invalid_arguments', `${field} must not be empty`);
  }
  return trimmed;
}

function parseListArgs(raw: unknown): ListAgentsArgs {
  const obj = asObject(raw);
  const args: ListAgentsArgs = {};
  if ('includeAll' in obj) {
    const includeAll = obj['includeAll'];
    if (typeof includeAll !== 'boolean') {
      throw new ToolError('invalid_arguments', 'includeAll must be a boolean when provided');
    }
    args.includeAll = includeAll;
  }
  return args;
}

function parseListWorkingDirsArgs(raw: unknown): ListWorkingDirsArgs {
  const obj = asObject(raw);
  const agentId = requireNonEmptyString(obj['agentId'], 'agentId');
  const queryRaw = obj['query'];
  const query =
    typeof queryRaw === 'string' && queryRaw.trim() ? queryRaw.trim().toLowerCase() : undefined;
  return { agentId, ...(query ? { query } : {}) };
}

function computeSupportedArtifactTypes(agent: AgentDefinition): string[] {
  const { toolAllowlist, toolDenylist, capabilityAllowlist, capabilityDenylist } = agent;
  const supportedTypes: string[] = [];

  for (const [artifactType, toolPrefix] of Object.entries(ARTIFACT_TYPE_TOOL_PREFIXES)) {
    const sampleToolName = `${toolPrefix}test`;

    let toolAllowed = true;
    if (toolAllowlist && toolAllowlist.length > 0) {
      toolAllowed = toolAllowlist.some((pattern) => matchesGlobPattern(sampleToolName, pattern));
    }

    if (toolAllowed && toolDenylist && toolDenylist.length > 0) {
      const denied = toolDenylist.some((pattern) => matchesGlobPattern(sampleToolName, pattern));
      if (denied) {
        toolAllowed = false;
      }
    }

    let capabilityAllowed = true;
    if (capabilityAllowlist || capabilityDenylist) {
      const capabilityPrefix = toolPrefix.replace(/_$/, '');
      const candidateCapabilities = [`${capabilityPrefix}.read`, `${capabilityPrefix}.write`];

      let allowedCapabilities = candidateCapabilities;
      if (capabilityAllowlist) {
        if (capabilityAllowlist.length === 0) {
          allowedCapabilities = [];
        } else {
          allowedCapabilities = allowedCapabilities.filter((capability) =>
            capabilityAllowlist.some((pattern) => matchesGlobPattern(capability, pattern)),
          );
        }
      }

      if (capabilityDenylist && capabilityDenylist.length > 0) {
        allowedCapabilities = allowedCapabilities.filter(
          (capability) =>
            !capabilityDenylist.some((pattern) => matchesGlobPattern(capability, pattern)),
        );
      }

      capabilityAllowed = allowedCapabilities.length > 0;
    }

    if (toolAllowed && capabilityAllowed) {
      supportedTypes.push(artifactType);
    }
  }

  return supportedTypes;
}

async function listAgents(args: unknown, ctx: ToolContext): Promise<ListAgentsResult> {
  const registry = ctx.agentRegistry;
  if (!registry) {
    return { agents: [] };
  }

  const parsed = parseListArgs(args);
  const allAgents = registry.listAgents().filter((agent) => agent.uiVisible !== false);
  let visibleAgents = allAgents;

  const sessionIndex = ctx.sessionIndex;
  const sessionId = ctx.sessionId;
  const currentAgentId =
    !parsed.includeAll && sessionIndex && sessionId
      ? (await sessionIndex.getSession(sessionId))?.agentId
      : undefined;

  if (!parsed.includeAll && currentAgentId) {
    const currentAgent = registry.getAgent(currentAgentId);
    if (currentAgent) {
      const allowlist = currentAgent.agentAllowlist;
      const denylist = currentAgent.agentDenylist;

      if (allowlist && allowlist.length > 0) {
        visibleAgents = visibleAgents.filter((agent) =>
          allowlist.some((pattern) => matchesGlobPattern(agent.agentId, pattern)),
        );
      }

      if (denylist && denylist.length > 0) {
        visibleAgents = visibleAgents.filter(
          (agent) => !denylist.some((pattern) => matchesGlobPattern(agent.agentId, pattern)),
        );
      }
    }

    visibleAgents = visibleAgents.filter((agent) => agent.agentId !== currentAgentId);
  }

  const summaries: AgentSummary[] = visibleAgents.map((agent) => ({
    agentId: agent.agentId,
    displayName: agent.displayName,
    description: agent.description,
    type: agent.type ?? 'chat',
    supportedArtifactTypes: computeSupportedArtifactTypes(agent),
    ...(agent.sessionWorkingDirMode ? { sessionWorkingDirMode: agent.sessionWorkingDirMode } : {}),
    ...(agent.sessionWorkingDirRoots ? { sessionWorkingDirRoots: agent.sessionWorkingDirRoots } : {}),
  }));

  return { agents: summaries };
}

async function listWorkingDirs(args: unknown, ctx: ToolContext): Promise<ListWorkingDirsResult> {
  const registry = ctx.agentRegistry;
  if (!registry) {
    return { roots: [] };
  }

  const parsed = parseListWorkingDirsArgs(args);
  const agent = registry.getAgent(parsed.agentId);
  if (!agent || agent.uiVisible === false) {
    throw new ToolError('invalid_arguments', `Unknown agent: ${parsed.agentId}`);
  }

  const roots = agent.sessionWorkingDirRoots ?? [];
  if (roots.length === 0) {
    return { roots: [] };
  }

  const query = parsed.query;
  const entries: WorkingDirRootEntry[] = [];

  for (const root of roots) {
    try {
      const dirents = await fs.readdir(root, { withFileTypes: true });
      let directories = dirents
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name));
      if (query) {
        directories = directories.filter((dir) => dir.toLowerCase().includes(query));
      }
      directories.sort((a, b) => a.localeCompare(b));
      entries.push({ root, directories });
    } catch (err) {
      console.warn('[agents] Failed to list working dir root', { root, err });
      entries.push({ root, directories: [] });
    }
  }

  return { roots: entries };
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      list: async (args, ctx) => listAgents(args, ctx),
      'list-working-dirs': async (args, ctx) => listWorkingDirs(args, ctx),
      message: async (args, ctx) => {
        const sessionIndex = ctx.sessionIndex;
        const sessionHub = ctx.sessionHub;
        if (!sessionIndex || !sessionHub) {
          throw new ToolError('session_hub_unavailable', 'Session hub is not available');
        }
        return handleAgentMessage(args, ctx, sessionIndex, sessionHub);
      },
    },
  };
}
