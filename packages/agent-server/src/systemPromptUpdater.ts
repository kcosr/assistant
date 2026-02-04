import { buildSystemPrompt } from './systemPrompt';
import type { SkillSummary } from './skills';
import type { Tool } from './tools';
import type { LogicalSessionState, SessionHub } from './sessionHub';

export async function updateSystemPromptWithTools(options: {
  state: LogicalSessionState | undefined;
  sessionHub: SessionHub;
  tools: Tool[];
  skills?: SkillSummary[];
  log?: (...args: unknown[]) => void;
}): Promise<void> {
  const { state, sessionHub, tools, skills } = options;

  if (!state || state.chatMessages.length === 0) {
    return;
  }

  const firstMessage = state.chatMessages[0];
  if (firstMessage?.role !== 'system') {
    return;
  }

  const agentId = state.summary.agentId;
  const agentRegistry = sessionHub.getAgentRegistry();

  firstMessage.content = buildSystemPrompt({
    agentRegistry,
    agentId,
    tools,
    ...(skills ? { skills } : {}),
    sessionId: state.summary.sessionId,
    ...(state.summary.attributes?.core?.workingDir
      ? { workingDir: state.summary.attributes.core.workingDir }
      : {}),
  });
}
