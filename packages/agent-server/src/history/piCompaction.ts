import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, Model, Usage } from '@earendil-works/pi-ai';

import { calculateContextTokens } from '../contextUsage';

/*
 * Adapted from @earendil-works/pi-coding-agent 0.62.0 compaction helpers
 * (packages/coding-agent/src/core/compaction). Kept local so assistant does
 * not depend on package internals.
 */

export const COMPACTION_SUMMARY_PREFIX =
  'The conversation history before this point was compacted into the following summary:\n\n<summary>\n';
export const COMPACTION_SUMMARY_SUFFIX = '\n</summary>';

export type PiCompactionSettings = {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
};

export type PiCompactionDetails = {
  readFiles: string[];
  modifiedFiles: string[];
};

export type PiCompactionResult = {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: PiCompactionDetails;
};

export type PiCompactionEntryLike = {
  type: 'compaction';
  id: string;
  parentId: string | null;
  timestamp: string;
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  fromHook?: boolean;
};

export type PiSessionEntryRecordLike = Record<string, unknown> & {
  type: string;
  id: string;
  parentId: string | null;
};

export type PiCustomAgentMessage = {
  role: 'custom';
  customType: string;
  content: string | unknown[];
  display: boolean;
  details?: unknown;
  timestamp: number;
};

export type PiCompactionSummaryMessage = {
  role: 'compactionSummary';
  summary: string;
  tokensBefore: number;
  timestamp: number;
};

export type PiCompactionAgentMessage =
  | AgentMessage
  | PiCustomAgentMessage
  | PiCompactionSummaryMessage;

export type PiSessionPathEntry =
  | {
      type: 'message';
      id: string;
      parentId: string | null;
      timestamp: string;
      message: AgentMessage;
    }
  | {
      type: 'custom_message';
      id: string;
      parentId: string | null;
      timestamp: string;
      customType: string;
      content: string | unknown[];
      details?: unknown;
      display: boolean;
    }
  | PiCompactionEntryLike
  | {
      type: Exclude<string, 'message' | 'custom_message' | 'compaction'>;
      id: string;
      parentId: string | null;
      timestamp?: string;
      [key: string]: unknown;
    };

export type PiCompactionPreparation = {
  firstKeptEntryId: string;
  messagesToSummarize: PiCompactionAgentMessage[];
  turnPrefixMessages: PiCompactionAgentMessage[];
  isSplitTurn: boolean;
  tokensBefore: number;
  previousSummary?: string;
  fileOps: FileOperations;
  settings: PiCompactionSettings;
};

type FileOperations = {
  read: Set<string>;
  written: Set<string>;
  edited: Set<string>;
};

export const DEFAULT_PI_COMPACTION_SETTINGS: PiCompactionSettings = {
  enabled: true,
  reserveTokens: 16384,
  keepRecentTokens: 20000,
};

const SUMMARIZATION_SYSTEM_PROMPT =
  'You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.\n\nDo NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.';

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- If something is no longer relevant, you may remove it

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

Keep each section concise. Preserve exact file paths, function names, and error messages.`;

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

Be concise. Focus on what's needed to understand the kept suffix.`;

const TOOL_RESULT_MAX_CHARS = 2000;

type PiAiModule = typeof import('@earendil-works/pi-ai');
let piAiModulePromise: Promise<PiAiModule> | null = null;

async function loadPiAiModule(): Promise<PiAiModule> {
  if (!piAiModulePromise) {
    piAiModulePromise = import('@earendil-works/pi-ai');
  }
  return piAiModulePromise;
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createFileOps(): FileOperations {
  return {
    read: new Set<string>(),
    written: new Set<string>(),
    edited: new Set<string>(),
  };
}

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n\n[... ${text.length - maxChars} more characters truncated]`;
}

function extractTextBlocks(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (block) => isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string',
    )
    .map((block) => (block as { text: string }).text)
    .join('');
}

function extractFileOpsFromMessage(
  message: PiCompactionAgentMessage,
  fileOps: FileOperations,
): void {
  if (message.role !== 'assistant' || !Array.isArray(message.content)) {
    return;
  }
  for (const block of message.content) {
    if (!isRecord(block) || block['type'] !== 'toolCall') {
      continue;
    }
    const args = isRecord(block['arguments']) ? block['arguments'] : null;
    const filePath = typeof args?.['path'] === 'string' ? args['path'] : undefined;
    const name = typeof block['name'] === 'string' ? block['name'] : '';
    if (!filePath) {
      continue;
    }
    if (name === 'read') {
      fileOps.read.add(filePath);
    } else if (name === 'write') {
      fileOps.written.add(filePath);
    } else if (name === 'edit') {
      fileOps.edited.add(filePath);
    }
  }
}

function computeFileLists(fileOps: FileOperations): PiCompactionDetails {
  const modified = new Set([...fileOps.edited, ...fileOps.written]);
  return {
    readFiles: [...fileOps.read].filter((filePath) => !modified.has(filePath)).sort(),
    modifiedFiles: [...modified].sort(),
  };
}

function formatFileOperations(details: PiCompactionDetails): string {
  const sections: string[] = [];
  if (details.readFiles.length > 0) {
    sections.push(`<read-files>\n${details.readFiles.join('\n')}\n</read-files>`);
  }
  if (details.modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${details.modifiedFiles.join('\n')}\n</modified-files>`);
  }
  return sections.length > 0 ? `\n\n${sections.join('\n\n')}` : '';
}

