import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatEvent, SessionAttributes } from '@assistant/shared';

import type { AgentDefinition } from '../agents';
import type { EventStore } from '../events';
import { getCodexSessionStore } from '../codexSessionStore';
import { getProviderAttributes } from './providerAttributes';

const HISTORY_DEBUG = process.env['ASSISTANT_HISTORY_DEBUG'] === '1';
const historyDebug = (...args: unknown[]): void => {
  if (!HISTORY_DEBUG) {
    return;
  }
  console.log('[history]', ...args);
};

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
  shouldPersist?(request: HistoryRequest): boolean;
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

  shouldPersist(request: HistoryRequest): boolean {
    const provider =
      this.providers.find((candidate) => candidate.supports(request.providerId)) ?? null;
    if (!provider || typeof provider.shouldPersist !== 'function') {
      return true;
    }
    return provider.shouldPersist(request);
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

  shouldPersist(): boolean {
    return true;
  }
}

type ClaudeSessionCacheEntry = {
  mtimeMs: number;
  events: ChatEvent[];
};

export class ClaudeSessionHistoryProvider implements HistoryProvider {
  private readonly cache = new Map<string, ClaudeSessionCacheEntry>();

  constructor(
    private readonly options: {
      baseDir?: string;
      eventStore?: EventStore;
    },
  ) {}

  supports(providerId?: string | null): boolean {
    return providerId === 'claude-cli';
  }

  shouldPersist(_request: HistoryRequest): boolean {
    return false;
  }

  async getHistory(request: HistoryRequest): Promise<ChatEvent[]> {
    const { sessionId, force } = request;
    const sessionInfo = resolveClaudeSessionInfo(request.attributes);
    if (!sessionInfo) {
      return [];
    }
    const baseDir = this.options.baseDir ?? path.join(os.homedir(), '.claude', 'projects');
    const sessionPath = await findClaudeSessionFile(baseDir, sessionInfo.cwd, sessionInfo.sessionId);
    if (!sessionPath) {
      return [];
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
        console.error('[history] Failed to stat Claude session file', {
          sessionId: sessionInfo.sessionId,
          path: sessionPath,
          error: error.message,
        });
      }
      this.cache.delete(sessionPath);
      return [];
    }

    if (!stats) {
      this.cache.delete(sessionPath);
      return [];
    }

    const cached = this.cache.get(sessionPath);
    if (!force && cached && cached.mtimeMs === stats.mtimeMs) {
      return mergeOverlayEvents(cached.events, sessionId, this.options.eventStore);
    }

    let content: string;
    try {
      content = await fs.readFile(sessionPath, 'utf8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      console.error('[history] Failed to read Claude session file', {
        sessionId: sessionInfo.sessionId,
        path: sessionPath,
        error: error.message,
      });
      this.cache.delete(sessionPath);
      return [];
    }

    const events = buildChatEventsFromClaudeSession(content, sessionId);
    this.cache.set(sessionPath, { mtimeMs: stats.mtimeMs, events });
    return mergeOverlayEvents(events, sessionId, this.options.eventStore);
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
    return providerId === 'pi-cli' || providerId === 'pi';
  }

  shouldPersist(request: HistoryRequest): boolean {
    // Persist events until we have enough metadata to resolve the Pi session JSONL.
    // This avoids a "blank transcript" gap before the Pi session file exists.
    const sessionInfo = resolvePiSessionInfo(request.attributes);
    return !sessionInfo;
  }

  async getHistory(request: HistoryRequest): Promise<ChatEvent[]> {
    const { sessionId, force, after } = request;
    const fallbackToEventStore = async (): Promise<ChatEvent[]> => {
      if (!this.options.eventStore) {
        return [];
      }
      if (after) {
        return this.options.eventStore.getEventsSince(sessionId, after);
      }
      return this.options.eventStore.getEvents(sessionId);
    };

    const sessionInfo = resolvePiSessionInfo(request.attributes);
    if (!sessionInfo) {
      return fallbackToEventStore();
    }
    const baseDir = this.options.baseDir ?? path.join(os.homedir(), '.pi', 'agent', 'sessions');
    const sessionPath = await findPiSessionFile(baseDir, sessionInfo.cwd, sessionInfo.sessionId);
    if (!sessionPath) {
      return fallbackToEventStore();
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
      return [];
    }

    if (!stats) {
      this.cache.delete(sessionPath);
      return [];
    }

    const cached = this.cache.get(sessionPath);
    if (!force && cached && cached.mtimeMs === stats.mtimeMs) {
      return mergeOverlayEvents(cached.events, sessionId, this.options.eventStore);
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
      return [];
    }

    const events = buildChatEventsFromPiSession(content, sessionId);
    this.cache.set(sessionPath, { mtimeMs: stats.mtimeMs, events });
    return mergeOverlayEvents(events, sessionId, this.options.eventStore);
  }
}

type CodexSessionCacheEntry = {
  mtimeMs: number;
  events: ChatEvent[];
};

export class CodexSessionHistoryProvider implements HistoryProvider {
  private readonly cache = new Map<string, CodexSessionCacheEntry>();
  private readonly pathCache = new Map<string, string>();

  constructor(
    private readonly options: {
      baseDir?: string;
      eventStore?: EventStore;
      dataDir?: string;
    },
  ) {}

  supports(providerId?: string | null): boolean {
    return providerId === 'codex-cli';
  }

  shouldPersist(_request: HistoryRequest): boolean {
    return false;
  }

  async getHistory(request: HistoryRequest): Promise<ChatEvent[]> {
    const { sessionId, force } = request;
    const sessionInfo = resolveCodexSessionInfo(request.attributes);
    let codexSessionId = sessionInfo?.sessionId;

    if (!codexSessionId && this.options.dataDir) {
      try {
        const store = getCodexSessionStore(this.options.dataDir);
        const mapping = await store.get(sessionId);
        codexSessionId = mapping?.codexSessionId;
      } catch (err) {
        console.error('[history] Failed to read Codex session mapping', err);
      }
    }

    if (!codexSessionId) {
      return [];
    }

    const baseDir = this.options.baseDir ?? path.join(os.homedir(), '.codex', 'sessions');
    const sessionPath = await this.resolveCodexSessionPath(baseDir, codexSessionId);
    if (!sessionPath) {
      return [];
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
        console.error('[history] Failed to stat Codex session file', {
          sessionId: codexSessionId,
          path: sessionPath,
          error: error.message,
        });
      }
      this.cache.delete(sessionPath);
      return [];
    }

