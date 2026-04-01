import type { AttachmentToolResult, ChatEvent } from '@assistant/shared';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { SessionHub, SessionIndex } from './index';
import type { EnvConfig } from './envConfig';
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
import type { SearchService } from './search/searchService';
import {
  inferAttachmentContentType,
  inferAttachmentContentTypeFromCandidates,
  resolveAttachmentPreviewType,
  supportsAttachmentOpenInBrowser,
} from './attachments/contentType';

interface AgentMessageArgs {
  agentId: string;
  content: string;
  sessionStrategy: 'latest' | 'create' | 'latest-or-create' | string;
  mode: 'sync' | 'async';
  timeoutSeconds: number;
}

type VoicePromptArgs = {
  text: string;
};

type AttachmentSendArgs =
  | {
      title?: string;
      fileName: string;
      contentType?: string;
      text: string;
    }
  | {
      title?: string;
      fileName: string;
      contentType?: string;
      dataBase64: string;
    }
  | {
      title?: string;
      fileName: string;
      contentType?: string;
      path: string;
    };

const MAX_ATTACHMENT_SIZE_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_PREVIEW_CHARS = 4000;

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

function parseVoicePromptArgs(raw: unknown): VoicePromptArgs {
  const obj = asObject(raw);
  const textRaw = obj['text'];
  if (typeof textRaw !== 'string') {
    throw createToolError('invalid_arguments', 'text is required and must be a string');
  }
  const text = textRaw.trim();
  if (!text) {
    throw createToolError('invalid_arguments', 'text must not be empty');
  }
  return { text };
}