function createCustomMessage(
  entry: Extract<PiSessionPathEntry, { type: 'custom_message' }>,
): PiCustomAgentMessage {
  return {
    role: 'custom',
    customType: entry.customType,
    content: entry.content,
    display: entry.display,
    details: entry.details,
    timestamp: new Date(entry.timestamp).getTime(),
  };
}

function createCompactionSummaryMessage(entry: PiCompactionEntryLike): PiCompactionSummaryMessage {
  return {
    role: 'compactionSummary',
    summary: entry.summary,
    tokensBefore: entry.tokensBefore,
    timestamp: new Date(entry.timestamp).getTime(),
  };
}

export function buildPiSessionEntryPath<T extends PiSessionEntryRecordLike>(entries: T[]): T[] {
  const byId = new Map<string, T>();
  for (const entry of entries) {
    byId.set(entry.id, entry);
  }
  const leaf = entries[entries.length - 1];
  if (!leaf) {
    return [];
  }
  const pathEntries: T[] = [];
  const seen = new Set<string>();
  let current: T | undefined = leaf;
  while (current) {
    if (seen.has(current.id)) {
      break;
    }
    seen.add(current.id);
    pathEntries.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return pathEntries;
}

export function buildEffectivePiSessionEntryPath<T extends PiSessionEntryRecordLike>(
  entries: T[],
  options: {
    createCompactionSummaryEntry?: (compaction: T) => T | undefined;
    includeRawCompactionEntry?: boolean;
  } = {},
): T[] {
  const pathEntries = buildPiSessionEntryPath(entries);
  let compactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i -= 1) {
    if (pathEntries[i]?.type === 'compaction') {
      compactionIndex = i;
      break;
    }
  }
  if (compactionIndex === -1) {
    return pathEntries;
  }

  const compaction = pathEntries[compactionIndex]!;
  const summaryEntry = options.createCompactionSummaryEntry?.(compaction);
  const effective: T[] =
    summaryEntry || options.includeRawCompactionEntry !== false ? [summaryEntry ?? compaction] : [];
  const firstKeptEntryId = getString(compaction['firstKeptEntryId']);
  let foundFirstKept = false;
  for (let i = 0; i < compactionIndex; i += 1) {
    const entry = pathEntries[i]!;
    if (entry.id === firstKeptEntryId) {
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

function getMessageFromEntry(entry: PiSessionPathEntry): PiCompactionAgentMessage | undefined {
  if (entry.type === 'message') {
    return (entry as Extract<PiSessionPathEntry, { type: 'message' }>).message;
  }
  if (entry.type === 'custom_message') {
    return createCustomMessage(entry as Extract<PiSessionPathEntry, { type: 'custom_message' }>);
  }
  if (entry.type === 'compaction') {
    return createCompactionSummaryMessage(entry as PiCompactionEntryLike);
  }
  return undefined;
}

function estimateUsageTokensFromMessage(message: PiCompactionAgentMessage): Usage | undefined {
  if (message.role !== 'assistant') {
    return undefined;
  }
  const assistant = message as AgentMessage & {
    stopReason?: string;
    usage?: Usage;
  };
  if (assistant.stopReason === 'aborted' || assistant.stopReason === 'error') {
    return undefined;
  }
  return assistant.usage;
}

export function estimatePiMessageTokens(message: PiCompactionAgentMessage): number {
  let chars = 0;
  if (message.role === 'user') {
    chars = extractTextBlocks((message as { content?: unknown }).content).length;
  } else if (message.role === 'assistant') {
    for (const block of (message as { content?: unknown[] }).content ?? []) {
      if (!isRecord(block)) {
        continue;
      }
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        chars += block['text'].length;
      } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
        chars += block['thinking'].length;
      } else if (block['type'] === 'toolCall') {
        chars +=
          String(block['name'] ?? '').length + JSON.stringify(block['arguments'] ?? {}).length;
      }
    }
  } else if (message.role === 'toolResult') {
    chars = extractTextBlocks((message as { content?: unknown }).content).length;
  } else if (message.role === 'compactionSummary') {
    chars = message.summary.length;
  } else if (message.role === 'custom') {
    chars = extractTextBlocks(message.content).length;
  }
  return Math.ceil(chars / 4);
}

export function estimatePiContextTokens(messages: PiCompactionAgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const usage = estimateUsageTokensFromMessage(messages[i]!);
    if (usage) {
      let trailingTokens = 0;
      for (let j = i + 1; j < messages.length; j += 1) {
        trailingTokens += estimatePiMessageTokens(messages[j]!);
      }
      return calculateContextTokens(usage) + trailingTokens;
    }
  }
  return messages.reduce((total, message) => total + estimatePiMessageTokens(message), 0);
}