    if (!stats) {
      this.cache.delete(sessionPath);
      return [];
    }

    const cached = this.cache.get(sessionPath);
    if (!force && cached && cached.mtimeMs === stats.mtimeMs) {
      return mergeOverlayEvents(cached.events, sessionId, this.options.eventStore);
    }

    let content: string;
    try {
      content = await fs.readFile(sessionPath, 'utf8');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      console.error('[history] Failed to read Codex session file', {
        sessionId: codexSessionId,
        path: sessionPath,
        error: error.message,
      });
      this.cache.delete(sessionPath);
      return [];
    }

    const events = buildChatEventsFromCodexSession(content, sessionId);
    this.cache.set(sessionPath, { mtimeMs: stats.mtimeMs, events });
    return mergeOverlayEvents(events, sessionId, this.options.eventStore);
  }

  private async resolveCodexSessionPath(
    baseDir: string,
    codexSessionId: string,
  ): Promise<string | null> {
    const key = `${baseDir}::${codexSessionId}`;
    const cached = this.pathCache.get(key);
    if (cached) {
      try {
        const stat = await fs.stat(cached);
        if (stat.isFile()) {
          return cached;
        }
      } catch {
        this.pathCache.delete(key);
      }
    }

    const resolved = await findCodexSessionFile(baseDir, codexSessionId);
    if (resolved) {
      this.pathCache.set(key, resolved);
    }
    return resolved;
  }
}

type PiSessionInfo = {
  sessionId: string;
  cwd: string;
};

type CodexSessionInfo = {
  sessionId: string;
  cwd?: string;
};

type ClaudeSessionInfo = {
  sessionId: string;
  cwd: string;
};

function resolveClaudeSessionInfo(attributes?: SessionAttributes): ClaudeSessionInfo | null {
  const candidate = getProviderAttributes(attributes, 'claude-cli', ['claude']);
  if (!candidate) {
    return null;
  }
  const sessionId = candidate['sessionId'];
  const cwd = candidate['cwd'];
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(cwd)) {
    return null;
  }
  return { sessionId: sessionId.trim(), cwd: cwd.trim() };
}

function resolvePiSessionInfo(attributes?: SessionAttributes): PiSessionInfo | null {
  const candidate = getProviderAttributes(attributes, 'pi-cli', ['pi']);
  if (!candidate) {
    return null;
  }
  const sessionId = candidate['sessionId'];
  const cwd = candidate['cwd'];
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(cwd)) {
    return null;
  }
  return { sessionId: sessionId.trim(), cwd: cwd.trim() };
}

function resolveCodexSessionInfo(attributes?: SessionAttributes): CodexSessionInfo | null {
  const candidate = getProviderAttributes(attributes, 'codex-cli', ['codex']);
  if (!candidate) {
    return null;
  }
  const sessionId = candidate['sessionId'];
  if (!isNonEmptyString(sessionId)) {
    return null;
  }
  const cwd = candidate['cwd'];
  return {
    sessionId: sessionId.trim(),
    ...(isNonEmptyString(cwd) ? { cwd: cwd.trim() } : {}),
  };
}

function encodeClaudeCwd(cwd: string): string | null {
  const trimmed = cwd.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/[\\/:]/g, '-');
  if (!normalized) {
    return null;
  }
  return normalized;
}

async function findClaudeSessionFile(
  baseDir: string,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  const encoded = encodeClaudeCwd(cwd);
  if (!encoded) {
    return null;
  }
  const sessionDir = path.join(baseDir, encoded);
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  try {
    const stat = await fs.stat(sessionPath);
    if (stat.isFile()) {
      return sessionPath;
    }
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      console.error('[history] Failed to read Claude session file', {
        path: sessionPath,
        error: error.message,
      });
    }
  }
  return null;
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

async function findCodexSessionFile(
  baseDir: string,
  sessionId: string,
): Promise<string | null> {
  const suffix = `${sessionId}.jsonl`;
  const queue = [baseDir];
  let bestPath: string | null = null;
  let bestMtime = -1;

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'ENOENT') {
        console.error('[history] Failed to read Codex sessions directory', {
          path: current,
          error: error.message,
        });
      }
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(suffix)) {
        continue;
      }
      try {
        const stat = await fs.stat(entryPath);
        if (!stat.isFile()) {
          continue;
        }
        if (stat.mtimeMs >= bestMtime) {
          bestMtime = stat.mtimeMs;
          bestPath = entryPath;
        }
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        if (error.code !== 'ENOENT') {
          console.error('[history] Failed to stat Codex session file', {
            path: entryPath,
            error: error.message,
          });
        }
      }
    }
  }

  return bestPath;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOverlayEvent(event: ChatEvent): boolean {
  return (
    event.type === 'interaction_request' ||
    event.type === 'interaction_response' ||
    event.type === 'interaction_pending'
  );
}

function mergeEventsByTimestamp(baseEvents: ChatEvent[], overlayEvents: ChatEvent[]): ChatEvent[] {
  if (overlayEvents.length === 0) {
    return baseEvents;
  }
  const combined = [...baseEvents, ...overlayEvents].map((event, index) => ({
    event,
    order: index,
  }));
  combined.sort((a, b) => {
    const diff = a.event.timestamp - b.event.timestamp;
    if (diff !== 0) {
      return diff;
    }
    return a.order - b.order;
  });
  return combined.map((item) => item.event);
}

async function mergeOverlayEvents(
  baseEvents: ChatEvent[],
  sessionId: string,
  eventStore?: EventStore,
): Promise<ChatEvent[]> {
  if (!eventStore) {
    return baseEvents;
  }
  const overlayEvents = (await eventStore.getEvents(sessionId)).filter(isOverlayEvent);
  const alignedOverlayEvents = alignOverlayEvents(baseEvents, overlayEvents);
  historyDebug('merge overlay events', {
    sessionId,
    baseCount: baseEvents.length,
    overlayCount: overlayEvents.length,
    alignedCount: alignedOverlayEvents.length,
  });
  return mergeEventsByTimestamp(baseEvents, alignedOverlayEvents);
}

