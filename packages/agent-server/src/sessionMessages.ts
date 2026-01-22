import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';

import type { AgentDefinition, AgentRegistry } from './agents';
import { processUserMessage, isSessionBusy } from './chatProcessor';
import type { ChatCompletionToolCallState } from './chatCompletionTypes';
import type { EnvConfig } from './envConfig';
import { openaiConfigured } from './envConfig';
import type { EventStore } from './events';
import type { SessionHub } from './sessionHub';
import type { SessionIndex, SessionSummary } from './sessionIndex';
import type { SearchService } from './search/searchService';
import { ToolError, createScopedToolHost } from './tools';
import type { ToolHost } from './tools';
import { resolveAgentToolExposureForHost } from './toolExposure';
import { handleChatToolCalls as handleChatToolCallsInternal } from './ws/toolCallHandling';
import { deliverWebhook } from './webhookDelivery';
import type { ScheduledSessionService } from './scheduledSessions/scheduledSessionService';

export type SessionMessageWebhook = {
  url: string;
  headers?: Record<string, string>;
};

export type SessionMessageInput = {
  sessionId: string;
  content: string;
  mode: 'sync' | 'async';
  timeoutSeconds: number;
  webhook?: SessionMessageWebhook;
};

type SessionMessageBase = {
  sessionId: string;
  sessionName: string;
  agentId: string | null;
  created: false;
};

export type SessionMessageResponse =
  | (SessionMessageBase & {
      status: 'started';
      responseId: string;
    })
  | (SessionMessageBase & {
      status: 'complete';
      responseId: string;
      response: string;
      truncated: boolean;
      durationMs: number;
      toolCallCount: number;
      toolCalls: unknown[];
    })
  | (SessionMessageBase & {
      status: 'timeout';
      timeoutSeconds: number;
      message: string;
    })
  | (SessionMessageBase & {
      status: 'error';
      responseId: string;
      error: string;
      durationMs: number;
    })
  | (SessionMessageBase & {
      status: 'busy';
      code: 'session_busy';
      message: string;
    });

export type SessionMessageStartResult = {
  response: SessionMessageResponse;
  asyncTask?: Promise<void>;
};

type SessionToolContext = {
  summary: SessionSummary;
  agent: AgentDefinition | undefined;
  state: Awaited<ReturnType<SessionHub['ensureSessionState']>>;
  scopedToolHost: ToolHost;
  chatTools: unknown[];
  availableTools: Awaited<ReturnType<ToolHost['listTools']>> | undefined;
  availableSkills:
    | Awaited<ReturnType<typeof resolveAgentToolExposureForHost>>['availableSkills']
    | undefined;
};

function requireSessionSummary(
  sessionIndex: SessionIndex,
  sessionId: string,
): Promise<SessionSummary> {
  return sessionIndex.getSession(sessionId).then((summary) => {
    if (!summary) {
      throw new ToolError('session_not_found', `Session not found: ${sessionId}`);
    }
    return summary;
  });
}

async function buildSessionToolContext(options: {
  sessionId: string;
  sessionIndex: SessionIndex;
  sessionHub: SessionHub;
  agentRegistry: AgentRegistry;
  toolHost: ToolHost;
}): Promise<SessionToolContext> {
  const { sessionId, sessionIndex, sessionHub, agentRegistry, toolHost } = options;
  const summary = await requireSessionSummary(sessionIndex, sessionId);
  const state = await sessionHub.ensureSessionState(sessionId, summary);
  const agentId = state.summary.agentId;
  const agent = agentId ? agentRegistry.getAgent(agentId) : undefined;
  const scopedToolHost = agent
    ? createScopedToolHost(
        toolHost,
        agent.toolAllowlist,
        agent.toolDenylist,
        agent.capabilityAllowlist,
        agent.capabilityDenylist,
      )
    : toolHost;

  let chatTools: unknown[] = [];
  let availableTools: Awaited<ReturnType<ToolHost['listTools']>> | undefined;
  let availableSkills:
    | Awaited<ReturnType<typeof resolveAgentToolExposureForHost>>['availableSkills']
    | undefined;
  try {
    const exposure = await resolveAgentToolExposureForHost({
      scopedToolHost,
      agent,
      sessionHub,
    });
    availableTools = exposure.availableTools;
    availableSkills = exposure.availableSkills;
    chatTools = exposure.chatTools;
  } catch {
    availableTools = undefined;
    availableSkills = undefined;
    chatTools = [];
  }

  return {
    summary,
    agent,
    state,
    scopedToolHost,
    chatTools,
    availableTools,
    availableSkills,
  };
}