function findValidCutPoints(
  entries: PiSessionPathEntry[],
  startIndex: number,
  endIndex: number,
): number[] {
  const cutPoints: number[] = [];
  for (let i = startIndex; i < endIndex; i += 1) {
    const entry = entries[i]!;
    if (entry.type === 'message') {
      const role = (entry.message as { role?: string }).role;
      if (role === 'user' || role === 'assistant') {
        cutPoints.push(i);
      }
    } else if (entry.type === 'custom_message') {
      cutPoints.push(i);
    }
  }
  return cutPoints;
}

function findTurnStartIndex(
  entries: PiSessionPathEntry[],
  entryIndex: number,
  startIndex: number,
): number {
  for (let i = entryIndex; i >= startIndex; i -= 1) {
    const entry = entries[i]!;
    if (entry.type === 'custom_message') {
      return i;
    }
    if (entry.type === 'message' && (entry.message as { role?: string }).role === 'user') {
      return i;
    }
  }
  return -1;
}

function findCutPoint(
  entries: PiSessionPathEntry[],
  startIndex: number,
  endIndex: number,
  keepRecentTokens: number,
): { firstKeptEntryIndex: number; turnStartIndex: number; isSplitTurn: boolean } {
  const cutPoints = findValidCutPoints(entries, startIndex, endIndex);
  if (cutPoints.length === 0) {
    return { firstKeptEntryIndex: startIndex, turnStartIndex: -1, isSplitTurn: false };
  }

  let accumulatedTokens = 0;
  let cutIndex = cutPoints[0]!;
  for (let i = endIndex - 1; i >= startIndex; i -= 1) {
    const message = getMessageFromEntry(entries[i]!);
    if (!message) {
      continue;
    }
    accumulatedTokens += estimatePiMessageTokens(message);
    if (accumulatedTokens >= keepRecentTokens) {
      cutIndex = cutPoints.find((candidate) => candidate >= i) ?? cutIndex;
      break;
    }
  }

  while (cutIndex > startIndex) {
    const previous = entries[cutIndex - 1]!;
    if (previous.type === 'compaction' || previous.type === 'message') {
      break;
    }
    cutIndex -= 1;
  }

  const cutEntry = entries[cutIndex]!;
  const isUserMessage =
    cutEntry.type === 'message' && (cutEntry.message as { role?: string }).role === 'user';
  const turnStartIndex = isUserMessage ? -1 : findTurnStartIndex(entries, cutIndex, startIndex);
  return {
    firstKeptEntryIndex: cutIndex,
    turnStartIndex,
    isSplitTurn: !isUserMessage && turnStartIndex !== -1,
  };
}

function extractFileOperations(
  messages: PiCompactionAgentMessage[],
  entries: PiSessionPathEntry[],
  prevCompactionIndex: number,
): FileOperations {
  const fileOps = createFileOps();
  if (prevCompactionIndex >= 0) {
    const previous = entries[prevCompactionIndex]!;
    if (previous.type === 'compaction' && !previous.fromHook && isRecord(previous.details)) {
      const readFiles = previous.details['readFiles'];
      const modifiedFiles = previous.details['modifiedFiles'];
      if (Array.isArray(readFiles)) {
        for (const filePath of readFiles) {
          if (typeof filePath === 'string') {
            fileOps.read.add(filePath);
          }
        }
      }
      if (Array.isArray(modifiedFiles)) {
        for (const filePath of modifiedFiles) {
          if (typeof filePath === 'string') {
            fileOps.edited.add(filePath);
          }
        }
      }
    }
  }
  for (const message of messages) {
    extractFileOpsFromMessage(message, fileOps);
  }
  return fileOps;
}

