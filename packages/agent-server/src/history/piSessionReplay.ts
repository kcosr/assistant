import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage, ChatCompletionMessageMeta } from '../chatCompletionTypes';
import type { SessionSummary } from '../sessionIndex';
import { extractAssistantTextBlocksFromPiMessage } from '../llm/piSdkProvider';
import { getProviderAttributes } from './providerAttributes';
import { buildCompactionSummaryText } from './piCompaction';

type PiSessionInfo = {
  sessionId: string;
  cwd: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return isRecord(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function buildEntryPath(entries: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const sessionEntries = entries.filter((entry) => getString(entry['type']) !== 'session');
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of sessionEntries) {
    const id = getString(entry['id']);
    if (id) {
      byId.set(id, entry);
    }
  }
  const leaf = sessionEntries[sessionEntries.length - 1];
  if (!leaf) {
    return [];
  }
  const pathEntries: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let current: Record<string, unknown> | undefined = leaf;
  while (current) {
    const id = getString(current['id']);
    if (!id || seen.has(id)) {
      break;
    }
    seen.add(id);
    pathEntries.unshift(current);
    const parentId: unknown = current['parentId'];
    current = typeof parentId === 'string' ? byId.get(parentId) : undefined;
  }
  return pathEntries;
}

function buildEffectivePiReplayEntries(
  entries: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const pathEntries = buildEntryPath(entries);
  let compactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i -= 1) {
    if (getString(pathEntries[i]?.['type']) === 'compaction') {
      compactionIndex = i;
      break;
    }
  }
  if (compactionIndex === -1) {
    return pathEntries;
  }

  const compaction = pathEntries[compactionIndex]!;
  const firstKeptEntryId = getString(compaction['firstKeptEntryId']);
  const effective: Array<Record<string, unknown>> = [];
  const summary = getString(compaction['summary']);
  if (summary) {
    effective.push({
      type: 'message',
      id: `${getString(compaction['id']) || 'compaction'}:summary`,
      parentId: null,
      timestamp: compaction['timestamp'],
      message: {
        role: 'user',
        content: [{ type: 'text', text: buildCompactionSummaryText(summary) }],
        timestamp: resolveTimestamp(compaction) ?? Date.now(),
        meta: { source: 'user' },
      },
    });
  }

  let foundFirstKept = false;
  for (let i = 0; i < compactionIndex; i += 1) {
    const entry = pathEntries[i]!;
    if (getString(entry['id']) === firstKeptEntryId) {
      foundFirstKept = true;
    }
    if (foundFirstKept) {
      effective.push(entry);
    }
  }
  for (let i = compactionIndex + 1; i < pathEntries.length; i += 1) {
    effective.push(pathEntries[i]!);
  }
  return effective;
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

function extractTextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractTextValue(item)).join('');
  }
  if (!isRecord(value)) {
    return '';
  }

  const type = getString(value['type']).toLowerCase();
  if (type === 'text') {
    return getString(value['text']);
  }
  if (type === 'refusal') {
    return getString(value['refusal']);
  }
  if (type === 'thinking' || type === 'reasoning' || type === 'analysis') {
    return (
      getString(value['thinking']) || getString(value['text']) || extractTextValue(value['content'])
    );
  }
  if ('text' in value || 'content' in value || 'thinking' in value) {
    return (
      getString(value['text']) || getString(value['thinking']) || extractTextValue(value['content'])
    );
  }
  return '';
}

function extractMessageText(message: Record<string, unknown>): string {
  return extractTextValue(message['content']).trim();
}

function resolveTimestamp(
  entry: Record<string, unknown>,
  fallback?: Record<string, unknown>,
): number | undefined {
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
  return undefined;
}