function alignOverlayEvents(baseEvents: ChatEvent[], overlayEvents: ChatEvent[]): ChatEvent[] {
  if (overlayEvents.length === 0) {
    return overlayEvents;
  }

  const toolCallAnchors = new Map<
    string,
    { turnId?: string; responseId?: string; timestamp: number }
  >();
  const toolResultAnchors = new Map<
    string,
    { turnId?: string; responseId?: string; timestamp: number }
  >();
  const toolCallCandidates: Array<{
    toolCallId: string;
    toolName: string;
    command?: string;
    timestamp: number;
    turnId?: string;
    responseId?: string;
  }> = [];

  for (const event of baseEvents) {
    if (event.type === 'tool_call') {
      toolCallAnchors.set(event.payload.toolCallId, {
        ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.responseId ? { responseId: event.responseId } : {}),
        timestamp: event.timestamp,
      });
      const args = event.payload.args as Record<string, unknown>;
      const command =
        args && typeof args === 'object' && typeof args['command'] === 'string'
          ? String(args['command'])
          : undefined;
      toolCallCandidates.push({
        toolCallId: event.payload.toolCallId,
        toolName: event.payload.toolName,
        ...(command ? { command } : {}),
        timestamp: event.timestamp,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.responseId ? { responseId: event.responseId } : {}),
      });
    } else if (event.type === 'tool_result') {
      toolResultAnchors.set(event.payload.toolCallId, {
        ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.responseId ? { responseId: event.responseId } : {}),
        timestamp: event.timestamp,
      });
    }
  }

  return overlayEvents.map((event) => {
    const payload = event.payload as { toolCallId?: string } | undefined;
    const toolCallId = payload?.toolCallId;
    if (!toolCallId) {
      historyDebug('overlay event missing toolCallId', {
        type: event.type,
        id: event.id,
        timestamp: event.timestamp,
      });
      return event;
    }

    const anchor = toolCallAnchors.get(toolCallId) ?? toolResultAnchors.get(toolCallId);
    const fallbackAnchor =
      anchor ?? matchOverlayToolCall(event, toolCallCandidates) ?? undefined;
    if (!fallbackAnchor) {
      historyDebug('overlay event missing anchor', {
        toolCallId,
        type: event.type,
        id: event.id,
        timestamp: event.timestamp,
      });
      return event;
    }

    let timestamp = event.timestamp;
    if (event.type === 'interaction_response') {
      const resultAnchor = toolResultAnchors.get(toolCallId) ?? fallbackAnchor;
      timestamp = resultAnchor.timestamp + 1;
    } else {
      timestamp = fallbackAnchor.timestamp + 1;
    }

    historyDebug('overlay event aligned', {
      toolCallId,
      type: event.type,
      id: event.id,
      fromTimestamp: event.timestamp,
      toTimestamp: timestamp,
      turnId: fallbackAnchor.turnId ?? null,
      responseId: fallbackAnchor.responseId ?? null,
    });

    return {
      ...event,
      timestamp,
      ...(fallbackAnchor.turnId ? { turnId: fallbackAnchor.turnId } : {}),
      ...(fallbackAnchor.responseId
        ? { responseId: fallbackAnchor.responseId }
        : {}),
    };
  });
}

function matchOverlayToolCall(
  event: ChatEvent,
  candidates: Array<{
    toolCallId: string;
    toolName: string;
    command?: string;
    timestamp: number;
    turnId?: string;
    responseId?: string;
  }>,
): { turnId?: string; responseId?: string; timestamp: number } | undefined {
  const payload = event.payload as { toolName?: string } | undefined;
  const toolName = payload?.toolName ?? '';
  if (!toolName || candidates.length === 0) {
    return undefined;
  }

  const normalizedCommandMatch = (command: string, needle: string): boolean =>
    command.toLowerCase().includes(needle.toLowerCase());

  const operationName =
    toolName.startsWith('interactive_tools_') ? toolName.replace('interactive_tools_', '') : '';

  const filtered = candidates.filter((candidate) => {
    if (!candidate.command) {
      return false;
    }
    if (toolName === 'questions_ask') {
      return normalizedCommandMatch(candidate.command, 'questions-cli') &&
        normalizedCommandMatch(candidate.command, 'ask');
    }
    if (operationName) {
      return normalizedCommandMatch(candidate.command, 'interactive-tools-cli') &&
        normalizedCommandMatch(candidate.command, operationName);
    }
    return normalizedCommandMatch(candidate.command, toolName);
  });

  if (filtered.length === 0) {
    return undefined;
  }

  const targetTimestamp = event.timestamp;
  let best = filtered[0]!;
  let bestDelta = Math.abs(targetTimestamp - best.timestamp);
  for (const candidate of filtered) {
    const delta = Math.abs(targetTimestamp - candidate.timestamp);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }

  return {
    ...(best.turnId ? { turnId: best.turnId } : {}),
    ...(best.responseId ? { responseId: best.responseId } : {}),
    timestamp: best.timestamp,
  };
}

