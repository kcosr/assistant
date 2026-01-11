import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Simple modality flag used for persisted messages.
 * - "text": text-only message
 * - "audio": audio-only message
 * - "both": message that has both text and audio components
 */
export type MessageModality = 'text' | 'audio' | 'both';

export interface UserMessageLogRecord {
  type: 'user_message';
  timestamp: string;
  sessionId: string;
  /**
   * Optional logical message identifier (for example, transcript item id).
   */
  messageId?: string;
  modality: MessageModality;
  text?: string;
  /**
   * Optional upstream audio item identifier associated with this user turn.
   */
  audioItemId?: string;
}

export interface AssistantMessageLogRecord {
  type: 'assistant_message';
  timestamp: string;
  sessionId: string;
  /**
   * Optional upstream response identifier associated with this turn.
   */
  responseId?: string;
  modality: MessageModality;
  text?: string;
  /**
   * Optional structured thinking text associated with this assistant turn.
   * When present, this is rendered separately from the main response text.
   */
  thinkingText?: string;
  /**
   * Optional upstream audio item identifier for TTS output.
   */
  audioItemId?: string;
  /**
   * When a barge-in truncates audio, this captures the playback offset
   * (in milliseconds) where audio was stopped.
   */
  audioTruncatedAtMs?: number;
  /**
   * True if this message was interrupted/cancelled before completion.
   */
  interrupted?: boolean;
}

export interface ToolCallLogRecord {
  type: 'tool_call';
  timestamp: string;
  sessionId: string;
  callId: string;
  toolName: string;
  argsJson: string;
}

export interface TextDeltaLogRecord {
  type: 'text_delta';
  timestamp: string;
  sessionId: string;
  responseId: string;
  delta: string;
  agentExchangeId?: string;
}

export interface TextDoneLogRecord {
  type: 'text_done';
  timestamp: string;
  sessionId: string;
  responseId: string;
  text: string;
  agentExchangeId?: string;
}

export interface ThinkingStartLogRecord {
  type: 'thinking_start';
  timestamp: string;
  sessionId: string;
  responseId: string;
  agentExchangeId?: string;
}

export interface ThinkingDeltaLogRecord {
  type: 'thinking_delta';
  timestamp: string;
  sessionId: string;
  responseId: string;
  delta: string;
  agentExchangeId?: string;
}

export interface ThinkingDoneLogRecord {
  type: 'thinking_done';
  timestamp: string;
  sessionId: string;
  responseId: string;
  text: string;
  agentExchangeId?: string;
}

export interface ToolCallStartLogRecord {
  type: 'tool_call_start';
  timestamp: string;
  sessionId: string;
  callId: string;
  toolName: string;
  arguments: string;
  agentExchangeId?: string;
}

export interface ToolOutputDeltaLogRecord {
  type: 'tool_output_delta';
  timestamp: string;
  sessionId: string;
  callId: string;
  toolName: string;
  delta: string;
  details?: Record<string, unknown>;
  agentExchangeId?: string;
}

export interface ToolResultLogRecord {
  type: 'tool_result';
  timestamp: string;
  sessionId: string;
  callId: string;
  toolName: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
  agentExchangeId?: string;
}

export interface OutputCancelledLogRecord {
  type: 'output_cancelled';
  timestamp: string;
  sessionId: string;
  responseId?: string;
}

export interface AgentMessageLogRecord {
  type: 'agent_message';
  timestamp: string;
  /**
   * Target session that received the agent-to-agent message.
   */
  sessionId: string;
  /**
   * Calling agent's session that sent the message.
   */
  fromSessionId: string;
  /**
   * Optional calling agent identifier.
   */
  fromAgentId?: string;
  /**
   * Optional response identifier for the target chat run.
   */
  responseId?: string;
  /**
   * Message content as seen by the target agent.
   */
  text: string;
}

export interface AgentCallbackLogRecord {
  type: 'agent_callback';
  timestamp: string;
  /**
   * Calling agent's session that receives the async callback.
   */
  sessionId: string;
  /**
   * Target session that completed and produced this callback.
   */
  fromSessionId: string;
  /**
   * Optional target agent identifier.
   */
  fromAgentId?: string;
  /**
   * Response identifier for the target chat run.
   */
  responseId: string;
  /**
   * Final response text returned to the calling agent.
   */
  text: string;
}

