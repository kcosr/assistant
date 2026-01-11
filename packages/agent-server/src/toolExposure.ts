import type { ToolHost } from './tools';
import type { SessionHub } from './sessionHub';
import type { AgentDefinition } from './agents';
import type { SkillSummary } from './skills';
import { resolveToolExposure } from './skills';
import { mapToolsToChatCompletionSpecs } from './tools';

export async function resolveAgentToolExposureForHost(options: {
  scopedToolHost: ToolHost;
  agent: AgentDefinition | undefined;
  sessionHub: SessionHub;
}): Promise<{
  availableTools: Awaited<ReturnType<ToolHost['listTools']>>;
  chatTools: unknown[];
  availableSkills: SkillSummary[];
}> {
  const { scopedToolHost, agent, sessionHub } = options;
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
  return { availableTools: visibleTools, chatTools, availableSkills: skills };
}