function buildChatEventsFromClaudeSession(content: string, sessionId: string): ChatEvent[] {
  const entries = parseJsonLines(content);
  const events: ChatEvent[] = [];

  const emittedToolCalls = new Set<string>();
  const emittedToolResults = new Set<string>();
  const emittedAssistantText = new Set<string>();
  const emittedThinking = new Set<string>();
  const toolCallMeta = new Map<string, { toolName: string; args: Record<string, unknown> }>();

  let currentTurnId: string | null = null;
  let currentResponseId: string | null = null;

  const getClaudeTurnId = (
    entry: Record<string, unknown>,
    messageEntry?: Record<string, unknown>,
  ): string =>
    getString(entry['uuid']) ||
    getString(entry['messageId']) ||
    getString(messageEntry?.['id']) ||
    getString(entry['id']) ||
    randomUUID();

  const getClaudeResponseId = (
    entry: Record<string, unknown>,
    messageEntry?: Record<string, unknown>,
  ): string =>
    getString(messageEntry?.['id']) ||
    getString(entry['uuid']) ||
    getString(entry['id']) ||
    randomUUID();

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

  const startTurn = (turnId: string, trigger: 'user' | 'system' | 'callback', timestamp: number): void => {
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

  const ensureTurn = (entry: Record<string, unknown>, timestamp: number): string | null => {
    if (!currentTurnId) {
      const turnId = getClaudeTurnId(entry);
      startTurn(turnId, 'system', timestamp);
    }
    return currentTurnId;
  };

  const ensureResponseId = (entry: Record<string, unknown>, messageEntry?: Record<string, unknown>): string => {
    const responseId = currentResponseId ?? getClaudeResponseId(entry, messageEntry);
    currentResponseId = responseId;
    return responseId;
  };

  const resolveToolMeta = (
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): { toolName: string; args: Record<string, unknown> } => {
    const existing = toolCallMeta.get(toolCallId);
    const mergedName = toolName || existing?.toolName || '';
    const mergedArgs =
      Object.keys(args).length > 0 ? args : (existing?.args ?? ({} as Record<string, unknown>));
    if (mergedName) {
      toolCallMeta.set(toolCallId, { toolName: mergedName, args: mergedArgs });
    }
    return { toolName: mergedName, args: mergedArgs };
  };

  const emitToolCall = (
    entry: Record<string, unknown>,
    timestamp: number,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void => {
    if (!toolCallId) {
      return;
    }
    const meta = resolveToolMeta(toolCallId, toolName, args);
    if (!meta.toolName || emittedToolCalls.has(toolCallId)) {
      return;
    }
    const turnId = ensureTurn(entry, timestamp);
    if (!turnId) {
      return;
    }
    const responseId = ensureResponseId(entry);
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId,
      responseId,
      type: 'tool_call',
      payload: {
        toolCallId,
        toolName: meta.toolName,
        args: meta.args,
      },
    });
    emittedToolCalls.add(toolCallId);
  };

  const emitToolResult = (
    entry: Record<string, unknown>,
    timestamp: number,
    toolCallId: string,
    result: unknown,
    error?: { code: string; message: string },
  ): void => {
    if (!toolCallId || emittedToolResults.has(toolCallId)) {
      return;
    }
    const turnId = ensureTurn(entry, timestamp);
    if (!turnId) {
      return;
    }
    const responseId = ensureResponseId(entry);
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId,
      responseId,
      type: 'tool_result',
      payload: {
        toolCallId,
        result,
        ...(error ? { error } : {}),
      },
    });
    emittedToolResults.add(toolCallId);
  };

  const extractClaudeUserText = (messageEntry: Record<string, unknown>): string => {
    const content = messageEntry['content'];
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const item of content) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const block = item as Record<string, unknown>;
        const type = getString(block['type']);
        const normalized = type ? type.toLowerCase() : '';
        if (normalized === 'tool_result' || normalized.endsWith('_tool_result')) {
          continue;
        }
        const text = extractTextValue(block);
        if (text) {
          parts.push(text);
        }
      }
      return parts.join('');
    }
    return extractText(messageEntry);
  };

  const extractClaudeThinking = (messageEntry: Record<string, unknown>): string => {
    const content = messageEntry['content'];
    if (!Array.isArray(content)) {
      return '';
    }
    const parts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const block = item as Record<string, unknown>;
      const type = getString(block['type']);
      const normalized = type ? type.toLowerCase() : '';
      if (normalized !== 'thinking' && normalized !== 'analysis') {
        continue;
      }
      const raw = block['thinking'] ?? block['text'] ?? block['content'];
      const text = extractTextValue(raw);
      if (text) {
        parts.push(text);
      }
    }
    return parts.join('');
  };

  const extractClaudeToolResults = (
    entry: Record<string, unknown>,
    messageEntry: Record<string, unknown>,
  ): Array<{ toolCallId: string; result: unknown; error?: { code: string; message: string } }> => {
    const content = messageEntry['content'];
    if (!Array.isArray(content)) {
      return [];
    }
    const results: Array<{
      toolCallId: string;
      result: unknown;
      error?: { code: string; message: string };
    }> = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const block = item as Record<string, unknown>;
      const type = getString(block['type']);
      const normalized = type ? type.toLowerCase() : '';
      if (normalized !== 'tool_result' && !normalized.endsWith('_tool_result')) {
        continue;
      }
      const toolCallId =
        getString(block['tool_use_id']) ||
        getString(block['toolUseId']) ||
        getString(block['toolCallId']) ||
        getString(block['id']) ||
        randomUUID();
      const toolUseResult = entry['toolUseResult'];
      const result =
        toolUseResult !== undefined
          ? toolUseResult
          : 'result' in block
            ? block['result']
            : block['content'];
      const isError = block['is_error'] === true || block['isError'] === true;
      const error =
        extractToolError(block) ??
        (isError ? { code: 'tool_error', message: 'Tool call failed' } : undefined);
      results.push({ toolCallId, result, ...(error ? { error } : {}) });
    }
    return results;
  };

  for (const entry of entries) {
    const entryType = getString(entry['type']);
    if (entryType === 'file-history-snapshot') {
      continue;
    }
    if (entryType === 'summary') {
      continue;
    }
    if (entryType === 'system') {
      continue;
    }

    const messageEntry = resolveMessageEntry(entry);
    const role = getString(messageEntry['role']);

    if (role === 'user') {
      const toolResults = extractClaudeToolResults(entry, messageEntry);
      const userText = extractClaudeUserText(messageEntry);
      const timestamp = resolveTimestamp(messageEntry, entry);

      if (toolResults.length > 0 && !userText) {
        for (const result of toolResults) {
          emitToolResult(entry, timestamp, result.toolCallId, result.result, result.error);
        }
        continue;
      }

      endTurn(timestamp);
      const turnId = getClaudeTurnId(entry, messageEntry);
      startTurn(turnId, 'user', timestamp);
      events.push({
        id: randomUUID(),
        timestamp,
        sessionId,
        turnId,
        type: 'user_message',
        payload: { text: userText || extractText(messageEntry) },
      });
      continue;
    }

    if (role === 'assistant') {
      const timestamp = resolveTimestamp(messageEntry, entry);
      if (!currentTurnId) {
        const turnId = getClaudeTurnId(entry, messageEntry);
        startTurn(turnId, 'system', timestamp);
      }
      if (!currentTurnId) {
        continue;
      }

      const responseId = ensureResponseId(entry, messageEntry);

      const thinkingText = extractClaudeThinking(messageEntry);
      if (thinkingText && !emittedThinking.has(responseId)) {
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId: currentTurnId,
          responseId,
          type: 'thinking_done',
          payload: { text: thinkingText },
        });
        emittedThinking.add(responseId);
      }

      const toolCalls = extractToolCalls(messageEntry);
      for (const call of toolCalls) {
        emitToolCall(messageEntry, timestamp, call.toolCallId, call.toolName, call.args);
      }

      const assistantText = extractText(messageEntry);
      if (assistantText && !emittedAssistantText.has(responseId)) {
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId: currentTurnId,
          responseId,
          type: 'assistant_done',
          payload: { text: assistantText },
        });
        emittedAssistantText.add(responseId);
      }
      continue;
    }
  }

  const finalTimestamp = Date.now();
  endTurn(finalTimestamp);
  return events;
}

