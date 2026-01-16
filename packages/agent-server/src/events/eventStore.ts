import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';

import type { ChatEvent } from '@assistant/shared';
import { safeValidateChatEvent, validateChatEvent } from '@assistant/shared';

import type { SessionHub } from '../sessionHub';

export interface EventStore {
  append(sessionId: string, event: ChatEvent): Promise<void>;
  appendBatch(sessionId: string, events: ChatEvent[]): Promise<void>;
  getEvents(sessionId: string): Promise<ChatEvent[]>;
  getEventsSince(sessionId: string, afterEventId: string): Promise<ChatEvent[]>;
  subscribe(sessionId: string, callback: (event: ChatEvent) => void): () => void;
}

type WriteTask = () => Promise<void>;

export class FileEventStore implements EventStore {
  private readonly baseDir: string;
  private readonly emitter = new EventEmitter();
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.baseDir = path.join(dataDir, 'sessions');
  }

  async append(sessionId: string, event: ChatEvent): Promise<void> {
    const trimmedSessionId = this.normaliseSessionId(sessionId);
    const validated = this.validateEventForSession(trimmedSessionId, event);
    const filePath = this.getSessionFilePath(trimmedSessionId);

    const task: WriteTask = async () => {
      await this.ensureSessionDir(filePath);
      const line = `${JSON.stringify(validated)}\n`;
      await fs.appendFile(filePath, line, 'utf8');
      this.emitEvent(trimmedSessionId, validated);
    };

    await this.queueWrite(trimmedSessionId, task);
  }

  async appendBatch(sessionId: string, events: ChatEvent[]): Promise<void> {
    const trimmedSessionId = this.normaliseSessionId(sessionId);
    if (events.length === 0) {
      return;
    }

    const validatedEvents = events.map((event) =>
      this.validateEventForSession(trimmedSessionId, event),
    );
    const filePath = this.getSessionFilePath(trimmedSessionId);

    const task: WriteTask = async () => {
      await this.ensureSessionDir(filePath);
      const content = validatedEvents.map((event) => JSON.stringify(event)).join('\n') + '\n';
      await fs.appendFile(filePath, content, 'utf8');
      for (const event of validatedEvents) {
        this.emitEvent(trimmedSessionId, event);
      }
    };

    await this.queueWrite(trimmedSessionId, task);
  }

  async getEvents(sessionId: string): Promise<ChatEvent[]> {
    const trimmedSessionId = this.normaliseSessionId(sessionId);
    await this.waitForSessionWrites(trimmedSessionId);

    const filePath = this.getSessionFilePath(trimmedSessionId);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return [];
      }
      console.error('Failed to read events file', err);
      return [];
    }

    return this.parseEventsFromContent(content);
  }

  async getEventsSince(sessionId: string, afterEventId: string): Promise<ChatEvent[]> {
    const events = await this.getEvents(sessionId);
    if (!afterEventId) {
      return events;
    }

    let index = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.id === afterEventId) {
        index = i;
        break;
      }
    }

    if (index === -1) {
      return events;
    }

    return events.slice(index + 1);
  }

  subscribe(sessionId: string, callback: (event: ChatEvent) => void): () => void {
    const trimmedSessionId = this.normaliseSessionId(sessionId);
    const eventName = this.getEventName(trimmedSessionId);
    this.emitter.on(eventName, callback);
    return () => {
      this.emitter.off(eventName, callback);
    };
  }

  private normaliseSessionId(sessionId: string): string {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      throw new Error('sessionId must not be empty');
    }
    return trimmed;
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.baseDir, sessionId, 'events.jsonl');
  }

  private async ensureSessionDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch {
      // Best-effort only; failures will be surfaced on write.
    }
  }

  private getEventName(sessionId: string): string {
    return `session:${sessionId}`;
  }

  private emitEvent(sessionId: string, event: ChatEvent): void {
    const eventName = this.getEventName(sessionId);
    this.emitter.emit(eventName, event);
  }

  private validateEventForSession(sessionId: string, event: ChatEvent): ChatEvent {
    const validated = validateChatEvent(event);
    if (validated.sessionId.trim() !== sessionId) {
      throw new Error(
        `ChatEvent.sessionId "${validated.sessionId}" does not match target session "${sessionId}"`,
      );
    }
    return validated;
  }

  private async queueWrite(sessionId: string, task: WriteTask): Promise<void> {
    const previous = this.writeQueues.get(sessionId) ?? Promise.resolve();

    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await task();
      });

    this.writeQueues.set(
      sessionId,
      next.catch(() => undefined),
    );

    await next;
  }

  private async waitForSessionWrites(sessionId: string): Promise<void> {
    const pending = this.writeQueues.get(sessionId);
    if (!pending) {
      return;
    }
    try {
      await pending;
    } catch {
      // Errors are reported to callers of append / appendBatch.
    }
  }

  private parseEventsFromContent(content: string): ChatEvent[] {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const events: ChatEvent[] = [];

    for (const line of lines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        console.error('Failed to parse chat event line', line);
        continue;
      }

      const result = safeValidateChatEvent(parsed);
      if (!result.success) {
        console.error('Invalid chat event in log', result.error?.message ?? '');
        continue;
      }

      events.push(result.data);
    }

    return events;
  }
}

