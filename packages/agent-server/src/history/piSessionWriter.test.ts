import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AssistantMessage } from '@mariozechner/pi-ai';

import { AgentRegistry } from '../agents';
import type { ChatCompletionMessage } from '../chatCompletionTypes';
import type { SessionSummary } from '../sessionIndex';
import { buildChatMessagesFromEvents } from '../sessionChatMessages';
import { PiSessionHistoryProvider } from './historyProvider';
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
      timestamp: 1769904000010,
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

  it('writes replayable assistant text signatures for reconstructed assistant text messages', async () => {
    const baseDir = await createTempDir('pi-session-writer-signatures');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-signatures',
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
      {
        role: 'assistant',
        content: 'Internal note',
        assistantTextPhase: 'commentary',
        assistantTextSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
      },
      {
        role: 'assistant',
        content: 'Visible answer',
        assistantTextPhase: 'final_answer',
        assistantTextSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
      },
    ];

    await writer.sync({
      summary,
      messages,
      modelSpec: 'openai/gpt-4.1',
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
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    const assistantMessages = entries
      .filter((entry) => entry['type'] === 'message')
      .map((entry) => entry['message'] as AssistantMessage | Record<string, unknown> | undefined)
      .filter(
        (message): message is AssistantMessage =>
          Boolean(message) &&
          typeof message === 'object' &&
          'role' in message &&
          message.role === 'assistant',
      );

    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]?.content[0]).toMatchObject({
      type: 'text',
      text: 'Internal note',
      textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
    });
    expect(assistantMessages[1]?.content[0]).toMatchObject({
      type: 'text',
      text: 'Visible answer',
      textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
    });
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

  it('realigns resumed writes when replay omits an earlier assistant.input entry', async () => {
    const baseDir = await createTempDir('pi-session-writer-realign');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-3b',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        {
          role: 'user',
          content: '[Callback from agent]: <questionnaire-response />',
          meta: { source: 'callback', fromSessionId: 'sess-a', visibility: 'visible' },
        },
        {
          role: 'user',
          content: '<questionnaire-response />',
          meta: { source: 'callback', fromSessionId: 'sess-a', visibility: 'hidden' },
        },
        { role: 'assistant', content: 'Earlier assistant reply' },
      ],
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    const writer2 = new PiSessionWriter({ baseDir, now });
    await writer2.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        {
          role: 'user',
          content: '[Callback from agent]: <questionnaire-response />',
          meta: { source: 'callback', fromSessionId: 'sess-a', visibility: 'visible' },
        },
        { role: 'assistant', content: 'Earlier assistant reply' },
        { role: 'user', content: 'follow-up one' },
        { role: 'user', content: 'follow-up two' },
        { role: 'assistant', content: 'New assistant reply' },
      ],
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);
    const filePath = path.join(sessionDir, files[0]!);
    const entries = parseJsonLines(await fs.readFile(filePath, 'utf8'));

    const customEntries = entries.filter(
      (entry) => entry['type'] === 'custom_message' && entry['customType'] === 'assistant.input',
    );
    expect(customEntries).toHaveLength(2);

    const assistantTexts = entries
      .filter((entry) => entry['type'] === 'message')
      .map((entry) => entry['message'] as Record<string, unknown> | undefined)
      .filter(
        (message): message is Record<string, unknown> =>
          message !== undefined && message['role'] === 'assistant',
      )
      .map((message) => {
        const contentBlocks = Array.isArray(message['content']) ? message['content'] : [];
        return contentBlocks
          .filter((block): block is Record<string, unknown> => !!block && typeof block === 'object')
          .filter((block) => block['type'] === 'text')
          .map((block) => block['text'])
          .filter((text): text is string => typeof text === 'string')
          .join('\n');
      });

    expect(assistantTexts.filter((text) => text === 'Earlier assistant reply')).toHaveLength(1);
    expect(assistantTexts).toContain('New assistant reply');

    const userTexts = entries
      .filter((entry) => entry['type'] === 'message')
      .map((entry) => entry['message'] as Record<string, unknown> | undefined)
      .filter(
        (message): message is Record<string, unknown> =>
          message !== undefined && message['role'] === 'user',
      )
      .flatMap((message) => {
        const contentBlocks = Array.isArray(message['content']) ? message['content'] : [];
        return contentBlocks
          .filter((block): block is Record<string, unknown> => !!block && typeof block === 'object')
          .map((block) => block['text'])
          .filter((text): text is string => typeof text === 'string');
      });

    expect(userTexts).toContain('follow-up one');
    expect(userTexts).toContain('follow-up two');
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

  it('appends explicit request boundary entries', async () => {
    const baseDir = await createTempDir('pi-session-writer-request-boundaries');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-1',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });
    await writer.sync({
      summary,
      messages: [{ role: 'system', content: 'system' }, { role: 'assistant', content: 'Hello' }],
    });
    await writer.appendTurnEnd({ summary, turnId: 'turn-1', status: 'completed' });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    const requestStart = entries.find(
      (entry) => entry['type'] === 'custom' && entry['customType'] === 'assistant.request_start',
    ) as Record<string, unknown> | undefined;
    const requestEnd = entries.find(
      (entry) => entry['type'] === 'custom' && entry['customType'] === 'assistant.request_end',
    ) as Record<string, unknown> | undefined;

    expect((requestStart?.['data'] as Record<string, unknown> | undefined)?.['v']).toBe(1);
    expect((requestStart?.['data'] as Record<string, unknown> | undefined)?.['requestId']).toBe(
      'turn-1',
    );
    expect((requestStart?.['data'] as Record<string, unknown> | undefined)?.['trigger']).toBe(
      'user',
    );
    expect((requestEnd?.['data'] as Record<string, unknown> | undefined)?.['v']).toBe(1);
    expect((requestEnd?.['data'] as Record<string, unknown> | undefined)?.['requestId']).toBe(
      'turn-1',
    );
    expect((requestEnd?.['data'] as Record<string, unknown> | undefined)?.['status']).toBe(
      'completed',
    );
  });

  it('creates the Pi session file immediately on request start before assistant output exists', async () => {
    const baseDir = await createTempDir('pi-session-writer-eager-file');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-eager',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-eager',
      trigger: 'user',
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
    expect(files).toHaveLength(1);

    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    expect(entries[0]?.['type']).toBe('session');
    const requestStart = entries.find(
      (entry) => entry['type'] === 'custom' && entry['customType'] === 'assistant.request_start',
    ) as Record<string, unknown> | undefined;
    expect((requestStart?.['data'] as Record<string, unknown> | undefined)?.['requestId']).toBe(
      'turn-eager',
    );
  });

  it('repairs an unterminated persisted request before starting the next one', async () => {
    const baseDir = await createTempDir('pi-session-writer-request-repair');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-2',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });
    await writer.sync({
      summary,
      messages: [{ role: 'system', content: 'system' }, { role: 'assistant', content: 'Hello' }],
    });

    const writer2 = new PiSessionWriter({ baseDir, now });
    await writer2.appendTurnStart({
      summary,
      turnId: 'turn-2',
      trigger: 'user',
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);
    const boundaries = entries.filter(
      (entry) =>
        entry['type'] === 'custom' &&
        (entry['customType'] === 'assistant.request_start' ||
          entry['customType'] === 'assistant.request_end'),
    );

    expect(boundaries).toHaveLength(3);
    expect((boundaries[0]?.['data'] as Record<string, unknown> | undefined)?.['requestId']).toBe(
      'turn-1',
    );
    expect((boundaries[1]?.['data'] as Record<string, unknown> | undefined)?.['requestId']).toBe(
      'turn-1',
    );
    expect((boundaries[1]?.['data'] as Record<string, unknown> | undefined)?.['status']).toBe(
      'interrupted',
    );
    expect((boundaries[2]?.['data'] as Record<string, unknown> | undefined)?.['requestId']).toBe(
      'turn-2',
    );
  });

  it('rewrites Pi history when trimming turns before an anchor', async () => {
    const baseDir = await createTempDir('pi-session-writer-turn-trim-before');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-trim-before',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };
    const updateAttributes = async (patch: Record<string, unknown>) => {
      summary.attributes = {
        ...(summary.attributes ?? {}),
        ...(patch as Record<string, unknown>),
      } as NonNullable<SessionSummary['attributes']>;
      return summary;
    };

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes,
    });
    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
      ],
      updateAttributes,
    });
    await writer.appendTurnEnd({
      summary,
      turnId: 'turn-1',
      status: 'completed',
      updateAttributes,
    });

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-2',
      trigger: 'user',
      updateAttributes,
    });
    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
        { role: 'user', content: 'second turn' },
        { role: 'assistant', content: 'Second reply' },
      ],
      updateAttributes,
    });
    await writer.appendTurnEnd({
      summary,
      turnId: 'turn-2',
      status: 'completed',
      updateAttributes,
    });

    const result = await writer.rewriteHistoryByRequest({
      summary,
      action: 'trim_before',
      requestId: 'turn-2',
      updateAttributes,
    });

    expect(result.changed).toBe(true);
    expect(result.droppedRequestIds).toEqual(['turn-1']);

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    expect(JSON.stringify(entries)).not.toContain('turn-1');
    expect(JSON.stringify(entries)).toContain('turn-2');
    expect(JSON.stringify(entries)).not.toContain('first turn');
    expect(JSON.stringify(entries)).toContain('second turn');
    expect(entries[1]?.['parentId']).toBeNull();
  });

  it('rewrites Pi history when deleting a specific request', async () => {
    const baseDir = await createTempDir('pi-session-writer-delete-turn');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-delete',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };
    const updateAttributes = async (patch: Record<string, unknown>) => {
      summary.attributes = {
        ...(summary.attributes ?? {}),
        ...(patch as Record<string, unknown>),
      } as NonNullable<SessionSummary['attributes']>;
      return summary;
    };

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes,
    });
    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
      ],
      updateAttributes,
    });
    await writer.appendTurnEnd({ summary, turnId: 'turn-1', status: 'completed', updateAttributes });

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-2',
      trigger: 'user',
      updateAttributes,
    });
    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
        { role: 'user', content: 'second turn' },
        { role: 'assistant', content: 'Second reply' },
      ],
      updateAttributes,
    });
    await writer.appendTurnEnd({ summary, turnId: 'turn-2', status: 'completed', updateAttributes });

    const result = await writer.rewriteHistoryByRequest({
      summary,
      action: 'delete_request',
      requestId: 'turn-1',
      updateAttributes,
    });

    expect(result.changed).toBe(true);
    expect(result.droppedRequestIds).toEqual(['turn-1']);

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');

    expect(content).not.toContain('first turn');
    expect(content).toContain('second turn');
    expect(content).not.toContain('"requestId":"turn-1"');
    expect(content).toContain('"requestId":"turn-2"');
  });

  it('rewrites Pi history when trimming turns after an anchor inclusively', async () => {
    const baseDir = await createTempDir('pi-session-writer-turn-trim-after');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-trim-after',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };
    const updateAttributes = async (patch: Record<string, unknown>) => {
      summary.attributes = {
        ...(summary.attributes ?? {}),
        ...(patch as Record<string, unknown>),
      } as NonNullable<SessionSummary['attributes']>;
      return summary;
    };

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes,
    });
    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
      ],
      updateAttributes,
    });
    await writer.appendTurnEnd({
      summary,
      turnId: 'turn-1',
      status: 'completed',
      updateAttributes,
    });

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-2',
      trigger: 'user',
      updateAttributes,
    });
    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
        { role: 'user', content: 'second turn' },
        { role: 'assistant', content: 'Second reply' },
      ],
      updateAttributes,
    });
    await writer.appendTurnEnd({
      summary,
      turnId: 'turn-2',
      status: 'completed',
      updateAttributes,
    });

    const result = await writer.rewriteHistoryByRequest({
      summary,
      action: 'trim_after',
      requestId: 'turn-1',
      updateAttributes,
    });

    expect(result.changed).toBe(true);
    expect(result.droppedRequestIds).toEqual(['turn-1', 'turn-2']);

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);

    expect(JSON.stringify(entries)).not.toContain('turn-1');
    expect(JSON.stringify(entries)).not.toContain('turn-2');
    expect(JSON.stringify(entries)).not.toContain('first turn');
    expect(JSON.stringify(entries)).not.toContain('second turn');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.['type']).toBe('session');
    expect(entries[0]).not.toHaveProperty('parentId');
  });

  it('synthesizes request groups when explicit request markers are missing', async () => {
    const baseDir = await createTempDir('pi-session-writer-request-synthetic-groups');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-missing-markers',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };
    const updateAttributes = async (patch: Record<string, unknown>) => {
      summary.attributes = {
        ...(summary.attributes ?? {}),
        ...(patch as Record<string, unknown>),
      } as NonNullable<SessionSummary['attributes']>;
      return summary;
    };

    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'legacy turn' },
        { role: 'assistant', content: 'Legacy reply' },
      ],
      updateAttributes,
    });

    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'legacy turn' },
        { role: 'assistant', content: 'Legacy reply' },
        { role: 'user', content: 'second legacy turn' },
        { role: 'assistant', content: 'Second legacy reply' },
      ],
      updateAttributes,
    });

    const sessionDir = path.join(
      baseDir,
      `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`,
    );
    const files = await fs.readdir(sessionDir);
    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content);
    const userEntries = entries.filter(
      (entry) =>
        entry['type'] === 'message' &&
        (entry['message'] as Record<string, unknown> | undefined)?.['role'] === 'user',
    );
    const requestId = userEntries[1]?.['id'] ? `synthetic-${userEntries[1]['id']}` : undefined;
    expect(requestId).toBeTruthy();

    const result = await writer.rewriteHistoryByRequest({
      summary,
      action: 'trim_before',
      requestId: requestId as string,
      updateAttributes,
    });

    expect(result.changed).toBe(true);
    expect(result.droppedRequestIds.length).toBeGreaterThan(0);
  });

  it('rejects history rewrites when the anchor request does not exist', async () => {
    const baseDir = await createTempDir('pi-session-writer-request-unknown-anchor');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-turn-unknown-anchor',
      agentId: 'pi',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };
    const updateAttributes = async (patch: Record<string, unknown>) => {
      summary.attributes = {
        ...(summary.attributes ?? {}),
        ...(patch as Record<string, unknown>),
      } as NonNullable<SessionSummary['attributes']>;
      return summary;
    };

    await writer.appendTurnStart({
      summary,
      turnId: 'turn-1',
      trigger: 'user',
      updateAttributes,
    });
    await writer.sync({
      summary,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'first turn' },
        { role: 'assistant', content: 'First reply' },
      ],
      updateAttributes,
    });
    await writer.appendTurnEnd({
      summary,
      turnId: 'turn-1',
      status: 'completed',
      updateAttributes,
    });

    await expect(
      writer.rewriteHistoryByRequest({
        summary,
        action: 'delete_request',
        requestId: 'missing-request',
        updateAttributes,
      }),
    ).rejects.toThrow('Request not found in Pi session history: missing-request');
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

  it('preserves later user turns after rebuilding prompt messages from an existing Pi session', async () => {
    const baseDir = await createTempDir('pi-session-writer-replay');
    const now = () => new Date('2026-02-01T00:00:00.000Z');
    const writer = new PiSessionWriter({ baseDir, now });

    const summary: SessionSummary = {
      sessionId: 'session-replay',
      agentId: 'assistant',
      createdAt: now().toISOString(),
      updatedAt: now().toISOString(),
      attributes: {
        core: { workingDir: '/tmp/project' },
      },
    };

    const firstToolCall: AssistantMessage = {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'lists_list',
          arguments: { limit: 10 },
        },
      ],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-5.3-codex',
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

    const secondToolCall: AssistantMessage = {
      ...firstToolCall,
      content: [
        {
          type: 'toolCall',
          id: 'call-2',
          name: 'lists_items_search',
          arguments: { query: 'now' },
        },
      ],
      timestamp: 1769904000030,
    };

    const finalAssistant: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text: 'First turn complete.' }],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-5.3-codex',
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
      stopReason: 'stop',
      timestamp: 1769904000050,
    };

    const initialMessages: ChatCompletionMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'first turn', historyTimestampMs: 1769904000000 },
      { role: 'assistant', content: '', piSdkMessage: firstToolCall },
      {
        role: 'tool',
        tool_call_id: 'call-1',
        content: JSON.stringify({ ok: true, result: [] }),
        historyTimestampMs: 1769904000020,
      },
      { role: 'assistant', content: '', piSdkMessage: secondToolCall },
      {
        role: 'tool',
        tool_call_id: 'call-2',
        content: JSON.stringify({ ok: true, result: [] }),
        historyTimestampMs: 1769904000040,
      },
      { role: 'assistant', content: 'First turn complete.', piSdkMessage: finalAssistant },
    ];

    await writer.sync({
      summary,
      messages: initialMessages,
      updateAttributes: async (patch) => {
        summary.attributes = {
          ...(summary.attributes ?? {}),
          ...(patch as Record<string, unknown>),
        } as NonNullable<SessionSummary['attributes']>;
        return summary;
      },
    });

    const historyProvider = new PiSessionHistoryProvider({ baseDir });
    const attributes = summary.attributes;
    expect(attributes).toBeDefined();
    const events = await historyProvider.getHistory({
      sessionId: summary.sessionId,
      providerId: 'pi',
      attributes: attributes!,
      force: true,
    });
    const rebuiltMessages = buildChatMessagesFromEvents(
      events,
      new AgentRegistry([]),
      summary.agentId,
      [],
    );

    const resumedWriter = new PiSessionWriter({ baseDir, now });
    await resumedWriter.sync({
      summary,
      messages: [
        ...rebuiltMessages,
        { role: 'user', content: 'second turn', historyTimestampMs: 1769904000060 },
        {
          role: 'assistant',
          content: 'Second turn complete.',
          historyTimestampMs: 1769904000070,
        },
      ],
      updateAttributes: async () => summary,
    });

    const encodedCwd = `--${'/tmp/project'.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    const files = await fs.readdir(sessionDir);
    expect(files.length).toBe(1);

    const filePath = path.join(sessionDir, files[0]!);
    const content = await fs.readFile(filePath, 'utf8');
    const entries = parseJsonLines(content)
      .filter((entry) => entry['type'] === 'message')
      .map((entry) => entry['message'] as Record<string, unknown> | undefined)
      .filter(Boolean);

    const userTexts = entries
      .filter((entry) => entry?.['role'] === 'user')
      .flatMap((entry) => {
        const contentBlocks = Array.isArray(entry?.['content']) ? entry['content'] : [];
        return contentBlocks
          .filter((block): block is Record<string, unknown> => !!block && typeof block === 'object')
          .map((block) => block['text'])
          .filter((text): text is string => typeof text === 'string');
      });

    expect(userTexts).toContain('first turn');
    expect(userTexts).toContain('second turn');
  });
});