function buildChatEventsFromPiSession(content: string, sessionId: string): ChatEvent[] {
  const entries = parseJsonLines(content);
  const events: ChatEvent[] = [];

  const emittedToolCalls = new Set<string>();
  const emittedToolResults = new Set<string>();
  const toolCallMeta = new Map<string, { toolName: string; args: Record<string, unknown> }>();

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

  const startTurn = (turnId: string, trigger: 'user' | 'system' | 'callback', timestamp: number): void => {
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

  const ensureTurn = (entry: Record<string, unknown>, timestamp: number): string | null => {
    if (!currentTurnId) {
      const turnId = getTurnId(entry);
      startTurn(turnId, 'system', timestamp);
    }
    return currentTurnId;
  };

  const ensureResponseId = (entry: Record<string, unknown>): string => {
    const responseId = currentResponseId ?? getResponseId(entry);
    currentResponseId = responseId;
    return responseId;
  };

  const resolveToolMeta = (
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): { toolName: string; args: Record<string, unknown> } => {
    const existing = toolCallMeta.get(toolCallId);
    const mergedName = toolName || existing?.toolName || '';
    const mergedArgs =
      Object.keys(args).length > 0 ? args : (existing?.args ?? ({} as Record<string, unknown>));
    if (mergedName) {
      toolCallMeta.set(toolCallId, { toolName: mergedName, args: mergedArgs });
    }
    return { toolName: mergedName, args: mergedArgs };
  };

  const emitToolCall = (
    entry: Record<string, unknown>,
    timestamp: number,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void => {
    if (!toolCallId) {
      return;
    }
    const meta = resolveToolMeta(toolCallId, toolName, args);
    if (!meta.toolName || emittedToolCalls.has(toolCallId)) {
      return;
    }
    const turnId = ensureTurn(entry, timestamp);
    if (!turnId) {
      return;
    }
    const responseId = ensureResponseId(entry);
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId,
      responseId,
      type: 'tool_call',
      payload: {
        toolCallId,
        toolName: meta.toolName,
        args: meta.args,
      },
    });
    emittedToolCalls.add(toolCallId);
  };

  const emitToolResult = (
    entry: Record<string, unknown>,
    timestamp: number,
    toolCallId: string,
    result: unknown,
    error?: { code: string; message: string },
  ): void => {
    if (!toolCallId || emittedToolResults.has(toolCallId)) {
      return;
    }
    const turnId = ensureTurn(entry, timestamp);
    if (!turnId) {
      return;
    }
    const responseId = ensureResponseId(entry);
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId,
      responseId,
      type: 'tool_result',
      payload: {
        toolCallId,
        result,
        ...(error ? { error } : {}),
      },
    });
    emittedToolResults.add(toolCallId);
  };

  for (const entry of entries) {
    const entryType = getString(entry['type']);
    if (entryType === 'session' || entryType === 'session_header') {
      continue;
    }

    if (entryType === 'custom') {
      const customType = getString(entry['customType']);
      if (customType !== 'assistant.event') {
        continue;
      }
      const timestamp = resolveTimestamp(entry);
      const data = isRecord(entry['data']) ? (entry['data'] as Record<string, unknown>) : null;
      const chatEventType = data ? getString(data['chatEventType']) : '';
      const payload = data && isRecord(data['payload']) ? (data['payload'] as Record<string, unknown>) : null;
      const turnIdFromEntry = data ? getString(data['turnId']) : '';
      const responseIdFromEntry = data ? getString(data['responseId']) : '';

      if (chatEventType === 'agent_callback' && payload) {
        const messageId = getString(payload['messageId']) || randomUUID();
        const fromAgentId = getString(payload['fromAgentId']);
        const fromSessionId = getString(payload['fromSessionId']);
        const result = getString(payload['result']);
        if (!fromSessionId || !result) {
          continue;
        }
        const turnId = turnIdFromEntry || currentTurnId || '';
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          ...(turnId ? { turnId } : {}),
          ...(responseIdFromEntry ? { responseId: responseIdFromEntry } : {}),
          type: 'agent_callback',
          payload: {
            messageId,
            fromAgentId: fromAgentId || 'unknown',
            fromSessionId,
            result,
          },
        });
        continue;
      }

      if (
        (chatEventType === 'interaction_request' ||
          chatEventType === 'interaction_response' ||
          chatEventType === 'interaction_pending') &&
        payload
      ) {
        const turnId = turnIdFromEntry || currentTurnId || '';
        const responseId = responseIdFromEntry || '';
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          ...(turnId ? { turnId } : {}),
          ...(responseId ? { responseId } : {}),
          type: chatEventType,
          // Payload comes from a previously validated ChatEvent (when written).
          payload: payload as unknown,
        } as ChatEvent);
        continue;
      }

      if (chatEventType === 'interrupt') {
        const reason =
          payload && typeof payload['reason'] === 'string' ? (payload['reason'] as string) : '';
        if (!reason) {
          continue;
        }
        const normalizedReason =
          reason === 'user_cancel' || reason === 'timeout' || reason === 'error'
            ? reason
            : 'user_cancel';
        const turnId = turnIdFromEntry || currentTurnId || '';
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          ...(turnId ? { turnId } : {}),
          ...(responseIdFromEntry ? { responseId: responseIdFromEntry } : {}),
          type: 'interrupt',
          payload: { reason: normalizedReason },
        });
        continue;
      }

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
      const customType = getString(entry['customType']);
      if (customType === 'assistant.input') {
        const timestamp = resolveTimestamp(entry);
        const details = isRecord(entry['details']) ? (entry['details'] as Record<string, unknown>) : null;
        const kind = details ? getString(details['kind']) : '';
        const text = extractText(entry).trim();
        if (!text) {
          continue;
        }
        if (kind === 'agent') {
          endTurn(timestamp);
          const turnId = getTurnId(entry);
          startTurn(turnId, 'user', timestamp);
          const fromAgentId = details ? getString(details['fromAgentId']) : '';
          const fromSessionId = details ? getString(details['fromSessionId']) : '';
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            type: 'user_message',
            payload: {
              text,
              ...(fromAgentId ? { fromAgentId } : {}),
              ...(fromSessionId ? { fromSessionId } : {}),
            },
          });
          continue;
        }

        if (kind === 'callback') {
          endTurn(timestamp);
          const turnId = getTurnId(entry);
          startTurn(turnId, 'callback', timestamp);
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            type: 'agent_message',
            payload: {
              messageId: getString(entry['id']) || randomUUID(),
              targetAgentId: 'callback',
              targetSessionId: sessionId,
              message: text,
              wait: false,
            },
          });
          continue;
        }

        // Unknown assistant.input shape - fall back to a generic custom_message event.
      }
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

    if (entryType === 'tool_execution_start' || entryType === 'tool_execution_update') {
      const timestamp = resolveTimestamp(entry);
      const toolCallId = getToolCallId(entry);
      const toolName =
        getString(entry['toolName']) ||
        getString(entry['tool']) ||
        toolCallMeta.get(toolCallId)?.toolName ||
        '';
      const args = coerceArgs(entry['args'] ?? entry['input'] ?? entry['arguments']);
      emitToolCall(entry, timestamp, toolCallId, toolName, args);
      continue;
    }

    if (entryType === 'tool_execution_end') {
      const timestamp = resolveTimestamp(entry);
      const toolCallId = getToolCallId(entry);
      const toolName =
        getString(entry['toolName']) ||
        getString(entry['tool']) ||
        toolCallMeta.get(toolCallId)?.toolName ||
        '';
      const args = coerceArgs(entry['args'] ?? entry['input'] ?? entry['arguments']);
      emitToolCall(entry, timestamp, toolCallId, toolName, args);
      const isError = entry['isError'] === true;
      const error = isError ? extractToolError(entry) ?? {
        code: 'tool_error',
        message: 'Tool call failed',
      } : undefined;
      const result = extractToolResult(entry);
      emitToolResult(entry, timestamp, toolCallId, result, error);
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
      const turnId = currentTurnId;
      const responseId: string = currentResponseId ?? getResponseId(messageEntry);
      currentResponseId = responseId;

      const content = messageEntry['content'];
      if (Array.isArray(content)) {
        let thinkingBuffer = '';
        let textBuffer = '';

        const flushThinking = (): void => {
          if (!thinkingBuffer) {
            return;
          }
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            responseId,
            type: 'thinking_done',
            payload: { text: thinkingBuffer },
          });
          thinkingBuffer = '';
        };

        const flushText = (): void => {
          if (!textBuffer) {
            return;
          }
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            responseId,
            type: 'assistant_done',
            payload: { text: textBuffer },
          });
          textBuffer = '';
        };

        for (const item of content) {
          if (!item || typeof item !== 'object') {
            const text = extractTextValue(item);
            if (text) {
              textBuffer += text;
            }
            continue;
          }

          const block = item as Record<string, unknown>;
          const type = getString(block['type']);
          const normalized = type ? type.toLowerCase() : '';

          if (normalized === 'thinking' || normalized === 'analysis' || normalized === 'reasoning') {
            const text = extractTextValue(block['thinking'] ?? block['text'] ?? block['content']);
            if (text) {
              thinkingBuffer += text;
            }
            continue;
          }

          if (normalized === 'text') {
            const text = extractTextValue(block['text'] ?? block['content']);
            if (text) {
              textBuffer += text;
            }
            continue;
          }

          if (['toolcall', 'tool_call', 'tool_use', 'tooluse'].includes(normalized)) {
            flushThinking();
            flushText();
            const toolCallId = getString(block['id']) || getString(block['toolCallId']) || randomUUID();
            const toolName =
              getString(block['name']) || getString(block['toolName']) || getString(block['tool']) || '';
            const args = coerceArgs(block['arguments'] ?? block['args'] ?? block['input']);
            emitToolCall(messageEntry, timestamp, toolCallId, toolName, args);
            continue;
          }

          const text = extractTextValue(block['text'] ?? block['content']);
          if (text) {
            textBuffer += text;
          }
        }

        flushThinking();
        flushText();
      } else {
        const thinkingText = extractThinking(messageEntry);
        if (thinkingText) {
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            responseId,
            type: 'thinking_done',
            payload: { text: thinkingText },
          });
        }

        const toolCalls = extractToolCalls(messageEntry);
        for (const call of toolCalls) {
          emitToolCall(messageEntry, timestamp, call.toolCallId, call.toolName, call.args);
        }

        const assistantText = extractText(messageEntry);
        if (assistantText) {
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            responseId,
            type: 'assistant_done',
            payload: { text: assistantText },
          });
        }
      }

      continue;
    }

    if (role === 'toolResult' || role === 'tool_result' || entryType === 'tool_result') {
      const timestamp = resolveTimestamp(messageEntry, entry);
      const toolCallId = getToolCallId(messageEntry);
      const toolResult = extractToolResult(messageEntry);
      const toolName =
        getString(messageEntry['toolName']) ||
        getString(messageEntry['tool']) ||
        toolCallMeta.get(toolCallId)?.toolName ||
        '';
      const args = coerceArgs(messageEntry['args'] ?? messageEntry['input'] ?? messageEntry['arguments']);
      emitToolCall(messageEntry, timestamp, toolCallId, toolName, args);
      const error = extractToolError(messageEntry);
      emitToolResult(messageEntry, timestamp, toolCallId, toolResult, error);
      continue;
    }
  }

  const finalTimestamp = Date.now();
  endTurn(finalTimestamp);
  return events;
}

