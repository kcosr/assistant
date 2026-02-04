import fs from 'node:fs/promises';
import path from 'node:path';

import { randomUUID } from 'node:crypto';

const ORPHAN_TOOL_RESULT_CUSTOM_TYPE = 'assistant.orphan_tool_result';

function usage() {
  // Keep this short; it's a dev script.
  // eslint-disable-next-line no-console
  console.log(
    [
      'Usage:',
      '  node scripts/repair-pi-session-jsonl.mjs <session.jsonl> [--dry-run]',
      '',
      'Behavior:',
      '- Replaces Pi `message` entries with role `toolResult` that reference a missing toolCall',
      `  with a non-disruptive \`custom_message\` entry (${ORPHAN_TOOL_RESULT_CUSTOM_TYPE}).`,
      '- Writes a backup file next to the session by default.',
    ].join('\n'),
  );
}

function getToolCallIdFromToolResultMessage(message) {
  if (!message || typeof message !== 'object') return null;
  const raw = message.toolCallId ?? message.tool_call_id;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function collectToolCallIds(entries) {
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.type !== 'message') continue;
    const msg = entry.message;
    if (!msg || typeof msg !== 'object') continue;
    if (msg.role !== 'assistant') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type !== 'toolCall') continue;
      const id = block.id;
      if (typeof id === 'string' && id.trim().length > 0) {
        ids.add(id.trim());
      }
    }
  }
  return ids;
}

function extractToolResultTextSnippet(message, maxLen = 240) {
  if (!message || typeof message !== 'object') return '';
  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return '';
  const first = content[0];
  if (!first || typeof first !== 'object') return '';
  const text = first.text;
  if (typeof text !== 'string' || !text.trim()) return '';
  const trimmed = text.trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen)}…` : trimmed;
}

function buildPlaceholderEntry(originalEntry, toolCallId, toolName, snippet) {
  const base = originalEntry && typeof originalEntry === 'object' ? originalEntry : {};
  return {
    type: 'custom_message',
    id: typeof base.id === 'string' && base.id.trim() ? base.id : randomUUID().slice(0, 8),
    parentId: typeof base.parentId === 'string' || base.parentId === null ? base.parentId : null,
    timestamp: typeof base.timestamp === 'string' && base.timestamp.trim() ? base.timestamp : new Date().toISOString(),
    customType: ORPHAN_TOOL_RESULT_CUSTOM_TYPE,
    content: '',
    details: {
      toolCallId,
      toolName: toolName || 'tool',
      ...(snippet ? { snippet } : {}),
      note: 'Tool result replaced because matching toolCall was not found in this session log.',
    },
    display: false,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArg = args.find((a) => a && !a.startsWith('-')) ?? '';

  if (!fileArg) {
    usage();
    process.exitCode = 2;
    return;
  }

  const filePath = path.resolve(process.cwd(), fileArg);

  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to read file', { filePath, error: err instanceof Error ? err.message : String(err) });
    process.exitCode = 1;
    return;
  }

  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const entries = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        entries.push(parsed);
      }
    } catch {
      // Skip invalid lines; leave them out of the repaired file.
    }
  }

  const toolCallIds = collectToolCallIds(entries);
  let replaced = 0;
  let kept = 0;

  const repaired = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    if (entry.type !== 'message') {
      kept += 1;
      return entry;
    }
    const msg = entry.message;
    if (!msg || typeof msg !== 'object') {
      kept += 1;
      return entry;
    }
    if (msg.role !== 'toolResult') {
      kept += 1;
      return entry;
    }

    const toolCallId = getToolCallIdFromToolResultMessage(msg);
    if (!toolCallId || toolCallIds.has(toolCallId)) {
      kept += 1;
      return entry;
    }

    replaced += 1;
    const toolName = typeof msg.toolName === 'string' ? msg.toolName : '';
    const snippet = extractToolResultTextSnippet(msg);
    return buildPlaceholderEntry(entry, toolCallId, toolName, snippet);
  });

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        filePath,
        dryRun,
        toolCalls: toolCallIds.size,
        entries: entries.length,
        kept,
        replaced,
      },
      null,
      2,
    ),
  );

  if (dryRun || replaced === 0) {
    return;
  }

  const backupPath = `${filePath}.bak`;
  await fs.writeFile(backupPath, content, 'utf8');

  const out = repaired.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
  await fs.writeFile(filePath, out, 'utf8');

  // eslint-disable-next-line no-console
  console.log('Wrote repaired file', { filePath, backupPath });
}

await main();

