import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatEvent, SessionAttributesPatch } from '@assistant/shared';
import type {
  Message as PiSdkMessage,
  AssistantMessage,
  TextContent,
  ToolCall,
  ToolResultMessage,
  Usage,
} from '@mariozechner/pi-ai';

import type { ChatCompletionMessage, ChatCompletionMessageMeta } from '../chatCompletionTypes';
import type { SessionSummary } from '../sessionIndex';
import { encodeAssistantTextSignature } from '../llm/piSdkProvider';
import { buildProviderAttributesPatch, getProviderAttributes } from './providerAttributes';
import {
  buildPiTranscriptRevisionPatch,
  getNextPiTranscriptRevision,
  getPiTranscriptRevision,
} from './piTranscriptRevision';

type PiThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

type ModelInfo = {
  provider: string;
  modelId: string;
  api?: string;
};

type PiSessionHeader = {
  type: 'session';
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
};

type PiSessionEntryBase = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
};

type PiSessionMessageEntry = PiSessionEntryBase & {
  type: 'message';
  message: PiSdkMessage;
};

type PiSessionModelChangeEntry = PiSessionEntryBase & {
  type: 'model_change';
  provider: string;
  modelId: string;
};

type PiSessionThinkingChangeEntry = PiSessionEntryBase & {
  type: 'thinking_level_change';
  thinkingLevel: PiThinkingLevel;
};

type PiSessionInfoEntry = PiSessionEntryBase & {
  type: 'session_info';
  name: string;
};

type PiSessionCustomEntry = PiSessionEntryBase & {
  type: 'custom';
  customType: string;
  data?: unknown;
};

type PiSessionCustomMessageEntry = PiSessionEntryBase & {
  type: 'custom_message';
  customType: string;
  content: string | unknown[];
  details?: unknown;
  display: boolean;
};

type PiSessionEntry =
  | PiSessionMessageEntry
  | PiSessionModelChangeEntry
  | PiSessionThinkingChangeEntry
  | PiSessionInfoEntry
  | PiSessionCustomEntry
  | PiSessionCustomMessageEntry;

type PiSessionWriterState = {
  sessionId: string;
  piSessionId: string;
  cwd: string;
  sessionDir: string;
  sessionFile: string;
  header: PiSessionHeader;
  leafId: string | null;
  writtenMessageCount: number;
  messageSignatures: string[];
  hasAssistant: boolean;
  toolCallIds: Set<string>;
  lastModel?: ModelInfo;
  lastThinking?: PiThinkingLevel;
  openRequestId: string | null;
  flushed: boolean;
  pendingEntries: PiSessionEntry[];
  writeQueue: Promise<void>;
};

type PiTurnTrigger = 'user' | 'callback';
type PiTurnStatus = 'completed' | 'interrupted';
export type PiRequestHistoryAction = 'trim_before' | 'trim_after' | 'delete_request';

type PiRequestBoundaryData = {
  v: 1;
  requestId: string;
  trigger?: PiTurnTrigger;
  status?: PiTurnStatus;
};

export type PiSessionWriterOptions = {
  baseDir?: string;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
};

const CURRENT_SESSION_VERSION = 3;
const ORPHAN_TOOL_RESULT_CUSTOM_TYPE = 'assistant.orphan_tool_result';
const ASSISTANT_REQUEST_START_CUSTOM_TYPE = 'assistant.request_start';
const ASSISTANT_REQUEST_END_CUSTOM_TYPE = 'assistant.request_end';
const ASSISTANT_REQUEST_BOUNDARY_VERSION = 1 as const;
const ASSISTANT_CUSTOM_TYPE_PREFIX = 'assistant.';

type PiSessionHeaderRecord = Record<string, unknown> & {
  type: 'session';
};

type PiSessionEntryRecord = Record<string, unknown> & {
  type: string;
  id: string;
  parentId: string | null;
};

type PiSessionFileRecords = {
  header: PiSessionHeaderRecord;
  entries: PiSessionEntryRecord[];
};

type MessageSyncAlignment = {
  startIndex: number;
  matchedCount: number;
  mode: 'prefix' | 'suffix' | 'none';
};

type PiRequestSpan = {
  requestId: string;
  startIndex: number;
  endIndex: number;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toAssistantCustomType(eventType: ChatEvent['type']): string {
  return `${ASSISTANT_CUSTOM_TYPE_PREFIX}${eventType}`;
}

function normalizeThinkingLevel(value?: string): PiThinkingLevel | null {
  if (!value) {
    return null;
  }
  switch (value) {
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value;
    default:
      return null;
  }
}

function generateEntryId(): string {
  return randomUUID().slice(0, 8);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function encodePiCwd(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) {
    return null;
  }
  const stripped = trimmed.replace(/^[/\\]/, '');
  if (!stripped) {
    return null;
  }
  const normalized = stripped.replace(/[\\/:]/g, '-');
  if (!normalized) {
    return null;
  }
  return `--${normalized}--`;
}

async function findPiSessionFile(
  baseDir: string,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const encoded = encodePiCwd(cwd);
  if (!encoded) {
    return null;
  }
  const sessionDir = path.join(baseDir, encoded);
  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      console.error('[pi-session] Failed to read Pi session directory', {
        path: sessionDir,
        error: error.message,
      });
    }
    return null;
  }

  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(`_${sessionId}.jsonl`))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (matches.length === 0) {
    return null;
  }

  return path.join(sessionDir, matches[matches.length - 1]!);
}

function resolveSessionCwd(summary: SessionSummary): string | null {
  const workingDir = summary.attributes?.core?.workingDir;
  if (isNonEmptyString(workingDir) && path.isAbsolute(workingDir)) {
    return workingDir.trim();
  }
  return path.resolve(process.cwd());
}

function parseToolArguments(argumentsJson: string): Record<string, unknown> {
  const trimmed = argumentsJson.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore parse errors and return empty args.
  }
  return {};
}

function parseToolResultIsError(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if ('ok' in parsed) {
        return (parsed as { ok?: unknown }).ok !== true;
      }
      if ('error' in parsed) {
        return Boolean((parsed as { error?: unknown }).error);
      }
    }
  } catch {
    // Ignore parse errors.
  }
  return false;
}

function buildToolCallNameMap(messages: ChatCompletionMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const piSdkMessage = message.piSdkMessage;
    if (piSdkMessage && piSdkMessage.role === 'assistant') {
      for (const block of piSdkMessage.content) {
        if (block.type === 'toolCall' && block.id && block.name) {
          map.set(block.id, block.name);
        }
      }
      continue;
    }
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        const name = call.function?.name ?? '';
        const id = call.id ?? '';
        if (id && name) {
          map.set(id, name);
        }
      }
    }
  }
  return map;
}

function collectToolCallIdsFromPiMessage(message: PiSdkMessage): string[] {
  if (!message || message.role !== 'assistant') {
    return [];
  }
  const ids: string[] = [];
  for (const block of message.content) {
    if (block.type === 'toolCall' && typeof block.id === 'string' && block.id.trim().length > 0) {
      ids.push(block.id);
    }
  }
  return ids;
}

