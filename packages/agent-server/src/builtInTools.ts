import type { ChatEvent } from '@assistant/shared';
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';

import type { SessionHub, SessionIndex } from './index';
import { openaiConfigured, type EnvConfig } from './envConfig';
import type { AgentDefinition, AgentRegistry } from './agents';
import type { BuiltInToolDefinition, ToolContext, ToolHost } from './tools';
import { processUserMessage, isSessionBusy } from './chatProcessor';
import { createScopedToolHost } from './tools';
import { handleChatToolCalls as handleChatToolCallsInternal } from './ws/toolCallHandling';
import { resolveAgentSession } from './sessionResolution';
import type { ChatCompletionToolCallState } from './chatCompletionTypes';
import type { EventStore } from './events';
import { appendAndBroadcastChatEvents, createChatEventBase } from './events/chatEventUtils';
import type { SkillSummary } from './skills';
import { resolveAgentToolExposureForHost } from './toolExposure';
import type { ScheduledSessionService } from './scheduledSessions/scheduledSessionService';

interface AgentMessageArgs {
  agentId: string;
  content: string;
  sessionStrategy: 'latest' | 'create' | 'latest-or-create' | string;
  mode: 'sync' | 'async';
  timeoutSeconds: number;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createToolError('invalid_arguments', 'Tool arguments must be an object');
  }
  return value as Record<string, unknown>;
}

function createToolError(code: string, message: string): Error {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

async function getCurrentAgentIdFromContext(
  ctx: ToolContext,
  sessionIndex?: SessionIndex,
): Promise<string | undefined> {
  const effectiveIndex = ctx.sessionIndex ?? sessionIndex;
  const sessionId = ctx.sessionId;

  if (!effectiveIndex || !sessionId) {
    return undefined;
  }

  const summary = await effectiveIndex.getSession(sessionId);
  return summary?.agentId ?? undefined;
}

function matchesAgentPattern(agentId: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }

  if (!pattern.includes('*')) {
    return agentId === pattern;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(agentId);
}

async function ensureAgentVisibleForCurrentSession(
  ctx: ToolContext,
  targetAgentId: string,
  sessionIndex?: SessionIndex,
): Promise<void> {
  const registry = ctx.agentRegistry;
  if (!registry || !targetAgentId) {
    return;
  }

  const targetAgent = registry.getAgent(targetAgentId);
  if (targetAgent && targetAgent.uiVisible === false) {
    throw createToolError('agent_not_accessible', `Agent not accessible: ${targetAgentId}`);
  }

  const fromAgentId = await getCurrentAgentIdFromContext(ctx, sessionIndex);
  if (!fromAgentId) {
    // If we can't resolve a source agent, fall back to full visibility.
    return;
  }

  const sourceAgent = registry.getAgent(fromAgentId);
  if (!sourceAgent) {
    // Unknown agent; fall back to full visibility.
    return;
  }

  const allowlist = sourceAgent.agentAllowlist;
  const denylist = sourceAgent.agentDenylist;

  let visibleAgents = registry.listAgents().filter((agent) => agent.uiVisible !== false);

  if (allowlist && allowlist.length > 0) {
    visibleAgents = visibleAgents.filter((agent) =>
      allowlist.some((pattern) => matchesAgentPattern(agent.agentId, pattern)),
    );
  }

  if (denylist && denylist.length > 0) {
    visibleAgents = visibleAgents.filter(
      (agent) => !denylist.some((pattern) => matchesAgentPattern(agent.agentId, pattern)),
    );
  }

  const isVisible = visibleAgents.some((agent) => agent.agentId === targetAgentId);
  if (!isVisible) {
    throw createToolError('agent_not_accessible', `Agent not accessible: ${targetAgentId}`);
  }
}

function parseAgentMessageArgs(raw: unknown): AgentMessageArgs {
  const obj = asObject(raw);

  const agentIdRaw = obj['agentId'];
  if (typeof agentIdRaw !== 'string') {
    throw createToolError('invalid_arguments', 'agentId is required and must be a string');
  }
  const agentId = agentIdRaw.trim();
  if (!agentId) {
    throw createToolError('invalid_arguments', 'agentId must not be empty');
  }

  const contentRaw = obj['content'];
  if (typeof contentRaw !== 'string') {
    throw createToolError('invalid_arguments', 'content is required and must be a string');
  }
  const content = contentRaw.trim();
  if (!content) {
    throw createToolError('invalid_arguments', 'content must not be empty');
  }

  let sessionStrategy: AgentMessageArgs['sessionStrategy'] = 'latest-or-create';
  if ('session' in obj) {
    const sessionRaw = obj['session'];
    if (typeof sessionRaw === 'string') {
      const trimmed = sessionRaw.trim();
      if (!trimmed) {
        throw createToolError('invalid_arguments', 'session must not be empty when provided');
      }
      sessionStrategy = trimmed;
    } else if (sessionRaw !== undefined) {
      throw createToolError(
        'invalid_arguments',
        'session must be a string when provided (for example "latest", "create", "latest-or-create", or a specific session id)',
      );
    }
  }

  let mode: AgentMessageArgs['mode'] = 'sync';
  if ('mode' in obj) {
    const modeRaw = obj['mode'];
    if (modeRaw === 'sync' || modeRaw === 'async') {
      mode = modeRaw;
    } else if (modeRaw !== undefined) {
      throw createToolError('invalid_arguments', 'mode must be "sync" or "async" when provided');
    }
  }

  let timeoutSeconds = 300;
  if ('timeout' in obj) {
    const timeoutRaw = obj['timeout'];
    if (typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw) && timeoutRaw > 0) {
      timeoutSeconds = Math.floor(timeoutRaw);
    } else if (timeoutRaw !== undefined) {
      throw createToolError(
        'invalid_arguments',
        'timeout must be a positive number of seconds when provided',
      );
    }
  }

  return { agentId, content, sessionStrategy, mode, timeoutSeconds };
}