export class SessionScopedEventStore implements EventStore {
  constructor(
    private readonly base: EventStore,
    private readonly sessionHub: SessionHub,
  ) {}

  async append(sessionId: string, event: ChatEvent): Promise<void> {
    const trimmed = this.normaliseSessionId(sessionId);
    if (await this.shouldPersist(trimmed)) {
      return this.base.append(trimmed, event);
    }
    this.validateEventForSession(trimmed, event);
  }

  async appendBatch(sessionId: string, events: ChatEvent[]): Promise<void> {
    const trimmed = this.normaliseSessionId(sessionId);
    if (events.length === 0) {
      return;
    }
    if (await this.shouldPersist(trimmed)) {
      return this.base.appendBatch(trimmed, events);
    }
    for (const event of events) {
      this.validateEventForSession(trimmed, event);
    }
  }

  async getEvents(sessionId: string): Promise<ChatEvent[]> {
    const trimmed = this.normaliseSessionId(sessionId);
    if (!(await this.shouldPersist(trimmed))) {
      return [];
    }
    return this.base.getEvents(trimmed);
  }

  async getEventsSince(sessionId: string, afterEventId: string): Promise<ChatEvent[]> {
    const trimmed = this.normaliseSessionId(sessionId);
    if (!(await this.shouldPersist(trimmed))) {
      return [];
    }
    return this.base.getEventsSince(trimmed, afterEventId);
  }

  subscribe(sessionId: string, callback: (event: ChatEvent) => void): () => void {
    const trimmed = this.normaliseSessionId(sessionId);
    const state = this.sessionHub.getSessionState(trimmed);
    const agentId = state?.summary.agentId;
    if (agentId) {
      const agent = this.sessionHub.getAgentRegistry().getAgent(agentId);
      if (agent?.chat?.provider === 'pi-cli') {
        return () => undefined;
      }
    }
    return this.base.subscribe(trimmed, callback);
  }

  private async shouldPersist(sessionId: string): Promise<boolean> {
    const state = this.sessionHub.getSessionState(sessionId);
    const agentId =
      state?.summary.agentId ?? (await this.sessionHub.getSessionIndex().getSession(sessionId))
        ?.agentId;
    if (!agentId) {
      return true;
    }
    const agent = this.sessionHub.getAgentRegistry().getAgent(agentId);
    const provider = agent?.chat?.provider ?? 'openai';
    return provider !== 'pi-cli';
  }

  private normaliseSessionId(sessionId: string): string {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      throw new Error('sessionId must not be empty');
    }
    return trimmed;
  }

  private validateEventForSession(sessionId: string, event: ChatEvent): void {
    const validated = validateChatEvent(event);
    if (validated.sessionId.trim() !== sessionId) {
      throw new Error(
        `ChatEvent.sessionId "${validated.sessionId}" does not match target session "${sessionId}"`,
      );
    }
  }
}
