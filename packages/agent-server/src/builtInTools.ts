import type { AttachmentToolResult, ChatEvent, SessionConfig } from '@assistant/shared';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { SessionHub, SessionIndex } from './index';
import type { EnvConfig } from './envConfig';
import type { AgentDefinition, AgentRegistry } from './agents';
import type { AgentTool, BuiltInToolDefinition, ToolContext, ToolHost } from './tools';
import { processUserMessage, isSessionBusy } from './chatProcessor';
import { createScopedToolHost } from './tools';
import { resolveSessionWorkingDir } from './tools/sessionWorkingDir';
import { handleChatToolCalls as handleChatToolCallsInternal } from './ws/toolCallHandling';
import { resolveAgentSession } from './sessionResolution';
import type { ChatCompletionToolCallState } from './chatCompletionTypes';
import type { EventStore } from './events';
import { appendAndBroadcastChatEvents, createChatEventBase } from './events/chatEventUtils';
import { parseSessionConfigInput } from './sessionConfig';
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
import {
  DEFAULT_ATTACHMENT_PREVIEW_SNIPPET_CHARS,
  MAX_ATTACHMENT_SIZE_BYTES,
  formatAttachmentTooLargeMessage,
} from './attachments/constants';
import { createNotificationRecord } from '../../plugins/core/notifications/server/service';