interface AsyncAgentMessageContext {
  sessionId: string;
  sessionState: Awaited<ReturnType<SessionHub['ensureSessionState']>>;
  content: string;
  responseId: string;
  messageId: string;
  fromSessionId: string | undefined;
  fromAgentId: string | undefined;
  agent: AgentDefinition;
  agentRegistry: AgentRegistry;
  baseToolHost: ToolHost;
  scopedToolHost: ToolHost;
  chatTools: unknown[];
  availableTools?: Awaited<ReturnType<ToolHost['listTools']>>;
  availableSkills?: SkillSummary[];
  sessionHub: SessionHub;
  envConfig: EnvConfig;
  openaiClient?: OpenAI;
  eventStore?: EventStore;
  scheduledSessionService?: ScheduledSessionService;
  handleChatToolCalls: (
    runSessionId: string,
    runState: Awaited<ReturnType<SessionHub['ensureSessionState']>>,
    toolCalls: ChatCompletionToolCallState[],
  ) => Promise<void>;
}

/**
 * Execute an async agent message and handle the callback to the caller.
 * This is used for both immediate async calls and queued messages.
 */
async function executeAsyncAgentMessage(ctx: AsyncAgentMessageContext): Promise<void> {
  const {
    sessionId,
    sessionState,
    content,
    responseId,
    messageId,
    fromSessionId,
    fromAgentId,
    agent,
    agentRegistry,
    baseToolHost,
    chatTools,
    availableTools,
    availableSkills,
    sessionHub,
    envConfig,
    openaiClient,
    eventStore,
    handleChatToolCalls,
  } = ctx;

  const result = await processUserMessage({
    sessionId,
    state: sessionState,
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
    ...(fromSessionId
      ? {
          agentMessageContext: {
            fromSessionId,
            ...(fromAgentId ? { fromAgentId } : {}),
            responseId,
          },
        }
      : {}),
  });

  const text = result.response.trim();
  if (!text || !fromSessionId) {
    return;
  }

  if (eventStore && fromSessionId.trim()) {
    const callerSessionId = fromSessionId.trim();
    const events: ChatEvent[] = [
      {
        ...createChatEventBase({
          sessionId: callerSessionId,
        }),
        type: 'agent_callback',
        payload: {
          messageId,
          fromAgentId: agent.agentId,
          fromSessionId: sessionId,
          result: text,
        },
      },
    ];
    void appendAndBroadcastChatEvents(
      {
        eventStore,
        sessionHub,
        sessionId: callerSessionId,
      },
      events,
    );
  }

  // Broadcast callback result to caller session
  try {
    const callerSessionId = fromSessionId.trim();
    if (callerSessionId) {
      console.log('[agents_message async] broadcasting agent_callback_result', {
        callerSessionId,
        responseId: result.responseId,
        textLength: text.length,
      });
      sessionHub.broadcastToSession(callerSessionId, {
        type: 'agent_callback_result',
        sessionId: callerSessionId,
        responseId: result.responseId,
        result: text,
      });
    }
  } catch (err) {
    console.error('[agents_message async] error while broadcasting agent_callback_result', err);
  }

  // Trigger callback turn in caller session
  try {
    const callerSessionId = fromSessionId.trim();
    if (!callerSessionId) {
      return;
    }

    const callerState = await sessionHub.ensureSessionState(callerSessionId);

    if (callerState.deleted || callerState.summary.deleted) {
      console.warn('[agents_message async] skipping callback for deleted caller session', {
        callerSessionId,
        fromSessionId: sessionId,
      });
      return;
    }

    const callerAgentId = callerState.summary.agentId;
    const callerAgent = callerAgentId ? agentRegistry.getAgent(callerAgentId) : undefined;

    const callerScopedToolHost =
      callerAgent && baseToolHost
        ? createScopedToolHost(
            baseToolHost,
            callerAgent.toolAllowlist,
            callerAgent.toolDenylist,
            callerAgent.capabilityAllowlist,
            callerAgent.capabilityDenylist,
          )
        : baseToolHost;

    const {
      availableTools: callerAvailableTools,
      chatTools: callerChatTools,
      availableSkills: callerAvailableSkills,
    } = callerScopedToolHost
      ? await resolveAgentToolExposureForHost({
          scopedToolHost: callerScopedToolHost,
          agent: callerAgent,
          sessionHub,
        })
      : { availableTools: [], chatTools: [], availableSkills: [] };

    const handleCallerChatToolCalls = async (
      runSessionId: string,
      runState: typeof callerState,
      toolCalls: ChatCompletionToolCallState[],
    ) => {
      if (!baseToolHost || !callerScopedToolHost) {
        return;
      }
      return handleChatToolCallsInternal({
        sessionId: runSessionId,
        state: runState,
        toolCalls,
        baseToolHost,
        sessionToolHost: callerScopedToolHost,
        sessionHub,
        envConfig,
        ...(eventStore ? { eventStore } : {}),
        ...(ctx.scheduledSessionService
          ? { scheduledSessionService: ctx.scheduledSessionService }
          : {}),
        maxToolCallsPerMinute: envConfig.maxToolCallsPerMinute,
        rateLimitWindowMs: 60_000,
        sendError: (code, message, details, options) => {
          console.error('[agents_message callback tools error]', {
            code,
            message,
            details,
            options,
          });
        },
        log: () => {
          // Callback tool logs are intentionally suppressed
        },
      });
    };

    const callbackText = `[Async response, responseId=${result.responseId}]: ${text}`;
    const callbackAgentMessageContext = {
      fromSessionId: sessionId,
      ...(agent.agentId ? { fromAgentId: agent.agentId } : {}),
      responseId: result.responseId,
      // Use 'callback' to emit ChatEvents for response but hide callback input text
      logType: 'callback' as const,
    };

    const executeCallback = async () => {
      try {
        console.log('[agents_message async] starting callback turn', {
          callerSessionId,
          fromSessionId: sessionId,
          responseId: result.responseId,
        });
        // Note: We don't pass openaiClient here. processUserMessage will create the
        // appropriate client based on the caller's agent configuration (callerState).
        // This ensures the callback uses the caller's provider, not the target's.
        await processUserMessage({
          sessionId: callerSessionId,
          state: callerState,
          text: callbackText,
          sessionHub,
          envConfig,
          chatCompletionTools: callerChatTools,
          ...(callerAvailableTools !== undefined ? { availableTools: callerAvailableTools } : {}),
          ...(callerAvailableSkills ? { availableSkills: callerAvailableSkills } : {}),
          handleChatToolCalls: handleCallerChatToolCalls,
          outputMode: 'text',
          ttsBackendFactory: null,
          agentMessageContext: callbackAgentMessageContext,
          ...(eventStore ? { eventStore } : {}),
        });
      } catch (err) {
        console.error('[agents_message async] error while processing callback turn', err);
      }
    };

    if (baseToolHost && callerScopedToolHost) {
      await sessionHub.queueMessage({
        sessionId: callerSessionId,
        text: callbackText,
        source: 'agent',
        fromAgentId: agent.agentId,
        fromSessionId: sessionId,
        execute: executeCallback,
      });
      await sessionHub.processNextQueuedMessage(callerSessionId);
    }
  } catch (err) {
    console.error(
      '[agents_message async] error while triggering callback turn in caller session',
      err,
    );
  }
}