function buildChatEventsFromCodexSession(content: string, sessionId: string): ChatEvent[] {
  const entries = parseJsonLines(content);
  const events: ChatEvent[] = [];

  const hasEventUserMessages = entries.some(
    (entry) =>
      getString(entry['type']) === 'event_msg' &&
      isRecord(entry['payload']) &&
      getString(entry['payload']['type']) === 'user_message',
  );
  const hasEventAgentMessages = entries.some(
    (entry) =>
      getString(entry['type']) === 'event_msg' &&
      isRecord(entry['payload']) &&
      getString(entry['payload']['type']) === 'agent_message',
  );
  const hasEventReasoning = entries.some(
    (entry) =>
      getString(entry['type']) === 'event_msg' &&
      isRecord(entry['payload']) &&
      getString(entry['payload']['type']) === 'agent_reasoning',
  );

  const emittedToolCalls = new Set<string>();
  const emittedToolResults = new Set<string>();
  const toolCallMeta = new Map<string, { toolName: string; args: Record<string, unknown> }>();

  let currentTurnId: string | null = null;
  let currentResponseId: string | null = null;
  let thinkingBuffer = '';
  let thinkingTimestamp = 0;

  const endTurn = (timestamp: number): void => {
    if (!currentTurnId) {
      return;
    }
    flushThinking(timestamp);
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

  const ensureTurn = (entry: Record<string, unknown>, timestamp: number): string | null => {
    if (!currentTurnId) {
      const turnId = getTurnId(entry);
      startTurn(turnId, 'system', timestamp);
    }
    return currentTurnId;
  };

  const ensureResponseId = (): string => {
    if (!currentResponseId) {
      currentResponseId = randomUUID();
    }
    return currentResponseId;
  };

  const appendThinking = (text: string, timestamp: number): void => {
    if (!text) {
      return;
    }
    if (thinkingBuffer && !thinkingBuffer.endsWith('\n')) {
      thinkingBuffer += '\n\n';
    }
    thinkingBuffer += text;
    thinkingTimestamp = timestamp;
  };

  const flushThinking = (timestamp: number): void => {
    if (!thinkingBuffer || !currentTurnId) {
      thinkingBuffer = '';
      return;
    }
    const responseId = ensureResponseId();
    events.push({
      id: randomUUID(),
      timestamp: thinkingTimestamp || timestamp,
      sessionId,
      turnId: currentTurnId,
      responseId,
      type: 'thinking_done',
      payload: { text: thinkingBuffer },
    });
    thinkingBuffer = '';
    thinkingTimestamp = 0;
  };

  const resolveToolMeta = (
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): { toolName: string; args: Record<string, unknown> } => {
    const existing = toolCallMeta.get(toolCallId);
    const mergedName = toolName || existing?.toolName || '';
    const mergedArgs =
      Object.keys(args).length > 0 ? args : (existing?.args ?? ({} as Record<string, unknown>));
    if (mergedName) {
      toolCallMeta.set(toolCallId, { toolName: mergedName, args: mergedArgs });
    }
    return { toolName: mergedName, args: mergedArgs };
  };

  const emitToolCall = (
    entry: Record<string, unknown>,
    timestamp: number,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void => {
    if (!toolCallId) {
      return;
    }
    const meta = resolveToolMeta(toolCallId, toolName, args);
    if (!meta.toolName || emittedToolCalls.has(toolCallId)) {
      return;
    }
    const turnId = ensureTurn(entry, timestamp);
    if (!turnId) {
      return;
    }
    const responseId = ensureResponseId();
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId,
      responseId,
      type: 'tool_call',
      payload: {
        toolCallId,
        toolName: meta.toolName,
        args: meta.args,
      },
    });
    emittedToolCalls.add(toolCallId);
  };

  const emitToolResult = (
    entry: Record<string, unknown>,
    timestamp: number,
    toolCallId: string,
    result: unknown,
    error?: { code: string; message: string },
  ): void => {
    if (!toolCallId || emittedToolResults.has(toolCallId)) {
      return;
    }
    const turnId = ensureTurn(entry, timestamp);
    if (!turnId) {
      return;
    }
    const responseId = ensureResponseId();
    events.push({
      id: randomUUID(),
      timestamp,
      sessionId,
      turnId,
      responseId,
      type: 'tool_result',
      payload: {
        toolCallId,
        result,
        ...(error ? { error } : {}),
      },
    });
    emittedToolResults.add(toolCallId);
  };

  for (const entry of entries) {
    const entryType = getString(entry['type']);
    if (!entryType) {
      continue;
    }

    if (entryType === 'session_meta' || entryType === 'turn_context' || entryType === 'compacted') {
      continue;
    }

    if (entryType === 'event_msg') {
      if (!isRecord(entry['payload'])) {
        continue;
      }
      const payload = entry['payload'];
      const payloadType = getString(payload['type']);
      const timestamp = resolveTimestamp(entry, payload);

      if (payloadType === 'user_message') {
        if (!hasEventUserMessages) {
          continue;
        }
        flushThinking(timestamp);
        endTurn(timestamp);
        const turnId = getTurnId(entry);
        startTurn(turnId, 'user', timestamp);
        const messageText = extractTextValue(payload['message']);
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId,
          type: 'user_message',
          payload: { text: messageText },
        });
        continue;
      }

      if (payloadType === 'agent_message') {
        if (!hasEventAgentMessages) {
          continue;
        }
        const turnId = ensureTurn(entry, timestamp);
        if (!turnId) {
          continue;
        }
        flushThinking(timestamp);
        const responseId = ensureResponseId();
        const messageText = extractTextValue(payload['message']);
        events.push({
          id: randomUUID(),
          timestamp,
          sessionId,
          turnId,
          responseId,
          type: 'assistant_done',
          payload: { text: messageText },
        });
        continue;
      }

      if (payloadType === 'agent_reasoning') {
        if (!hasEventReasoning) {
          continue;
        }
        const turnId = ensureTurn(entry, timestamp);
        if (!turnId) {
          continue;
        }
        ensureResponseId();
        const reasoningText = extractTextValue(payload['text'] ?? payload['message']);
        appendThinking(reasoningText, timestamp);
        continue;
      }

      continue;
    }

    if (entryType === 'response_item') {
      if (!isRecord(entry['payload'])) {
        continue;
      }
      const payload = entry['payload'];
      const payloadType = getString(payload['type']);
      const timestamp = resolveTimestamp(entry, payload);

      if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
        flushThinking(timestamp);
        const toolCallId = getString(payload['call_id']) || randomUUID();
        const toolName = getString(payload['name']) || 'tool';
        const argsRaw = payload['arguments'] ?? payload['input'];
        let args = coerceArgs(argsRaw);
        if (!Object.keys(args).length && argsRaw) {
          args = { input: argsRaw };
        }
        emitToolCall(entry, timestamp, toolCallId, toolName, args);
        continue;
      }

      if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
        flushThinking(timestamp);
        const toolCallId = getString(payload['call_id']) || randomUUID();
        const output = parseCodexToolOutput(payload['output']);
        emitToolResult(entry, timestamp, toolCallId, output);
        continue;
      }

      if (payloadType === 'reasoning' && !hasEventReasoning) {
        const turnId = ensureTurn(entry, timestamp);
        if (!turnId) {
          continue;
        }
        ensureResponseId();
        const reasoningText = extractCodexReasoningSummary(payload);
        appendThinking(reasoningText, timestamp);
        continue;
      }

      if (payloadType === 'message') {
        const role = getString(payload['role']);
        if (role === 'user' && !hasEventUserMessages) {
          flushThinking(timestamp);
          endTurn(timestamp);
          const turnId = getTurnId(entry);
          startTurn(turnId, 'user', timestamp);
          const messageText = extractTextValue(payload['content']);
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            type: 'user_message',
            payload: { text: messageText },
          });
          continue;
        }

        if (role === 'assistant' && !hasEventAgentMessages) {
          const turnId = ensureTurn(entry, timestamp);
          if (!turnId) {
            continue;
          }
          flushThinking(timestamp);
          const responseId = ensureResponseId();
          const assistantText = extractTextValue(payload['content']);
          events.push({
            id: randomUUID(),
            timestamp,
            sessionId,
            turnId,
            responseId,
            type: 'assistant_done',
            payload: { text: assistantText },
          });
          continue;
        }
      }
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
    } catch (_err) {
      console.error('[history] Failed to parse session line', line);
    }
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  const raw = entry['label'] ?? entry['title'] ?? entry['name'] ?? entry['kind'] ?? entry['customType'];
  const label = getString(raw);
  return label || null;
}