function collectToolCallIdsFromAssistantMessage(message: ChatCompletionMessage & { role: 'assistant' }): string[] {
  const piSdkMessage = message.piSdkMessage;
  if (piSdkMessage) {
    return collectToolCallIdsFromPiMessage(piSdkMessage);
  }
  const ids: string[] = [];
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const id = call.id ?? '';
      if (id) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function stableNormalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableNormalizeJson(item));
  }
  if (!isRecord(value)) {
    return value;
  }
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const next = stableNormalizeJson(value[key]);
    if (next !== undefined) {
      normalized[key] = next;
    }
  }
  return normalized;
}

function stableSerialize(value: unknown): string {
  return JSON.stringify(stableNormalizeJson(value));
}

function normalizePiContentBlockForSignature(block: unknown): unknown {
  if (!isRecord(block)) {
    return block;
  }
  const type = typeof block['type'] === 'string' ? block['type'] : '';
  switch (type) {
    case 'text':
      return {
        type,
        text: typeof block['text'] === 'string' ? block['text'] : '',
        ...(typeof block['textSignature'] === 'string'
          ? { textSignature: block['textSignature'] }
          : {}),
      };
    case 'toolCall':
      return {
        type,
        id: typeof block['id'] === 'string' ? block['id'] : '',
        name: typeof block['name'] === 'string' ? block['name'] : '',
        arguments: stableNormalizeJson(block['arguments'] ?? {}),
      };
    case 'thinking':
      return {
        type,
        thinking: typeof block['thinking'] === 'string' ? block['thinking'] : '',
        ...(typeof block['thinkingSignature'] === 'string'
          ? { thinkingSignature: block['thinkingSignature'] }
          : {}),
        ...(block['summary'] !== undefined ? { summary: stableNormalizeJson(block['summary']) } : {}),
      };
    default:
      return stableNormalizeJson(block);
  }
}

function normalizePiMessageForSignature(message: unknown): unknown {
  if (!isRecord(message)) {
    return message;
  }
  const role = typeof message['role'] === 'string' ? message['role'] : '';
  const content = Array.isArray(message['content'])
    ? message['content'].map((block) => normalizePiContentBlockForSignature(block))
    : [];
  if (role === 'toolResult') {
    return {
      role,
      toolCallId: typeof message['toolCallId'] === 'string' ? message['toolCallId'] : '',
      toolName: typeof message['toolName'] === 'string' ? message['toolName'] : '',
      content,
      isError: message['isError'] === true,
    };
  }
  if (role === 'assistant') {
    return { role, content };
  }
  if (role === 'user') {
    const meta = normalizePiUserMeta(message['meta']);
    return {
      role,
      content,
      ...(meta ? { meta } : {}),
    };
  }
  return stableNormalizeJson(message);
}

function signatureFromPiMessage(message: unknown): string {
  return stableSerialize({
    type: 'message',
    message: normalizePiMessageForSignature(message),
  });
}

function normalizeCountedCustomMessageForSignature(entry: {
  customType: string;
  content: string | unknown[];
  details?: unknown;
  display: boolean;
}): unknown {
  return {
    type: 'custom_message',
    customType: entry.customType,
    content: stableNormalizeJson(entry.content),
    details: stableNormalizeJson(entry.details ?? null),
    display: entry.display,
  };
}

function signatureFromCustomMessageEntry(entry: {
  customType: string;
  content: string | unknown[];
  details?: unknown;
  display: boolean;
}): string {
  return stableSerialize(normalizeCountedCustomMessageForSignature(entry));
}

function signatureFromChatCompletionMessage(
  message: ChatCompletionMessage,
  toolCallNameMap: Map<string, string>,
): string {
  switch (message.role) {
    case 'user': {
      return signatureFromPiMessage(buildUserMessage(message.content ?? '', 0, message.meta));
    }
    case 'assistant': {
      if (message.piSdkMessage) {
        return signatureFromPiMessage(message.piSdkMessage);
      }
      const blocks: Array<Record<string, unknown>> = [];
      if (message.content) {
        const textSignature =
          message.assistantTextSignature ??
          (message.assistantTextPhase
            ? encodeAssistantTextSignature({ phase: message.assistantTextPhase })
            : undefined);
        blocks.push({
          type: 'text',
          text: message.content,
          ...(textSignature ? { textSignature } : {}),
        });
      }
      if (Array.isArray(message.tool_calls)) {
        for (const call of message.tool_calls) {
          const id = call.id ?? '';
          const name = call.function?.name ?? '';
          if (!id || !name) {
            continue;
          }
          blocks.push({
            type: 'toolCall',
            id,
            name,
            arguments: parseToolArguments(call.function?.arguments ?? ''),
          });
        }
      }
      return signatureFromPiMessage({
        role: 'assistant',
        content: blocks,
      });
    }
    case 'tool': {
      const toolCallId = message.tool_call_id;
      if (!toolCallNameMap.has(toolCallId)) {
        return signatureFromCustomMessageEntry({
          customType: ORPHAN_TOOL_RESULT_CUSTOM_TYPE,
          content: '',
          details: {
            toolCallId,
            toolName: toolCallNameMap.get(toolCallId) ?? 'tool',
            note: 'Tool result dropped because matching toolCall was not found in session log.',
          },
          display: false,
        });
      }
      return signatureFromPiMessage({
        role: 'toolResult',
        toolCallId,
        toolName: toolCallNameMap.get(toolCallId) ?? 'tool',
        content: [{ type: 'text', text: message.content }],
        isError: parseToolResultIsError(message.content),
      });
    }
    default:
      return stableSerialize({ role: message.role });
  }
}

function signaturesEqual(
  left: string[],
  leftStart: number,
  right: string[],
  rightStart: number,
  count: number,
): boolean {
  for (let index = 0; index < count; index += 1) {
    if (left[leftStart + index] !== right[rightStart + index]) {
      return false;
    }
  }
  return true;
}

function resolveMessageSyncAlignment(options: {
  persistedSignatures: string[];
  currentSignatures: string[];
}): MessageSyncAlignment {
  const { persistedSignatures, currentSignatures } = options;
  if (persistedSignatures.length === 0) {
    return { startIndex: 0, matchedCount: 0, mode: 'prefix' };
  }

  if (
    currentSignatures.length >= persistedSignatures.length &&
    signaturesEqual(persistedSignatures, 0, currentSignatures, 0, persistedSignatures.length)
  ) {
    return {
      startIndex: persistedSignatures.length,
      matchedCount: persistedSignatures.length,
      mode: 'prefix',
    };
  }

  const maxOverlap = Math.min(persistedSignatures.length, currentSignatures.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const persistedStart = persistedSignatures.length - overlap;
    for (let currentStart = currentSignatures.length - overlap; currentStart >= 0; currentStart -= 1) {
      if (signaturesEqual(persistedSignatures, persistedStart, currentSignatures, currentStart, overlap)) {
        return {
          startIndex: currentStart + overlap,
          matchedCount: overlap,
          mode: 'suffix',
        };
      }
    }
  }

  return {
    startIndex: currentSignatures.length,
    matchedCount: 0,
    mode: 'none',
  };
}

