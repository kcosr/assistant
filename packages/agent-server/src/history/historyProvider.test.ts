import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import {
  ClaudeSessionHistoryProvider,
  CodexSessionHistoryProvider,
  PiSessionHistoryProvider,
} from './historyProvider';
import type { AgentDefinition } from '../agents';
import type { EventStore } from '../events';

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
            { type: 'thinking', thinking: 'Thinking... ' },
            { type: 'text', text: 'Hi back' },
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'ls -a' },
            },
          ],
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

  it('merges overlay interaction events from the event store', async () => {
    const baseDir = await createTempDir('pi-session-history');
    const sessionId = 'session-2';
    const piSessionId = 'pi-session-2';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-19T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        message: {
          role: 'user',
          id: 'turn-1',
          content: 'Hello there',
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const overlayEvent: ChatEvent = {
      id: 'interaction-1',
      timestamp: Date.now(),
      sessionId,
      type: 'interaction_request',
      payload: {
        toolCallId: 'tool-1',
        toolName: 'questions_ask',
        interactionId: 'interaction-1',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'Quick question',
          fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
        },
      },
    };
    const pendingEvent: ChatEvent = {
      id: 'interaction-pending-1',
      timestamp: Date.now(),
      sessionId,
      type: 'interaction_pending',
      payload: {
        toolCallId: 'tool-1',
        toolName: 'questions_ask',
        pending: true,
        presentation: 'questionnaire',
      },
    };

    const eventStore: EventStore = {
      append: async () => undefined,
      appendBatch: async () => undefined,
      getEvents: async () => [overlayEvent, pendingEvent],
      getEventsSince: async () => [overlayEvent, pendingEvent],
      subscribe: () => () => undefined,
      clearSession: async () => undefined,
      deleteSession: async () => undefined,
    };

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi CLI',
      chat: {
        provider: 'pi-cli',
      },
    };

    const provider = new PiSessionHistoryProvider({ baseDir, eventStore });
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

    expect(events.some((event) => event.type === 'interaction_request')).toBe(true);
    expect(events.some((event) => event.type === 'interaction_pending')).toBe(true);
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
    expect(fallback).toBe(false);
  });

  it('splits thinking blocks around tool calls', async () => {
    const baseDir = await createTempDir('pi-session-history');
    const sessionId = 'session-2';
    const piSessionId = 'pi-session-2';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-2',
          content: [
            { type: 'thinking', thinking: 'First.' },
            {
              type: 'toolCall',
              id: 'tool-2',
              name: 'bash',
              arguments: { command: 'pwd' },
            },
            { type: 'thinking', thinking: 'Second.' },
            { type: 'text', text: 'Done.' },
          ],
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = new PiSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi-cli',
      attributes: {
        providers: {
          'pi-cli': {
            sessionId: piSessionId,
            cwd,
          },
        },
      },
    });

    const thinkingEvents = events.filter(
      (event) => event.type === 'thinking_done',
    ) as Array<Extract<ChatEvent, { type: 'thinking_done' }>>;
    expect(thinkingEvents.map((event) => event.payload.text)).toEqual(['First.', 'Second.']);

    const firstThinkingIndex = events.findIndex((event) => event.type === 'thinking_done');
    const toolCallIndex = events.findIndex((event) => event.type === 'tool_call');
    const secondThinkingIndex = events.findIndex(
      (event) => event.type === 'thinking_done' && event.payload.text === 'Second.',
    );
    expect(firstThinkingIndex).toBeGreaterThan(-1);
    expect(toolCallIndex).toBeGreaterThan(-1);
    expect(secondThinkingIndex).toBeGreaterThan(-1);
    expect(firstThinkingIndex).toBeLessThan(toolCallIndex);
    expect(toolCallIndex).toBeLessThan(secondThinkingIndex);
  });
});

describe('ClaudeSessionHistoryProvider', () => {
  it('maps Claude session entries into chat events', async () => {
    const baseDir = await createTempDir('claude-session-history');
    const sessionId = 'session-1';
    const cwd = '/home/kevin/worktrees/assistant';
    const encodedCwd = cwd.replace(/[\\/:]/g, '-');
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `${sessionId}.jsonl`);
    const toolResultPayload = { output: 'output' };
    const lines = [
      JSON.stringify({
        type: 'user',
        uuid: 'user-1',
        sessionId,
        cwd,
        message: {
          role: 'user',
          content: 'Hello there',
        },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'summary',
        summary: 'Ignored summary',
        timestamp: '2026-01-01T00:00:00.500Z',
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: 'assistant-1',
        sessionId,
        message: {
          role: 'assistant',
          id: 'msg-1',
          content: [
            { type: 'thinking', thinking: 'Thinking... ' },
            { type: 'tool_use', id: 'toolu-1', name: 'bash', input: { command: 'ls -a' } },
            { type: 'text', text: 'Hi back' },
          ],
        },
        timestamp: '2026-01-01T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'user',
        uuid: 'tool-result-1',
        sessionId,
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu-1', content: 'output' }],
        },
        toolUseResult: toolResultPayload,
        timestamp: '2026-01-01T00:00:02.000Z',
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = new ClaudeSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'claude-cli',
      attributes: {
        providers: {
          'claude-cli': {
            sessionId,
            cwd,
          },
        },
      },
    });

    const userMessages = events.filter((event) => event.type === 'user_message');
    expect(userMessages).toHaveLength(1);
    const user = userMessages[0] as Extract<ChatEvent, { type: 'user_message' }>;
    expect(user.payload.text).toBe('Hello there');

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
    expect(toolCall?.payload.toolCallId).toBe('toolu-1');
    expect(toolCall?.payload.toolName).toBe('bash');
    expect(toolCall?.payload.args).toEqual({ command: 'ls -a' });

    const toolResult = events.find((event) => event.type === 'tool_result') as
      | Extract<ChatEvent, { type: 'tool_result' }>
      | undefined;
    expect(toolResult?.payload.toolCallId).toBe('toolu-1');
    expect(toolResult?.payload.result).toEqual(toolResultPayload);
  });

  it('treats sessions with provider metadata as external history', async () => {
    const provider = new ClaudeSessionHistoryProvider({});

    const shouldPersist = provider.shouldPersist?.({
      sessionId: 'session-1',
      providerId: 'claude-cli',
      attributes: {
        providers: {
          'claude-cli': {
            sessionId: 'claude-session-1',
            cwd: '/home/kevin/worktrees/assistant',
          },
        },
      },
    });

    expect(shouldPersist).toBe(false);
    const fallback = provider.shouldPersist?.({
      sessionId: 'session-2',
      providerId: 'claude-cli',
      attributes: {},
    });
    expect(fallback).toBe(false);
  });
});

