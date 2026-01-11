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
};

type ListAgentsResult = {
  agents: AgentSummary[];
};

type ListAgentsArgs = {
  includeAll?: boolean;
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
  }));

  return { agents: summaries };
}

export function createPlugin(_options: PluginFactoryArgs): PluginModule {
  return {
    operations: {
      list: async (args, ctx) => listAgents(args, ctx),
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
