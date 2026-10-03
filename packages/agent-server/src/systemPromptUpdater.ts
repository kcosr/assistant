import { buildSystemPrompt } from './systemPrompt';
import type { SkillSummary } from './skills';
import type { Tool } from './tools';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import { getSelectedSessionSkillIds } from './sessionConfig';

export async function updateSystemPromptWithTools(options: {
  state: LogicalSessionState | undefined;
  sessionHub: SessionHub;
  tools: Tool[];
  skills?: SkillSummary[];
  log?: (...args: unknown[]) => void;
}): Promise<void> {
  const { state, sessionHub, tools, skills } = options;

  if (!state) {
    return;
  }

  const agentId = state.summary.agentId;
  const agentRegistry = sessionHub.getAgentRegistry();
  const selectedInstructionSkillNames = getSelectedSessionSkillIds(state.summary.attributes);

  const content = buildSystemPrompt({
    agentRegistry,
    agentId,
    tools,
    ...(skills ? { skills } : {}),
    ...(selectedInstructionSkillNames ? { selectedInstructionSkillNames } : {}),
    sessionId: state.summary.sessionId,
    ...(state.summary.attributes?.core?.workingDir
      ? { workingDir: state.summary.attributes.core.workingDir }
      : {}),
  });
  const firstMessage = state.chatMessages[0];
  if (firstMessage?.role === 'system') {
    // Keep the canonical Pi payload unchanged. The runtime records any refreshed
    // instructions as a section update at the current point in the transcript.
    firstMessage.content = content;
  } else {
    state.chatMessages.unshift({ role: 'system', content });
  }
}
