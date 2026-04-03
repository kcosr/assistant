import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage, ChatCompletionMessageMeta } from '../chatCompletionTypes';
import { getAgentCallbackText } from '../chatEventText';
import type { SessionSummary } from '../sessionIndex';
import { extractAssistantTextBlocksFromPiMessage } from '../llm/piSdkProvider';
import { getProviderAttributes } from './providerAttributes';

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
    return getString(value['thinking']) || getString(value['text']) || extractTextValue(value['content']);
  }
  if ('text' in value || 'content' in value || 'thinking' in value) {
    return (
      getString(value['text']) ||
      getString(value['thinking']) ||
      extractTextValue(value['content'])
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

function toUserMeta(entry: Record<string, unknown>): ChatCompletionMessageMeta | undefined {
  const details = isRecord(entry['details']) ? entry['details'] : null;
  if (!details) {
    return undefined;
  }
  const kind = getString(details['kind']);
  if (kind !== 'agent' && kind !== 'callback') {
    return undefined;
  }
  const meta: ChatCompletionMessageMeta = {
    source: kind,
    ...(isNonEmptyString(details['fromAgentId']) ? { fromAgentId: details['fromAgentId'].trim() } : {}),
    ...(isNonEmptyString(details['fromSessionId'])
      ? { fromSessionId: details['fromSessionId'].trim() }
      : {}),
  };
  if (kind === 'callback') {
    meta.visibility = entry['display'] === false ? 'hidden' : 'visible';
  }
  return meta;
}

function toUserMetaFromMessage(message: Record<string, unknown>): ChatCompletionMessageMeta | undefined {
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

function extractInterruptedTurnIds(entries: Array<Record<string, unknown>>): Set<string> {
  const interruptedTurnIds = new Set<string>();
  for (const entry of entries) {
    if (getString(entry['type']) !== 'custom') {
      continue;
    }
    if (getString(entry['customType']) !== 'assistant.turn_end') {
      continue;
    }
    const data = isRecord(entry['data']) ? entry['data'] : null;
    if (!data) {
      continue;
    }
    const turnId = getString(data['turnId']).trim();
    const status = getString(data['status']).trim();
    if (turnId && status === 'interrupted') {
      interruptedTurnIds.add(turnId);
    }
  }
  return interruptedTurnIds;
}

type CanonicalReplayCoverage = {
  users: Array<{
    text: string;
    historyTimestampMs?: number;
  }>;
  callbackInputTexts: Set<string>;
  toolCallIds: Set<string>;
  toolResultIds: Set<string>;
};

function collectAssistantToolCallIds(message: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const content = message['content'];
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) {
        continue;
      }
      const type = getString(block['type']).trim().toLowerCase();
      if (type !== 'toolcall' && type !== 'tool_call') {
        continue;
      }
      const id = getString(block['id']).trim() || getString(block['toolCallId']).trim();
      if (id) {
        ids.push(id);
      }
    }
  }
  const toolCalls = message['tool_calls'];
  if (Array.isArray(toolCalls)) {
    for (const block of toolCalls) {
      if (!isRecord(block)) {
        continue;
      }
      const id = getString(block['id']).trim() || getString(block['toolCallId']).trim();
      if (id) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function collectCanonicalReplayCoverage(
  entries: Array<Record<string, unknown>>,
): CanonicalReplayCoverage {
  const users: CanonicalReplayCoverage['users'] = [];
  const callbackInputTexts = new Set<string>();
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();

  for (const entry of entries) {
    if (
      entry['type'] === 'custom_message' &&
      getString(entry['customType']) === 'assistant.input'
    ) {
      const text = extractTextValue(entry['content']).trim();
      const meta = toUserMeta(entry);
      if (text && meta?.source === 'callback') {
        callbackInputTexts.add(text);
      }
      continue;
    }

    const message = entry['type'] === 'message' && isRecord(entry['message']) ? entry['message'] : null;
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
      users.push({
        text,
        ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
      });
      if (meta?.source === 'callback') {
        callbackInputTexts.add(text);
      }
      continue;
    }

    if (role === 'assistant') {
      for (const id of collectAssistantToolCallIds(message)) {
        toolCallIds.add(id);
      }
      continue;
    }

    if (role === 'toolResult' || role === 'tool_result') {
      const toolCallId = getString(message['toolCallId']).trim();
      if (toolCallId) {
        toolResultIds.add(toolCallId);
      }
    }
  }

  return {
    users,
    callbackInputTexts,
    toolCallIds,
    toolResultIds,
  };
}

function hasMatchingCanonicalUserMessage(
  coverage: CanonicalReplayCoverage,
  text: string,
  historyTimestampMs?: number,
): boolean {
  if (!text) {
    return false;
  }
  if (historyTimestampMs === undefined) {
    return coverage.users.some((entry) => entry.text === text);
  }
  return coverage.users.some(
    (entry) =>
      entry.text === text &&
      entry.historyTimestampMs !== undefined &&
      Math.abs(entry.historyTimestampMs - historyTimestampMs) <= 1000,
  );
}

export function buildCanonicalPiReplayMessages(content: string): ChatCompletionMessage[] {
  const entries = parseJsonLines(content);
  const messages: ChatCompletionMessage[] = [];
  const interruptedTurnIds = extractInterruptedTurnIds(entries);
  const canonicalCoverage = collectCanonicalReplayCoverage(entries);
  let openAssistantToolCallResponseId: string | null = null;
  const pendingInterruptedToolCallsByTurn = new Map<string, Set<string>>();

  const closeOpenAssistantToolCalls = (): void => {
    openAssistantToolCallResponseId = null;
  };

  const markPendingInterruptedToolCall = (turnId: string, toolCallId: string): void => {
    const pending = pendingInterruptedToolCallsByTurn.get(turnId);
    if (pending) {
      pending.add(toolCallId);
      return;
    }
    pendingInterruptedToolCallsByTurn.set(turnId, new Set([toolCallId]));
  };

  const clearPendingInterruptedToolCall = (turnId: string, toolCallId: string): void => {
    const pending = pendingInterruptedToolCallsByTurn.get(turnId);
    if (!pending) {
      return;
    }
    pending.delete(toolCallId);
    if (pending.size === 0) {
      pendingInterruptedToolCallsByTurn.delete(turnId);
    }
  };

  const flushPendingInterruptedToolCalls = (
    turnId: string,
    historyTimestampMs?: number,
  ): void => {
    const pending = pendingInterruptedToolCallsByTurn.get(turnId);
    if (!pending || pending.size === 0) {
      return;
    }
    closeOpenAssistantToolCalls();
    for (const toolCallId of pending) {
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: JSON.stringify({
          ok: false,
          error: {
            code: 'tool_interrupted',
            message: 'Tool call was interrupted before a result was recorded.',
          },
        }),
        ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
      });
    }
    pendingInterruptedToolCallsByTurn.delete(turnId);
  };

  const appendInterruptedToolCall = (options: {
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
    responseId?: string;
    historyTimestampMs?: number;
  }): void => {
    const { toolCallId, toolName, args, responseId, historyTimestampMs } = options;
    const toolCall = {
      id: toolCallId,
      type: 'function' as const,
      function: {
        name: toolName,
        arguments: JSON.stringify(args),
      },
    };
    const lastMessage = messages[messages.length - 1];
    if (
      lastMessage?.role === 'assistant' &&
      Array.isArray(lastMessage.tool_calls) &&
      openAssistantToolCallResponseId === (responseId ?? null)
    ) {
      lastMessage.tool_calls.push(toolCall);
      return;
    }
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [toolCall],
      ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
    });
    openAssistantToolCallResponseId = responseId ?? null;
  };

  for (const entry of entries) {
    const entryType = getString(entry['type']);
    if (entryType === 'custom_message') {
      closeOpenAssistantToolCalls();
      if (getString(entry['customType']) !== 'assistant.input') {
        continue;
      }
      const text = extractTextValue(entry['content']).trim();
      if (!text) {
        continue;
      }
      const meta = toUserMeta(entry);
      const historyTimestampMs = resolveTimestamp(entry);
      messages.push({
        role: 'user',
        content: text,
        ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
        ...(meta ? { meta } : {}),
      });
      continue;
    }

    if (entryType === 'custom') {
      const customType = getString(entry['customType']);
      if (customType !== 'assistant.event') {
        continue;
      }
      const data = isRecord(entry['data']) ? entry['data'] : null;
      if (!data) {
        continue;
      }
      const turnId = getString(data['turnId']).trim();
      const chatEventType = getString(data['chatEventType']);
      const payload = isRecord(data['payload']) ? data['payload'] : null;
      const responseId = getString(data['responseId']).trim() || undefined;

      if (!payload) {
        continue;
      }

      if (chatEventType === 'agent_callback') {
        closeOpenAssistantToolCalls();
        const historyTimestampMs = resolveTimestamp(entry);
        const text =
          getAgentCallbackText({
            type: 'agent_callback',
            payload: {
              result: getString(payload['result']),
              ...(isNonEmptyString(payload['fromAgentId'])
                ? { fromAgentId: getString(payload['fromAgentId']).trim() }
                : {}),
            },
          } as Parameters<typeof getAgentCallbackText>[0]) ?? '';
        if (!text) {
          continue;
        }
        if (canonicalCoverage.callbackInputTexts.has(text)) {
          continue;
        }
        if (hasMatchingCanonicalUserMessage(canonicalCoverage, text, historyTimestampMs)) {
          continue;
        }
        messages.push({
          role: 'user',
          content: text,
          ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
          meta: {
            source: 'callback',
            ...(isNonEmptyString(payload['fromAgentId'])
              ? { fromAgentId: getString(payload['fromAgentId']).trim() }
              : {}),
            ...(isNonEmptyString(payload['fromSessionId'])
              ? { fromSessionId: getString(payload['fromSessionId']).trim() }
              : {}),
            visibility: 'visible',
          },
        });
        continue;
      }

      if (!turnId || !interruptedTurnIds.has(turnId)) {
        continue;
      }

      const historyTimestampMs = resolveTimestamp(entry);

      if (chatEventType === 'user_message' || chatEventType === 'user_audio') {
        closeOpenAssistantToolCalls();
        const text =
          getString(payload['text']).trim() || getString(payload['transcription']).trim();
        if (!text) {
          continue;
        }
        if (hasMatchingCanonicalUserMessage(canonicalCoverage, text, historyTimestampMs)) {
          continue;
        }
        messages.push({
          role: 'user',
          content: text,
          ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
        });
        continue;
      }

      if (chatEventType === 'tool_call') {
        const toolCallId = getString(payload['toolCallId']).trim();
        const toolName = getString(payload['toolName']).trim();
        const args = isRecord(payload['args']) ? payload['args'] : {};
        if (!toolCallId || !toolName) {
          continue;
        }
        if (canonicalCoverage.toolCallIds.has(toolCallId)) {
          continue;
        }
        appendInterruptedToolCall({
          toolCallId,
          toolName,
          args,
          ...(responseId ? { responseId } : {}),
          ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
        });
        markPendingInterruptedToolCall(turnId, toolCallId);
        continue;
      }

      if (chatEventType === 'tool_result') {
        closeOpenAssistantToolCalls();
        const toolCallId = getString(payload['toolCallId']).trim();
        if (!toolCallId) {
          continue;
        }
        clearPendingInterruptedToolCall(turnId, toolCallId);
        if (canonicalCoverage.toolResultIds.has(toolCallId)) {
          continue;
        }
        const error = isRecord(payload['error']) ? payload['error'] : undefined;
        const result = payload['result'];
        messages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: JSON.stringify({
            ok: !error,
            result,
            error,
          }),
          ...(historyTimestampMs !== undefined ? { historyTimestampMs } : {}),
        });
        continue;
      }

      if (chatEventType === 'interrupt') {
        flushPendingInterruptedToolCalls(turnId, historyTimestampMs);
      }

      continue;
    }

    const message = entryType === 'message' && isRecord(entry['message']) ? entry['message'] : null;
    if (!message) {
      continue;
    }

    const role = getString(message['role']);
    if (role === 'user') {
      closeOpenAssistantToolCalls();
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
      closeOpenAssistantToolCalls();
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
      closeOpenAssistantToolCalls();
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

  for (const [turnId] of pendingInterruptedToolCallsByTurn) {
    flushPendingInterruptedToolCalls(turnId);
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
