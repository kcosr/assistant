import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { SessionAttributes, SessionAttributesPatch } from '@assistant/shared';
import {
  isPlainObject,
  mergeSessionAttributes,
  validateSessionAttributesPatch,
} from './sessionAttributes';
import { loadSessionIndexFromFileContent, type SessionIndexRecord } from './sessionIndexRecords';

export interface SessionConfig {
  /**
   * Reserved for future use: identifier of the system prompt
   * configuration associated with this session.
   */
  systemPromptId?: string;
  /**
   * Reserved for future use: identifier of the logical tool set
   * configuration associated with this session.
   */
  toolSetId?: string;
}

export interface SessionSummary {
  sessionId: string;
  /**
   * Identifier of the agent associated with this session.
   * Sessions without an agentId are treated as invalid and skipped.
   */
  agentId?: string;
  createdAt: string;
  updatedAt: string;
  lastSnippet?: string;
  deleted?: boolean;
  /**
   * When set, indicates that the session is pinned in the UI.
   * The value is the timestamp when the session was pinned and
   * is used for ordering pinned sessions (most recently pinned first).
   */
  pinnedAt?: string;
  /**
   * Optional user-defined name for the session. Must be unique
   * among non-deleted sessions (case-insensitive).
   */
  name?: string;
  /**
   * Currently selected chat model for this session (when applicable).
   * When omitted, the default model for the associated agent (or
   * environment configuration) will be used.
   */
  model?: string;
  /**
   * Currently selected thinking level for this session (when applicable).
   * When omitted, the default thinking level for the associated agent
   * will be used.
   */
  thinking?: string;
  /**
   * @deprecated Pinned sessions are no longer used for routing and
   * may be removed in a future version.
   */
  pinned?: boolean;
  /**
   * Reserved for future session configuration.
   */
  config?: SessionConfig;
  /**
   * Optional session-scoped attributes for plugins and panels.
   */
  attributes?: SessionAttributes;
}

export class SessionIndex {
  private readonly filePath: string;
  private initialised = false;
  private loaded = false;
  private readonly sessions = new Map<string, SessionSummary>();

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async listSessions(): Promise<SessionSummary[]> {
    await this.ensureLoaded();
    const summaries: SessionSummary[] = [];
    for (const summary of this.sessions.values()) {
      if (summary.deleted || !summary.agentId) {
        continue;
      }
      const { deleted: _deleted, ...rest } = summary as SessionSummary & { deleted?: boolean };
      summaries.push({ ...rest });
    }
    return summaries;
  }

