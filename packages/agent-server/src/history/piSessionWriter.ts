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

import type { ChatCompletionMessage } from '../chatCompletionTypes';
import type { SessionSummary } from '../sessionIndex';
import { buildProviderAttributesPatch, getProviderAttributes } from './providerAttributes';

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
  hasAssistant: boolean;
  lastModel?: ModelInfo;
  lastThinking?: PiThinkingLevel;
  flushed: boolean;
  pendingEntries: PiSessionEntry[];
  writeQueue: Promise<void>;
};

export type PiSessionWriterOptions = {
  baseDir?: string;
  now?: () => Date;
  log?: (...args: unknown[]) => void;
};

const CURRENT_SESSION_VERSION = 3;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

function buildUserMessage(content: string, timestamp: number): PiSdkMessage {
  const block: TextContent = { type: 'text', text: content };
  return {
    role: 'user',
    content: [block],
    timestamp,
  };
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
    blocks.push({ type: 'text', text: message.content });
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
  hasAssistant: boolean;
  lastModel?: ModelInfo;
  lastThinking?: PiThinkingLevel;
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
      hasAssistant: false,
    };
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let leafId: string | null = null;
  let messageCount = 0;
  let hasAssistant = false;
  let lastModel: ModelInfo | undefined;
  let lastThinking: PiThinkingLevel | undefined;

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
      const message = entry['message'] as Record<string, unknown> | undefined;
      if (message && message['role'] === 'assistant') {
        hasAssistant = true;
        const provider = typeof message['provider'] === 'string' ? message['provider'] : undefined;
        const modelId = typeof message['model'] === 'string' ? message['model'] : undefined;
        const api = typeof message['api'] === 'string' ? message['api'] : undefined;
        if (provider && modelId) {
          lastModel = { provider, modelId, ...(api ? { api } : {}) };
        }
      }
    }
    if (entryType === 'custom_message') {
      // Count assistant-injected inputs as "messages" for sync deduplication.
      const customType = typeof entry['customType'] === 'string' ? entry['customType'] : '';
      if (customType === 'assistant.input') {
        messageCount += 1;
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
    hasAssistant,
    ...(lastModel ? { lastModel } : {}),
    ...(lastThinking ? { lastThinking } : {}),
  };
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
    if (persistableMessages.length < state.writtenMessageCount) {
      this.sessions.delete(summary.sessionId);
      return this.sync(options);
    }

    const newMessages = persistableMessages.slice(state.writtenMessageCount);
    if (newMessages.length === 0) {
      return currentSummary === summary ? undefined : currentSummary;
    }

    const normalizedThinking = normalizeThinkingLevel(thinkingLevel);
    const modelInfo = resolveModelInfo({
      messages: newMessages,
      ...(modelSpec ? { modelSpec } : {}),
      ...(defaultProvider ? { defaultProvider } : {}),
    });

    const toolCallNameMap = buildToolCallNameMap(persistableMessages);
    const baseTimestamp = Date.now();
    let messageTimestamp = baseTimestamp;
    const nextMessageTimestamp = () => messageTimestamp++;

    let leafId = state.leafId;
    let messageCount = state.writtenMessageCount;
    let hasAssistant = state.hasAssistant;

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
      const messageTimestampValue = nextMessageTimestamp();
      if (message.role === 'user') {
        const text = message.content ?? '';
        const meta = message.meta;

        if (meta?.source === 'agent') {
          const details: Record<string, unknown> = {
            kind: 'agent',
            ...(meta.fromAgentId ? { fromAgentId: meta.fromAgentId } : {}),
            ...(meta.fromSessionId ? { fromSessionId: meta.fromSessionId } : {}),
          };
          const entry: PiSessionCustomMessageEntry = {
            type: 'custom_message',
            id: generateEntryId(),
            parentId: leafId,
            timestamp: this.now().toISOString(),
            customType: 'assistant.input',
            content: text,
            details,
            display: true,
          };
          entries.push(entry);
          leafId = entry.id;
          messageCount += 1;
          continue;
        }

        if (meta?.source === 'callback') {
          const details: Record<string, unknown> = {
            kind: 'callback',
            ...(meta.fromAgentId ? { fromAgentId: meta.fromAgentId } : {}),
            ...(meta.fromSessionId ? { fromSessionId: meta.fromSessionId } : {}),
          };
          const entry: PiSessionCustomMessageEntry = {
            type: 'custom_message',
            id: generateEntryId(),
            parentId: leafId,
            timestamp: this.now().toISOString(),
            customType: 'assistant.input',
            content: text,
            details,
            display: meta.visibility === 'visible',
          };
          entries.push(entry);
          leafId = entry.id;
          messageCount += 1;
          continue;
        }

        const piMessage = buildUserMessage(text, messageTimestampValue);
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
      if (!state.flushed && !hasAssistant) {
        state.pendingEntries.push(...entries);
        return;
      }

      if (!state.flushed) {
        await this.flushPending(state, entries, hasAssistant);
        return;
      }

      await this.appendEntries(state, entries);
    });

    state.leafId = leafId;
    state.writtenMessageCount = messageCount;
    state.hasAssistant = hasAssistant;

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
      customType: 'assistant.event',
      data: {
        chatEventType: eventType,
        payload,
        ...(typeof turnId === 'string' && turnId.trim() ? { turnId: turnId.trim() } : {}),
        ...(typeof responseId === 'string' && responseId.trim()
          ? { responseId: responseId.trim() }
          : {}),
      },
    };

    const nextLeafId = entry.id;
    await this.queueWrite(state, async () => {
      if (!state.flushed && !state.hasAssistant) {
        state.pendingEntries.push(entry);
        return;
      }

      if (!state.flushed) {
        await this.flushPending(state, [entry], state.hasAssistant);
        return;
      }

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
    let hasAssistant = false;
    let lastModel: ModelInfo | undefined;
    let lastThinking: PiThinkingLevel | undefined;
    let flushed = false;

    if (sessionFile) {
      try {
        const stats = await fs.stat(sessionFile);
        if (stats.isFile()) {
          const existingState = await loadExistingPiSessionState(sessionFile);
          leafId = existingState.leafId;
          messageCount = existingState.messageCount;
          hasAssistant = existingState.hasAssistant;
          lastModel = existingState.lastModel;
          lastThinking = existingState.lastThinking;
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
      hasAssistant,
      ...(lastModel ? { lastModel } : {}),
      ...(lastThinking ? { lastThinking } : {}),
      flushed,
      pendingEntries: [],
      writeQueue: Promise.resolve(),
    };

    this.sessions.set(summary.sessionId, state);
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

  private async flushPending(
    state: PiSessionWriterState,
    entries: PiSessionEntry[],
    hasAssistant: boolean,
  ): Promise<void> {
    if (!hasAssistant) {
      state.pendingEntries.push(...entries);
      return;
    }
    await fs.mkdir(state.sessionDir, { recursive: true });
    const payload = [state.header, ...state.pendingEntries, ...entries]
      .map((entry) => JSON.stringify(entry))
      .join('\n');
    await fs.writeFile(state.sessionFile, `${payload}\n`, 'utf8');
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
}