function resolveModelInfo(options: {
  messages: ChatCompletionMessage[];
  modelSpec?: string;
  defaultProvider?: string;
}): ModelInfo | null {
  for (const message of options.messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const piSdkMessage = message.piSdkMessage;
    if (piSdkMessage && piSdkMessage.role === 'assistant') {
      if (piSdkMessage.provider && piSdkMessage.model) {
        return {
          provider: piSdkMessage.provider,
          modelId: piSdkMessage.model,
          api: piSdkMessage.api,
        };
      }
    }
  }

  const rawSpec = options.modelSpec?.trim();
  if (!rawSpec) {
    return null;
  }
  const slashIndex = rawSpec.indexOf('/');
  if (slashIndex > 0 && slashIndex < rawSpec.length - 1) {
    return {
      provider: rawSpec.slice(0, slashIndex).trim(),
      modelId: rawSpec.slice(slashIndex + 1).trim(),
    };
  }
  const fallbackProvider = options.defaultProvider?.trim();
  if (fallbackProvider) {
    return {
      provider: fallbackProvider,
      modelId: rawSpec,
    };
  }
  return null;
}

function normalizePiUserMeta(value: unknown): ChatCompletionMessageMeta | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const sourceRaw = typeof value['source'] === 'string' ? value['source'].trim() : '';
  const source =
    sourceRaw === 'user' || sourceRaw === 'agent' || sourceRaw === 'callback' ? sourceRaw : '';
  if (!source) {
    return undefined;
  }
  const visibilityRaw = typeof value['visibility'] === 'string' ? value['visibility'].trim() : '';
  const visibility = visibilityRaw === 'visible' || visibilityRaw === 'hidden' ? visibilityRaw : undefined;
  return {
    source,
    ...(typeof value['fromAgentId'] === 'string' && value['fromAgentId'].trim().length > 0
      ? { fromAgentId: value['fromAgentId'].trim() }
      : {}),
    ...(typeof value['fromSessionId'] === 'string' && value['fromSessionId'].trim().length > 0
      ? { fromSessionId: value['fromSessionId'].trim() }
      : {}),
    ...(source === 'callback' && visibility ? { visibility } : {}),
  };
}

function buildUserMessage(
  content: string,
  timestamp: number,
  meta?: ChatCompletionMessageMeta,
): PiSdkMessage {
  const block: TextContent = { type: 'text', text: content };
  const normalizedMeta = normalizePiUserMeta(meta);
  return {
    role: 'user',
    content: [block],
    timestamp,
    ...(normalizedMeta ? { meta: normalizedMeta } : {}),
  };
}

function getUserMessageMetaSource(value: unknown): ChatCompletionMessageMeta['source'] | null {
  const meta = normalizePiUserMeta(value);
  return meta?.source ?? null;
}

function buildAssistantMessage(options: {
  message: ChatCompletionMessage & { role: 'assistant' };
  modelInfo: ModelInfo | null;
  timestamp: number;
}): AssistantMessage {
  const { message, modelInfo, timestamp } = options;
  const piSdkMessage = message.piSdkMessage;
  if (piSdkMessage && piSdkMessage.role === 'assistant') {
    return piSdkMessage;
  }

  const blocks: Array<TextContent | ToolCall> = [];
  if (message.content) {
    const textSignature =
      message.assistantTextSignature ??
      (message.assistantTextPhase
        ? encodeAssistantTextSignature({ phase: message.assistantTextPhase })
        : undefined);
    blocks.push({
      type: 'text',
      text: message.content,
      ...(textSignature ? { textSignature } : {}),
    });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      const name = call.function?.name ?? '';
      const id = call.id ?? '';
      if (!id || !name) {
        continue;
      }
      blocks.push({
        type: 'toolCall',
        id,
        name,
        arguments: parseToolArguments(call.function?.arguments ?? ''),
      });
    }
  }

  return {
    role: 'assistant',
    content: blocks,
    api: (modelInfo?.api ?? 'unknown') as AssistantMessage['api'],
    provider: modelInfo?.provider ?? 'unknown',
    model: modelInfo?.modelId ?? 'unknown',
    usage: createEmptyUsage(),
    stopReason: blocks.some((block) => block.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp,
  };
}

function buildToolResultMessage(options: {
  message: ChatCompletionMessage & { role: 'tool' };
  toolCallNameMap: Map<string, string>;
  timestamp: number;
}): ToolResultMessage {
  const { message, toolCallNameMap, timestamp } = options;
  const toolCallId = message.tool_call_id;
  const toolName = toolCallNameMap.get(toolCallId) ?? 'tool';
  return {
    role: 'toolResult',
    toolCallId,
    toolName,
    content: [{ type: 'text', text: message.content }],
    isError: parseToolResultIsError(message.content),
    timestamp,
  };
}