function parseOptionalTrimmedString(obj: Record<string, unknown>, key: string): string | undefined {
  const raw = obj[key];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw createToolError('invalid_arguments', `${key} must be a string when provided`);
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseAttachmentSendArgs(raw: unknown): AttachmentSendArgs {
  const obj = asObject(raw);
  const title = parseOptionalTrimmedString(obj, 'title');
  const fileName = parseOptionalTrimmedString(obj, 'fileName');
  if (!fileName) {
    throw createToolError('invalid_arguments', 'fileName is required and must be a non-empty string');
  }
  const contentType = parseOptionalTrimmedString(obj, 'contentType');

  const hasText = typeof obj['text'] === 'string';
  const hasDataBase64 = typeof obj['dataBase64'] === 'string';
  const hasPath = typeof obj['path'] === 'string';
  const sourceCount = Number(hasText) + Number(hasDataBase64) + Number(hasPath);
  if (sourceCount !== 1) {
    throw createToolError(
      'invalid_arguments',
      'Exactly one of text, dataBase64, or path must be provided',
    );
  }

  if (hasText) {
    return {
      ...(title ? { title } : {}),
      fileName,
      ...(contentType ? { contentType } : {}),
      text: obj['text'] as string,
    };
  }

  if (hasDataBase64) {
    return {
      ...(title ? { title } : {}),
      fileName,
      ...(contentType ? { contentType } : {}),
      dataBase64: obj['dataBase64'] as string,
    };
  }

  const attachmentPath = (obj['path'] as string).trim();
  if (!attachmentPath) {
    throw createToolError('invalid_arguments', 'path must not be empty');
  }
  if (!path.isAbsolute(attachmentPath)) {
    throw createToolError('invalid_arguments', 'path must be an absolute path');
  }
  return {
    ...(title ? { title } : {}),
    fileName,
    ...(contentType ? { contentType } : {}),
    path: attachmentPath,
  };
}

function decodeAttachmentBase64(dataBase64: string): Buffer {
  const normalized = dataBase64.trim().replace(/\s+/g, '');
  const decoded = Buffer.from(normalized, 'base64');
  const canonicalInput = normalized.replace(/=+$/, '');
  const canonicalOutput = decoded.toString('base64').replace(/=+$/, '');
  if (canonicalInput !== canonicalOutput) {
    throw createToolError('invalid_arguments', 'dataBase64 must be valid base64');
  }
  return decoded;
}

function ensureAttachmentSize(size: number): void {
  if (size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw createToolError(
      'attachment_too_large',
      `Attachment exceeds the 4 MB limit (${size} bytes)`,
    );
  }
}

function buildAttachmentRoutePath(sessionId: string, attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(sessionId)}/${encodeURIComponent(attachmentId)}`;
}

async function materializeAttachmentBytes(
  args: AttachmentSendArgs,
): Promise<{ bytes: Buffer; inferredContentType: string }> {
  if ('text' in args) {
    return {
      bytes: Buffer.from(args.text, 'utf8'),
      inferredContentType: inferAttachmentContentTypeFromCandidates(args.fileName),
    };
  }
  if ('dataBase64' in args) {
    return {
      bytes: decodeAttachmentBase64(args.dataBase64),
      inferredContentType: inferAttachmentContentTypeFromCandidates(args.fileName),
    };
  }

  try {
    const stat = await fs.stat(args.path);
    ensureAttachmentSize(stat.size);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw createToolError('not_found', `Attachment path not found: ${args.path}`);
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw createToolError('not_readable', `Attachment path is not readable: ${args.path}`);
    }
    throw err;
  }

  try {
    return {
      bytes: await fs.readFile(args.path),
      inferredContentType: inferAttachmentContentTypeFromCandidates(args.fileName, args.path),
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw createToolError('not_found', `Attachment path not found: ${args.path}`);
    }
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      throw createToolError('not_readable', `Attachment path is not readable: ${args.path}`);
    }
    throw err;
  }
}

function buildAttachmentPreview(options: {
  bytes: Buffer;
  contentType: string;
}): {
  previewType: 'none' | 'text' | 'markdown';
  previewText?: string;
  previewTruncated?: boolean;
} {
  const previewType = resolveAttachmentPreviewType(options.contentType);
  if (previewType === 'none') {
    return { previewType };
  }

  const fullText = options.bytes.toString('utf8');
  const previewText =
    fullText.length > MAX_ATTACHMENT_PREVIEW_CHARS
      ? fullText.slice(0, MAX_ATTACHMENT_PREVIEW_CHARS)
      : fullText;
  return {
    previewType,
    previewText,
    previewTruncated: previewText.length < fullText.length,
  };
}

async function handleAttachmentSend(
  raw: unknown,
  ctx: ToolContext,
  sessionHub: SessionHub,
): Promise<AttachmentToolResult> {
  const sessionId = ctx.sessionId?.trim();
  const turnId = ctx.turnId?.trim();
  const toolCallId = ctx.toolCallId?.trim();
  if (!sessionId || !turnId || !toolCallId) {
    throw createToolError(
      'attachment_context_unavailable',
      'attachment_send requires sessionId, turnId, and toolCallId',
    );
  }

  const store = sessionHub.getAttachmentStore();
  if (!store) {
    throw createToolError('attachments_unavailable', 'Attachment storage is not configured');
  }

  const args = parseAttachmentSendArgs(raw);
  const { bytes, inferredContentType } = await materializeAttachmentBytes(args);
  ensureAttachmentSize(bytes.byteLength);

  const contentType = args.contentType ?? inferredContentType;
  const stored = await store.createAttachment({
    sessionId,
    turnId,
    toolCallId,
    fileName: args.fileName,
    ...(args.title ? { title: args.title } : {}),
    contentType,
    bytes,
  });

  const routePath = buildAttachmentRoutePath(sessionId, stored.attachmentId);
  const preview = buildAttachmentPreview({ bytes, contentType });
  return {
    ok: true,
    attachment: {
      attachmentId: stored.attachmentId,
      fileName: stored.fileName,
      ...(stored.title ? { title: stored.title } : {}),
      contentType: stored.contentType,
      size: stored.size,
      downloadUrl: `${routePath}?download=1`,
      ...(supportsAttachmentOpenInBrowser(stored.contentType)
        ? {
            openUrl: routePath,
            openMode: 'browser_blob' as const,
          }
        : {}),
      previewType: preview.previewType,
      ...(preview.previewText !== undefined ? { previewText: preview.previewText } : {}),
      ...(preview.previewTruncated !== undefined
        ? { previewTruncated: preview.previewTruncated }
        : {}),
    },
  };
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
  eventStore?: EventStore;
  scheduledSessionService?: ScheduledSessionService;
  searchService?: SearchService;
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
        ...(ctx.searchService ? { searchService: ctx.searchService } : {}),
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
      callbackEvent: {
        messageId,
        ...(agent.agentId ? { fromAgentId: agent.agentId } : {}),
        fromSessionId: sessionId,
        result: text,
      },
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
        // Note: We don't pass a chat client here. processUserMessage will use the
        // caller's agent configuration (callerState), ensuring the callback uses
        // the caller's provider, not the target's.
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
      ...(ctx.searchService ? { searchService: ctx.searchService } : {}),
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
      ...(ctx.searchService ? { searchService: ctx.searchService } : {}),
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
      ...(ctx.searchService ? { searchService: ctx.searchService } : {}),
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
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort('timeout'), timeoutMs);
  const timeoutPromise = new Promise<{ kind: 'timeout' }>((resolve) => {
    if (timeoutController.signal.aborted) {
      resolve({ kind: 'timeout' });
      return;
    }
    timeoutController.signal.addEventListener('abort', () => resolve({ kind: 'timeout' }), {
      once: true,
    });
  });

  try {
    const processPromise = processUserMessage({
      sessionId,
      state: sessionState,
      text: parsed.content,
      sessionHub,
      envConfig,
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
      externalAbortSignal: timeoutController.signal,
    });
    const winner = await Promise.race([
      processPromise.then(
        (result) => ({ kind: 'result' as const, result }),
        (err) => ({ kind: 'error' as const, err }),
      ),
      timeoutPromise,
    ]);

    if (winner.kind === 'timeout') {
      void processPromise.catch(() => undefined);
      return {
        ...basePayload,
        mode: 'sync' as const,
        status: 'timeout' as const,
        timeoutSeconds: parsed.timeoutSeconds,
        message: `Request timed out after ${parsed.timeoutSeconds} seconds`,
      };
    }

    if (winner.kind === 'error') {
      throw winner.err;
    }

    const result = winner.result;

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
  } finally {
    clearTimeout(timeoutId);
  }
}

export function registerBuiltInSessionTools(options: {
  host: { registerTool(definition: BuiltInToolDefinition): void };
  sessionHub: SessionHub;
}): void {
  const voicePromptParameters = {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The exact words the user should hear.',
      },
    },
    required: ['text'],
    additionalProperties: false,
  };

  options.host.registerTool({
    name: 'voice_speak',
    description:
      'Speak a one-way update to the user. Use for spoken progress updates, notifications, or confirmations when no spoken reply is expected. Only use this when the user has initiated or requested voice-style interaction.',
    parameters: voicePromptParameters,
    handler: async (args) => {
      parseVoicePromptArgs(args);
      return { accepted: true };
    },
  });

  options.host.registerTool({
    name: 'voice_ask',
    description:
      'Speak a prompt to the user and expect a spoken reply in a later turn. Use this when a spoken reply is expected, and only when the user has initiated or requested voice-style interaction.',
    parameters: voicePromptParameters,
    handler: async (args) => {
      parseVoicePromptArgs(args);
      return { accepted: true };
    },
  });

  options.host.registerTool({
    name: 'attachment_send',
    description:
      'Send a persistent attachment bubble to the user. Stores one attachment owned by this tool call and returns replayable metadata plus download/open paths.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Optional display title shown above the filename.',
        },
        fileName: {
          type: 'string',
          description: 'Required file name presented to the user.',
        },
        contentType: {
          type: 'string',
          description: 'Optional MIME type override. When omitted, it is inferred from fileName or path.',
        },
        text: {
          type: 'string',
          description: 'Inline text content to persist as UTF-8 bytes.',
        },
        dataBase64: {
          type: 'string',
          description: 'Inline base64-encoded file bytes.',
        },
        path: {
          type: 'string',
          description: 'Absolute local file path readable by the server.',
        },
      },
      required: ['fileName'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => handleAttachmentSend(args, ctx, options.sessionHub),
  });
}
