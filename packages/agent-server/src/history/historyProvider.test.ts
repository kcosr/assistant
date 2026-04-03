import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import {
  ClaudeSessionHistoryProvider,
  CodexSessionHistoryProvider,
  loadCanonicalPiTranscriptEvents,
} from './historyProvider';
import type { EventStore } from '../events';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

describe('canonical Pi transcript loader', () => {
  it('projects canonical Pi session entries directly into transcript events', async () => {
    const baseDir = await createTempDir('pi-session-transcript');
    const sessionId = 'session-transcript-1';
    const piSessionId = 'pi-session-transcript-1';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        id: 'req-start',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'request-1', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-user',
        timestamp: '2026-01-18T00:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello there' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-assistant',
        timestamp: '2026-01-18T00:00:02.000Z',
        message: {
          role: 'assistant',
          id: 'resp-1',
          content: [{ type: 'text', text: 'hi back' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'req-end',
        timestamp: '2026-01-18T00:00:03.000Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'request-1', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const events = await loadCanonicalPiTranscriptEvents({
      sessionId,
      revision: 7,
      providerId: 'pi',
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd },
        },
      },
      baseDir,
    });

    expect(events).toEqual([
      expect.objectContaining({
        revision: 7,
        sequence: 0,
        requestId: 'request-1',
        kind: 'request_start',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      }),
      expect.objectContaining({
        revision: 7,
        sequence: 1,
        requestId: 'request-1',
        kind: 'user_message',
        chatEventType: 'user_message',
        payload: { text: 'hello there' },
      }),
      expect.objectContaining({
        revision: 7,
        sequence: 2,
        requestId: 'request-1',
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        payload: { text: 'hi back' },
      }),
      expect.objectContaining({
        revision: 7,
        sequence: 3,
        requestId: 'request-1',
        kind: 'request_end',
        chatEventType: 'turn_end',
        payload: {},
      }),
    ]);
  });

  it('keeps the visible user message when both overlay and canonical Pi user entries exist', async () => {
    const baseDir = await createTempDir('pi-session-transcript-user-dedupe');
    const sessionId = 'session-transcript-user-dedupe';
    const piSessionId = 'pi-session-transcript-user-dedupe';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        id: 'req-start',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'request-1', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'user-overlay',
        timestamp: '2026-01-18T00:00:00.100Z',
        customType: 'assistant.user_message',
        data: { payload: { text: 'hello there' }, turnId: 'request-1' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-user',
        timestamp: '2026-01-18T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'hello there' }],
          timestamp: 1737158400100,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-assistant',
        timestamp: '2026-01-18T00:00:02.000Z',
        message: {
          role: 'assistant',
          id: 'resp-1',
          content: [{ type: 'text', text: 'hi back' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'req-end',
        timestamp: '2026-01-18T00:00:03.000Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'request-1', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const events = await loadCanonicalPiTranscriptEvents({
      sessionId,
      revision: 7,
      providerId: 'pi',
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd },
        },
      },
      baseDir,
    });

    const userEvents = events.filter((event) => event.kind === 'user_message');
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]).toEqual(
      expect.objectContaining({
        requestId: 'request-1',
        chatEventType: 'user_message',
        payload: { text: 'hello there' },
      }),
    );
  });

  it('prefers the complete Pi session reference when the pi-cli alias only stores transcript revision', async () => {
    const baseDir = await createTempDir('pi-session-transcript-provider-alias');
    const sessionId = 'session-transcript-provider-alias';
    const piSessionId = 'pi-session-transcript-provider-alias';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        id: 'req-start',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'request-1', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-user',
        timestamp: '2026-01-18T00:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello there' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-assistant',
        timestamp: '2026-01-18T00:00:02.000Z',
        message: {
          role: 'assistant',
          id: 'resp-1',
          content: [{ type: 'text', text: 'hi back' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'req-end',
        timestamp: '2026-01-18T00:00:03.000Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'request-1', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const events = await loadCanonicalPiTranscriptEvents({
      sessionId,
      revision: 2,
      providerId: 'pi',
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd, transcriptRevision: 2 },
          'pi-cli': { transcriptRevision: 2 },
        },
      },
      baseDir,
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: 'request-1',
          kind: 'request_start',
        }),
        expect.objectContaining({
          requestId: 'request-1',
          kind: 'user_message',
          payload: { text: 'hello there' },
        }),
        expect.objectContaining({
          requestId: 'request-1',
          kind: 'assistant_message',
          payload: { text: 'hi back' },
        }),
      ]),
    );
  });

  it('does not reset the active response when a duplicate request_start is replayed', async () => {
    const baseDir = await createTempDir('pi-session-transcript-duplicate-request-start');
    const sessionId = 'session-transcript-duplicate-request-start';
    const piSessionId = 'pi-session-transcript-duplicate-request-start';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        id: 'req-start-1',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'request-1', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-user',
        timestamp: '2026-01-18T00:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello there' }] },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-msg',
        timestamp: '2026-01-18T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Starting work' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'req-start-duplicate',
        timestamp: '2026-01-18T00:00:02.500Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'request-1', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'tool-call-overlay',
        timestamp: '2026-01-18T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'tool-1',
              name: 'bash',
              arguments: { command: 'pwd' },
            },
          ],
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const events = await loadCanonicalPiTranscriptEvents({
      sessionId,
      revision: 7,
      providerId: 'pi',
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd },
        },
      },
      baseDir,
    });

    const requestStarts = events.filter((event) => event.kind === 'request_start');
    expect(requestStarts).toHaveLength(1);

    const assistantMessage = events.find((event) => event.kind === 'assistant_message');
    const toolCall = events.find((event) => event.kind === 'tool_call');
    expect(assistantMessage?.responseId).toEqual(expect.any(String));
    expect(toolCall).toEqual(
      expect.objectContaining({
        requestId: 'request-1',
        responseId: assistantMessage?.responseId,
        payload: expect.objectContaining({
          toolCallId: 'tool-1',
          toolName: 'bash',
        }),
      }),
    );
  });

  it('orders canonical assistant narration before earlier-appended tool overlay in transcript replay', async () => {
    const baseDir = await createTempDir('pi-session-transcript-replay-order');
    const sessionId = 'session-transcript-replay-order';
    const piSessionId = 'pi-session-transcript-replay-order';
    const cwd = '/home/kevin/assistant';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-03-31T14-21-05-772Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        id: 'req-start',
        timestamp: '2026-03-31T14:46:13.150Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'request-worktree', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'tool-call-overlay',
        timestamp: '2026-03-31T14:46:16.782Z',
        customType: 'assistant.tool_call',
        data: {
          turnId: 'request-worktree',
          responseId: 'resp-worktree',
          payload: {
            toolCallId: 'tool-worktree',
            toolName: 'bash',
            args: { command: 'git worktree add ...' },
          },
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'tool-result-overlay',
        timestamp: '2026-03-31T14:46:16.942Z',
        customType: 'assistant.tool_result',
        data: {
          turnId: 'request-worktree',
          responseId: 'resp-worktree',
          payload: {
            toolCallId: 'tool-worktree',
            result: { ok: true, output: 'created' },
          },
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'assistant-msg',
        timestamp: '2026-03-31T14:46:24.756Z',
        message: {
          role: 'assistant',
          id: 'resp-worktree',
          timestamp: '2026-03-31T14:46:13.160Z',
          content: [
            { type: 'text', text: 'The repo is ready. Creating the worktree now:' },
            {
              type: 'toolCall',
              id: 'tool-worktree',
              name: 'bash',
              arguments: { command: 'git worktree add ...' },
            },
          ],
          stopReason: 'toolUse',
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'req-end',
        timestamp: '2026-03-31T14:46:24.900Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'request-worktree', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const projected = await loadCanonicalPiTranscriptEvents({
      sessionId,
      revision: 2,
      providerId: 'pi',
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd },
        },
      },
      baseDir,
    });

    const assistantIndex = projected.findIndex(
      (event) =>
        event.chatEventType === 'assistant_done' &&
        event.requestId === 'request-worktree' &&
        event.payload['text'] === 'The repo is ready. Creating the worktree now:',
    );
    const toolCallIndex = projected.findIndex(
      (event) =>
        event.chatEventType === 'tool_call' &&
        event.requestId === 'request-worktree' &&
        event.toolCallId === 'tool-worktree',
    );
    const toolResultIndex = projected.findIndex(
      (event) =>
        event.chatEventType === 'tool_result' &&
        event.requestId === 'request-worktree' &&
        event.toolCallId === 'tool-worktree',
    );

    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeLessThan(toolCallIndex);
    expect(assistantIndex).toBeLessThan(toolResultIndex);
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

  it('keeps the turn open when Codex history ends on an in-progress tool call', async () => {
    const baseDir = await createTempDir('codex-session-history-open-tool');
    const sessionId = 'session-open-tool';
    const codexSessionId = 'codex-session-open-tool';
    const sessionDir = path.join(baseDir, '2026', '01', '18');
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(
      sessionDir,
      `rollout-2026-01-18T00-00-00-000Z-${codexSessionId}.jsonl`,
    );
    const lines = [
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'user_message', message: 'sleep 10' },
        timestamp: '2026-01-01T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          arguments: '{"command":"sleep 10"}',
          call_id: 'call-open',
        },
        timestamp: '2026-01-01T00:00:02.000Z',
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

    expect(
      events.some((event) => event.type === 'tool_call' && event.payload.toolCallId === 'call-open'),
    ).toBe(true);
    expect(events.some((event) => event.type === 'turn_end')).toBe(false);
  });

  it('aligns overlay interactions with matching tool calls', async () => {
    const baseDir = await createTempDir('codex-session-overlay');
    const sessionId = 'session-overlay';
    const codexSessionId = 'codex-session-overlay';
    const sessionDir = path.join(baseDir, '2026', '01', '19');
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(
      sessionDir,
      `rollout-2026-01-19T00-00-00-000Z-${codexSessionId}.jsonl`,
    );
    const lines = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          arguments: '{"command":"ls"}',
          call_id: 'call-overlay',
        },
        timestamp: 1000,
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: 'Done',
        },
        timestamp: 2000,
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const overlayEvent: ChatEvent = {
      id: 'interaction-overlay',
      timestamp: 3000,
      sessionId,
      type: 'interaction_request',
      payload: {
        toolCallId: 'call-overlay',
        toolName: 'questions_ask',
        interactionId: 'interaction-overlay',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'Quick question',
          fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
        },
      },
    };

    const eventStore: EventStore = {
      append: async () => undefined,
      appendBatch: async () => undefined,
      getEvents: async () => [overlayEvent],
      getEventsSince: async () => [overlayEvent],
      subscribe: () => () => undefined,
      clearSession: async () => undefined,
      deleteSession: async () => undefined,
    };

    const provider = new CodexSessionHistoryProvider({ baseDir, eventStore });
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

    const toolIndex = events.findIndex(
      (event) => event.type === 'tool_call' && event.payload.toolCallId === 'call-overlay',
    );
    const interactionIndex = events.findIndex(
      (event) => event.type === 'interaction_request' && event.payload.toolCallId === 'call-overlay',
    );
    const assistantIndex = events.findIndex((event) => event.type === 'assistant_done');

    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(interactionIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeLessThan(interactionIndex);
    expect(interactionIndex).toBeLessThan(assistantIndex);

    const toolCall = events[toolIndex] as Extract<ChatEvent, { type: 'tool_call' }>;
    const interaction = events[interactionIndex] as Extract<
      ChatEvent,
      { type: 'interaction_request' }
    >;
    expect(interaction.turnId).toBe(toolCall.turnId);
    expect(interaction.responseId).toBe(toolCall.responseId);
  });

  it('aligns overlay interactions by command when toolCallId differs', async () => {
    const baseDir = await createTempDir('codex-session-overlay-command');
    const sessionId = 'session-overlay-command';
    const codexSessionId = 'codex-session-command';
    const sessionDir = path.join(baseDir, '2026', '01', '24');
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(
      sessionDir,
      `rollout-2026-01-24T00-00-00-000Z-${codexSessionId}.jsonl`,
    );
    const lines = [
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'shell_command',
          arguments:
            '{"command":"/home/kevin/skills/personal/private/assistant/questions/questions-cli ask --prompt \\"Test questionnaire\\" --schema \\"{}\\""}',
          call_id: 'call-command',
        },
        timestamp: 1000,
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: 'Done',
        },
        timestamp: 2000,
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const overlayEvent: ChatEvent = {
      id: 'interaction-command',
      timestamp: 3000,
      sessionId,
      type: 'interaction_request',
      payload: {
        toolCallId: 'overlay-id',
        toolName: 'questions_ask',
        interactionId: 'interaction-command',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'Quick question',
          fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
        },
      },
    };

    const eventStore: EventStore = {
      append: async () => undefined,
      appendBatch: async () => undefined,
      getEvents: async () => [overlayEvent],
      getEventsSince: async () => [overlayEvent],
      subscribe: () => () => undefined,
      clearSession: async () => undefined,
      deleteSession: async () => undefined,
    };

    const provider = new CodexSessionHistoryProvider({ baseDir, eventStore });
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

    const toolIndex = events.findIndex(
      (event) => event.type === 'tool_call' && event.payload.toolCallId === 'call-command',
    );
    const interactionIndex = events.findIndex(
      (event) =>
        event.type === 'interaction_request' && event.payload.toolCallId === 'overlay-id',
    );
    const assistantIndex = events.findIndex((event) => event.type === 'assistant_done');

    expect(toolIndex).toBeGreaterThanOrEqual(0);
    expect(interactionIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeLessThan(interactionIndex);
    expect(interactionIndex).toBeLessThan(assistantIndex);

    const toolCall = events[toolIndex] as Extract<ChatEvent, { type: 'tool_call' }>;
    const interaction = events[interactionIndex] as Extract<
      ChatEvent,
      { type: 'interaction_request' }
    >;
    expect(interaction.turnId).toBe(toolCall.turnId);
    expect(interaction.responseId).toBe(toolCall.responseId);
  });

  it('dedupes completed overlay turns against Codex provider replay even when turn ids differ', async () => {
    const baseDir = await createTempDir('codex-session-overlay-dedupe');
    const sessionId = 'session-overlay-dedupe';
    const codexSessionId = 'codex-session-overlay-dedupe';
    const sessionDir = path.join(baseDir, '2026', '01', '25');
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(
      sessionDir,
      `rollout-2026-01-25T00-00-00-000Z-${codexSessionId}.jsonl`,
    );
    const lines = [
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'task_started', turn_id: 'provider-turn-1' },
        timestamp: '2026-01-25T00:00:01.000Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
        timestamp: '2026-01-25T00:00:01.100Z',
      }),
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hi' }],
          phase: 'final_answer',
        },
        timestamp: '2026-01-25T00:00:02.000Z',
      }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'task_complete',
          turn_id: 'provider-turn-1',
          last_agent_message: 'hi',
        },
        timestamp: '2026-01-25T00:00:02.100Z',
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const overlayEvents: ChatEvent[] = [
      {
        id: 'overlay-turn-start',
        timestamp: 1000,
        sessionId,
        turnId: 'overlay-turn-1',
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        id: 'overlay-user',
        timestamp: 1001,
        sessionId,
        turnId: 'overlay-turn-1',
        type: 'user_message',
        payload: { text: 'hi' },
      },
      {
        id: 'overlay-assistant',
        timestamp: 1002,
        sessionId,
        turnId: 'overlay-turn-1',
        responseId: 'overlay-response-1',
        type: 'assistant_done',
        payload: { text: 'hi\n\n' },
      },
      {
        id: 'overlay-turn-end',
        timestamp: 1003,
        sessionId,
        turnId: 'overlay-turn-1',
        type: 'turn_end',
        payload: {},
      },
    ];

    const eventStore: EventStore = {
      append: async () => undefined,
      appendBatch: async () => undefined,
      getEvents: async () => overlayEvents,
      getEventsSince: async () => overlayEvents,
      subscribe: () => () => undefined,
      clearSession: async () => undefined,
      deleteSession: async () => undefined,
    };

    const provider = new CodexSessionHistoryProvider({ baseDir, eventStore });
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

    expect(events.filter((event) => event.type === 'user_message')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'assistant_done')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn_start')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn_end')).toHaveLength(1);
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