function extractThinking(entry: Record<string, unknown>): string {
  const content = entry['content'];
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const block = item as Record<string, unknown>;
      const type = getString(block['type']);
      const normalized = type ? type.toLowerCase() : '';
      if (normalized !== 'thinking' && normalized !== 'analysis' && normalized !== 'reasoning') {
        continue;
      }
      const raw = block['thinking'] ?? block['text'] ?? block['content'];
      const text = extractTextValue(raw);
      if (text) {
        parts.push(text);
      }
    }
    if (parts.length > 0) {
      return parts.join('');
    }
  }
  const raw = entry['thinking'] ?? entry['thinkingContent'] ?? entry['reasoning'] ?? entry['analysis'];
  return extractTextValue(raw);
}

function extractCodexReasoningSummary(payload: Record<string, unknown>): string {
  const summary = payload['summary'];
  if (!Array.isArray(summary)) {
    return extractTextValue(payload['text'] ?? payload['content']);
  }
  const parts: string[] = [];
  for (const item of summary) {
    if (!item || typeof item !== 'object') {
      const text = extractTextValue(item);
      if (text) {
        parts.push(text);
      }
      continue;
    }
    const record = item as Record<string, unknown>;
    const text = extractTextValue(record['text'] ?? record['content']);
    if (text) {
      parts.push(text);
    }
  }
  return parts.join('\n\n');
}

