import { listAgentToolsForHost, type ToolHost } from './tools';
import type { SessionHub } from './sessionHub';
import type { AgentDefinition } from './agents';
import type { SkillSummary } from './skills';
import { resolveToolExposure } from './skills';
import { mapToolsToChatCompletionSpecs } from './tools';
import type { ToolContext } from './tools';

export async function resolveAgentToolExposureForHost(options: {
  scopedToolHost: ToolHost;
  agent: AgentDefinition | undefined;
  sessionHub: SessionHub;
  toolContext?: ToolContext;
}): Promise<{
  availableTools: Awaited<ReturnType<ToolHost['listTools']>>;
  chatTools: unknown[];
  agentTools: Awaited<ReturnType<typeof listAgentToolsForHost>>;
  availableSkills: SkillSummary[];
}> {
  const { scopedToolHost, agent, sessionHub, toolContext } = options;
  let baseTools: Awaited<ReturnType<ToolHost['listTools']>> = [];
  try {
    baseTools = await scopedToolHost.listTools();
  } catch {
    baseTools = [];
  }
  const manifests = sessionHub.getPluginRegistry()?.getManifests?.() ?? [];
  const { visibleTools, skills } = resolveToolExposure({
    tools: baseTools,
    ...(agent ? { agent } : {}),
    manifests,
  });
  const chatTools = visibleTools.length > 0 ? mapToolsToChatCompletionSpecs(visibleTools) : [];
  let agentTools: Awaited<ReturnType<typeof listAgentToolsForHost>> = [];
  if (toolContext) {
    try {
      const allAgentTools = await listAgentToolsForHost(scopedToolHost, toolContext);
      const visibleToolNames = new Set(visibleTools.map((tool) => tool.name));
      agentTools = allAgentTools.filter((tool) => visibleToolNames.has(tool.name));
    } catch {
      agentTools = [];
    }
  }
  return { availableTools: visibleTools, chatTools, agentTools, availableSkills: skills };
}
