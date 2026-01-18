import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatEvent, SessionAttributes } from '@assistant/shared';

import type { AgentDefinition } from '../agents';
import type { EventStore } from '../events';

export interface HistoryRequest {
  sessionId: string;
  agentId?: string;
  providerId?: string | null;
  agent?: AgentDefinition;
  attributes?: SessionAttributes;
  after?: string;
  force?: boolean;
}

export interface HistoryProvider {
  supports(providerId?: string | null): boolean;
  getHistory(request: HistoryRequest): Promise<ChatEvent[]>;
}

export class HistoryProviderRegistry {
  constructor(private readonly providers: HistoryProvider[]) {}

  async getHistory(request: HistoryRequest): Promise<ChatEvent[]> {
    const provider =
      this.providers.find((candidate) => candidate.supports(request.providerId)) ?? null;
    if (!provider) {
      return [];
    }
    return provider.getHistory(request);
  }
}

export class EventStoreHistoryProvider implements HistoryProvider {
  constructor(private readonly eventStore: EventStore) {}

  supports(_providerId?: string | null): boolean {
    return true;
  }

  async getHistory(request: HistoryRequest): Promise<ChatEvent[]> {
    const { sessionId, after } = request;
    if (after) {
      return this.eventStore.getEventsSince(sessionId, after);
    }
    return this.eventStore.getEvents(sessionId);
  }
}

type PiSessionCacheEntry = {
  mtimeMs: number;
  events: ChatEvent[];
};

export class PiSessionHistoryProvider implements HistoryProvider {
  private readonly cache = new Map<string, PiSessionCacheEntry>();

  constructor(
    private readonly options: {
      baseDir?: string;
      eventStore?: EventStore;
    },
  ) {}

  supports(providerId?: string | null): boolean {
    return providerId === 'pi-cli';
  }

  async getHistory(request: HistoryRequest): Promise<ChatEvent[]> {
    const { sessionId, force } = request;
    const sessionInfo = resolvePiSessionInfo(request.attributes);
    if (!sessionInfo) {
      return this.fallbackToEventStore(request);
    }
    const baseDir = this.options.baseDir ?? path.join(os.homedir(), '.pi', 'agent', 'sessions');
    const sessionPath = await findPiSessionFile(baseDir, sessionInfo.cwd, sessionInfo.sessionId);
    if (!sessionPath) {
      return this.fallbackToEventStore(request);
    }

    let stats: { mtimeMs: number } | null = null;
    try {
      const stat = await fs.stat(sessionPath);
      if (stat.isFile()) {
        stats = { mtimeMs: stat.mtimeMs };
      }
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error('[history] Failed to stat Pi session file', {
          sessionId: sessionInfo.sessionId,
          path: sessionPath,
          error: error.message,
        });
      }
      this.cache.delete(sessionPath);
      return this.fallbackToEventStore(request);
    }

    if (!stats) {
      this.cache.delete(sessionPath);
      return this.fallbackToEventStore(request);
    }

    const cached = this.cache.get(sessionPath);
    if (!force && cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.events;
    }

    let content: string;
    try {
      content = await fs.readFile(sessionPath, 'utf8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      console.error('[history] Failed to read Pi session file', {
        sessionId: sessionInfo.sessionId,
        path: sessionPath,
        error: error.message,
      });
      this.cache.delete(sessionPath);
      return this.fallbackToEventStore(request);
    }

    const events = buildChatEventsFromPiSession(content, sessionId);
    this.cache.set(sessionPath, { mtimeMs: stats.mtimeMs, events });
    return events;
  }

  private async fallbackToEventStore(request: HistoryRequest): Promise<ChatEvent[]> {
    if (!this.options.eventStore) {
      return [];
    }
    const fallback = new EventStoreHistoryProvider(this.options.eventStore);
    return fallback.getHistory(request);
  }
}

type PiSessionInfo = {
  sessionId: string;
  cwd: string;
};

