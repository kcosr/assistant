import fs from 'node:fs/promises';
import path from 'node:path';

import type { ConversationLogRecord } from './conversationStore';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

function parseJsonlRecords(content: string): ConversationLogRecord[] {
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const records: ConversationLogRecord[] = [];

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ConversationLogRecord;
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as { type?: unknown }).type === 'string'
      ) {
        records.push(parsed);
      }
    } catch {
      // Best-effort only: skip malformed lines but retain others.

      // Use a distinct message so that migration parsing errors can be
      // distinguished from runtime append/read errors.
      console.error('Failed to parse conversation log line during migration', line);
    }
  }

  return records;
}

/**
 * One-time migration from legacy single-file conversation log to
 * per-session transcript files.
 *
 * This function is idempotent: if the legacy file does not exist, or
 * if the transcripts directory already exists, it will return without
 * making any changes.
 */
export async function migrateConversationStorage(
  conversationLogPath: string,
  transcriptsDir: string,
): Promise<void> {
  let legacyExists: boolean;
  let transcriptsDirExists: boolean;

  try {
    legacyExists = await fileExists(conversationLogPath);
  } catch (err) {
    console.error('Failed to check legacy conversation log path', err);
    return;
  }

  try {
    transcriptsDirExists = await directoryExists(transcriptsDir);
  } catch (err) {
    console.error('Failed to check transcripts directory', err);
    return;
  }

  if (!legacyExists || transcriptsDirExists) {
    // Nothing to migrate or transcripts already created.
    return;
  }

  console.log(
    `Migrating conversation storage from ${conversationLogPath} to per-session transcripts in ${transcriptsDir}...`,
  );

  let content: string;
  try {
    content = await fs.readFile(conversationLogPath, 'utf8');
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      // File was removed between existence check and read; nothing to do.
      return;
    }

    console.error('Failed to read legacy conversation log file', err);
    return;
  }

  const records = parseJsonlRecords(content);
  const bySession = new Map<string, ConversationLogRecord[]>();

  for (const record of records) {
    const rawSessionId = record.sessionId;
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : '';
    if (!sessionId) {
      console.error(
        'Skipping conversation log record without a valid sessionId during migration',
        record,
      );
      continue;
    }

    let bucket = bySession.get(sessionId);
    if (!bucket) {
      bucket = [];
      bySession.set(sessionId, bucket);
    }
    bucket.push(record);
  }

  try {
    await fs.mkdir(transcriptsDir, { recursive: true });
  } catch (err) {
    console.error('Failed to create transcripts directory during migration', err);
    return;
  }

  for (const [sessionId, sessionRecords] of bySession) {
    const filePath = path.join(transcriptsDir, `${sessionId}.jsonl`);
    const sessionContent =
      sessionRecords.map((r) => JSON.stringify(r)).join('\n') +
      (sessionRecords.length > 0 ? '\n' : '');

    try {
      await fs.writeFile(filePath, sessionContent, 'utf8');
    } catch (err) {
      console.error(`Failed to write migrated transcript file for session ${sessionId}`, err);
    }
  }

  try {
    await fs.rename(conversationLogPath, `${conversationLogPath}.migrated`);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      // Legacy file disappeared after migration; nothing more to do.
      return;
    }

    console.error('Failed to rename legacy conversation log file after migration', err);
    return;
  }

  console.log(
    `Migration complete: ${bySession.size} session${bySession.size === 1 ? '' : 's'} migrated`,
  );
}