export function shouldCompactPiContext(options: {
  contextTokens: number;
  contextWindow: number;
  settings: PiCompactionSettings;
}): boolean {
  const { contextTokens, contextWindow, settings } = options;
  if (!settings.enabled || !Number.isFinite(contextWindow) || contextWindow <= 0) {
    return false;
  }
  return contextTokens > contextWindow - settings.reserveTokens;
}

export function preparePiCompaction(
  pathEntries: PiSessionPathEntry[],
  settings: PiCompactionSettings,
): PiCompactionPreparation | undefined {
  if (pathEntries.length === 0 || pathEntries[pathEntries.length - 1]?.type === 'compaction') {
    return undefined;
  }

  let prevCompactionIndex = -1;
  for (let i = pathEntries.length - 1; i >= 0; i -= 1) {
    if (pathEntries[i]?.type === 'compaction') {
      prevCompactionIndex = i;
      break;
    }
  }

  const boundaryStart = prevCompactionIndex + 1;
  const boundaryEnd = pathEntries.length;
  const usageMessages: PiCompactionAgentMessage[] = [];
  for (let i = prevCompactionIndex >= 0 ? prevCompactionIndex : 0; i < boundaryEnd; i += 1) {
    const message = getMessageFromEntry(pathEntries[i]!);
    if (message) {
      usageMessages.push(message);
    }
  }
  const tokensBefore = estimatePiContextTokens(usageMessages);
  const cutPoint = findCutPoint(pathEntries, boundaryStart, boundaryEnd, settings.keepRecentTokens);
  const firstKeptEntry = pathEntries[cutPoint.firstKeptEntryIndex];
  if (!firstKeptEntry?.id) {
    return undefined;
  }

  const historyEnd = cutPoint.isSplitTurn ? cutPoint.turnStartIndex : cutPoint.firstKeptEntryIndex;
  const messagesToSummarize: PiCompactionAgentMessage[] = [];
  for (let i = boundaryStart; i < historyEnd; i += 1) {
    const message = getMessageFromEntry(pathEntries[i]!);
    if (message) {
      messagesToSummarize.push(message);
    }
  }

  const turnPrefixMessages: PiCompactionAgentMessage[] = [];
  if (cutPoint.isSplitTurn) {
    for (let i = cutPoint.turnStartIndex; i < cutPoint.firstKeptEntryIndex; i += 1) {
      const message = getMessageFromEntry(pathEntries[i]!);
      if (message) {
        turnPrefixMessages.push(message);
      }
    }
  }

  const previousSummary =
    prevCompactionIndex >= 0 && pathEntries[prevCompactionIndex]?.type === 'compaction'
      ? (pathEntries[prevCompactionIndex] as PiCompactionEntryLike).summary
      : undefined;
  const fileOps = extractFileOperations(messagesToSummarize, pathEntries, prevCompactionIndex);
  for (const message of turnPrefixMessages) {
    extractFileOpsFromMessage(message, fileOps);
  }

  return {
    firstKeptEntryId: firstKeptEntry.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cutPoint.isSplitTurn,
    tokensBefore,
    ...(previousSummary ? { previousSummary } : {}),
    fileOps,
    settings,
  };
}

function serializeConversation(messages: PiCompactionAgentMessage[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      const content = extractTextBlocks((message as { content?: unknown }).content);
      if (content) {
        parts.push(`[User]: ${content}`);
      }
    } else if (message.role === 'assistant') {
      const textParts: string[] = [];
      const thinkingParts: string[] = [];
      const toolCalls: string[] = [];
      for (const block of (message as { content?: unknown[] }).content ?? []) {
        if (!isRecord(block)) {
          continue;
        }
        if (block['type'] === 'text' && typeof block['text'] === 'string') {
          textParts.push(block['text']);
        } else if (block['type'] === 'thinking' && typeof block['thinking'] === 'string') {
          thinkingParts.push(block['thinking']);
        } else if (block['type'] === 'toolCall') {
          const args = isRecord(block['arguments']) ? block['arguments'] : {};
          const argsText = Object.entries(args)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(', ');
          toolCalls.push(`${String(block['name'] ?? 'tool')}(${argsText})`);
        }
      }
      if (thinkingParts.length > 0) {
        parts.push(`[Assistant thinking]: ${thinkingParts.join('\n')}`);
      }
      if (textParts.length > 0) {
        parts.push(`[Assistant]: ${textParts.join('\n')}`);
      }
      if (toolCalls.length > 0) {
        parts.push(`[Assistant tool calls]: ${toolCalls.join('; ')}`);
      }
    } else if (message.role === 'toolResult') {
      const content = extractTextBlocks((message as { content?: unknown }).content);
      if (content) {
        parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
      }
    } else if (message.role === 'custom') {
      const content = extractTextBlocks(message.content);
      if (content) {
        parts.push(`[User]: ${content}`);
      }
    } else if (message.role === 'compactionSummary') {
      const summary = message.summary.trim();
      if (summary) {
        parts.push(`[Compaction summary]: ${summary}`);
      }
    }
  }
  return parts.join('\n\n');
}

