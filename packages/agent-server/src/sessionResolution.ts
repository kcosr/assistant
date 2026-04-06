import type { SessionConfig } from '@assistant/shared';

import type { AgentRegistry } from './agents';
import { buildSessionAttributesPatchFromConfig, resolveSessionConfigForAgent } from './sessionConfig';
import type { LogicalSessionState, SessionHub } from './sessionHub';
import type { SessionIndex, SessionSummary } from './sessionIndex';
import { getDefaultModelForNewSession, getDefaultThinkingForNewSession } from './sessionModel';

export interface SessionResolutionResult {
  sessionId: string;
  sessionState: LogicalSessionState;
  summary: SessionSummary;
  created: boolean;
}

async function createSessionForAgent(
  trimmedAgentId: string,
  agentRegistry: AgentRegistry,
  sessionIndex: SessionIndex,
  sessionConfig?: SessionConfig,
): Promise<SessionSummary> {
  const agent = agentRegistry.getAgent(trimmedAgentId);

  if (sessionConfig) {
    const resolved = await resolveSessionConfigForAgent({ agent, sessionConfig });
    const model = resolved.model ?? getDefaultModelForNewSession(agent);
    const thinking = resolved.thinking ?? getDefaultThinkingForNewSession(agent);
    const attributes = buildSessionAttributesPatchFromConfig(resolved);
    return sessionIndex.createSession({
      agentId: trimmedAgentId,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      ...(resolved.sessionTitle ? { name: resolved.sessionTitle } : {}),
      ...(attributes ? { attributes } : {}),
    });
  }

  const model = getDefaultModelForNewSession(agent);
  const thinking = getDefaultThinkingForNewSession(agent);
  return sessionIndex.createSession({
    agentId: trimmedAgentId,
    ...(model ? { model } : {}),
    ...(thinking ? { thinking } : {}),
  });
}

export async function resolveAgentSession(
  agentId: string,
  strategy: 'latest' | 'create' | 'latest-or-create' | string,
  sessionIndex: SessionIndex,
  sessionHub: SessionHub,
  agentRegistry: AgentRegistry,
  sessionConfig?: SessionConfig,
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
    summary = await createSessionForAgent(trimmedAgentId, agentRegistry, sessionIndex, sessionConfig);
    created = true;
    sessionHub.broadcastSessionCreated(summary);
  } else if (resolutionStrategy === 'latest-or-create') {
    summary = await sessionIndex.findSessionForAgent(trimmedAgentId);
    if (!summary) {
      summary = await createSessionForAgent(trimmedAgentId, agentRegistry, sessionIndex, sessionConfig);
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
