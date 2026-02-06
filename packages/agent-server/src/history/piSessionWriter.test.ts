import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AssistantMessage } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage } from '../chatCompletionTypes';
import type { SessionSummary } from '../sessionIndex';
import { PiSessionWriter } from './piSessionWriter';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('PiSessionWriter', () => {
  it('writes pi-mono compatible session files with model/thinking and tool calls', async () => {
    const baseDir = await createTempDir('pi-session-writer');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-1',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    const assistantMessage: AssistantMessage = {
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'Reasoning...',
          thinkingSignature: 'sig-1',
        },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'read',
          arguments: { path: '/tmp/project/file.txt' },
          thoughtSignature: 'thought-1',
        },
        {
          type: 'text',
          text: 'Hi',
        },
      ],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-4.1',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
      stopReason: 'toolUse',
      timestamp: 1769904000000,
    };

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi', piSdkMessage: assistantMessage },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ ok: true, result: 'done' }),
      },
    ];

    await writer.sync({
      summary,
      messages,
      modelSpec: 'openai/gpt-4.1',
      thinkingLevel: 'medium',
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);

    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    const header = entries[0] as Record<string, unknown> | undefined;
    expect(header?.['type']).toBe('session');
    expect(header?.['cwd']).toBe('/tmp/project');
    expect(header?.['version']).toBe(3);

    const modelEntry = entries.find((entry) => entry['type'] === 'model_change');
    expect(modelEntry?.['provider']).toBe('openai');
    expect(modelEntry?.['modelId']).toBe('gpt-4.1');

    const thinkingEntry = entries.find((entry) => entry['type'] === 'thinking_level_change');
    expect(thinkingEntry?.['thinkingLevel']).toBe('medium');

    const messageEntries = entries.filter((entry) => entry['type'] === 'message');
    expect(messageEntries).toHaveLength(3);
    expect((messageEntries[0]?.['message'] as Record<string, unknown> | undefined)?.['role']).toBe(
      'user',
    );
    expect((messageEntries[1]?.['message'] as Record<string, unknown> | undefined)?.['role']).toBe(
      'assistant',
    );
    expect((messageEntries[2]?.['message'] as Record<string, unknown> | undefined)?.['role']).toBe(
      'toolResult',
    );

    const assistantContent = (messageEntries[1]?.['message'] as AssistantMessage).content;
    expect(
      assistantContent.some(
        (block) => block.type === 'thinking' && block.thinkingSignature === 'sig-1',
      ),
    ).toBe(true);
    const toolCallBlock = assistantContent.find((block) => block.type === 'toolCall') as
      | { name?: string }
      | undefined;
    expect(toolCallBlock?.name).toBe('read');

    const toolResultMessage = messageEntries[2]?.['message'] as
      | { toolName?: string }
      | undefined;
    expect(toolResultMessage?.toolName).toBe('read');
  });

  it('writes agent-attributed and callback inputs as assistant.input custom_message entries', async () => {
    const baseDir = await createTempDir('pi-session-writer-custom-message');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-2',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: 'Hello from agent',
        meta: { source: 'agent', fromAgentId: 'agent-a', fromSessionId: 'sess-a', visibility: 'visible' },
      },
      {
        role: 'user',
        content: 'Hidden callback input',
        meta: { source: 'callback', fromAgentId: 'agent-b', fromSessionId: 'sess-b', visibility: 'hidden' },
      },
      { role: 'assistant', content: 'Ack' },
    ];

    await writer.sync({
      summary,
      messages,
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);

    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    const customEntries = entries.filter((entry) => entry['type'] === 'custom_message');
    expect(customEntries.length).toBe(2);

    const agentInput = customEntries.find((entry) => {
      const details = entry['details'];
      const kind = details && typeof details === 'object' ? (details as Record<string, unknown>)['kind'] : undefined;
      return entry['customType'] === 'assistant.input' && kind === 'agent';
    });
    expect(agentInput?.['display']).toBe(true);
    expect(agentInput?.['content']).toBe('Hello from agent');
    expect((agentInput?.['details'] as Record<string, unknown> | undefined)?.['fromAgentId']).toBe('agent-a');
    expect((agentInput?.['details'] as Record<string, unknown> | undefined)?.['fromSessionId']).toBe('sess-a');

    const callbackInput = customEntries.find((entry) => {
      const details = entry['details'];
      const kind = details && typeof details === 'object' ? (details as Record<string, unknown>)['kind'] : undefined;
      return entry['customType'] === 'assistant.input' && kind === 'callback';
    });
    expect(callbackInput?.['display']).toBe(false);
    expect(callbackInput?.['content']).toBe('Hidden callback input');

    const userMessageEntries = entries
      .filter((entry) => entry['type'] === 'message')
      .map((entry) => entry['message'] as Record<string, unknown> | undefined)
      .filter(Boolean)
      .filter((message) => message?.['role'] === 'user');
    expect(userMessageEntries.length).toBe(0);
  });

  it('counts assistant.input entries when resuming to avoid duplicate writes', async () => {
    const baseDir = await createTempDir('pi-session-writer-resume');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-3',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'system' },
      {
        role: 'user',
        content: 'Hello from agent',
        meta: { source: 'agent', fromAgentId: 'agent-a', fromSessionId: 'sess-a', visibility: 'visible' },
      },
      { role: 'assistant', content: 'Ack' },
    ];

    await writer.sync({
      summary,
      messages,
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);
    const filePath = path.join(sessionDir, files[0]!);
    const first = await fs.readFile(filePath, 'utf8');

    // Simulate a restart by constructing a fresh writer instance.
    const writer2 = new PiSessionWriter({ baseDir, now });
    await writer2.sync({
      summary,
      messages,
    });

    const second = await fs.readFile(filePath, 'utf8');
    expect(second).toBe(first);
  });

  it('appends assistant.event custom entries without affecting message sync', async () => {
    const baseDir = await createTempDir('pi-session-writer-custom');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-4',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    await writer.sync({
      summary,
      messages: [{ role: 'system', content: 'system' }, { role: 'assistant', content: 'Hello' }],
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    await writer.appendAssistantEvent({
      summary,
      eventType: 'interrupt',
      payload: { reason: 'user_cancel' },
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    const last = entries[entries.length - 1] as Record<string, unknown> | undefined;
    expect(last?.['type']).toBe('custom');
    expect(last?.['customType']).toBe('assistant.event');
    expect((last?.['data'] as Record<string, unknown> | undefined)?.['chatEventType']).toBe('interrupt');
  });

  it('appends session_info entries after the session is flushed', async () => {
    const baseDir = await createTempDir('pi-session-writer-session-info');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-6',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    await writer.sync({
      summary,
      messages: [{ role: 'system', content: 'system' }, { role: 'assistant', content: 'Hello' }],
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    await writer.appendSessionInfo({ summary, name: '  Refactor auth module  ' });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);

    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    const last = entries[entries.length - 1] as Record<string, unknown> | undefined;
    expect(last?.['type']).toBe('session_info');
    expect(last?.['name']).toBe('Refactor auth module');
  });

  it('queues session_info entries before flush and writes them once an assistant message exists', async () => {
    const baseDir = await createTempDir('pi-session-writer-session-info-pending');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-7',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    await writer.appendSessionInfo({ summary, name: '' });
    await writer.appendSessionInfo({ summary, name: 'New Name' });

    await writer.sync({
      summary,
      messages: [{ role: 'system', content: 'system' }, { role: 'assistant', content: 'Hello' }],
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);

    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    const sessionInfoEntries = entries.filter((entry) => entry['type'] === 'session_info');
    expect(sessionInfoEntries).toHaveLength(2);
    expect(sessionInfoEntries[0]?.['name']).toBe('');
    expect(sessionInfoEntries[1]?.['name']).toBe('New Name');

    const firstNonHeader = entries[1] as Record<string, unknown> | undefined;
    expect(firstNonHeader?.['type']).toBe('session_info');
  });

  it('replaces orphan tool results with a non-breaking placeholder and avoids duplicate writes on restart', async () => {
    const baseDir = await createTempDir('pi-session-writer-orphan-tool');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-5',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Ack' },
      {
        role: 'tool',
        tool_call_id: 'call-orphan-1',
        content: JSON.stringify({ ok: true, result: 'orphan tool output' }),
      },
    ];

    await writer.sync({
      summary,
      messages,
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);
    const filePath = path.join(sessionDir, files[0]!);
    const first = await fs.readFile(filePath, 'utf8');

    const entries = parseJsonLines(first);
    const orphanPlaceholder = entries.find(
      (entry) => entry['type'] === 'custom_message' && entry['customType'] === 'assistant.orphan_tool_result',
    );
    expect(orphanPlaceholder).toBeTruthy();
    expect(orphanPlaceholder?.['display']).toBe(false);

    const toolResultEntries = entries.filter((entry) => {
      if (entry['type'] !== 'message') return false;
      const message = entry['message'];
      return message && typeof message === 'object' && (message as Record<string, unknown>)['role'] === 'toolResult';
    });
    expect(toolResultEntries.length).toBe(0);

    // Simulate a restart by constructing a fresh writer instance; file should be unchanged.
    const writer2 = new PiSessionWriter({ baseDir, now });
    await writer2.sync({ summary, messages });
    const second = await fs.readFile(filePath, 'utf8');
    expect(second).toBe(first);
  });
});