async function generateSummary(options: {
  messages: PiCompactionAgentMessage[];
  model: Model<Api>;
  reserveTokens: number;
  apiKey?: string;
  signal?: AbortSignal;
  customInstructions?: string;
  previousSummary?: string;
  prompt?: string;
}): Promise<string> {
  const {
    messages,
    model,
    reserveTokens,
    apiKey,
    signal,
    customInstructions,
    previousSummary,
    prompt,
  } = options;
  const maxTokens = Math.floor(0.8 * reserveTokens);
  let basePrompt = prompt ?? (previousSummary ? UPDATE_SUMMARIZATION_PROMPT : SUMMARIZATION_PROMPT);
  if (customInstructions) {
    basePrompt = `${basePrompt}\n\nAdditional focus: ${customInstructions}`;
  }
  let promptText = `<conversation>\n${serializeConversation(messages)}\n</conversation>\n\n`;
  if (previousSummary) {
    promptText += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  promptText += basePrompt;
  const { completeSimple } = await loadPiAiModule();
  const response = await completeSimple(
    model,
    {
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: promptText }],
          timestamp: Date.now(),
        },
      ],
    },
    {
      maxTokens,
      ...(signal ? { signal } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(model.reasoning ? { reasoning: 'high' as const } : {}),
    },
  );
  if (response.stopReason === 'error') {
    throw new Error(`Summarization failed: ${response.errorMessage || 'Unknown error'}`);
  }
  return response.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n');
}

export async function compactPiMessages(options: {
  preparation: PiCompactionPreparation;
  model: Model<Api>;
  apiKey?: string;
  customInstructions?: string;
  signal?: AbortSignal;
}): Promise<PiCompactionResult> {
  const { preparation, model, apiKey, customInstructions, signal } = options;
  let summary: string;
  if (preparation.isSplitTurn && preparation.turnPrefixMessages.length > 0) {
    const [historyResult, turnPrefixResult] = await Promise.all([
      preparation.messagesToSummarize.length > 0
        ? generateSummary({
            messages: preparation.messagesToSummarize,
            model,
            reserveTokens: preparation.settings.reserveTokens,
            ...(apiKey ? { apiKey } : {}),
            ...(signal ? { signal } : {}),
            ...(customInstructions ? { customInstructions } : {}),
            ...(preparation.previousSummary
              ? { previousSummary: preparation.previousSummary }
              : {}),
          })
        : Promise.resolve('No prior history.'),
      generateSummary({
        messages: preparation.turnPrefixMessages,
        model,
        reserveTokens: Math.floor(preparation.settings.reserveTokens * 0.5),
        ...(apiKey ? { apiKey } : {}),
        ...(signal ? { signal } : {}),
        prompt: TURN_PREFIX_SUMMARIZATION_PROMPT,
      }),
    ]);
    summary = `${historyResult}\n\n---\n\n**Turn Context (split turn):**\n\n${turnPrefixResult}`;
  } else {
    summary = await generateSummary({
      messages: preparation.messagesToSummarize,
      model,
      reserveTokens: preparation.settings.reserveTokens,
      ...(apiKey ? { apiKey } : {}),
      ...(signal ? { signal } : {}),
      ...(customInstructions ? { customInstructions } : {}),
      ...(preparation.previousSummary ? { previousSummary: preparation.previousSummary } : {}),
    });
  }

  const details = computeFileLists(preparation.fileOps);
  summary += formatFileOperations(details);
  return {
    summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    details,
  };
}

export function buildCompactionSummaryText(summary: string): string {
  return `${COMPACTION_SUMMARY_PREFIX}${summary}${COMPACTION_SUMMARY_SUFFIX}`;
}
