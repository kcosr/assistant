import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import { PiSessionHistoryProvider } from './historyProvider';
import type { AgentDefinition } from '../agents';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('PiSessionHistoryProvider', () => {
  it('maps Pi session entries into chat events', async () => {
    const baseDir = await createTempDir('pi-session-history');
    const sessionId = 'session-1';
    const piSessionId = 'pi-session-1';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom_message',
        id: 'custom-1',
        text: 'Custom payload',
        label: 'Notice',
      }),
      JSON.stringify({
        type: 'compaction',
        id: 'summary-1',
        summary: 'Summary payload',
      }),
      JSON.stringify({
        message: {
          role: 'user',
          id: 'turn-1',
          content: 'Hello there',
        },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-1',
          content: [
            { type: 'text', text: 'Hi back' },
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'ls -a' },
            },
          ],
          thinking: 'Thinking... ',
        },
      }),
      JSON.stringify({
        message: {
          role: 'toolResult',
          toolCallId: 'tool-1',
          toolName: 'bash',
          content: [{ type: 'text', text: 'output' }],
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi CLI',
      chat: {
        provider: 'pi-cli',
      },
    };

    const provider = new PiSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi-cli',
      agentId: agent.agentId,
      agent,
      attributes: {
        providers: {
          'pi-cli': {
            sessionId: piSessionId,
            cwd,
          },
        },
      },
    });

    const custom = events.find((event) => event.type === 'custom_message') as
      | Extract<ChatEvent, { type: 'custom_message' }>
      | undefined;
    expect(custom?.payload.text).toBe('Custom payload');
    expect(custom?.payload.label).toBe('Notice');

    const summary = events.find((event) => event.type === 'summary_message') as
      | Extract<ChatEvent, { type: 'summary_message' }>
      | undefined;
    expect(summary?.payload.text).toBe('Summary payload');
    expect(summary?.payload.summaryType).toBe('compaction');

    const user = events.find((event) => event.type === 'user_message') as
      | Extract<ChatEvent, { type: 'user_message' }>
      | undefined;
    expect(user?.payload.text).toBe('Hello there');

    const assistant = events.find((event) => event.type === 'assistant_done') as
      | Extract<ChatEvent, { type: 'assistant_done' }>
      | undefined;
    expect(assistant?.payload.text).toBe('Hi back');

    const thinking = events.find((event) => event.type === 'thinking_done') as
      | Extract<ChatEvent, { type: 'thinking_done' }>
      | undefined;
    expect(thinking?.payload.text).toBe('Thinking... ');

    const toolCall = events.find((event) => event.type === 'tool_call') as
      | Extract<ChatEvent, { type: 'tool_call' }>
      | undefined;
    expect(toolCall?.payload.toolCallId).toBe('tool-1');
    expect(toolCall?.payload.toolName).toBe('bash');
    expect(toolCall?.payload.args).toEqual({ command: 'ls -a' });

    const toolResult = events.find((event) => event.type === 'tool_result') as
      | Extract<ChatEvent, { type: 'tool_result' }>
      | undefined;
    expect(toolResult?.payload.toolCallId).toBe('tool-1');
    expect(Array.isArray(toolResult?.payload.result)).toBe(true);
  });

  it('treats sessions with provider metadata as external history', async () => {
    const provider = new PiSessionHistoryProvider({});

    const shouldPersist = provider.shouldPersist?.({
      sessionId: 'session-1',
      providerId: 'pi-cli',
      attributes: {
        providers: {
          'pi-cli': {
            sessionId: 'pi-session-1',
            cwd: '/home/kevin',
          },
        },
      },
    });

    expect(shouldPersist).toBe(false);
    const fallback = provider.shouldPersist?.({
      sessionId: 'session-2',
      providerId: 'pi-cli',
      attributes: {},
    });
    expect(fallback).toBe(true);
  });
});