function resolvePiSessionInfo(attributes?: SessionAttributes): PiSessionInfo | null {
  if (!attributes || typeof attributes !== 'object') {
    return null;
  }
  const providers = (attributes as Record<string, unknown>)['providers'];
  if (!providers || typeof providers !== 'object' || Array.isArray(providers)) {
    return null;
  }
  const pi = (providers as Record<string, unknown>)['pi'];
  if (!pi || typeof pi !== 'object' || Array.isArray(pi)) {
    return null;
  }
  const candidate = pi as Record<string, unknown>;
  const sessionId = candidate['sessionId'];
  const cwd = candidate['cwd'];
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(cwd)) {
    return null;
  }
  return { sessionId: sessionId.trim(), cwd: cwd.trim() };
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
  let entries: Dirent[];
  try {
    entries = await fs.readdir(sessionDir, { withFileTypes: true });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      console.error('[history] Failed to read Pi session directory', {
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function buildChatEventsFromPiSession(content: string, sessionId: string): ChatEvent[] {
  const entries = parseJsonLines(content);
  const events: ChatEvent[] = [];

  let currentTurnId: string | null = null;
  let currentResponseId: string | null = null;

  const endTurn = (timestamp: number): void => {
    if (!currentTurnId) {
      return;
    }
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId: currentTurnId,
      type: 'turn_end',
      payload: {},
    });
    currentTurnId = null;
    currentResponseId = null;
  };

  const startTurn = (turnId: string, trigger: 'user' | 'system', timestamp: number): void => {
    currentTurnId = turnId;
    currentResponseId = null;
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId,
      type: 'turn_start',
      payload: { trigger },
    });
  };

  for (const entry of entries) {
    const entryType = getString(entry['type']);
    if (entryType === 'session' || entryType === 'session_header') {
      continue;
    }

    if (entryType === 'compaction' || entryType === 'branch_summary') {
      const timestamp = resolveTimestamp(entry);
      endTurn(timestamp);
      const turnId = getTurnId(entry);
      startTurn(turnId, 'system', timestamp);
      events.push({
        id: randomUUID(),
        timestamp,
        sessionId,
        turnId,
        type: 'summary_message',
        payload: {
          text: extractText(entry),
          summaryType: entryType === 'compaction' ? 'compaction' : 'branch_summary',
        },
      });
      endTurn(timestamp);
      continue;
    }

    if (entryType === 'custom_message') {
      const timestamp = resolveTimestamp(entry);
      endTurn(timestamp);
      const turnId = getTurnId(entry);
      const label = extractLabel(entry);
      startTurn(turnId, 'system', timestamp);
      events.push({
        id: randomUUID(),
        timestamp,
        sessionId,
        turnId,
        type: 'custom_message',
        payload: {
          text: extractText(entry),
          ...(label ? { label } : {}),
        },
      });
      endTurn(timestamp);
      continue;
    }

    const messageEntry = resolveMessageEntry(entry);
    const role = getString(messageEntry['role']);
    if (role === 'user') {
      const timestamp = resolveTimestamp(messageEntry, entry);
      endTurn(timestamp);
      const turnId = getTurnId(messageEntry);
      startTurn(turnId, 'user', timestamp);
      events.push({
        id: randomUUID(),
        timestamp,
        sessionId,
        turnId,
        type: 'user_message',
        payload: { text: extractText(messageEntry) },
      });
      continue;
    }

    if (role === 'assistant') {
      const timestamp = resolveTimestamp(messageEntry, entry);
      if (!currentTurnId) {
        const turnId = getTurnId(messageEntry);
        startTurn(turnId, 'system', timestamp);
      }
      if (!currentTurnId) {
        continue;
      }
      const responseId: string = currentResponseId ?? getResponseId(messageEntry);
      currentResponseId = responseId;

      const thinkingText = extractThinking(messageEntry);
      if (thinkingText) {
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId: currentTurnId,
          responseId,
          type: 'thinking_done',
          payload: { text: thinkingText },
        });
      }

      const toolCalls = extractToolCalls(messageEntry);
      for (const call of toolCalls) {
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId: currentTurnId,
          responseId,
          type: 'tool_call',
          payload: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            args: call.args,
          },
        });
      }

      const assistantText = extractText(messageEntry);
      if (assistantText) {
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId: currentTurnId,
          responseId,
          type: 'assistant_done',
          payload: { text: assistantText },
        });
      }

      continue;
    }

    if (role === 'toolResult' || role === 'tool_result' || entryType === 'tool_result') {
      const timestamp = resolveTimestamp(messageEntry, entry);
      if (!currentTurnId) {
        const turnId = getTurnId(messageEntry);
        startTurn(turnId, 'system', timestamp);
      }
      const responseId: string = currentResponseId ?? getResponseId(messageEntry);
      currentResponseId = responseId;

      const toolCallId = getToolCallId(messageEntry);
      const toolResult = extractToolResult(messageEntry);
      const error = extractToolError(messageEntry);

      if (currentTurnId) {
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId: currentTurnId,
          responseId,
          type: 'tool_result',
          payload: {
            toolCallId,
            result: toolResult,
            ...(error ? { error } : {}),
          },
        });
      }
      continue;
    }
  }

  const finalTimestamp = Date.now();
  endTurn(finalTimestamp);
  return events;
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entries.push(parsed as Record<string, unknown>);
      }
    } catch (err) {
      console.error('[history] Failed to parse Pi session line', line);
    }
  }
  return entries;
}

function resolveMessageEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const message = entry['message'];
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    return message as Record<string, unknown>;
  }
  return entry;
}

function getTurnId(entry: Record<string, unknown>): string {
  const rawId = getString(entry['id']);
  return rawId || randomUUID();
}

function getResponseId(entry: Record<string, unknown>): string {
  const rawId = getString(entry['id']);
  return rawId || randomUUID();
}

function resolveTimestamp(
  entry: Record<string, unknown>,
  fallback?: Record<string, unknown>,
): number {
  const raw =
    entry['timestamp'] ??
    entry['createdAt'] ??
    entry['time'] ??
    fallback?.['timestamp'] ??
    fallback?.['createdAt'] ??
    fallback?.['time'];
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function extractText(entry: Record<string, unknown>): string {
  const raw =
    entry['content'] ??
    entry['text'] ??
    entry['message'] ??
    entry['summary'] ??
    entry['output'];
  return extractTextValue(raw);
}

function extractTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractTextValue).filter((chunk) => chunk.length > 0).join('');
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const text = record['text'];
    if (typeof text === 'string') {
      return text;
    }
    const content = record['content'];
    if (content) {
      return extractTextValue(content);
    }
  }
  return '';
}

function extractLabel(entry: Record<string, unknown>): string | null {
  const raw = entry['label'] ?? entry['title'] ?? entry['name'] ?? entry['kind'];
  const label = getString(raw);
  return label || null;
}

function extractThinking(entry: Record<string, unknown>): string {
  const raw = entry['thinking'] ?? entry['thinkingContent'] ?? entry['reasoning'] ?? entry['analysis'];
  return extractTextValue(raw);
}

type ToolCallEntry = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

function extractToolCalls(entry: Record<string, unknown>): ToolCallEntry[] {
  const raw = entry['toolCalls'] ?? entry['tool_calls'] ?? entry['tools'];
  if (!Array.isArray(raw)) {
    return [];
  }

  const calls: ToolCallEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const call = item as Record<string, unknown>;
    const toolCallId = getString(call['id']) || getString(call['toolCallId']) || randomUUID();
    const toolName =
      getString(call['name']) || getString(call['toolName']) || getString(call['tool']) || '';
    if (!toolName) {
      continue;
    }
    const args = coerceArgs(call['args'] ?? call['arguments'] ?? call['input']);
    calls.push({ toolCallId, toolName, args });
  }
  return calls;
}

function getToolCallId(entry: Record<string, unknown>): string {
  return (
    getString(entry['toolCallId']) ||
    getString(entry['callId']) ||
    getString(entry['id']) ||
    randomUUID()
  );
}

function extractToolResult(entry: Record<string, unknown>): unknown {
  if ('result' in entry) {
    return entry['result'];
  }
  if ('output' in entry) {
    return entry['output'];
  }
  if ('content' in entry) {
    return entry['content'];
  }
  return null;
}

function extractToolError(
  entry: Record<string, unknown>,
): { code: string; message: string } | undefined {
  const raw = entry['error'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const code = getString(record['code']) || 'tool_error';
  const message = getString(record['message']) || 'Tool call failed';
  return { code, message };
}

function coerceArgs(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
  }
  return {};
}

function getString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