type ToolCallEntry = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

function extractToolCalls(entry: Record<string, unknown>): ToolCallEntry[] {
  const calls: ToolCallEntry[] = [];
  const seen = new Set<string>();

  const pushCall = (toolCallId: string, toolName: string, args: Record<string, unknown>): void => {
    if (!toolCallId || !toolName || seen.has(toolCallId)) {
      return;
    }
    seen.add(toolCallId);
    calls.push({ toolCallId, toolName, args });
  };

  const content = entry['content'];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const block = item as Record<string, unknown>;
      const type = getString(block['type']);
      const normalized = type ? type.toLowerCase() : '';
      if (!['toolcall', 'tool_call', 'tool_use', 'tooluse'].includes(normalized)) {
        continue;
      }
      const toolCallId = getString(block['id']) || getString(block['toolCallId']) || randomUUID();
      const toolName =
        getString(block['name']) || getString(block['toolName']) || getString(block['tool']) || '';
      const args = coerceArgs(block['arguments'] ?? block['args'] ?? block['input']);
      pushCall(toolCallId, toolName, args);
    }
  }

  const raw = entry['toolCalls'] ?? entry['tool_calls'] ?? entry['tools'];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const call = item as Record<string, unknown>;
      const toolCallId = getString(call['id']) || getString(call['toolCallId']) || randomUUID();
      const functionEntry = call['function'];
      const functionRecord =
        functionEntry && typeof functionEntry === 'object' && !Array.isArray(functionEntry)
          ? (functionEntry as Record<string, unknown>)
          : null;
      const toolName =
        getString(call['name']) ||
        getString(call['toolName']) ||
        getString(call['tool']) ||
        getString(functionRecord?.['name']) ||
        '';
      if (!toolName) {
        continue;
      }
      const args = coerceArgs(
        call['args'] ?? call['arguments'] ?? call['input'] ?? functionRecord?.['arguments'],
      );
      pushCall(toolCallId, toolName, args);
    }
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

function parseCodexToolOutput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
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