async function loadExistingPiSessionState(
  filePath: string,
): Promise<{
  leafId: string | null;
  messageCount: number;
  messageSignatures: string[];
  hasAssistant: boolean;
  toolCallIds: Set<string>;
  lastModel?: ModelInfo;
  lastThinking?: PiThinkingLevel;
  openRequestId: string | null;
}> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      console.error('[pi-session] Failed to read session file', {
        path: filePath,
        error: error.message,
      });
    }
    return {
      leafId: null,
      messageCount: 0,
      messageSignatures: [],
      hasAssistant: false,
      toolCallIds: new Set<string>(),
      openRequestId: null,
    };
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let leafId: string | null = null;
  let messageCount = 0;
  const messageSignatures: string[] = [];
  let hasAssistant = false;
  const toolCallIds = new Set<string>();
  let lastModel: ModelInfo | undefined;
  let lastThinking: PiThinkingLevel | undefined;
  let openRequestId: string | null = null;

  for (const line of lines) {
    let entry: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entry = parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
    if (!entry) {
      continue;
    }
    const entryType = entry['type'];
    if (entryType === 'message') {
      messageCount += 1;
      messageSignatures.push(signatureFromPiMessage(entry['message']));
      const message = entry['message'] as Record<string, unknown> | undefined;
      if (message && message['role'] === 'assistant') {
        hasAssistant = true;
        const contentBlocks = message['content'];
        if (Array.isArray(contentBlocks)) {
          for (const block of contentBlocks) {
            if (!block || typeof block !== 'object') {
              continue;
            }
            const record = block as Record<string, unknown>;
            const type = record['type'];
            const id = record['id'];
            if (type === 'toolCall' && typeof id === 'string' && id.trim().length > 0) {
              toolCallIds.add(id.trim());
            }
          }
        }
        const provider = typeof message['provider'] === 'string' ? message['provider'] : undefined;
        const modelId = typeof message['model'] === 'string' ? message['model'] : undefined;
        const api = typeof message['api'] === 'string' ? message['api'] : undefined;
        if (provider && modelId) {
          lastModel = { provider, modelId, ...(api ? { api } : {}) };
        }
      }
    }
    if (entryType === 'custom_message') {
      const customType = typeof entry['customType'] === 'string' ? entry['customType'] : '';
      if (customType === ORPHAN_TOOL_RESULT_CUSTOM_TYPE) {
        messageCount += 1;
        messageSignatures.push(
          signatureFromCustomMessageEntry({
            customType,
            content:
              typeof entry['content'] === 'string' || Array.isArray(entry['content'])
                ? (entry['content'] as string | unknown[])
                : '',
            details: entry['details'],
            display: entry['display'] === true,
          }),
        );
      }
    }
    if (entryType === 'custom') {
      const customType = typeof entry['customType'] === 'string' ? entry['customType'] : '';
      const data =
        entry['data'] && typeof entry['data'] === 'object' && !Array.isArray(entry['data'])
          ? (entry['data'] as Record<string, unknown>)
          : undefined;
      const requestId =
        data && typeof data['requestId'] === 'string' && data['requestId'].trim().length > 0
          ? data['requestId'].trim()
          : null;
      if (customType === ASSISTANT_REQUEST_START_CUSTOM_TYPE && requestId) {
        openRequestId = requestId;
      } else if (
        customType === ASSISTANT_REQUEST_END_CUSTOM_TYPE &&
        requestId &&
        openRequestId === requestId
      ) {
        openRequestId = null;
      }
    }
    if (entryType === 'model_change') {
      const provider = typeof entry['provider'] === 'string' ? entry['provider'] : undefined;
      const modelId = typeof entry['modelId'] === 'string' ? entry['modelId'] : undefined;
      if (provider && modelId) {
        lastModel = { provider, modelId };
      }
    }
    if (entryType === 'thinking_level_change') {
      const level = normalizeThinkingLevel(
        typeof entry['thinkingLevel'] === 'string' ? entry['thinkingLevel'] : undefined,
      );
      if (level) {
        lastThinking = level;
      }
    }
    if (typeof entry['id'] === 'string' && entryType !== 'session') {
      leafId = entry['id'];
    }
  }

  return {
    leafId,
    messageCount,
    messageSignatures,
    hasAssistant,
    toolCallIds,
    openRequestId,
    ...(lastModel ? { lastModel } : {}),
    ...(lastThinking ? { lastThinking } : {}),
  };
}

async function loadPiSessionFileRecords(filePath: string): Promise<PiSessionFileRecords | null> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      console.error('[pi-session] Failed to read session file', {
        path: filePath,
        error: error.message,
      });
    }
    return null;
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return null;
  }

  let header: PiSessionHeaderRecord | null = null;
  const entries: PiSessionEntryRecord[] = [];

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) {
      continue;
    }
    const type = typeof parsed['type'] === 'string' ? parsed['type'] : '';
    if (!type) {
      continue;
    }
    if (type === 'session') {
      header = cloneJson(parsed as PiSessionHeaderRecord);
      continue;
    }
    const id = typeof parsed['id'] === 'string' ? parsed['id'].trim() : '';
    if (!id) {
      continue;
    }
    const parentIdRaw = parsed['parentId'];
    const parentId =
      typeof parentIdRaw === 'string' && parentIdRaw.trim().length > 0 ? parentIdRaw.trim() : null;
    entries.push({
      ...(cloneJson(parsed) as Record<string, unknown>),
      type,
      id,
      parentId,
    });
  }

  if (!header) {
    return null;
  }
  return { header, entries };
}

function getRequestBoundaryRecord(
  entry: PiSessionEntryRecord,
):
  | {
      kind: 'start' | 'end';
      requestId: string;
      status?: PiTurnStatus;
      trigger?: PiTurnTrigger;
    }
  | null {
  if (entry.type !== 'custom') {
    return null;
  }
  const customType = typeof entry['customType'] === 'string' ? entry['customType'] : '';
  if (
    customType !== ASSISTANT_REQUEST_START_CUSTOM_TYPE &&
    customType !== ASSISTANT_REQUEST_END_CUSTOM_TYPE
  ) {
    return null;
  }
  const data = isRecord(entry['data']) ? entry['data'] : null;
  const requestId =
    data &&
    typeof data['requestId'] === 'string' &&
    data['requestId'].trim().length > 0
      ? data['requestId'].trim()
      : '';
  if (!requestId) {
    return null;
  }
  const triggerRaw = data?.['trigger'];
  const trigger =
    triggerRaw === 'user' || triggerRaw === 'callback' ? triggerRaw : undefined;
  const statusRaw = data?.['status'];
  const status =
    statusRaw === 'completed' || statusRaw === 'interrupted' ? statusRaw : undefined;
  return {
    kind: customType === ASSISTANT_REQUEST_START_CUSTOM_TYPE ? 'start' : 'end',
    requestId,
    ...(trigger ? { trigger } : {}),
    ...(status ? { status } : {}),
  };
}

function collectExplicitRequestSpans(entries: PiSessionEntryRecord[]): PiRequestSpan[] {
  const spans: PiRequestSpan[] = [];
  let current: { requestId: string; startIndex: number } | null = null;

  for (let index = 0; index < entries.length; index += 1) {
    const boundary = getRequestBoundaryRecord(entries[index]!);
    if (!boundary) {
      continue;
    }
    if (boundary.kind === 'start') {
      if (current && current.startIndex <= index - 1) {
        spans.push({
          requestId: current.requestId,
          startIndex: current.startIndex,
          endIndex: index - 1,
        });
      }
      current = { requestId: boundary.requestId, startIndex: index };
      continue;
    }
    if (current && current.requestId === boundary.requestId) {
      spans.push({
        requestId: current.requestId,
        startIndex: current.startIndex,
        endIndex: index,
      });
      current = null;
    }
  }

  if (current && current.startIndex <= entries.length - 1) {
    spans.push({
      requestId: current.requestId,
      startIndex: current.startIndex,
      endIndex: entries.length - 1,
    });
  }

  return spans;
}

function isSyntheticRequestBoundaryEntry(entry: PiSessionEntryRecord): boolean {
  if (entry.type === 'message') {
    const message = isRecord(entry['message']) ? entry['message'] : null;
    return typeof message?.['role'] === 'string' && message['role'] === 'user';
  }
  return false;
}

function collectSyntheticRequestSpans(entries: PiSessionEntryRecord[]): PiRequestSpan[] {
  if (entries.length === 0) {
    return [];
  }

  const startIndexes: number[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    if (isSyntheticRequestBoundaryEntry(entries[index]!)) {
      startIndexes.push(index);
    }
  }

  if (startIndexes.length === 0) {
    startIndexes.push(0);
  }

  const spans: PiRequestSpan[] = [];
  for (let index = 0; index < startIndexes.length; index += 1) {
    const startIndex = startIndexes[index]!;
    const nextStartIndex = startIndexes[index + 1];
    const endIndex = typeof nextStartIndex === 'number' ? nextStartIndex - 1 : entries.length - 1;
    const startEntry = entries[startIndex]!;
    const requestId = `synthetic-${startEntry.id}`;
    spans.push({
      requestId,
      startIndex,
      endIndex,
    });
  }

  return spans;
}