export async function startSessionMessage(options: {
  input: SessionMessageInput;
  sessionIndex: SessionIndex;
  sessionHub: SessionHub;
  agentRegistry?: AgentRegistry;
  toolHost: ToolHost;
  envConfig: EnvConfig;
  eventStore?: EventStore;
  scheduledSessionService?: ScheduledSessionService;
  searchService?: SearchService;
}): Promise<SessionMessageStartResult> {
  const { input, sessionIndex, sessionHub, toolHost, envConfig, eventStore } = options;

  const content = input.content;
  if (!content.trim()) {
    throw new ToolError('invalid_arguments', 'content must be a non-empty string');
  }

  const agentRegistry = options.agentRegistry ?? sessionHub.getAgentRegistry();

  const { summary, state, scopedToolHost, chatTools, availableTools, availableSkills } =
    await buildSessionToolContext({
      sessionId: input.sessionId,
      sessionIndex,
      sessionHub,
      agentRegistry,
      toolHost,
    });

  const basePayload: SessionMessageBase = {
    sessionId: input.sessionId,
    sessionName: summary.name ?? input.sessionId,
    agentId: summary.agentId ?? null,
    created: false,
  };

  if (isSessionBusy(state)) {
    return {
      response: {
        ...basePayload,
        status: 'busy',
        code: 'session_busy',
        message:
          'Agent is currently processing another message. Please wait or try a different session.',
      },
    };
  }

  const openaiClient =
    openaiConfigured(envConfig) && envConfig.apiKey
      ? new OpenAI({ apiKey: envConfig.apiKey })
      : undefined;

  const handleChatToolCalls = async (
    runSessionId: string,
    runState: typeof state,
    toolCalls: ChatCompletionToolCallState[],
  ) => {
    return handleChatToolCallsInternal({
      sessionId: runSessionId,
      state: runState,
      toolCalls,
      baseToolHost: toolHost,
      sessionToolHost: scopedToolHost,
      sessionHub,
      envConfig,
      ...(eventStore ? { eventStore } : {}),
      ...(options.searchService ? { searchService: options.searchService } : {}),
      ...(options.scheduledSessionService
        ? { scheduledSessionService: options.scheduledSessionService }
        : {}),
      maxToolCallsPerMinute: envConfig.maxToolCallsPerMinute,
      rateLimitWindowMs: 60_000,
      sendError: (code, message, details, toolOptions) => {
        console.error('[sessions_message tools error]', { code, message, details, toolOptions });
      },
      log: (...args) => {
        console.log('[sessions_message tools]', ...args);
      },
    });
  };

  if (input.mode === 'sync') {
    const timeoutMs = input.timeoutSeconds * 1000;
    const timeoutPromise = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), timeoutMs),
    );

    try {
      const winner = await Promise.race([
        processUserMessage({
          sessionId: input.sessionId,
          state,
          text: content,
          sessionHub,
          envConfig,
          ...(openaiClient ? { openaiClient } : {}),
          chatCompletionTools: chatTools,
          ...(availableTools !== undefined ? { availableTools } : {}),
          ...(availableSkills ? { availableSkills } : {}),
          handleChatToolCalls,
          outputMode: 'text',
          ttsBackendFactory: null,
          ...(eventStore ? { eventStore } : {}),
        }),
        timeoutPromise,
      ]);

      if (winner === 'timeout') {
        return {
          response: {
            ...basePayload,
            status: 'timeout',
            timeoutSeconds: input.timeoutSeconds,
            message: `Request timed out after ${input.timeoutSeconds} seconds`,
          },
        };
      }

      const result = winner;

      return {
        response: {
          ...basePayload,
          status: 'complete',
          responseId: result.responseId,
          response: result.response,
          truncated: result.truncated,
          durationMs: result.durationMs,
          toolCallCount: result.toolCallCount,
          toolCalls: result.toolCalls,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        response: {
          ...basePayload,
          status: 'error',
          responseId: randomUUID(),
          error: message,
          durationMs: 0,
        },
      };
    }
  }

  const responseId = randomUUID();
  const response: SessionMessageResponse = {
    ...basePayload,
    status: 'started',
    responseId,
  };

  const asyncTask = (async () => {
    try {
      const result = await processUserMessage({
        sessionId: input.sessionId,
        state,
        text: content,
        responseId,
        sessionHub,
        envConfig,
        ...(openaiClient ? { openaiClient } : {}),
        chatCompletionTools: chatTools,
        ...(availableTools !== undefined ? { availableTools } : {}),
        ...(availableSkills ? { availableSkills } : {}),
        handleChatToolCalls,
        outputMode: 'text',
        ttsBackendFactory: null,
        ...(eventStore ? { eventStore } : {}),
      });

      if (input.webhook) {
        await deliverWebhook(input.webhook, {
          sessionId: input.sessionId,
          sessionName: summary.name ?? input.sessionId,
          agentId: summary.agentId ?? null,
          responseId: result.responseId,
          status: 'complete',
          toolCallCount: result.toolCallCount,
          toolCalls: result.toolCalls,
          response: result.response,
          truncated: result.truncated,
          error: null,
          durationMs: result.durationMs,
        });
      }
    } catch (err) {
      if (input.webhook) {
        const message = err instanceof Error ? err.message : String(err);
        await deliverWebhook(input.webhook, {
          sessionId: input.sessionId,
          sessionName: summary.name ?? input.sessionId,
          agentId: summary.agentId ?? null,
          responseId,
          status: 'error',
          toolCallCount: 0,
          toolCalls: [],
          response: '',
          truncated: false,
          error: message,
          durationMs: 0,
        });
      }
    }
  })();

  return { response, asyncTask };
}
