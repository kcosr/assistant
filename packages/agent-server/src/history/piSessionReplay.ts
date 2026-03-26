import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage, ChatCompletionMessageMeta } from '../chatCompletionTypes';
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

export function buildCanonicalPiReplayMessages(content: string): ChatCompletionMessage[] {
  const entries = parseJsonLines(content);
  const messages: ChatCompletionMessage[] = [];

  for (const entry of entries) {
    const entryType = getString(entry['type']);
    if (entryType === 'custom_message') {
      if (getString(entry['customType']) !== 'assistant.input') {
        continue;
      }
      const text = extractTextValue(entry['content']).trim();
      if (!text) {
        continue;
      }
      const meta = toUserMeta(entry);
      messages.push({
        role: 'user',
        content: text,
        ...(meta ? { meta } : {}),
      });
      continue;
    }

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
      messages.push({ role: 'user', content: text });
      continue;
    }

    if (role === 'assistant') {
      const piSdkMessage = message as unknown as PiSdkMessage;
      const blocks = extractAssistantTextBlocksFromPiMessage(piSdkMessage);
      const finalText =
        blocks.find((block) => block.phase === 'final_answer')?.text ??
        blocks[blocks.length - 1]?.text ??
        extractMessageText(message);
      messages.push({
        role: 'assistant',
        content: finalText,
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
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: text,
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