function collectRequestSpans(entries: PiSessionEntryRecord[]): PiRequestSpan[] {
  const explicitSpans = collectExplicitRequestSpans(entries);
  if (explicitSpans.length > 0) {
    return explicitSpans;
  }
  return collectSyntheticRequestSpans(entries);
}

function hasExplicitRequestSpans(entries: PiSessionEntryRecord[]): boolean {
  return collectExplicitRequestSpans(entries).length > 0;
}

function getSyntheticRequestTrigger(entry: PiSessionEntryRecord): PiTurnTrigger {
  if (entry.type === 'message') {
    const message = isRecord(entry['message']) ? entry['message'] : null;
    if (message && getUserMessageMetaSource(message['meta']) === 'callback') {
      return 'callback';
    }
  }
  return 'user';
}

function resolveEntryTimestamp(entry: PiSessionEntryRecord | undefined, fallback: string): string {
  const timestamp = entry && typeof entry['timestamp'] === 'string' ? entry['timestamp'].trim() : '';
  return timestamp || fallback;
}

function materializeExplicitRequestBoundaries(options: {
  entries: PiSessionEntryRecord[];
  spans: PiRequestSpan[];
  fallbackTimestamp: string;
}): PiSessionEntryRecord[] {
  const { entries, spans, fallbackTimestamp } = options;
  if (spans.length === 0) {
    return entries.map((entry) => cloneJson(entry));
  }

  const materialized: PiSessionEntryRecord[] = [];
  for (const span of spans) {
    const spanEntries = entries.slice(span.startIndex, span.endIndex + 1).map((entry) => cloneJson(entry));
    if (spanEntries.length === 0) {
      continue;
    }
    const firstEntry = spanEntries[0]!;
    const lastEntry = spanEntries[spanEntries.length - 1]!;
    materialized.push({
      type: 'custom',
      id: generateEntryId(),
      parentId: null,
      timestamp: resolveEntryTimestamp(firstEntry, fallbackTimestamp),
      customType: ASSISTANT_REQUEST_START_CUSTOM_TYPE,
      data: {
        v: ASSISTANT_REQUEST_BOUNDARY_VERSION,
        requestId: span.requestId,
        trigger: getSyntheticRequestTrigger(firstEntry),
      },
    });
    materialized.push(...spanEntries);
    materialized.push({
      type: 'custom',
      id: generateEntryId(),
      parentId: null,
      timestamp: resolveEntryTimestamp(lastEntry, fallbackTimestamp),
      customType: ASSISTANT_REQUEST_END_CUSTOM_TYPE,
      data: {
        v: ASSISTANT_REQUEST_BOUNDARY_VERSION,
        requestId: span.requestId,
        status: 'completed',
      },
    });
  }

  return materialized;
}

function resolveOpenRequestIdFromEntries(entries: PiSessionEntryRecord[]): string | null {
  let openRequestId: string | null = null;
  for (const entry of entries) {
    const boundary = getRequestBoundaryRecord(entry);
    if (!boundary) {
      continue;
    }
    if (boundary.kind === 'start') {
      openRequestId = boundary.requestId;
      continue;
    }
    if (openRequestId === boundary.requestId) {
      openRequestId = null;
    }
  }
  return openRequestId;
}

async function resolveOpenRequestIdFromFile(filePath: string): Promise<string | null> {
  const records = await loadPiSessionFileRecords(filePath);
  if (!records) {
    return null;
  }
  return resolveOpenRequestIdFromEntries(records.entries);
}

function selectDroppedRequestRanges(options: {
  spans: PiRequestSpan[];
  action: PiRequestHistoryAction;
  requestId: string;
}): PiRequestSpan[] {
  const { spans, action, requestId } = options;
  const anchorIndex = spans.findIndex((span) => span.requestId === requestId);
  if (anchorIndex === -1) {
    throw new Error(`Request not found in Pi session history: ${requestId}`);
  }

  switch (action) {
    case 'trim_before':
      return spans.slice(0, anchorIndex);
    case 'trim_after':
      return spans.slice(anchorIndex);
    case 'delete_request':
      return [spans[anchorIndex]!];
    default:
      return [];
  }
}

function filterEntriesByDroppedRanges(
  entries: PiSessionEntryRecord[],
  droppedRanges: Array<Pick<PiRequestSpan, 'startIndex' | 'endIndex'>>,
): PiSessionEntryRecord[] {
  if (droppedRanges.length === 0) {
    return entries.map((entry) => cloneJson(entry));
  }
  return entries
    .filter((_, index) =>
      droppedRanges.every((range) => index < range.startIndex || index > range.endIndex),
    )
    .map((entry) => cloneJson(entry));
}

function rechainEntries(entries: PiSessionEntryRecord[]): PiSessionEntryRecord[] {
  let parentId: string | null = null;
  return entries.map((entry) => {
    const nextEntry: PiSessionEntryRecord = {
      ...entry,
      parentId,
    };
    parentId = nextEntry.id;
    return nextEntry;
  });
}

export class PiSessionWriter {
  private readonly baseDir: string;
  private readonly now: () => Date;
  private readonly log: (...args: unknown[]) => void;
  private readonly sessions = new Map<string, PiSessionWriterState>();

