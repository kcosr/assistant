import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ChatEvent, ProjectedTranscriptEvent, SessionAttributes } from '@assistant/shared';

import type { AgentDefinition } from '../agents';
import type { EventStore } from '../events';
import { getCodexSessionStore } from '../codexSessionStore';
import {
  isOverlayChatEvent,
  isOverlayChatEventType,
  isTransientReplayChatEvent,
} from '../events/overlayEventTypes';
import { parseAssistantTextSignature } from '../llm/piSdkProvider';
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

async function readCanonicalPiSessionContent(options: {
  attributes?: SessionAttributes;
  providerId?: string | null;
  baseDir?: string;
}): Promise<string | null> {
  const { attributes, providerId, baseDir } = options;
  if (providerId !== 'pi' && providerId !== 'pi-cli') {
    return null;
  }
  const sessionInfo = resolvePiSessionInfo(attributes);
  if (!sessionInfo) {
    return null;
  }
  const resolvedBaseDir = baseDir ?? path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const sessionPath = await findPiSessionFile(resolvedBaseDir, sessionInfo.cwd, sessionInfo.sessionId);
  if (!sessionPath) {
    return null;
  }

  try {
    return await fs.readFile(sessionPath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code !== 'ENOENT') {
      console.error('[history] Failed to read Pi session file', {
        sessionId: sessionInfo.sessionId,
        path: sessionPath,
        error: error.message,
      });
    }
    return null;
  }
}

export async function loadCanonicalPiTranscriptEvents(options: {
  sessionId: string;
  revision: number;
  attributes?: SessionAttributes;
  providerId?: string | null;
  baseDir?: string;
}): Promise<ProjectedTranscriptEvent[]> {
  const { sessionId, revision, attributes, providerId, baseDir } = options;
  const content = await readCanonicalPiSessionContent({
    ...(attributes ? { attributes } : {}),
    ...(providerId !== undefined ? { providerId } : {}),
    ...(baseDir ? { baseDir } : {}),
  });
  if (!content) {
    return [];
  }
  return buildProjectedTranscriptFromPiSession(content, sessionId, revision);
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

function sortEventsByTimestamp(events: ChatEvent[]): ChatEvent[] {
  return events
    .map((event, index) => ({
      event,
      order: index,
    }))
    .sort((a, b) => {
      const diff = a.event.timestamp - b.event.timestamp;
      if (diff !== 0) {
        return diff;
      }
      return a.order - b.order;
    })
    .map((item) => item.event);
}

function dedupeSortedPiReplayEvents(events: ChatEvent[]): ChatEvent[] {
  const emittedAssistantDone = new Set<string>();
  const emittedThinkingDone = new Set<string>();
  const deduped: ChatEvent[] = [];

  for (const event of events) {
    if (event.type === 'assistant_done' && event.turnId) {
      const key = `${event.turnId}|${event.payload.text}|${event.payload.phase ?? ''}|${event.payload.textSignature ?? ''}`;
      if (emittedAssistantDone.has(key)) {
        continue;
      }
      emittedAssistantDone.add(key);
    }

    if (event.type === 'thinking_done' && event.turnId) {
      const key = `${event.turnId}|${event.payload.text.trimEnd()}`;
      if (emittedThinkingDone.has(key)) {
        continue;
      }
      emittedThinkingDone.add(key);
    }

    deduped.push(event);
  }

  return deduped;
}

function shouldCloseOpenTurnAtEof(events: ChatEvent[], currentTurnId: string | null): boolean {
  if (!currentTurnId) {
    return false;
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || event.turnId !== currentTurnId) {
      continue;
    }
    return (
      event.type === 'assistant_done' ||
      event.type === 'summary_message' ||
      event.type === 'custom_message' ||
      event.type === 'agent_callback'
    );
  }
  return false;
}