  async getSession(sessionId: string): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const summary = this.sessions.get(sessionId);
    if (!summary || summary.deleted || !summary.agentId) {
      return undefined;
    }
    const { deleted: _deleted, ...rest } = summary as SessionSummary & { deleted?: boolean };
    return { ...rest };
  }

  async setSessionAgent(sessionId: string, agentId: string): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const existing = this.sessions.get(sessionId);
    if (!existing || existing.deleted || !agentId.trim()) {
      return undefined;
    }

    const timestamp = new Date().toISOString();
    existing.updatedAt = timestamp;
    existing.agentId = agentId;
    this.sessions.set(sessionId, existing);

    const record: SessionIndexRecord = {
      type: 'session_agent_set',
      sessionId,
      timestamp,
      agentId,
    };
    await this.append(record);

    return { ...existing };
  }

  async updateSessionAttributes(
    sessionId: string,
    patch: SessionAttributesPatch,
  ): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const trimmedId = sessionId.trim();
    if (!trimmedId) {
      return undefined;
    }
    if (!isPlainObject(patch)) {
      throw new Error('Session attributes patch must be an object');
    }
    validateSessionAttributesPatch(patch);

    const summary = this.sessions.get(trimmedId);
    if (!summary || summary.deleted || !summary.agentId) {
      return undefined;
    }

    const timestamp = new Date().toISOString();
    const nextAttributes = mergeSessionAttributes(summary.attributes, patch);
    if (Object.keys(nextAttributes).length > 0) {
      summary.attributes = nextAttributes;
    } else {
      delete summary.attributes;
    }
    summary.updatedAt = timestamp;
    this.sessions.set(trimmedId, summary);

    const record: SessionIndexRecord = {
      type: 'session_attributes_patch',
      sessionId: trimmedId,
      timestamp,
      patch,
    };
    await this.append(record);

    return { ...summary };
  }

  async createSession(options: {
    sessionId?: string;
    agentId: string;
    model?: string;
    thinking?: string;
  }): Promise<SessionSummary> {
    await this.ensureLoaded();
    const sessionId = options?.sessionId;
    const agentId = options.agentId.trim();
    if (!agentId) {
      throw new Error('agentId is required to create a session');
    }
    const model = options?.model;
    const thinking = options?.thinking;
    const existing = sessionId ? this.sessions.get(sessionId) : undefined;
    if (existing && !existing.deleted) {
      if (existing.agentId && existing.agentId !== agentId) {
        throw new Error(
          `Session "${existing.sessionId}" already belongs to agent "${existing.agentId}"`,
        );
      }
      if (!existing.agentId) {
        const updated = await this.setSessionAgent(existing.sessionId, agentId);
        return updated ?? { ...existing, agentId };
      }
      return { ...existing };
    }

    if (existing && existing.agentId && agentId && existing.agentId !== agentId) {
      throw new Error(
        `Session "${existing.sessionId}" already belongs to agent "${existing.agentId}"`,
      );
    }

    const id = existing?.sessionId ?? sessionId ?? randomUUID();
    const timestamp = new Date().toISOString();
    const summary: SessionSummary = {
      sessionId: id,
      agentId,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.sessions.set(id, summary);

    const record: SessionIndexRecord = {
      type: 'session_created',
      sessionId: id,
      timestamp,
      agentId,
      ...(model ? { model } : {}),
      ...(thinking ? { thinking } : {}),
    };
    await this.append(record);

    return summary;
  }

  async markSessionActivity(sessionId: string, lastSnippet?: string): Promise<SessionSummary> {
    await this.ensureLoaded();
    const summary = this.sessions.get(sessionId);
    if (!summary || !summary.agentId) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const timestamp = new Date().toISOString();
    summary.updatedAt = timestamp;
    if (lastSnippet !== undefined) {
      summary.lastSnippet = lastSnippet;
    }
    this.sessions.set(sessionId, summary);

    const record: SessionIndexRecord = {
      type: 'session_updated',
      sessionId,
      timestamp,
      ...(lastSnippet !== undefined ? { lastSnippet } : {}),
    };
    await this.append(record);

    return summary;
  }

  async markSessionDeleted(sessionId: string): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const timestamp = new Date().toISOString();
    const existing = this.sessions.get(sessionId);

    let summary: SessionSummary | undefined;
    if (!existing) {
      summary = {
        sessionId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    } else {
      summary = {
        ...existing,
        updatedAt: timestamp,
      };
    }

    this.sessions.delete(sessionId);

    const record: SessionIndexRecord = {
      type: 'session_deleted',
      sessionId,
      timestamp,
    };
    await this.append(record);

    return summary;
  }

  async renameSession(sessionId: string, name: string | null): Promise<SessionSummary> {
    await this.ensureLoaded();

    const existing = this.sessions.get(sessionId);
    if (!existing || existing.deleted) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const timestamp = new Date().toISOString();

    let normalisedName: string | null = null;
    if (name !== null) {
      const trimmed = name.trim();
      if (!trimmed) {
        throw new Error('Session name must not be empty');
      }
      const targetLower = trimmed.toLowerCase();
      for (const other of this.sessions.values()) {
        if (other.sessionId === sessionId || other.deleted) {
          continue;
        }
        if (typeof other.name === 'string' && other.name.toLowerCase() === targetLower) {
          throw new Error(`Session name "${trimmed}" is already in use`);
        }
      }
      existing.name = trimmed;
      normalisedName = trimmed;
    } else {
      delete existing.name;
      normalisedName = null;
    }

    existing.updatedAt = timestamp;
    this.sessions.set(sessionId, existing);

    const record: SessionIndexRecord = {
      type: 'session_renamed',
      sessionId,
      timestamp,
      name: normalisedName,
    };
    await this.append(record);

    return existing;
  }

  async findSessionByName(name: string): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const trimmed = name.trim();
    if (!trimmed) {
      return undefined;
    }
    const targetLower = trimmed.toLowerCase();

    for (const summary of this.sessions.values()) {
      if (summary.deleted) {
        continue;
      }
      if (typeof summary.name === 'string' && summary.name.toLowerCase() === targetLower) {
        return { ...summary };
      }
    }

    return undefined;
  }

  async findSessionForAgent(agentId: string): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    let latest: SessionSummary | undefined;

    for (const summary of this.sessions.values()) {
      if (summary.deleted || summary.agentId !== agentId) {
        continue;
      }
      if (!latest) {
        latest = summary;
        continue;
      }
      const candidateUpdated = new Date(summary.updatedAt).getTime();
      const latestUpdated = new Date(latest.updatedAt).getTime();
      if (candidateUpdated > latestUpdated) {
        latest = summary;
      }
    }

    return latest ? { ...latest } : undefined;
  }

  async touchSession(sessionId: string): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const existing = this.sessions.get(sessionId);
    if (!existing || existing.deleted) {
      return undefined;
    }

    const timestamp = new Date().toISOString();
    existing.updatedAt = timestamp;
    this.sessions.set(sessionId, existing);

    const record: SessionIndexRecord = {
      type: 'session_updated',
      sessionId,
      timestamp,
    };
    await this.append(record);

    return { ...existing };
  }

  async setSessionModel(
    sessionId: string,
    model: string | null,
  ): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const existing = this.sessions.get(sessionId);
    if (!existing || existing.deleted) {
      return undefined;
    }

    const timestamp = new Date().toISOString();
    existing.updatedAt = timestamp;
    if (model === null) {
      delete existing.model;
    } else {
      existing.model = model;
    }
    this.sessions.set(sessionId, existing);

    const record: SessionIndexRecord = {
      type: 'session_model_set',
      sessionId,
      timestamp,
      model,
    };
    await this.append(record);

    return { ...existing };
  }

  async setSessionThinking(
    sessionId: string,
    thinking: string | null,
  ): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const existing = this.sessions.get(sessionId);
    if (!existing || existing.deleted) {
      return undefined;
    }

    const timestamp = new Date().toISOString();
    existing.updatedAt = timestamp;
    if (thinking === null) {
      delete existing.thinking;
    } else {
      existing.thinking = thinking;
    }
    this.sessions.set(sessionId, existing);

    const record: SessionIndexRecord = {
      type: 'session_thinking_set',
      sessionId,
      timestamp,
      thinking,
    };
    await this.append(record);

    return { ...existing };
  }

  async pinSession(
    sessionId: string,
    pinnedAt: string | null,
  ): Promise<SessionSummary | undefined> {
    await this.ensureLoaded();
    const existing = this.sessions.get(sessionId);
    if (!existing || existing.deleted) {
      return undefined;
    }

    const timestamp = new Date().toISOString();
    existing.updatedAt = timestamp;
    if (pinnedAt === null) {
      delete existing.pinnedAt;
    } else {
      existing.pinnedAt = pinnedAt;
    }
    this.sessions.set(sessionId, existing);

    const record: SessionIndexRecord = {
      type: 'session_pinned',
      sessionId,
      timestamp,
      pinnedAt,
    };
    await this.append(record);

    return { ...existing };
  }

  async clearSession(sessionId: string): Promise<SessionSummary> {
    await this.ensureLoaded();

    const existing = this.sessions.get(sessionId);
    if (!existing) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (existing.deleted) {
      throw new Error(`Cannot clear deleted session: ${sessionId}`);
    }

    const timestamp = new Date().toISOString();
    existing.updatedAt = timestamp;
    delete existing.lastSnippet;
    this.sessions.set(sessionId, existing);

    const record: SessionIndexRecord = {
      type: 'session_cleared',
      sessionId,
      timestamp,
    };
    await this.append(record);

    return existing;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    let content: string;
    try {
      content = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return;
      }

      console.error('Failed to read session index file', err);
      return;
    }
    loadSessionIndexFromFileContent(content, this.sessions);

    let removed = 0;
    for (const [sessionId, summary] of this.sessions.entries()) {
      if (!summary.agentId) {
        this.sessions.delete(sessionId);
        removed += 1;
      }
    }
    if (removed > 0) {
      console.warn(`[sessionIndex] removed ${removed} sessions without agentId`);
    }
  }

  private async ensureFile(): Promise<void> {
    if (this.initialised) {
      return;
    }
    this.initialised = true;
    const dir = path.dirname(this.filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Best-effort only; failures will be surfaced on write.
    }
  }

  private async append(record: SessionIndexRecord): Promise<void> {
    try {
      await this.ensureFile();
      const line = `${JSON.stringify(record)}\n`;
      await fs.appendFile(this.filePath, line, 'utf8');
    } catch (err) {
      console.error('Failed to append session index entry', err);
    }
  }
}
