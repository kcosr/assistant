import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { ConversationStore } from './conversationStore';

describe('ConversationStore', () => {
  it('appends tool call and result records as JSONL', async () => {
    const transcriptsDir = path.join(
      os.tmpdir(),
      `conversation-log-test-${Date.now()}-${Math.random().toString(16)}`,
    );
    const store = new ConversationStore(transcriptsDir);
    const sessionId = 'session-1';
    const filePath = path.join(transcriptsDir, `${sessionId}.jsonl`);

    void store.logToolCall({
      sessionId,
      callId: 'call-1',
      toolName: 'demo_tool',
      argsJson: '{"foo":"bar"}',
    });

    void store.logToolResult({
      sessionId,
      callId: 'call-1',
      toolName: 'demo_tool',
      ok: true,
      result: { value: 42 },
    });

    await store.flush();

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(lines).toHaveLength(2);

    const firstLine = lines[0];
    const secondLine = lines[1];
    if (!firstLine || !secondLine) {
      throw new Error('Expected two log lines');
    }

    const first = JSON.parse(firstLine);
    expect(first.type).toBe('tool_call');
    expect(first.sessionId).toBe(sessionId);
    expect(first.toolName).toBe('demo_tool');
    expect(first.argsJson).toBe('{"foo":"bar"}');

    const second = JSON.parse(secondLine);
    expect(second.type).toBe('tool_result');
    expect(second.sessionId).toBe(sessionId);
    expect(second.toolName).toBe('demo_tool');
    expect(second.ok).toBe(true);
    expect(second.result).toEqual({ value: 42 });
  });

  it('appends agent message and callback records as JSONL', async () => {
    const transcriptsDir = path.join(
      os.tmpdir(),
      `conversation-log-agent-${Date.now()}-${Math.random().toString(16)}`,
    );
    const store = new ConversationStore(transcriptsDir);
    const targetSessionId = 'target-session';
    const sourceSessionId = 'source-session';
    const targetFilePath = path.join(transcriptsDir, `${targetSessionId}.jsonl`);
    const sourceFilePath = path.join(transcriptsDir, `${sourceSessionId}.jsonl`);

    void store.logAgentMessage({
      sessionId: targetSessionId,
      fromSessionId: sourceSessionId,
      fromAgentId: 'source-agent',
      responseId: 'resp-123',
      text: 'Hello from source agent',
    });

    void store.logAgentCallback({
      sessionId: sourceSessionId,
      fromSessionId: targetSessionId,
      fromAgentId: 'target-agent',
      responseId: 'resp-123',
      text: 'Final response from target',
    });

    await store.flush();

    const targetContent = await fs.readFile(targetFilePath, 'utf8');
    const targetLines = targetContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(targetLines).toHaveLength(1);

    const firstLine = targetLines[0];
    if (!firstLine) {
      throw new Error('Expected one agent_message log line');
    }

    const first = JSON.parse(firstLine);
    expect(first.type).toBe('agent_message');
    expect(first.sessionId).toBe(targetSessionId);
    expect(first.fromSessionId).toBe(sourceSessionId);
    expect(first.fromAgentId).toBe('source-agent');
    expect(first.responseId).toBe('resp-123');
    expect(first.text).toBe('Hello from source agent');

    const sourceContent = await fs.readFile(sourceFilePath, 'utf8');
    const sourceLines = sourceContent
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(sourceLines).toHaveLength(1);

    const secondLine = sourceLines[0];
    if (!secondLine) {
      throw new Error('Expected one agent_callback log line');
    }

    const second = JSON.parse(secondLine);
    expect(second.type).toBe('agent_callback');
    expect(second.sessionId).toBe(sourceSessionId);
    expect(second.fromSessionId).toBe(targetSessionId);
    expect(second.fromAgentId).toBe('target-agent');
    expect(second.responseId).toBe('resp-123');
    expect(second.text).toBe('Final response from target');
  });

  it('appends user and assistant message records as JSONL', async () => {
    const transcriptsDir = path.join(
      os.tmpdir(),
      `conversation-log-messages-${Date.now()}-${Math.random().toString(16)}`,
    );
    const store = new ConversationStore(transcriptsDir);
    const sessionId = 'session-2';
    const filePath = path.join(transcriptsDir, `${sessionId}.jsonl`);

    void store.logUserMessage({
      sessionId,
      messageId: 'user-1',
      modality: 'text',
      text: 'Hello there',
    });

    void store.logAssistantMessage({
      sessionId,
      responseId: 'resp-1',
      modality: 'audio',
      audioItemId: 'item-1',
      audioTruncatedAtMs: 1200,
    });

    await store.flush();

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    expect(lines).toHaveLength(2);

    const firstLine = lines[0];
    const secondLine = lines[1];
    if (!firstLine || !secondLine) {
      throw new Error('Expected two log lines');
    }

    const first = JSON.parse(firstLine);
    expect(first.type).toBe('user_message');
    expect(first.sessionId).toBe(sessionId);
    expect(first.messageId).toBe('user-1');
    expect(first.modality).toBe('text');
    expect(first.text).toBe('Hello there');

    const second = JSON.parse(secondLine);
    expect(second.type).toBe('assistant_message');
    expect(second.sessionId).toBe(sessionId);
    expect(second.responseId).toBe('resp-1');
    expect(second.modality).toBe('audio');
    expect(second.audioItemId).toBe('item-1');
    expect(second.audioTruncatedAtMs).toBe(1200);
  });

  it('returns an ordered transcript for a session', async () => {
    const transcriptsDir = path.join(
      os.tmpdir(),
      `conversation-log-transcript-${Date.now()}-${Math.random().toString(16)}`,
    );
    const store = new ConversationStore(transcriptsDir);

    void store.logUserMessage({
      sessionId: 'session-a',
      modality: 'text',
      text: 'Hello A1',
    });

    void store.logUserMessage({
      sessionId: 'session-b',
      modality: 'text',
      text: 'Hello B1',
    });

    void store.logAssistantMessage({
      sessionId: 'session-a',
      modality: 'text',
      text: 'Reply A1',
    });

    const transcript = await store.getSessionTranscript('session-a');
    expect(transcript).toHaveLength(2);
    expect(transcript[0]?.sessionId).toBe('session-a');
    expect(transcript[0]?.type).toBe('user_message');
    expect((transcript[0] as { text?: string }).text).toBe('Hello A1');
    expect(transcript[1]?.type).toBe('assistant_message');
    expect((transcript[1] as { text?: string }).text).toBe('Reply A1');
  });

  it('clears a session transcript while preserving other sessions', async () => {
    const transcriptsDir = path.join(
      os.tmpdir(),
      `conversation-log-clear-${Date.now()}-${Math.random().toString(16)}`,
    );
    const store = new ConversationStore(transcriptsDir);

    void store.logUserMessage({
      sessionId: 'session-clear',
      modality: 'text',
      text: 'To be cleared',
    });

    void store.logUserMessage({
      sessionId: 'session-keep',
      modality: 'text',
      text: 'Keep me',
    });

    await store.flush();

    let transcriptClear = await store.getSessionTranscript('session-clear');
    let transcriptKeep = await store.getSessionTranscript('session-keep');
    expect(transcriptClear).toHaveLength(1);
    expect(transcriptKeep).toHaveLength(1);

    await store.clearSession('session-clear');

    transcriptClear = await store.getSessionTranscript('session-clear');
    transcriptKeep = await store.getSessionTranscript('session-keep');
    expect(transcriptClear).toHaveLength(0);
    expect(transcriptKeep).toHaveLength(1);
    expect((transcriptKeep[0] as { text?: string }).text).toBe('Keep me');
  });

  it('allows new messages after a session is cleared', async () => {
    const transcriptsDir = path.join(
      os.tmpdir(),
      `conversation-log-clear-reuse-${Date.now()}-${Math.random().toString(16)}`,
    );
    const store = new ConversationStore(transcriptsDir);

    void store.logUserMessage({
      sessionId: 'session-reuse',
      modality: 'text',
      text: 'Old message',
    });

    await store.clearSession('session-reuse');

    void store.logUserMessage({
      sessionId: 'session-reuse',
      modality: 'text',
      text: 'New message',
    });

    const transcript = await store.getSessionTranscript('session-reuse');
    expect(transcript).toHaveLength(1);
    expect((transcript[0] as { text?: string }).text).toBe('New message');
  });
});