function resolvePiMessageTimestamp(
  messageEntry: Record<string, unknown>,
  fallback?: Record<string, unknown>,
): number {
  const raw =
    messageEntry['timestamp'] ??
    messageEntry['createdAt'] ??
    messageEntry['time'] ??
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

async function mergeOverlayEvents(
  baseEvents: ChatEvent[],
  sessionId: string,
  eventStore?: EventStore,
): Promise<ChatEvent[]> {
  if (!eventStore) {
    return baseEvents;
  }
  const overlayEvents = (await eventStore.getEvents(sessionId)).filter(isOverlayChatEvent);
  const retainedOverlayEvents = filterRedundantOverlayEvents(baseEvents, overlayEvents);
  const alignedOverlayEvents = alignOverlayEvents(baseEvents, retainedOverlayEvents);
  historyDebug('merge overlay events', {
    sessionId,
    baseCount: baseEvents.length,
    overlayCount: overlayEvents.length,
    retainedCount: retainedOverlayEvents.length,
    alignedCount: alignedOverlayEvents.length,
  });
  return mergeEventsByTimestamp(baseEvents, alignedOverlayEvents);
}

function filterRedundantOverlayEvents(baseEvents: ChatEvent[], overlayEvents: ChatEvent[]): ChatEvent[] {
  if (overlayEvents.length === 0) {
    return overlayEvents;
  }

  const duplicateOverlayTurnIds = collectDuplicateCompletedOverlayTurnIds(baseEvents, overlayEvents);
  const completedTurnIds = new Set(
    baseEvents
      .filter((event) => event.type === 'turn_end' && typeof event.turnId === 'string')
      .map((event) => event.turnId as string),
  );
  const baseEventKeys = new Set(baseEvents.map(getOverlayComparableKey));

  return overlayEvents.filter((event) => {
    if (!isTransientReplayChatEvent(event)) {
      return true;
    }
    if (event.turnId && duplicateOverlayTurnIds.has(event.turnId)) {
      return false;
    }
    if (event.turnId && completedTurnIds.has(event.turnId)) {
      return false;
    }
    return !baseEventKeys.has(getOverlayComparableKey(event));
  });
}

function collectDuplicateCompletedOverlayTurnIds(
  baseEvents: ChatEvent[],
  overlayEvents: ChatEvent[],
): Set<string> {
  const duplicateTurnIds = new Set<string>();
  const baseCompletedTurnCounts = countCompletedTurnSignatures(baseEvents);
  if (baseCompletedTurnCounts.size === 0) {
    return duplicateTurnIds;
  }

  const overlayCompletedTurns = collectCompletedTurnSignatures(overlayEvents);
  const matchedCounts = new Map<string, number>();
  for (const [turnId, signature] of overlayCompletedTurns) {
    const available = baseCompletedTurnCounts.get(signature) ?? 0;
    const matched = matchedCounts.get(signature) ?? 0;
    if (available <= matched) {
      continue;
    }
    duplicateTurnIds.add(turnId);
    matchedCounts.set(signature, matched + 1);
  }
  return duplicateTurnIds;
}

function countCompletedTurnSignatures(events: ChatEvent[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const signature of collectCompletedTurnSignatures(events).values()) {
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  return counts;
}

function collectCompletedTurnSignatures(events: ChatEvent[]): Map<string, string> {
  const turns = new Map<string, ChatEvent[]>();
  const completedTurnIds = new Set<string>();
  for (const event of events) {
    const turnId = typeof event.turnId === 'string' ? event.turnId : '';
    if (!turnId || !isTransientReplayChatEvent(event)) {
      continue;
    }
    const turnEvents = turns.get(turnId) ?? [];
    turnEvents.push(event);
    turns.set(turnId, turnEvents);
    if (event.type === 'turn_end') {
      completedTurnIds.add(turnId);
    }
  }

  const signatures = new Map<string, string>();
  for (const turnId of completedTurnIds) {
    const turnEvents = turns.get(turnId) ?? [];
    signatures.set(turnId, getCompletedTurnSignature(turnEvents));
  }
  return signatures;
}

function getCompletedTurnSignature(events: ChatEvent[]): string {
  return events
    .map((event) =>
      stableSerialize({
        type: event.type,
        payload: normalizeTurnComparablePayload(event),
      }),
    )
    .join('|');
}

function normalizeTurnComparablePayload(event: ChatEvent): unknown {
  if (event.type === 'user_message') {
    return { text: event.payload.text.trimEnd() };
  }
  if (event.type === 'user_audio') {
    return {
      transcription: event.payload.transcription.trimEnd(),
      durationMs: event.payload.durationMs,
    };
  }
  if (event.type === 'assistant_done') {
    return {
      text: event.payload.text.trimEnd(),
      ...(event.payload.phase ? { phase: event.payload.phase } : {}),
      ...(event.payload.interrupted === true ? { interrupted: true } : {}),
      ...(event.payload.textSignature ? { textSignature: event.payload.textSignature } : {}),
    };
  }
  if (event.type === 'thinking_done') {
    return { text: event.payload.text.trimEnd() };
  }
  if (event.type === 'tool_call') {
    return {
      toolName: event.payload.toolName,
      args: event.payload.args,
    };
  }
  if (event.type === 'tool_result') {
    return {
      result: event.payload.result,
      error: event.payload.error,
    };
  }
  if (event.type === 'interrupt') {
    return { reason: event.payload.reason };
  }
  if (event.type === 'error') {
    return { message: event.payload.message, code: event.payload.code };
  }
  if (event.type === 'turn_start') {
    return { trigger: event.payload.trigger };
  }
  return event.payload;
}

function getTimestampedTextCoverageKey(timestamp: number, text: string): string {
  return `${timestamp}|${text.trimEnd()}`;
}

function normalizeCoverageText(text: string): string {
  return text.trimEnd();
}

function getOverlayComparableKey(event: ChatEvent): string {
  return [
    event.type,
    event.turnId ?? '',
    event.responseId ?? '',
    stableSerialize(event.payload),
  ].join('|');
}

function stableSerialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableSerialize(entryValue)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
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
      const timestamp = resolvePiMessageTimestamp(messageEntry, entry);

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
      const timestamp = resolvePiMessageTimestamp(messageEntry, entry);
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
  if (shouldCloseOpenTurnAtEof(events, currentTurnId)) {
    endTurn(finalTimestamp);
  }
  return events;
}

function buildProjectedTranscriptFromPiSession(
  content: string,
  sessionId: string,
  revision: number,
): ProjectedTranscriptEvent[] {
  type DirectProjectedEvent = ProjectedTranscriptEvent & {
    timestampMs: number;
    order: number;
  };

  const entries = parseJsonLines(content);
  const events: DirectProjectedEvent[] = [];
  const mirroredUserInputs = new Set<string>();
  const mirroredUserInputTexts = new Set<string>();
  const mirroredAssistantDone = new Set<string>();
  const mirroredAssistantTexts = new Set<string>();
  const mirroredThinkingDone = new Set<string>();
  const mirroredThinkingTexts = new Set<string>();

  function resolvePiUserMeta(
    messageEntry: Record<string, unknown>,
  ): {
    source: 'user' | 'agent' | 'callback';
    fromAgentId?: string;
    fromSessionId?: string;
    visibility?: 'visible' | 'hidden';
  } | null {
    const meta = isRecord(messageEntry['meta']) ? messageEntry['meta'] : null;
    if (!meta) {
      return null;
    }
    const source = (getString(meta['source']) ?? '').trim();
    if (source !== 'user' && source !== 'agent' && source !== 'callback') {
      return null;
    }
    const visibility = (getString(meta['visibility']) ?? '').trim();
    return {
      source,
      ...(isNonEmptyString(meta['fromAgentId'])
        ? { fromAgentId: (getString(meta['fromAgentId']) ?? '').trim() }
        : {}),
      ...(isNonEmptyString(meta['fromSessionId'])
        ? { fromSessionId: (getString(meta['fromSessionId']) ?? '').trim() }
        : {}),
      ...(visibility === 'visible' || visibility === 'hidden' ? { visibility } : {}),
    };
  }

  for (const entry of entries) {
    const messageEntry = resolveMessageEntry(entry);
    const role = getString(messageEntry['role']);
    if (role === 'user') {
      const meta = resolvePiUserMeta(messageEntry);
      if (meta?.source === 'callback') {
        continue;
      }
      const timestamp = resolvePiMessageTimestamp(messageEntry, entry);
      const text = extractText(messageEntry);
      if (!text) {
        continue;
      }
      mirroredUserInputs.add(getTimestampedTextCoverageKey(timestamp, text));
      mirroredUserInputTexts.add(normalizeCoverageText(text));
      continue;
    }

    if (role !== 'assistant') {
      continue;
    }

    const timestamp = resolveTimestamp(messageEntry, entry);
    const contentBlocks = messageEntry['content'];
    if (Array.isArray(contentBlocks)) {
      let thinkingBuffer = '';
      let textBuffer = '';
      let textPhase: 'commentary' | 'final_answer' | undefined;
      let textSignature: string | undefined;

      const flushThinking = (): void => {
        if (!thinkingBuffer) {
          return;
        }
        mirroredThinkingDone.add(getTimestampedTextCoverageKey(timestamp, thinkingBuffer));
        mirroredThinkingTexts.add(normalizeCoverageText(thinkingBuffer));
        thinkingBuffer = '';
      };

      const flushText = (): void => {
        if (!textBuffer) {
          return;
        }
        mirroredAssistantDone.add(getTimestampedTextCoverageKey(timestamp, textBuffer));
        mirroredAssistantTexts.add(normalizeCoverageText(textBuffer));
        textBuffer = '';
        textPhase = undefined;
        textSignature = undefined;
      };

      for (const item of contentBlocks) {
        if (!item || typeof item !== 'object') {
          const text = extractTextValue(item);
          if (text) {
            textBuffer += text;
          }
          continue;
        }
        if (!isRecord(item)) {
          continue;
        }
        const block: Record<string, unknown> = item;
        const blockType = typeof block['type'] === 'string' ? block['type'] : '';
        const type = blockType.toLowerCase();
        if (type === 'thinking' || type === 'analysis' || type === 'reasoning') {
          const text = extractTextValue(block['thinking'] ?? block['text'] ?? block['content']);
          if (text) {
            thinkingBuffer += text;
          }
          continue;
        }
        if (type === 'text') {
          const assistantText = extractAssistantTextBlock(block);
          if (assistantText.text) {
            if (
              textBuffer &&
              (textPhase !== assistantText.phase || textSignature !== assistantText.textSignature)
            ) {
              flushText();
            }
            textBuffer += assistantText.text;
            textPhase = assistantText.phase;
            textSignature = assistantText.textSignature;
          }
          continue;
        }
        flushThinking();
        flushText();
      }

      flushThinking();
      flushText();
      continue;
    }

    const thinkingText = extractTextValue(
      messageEntry['thinking'] ?? messageEntry['reasoning'] ?? messageEntry['analysis'],
    );
    if (thinkingText) {
      mirroredThinkingDone.add(getTimestampedTextCoverageKey(timestamp, thinkingText));
      mirroredThinkingTexts.add(normalizeCoverageText(thinkingText));
    }
    const assistantText = extractText(messageEntry);
    if (assistantText) {
      mirroredAssistantDone.add(getTimestampedTextCoverageKey(timestamp, assistantText));
      mirroredAssistantTexts.add(normalizeCoverageText(assistantText));
    }
  }

  const emittedRequestStarts = new Set<string>();
  const emittedUserInputs = new Set<string>();
  const emittedAssistantDone = new Set<string>();
  const emittedThinkingDone = new Set<string>();
  const emittedToolCalls = new Set<string>();
  const emittedToolResults = new Set<string>();
  const toolCallMeta = new Map<string, { toolName: string; args: Record<string, unknown> }>();
  let currentRequestId: string | null = null;
  let currentResponseId: string | null = null;
  let currentRequestExplicit = false;
  let currentRequestStartedAt: number | null = null;
  let nextSyntheticRequestId = 0;
  let nextDerivedId = 0;

  const normalizeTrigger = (value: unknown): 'user' | 'system' | 'callback' => {
    return value === 'callback' ? 'callback' : value === 'user' ? 'user' : 'system';
  };

  const pushProjected = (options: {
    timestamp: number;
    requestId: string;
    kind: ProjectedTranscriptEvent['kind'];
    chatEventType: ProjectedTranscriptEvent['chatEventType'];
    payload: Record<string, unknown>;
    eventId?: string | undefined;
    responseId?: string | undefined;
    messageId?: string | undefined;
    toolCallId?: string | undefined;
    interactionId?: string | undefined;
    exchangeId?: string | undefined;
  }): void => {
    const {
      timestamp,
      requestId,
      kind,
      chatEventType,
      payload,
      eventId,
      responseId,
      messageId,
      toolCallId,
      interactionId,
      exchangeId,
    } = options;
    events.push({
      sessionId,
      revision,
      sequence: 0,
      requestId,
      eventId: eventId?.trim() || `pi-projected-${nextDerivedId++}`,
      kind,
      chatEventType,
      timestamp: new Date(timestamp).toISOString(),
      ...(responseId ? { responseId } : {}),
      ...(messageId ? { messageId } : {}),
      ...(toolCallId ? { toolCallId } : {}),
      ...(interactionId ? { interactionId } : {}),
      ...(exchangeId ? { exchangeId } : {}),
      piTurnId: requestId,
      payload,
      timestampMs: timestamp,
      order: events.length,
    });
  };

  const endRequest = (timestamp: number): void => {
    if (!currentRequestId) {
      return;
    }
    pushProjected({
      timestamp,
      requestId: currentRequestId,
      kind: 'request_end',
      chatEventType: 'turn_end',
      payload: {},
    });
    currentRequestId = null;
    currentResponseId = null;
    currentRequestExplicit = false;
    currentRequestStartedAt = null;
  };

  const startRequest = (
    requestId: string,
    trigger: 'user' | 'system' | 'callback',
    timestamp: number,
    explicit = false,
    eventId?: string,
  ): void => {
    currentRequestId = requestId;
    currentResponseId = null;
    currentRequestExplicit = explicit;
    currentRequestStartedAt = timestamp;
    if (emittedRequestStarts.has(requestId)) {
      return;
    }
    pushProjected({
      timestamp,
      requestId,
      kind: 'request_start',
      chatEventType: 'turn_start',
      payload: { trigger },
      ...(eventId ? { eventId } : {}),
    });
    emittedRequestStarts.add(requestId);
  };

  const ensureRequest = (entry: Record<string, unknown>, timestamp: number): string => {
    if (!currentRequestId) {
      const requestId = getTurnId(entry) || `synthetic-request-${nextSyntheticRequestId++}`;
      startRequest(requestId, 'system', timestamp);
    }
    return currentRequestId!;
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

  const getUserInputKey = (requestId: string, text: string): string => `${requestId}|${text}`;
  const getAssistantDoneKey = (
    requestId: string,
    text: string,
    phase?: 'commentary' | 'final_answer',
    textSignature?: string,
  ): string => `${requestId}|${text}|${phase ?? ''}|${textSignature ?? ''}`;
  const getThinkingDoneKey = (requestId: string, text: string): string =>
    `${requestId}|${text.trimEnd()}`;
  const isOutOfOrderForExplicitRequest = (timestamp: number): boolean =>
    currentRequestExplicit && currentRequestStartedAt !== null && timestamp < currentRequestStartedAt;

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
    const requestId = ensureRequest(entry, timestamp);
    const responseId = ensureResponseId(entry);
    pushProjected({
      timestamp,
      requestId,
      kind: 'tool_call',
      chatEventType: 'tool_call',
      payload: {
        toolCallId,
        toolName: meta.toolName,
        args: meta.args,
      },
      responseId,
      toolCallId,
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
    const requestId = ensureRequest(entry, timestamp);
    const responseId = ensureResponseId(entry);
    pushProjected({
      timestamp,
      requestId,
      kind: 'tool_result',
      chatEventType: 'tool_result',
      payload: {
        toolCallId,
        result,
        ...(error ? { error } : {}),
      },
      responseId,
      toolCallId,
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
      const timestamp = resolveTimestamp(entry);
      const data = isRecord(entry['data']) ? (entry['data'] as Record<string, unknown>) : null;
      if (customType === 'assistant.request_start' && data) {
        const version = Number(data['v']);
        const requestIdFromEntry = getString(data['requestId']);
        if (version !== 1 || !requestIdFromEntry) {
          continue;
        }
        endRequest(timestamp);
        startRequest(
          requestIdFromEntry,
          normalizeTrigger(data['trigger']),
          timestamp,
          true,
          getString(entry['id']) || undefined,
        );
        continue;
      }
      if (customType === 'assistant.request_end' && data) {
        const version = Number(data['v']);
        const requestIdFromEntry = getString(data['requestId']);
        if (version !== 1 || !requestIdFromEntry) {
          continue;
        }
        if (currentRequestId !== requestIdFromEntry) {
          startRequest(requestIdFromEntry, normalizeTrigger(data['trigger']), timestamp, true);
        }
        endRequest(timestamp);
        continue;
      }
      const overlayEventType = getAssistantOverlayEventType(customType);
      if (!overlayEventType) {
        continue;
      }
      const payload = data && isRecord(data['payload']) ? (data['payload'] as Record<string, unknown>) : null;
      const requestIdFromEntry = data ? getString(data['turnId']) : '';
      const responseIdFromEntry = data ? getString(data['responseId']) : '';
      if (!payload) {
        continue;
      }
      const payloadRecord: Record<string, unknown> = payload;

      if (overlayEventType === 'agent_callback') {
        const messageId =
          getString(payloadRecord['messageId']) || getString(entry['id']) || randomUUID();
        const exchangeIdRaw = getString(payloadRecord['exchangeId']);
        const exchangeId = exchangeIdRaw ? exchangeIdRaw.trim() || undefined : undefined;
        const fromAgentId = getString(payloadRecord['fromAgentId']);
        const fromSessionId = getString(payloadRecord['fromSessionId']);
        const result = getString(payloadRecord['result']);
        if (!fromSessionId || !result) {
          continue;
        }
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'interaction_response',
          chatEventType: 'agent_callback',
          payload: {
            messageId,
            ...(exchangeId ? { exchangeId } : {}),
            fromAgentId: fromAgentId || 'unknown',
            fromSessionId,
            result,
          },
          responseId: responseIdFromEntry || undefined,
          messageId,
          ...(exchangeId ? { exchangeId } : {}),
        });
        continue;
      }

      if (overlayEventType === 'user_message' || overlayEventType === 'user_audio') {
        const text =
          typeof payload['text'] === 'string'
            ? payload['text']
            : typeof payload['transcription'] === 'string'
              ? payload['transcription']
              : '';
        if (!text) {
          continue;
        }
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        if (
          mirroredUserInputs.has(getTimestampedTextCoverageKey(timestamp, text)) ||
          (isOutOfOrderForExplicitRequest(timestamp) &&
            mirroredUserInputTexts.has(normalizeCoverageText(text)))
        ) {
          continue;
        }
        if (emittedUserInputs.has(getUserInputKey(requestId, text))) {
          continue;
        }
        pushProjected({
          timestamp,
          requestId,
          kind: 'user_message',
          chatEventType: overlayEventType,
          payload,
          responseId: responseIdFromEntry || undefined,
        });
        emittedUserInputs.add(getUserInputKey(requestId, text));
        continue;
      }

      if (overlayEventType === 'tool_call') {
        const toolCallId = typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : '';
        const toolName = typeof payload['toolName'] === 'string' ? payload['toolName'] : '';
        const args = isRecord(payload['args']) ? (payload['args'] as Record<string, unknown>) : {};
        if (toolCallId) {
          emittedToolCalls.add(toolCallId);
          resolveToolMeta(toolCallId, toolName, args);
        }
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'tool_call',
          chatEventType: 'tool_call',
          payload: {
            toolCallId,
            toolName,
            args,
          },
          responseId: responseIdFromEntry || undefined,
          ...(toolCallId ? { toolCallId } : {}),
        });
        continue;
      }

      if (overlayEventType === 'tool_result') {
        const toolCallId = typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : '';
        if (toolCallId) {
          emittedToolResults.add(toolCallId);
        }
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'tool_result',
          chatEventType: 'tool_result',
          payload,
          responseId: responseIdFromEntry || undefined,
          ...(toolCallId ? { toolCallId } : {}),
        });
        continue;
      }

      if (overlayEventType === 'assistant_chunk') {
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        if (!text) {
          continue;
        }
        const phase =
          payload['phase'] === 'commentary' || payload['phase'] === 'final_answer'
            ? payload['phase']
            : undefined;
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'assistant_message',
          chatEventType: 'assistant_chunk',
          payload: {
            text,
            ...(phase ? { phase } : {}),
            ...(payload['interrupted'] === true ? { interrupted: true } : {}),
          },
          responseId: responseIdFromEntry || undefined,
        });
        continue;
      }

      if (overlayEventType === 'assistant_done') {
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        if (!text.trim()) {
          continue;
        }
        const phase =
          payload['phase'] === 'commentary' || payload['phase'] === 'final_answer'
            ? payload['phase']
            : undefined;
        const textSignature =
          typeof payload['textSignature'] === 'string' ? payload['textSignature'] : undefined;
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        if (
          mirroredAssistantDone.has(getTimestampedTextCoverageKey(timestamp, text)) ||
          (isOutOfOrderForExplicitRequest(timestamp) &&
            mirroredAssistantTexts.has(normalizeCoverageText(text)))
        ) {
          continue;
        }
        const assistantDoneKey = getAssistantDoneKey(requestId, text, phase, textSignature);
        if (emittedAssistantDone.has(assistantDoneKey)) {
          continue;
        }
        pushProjected({
          timestamp,
          requestId,
          kind: 'assistant_message',
          chatEventType: 'assistant_done',
          payload: {
            text,
            ...(phase ? { phase } : {}),
            ...(textSignature ? { textSignature } : {}),
            ...(payload['interrupted'] === true ? { interrupted: true } : {}),
          },
          responseId: responseIdFromEntry || undefined,
        });
        emittedAssistantDone.add(assistantDoneKey);
        continue;
      }

      if (overlayEventType === 'thinking_chunk') {
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        if (!text) {
          continue;
        }
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'thinking',
          chatEventType: 'thinking_chunk',
          payload: { text },
          responseId: responseIdFromEntry || undefined,
        });
        continue;
      }

      if (overlayEventType === 'thinking_done') {
        const text = typeof payload['text'] === 'string' ? payload['text'] : '';
        if (!text) {
          continue;
        }
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        if (
          mirroredThinkingDone.has(getTimestampedTextCoverageKey(timestamp, text)) ||
          (isOutOfOrderForExplicitRequest(timestamp) &&
            mirroredThinkingTexts.has(normalizeCoverageText(text)))
        ) {
          continue;
        }
        const thinkingKey = getThinkingDoneKey(requestId, text);
        if (emittedThinkingDone.has(thinkingKey)) {
          continue;
        }
        pushProjected({
          timestamp,
          requestId,
          kind: 'thinking',
          chatEventType: 'thinking_done',
          payload: { text },
          responseId: responseIdFromEntry || undefined,
        });
        emittedThinkingDone.add(thinkingKey);
        continue;
      }

      if (overlayEventType === 'tool_input_chunk' || overlayEventType === 'tool_output_chunk') {
        const toolCallId = typeof payload['toolCallId'] === 'string' ? payload['toolCallId'] : '';
        const toolName = typeof payload['toolName'] === 'string' ? payload['toolName'] : '';
        const chunk = typeof payload['chunk'] === 'string' ? payload['chunk'] : '';
        const offset =
          typeof payload['offset'] === 'number' && Number.isFinite(payload['offset'])
            ? payload['offset']
            : 0;
        if (!toolCallId || !chunk) {
          continue;
        }
        resolveToolMeta(toolCallId, toolName, {});
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: overlayEventType === 'tool_input_chunk' ? 'tool_input' : 'tool_output',
          chatEventType: overlayEventType,
          payload: {
            toolCallId,
            toolName,
            chunk,
            offset,
            ...(typeof payload['stream'] === 'string' ? { stream: payload['stream'] } : {}),
          },
          responseId: responseIdFromEntry || undefined,
          toolCallId,
        });
        continue;
      }

      if (overlayEventType === 'interrupt') {
        const reason =
          payload && typeof payload['reason'] === 'string' ? (payload['reason'] as string) : '';
        if (!reason) {
          continue;
        }
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'interrupt',
          chatEventType: 'interrupt',
          payload: {
            reason:
              reason === 'user_cancel' || reason === 'timeout' || reason === 'error'
                ? reason
                : 'user_cancel',
          },
          responseId: responseIdFromEntry || undefined,
        });
        continue;
      }

      if (
        overlayEventType === 'interaction_request' ||
        overlayEventType === 'questionnaire_request'
      ) {
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'interaction_request',
          chatEventType: overlayEventType,
          payload,
          responseId: responseIdFromEntry || undefined,
          ...(typeof payload['toolCallId'] === 'string' ? { toolCallId: payload['toolCallId'] } : {}),
          ...(typeof payload['interactionId'] === 'string'
            ? { interactionId: payload['interactionId'] }
            : typeof payload['sourceInteractionId'] === 'string'
              ? { interactionId: payload['sourceInteractionId'] }
              : {}),
        });
        continue;
      }

      if (
        overlayEventType === 'interaction_pending' ||
        overlayEventType === 'questionnaire_reprompt' ||
        overlayEventType === 'questionnaire_update'
      ) {
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'interaction_update',
          chatEventType: overlayEventType,
          payload,
          responseId: responseIdFromEntry || undefined,
          ...(typeof payload['toolCallId'] === 'string' ? { toolCallId: payload['toolCallId'] } : {}),
          ...(typeof payload['interactionId'] === 'string' ? { interactionId: payload['interactionId'] } : {}),
        });
        continue;
      }

      if (
        overlayEventType === 'interaction_response' ||
        overlayEventType === 'questionnaire_submission'
      ) {
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'interaction_response',
          chatEventType: overlayEventType,
          payload,
          responseId: responseIdFromEntry || undefined,
          ...(typeof payload['toolCallId'] === 'string' ? { toolCallId: payload['toolCallId'] } : {}),
          ...(typeof payload['interactionId'] === 'string' ? { interactionId: payload['interactionId'] } : {}),
        });
        continue;
      }

      if (overlayEventType === 'error') {
        const requestId = requestIdFromEntry || ensureRequest(entry, timestamp);
        pushProjected({
          timestamp,
          requestId,
          kind: 'error',
          chatEventType: 'error',
          payload,
          responseId: responseIdFromEntry || undefined,
        });
      }
      continue;
    }

    if (entryType === 'compaction' || entryType === 'branch_summary') {
      const timestamp = resolveTimestamp(entry);
      endRequest(timestamp);
      const requestId = getTurnId(entry) || `synthetic-request-${nextSyntheticRequestId++}`;
      startRequest(requestId, 'system', timestamp);
      pushProjected({
        timestamp,
        requestId,
        kind: 'assistant_message',
        chatEventType: 'summary_message',
        payload: {
          text: extractText(entry),
          summaryType: entryType === 'compaction' ? 'compaction' : 'branch_summary',
        },
      });
      endRequest(timestamp);
      continue;
    }

    if (entryType === 'custom_message') {
      const timestamp = resolveTimestamp(entry);
      const requestId =
        currentRequestId ?? getTurnId(entry) ?? `synthetic-request-${nextSyntheticRequestId++}`;
      if (!currentRequestId) {
        endRequest(timestamp);
        startRequest(requestId, 'system', timestamp);
      }
      const label = extractLabel(entry);
      pushProjected({
        timestamp,
        requestId,
        kind: 'assistant_message',
        chatEventType: 'custom_message',
        payload: {
          text: extractText(entry),
          ...(label ? { label } : {}),
        },
      });
      if (!currentRequestId) {
        endRequest(timestamp);
      }
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
      const error = isError
        ? extractToolError(entry) ?? {
            code: 'tool_error',
            message: 'Tool call failed',
          }
        : undefined;
      const result = extractToolResult(entry);
      emitToolResult(entry, timestamp, toolCallId, result, error);
      continue;
    }

    const messageEntry = resolveMessageEntry(entry);
    const role = getString(messageEntry['role']);
    if (role === 'user') {
      if (currentRequestExplicit && !currentRequestId) {
        continue;
      }
      const timestamp = resolvePiMessageTimestamp(messageEntry, entry);
      const requestId = currentRequestId && currentRequestExplicit
        ? currentRequestId
        : getTurnId(messageEntry) || `synthetic-${getString(entry['id']) || nextSyntheticRequestId++}`;
      const text = extractText(messageEntry);
      const meta = resolvePiUserMeta(messageEntry);
      if (meta?.source !== 'callback' && emittedUserInputs.has(getUserInputKey(requestId, text))) {
        continue;
      }
      if (!currentRequestId || !currentRequestExplicit) {
        endRequest(timestamp);
        startRequest(requestId, meta?.source === 'callback' ? 'callback' : 'user', timestamp);
      }
      if (meta?.source === 'callback') {
        const messageId = getString(entry['id']) || randomUUID();
        pushProjected({
          timestamp,
          requestId,
          kind: 'interaction_request',
          chatEventType: 'agent_message',
          payload: {
            messageId,
            targetAgentId: 'callback',
            targetSessionId: sessionId,
            message: text,
            wait: false,
          },
          messageId,
        });
        continue;
      }
      emittedUserInputs.add(getUserInputKey(requestId, text));
      pushProjected({
        timestamp,
        requestId,
        kind: 'user_message',
        chatEventType: 'user_message',
        payload: {
          text,
          ...(meta?.fromAgentId ? { fromAgentId: meta.fromAgentId } : {}),
          ...(meta?.fromSessionId ? { fromSessionId: meta.fromSessionId } : {}),
        },
      });
      continue;
    }

    if (role === 'assistant') {
      if (currentRequestExplicit && !currentRequestId) {
        continue;
      }
      const timestamp = resolveTimestamp(messageEntry, entry);
      const stopReason = getString(messageEntry['stopReason']);
      if (stopReason === 'error') {
        continue;
      }
      const interrupted = stopReason === 'aborted';
      if (!currentRequestId) {
        const requestId = getTurnId(messageEntry) || `synthetic-request-${nextSyntheticRequestId++}`;
        startRequest(requestId, 'system', timestamp);
      }
      const requestId = currentRequestId!;
      const responseId: string = currentResponseId ?? getResponseId(messageEntry);
      currentResponseId = responseId;
      const contentBlocks = messageEntry['content'];
      if (Array.isArray(contentBlocks)) {
        let thinkingBuffer = '';
        let textBuffer = '';
        let textPhase: 'commentary' | 'final_answer' | undefined;
        let textSignature: string | undefined;

        const flushThinking = (): void => {
          if (!thinkingBuffer) {
            return;
          }
          const thinkingKey = getThinkingDoneKey(requestId, thinkingBuffer);
          if (emittedThinkingDone.has(thinkingKey)) {
            thinkingBuffer = '';
            return;
          }
          pushProjected({
            timestamp,
            requestId,
            kind: 'thinking',
            chatEventType: 'thinking_done',
            payload: { text: thinkingBuffer },
            responseId,
          });
          emittedThinkingDone.add(thinkingKey);
          thinkingBuffer = '';
        };

        const flushText = (): void => {
          if (!textBuffer) {
            return;
          }
          const assistantKey = getAssistantDoneKey(requestId, textBuffer, textPhase, textSignature);
          if (emittedAssistantDone.has(assistantKey)) {
            textBuffer = '';
            textPhase = undefined;
            textSignature = undefined;
            return;
          }
          pushProjected({
            timestamp,
            requestId,
            kind: 'assistant_message',
            chatEventType: 'assistant_done',
            payload: {
              text: textBuffer,
              ...(interrupted ? { interrupted: true } : {}),
              ...(textPhase ? { phase: textPhase } : {}),
              ...(textSignature ? { textSignature } : {}),
            },
            responseId,
          });
          emittedAssistantDone.add(assistantKey);
          textBuffer = '';
          textPhase = undefined;
          textSignature = undefined;
        };

        for (const item of contentBlocks) {
          if (!item || typeof item !== 'object') {
            const text = extractTextValue(item);
            if (text) {
              textBuffer += text;
            }
            continue;
          }
          if (!isRecord(item)) {
            continue;
          }
          const block: Record<string, unknown> = item;
          const blockType = typeof block['type'] === 'string' ? block['type'] : '';
          const type = blockType.toLowerCase();
          if (type === 'thinking' || type === 'analysis' || type === 'reasoning') {
            const text = extractTextValue(block['thinking'] ?? block['text'] ?? block['content']);
            if (text) {
              thinkingBuffer += text;
            }
            continue;
          }
          if (type === 'text') {
            const assistantText = extractAssistantTextBlock(block);
            if (assistantText.text) {
              if (
                textBuffer &&
                (textPhase !== assistantText.phase || textSignature !== assistantText.textSignature)
              ) {
                flushText();
              }
              textBuffer += assistantText.text;
              textPhase = assistantText.phase;
              textSignature = assistantText.textSignature;
            }
            continue;
          }
          if (['toolcall', 'tool_call', 'tool_use', 'tooluse'].includes(type)) {
            flushThinking();
            flushText();
            const toolCallId = getString(block['id']) || getString(block['toolCallId']) || randomUUID();
            const toolName =
              getString(block['name']) || getString(block['toolName']) || getString(block['tool']) || '';
            const args = coerceArgs(block['arguments'] ?? block['args'] ?? block['input']);
            emitToolCall(messageEntry, timestamp, toolCallId, toolName, args);
            continue;
          }
          const assistantText = extractAssistantTextBlock(block);
          if (assistantText.text) {
            if (
              textBuffer &&
              (textPhase !== assistantText.phase || textSignature !== assistantText.textSignature)
            ) {
              flushText();
            }
            textBuffer += assistantText.text;
            textPhase = assistantText.phase;
            textSignature = assistantText.textSignature;
          }
        }

        flushThinking();
        flushText();
      } else {
        const thinkingText = extractThinking(messageEntry);
        if (thinkingText) {
          const thinkingKey = getThinkingDoneKey(requestId, thinkingText);
          if (!emittedThinkingDone.has(thinkingKey)) {
            pushProjected({
              timestamp,
              requestId,
              kind: 'thinking',
              chatEventType: 'thinking_done',
              payload: { text: thinkingText },
              responseId,
            });
            emittedThinkingDone.add(thinkingKey);
          }
        }
        const toolCalls = extractToolCalls(messageEntry);
        for (const call of toolCalls) {
          emitToolCall(messageEntry, timestamp, call.toolCallId, call.toolName, call.args);
        }
        const assistantText = extractText(messageEntry);
        if (assistantText) {
          const assistantKey = getAssistantDoneKey(requestId, assistantText);
          if (!emittedAssistantDone.has(assistantKey)) {
            pushProjected({
              timestamp,
              requestId,
              kind: 'assistant_message',
              chatEventType: 'assistant_done',
              payload: {
                text: assistantText,
                ...(interrupted ? { interrupted: true } : {}),
              },
              responseId,
            });
            emittedAssistantDone.add(assistantKey);
          }
        }
      }
      continue;
    }

    if (role === 'toolResult' || role === 'tool_result' || entryType === 'tool_result') {
      if (currentRequestExplicit && !currentRequestId) {
        continue;
      }
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

  const shouldCloseAtEof = (): boolean => {
    if (!currentRequestId) {
      return false;
    }
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event || event.requestId !== currentRequestId) {
        continue;
      }
      return (
        event.chatEventType === 'assistant_done' ||
        event.chatEventType === 'summary_message' ||
        event.chatEventType === 'custom_message' ||
        event.chatEventType === 'agent_callback'
      );
    }
    return false;
  };

  if (shouldCloseAtEof()) {
    endRequest(Date.now());
  }

  const dedupedAssistant = new Set<string>();
  const dedupedThinking = new Set<string>();
  return events
    .slice()
    .sort((left, right) =>
      left.timestampMs === right.timestampMs ? left.order - right.order : left.timestampMs - right.timestampMs,
    )
    .filter((event) => {
      if (event.chatEventType === 'assistant_done') {
        const key = `${event.requestId}|${String(event.payload['text'] ?? '')}|${String(event.payload['phase'] ?? '')}|${String(event.payload['textSignature'] ?? '')}`;
        if (dedupedAssistant.has(key)) {
          return false;
        }
        dedupedAssistant.add(key);
      }
      if (event.chatEventType === 'thinking_done') {
        const key = `${event.requestId}|${String(event.payload['text'] ?? '').trimEnd()}`;
        if (dedupedThinking.has(key)) {
          return false;
        }
        dedupedThinking.add(key);
      }
      return true;
    })
    .map((event, index) => ({
      ...event,
      sequence: index,
    }))
    .map(({ timestampMs: _timestampMs, order: _order, ...event }) => event);
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
  if (shouldCloseOpenTurnAtEof(events, currentTurnId)) {
    endTurn(finalTimestamp);
  }
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

