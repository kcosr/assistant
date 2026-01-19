import type { AgentRegistry } from './agents';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { SessionIndex, SessionSummary } from './sessionIndex';
import { getDefaultModelForNewSession, getDefaultThinkingForNewSession } from './sessionModel';

export interface SessionResolutionResult {
  sessionId: string;
  sessionState: LogicalSessionState;
  summary: SessionSummary;
  created: boolean;
}

export async function resolveAgentSession(
  agentId: string,
  strategy: 'latest' | 'create' | 'latest-or-create' | string,
  sessionIndex: SessionIndex,
  sessionHub: SessionHub,
  agentRegistry: AgentRegistry,
): Promise<SessionResolutionResult> {
  const trimmedAgentId = agentId.trim();
  if (!trimmedAgentId) {
    throw new Error('Agent id must not be empty');
  }

  if (!agentRegistry.hasAgent(trimmedAgentId)) {
    throw new Error('Agent not found');
  }

  const resolutionStrategy = strategy || 'latest-or-create';
  let summary: SessionSummary | undefined;
  let created = false;

  if (resolutionStrategy === 'latest') {
    summary = await sessionIndex.findSessionForAgent(trimmedAgentId);
    if (!summary) {
      throw new Error('No existing session for agent');
    }
  } else if (resolutionStrategy === 'create') {
    const agent = agentRegistry.getAgent(trimmedAgentId);
    const model = getDefaultModelForNewSession(agent);
    const thinking = getDefaultThinkingForNewSession(agent);
    summary = await sessionIndex.createSession(
      model || thinking
        ? { agentId: trimmedAgentId, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) }
        : { agentId: trimmedAgentId },
    );
    created = true;
    sessionHub.broadcastSessionCreated(summary);
  } else if (resolutionStrategy === 'latest-or-create') {
    summary = await sessionIndex.findSessionForAgent(trimmedAgentId);
    if (!summary) {
      const agent = agentRegistry.getAgent(trimmedAgentId);
      const model = getDefaultModelForNewSession(agent);
      const thinking = getDefaultThinkingForNewSession(agent);
      summary = await sessionIndex.createSession(
        model || thinking
          ? {
              agentId: trimmedAgentId,
              ...(model ? { model } : {}),
              ...(thinking ? { thinking } : {}),
            }
          : { agentId: trimmedAgentId },
      );
      created = true;
      sessionHub.broadcastSessionCreated(summary);
    }
  } else {
    const explicitSessionId = resolutionStrategy.trim();
    if (!explicitSessionId) {
      throw new Error('Session id must not be empty');
    }

    const existing = await sessionIndex.getSession(explicitSessionId);
    if (!existing) {
      throw new Error('Session not found');
    }
    if (existing.agentId && existing.agentId !== trimmedAgentId) {
      throw new Error('Session does not belong to this agent');
    }
    summary = existing;
  }

  const sessionId = summary.sessionId;
  const sessionState = await sessionHub.ensureSessionState(sessionId, summary);

  return {
    sessionId,
    sessionState,
    summary,
    created,
  };
}
