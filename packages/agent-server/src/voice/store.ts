import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type {
  VoiceConversationId,
  VoiceConversationRecord,
  VoiceJournalEntry,
  VoiceSessionId,
  VoiceSessionRecord,
  VoiceSessionState,
  VoiceClientEvent,
  VoiceClientEventInput,
} from './types';

interface VoiceStoreFile {
  conversations: VoiceConversationRecord[];
  sessions: VoiceSessionRecord[];
}

export class VoiceStore {
  private readonly filePath: string;
  private data: VoiceStoreFile = { conversations: [], sessions: [] };
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'voice-realtime.json');
  }

  async init(): Promise<void> {
    if (this.loaded) {
      return;
    }
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as VoiceStoreFile;
      this.data = {
        conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch {
      this.data = { conversations: [], sessions: [] };
    }
    this.loaded = true;
  }

  async listConversations(): Promise<VoiceConversationRecord[]> {
    await this.init();
    return [...this.data.conversations].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  async getConversation(id: VoiceConversationId): Promise<VoiceConversationRecord | null> {
    await this.init();
    return this.data.conversations.find((c) => c.id === id) ?? null;
  }

  async getOrCreateConversation(options: {
    conversationId?: string | null;
    listsInstanceId?: string;
  }): Promise<VoiceConversationRecord> {
    await this.init();
    const existingId = options.conversationId?.trim() ?? '';
    if (existingId) {
      const existing = await this.getConversation(existingId);
      if (existing) {
        return existing;
      }
    }
    const now = Date.now();
    const record: VoiceConversationRecord = {
      id: existingId || randomUUID(),
      createdAtMs: now,
      updatedAtMs: now,
      title: 'Realtime voice',
      listsInstanceId: options.listsInstanceId?.trim() || 'default',
      journal: [],
      activeSessionId: null,
    };
    this.data.conversations.push(record);
    await this.persist();
    return record;
  }

  async appendJournal(
    conversationId: VoiceConversationId,
    entry: Omit<VoiceJournalEntry, 'id' | 'atMs'> & { id?: string; atMs?: number },
  ): Promise<VoiceJournalEntry | null> {
    await this.init();
    const conversation = this.data.conversations.find((c) => c.id === conversationId);
    if (!conversation) {
      return null;
    }
    const full: VoiceJournalEntry = {
      id: entry.id ?? randomUUID(),
      atMs: entry.atMs ?? Date.now(),
      kind: entry.kind,
      ...(entry.text !== undefined ? { text: entry.text } : {}),
      ...(entry.toolName !== undefined ? { toolName: entry.toolName } : {}),
      ...(entry.toolCallId !== undefined ? { toolCallId: entry.toolCallId } : {}),
      ...(entry.payload !== undefined ? { payload: entry.payload } : {}),
    };
    conversation.journal.push(full);
    // Bound journal size for v1.
    if (conversation.journal.length > 200) {
      conversation.journal = conversation.journal.slice(-200);
    }
    conversation.updatedAtMs = full.atMs;
    await this.persist();
    return full;
  }

  async createSession(options: {
    conversationId: VoiceConversationId;
    listsInstanceId: string;
  }): Promise<VoiceSessionRecord> {
    await this.init();
    const conversation = this.data.conversations.find((c) => c.id === options.conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    // Single active session per conversation.
    if (conversation.activeSessionId) {
      const prior = this.data.sessions.find((s) => s.id === conversation.activeSessionId);
      if (prior && prior.state !== 'closed' && prior.state !== 'failed') {
        prior.state = 'closed';
        prior.updatedAtMs = Date.now();
        prior.lastError = 'replaced_by_new_session';
        this.pushEvent(prior, { type: 'closed', reason: 'replaced_by_new_session' });
      }
    }
    const now = Date.now();
    const session: VoiceSessionRecord = {
      id: randomUUID(),
      conversationId: options.conversationId,
      createdAtMs: now,
      updatedAtMs: now,
      state: 'created',
      muted: false,
      listsInstanceId: options.listsInstanceId,
      providerCallId: null,
      lastError: null,
      sequence: 0,
      events: [],
    };
    this.data.sessions.push(session);
    conversation.activeSessionId = session.id;
    conversation.updatedAtMs = now;
    this.pushEvent(session, { type: 'session_state', state: 'created' });
    await this.persist();
    return session;
  }

  async getSession(id: VoiceSessionId): Promise<VoiceSessionRecord | null> {
    await this.init();
    return this.data.sessions.find((s) => s.id === id) ?? null;
  }

  async updateSession(
    id: VoiceSessionId,
    patch: Partial<
      Pick<VoiceSessionRecord, 'state' | 'muted' | 'providerCallId' | 'lastError' | 'listsInstanceId'>
    >,
  ): Promise<VoiceSessionRecord | null> {
    await this.init();
    const session = this.data.sessions.find((s) => s.id === id);
    if (!session) {
      return null;
    }
    if (patch.state !== undefined) {
      session.state = patch.state;
    }
    if (patch.muted !== undefined) {
      session.muted = patch.muted;
    }
    if (patch.providerCallId !== undefined) {
      session.providerCallId = patch.providerCallId;
    }
    if (patch.lastError !== undefined) {
      session.lastError = patch.lastError;
    }
    if (patch.listsInstanceId !== undefined) {
      session.listsInstanceId = patch.listsInstanceId;
    }
    session.updatedAtMs = Date.now();
    await this.persist();
    return session;
  }

  pushEvent(session: VoiceSessionRecord, event: VoiceClientEventInput): VoiceClientEvent {
    session.sequence += 1;
    const full = { ...event, sequence: session.sequence } as VoiceClientEvent;
    session.events.push(full);
    if (session.events.length > 500) {
      session.events = session.events.slice(-500);
    }
    session.updatedAtMs = Date.now();
    return full;
  }

  async appendEvent(
    sessionId: VoiceSessionId,
    event: VoiceClientEventInput,
  ): Promise<VoiceClientEvent | null> {
    await this.init();
    const session = this.data.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return null;
    }
    const full = this.pushEvent(session, event);
    await this.persist();
    return full;
  }

  async eventsSince(sessionId: VoiceSessionId, afterSequence: number): Promise<VoiceClientEvent[]> {
    await this.init();
    const session = this.data.sessions.find((s) => s.id === sessionId);
    if (!session) {
      return [];
    }
    return session.events.filter((e) => e.sequence > afterSequence);
  }

  /**
   * Drop oldest closed/failed sessions beyond {@code maxTerminal}, keeping active ones.
   * Also clears activeSessionId on conversations that pointed at pruned sessions.
   */
  async pruneTerminalSessions(maxTerminal: number): Promise<number> {
    await this.init();
    if (maxTerminal < 0) {
      return 0;
    }
    const terminal = this.data.sessions
      .filter((s) => s.state === 'closed' || s.state === 'failed')
      .sort((a, b) => a.updatedAtMs - b.updatedAtMs);
    const overflow = terminal.length - maxTerminal;
    if (overflow <= 0) {
      return 0;
    }
    const toRemove = new Set(terminal.slice(0, overflow).map((s) => s.id));
    this.data.sessions = this.data.sessions.filter((s) => !toRemove.has(s.id));
    for (const conversation of this.data.conversations) {
      if (conversation.activeSessionId && toRemove.has(conversation.activeSessionId)) {
        conversation.activeSessionId = null;
      }
    }
    await this.persist();
    return toRemove.size;
  }

  recentJournalText(conversation: VoiceConversationRecord, maxEntries = 24): string {
    const slice = conversation.journal.slice(-maxEntries);
    return slice
      .map((entry) => {
        if (entry.kind === 'user_transcript') {
          return `User: ${entry.text ?? ''}`;
        }
        if (entry.kind === 'assistant_transcript') {
          return `Assistant: ${entry.text ?? ''}`;
        }
        if (entry.kind === 'tool_request') {
          return `Tool call ${entry.toolName ?? ''}: ${JSON.stringify(entry.payload ?? {})}`;
        }
        if (entry.kind === 'tool_result') {
          return `Tool result ${entry.toolName ?? ''}: ${JSON.stringify(entry.payload ?? {})}`;
        }
        return entry.text ? `System: ${entry.text}` : '';
      })
      .filter((line) => line.trim().length > 0)
      .join('\n');
  }

  private async persist(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      await fs.rename(tmp, this.filePath);
    });
    await this.writeChain;
  }
}

export type { VoiceSessionState };