function extractAssistantTextBlock(block: Record<string, unknown>): {
  text: string;
  phase?: 'commentary' | 'final_answer';
  textSignature?: string;
} {
  const textSignature =
    typeof block['textSignature'] === 'string' && block['textSignature'].length > 0
      ? block['textSignature']
      : undefined;
  const parsedSignature = parseAssistantTextSignature(textSignature);
  return {
    text: extractTextValue(block['text'] ?? block['content']),
    ...(parsedSignature?.phase ? { phase: parsedSignature.phase } : {}),
    ...(textSignature ? { textSignature } : {}),
  };
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

function getAssistantOverlayEventType(customType: unknown): ChatEvent['type'] | null {
  const trimmed = getString(customType);
  if (!trimmed || !trimmed.startsWith('assistant.')) {
    return null;
  }
  const eventType = trimmed.slice('assistant.'.length);
  if (!eventType || eventType === 'request_start' || eventType === 'request_end') {
    return null;
  }
  if (
    eventType === 'assistant_chunk' ||
    eventType === 'assistant_done' ||
    eventType === 'thinking_chunk' ||
    eventType === 'thinking_done' ||
    eventType === 'tool_input_chunk' ||
    eventType === 'tool_output_chunk' ||
    isOverlayChatEventType(eventType)
  ) {
    return eventType as ChatEvent['type'];
  }
  return null;
}