function resolvePiSessionInfo(summary: SessionSummary): PiSessionInfo | null {
  const providerInfo = getProviderAttributes(summary.attributes, 'pi', ['pi-cli']);
  if (!providerInfo) {
    return null;
  }
  const sessionId = providerInfo['sessionId'];
  const cwd = providerInfo['cwd'];
  if (!isNonEmptyString(sessionId) || !isNonEmptyString(cwd)) {
    return null;
  }
  return { sessionId: sessionId.trim(), cwd: cwd.trim() };
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
      console.error('[pi-replay] Failed to read Pi session directory', {
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

function toUserMetaFromMessage(
  message: Record<string, unknown>,
): ChatCompletionMessageMeta | undefined {
  const meta = isRecord(message['meta']) ? message['meta'] : null;
  if (!meta) {
    return undefined;
  }
  const source = getString(meta['source']).trim();
  if (source !== 'agent' && source !== 'callback' && source !== 'user') {
    return undefined;
  }
  const resolved: ChatCompletionMessageMeta = {
    source,
    ...(isNonEmptyString(meta['fromAgentId']) ? { fromAgentId: meta['fromAgentId'].trim() } : {}),
    ...(isNonEmptyString(meta['fromSessionId'])
      ? { fromSessionId: meta['fromSessionId'].trim() }
      : {}),
  };
  if (source === 'callback') {
    const visibility = getString(meta['visibility']).trim();
    if (visibility === 'visible' || visibility === 'hidden') {
      resolved.visibility = visibility;
    }
  }
  return resolved;
}

export function buildCanonicalPiReplayMessages(content: string): ChatCompletionMessage[] {
  const entries = buildEffectivePiReplayEntries(parseJsonLines(content));
  const messages: ChatCompletionMessage[] = [];

  for (const entry of entries) {
    const entryType = getString(entry['type']);
    const message = entryType === 'message' && isRecord(entry['message']) ? entry['message'] : null;
    if (!message) {
      continue;
    }

    const role = getString(message['role']);
    if (role === 'user') {
      const text = extractMessageText(message);
      if (!text) {
        continue;
      }
      const meta = toUserMetaFromMessage(message);
      const historyTimestampMs = resolveTimestamp(message, entry);
      messages.push({
        role: 'user',
        content: text,
        ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
        ...(meta ? { meta } : {}),
      });
      continue;
    }

    if (role === 'assistant') {
      const piSdkMessage = message as unknown as PiSdkMessage;
      const blocks = extractAssistantTextBlocksFromPiMessage(piSdkMessage);
      const finalAnswerTexts = blocks
        .filter((block) => block.phase === 'final_answer')
        .map((block) => block.text)
        .filter((text) => text.trim().length > 0);
      const finalText =
        (finalAnswerTexts.length > 0 ? finalAnswerTexts.join('\n\n') : undefined) ??
        blocks[blocks.length - 1]?.text ??
        extractMessageText(message);
      const historyTimestampMs = resolveTimestamp(message, entry);
      messages.push({
        role: 'assistant',
        content: finalText,
        ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
        piSdkMessage,
      });
      continue;
    }

    if (role === 'toolResult' || role === 'tool_result') {
      const toolCallId = getString(message['toolCallId']);
      if (!toolCallId) {
        continue;
      }
      const text = extractMessageText(message);
      if (!text) {
        continue;
      }
      const historyTimestampMs = resolveTimestamp(message, entry);
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: text,
        ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
      });
    }
  }

  return messages;
}

export async function loadCanonicalPiReplayMessages(options: {
  summary: SessionSummary;
  baseDir?: string;
}): Promise<ChatCompletionMessage[] | null> {
  const sessionInfo = resolvePiSessionInfo(options.summary);
  if (!sessionInfo) {
    return null;
  }
  const baseDir = options.baseDir ?? path.join(os.homedir(), '.pi', 'agent', 'sessions');
  const sessionPath = await findPiSessionFile(baseDir, sessionInfo.cwd, sessionInfo.sessionId);
  if (!sessionPath) {
    return null;
  }
  let content: string;
  try {
    content = await fs.readFile(sessionPath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    console.error('[pi-replay] Failed to read Pi session file', {
      sessionId: sessionInfo.sessionId,
      path: sessionPath,
      error: error.message,
    });
    return null;
  }
  return buildCanonicalPiReplayMessages(content);
}