  constructor(options: PiSessionWriterOptions = {}) {
    this.baseDir = options.baseDir ?? path.join(os.homedir(), '.pi', 'agent', 'sessions');
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((...args) => console.log('[pi-session]', ...args));
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  async clearSession(options: {
    summary: SessionSummary;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<SessionSummary | undefined> {
    const { summary, updateAttributes } = options;
    const providerInfo = getProviderAttributes(summary.attributes, 'pi', ['pi-cli']);
    const storedSessionId = isNonEmptyString(providerInfo?.['sessionId'])
      ? String(providerInfo?.['sessionId']).trim()
      : '';
    const storedCwd = isNonEmptyString(providerInfo?.['cwd'])
      ? String(providerInfo?.['cwd']).trim()
      : '';

    if (storedSessionId && storedCwd) {
      try {
        const sessionFile = await findPiSessionFile(this.baseDir, storedCwd, storedSessionId);
        if (sessionFile) {
          await fs.unlink(sessionFile);
        }
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== 'ENOENT') {
          this.log('Failed to clear Pi session file', err);
        }
      }
    }

    this.sessions.delete(summary.sessionId);

    if (updateAttributes) {
      try {
        const providersEntry = summary.attributes?.['providers'];
        const providers =
          providersEntry && isRecord(providersEntry)
            ? (providersEntry as Record<string, unknown>)
            : null;
        const remainingProviderKeys = Object.keys(providers ?? {}).filter(
          (key) => key !== 'pi' && key !== 'pi-cli',
        );
        const updated = await updateAttributes({
          ...(remainingProviderKeys.length === 0
            ? { providers: null }
            : {
                providers: {
                  pi: null,
                  'pi-cli': null,
                },
              }),
        });
        return updated;
      } catch (err) {
        this.log('Failed to clear Pi provider attributes', err);
      }
    }

    return undefined;
  }

  async rewriteHistoryByRequest(options: {
    summary: SessionSummary;
    action: PiRequestHistoryAction;
    requestId: string;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<{ summary: SessionSummary; changed: boolean; droppedRequestIds: string[] }> {
    const { summary, action, requestId, updateAttributes } = options;
    const trimmedRequestId = requestId.trim();
    if (!trimmedRequestId) {
      throw new Error('requestId must not be empty');
    }

    const stateInfo = await this.ensureSessionState({
      summary,
      ...(updateAttributes ? { updateAttributes } : {}),
    });
    const state = stateInfo.state;
    const records = await loadPiSessionFileRecords(state.sessionFile);
    if (!records) {
      throw new Error('Pi session history is unavailable');
    }

    const spans = collectRequestSpans(records.entries);
    const hadExplicitRequestSpans = hasExplicitRequestSpans(records.entries);

    const droppedRanges = selectDroppedRequestRanges({
      spans,
      action,
      requestId: trimmedRequestId,
    });
    const droppedRequestIds = droppedRanges.map((range) => range.requestId);
    if (droppedRanges.length === 0) {
      return { summary: stateInfo.summary, changed: false, droppedRequestIds: [] };
    }

    const filteredEntries = filterEntriesByDroppedRanges(records.entries, droppedRanges);
    const keptEntries =
      hadExplicitRequestSpans
        ? rechainEntries(filteredEntries)
        : rechainEntries(
            materializeExplicitRequestBoundaries({
              entries: filteredEntries,
              spans: collectSyntheticRequestSpans(filteredEntries),
              fallbackTimestamp: this.now().toISOString(),
            }),
          );
    const tempFilePath = `${state.sessionFile}.tmp-${randomUUID()}`;

    await this.queueWrite(state, async () => {
      await fs.mkdir(state.sessionDir, { recursive: true });
      const payload = [records.header, ...keptEntries].map((entry) => JSON.stringify(entry)).join('\n');
      await fs.writeFile(tempFilePath, `${payload}\n`, 'utf8');
      await fs.rename(tempFilePath, state.sessionFile);
    });

    this.sessions.delete(summary.sessionId);
    let currentSummary = stateInfo.summary;
    if (updateAttributes) {
      try {
        const updated = await updateAttributes(
          buildPiTranscriptRevisionPatch({
            revision: getNextPiTranscriptRevision(currentSummary.attributes),
          }),
        );
        if (updated) {
          currentSummary = updated;
        }
      } catch (err) {
        this.log('Failed to update Pi transcript revision after history rewrite', err);
      }
    }
    return { summary: currentSummary, changed: true, droppedRequestIds };
  }

  async sync(options: {
    summary: SessionSummary;
    messages: ChatCompletionMessage[];
    modelSpec?: string;
    defaultProvider?: string;
    thinkingLevel?: string;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<SessionSummary | undefined> {
    const { summary, messages, modelSpec, defaultProvider, thinkingLevel, updateAttributes } =
      options;

    let currentSummary = summary;
    const stateInfo = await this.ensureSessionState({
      summary: currentSummary,
      ...(updateAttributes ? { updateAttributes } : {}),
    });
    currentSummary = stateInfo.summary;
    const state = stateInfo.state;

    const persistableMessages = messages.filter((message) => message.role !== 'system');
    const toolCallNameMap = buildToolCallNameMap(persistableMessages);
    const currentSignatures = persistableMessages.map((message) =>
      signatureFromChatCompletionMessage(message, toolCallNameMap),
    );
    const alignment = resolveMessageSyncAlignment({
      persistedSignatures: state.messageSignatures,
      currentSignatures,
    });

    if (alignment.mode === 'none' && state.messageSignatures.length > 0 && currentSignatures.length > 0) {
      this.log('Pi session sync skipped due to unreconcilable message alignment', {
        sessionId: summary.sessionId,
        piSessionId: state.piSessionId,
        persistedMessageCount: state.messageSignatures.length,
        currentMessageCount: currentSignatures.length,
      });
      return currentSummary === summary ? undefined : currentSummary;
    }

    const newMessages = persistableMessages.slice(alignment.startIndex);
    const newMessageSignatures = currentSignatures.slice(alignment.startIndex);
    if (newMessages.length === 0) {
      return currentSummary === summary ? undefined : currentSummary;
    }

    if (alignment.mode === 'suffix') {
      this.log('Pi session sync realigned after replay drift', {
        sessionId: summary.sessionId,
        piSessionId: state.piSessionId,
        matchedCount: alignment.matchedCount,
        persistedMessageCount: state.messageSignatures.length,
        currentMessageCount: currentSignatures.length,
      });
    }

    const normalizedThinking = normalizeThinkingLevel(thinkingLevel);
    const modelInfo = resolveModelInfo({
      messages: newMessages,
      ...(modelSpec ? { modelSpec } : {}),
      ...(defaultProvider ? { defaultProvider } : {}),
    });

    let leafId = state.leafId;
    let messageCount = state.writtenMessageCount;
    let hasAssistant = state.hasAssistant;
    const knownToolCallIds = new Set(state.toolCallIds);

    const entries: PiSessionEntry[] = [];

    if (modelInfo && (!state.lastModel || state.lastModel.modelId !== modelInfo.modelId || state.lastModel.provider !== modelInfo.provider)) {
      const modelEntry: PiSessionModelChangeEntry = {
        type: 'model_change',
        id: generateEntryId(),
        parentId: leafId,
        timestamp: this.now().toISOString(),
        provider: modelInfo.provider,
        modelId: modelInfo.modelId,
      };
      entries.push(modelEntry);
      leafId = modelEntry.id;
      state.lastModel = modelInfo;
    }

    if (normalizedThinking && normalizedThinking !== state.lastThinking) {
      const thinkingEntry: PiSessionThinkingChangeEntry = {
        type: 'thinking_level_change',
        id: generateEntryId(),
        parentId: leafId,
        timestamp: this.now().toISOString(),
        thinkingLevel: normalizedThinking,
      };
      entries.push(thinkingEntry);
      leafId = thinkingEntry.id;
      state.lastThinking = normalizedThinking;
    }

    for (const message of newMessages) {
      const messageTimestampValue =
        typeof message.historyTimestampMs === 'number' && Number.isFinite(message.historyTimestampMs)
          ? message.historyTimestampMs
          : this.now().getTime();
      if (message.role === 'user') {
        const text = message.content ?? '';
        const meta = message.meta;
        const piMessage = buildUserMessage(text, messageTimestampValue, meta);
        const entry: PiSessionMessageEntry = {
          type: 'message',
          id: generateEntryId(),
          parentId: leafId,
          timestamp: this.now().toISOString(),
          message: piMessage,
        };
        entries.push(entry);
        leafId = entry.id;
        messageCount += 1;
        continue;
      } else if (message.role === 'assistant') {
        const piMessage = buildAssistantMessage({
          message,
          modelInfo,
          timestamp: messageTimestampValue,
        });
        if (piMessage.role === 'assistant') {
          hasAssistant = true;
        }
        for (const id of collectToolCallIdsFromAssistantMessage(message)) {
          knownToolCallIds.add(id);
        }
        const entry: PiSessionMessageEntry = {
          type: 'message',
          id: generateEntryId(),
          parentId: leafId,
          timestamp: this.now().toISOString(),
          message: piMessage,
        };
        entries.push(entry);
        leafId = entry.id;
        messageCount += 1;
        continue;
      } else if (message.role === 'tool') {
        const toolCallId = message.tool_call_id;
        if (!knownToolCallIds.has(toolCallId)) {
          const toolName = toolCallNameMap.get(toolCallId) ?? 'tool';
          const entry: PiSessionCustomMessageEntry = {
            type: 'custom_message',
            id: generateEntryId(),
            parentId: leafId,
            timestamp: this.now().toISOString(),
            customType: ORPHAN_TOOL_RESULT_CUSTOM_TYPE,
            content: '',
            details: {
              toolCallId,
              toolName,
              note: 'Tool result dropped because matching toolCall was not found in session log.',
            },
            display: false,
          };
          entries.push(entry);
          leafId = entry.id;
          messageCount += 1;
          continue;
        }

        const piMessage = buildToolResultMessage({
          message,
          toolCallNameMap,
          timestamp: messageTimestampValue,
        });
        const entry: PiSessionMessageEntry = {
          type: 'message',
          id: generateEntryId(),
          parentId: leafId,
          timestamp: this.now().toISOString(),
          message: piMessage,
        };
        entries.push(entry);
        leafId = entry.id;
        messageCount += 1;
        continue;
      }
    }

    if (entries.length === 0) {
      return currentSummary === summary ? undefined : currentSummary;
    }

    await this.queueWrite(state, async () => {
      if (!state.flushed) {
        await this.ensureSessionFile(state);
      }

      await this.appendEntries(state, entries);
    });

    state.leafId = leafId;
    state.writtenMessageCount = messageCount;
    state.messageSignatures.push(...newMessageSignatures);
    state.hasAssistant = hasAssistant;
    state.toolCallIds = knownToolCallIds;

    return currentSummary === summary ? undefined : currentSummary;
  }

  async appendAssistantEvent(options: {
    summary: SessionSummary;
    eventType: ChatEvent['type'];
    payload: unknown;
    turnId?: string;
    responseId?: string;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<SessionSummary | undefined> {
    const { summary, eventType, payload, turnId, responseId, updateAttributes } = options;

    let currentSummary = summary;
    const stateInfo = await this.ensureSessionState({
      summary: currentSummary,
      ...(updateAttributes ? { updateAttributes } : {}),
    });
    currentSummary = stateInfo.summary;
    const state = stateInfo.state;

    const entry: PiSessionCustomEntry = {
      type: 'custom',
      id: generateEntryId(),
      parentId: state.leafId,
      timestamp: this.now().toISOString(),
      customType: toAssistantCustomType(eventType),
      data: {
        payload,
        ...(typeof turnId === 'string' && turnId.trim() ? { turnId: turnId.trim() } : {}),
        ...(typeof responseId === 'string' && responseId.trim()
          ? { responseId: responseId.trim() }
          : {}),
      },
    };

    const nextLeafId = entry.id;
    await this.queueWrite(state, async () => {
      if (!state.flushed) {
        await this.ensureSessionFile(state);
      }

      await this.appendEntries(state, [entry]);
    });

    state.leafId = nextLeafId;

    return currentSummary === summary ? undefined : currentSummary;
  }

  async appendTurnStart(options: {
    summary: SessionSummary;
    turnId: string;
    trigger: PiTurnTrigger;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<SessionSummary | undefined> {
    const { summary, turnId, trigger, updateAttributes } = options;
    const trimmedTurnId = turnId.trim();
    if (!trimmedTurnId) {
      return undefined;
    }

    let currentSummary = summary;
    const stateInfo = await this.ensureSessionState({
      summary: currentSummary,
      ...(updateAttributes ? { updateAttributes } : {}),
    });
    currentSummary = stateInfo.summary;
    const state = stateInfo.state;
    const openRequestId = state.openRequestId ?? (await resolveOpenRequestIdFromFile(state.sessionFile));

    const entries: PiSessionEntry[] = [];
    let nextParentId = state.leafId;
    if (openRequestId && openRequestId !== trimmedTurnId) {
      const interruptedEnd = this.createRequestBoundaryEntry(
        nextParentId,
        ASSISTANT_REQUEST_END_CUSTOM_TYPE,
        {
          v: ASSISTANT_REQUEST_BOUNDARY_VERSION,
          requestId: openRequestId,
          status: 'interrupted',
        },
      );
      entries.push(interruptedEnd);
      nextParentId = interruptedEnd.id;
    }
    if (openRequestId !== trimmedTurnId) {
      const requestStart = this.createRequestBoundaryEntry(
        nextParentId,
        ASSISTANT_REQUEST_START_CUSTOM_TYPE,
        {
          v: ASSISTANT_REQUEST_BOUNDARY_VERSION,
          requestId: trimmedTurnId,
          trigger,
        },
      );
      entries.push(requestStart);
    }
    if (entries.length === 0) {
      return currentSummary === summary ? undefined : currentSummary;
    }

    const nextLeafId = entries[entries.length - 1]?.id ?? state.leafId;
    await this.queueWrite(state, async () => {
      if (!state.flushed) {
        await this.ensureSessionFile(state);
      }
      await this.appendEntries(state, entries);
    });

    state.leafId = nextLeafId;
    state.openRequestId = trimmedTurnId;
    return currentSummary === summary ? undefined : currentSummary;
  }

  async appendTurnEnd(options: {
    summary: SessionSummary;
    turnId: string;
    status: PiTurnStatus;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<SessionSummary | undefined> {
    const { summary, turnId, status, updateAttributes } = options;
    const trimmedTurnId = turnId.trim();
    if (!trimmedTurnId) {
      return undefined;
    }

    let currentSummary = summary;
    const stateInfo = await this.ensureSessionState({
      summary: currentSummary,
      ...(updateAttributes ? { updateAttributes } : {}),
    });
    currentSummary = stateInfo.summary;
    const state = stateInfo.state;

    const targetRequestId = state.openRequestId ?? (await resolveOpenRequestIdFromFile(state.sessionFile));
    if (!targetRequestId) {
      return currentSummary === summary ? undefined : currentSummary;
    }

    const entry = this.createRequestBoundaryEntry(state.leafId, ASSISTANT_REQUEST_END_CUSTOM_TYPE, {
      v: ASSISTANT_REQUEST_BOUNDARY_VERSION,
      requestId: targetRequestId,
      status,
    });

    await this.queueWrite(state, async () => {
      if (!state.flushed) {
        await this.ensureSessionFile(state);
      }
      await this.appendEntries(state, [entry]);
    });

    state.leafId = entry.id;
    if (state.openRequestId === targetRequestId) {
      state.openRequestId = null;
    }
    return currentSummary === summary ? undefined : currentSummary;
  }

  async appendSessionInfo(options: {
    summary: SessionSummary;
    name: string;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<SessionSummary | undefined> {
    const { summary, name, updateAttributes } = options;

    let currentSummary = summary;
    const stateInfo = await this.ensureSessionState({
      summary: currentSummary,
      ...(updateAttributes ? { updateAttributes } : {}),
    });
    currentSummary = stateInfo.summary;
    const state = stateInfo.state;

    const entry: PiSessionInfoEntry = {
      type: 'session_info',
      id: generateEntryId(),
      parentId: state.leafId,
      timestamp: this.now().toISOString(),
      name: name.trim(),
    };

    this.log('appendSessionInfo requested', {
      sessionId: summary.sessionId,
      piSessionId: state.piSessionId,
      cwd: state.cwd,
      flushed: state.flushed,
      hasAssistant: state.hasAssistant,
      sessionFile: state.sessionFile,
      name: entry.name,
    });

    const nextLeafId = entry.id;
    await this.queueWrite(state, async () => {
      if (!state.flushed) {
        this.log('appendSessionInfo initializing session file', {
          sessionId: summary.sessionId,
          piSessionId: state.piSessionId,
          sessionFile: state.sessionFile,
        });
        await this.ensureSessionFile(state);
      }

      this.log('appendSessionInfo appending entry', {
        sessionId: summary.sessionId,
        piSessionId: state.piSessionId,
        sessionFile: state.sessionFile,
      });
      await this.appendEntries(state, [entry]);
    });

    state.leafId = nextLeafId;

    return currentSummary === summary ? undefined : currentSummary;
  }

  private async ensureSessionState(options: {
    summary: SessionSummary;
    updateAttributes?: (
      patch: SessionAttributesPatch,
    ) => Promise<SessionSummary | undefined>;
  }): Promise<{ summary: SessionSummary; state: PiSessionWriterState }> {
    const { summary, updateAttributes } = options;
    const existing = this.sessions.get(summary.sessionId);
    if (existing) {
      return { summary, state: existing };
    }

    const resolvedCwd = resolveSessionCwd(summary) ?? os.homedir();
    const providerInfo = getProviderAttributes(summary.attributes, 'pi', ['pi-cli']);
    const storedSessionId = isNonEmptyString(providerInfo?.['sessionId'])
      ? String(providerInfo?.['sessionId']).trim()
      : '';
    const storedCwd = isNonEmptyString(providerInfo?.['cwd'])
      ? String(providerInfo?.['cwd']).trim()
      : '';

    const piSessionId = storedSessionId || randomUUID();
    const cwd = storedCwd || resolvedCwd;

    const encoded = encodePiCwd(cwd);
    if (!encoded) {
      throw new Error('Failed to resolve Pi session directory');
    }
    const sessionDir = path.join(this.baseDir, encoded);

    let sessionFile =
      storedSessionId && storedCwd ? await findPiSessionFile(this.baseDir, cwd, piSessionId) : null;
    if (!sessionFile) {
      const timestamp = this.now().toISOString().replace(/[:.]/g, '-');
      sessionFile = path.join(sessionDir, `${timestamp}_${piSessionId}.jsonl`);
    }

    let currentSummary = summary;
    if ((!storedSessionId || !storedCwd) && updateAttributes) {
      try {
        const patch = buildProviderAttributesPatch('pi', {
          sessionId: piSessionId,
          cwd,
          transcriptRevision: getPiTranscriptRevision(currentSummary.attributes),
        });
        const updated = await updateAttributes(patch);
        if (updated) {
          currentSummary = updated;
        }
      } catch (err) {
        this.log('Failed to persist Pi session attributes', err);
      }
    }

    let leafId: string | null = null;
    let messageCount = 0;
    let messageSignatures: string[] = [];
    let hasAssistant = false;
    let toolCallIds = new Set<string>();
    let lastModel: ModelInfo | undefined;
    let lastThinking: PiThinkingLevel | undefined;
    let openRequestId: string | null = null;
    let flushed = false;

    if (sessionFile) {
      try {
        const stats = await fs.stat(sessionFile);
        if (stats.isFile()) {
          const existingState = await loadExistingPiSessionState(sessionFile);
          leafId = existingState.leafId;
          messageCount = existingState.messageCount;
          messageSignatures = existingState.messageSignatures;
          hasAssistant = existingState.hasAssistant;
          toolCallIds = existingState.toolCallIds;
          lastModel = existingState.lastModel;
          lastThinking = existingState.lastThinking;
          openRequestId = existingState.openRequestId;
          flushed = true;
        }
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== 'ENOENT') {
          this.log('Failed to stat Pi session file', err);
        }
      }
    }

    const header: PiSessionHeader = {
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id: piSessionId,
      timestamp: this.now().toISOString(),
      cwd,
    };

    const state: PiSessionWriterState = {
      sessionId: summary.sessionId,
      piSessionId,
      cwd,
      sessionDir,
      sessionFile,
      header,
      leafId,
      writtenMessageCount: messageCount,
      messageSignatures,
      hasAssistant,
      toolCallIds,
      ...(lastModel ? { lastModel } : {}),
      ...(lastThinking ? { lastThinking } : {}),
      openRequestId,
      flushed,
      pendingEntries: [],
      writeQueue: Promise.resolve(),
    };

    this.sessions.set(summary.sessionId, state);
    if (!state.flushed) {
      await this.queueWrite(state, async () => {
        await this.ensureSessionFile(state);
      });
    }
    return { summary: currentSummary, state };
  }

  private async queueWrite(
    state: PiSessionWriterState,
    task: () => Promise<void>,
  ): Promise<void> {
    state.writeQueue = state.writeQueue.then(task).catch((err) => {
      this.log('Pi session write failed', err);
    });
    await state.writeQueue;
  }

  private async ensureSessionFile(state: PiSessionWriterState): Promise<void> {
    if (state.flushed) {
      return;
    }
    await fs.mkdir(state.sessionDir, { recursive: true });
    await fs.writeFile(state.sessionFile, `${JSON.stringify(state.header)}\n`, 'utf8');
    state.pendingEntries = [];
    state.flushed = true;
  }

  private async appendEntries(state: PiSessionWriterState, entries: PiSessionEntry[]): Promise<void> {
    if (entries.length === 0) {
      return;
    }
    await fs.mkdir(state.sessionDir, { recursive: true });
    const payload = entries.map((entry) => JSON.stringify(entry)).join('\n');
    await fs.appendFile(state.sessionFile, `${payload}\n`, 'utf8');
  }

  private createRequestBoundaryEntry(
    parentId: string | null,
    customType:
      | typeof ASSISTANT_REQUEST_START_CUSTOM_TYPE
      | typeof ASSISTANT_REQUEST_END_CUSTOM_TYPE,
    data: PiRequestBoundaryData,
  ): PiSessionCustomEntry {
    return {
      type: 'custom',
      id: generateEntryId(),
      parentId,
      timestamp: this.now().toISOString(),
      customType,
      data,
    };
  }
}