interface AgentMessageArgs {
  agentId: string;
  content: string;
  sessionStrategy: 'latest' | 'create' | 'latest-or-create' | string;
  mode: 'sync' | 'async';
  timeoutSeconds: number;
  sessionConfig?: SessionConfig;
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

async function publishVoiceToolNotification(options: {
  ctx: ToolContext;
  text: string;
  toolName: 'voice_speak' | 'voice_ask';
}): Promise<void> {
  const { ctx, text, toolName } = options;
  if (!ctx.sessionId) {
    return;
  }
  try {
    const stateSummary =
      ctx.sessionHub?.getSessionState(ctx.sessionId)?.summary ??
      (ctx.sessionIndex ? await ctx.sessionIndex.getSession(ctx.sessionId) : null);
    const sessionActivitySeq =
      typeof stateSummary?.revision === 'number' ? Math.max(0, stateSummary.revision) : null;
    await createNotificationRecord({
      input: {
        kind: 'notification',
        title: toolName === 'voice_ask' ? 'Spoken prompt' : 'Spoken update',
        body: text,
        sessionId: ctx.sessionId,
        tts: true,
        voiceMode: toolName === 'voice_ask' ? 'speak_then_listen' : 'speak',
        ttsText: text,
        ...(ctx.toolCallId ? { sourceEventId: ctx.toolCallId } : {}),
        ...(sessionActivitySeq !== null ? { sessionActivitySeq } : {}),
      },
      source: 'tool',
      sessionHub: ctx.sessionHub,
      sessionIndex: ctx.sessionIndex,
    });
  } catch {
    // Notifications are optional for voice tools; the transcript tool-call path still exists.
  }
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
    throw createToolError('attachment_too_large', formatAttachmentTooLargeMessage(size));
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

async function resolveAttachmentPath(
  rawPath: string,
  ctx: ToolContext,
): Promise<string> {
  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  const workingDir = await resolveSessionWorkingDir(ctx);
  if (workingDir) {
    return path.resolve(workingDir, rawPath);
  }

  throw createToolError(
    'invalid_arguments',
    'Relative attachment paths require a session working directory',
  );
}

function buildAttachmentPreview(options: {
  bytes: Buffer;
  contentType: string;
  maxChars: number;
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
    fullText.length > options.maxChars
      ? fullText.slice(0, options.maxChars)
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
  previewCharLimit: number,
): Promise<AttachmentToolResult> {
  const sessionId = ctx.sessionId?.trim();
  const requestId = ctx.requestId?.trim();
  const toolCallId = ctx.toolCallId?.trim();
  if (!sessionId || !requestId || !toolCallId) {
    throw createToolError(
      'attachment_context_unavailable',
      'attachment_send requires sessionId, requestId, and toolCallId',
    );
  }

  const store = sessionHub.getAttachmentStore();
  if (!store) {
    throw createToolError('attachments_unavailable', 'Attachment storage is not configured');
  }

  const args = parseAttachmentSendArgs(raw);
  const resolvedArgs =
    'path' in args
      ? {
          ...args,
          path: await resolveAttachmentPath(args.path, ctx),
        }
      : args;
  const { bytes, inferredContentType } = await materializeAttachmentBytes(resolvedArgs);
  ensureAttachmentSize(bytes.byteLength);

  const contentType = resolvedArgs.contentType ?? inferredContentType;
  const stored = await store.createAttachment({
    sessionId,
    requestId,
    toolCallId,
    fileName: resolvedArgs.fileName,
    ...(resolvedArgs.title ? { title: resolvedArgs.title } : {}),
    contentType,
    bytes,
  });

  const routePath = buildAttachmentRoutePath(sessionId, stored.attachmentId);
  const preview = buildAttachmentPreview({
    bytes,
    contentType,
    maxChars: previewCharLimit,
  });
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

  let sessionConfig: SessionConfig | undefined;
  if ('sessionConfig' in obj) {
    try {
      const parsed = parseSessionConfigInput({
        value: obj['sessionConfig'],
        allowSessionTitle: false,
      });
      if (parsed) {
        sessionConfig = parsed;
      }
    } catch (err) {
      throw createToolError('invalid_arguments', (err as Error).message);
    }
  }

  const result: AgentMessageArgs = { agentId, content, sessionStrategy, mode, timeoutSeconds };
  if (sessionConfig) {
    result.sessionConfig = sessionConfig;
  }
  return result;
}

interface AsyncAgentMessageContext {
  sessionId: string;
  sessionState: Awaited<ReturnType<SessionHub['ensureSessionState']>>;
  content: string;
  exchangeId: string;
  responseId: string;
  messageId: string;
  fromSessionId: string | undefined;
  fromAgentId: string | undefined;
  agent: AgentDefinition;
  agentRegistry: AgentRegistry;
  baseToolHost: ToolHost;
  scopedToolHost: ToolHost;
  chatTools: unknown[];
  agentTools: AgentTool[];
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
    exchangeId,
    responseId,
    messageId,
    fromSessionId,
    fromAgentId,
    agent,
    agentRegistry,
    baseToolHost,
    chatTools,
    agentTools,
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
    agentTools,
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
            exchangeId,
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
      agentTools: callerAgentTools,
      availableSkills: callerAvailableSkills,
    } = callerScopedToolHost
      ? await resolveAgentToolExposureForHost({
          scopedToolHost: callerScopedToolHost,
          agent: callerAgent,
          sessionHub,
          toolContext: {
            signal: new AbortController().signal,
            sessionId: callerSessionId,
            agentRegistry,
            sessionIndex: sessionHub.getSessionIndex(),
            envConfig,
            sessionHub,
            baseToolHost,
            ...(eventStore ? { eventStore } : {}),
            ...(ctx.searchService ? { searchService: ctx.searchService } : {}),
            ...(ctx.scheduledSessionService
              ? { scheduledSessionService: ctx.scheduledSessionService }
              : {}),
          },
        })
      : { availableTools: [], chatTools: [], agentTools: [], availableSkills: [] };

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
        agentTools: callerAgentTools,
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
      exchangeId,
      responseId: result.responseId,
      callbackEvent: {
        messageId,
        exchangeId,
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
          agentTools: callerAgentTools,
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
  const exchangeId = randomUUID();
  const messageId = randomUUID();

  let resolved;
  try {
    resolved = await resolveAgentSession(
      parsed.agentId,
      parsed.sessionStrategy,
      effectiveSessionIndex,
      sessionHub,
      agentRegistry,
      parsed.sessionConfig,
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
          ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
          ...(ctx.responseId ? { responseId: ctx.responseId } : {}),
        }),
        type: 'agent_message',
        payload: {
          messageId,
          exchangeId,
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

  const { availableTools, chatTools, agentTools, availableSkills } = await resolveAgentToolExposureForHost({
    scopedToolHost,
    agent,
    sessionHub,
    toolContext: {
      signal: ctx.signal,
      sessionId,
      ...(ctx.toolCallId ? { toolCallId: ctx.toolCallId } : {}),
      ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
      ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
      ...(ctx.responseId ? { responseId: ctx.responseId } : {}),
      agentRegistry,
      sessionIndex,
      envConfig,
      sessionHub,
      baseToolHost,
      ...(eventStore ? { eventStore } : {}),
      ...(ctx.searchService ? { searchService: ctx.searchService } : {}),
      ...(ctx.scheduledSessionService ? { scheduledSessionService: ctx.scheduledSessionService } : {}),
      ...(ctx.forwardChunksTo ? { forwardChunksTo: ctx.forwardChunksTo } : {}),
    },
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
      agentTools,
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
      exchangeId,
      responseId,
      messageId,
      fromSessionId,
      fromAgentId,
      agent,
      agentRegistry,
      baseToolHost,
      scopedToolHost,
      chatTools,
      agentTools,
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
        exchangeId,
        messageId,
      };
    }

    return {
      ...basePayload,
      mode: 'sync' as const,
      status: 'queued' as const,
      responseId,
      exchangeId,
      messageId,
    };
  }

  if (parsed.mode === 'async') {
    const responseId = randomUUID();

    const asyncContext: AsyncAgentMessageContext = {
      sessionId,
      sessionState,
      content: parsed.content,
      exchangeId,
      responseId,
      messageId,
      fromSessionId,
      fromAgentId,
      agent,
      agentRegistry,
      baseToolHost,
      scopedToolHost,
      chatTools,
      agentTools,
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
      exchangeId,
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
      agentTools,
      ...(availableTools !== undefined ? { availableTools } : {}),
      ...(availableSkills ? { availableSkills } : {}),
      handleChatToolCalls,
      outputMode: 'text',
      ttsBackendFactory: null,
      agentMessageContext: {
        fromSessionId,
        ...(fromAgentId ? { fromAgentId } : {}),
        exchangeId,
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
      exchangeId,
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
  attachmentPreviewChars?: number;
}): void {
  const attachmentPreviewChars =
    typeof options.attachmentPreviewChars === 'number'
      ? options.attachmentPreviewChars
      : DEFAULT_ATTACHMENT_PREVIEW_SNIPPET_CHARS;
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
    handler: async (args, ctx) => {
      const { text } = parseVoicePromptArgs(args);
      await publishVoiceToolNotification({ ctx, text, toolName: 'voice_speak' });
      return { accepted: true };
    },
  });

  options.host.registerTool({
    name: 'voice_ask',
    description:
      'Speak a prompt to the user and expect a spoken reply in a later turn. Use this when a spoken reply is expected, and only when the user has initiated or requested voice-style interaction.',
    parameters: voicePromptParameters,
    handler: async (args, ctx) => {
      const { text } = parseVoicePromptArgs(args);
      await publishVoiceToolNotification({ ctx, text, toolName: 'voice_ask' });
      return { accepted: true };
    },
  });

  options.host.registerTool({
    name: 'attachment_send',
    description:
      'Send a persistent attachment bubble to the user. Stores one attachment owned by this tool call and returns replayable metadata plus download/open paths. Provide exactly one content source: text for UTF-8 text, dataBase64 for arbitrary bytes, or path for an existing readable local file.',
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
          description:
            'Set this only when sending inline text content. It is encoded as UTF-8 bytes. Do not provide dataBase64 or path when text is set.',
        },
        dataBase64: {
          type: 'string',
          description:
            'Set this only when sending inline binary/file bytes directly. The value must be base64. Do not provide text or path when dataBase64 is set.',
        },
        path: {
          type: 'string',
          description:
            'Set this only when sending an existing local file. Must be an absolute path readable by the server. Do not provide text or dataBase64 when path is set.',
        },
      },
      required: ['fileName'],
      additionalProperties: false,
    },
    handler: async (args, ctx) =>
      handleAttachmentSend(args, ctx, options.sessionHub, attachmentPreviewChars),
  });
}
