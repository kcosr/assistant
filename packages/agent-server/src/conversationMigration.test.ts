import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateConversationStorage } from './conversationMigration';

describe('migrateConversationStorage', () => {
  let dataDir: string;
  let conversationLogPath: string;
  let transcriptsDir: string;

  beforeEach(async () => {
    dataDir = path.join(
      os.tmpdir(),
      `conversation-migration-${Date.now()}-${Math.random().toString(16)}`,
    );
    await fs.mkdir(dataDir, { recursive: true });
    conversationLogPath = path.join(dataDir, 'conversations.jsonl');
    transcriptsDir = path.join(dataDir, 'transcripts');
  });

  afterEach(async () => {
    await fs.rm(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('migrates records into per-session transcript files and renames legacy file', async () => {
    const records = [
      {
        type: 'user_message',
        timestamp: '2024-01-01T00:00:00.000Z',
        sessionId: 'session-1',
        modality: 'text',
        text: 'Hello',
      },
      {
        type: 'assistant_message',
        timestamp: '2024-01-01T00:00:01.000Z',
        sessionId: 'session-1',
        modality: 'text',
        text: 'Hi there',
      },
      {
        type: 'user_message',
        timestamp: '2024-01-01T00:00:02.000Z',
        sessionId: 'session-2',
        modality: 'text',
        text: 'Second session',
      },
    ];

    const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await fs.writeFile(conversationLogPath, content, 'utf8');

    await migrateConversationStorage(conversationLogPath, transcriptsDir);

    // Legacy file should be renamed, not deleted.
    const legacyExists = await fs
      .stat(conversationLogPath)
      .then(() => true)
      .catch(() => false);
    expect(legacyExists).toBe(false);

    const legacyBackupExists = await fs
      .stat(`${conversationLogPath}.migrated`)
      .then((stats) => stats.isFile())
      .catch(() => false);
    expect(legacyBackupExists).toBe(true);

    // Per-session transcripts should exist with ordered records.
    const session1Path = path.join(transcriptsDir, 'session-1.jsonl');
    const session2Path = path.join(transcriptsDir, 'session-2.jsonl');

    const session1Content = await fs.readFile(session1Path, 'utf8');
    const session1Lines = session1Content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(session1Lines).toHaveLength(2);

    const session1First = JSON.parse(session1Lines[0]!);
    const session1Second = JSON.parse(session1Lines[1]!);
    expect(session1First.sessionId).toBe('session-1');
    expect(session1First.type).toBe('user_message');
    expect(session1Second.sessionId).toBe('session-1');
    expect(session1Second.type).toBe('assistant_message');

    const session2Content = await fs.readFile(session2Path, 'utf8');
    const session2Lines = session2Content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(session2Lines).toHaveLength(1);

    const session2Record = JSON.parse(session2Lines[0]!);
    expect(session2Record.sessionId).toBe('session-2');
    expect(session2Record.type).toBe('user_message');
  });

  it('is idempotent when run multiple times', async () => {
    const record = {
      type: 'user_message',
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'session-id',
      modality: 'text',
      text: 'Hello',
    };

    const content = `${JSON.stringify(record)}\n`;
    await fs.writeFile(conversationLogPath, content, 'utf8');

    await migrateConversationStorage(conversationLogPath, transcriptsDir);
    const firstTranscript = await fs.readFile(
      path.join(transcriptsDir, 'session-id.jsonl'),
      'utf8',
    );

    // Second call should be a no-op (legacy file no longer exists, transcripts dir exists).
    await migrateConversationStorage(conversationLogPath, transcriptsDir);

    const secondTranscript = await fs.readFile(
      path.join(transcriptsDir, 'session-id.jsonl'),
      'utf8',
    );

    expect(secondTranscript).toBe(firstTranscript);
  });

  it('logs progress when migration runs', async () => {
    const record = {
      type: 'user_message',
      timestamp: '2024-01-01T00:00:00.000Z',
      sessionId: 'session-id',
      modality: 'text',
      text: 'Hello',
    };

    const content = `${JSON.stringify(record)}\n`;
    await fs.writeFile(conversationLogPath, content, 'utf8');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await migrateConversationStorage(conversationLogPath, transcriptsDir);

    expect(logSpy).toHaveBeenCalled();

    // Ensure we log both start and completion messages.
    const loggedMessages = logSpy.mock.calls.map((call) => call[0]);
    expect(
      loggedMessages.some((msg) => String(msg).includes('Migrating conversation storage from')),
    ).toBe(true);
    expect(loggedMessages.some((msg) => String(msg).includes('Migration complete:'))).toBe(true);
  });

  it('does nothing when legacy file does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await migrateConversationStorage(conversationLogPath, transcriptsDir);

    const transcriptsDirExists = await fs
      .stat(transcriptsDir)
      .then((stats) => stats.isDirectory())
      .catch(() => false);
    expect(transcriptsDirExists).toBe(false);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