describe('CodexSessionHistoryProvider', () => {
  it('maps Codex session entries into chat events', async () => {
    const baseDir = await createTempDir('codex-session-history');
    const sessionId = 'session-1';
    const codexSessionId = 'codex-session-1';
    const sessionDir = path.join(baseDir, '2026', '01', '18');
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(
      sessionDir,
      `rollout-2026-01-18T00-00-00-000Z-${codexSessionId}.jsonl`,
    );
    const lines = [
      JSON.stringify({
        type: 'session_meta',
        payload: { id: codexSessionId, cwd: '/home/kevin' },
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'Hello there' },
        timestamp: '2026-01-01T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'agent_reasoning', text: 'Thinking...' },
        timestamp: '2026-01-01T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          arguments: '{"command":"ls"}',
          call_id: 'call-1',
        },
        timestamp: '2026-01-01T00:00:03.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'function_call_output', call_id: 'call-1', output: 'ok' },
        timestamp: '2026-01-01T00:00:04.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call',
          name: 'apply_patch',
          call_id: 'call-2',
          input: '*** Begin Patch',
        },
        timestamp: '2026-01-01T00:00:05.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-2',
          output: '{"output":"Success"}',
        },
        timestamp: '2026-01-01T00:00:06.000Z',
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'agent_message', message: 'Hi back' },
        timestamp: '2026-01-01T00:00:07.000Z',
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = new CodexSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'codex-cli',
      attributes: {
        providers: {
          'codex-cli': {
            sessionId: codexSessionId,
          },
        },
      },
    });

    const user = events.find((event) => event.type === 'user_message') as
      | Extract<ChatEvent, { type: 'user_message' }>
      | undefined;
    expect(user?.payload.text).toBe('Hello there');

    const thinking = events.find((event) => event.type === 'thinking_done') as
      | Extract<ChatEvent, { type: 'thinking_done' }>
      | undefined;
    expect(thinking?.payload.text).toContain('Thinking...');

    const toolCall = events.find((event) => event.type === 'tool_call') as
      | Extract<ChatEvent, { type: 'tool_call' }>
      | undefined;
    expect(toolCall?.payload.toolCallId).toBe('call-1');
    expect(toolCall?.payload.toolName).toBe('shell_command');
    expect(toolCall?.payload.args).toEqual({ command: 'ls' });

    const customToolCall = events.find(
      (event) =>
        event.type === 'tool_call' &&
        event.payload.toolCallId === 'call-2',
    ) as Extract<ChatEvent, { type: 'tool_call' }> | undefined;
    expect(customToolCall?.payload.toolName).toBe('apply_patch');
    expect(customToolCall?.payload.args).toEqual({ input: '*** Begin Patch' });

    const toolResult = events.find((event) => event.type === 'tool_result') as
      | Extract<ChatEvent, { type: 'tool_result' }>
      | undefined;
    expect(toolResult?.payload.toolCallId).toBe('call-1');
    expect(toolResult?.payload.result).toBe('ok');

    const customToolResult = events.find(
      (event) =>
        event.type === 'tool_result' &&
        event.payload.toolCallId === 'call-2',
    ) as Extract<ChatEvent, { type: 'tool_result' }> | undefined;
    expect(customToolResult?.payload.result).toEqual({ output: 'Success' });

    const assistant = events.find((event) => event.type === 'assistant_done') as
      | Extract<ChatEvent, { type: 'assistant_done' }>
      | undefined;
    expect(assistant?.payload.text).toBe('Hi back');
  });

  it('treats sessions with provider metadata as external history', async () => {
    const provider = new CodexSessionHistoryProvider({});

    const shouldPersist = provider.shouldPersist?.({
      sessionId: 'session-1',
      providerId: 'codex-cli',
      attributes: {
        providers: {
          'codex-cli': {
            sessionId: 'codex-session-1',
          },
        },
      },
    });

    expect(shouldPersist).toBe(false);
    const fallback = provider.shouldPersist?.({
      sessionId: 'session-2',
      providerId: 'codex-cli',
      attributes: {},
    });
    expect(fallback).toBe(false);
  });
});
