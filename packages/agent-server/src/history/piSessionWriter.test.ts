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
});