export async function handleAgentMessage(
  args: unknown,
  ctx: ToolContext,
  sessionIndex: SessionIndex,
  sessionHub: SessionHub,
): Promise<unknown> {
  const envConfig = ctx.envConfig;
  const baseToolHost = ctx.baseToolHost;
  const eventStore = ctx.eventStore;

  if (!envConfig || !baseToolHost) {
    throw createToolError(
      'agent_message_not_supported',
      'agents_message is not available in this context',
    );
  }

  const parsed = parseAgentMessageArgs(args);

  const agentRegistry = ctx.agentRegistry ?? sessionHub.getAgentRegistry();
  const agent = agentRegistry.getAgent(parsed.agentId);
  if (!agent) {
    throw createToolError('agent_not_found', `Agent not found: ${parsed.agentId}`);
  }

  const provider =
    agent.chat &&
    (agent.chat.provider === 'claude-cli' ||
      agent.chat.provider === 'codex-cli' ||
      agent.chat.provider === 'pi-cli' ||
      agent.chat.provider === 'openai-compatible')
      ? agent.chat.provider
      : 'openai';

  if (provider === 'openai' && !openaiConfigured(envConfig)) {
    throw createToolError(
      'agent_not_available',
      `Agent "${agent.agentId}" requires OpenAI, but OpenAI is not configured. ` +
        'Set OPENAI_API_KEY and OPENAI_CHAT_MODEL to use this agent.',
    );
  }

  const effectiveSessionIndex = ctx.sessionIndex ?? sessionIndex;
  if (!effectiveSessionIndex) {
    throw createToolError(
      'session_index_unavailable',
      'Session index is not available in this context',
    );
  }

  await ensureAgentVisibleForCurrentSession(ctx, parsed.agentId, effectiveSessionIndex);

  const fromSessionId = ctx.sessionId;
  const fromAgentId = await getCurrentAgentIdFromContext(ctx, sessionIndex);
  const messageId = randomUUID();

  let resolved;
  try {
    resolved = await resolveAgentSession(
      parsed.agentId,
      parsed.sessionStrategy,
      effectiveSessionIndex,
      sessionHub,
      agentRegistry,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message === 'Agent not found' ||
      message === 'No existing session for agent' ||
      message === 'Session not found'
    ) {
      throw createToolError('agent_session_error', message);
    }
    if (
      message === 'Session does not belong to this agent' ||
      message === 'Session id must not be empty'
    ) {
      throw createToolError('invalid_arguments', message);
    }
    throw createToolError('agent_session_error', message);
  }

  const { sessionId, sessionState, summary, created } = resolved;

  if (eventStore && fromSessionId && fromSessionId.trim()) {
    const callerSessionId = fromSessionId.trim();
    const events: ChatEvent[] = [
      {
        ...createChatEventBase({
          sessionId: callerSessionId,
          ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
          ...(ctx.responseId ? { responseId: ctx.responseId } : {}),
        }),
        type: 'agent_message',
        payload: {
          messageId,
          targetAgentId: agent.agentId,
          targetSessionId: sessionId,
          message: parsed.content,
          wait: parsed.mode !== 'async',
        },
      },
    ];
    void appendAndBroadcastChatEvents(
      {
        eventStore,
        sessionHub,
        sessionId: callerSessionId,
      },
      events,
    );
  }

  const scopedToolHost = createScopedToolHost(
    baseToolHost,
    agent.toolAllowlist,
    agent.toolDenylist,
    agent.capabilityAllowlist,
    agent.capabilityDenylist,
  );

  const { availableTools, chatTools, availableSkills } = await resolveAgentToolExposureForHost({
    scopedToolHost,
    agent,
    sessionHub,
  });

  const openaiClient =
    provider === 'openai' && envConfig.apiKey
      ? new OpenAI({ apiKey: envConfig.apiKey })
      : undefined;

  // Forward tool output chunks to the caller session if we have the caller's tool call ID
  const forwardChunksTo =
    fromSessionId && ctx.toolCallId
      ? { sessionId: fromSessionId, toolCallId: ctx.toolCallId }
      : undefined;

  const handleChatToolCalls = async (
    runSessionId: string,
    runState: typeof sessionState,
    toolCalls: ChatCompletionToolCallState[],
  ) => {
    return handleChatToolCallsInternal({
      sessionId: runSessionId,
      state: runState,
      toolCalls,
      baseToolHost,
      sessionToolHost: scopedToolHost,
      sessionHub,
      envConfig,
      ...(eventStore ? { eventStore } : {}),
      ...(forwardChunksTo ? { forwardChunksTo } : {}),
      ...(ctx.scheduledSessionService
        ? { scheduledSessionService: ctx.scheduledSessionService }
        : {}),
      maxToolCallsPerMinute: envConfig.maxToolCallsPerMinute,
      rateLimitWindowMs: 60_000,
      sendError: (code, message, details, options) => {
        console.error('[agents_message tools error]', { code, message, details, options });
      },
      log: (...toolArgs) => {
        console.log('[agents_message tools]', ...toolArgs);
      },
    });
  };

  const basePayload = {
    agentId: agent.agentId,
    sessionId,
    sessionName: summary.name ?? sessionId,
    created,
  };

  if (isSessionBusy(sessionState)) {
    const responseId = randomUUID();

    const asyncContext: AsyncAgentMessageContext = {
      sessionId,
      sessionState,
      content: parsed.content,
      responseId,
      messageId,
      fromSessionId,
      fromAgentId,
      agent,
      agentRegistry,
      baseToolHost,
      scopedToolHost,
      chatTools,
      availableTools,
      ...(availableSkills ? { availableSkills } : {}),
      sessionHub,
      envConfig,
      ...(eventStore ? { eventStore } : {}),
      ...(openaiClient ? { openaiClient } : {}),
      ...(ctx.scheduledSessionService
        ? { scheduledSessionService: ctx.scheduledSessionService }
        : {}),
      handleChatToolCalls,
    };

    await sessionHub.queueMessage({
      sessionId,
      text: parsed.content,
      source: 'agent',
      ...(fromAgentId ? { fromAgentId } : {}),
      ...(fromSessionId ? { fromSessionId } : {}),
      execute: async () => {
        try {
          await executeAsyncAgentMessage(asyncContext);
        } catch (err) {
          console.error('[agents_message queued] error while processing message', err);
        }
      },
    });

    if (parsed.mode === 'async') {
      return {
        ...basePayload,
        mode: 'async' as const,
        status: 'queued' as const,
        responseId,
        messageId,
      };
    }

    return {
      ...basePayload,
      mode: 'sync' as const,
      status: 'queued' as const,
      responseId,
      messageId,
    };
  }

  if (parsed.mode === 'async') {
    const responseId = randomUUID();

    const asyncContext: AsyncAgentMessageContext = {
      sessionId,
      sessionState,
      content: parsed.content,
      responseId,
      messageId,
      fromSessionId,
      fromAgentId,
      agent,
      agentRegistry,
      baseToolHost,
      scopedToolHost,
      chatTools,
      availableTools,
      ...(availableSkills ? { availableSkills } : {}),
      sessionHub,
      envConfig,
      ...(eventStore ? { eventStore } : {}),
      ...(openaiClient ? { openaiClient } : {}),
      ...(ctx.scheduledSessionService
        ? { scheduledSessionService: ctx.scheduledSessionService }
        : {}),
      handleChatToolCalls,
    };

    void (async () => {
      try {
        await executeAsyncAgentMessage(asyncContext);
      } catch (err) {
        console.error('[agents_message async] error while processing message', err);
      }
    })();

    return {
      ...basePayload,
      mode: 'async' as const,
      status: 'started' as const,
      responseId,
      messageId,
    };
  }

  const timeoutMs = parsed.timeoutSeconds * 1000;
  const timeoutPromise = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs),
  );

  try {
    const winner = await Promise.race([
      processUserMessage({
        sessionId,
        state: sessionState,
        text: parsed.content,
        sessionHub,
        envConfig,
        ...(openaiClient ? { openaiClient } : {}),
        chatCompletionTools: chatTools,
        ...(availableTools !== undefined ? { availableTools } : {}),
        ...(availableSkills ? { availableSkills } : {}),
        handleChatToolCalls,
        outputMode: 'text',
        ttsBackendFactory: null,
        agentMessageContext: {
          fromSessionId,
          ...(fromAgentId ? { fromAgentId } : {}),
        },
        ...(eventStore ? { eventStore } : {}),
      }),
      timeoutPromise,
    ]);

    if (winner === 'timeout') {
      return {
        ...basePayload,
        mode: 'sync' as const,
        status: 'timeout' as const,
        timeoutSeconds: parsed.timeoutSeconds,
        message: `Request timed out after ${parsed.timeoutSeconds} seconds`,
      };
    }

    const result = winner;

    return {
      ...basePayload,
      mode: 'sync' as const,
      status: 'complete' as const,
      responseId: result.responseId,
      response: result.response,
      truncated: result.truncated,
      durationMs: result.durationMs,
      toolCallCount: result.toolCallCount,
      toolCalls: result.toolCalls,
      ...(result.thinkingText ? { thinkingText: result.thinkingText } : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw createToolError('agent_message_failed', message);
  }
}

export function registerBuiltInSessionTools(options: {
  host: { registerTool(definition: BuiltInToolDefinition): void };
  sessionHub: SessionHub;
}): void {
  void options;
}