export type ConversationLogRecord =
  | UserMessageLogRecord
  | AssistantMessageLogRecord
  | TextDeltaLogRecord
  | TextDoneLogRecord
  | ThinkingStartLogRecord
  | ThinkingDeltaLogRecord
  | ThinkingDoneLogRecord
  | ToolCallLogRecord
  | ToolCallStartLogRecord
  | ToolOutputDeltaLogRecord
  | ToolResultLogRecord
  | OutputCancelledLogRecord
  | AgentMessageLogRecord
  | AgentCallbackLogRecord;

export class ConversationStore {
  private readonly transcriptsDir: string;
  private initialised = false;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(transcriptsDir: string) {
    this.transcriptsDir = transcriptsDir;
  }

  private getSessionFilePath(sessionId: string): string {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      throw new Error('sessionId must not be empty');
    }
    return path.join(this.transcriptsDir, `${trimmed}.jsonl`);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logUserMessage(record: Omit<UserMessageLogRecord, 'type' | 'timestamp'>): Promise<void> {
    const entry: UserMessageLogRecord = {
      type: 'user_message',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  async logAssistantMessage(
    record: Omit<AssistantMessageLogRecord, 'type' | 'timestamp'> & { timestamp?: string },
  ): Promise<void> {
    const entry: AssistantMessageLogRecord = {
      type: 'assistant_message',
      timestamp: record.timestamp ?? new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logAgentMessage(record: Omit<AgentMessageLogRecord, 'type' | 'timestamp'>): Promise<void> {
    const entry: AgentMessageLogRecord = {
      type: 'agent_message',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logAgentCallback(
    record: Omit<AgentCallbackLogRecord, 'type' | 'timestamp'>,
  ): Promise<void> {
    const entry: AgentCallbackLogRecord = {
      type: 'agent_callback',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logToolCall(
    record: Omit<ToolCallLogRecord, 'type' | 'timestamp'> & { timestamp?: string },
  ): Promise<void> {
    const entry: ToolCallLogRecord = {
      type: 'tool_call',
      timestamp: record.timestamp ?? new Date().toISOString(),
      sessionId: record.sessionId,
      callId: record.callId,
      toolName: record.toolName,
      argsJson: record.argsJson,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logTextDelta(record: Omit<TextDeltaLogRecord, 'type' | 'timestamp'>): Promise<void> {
    const entry: TextDeltaLogRecord = {
      type: 'text_delta',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logTextDone(record: Omit<TextDoneLogRecord, 'type' | 'timestamp'>): Promise<void> {
    const entry: TextDoneLogRecord = {
      type: 'text_done',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logThinkingStart(
    record: Omit<ThinkingStartLogRecord, 'type' | 'timestamp'>,
  ): Promise<void> {
    const entry: ThinkingStartLogRecord = {
      type: 'thinking_start',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logThinkingDelta(
    record: Omit<ThinkingDeltaLogRecord, 'type' | 'timestamp'>,
  ): Promise<void> {
    const entry: ThinkingDeltaLogRecord = {
      type: 'thinking_delta',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logThinkingDone(record: Omit<ThinkingDoneLogRecord, 'type' | 'timestamp'>): Promise<void> {
    const entry: ThinkingDoneLogRecord = {
      type: 'thinking_done',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logToolCallStart(
    record: Omit<ToolCallStartLogRecord, 'type' | 'timestamp'>,
  ): Promise<void> {
    const entry: ToolCallStartLogRecord = {
      type: 'tool_call_start',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logToolOutputDelta(
    record: Omit<ToolOutputDeltaLogRecord, 'type' | 'timestamp'>,
  ): Promise<void> {
    const entry: ToolOutputDeltaLogRecord = {
      type: 'tool_output_delta',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logToolResult(record: Omit<ToolResultLogRecord, 'type' | 'timestamp'>): Promise<void> {
    const entry: ToolResultLogRecord = {
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * @deprecated
   * New chat logging should use EventStore + ChatEvent streams.
   * This method remains for legacy transcript format support.
   */
  async logOutputCancelled(
    record: Omit<OutputCancelledLogRecord, 'type' | 'timestamp'>,
  ): Promise<void> {
    const entry: OutputCancelledLogRecord = {
      type: 'output_cancelled',
      timestamp: new Date().toISOString(),
      ...record,
    };
    this.queueWrite(entry);
  }

  /**
   * Read all conversation log records from the per-session JSONL files.
   *
   * This is intended for diagnostics and low-throughput APIs (for example,
   * reconstructing transcripts for a single user session). It is not
   * optimised for very large log files.
   */
  async readAllRecords(): Promise<ConversationLogRecord[]> {
    try {
      // Ensure we see a consistent view of all transcripts.
      await this.flush();

      const entries = await fs.readdir(this.transcriptsDir);
      const records: ConversationLogRecord[] = [];

      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) {
          continue;
        }
        const filePath = path.join(this.transcriptsDir, entry);
        let content: string;
        try {
          content = await fs.readFile(filePath, 'utf8');
        } catch (err) {
          const anyErr = err as NodeJS.ErrnoException;
          if (anyErr && anyErr.code === 'ENOENT') {
            continue;
          }

          console.error('Failed to read conversation log file', err);
          continue;
        }

        const fileRecords = this.parseRecordsFromContent(content);
        if (fileRecords.length > 0) {
          records.push(...fileRecords);
        }
      }

      return records;
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return [];
      }

      console.error('Failed to read transcripts directory', err);
      return [];
    }
  }

  private parseRecordsFromContent(content: string): ConversationLogRecord[] {
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

        console.error('Failed to parse conversation log line', line);
      }
    }

    return records;
  }

  /**
   * Return an ordered transcript for a single session, reconstructed
   * from the per-session JSONL log file.
   */
  async getSessionTranscript(sessionId: string): Promise<ConversationLogRecord[]> {
    await this.waitForSessionWrites(sessionId);

    const filePath = this.getSessionFilePath(sessionId);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return [];
      }

      console.error('Failed to read conversation log file', err);
      return [];
    }

    const records = this.parseRecordsFromContent(content);

    if (records.length <= 1) {
      return records;
    }

    const indexed = records.map((record, index) => ({ record, index }));
    indexed.sort((a, b) => {
      const aTime = new Date(a.record.timestamp).getTime();
      const bTime = new Date(b.record.timestamp).getTime();

      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return aTime - bTime;
      }

      // Tie-break by file order to guarantee deterministic ordering when timestamps collide.
      return a.index - b.index;
    });

    return indexed.map((entry) => entry.record);
  }

  /**
   * Clear all conversation history for a given session.
   *
   * This removes all records associated with the session by deleting
   * its transcript file. Other sessions are left intact.
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.waitForSessionWrites(sessionId);

    const filePath = this.getSessionFilePath(sessionId);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return;
      }

      console.error('Failed to clear session transcript', err);
    }
  }

  private async ensureDir(): Promise<void> {
    if (this.initialised) {
      return;
    }

    try {
      await fs.mkdir(this.transcriptsDir, { recursive: true });
    } catch {
      // Best-effort only; failures will be surfaced on write.
    }

    this.initialised = true;
  }

  private queueWrite(record: ConversationLogRecord): void {
    const trimmedSessionId = record.sessionId.trim();
    if (!trimmedSessionId) {
      console.error('Failed to append conversation log entry: missing sessionId', record);
      return;
    }

    const current = this.writeQueues.get(trimmedSessionId) ?? Promise.resolve();
    const next = current
      .then(() => this.doAppend(trimmedSessionId, record))
      .catch((err) => {
        // Logging must never crash the server; emit to stderr and continue.
        console.error('Failed to append conversation log entry', err);
      });
    this.writeQueues.set(trimmedSessionId, next);
  }

  private async doAppend(sessionId: string, record: ConversationLogRecord): Promise<void> {
    await this.ensureDir();
    const filePath = this.getSessionFilePath(sessionId);
    const line = `${JSON.stringify(record)}\n`;
    await fs.appendFile(filePath, line, 'utf8');
  }

  private async waitForSessionWrites(sessionId: string): Promise<void> {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    const pending = this.writeQueues.get(trimmed);
    if (!pending) {
      return;
    }
    try {
      await pending;
    } catch {
      // Errors are already logged by queueWrite.
    }
  }

  async flush(): Promise<void> {
    const pending = Array.from(this.writeQueues.values());
    if (pending.length === 0) {
      return;
    }
    await Promise.allSettled(pending);
  }

  /**
   * Hard-delete transcript for a session by removing its file.
   *
   * Used when a session is deleted from the session index.
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.waitForSessionWrites(sessionId);

    const filePath = this.getSessionFilePath(sessionId);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      const anyErr = err as NodeJS.ErrnoException;
      if (anyErr && anyErr.code === 'ENOENT') {
        return;
      }
      throw err;
    }
  }
}
