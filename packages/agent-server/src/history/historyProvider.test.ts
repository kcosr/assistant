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

  it('replays assistant extension entries (assistant.input + assistant.event)', async () => {
    const baseDir = await createTempDir('pi-session-history-ext');
    const sessionId = 'session-ext';
    const piSessionId = 'pi-session-ext';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-20T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom_message',
        id: 'input-agent-1',
        parentId: null,
        timestamp: '2026-01-20T00:00:00.000Z',
        customType: 'assistant.input',
        content: 'Hello from agent',
        display: true,
        details: { kind: 'agent', fromAgentId: 'agent-a', fromSessionId: 'sess-a' },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-1',
          content: [{ type: 'text', text: 'Hi back' }],
        },
      }),
      JSON.stringify({
        type: 'custom_message',
        id: 'input-callback-1',
        parentId: null,
        timestamp: '2026-01-20T00:00:01.000Z',
        customType: 'assistant.input',
        content: 'Hidden callback input',
        display: false,
        details: { kind: 'callback', fromAgentId: 'agent-b', fromSessionId: 'sess-b' },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-2',
          content: [{ type: 'text', text: 'Callback handled' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'event-1',
        parentId: null,
        timestamp: '2026-01-20T00:00:02.000Z',
        customType: 'assistant.event',
        data: {
          chatEventType: 'agent_callback',
          payload: {
            messageId: 'mid-1',
            fromAgentId: 'agent-a',
            fromSessionId: 'sess-a',
            result: 'Async result',
          },
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'event-interaction-1',
        parentId: null,
        timestamp: '2026-01-20T00:00:02.500Z',
        customType: 'assistant.event',
        data: {
          chatEventType: 'interaction_request',
          payload: {
            toolCallId: 'call-1',
            toolName: 'questions_ask',
            interactionId: 'interaction-1',
            interactionType: 'input',
            presentation: 'questionnaire',
            inputSchema: {
              title: 'Quick question',
              fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
            },
          },
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'event-partial-1',
        parentId: null,
        timestamp: '2026-01-20T00:00:02.750Z',
        customType: 'assistant.event',
        data: {
          chatEventType: 'assistant_done',
          payload: {
            text: 'Interrupted partial',
            interrupted: true,
          },
          responseId: 'resp-2',
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'event-2',
        parentId: null,
        timestamp: '2026-01-20T00:00:03.000Z',
        customType: 'assistant.event',
        data: {
          chatEventType: 'interrupt',
          payload: { reason: 'user_cancel' },
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi',
      chat: {
        provider: 'pi',
      },
    };

    const provider = new PiSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      agentId: agent.agentId,
      agent,
      attributes: {
        providers: {
          pi: {
            sessionId: piSessionId,
            cwd,
          },
        },
      },
    });

    const agentInput = events.find(
      (event) => event.type === 'user_message' && event.payload.text === 'Hello from agent',
    ) as Extract<ChatEvent, { type: 'user_message' }> | undefined;
    expect(agentInput?.payload.fromAgentId).toBe('agent-a');
    expect(agentInput?.payload.fromSessionId).toBe('sess-a');

    const callbackInput = events.find(
      (event) => event.type === 'agent_message' && event.payload.message === 'Hidden callback input',
    ) as Extract<ChatEvent, { type: 'agent_message' }> | undefined;
    expect(callbackInput).toBeDefined();

    const callbackEvent = events.find((event) => event.type === 'agent_callback') as
      | Extract<ChatEvent, { type: 'agent_callback' }>
      | undefined;
    expect(callbackEvent?.payload.messageId).toBe('mid-1');
    expect(callbackEvent?.payload.result).toBe('Async result');

    const interruptEvent = events.find((event) => event.type === 'interrupt') as
      | Extract<ChatEvent, { type: 'interrupt' }>
      | undefined;
    expect(interruptEvent?.payload.reason).toBe('user_cancel');

    const interruptedAssistant = events.find(
      (event) => event.type === 'assistant_done' && event.payload.text === 'Interrupted partial',
    ) as Extract<ChatEvent, { type: 'assistant_done' }> | undefined;
    expect(interruptedAssistant?.payload).toMatchObject({
      text: 'Interrupted partial',
      interrupted: true,
    });

    const interactionEvent = events.find((event) => event.type === 'interaction_request') as
      | Extract<ChatEvent, { type: 'interaction_request' }>
      | undefined;
    expect(interactionEvent?.payload.toolCallId).toBe('call-1');
  });

  it('uses explicit Pi turn markers as authoritative turn boundaries', async () => {
    const baseDir = await createTempDir('pi-session-history-turn-markers');
    const sessionId = 'session-marked';
    const piSessionId = 'pi-session-marked';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-21T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        id: 'turn-start-1',
        parentId: null,
        timestamp: '2026-01-21T00:00:00.000Z',
        customType: 'assistant.turn_start',
        data: { v: 1, turnId: 'turn-explicit-1', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-user-1',
        parentId: 'turn-start-1',
        timestamp: '2026-01-21T00:00:01.000Z',
        message: { role: 'user', id: 'ignored-user-id', content: 'Hello there' },
      }),
      JSON.stringify({
        type: 'message',
        id: 'msg-assistant-1',
        parentId: 'msg-user-1',
        timestamp: '2026-01-21T00:00:02.000Z',
        message: {
          role: 'assistant',
          id: 'ignored-assistant-id',
          content: [{ type: 'text', text: 'Hi back' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'turn-end-1',
        parentId: 'msg-assistant-1',
        timestamp: '2026-01-21T00:00:03.000Z',
        customType: 'assistant.turn_end',
        data: { v: 1, turnId: 'turn-explicit-1', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi',
      chat: { provider: 'pi' },
    };

    const provider = new PiSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      agentId: agent.agentId,
      agent,
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd },
        },
      },
    });

    const turnStarts = events.filter((event) => event.type === 'turn_start');
    const turnEnds = events.filter((event) => event.type === 'turn_end');
    const user = events.find((event) => event.type === 'user_message');
    const assistant = events.find((event) => event.type === 'assistant_done');

    expect(turnStarts).toHaveLength(1);
    expect(turnStarts[0]?.turnId).toBe('turn-explicit-1');
    expect(turnStarts[0]?.payload).toEqual({ trigger: 'user' });
    expect(user?.turnId).toBe('turn-explicit-1');
    expect(assistant?.turnId).toBe('turn-explicit-1');
    expect(turnEnds).toHaveLength(1);
    expect(turnEnds[0]?.turnId).toBe('turn-explicit-1');
  });

  it('supports mixed replay with unmarked history before explicit turn markers', async () => {
    const baseDir = await createTempDir('pi-session-history-mixed');
    const sessionId = 'session-mixed';
    const piSessionId = 'pi-session-mixed';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-22T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        message: { role: 'user', id: 'legacy-turn', content: 'Legacy hello' },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'legacy-resp',
          content: [{ type: 'text', text: 'Legacy reply' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'turn-start-2',
        parentId: null,
        timestamp: '2026-01-22T00:00:03.000Z',
        customType: 'assistant.turn_start',
        data: { v: 1, turnId: 'turn-explicit-2', trigger: 'callback' },
      }),
      JSON.stringify({
        type: 'custom_message',
        id: 'callback-input-1',
        parentId: 'turn-start-2',
        timestamp: '2026-01-22T00:00:04.000Z',
        customType: 'assistant.input',
        content: 'Hidden callback input',
        display: false,
        details: { kind: 'callback', fromAgentId: 'agent-b', fromSessionId: 'sess-b' },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'callback-resp',
          content: [{ type: 'text', text: 'Callback handled' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        id: 'turn-end-2',
        parentId: 'callback-resp',
        timestamp: '2026-01-22T00:00:06.000Z',
        customType: 'assistant.turn_end',
        data: { v: 1, turnId: 'turn-explicit-2', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi',
      chat: { provider: 'pi' },
    };

    const provider = new PiSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      agentId: agent.agentId,
      agent,
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd },
        },
      },
    });

    const turnStarts = events.filter((event) => event.type === 'turn_start');
    const turnEnds = events.filter((event) => event.type === 'turn_end');
    const legacyUser = events.find(
      (event) => event.type === 'user_message' && event.payload.text === 'Legacy hello',
    );
    const callbackInput = events.find(
      (event) => event.type === 'agent_message' && event.payload.message === 'Hidden callback input',
    );

    expect(turnStarts).toHaveLength(2);
    expect(turnEnds).toHaveLength(2);
    expect(legacyUser?.turnId).toBe('legacy-turn');
    expect(callbackInput?.turnId).toBe('turn-explicit-2');
    expect(turnStarts[1]?.turnId).toBe('turn-explicit-2');
    expect(turnStarts[1]?.payload).toEqual({ trigger: 'callback' });
  });

  it('starts a new legacy fallback turn for each unmarked user message', async () => {
    const baseDir = await createTempDir('pi-session-history-legacy-turns');
    const sessionId = 'session-legacy-turns';
    const piSessionId = 'pi-session-legacy-turns';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-22T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        message: { role: 'user', id: 'legacy-turn-1', content: 'Legacy first' },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'legacy-resp-1',
          content: [{ type: 'text', text: 'Legacy reply one' }],
        },
      }),
      JSON.stringify({
        message: { role: 'user', id: 'legacy-turn-2', content: 'Legacy second' },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'legacy-resp-2',
          content: [{ type: 'text', text: 'Legacy reply two' }],
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi',
      chat: { provider: 'pi' },
    };

    const provider = new PiSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      agentId: agent.agentId,
      agent,
      attributes: {
        providers: {
          pi: { sessionId: piSessionId, cwd },
        },
      },
    });

    const turnStarts = events.filter((event) => event.type === 'turn_start');
    const turnEnds = events.filter((event) => event.type === 'turn_end');
    const userMessages = events.filter((event) => event.type === 'user_message');
    const assistantMessages = events.filter((event) => event.type === 'assistant_done');

    expect(turnStarts).toHaveLength(2);
    expect(turnStarts[0]?.turnId).toBe('legacy-turn-1');
    expect(turnStarts[1]?.turnId).toBe('legacy-turn-2');
    expect(turnEnds).toHaveLength(2);
    expect(userMessages).toHaveLength(2);
    expect(userMessages[0]?.turnId).toBe('legacy-turn-1');
    expect(userMessages[1]?.turnId).toBe('legacy-turn-2');
    expect(assistantMessages).toHaveLength(2);
    expect(assistantMessages[0]?.turnId).toBe('legacy-turn-1');
    expect(assistantMessages[1]?.turnId).toBe('legacy-turn-2');
  });

  it('skips aborted assistant messages when mapping Pi history', async () => {
    const baseDir = await createTempDir('pi-session-history-aborted');
    const sessionId = 'session-aborted';
    const piSessionId = 'pi-session-aborted';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-22T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
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
          id: 'resp-aborted',
          stopReason: 'aborted',
          errorMessage: 'Request was aborted',
          content: [{ type: 'text', text: 'Partial that should be dropped' }],
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi',
      chat: {
        provider: 'pi',
      },
    };

    const provider = new PiSessionHistoryProvider({ baseDir });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      agentId: agent.agentId,
      agent,
      attributes: {
        providers: {
          pi: {
            sessionId: piSessionId,
            cwd,
          },
        },
      },
    });

    const assistantEvents = events.filter((event) => event.type === 'assistant_done');
    expect(assistantEvents).toHaveLength(0);
    const userEvents = events.filter((event) => event.type === 'user_message');
    expect(userEvents).toHaveLength(1);
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

  it('merges in-flight turn events from the event store for replay', async () => {
    const baseDir = await createTempDir('pi-session-history-inflight');
    const sessionId = 'session-inflight';
    const piSessionId = 'pi-session-inflight';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-19T00-00-00-000Z_${piSessionId}.jsonl`);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        message: {
          role: 'user',
          id: 'turn-1',
          content: 'Earlier turn',
        },
      }),
      'utf8',
    );

    const overlayEvents: ChatEvent[] = [
      {
        id: 'turn-start-1',
        timestamp: 2000,
        sessionId,
        turnId: 'turn-active',
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        id: 'user-1',
        timestamp: 2001,
        sessionId,
        turnId: 'turn-active',
        type: 'user_message',
        payload: { text: 'sleep 10' },
      },
      {
        id: 'tool-1',
        timestamp: 2002,
        sessionId,
        turnId: 'turn-active',
        responseId: 'resp-active',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-active',
          toolName: 'shell_command',
          args: { command: 'sleep 10' },
        },
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

    const provider = new PiSessionHistoryProvider({ baseDir, eventStore });
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

    expect(events.some((event) => event.type === 'turn_start' && event.turnId === 'turn-active')).toBe(
      true,
    );
    expect(
      events.some(
        (event) => event.type === 'user_message' && event.turnId === 'turn-active' && event.payload.text === 'sleep 10',
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'tool_call' &&
          event.turnId === 'turn-active' &&
          event.payload.toolCallId === 'call-active',
      ),
    ).toBe(true);
  });

  it('drops transient replay overlays after provider history includes the completed turn', async () => {
    const baseDir = await createTempDir('pi-session-history-complete');
    const sessionId = 'session-complete';
    const piSessionId = 'pi-session-complete';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-19T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        customType: 'assistant.turn_start',
        type: 'custom',
        timestamp: new Date(1000).toISOString(),
        data: { v: 1, turnId: 'turn-active', trigger: 'user' },
      }),
      JSON.stringify({
        message: {
          role: 'user',
          id: 'turn-active',
          content: 'sleep 10',
        },
        timestamp: new Date(1001).toISOString(),
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-active',
          content: [
            {
              type: 'toolCall',
              id: 'call-active',
              name: 'shell_command',
              arguments: { command: 'sleep 10' },
            },
          ],
        },
        timestamp: new Date(1002).toISOString(),
      }),
      JSON.stringify({
        customType: 'assistant.turn_end',
        type: 'custom',
        timestamp: new Date(1003).toISOString(),
        data: { v: 1, turnId: 'turn-active' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const overlayEvents: ChatEvent[] = [
      {
        id: 'turn-start-1',
        timestamp: 2000,
        sessionId,
        turnId: 'turn-active',
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        id: 'user-1',
        timestamp: 2001,
        sessionId,
        turnId: 'turn-active',
        type: 'user_message',
        payload: { text: 'sleep 10' },
      },
      {
        id: 'tool-1',
        timestamp: 2002,
        sessionId,
        turnId: 'turn-active',
        responseId: 'resp-active',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-active',
          toolName: 'shell_command',
          args: { command: 'sleep 10' },
        },
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

    const provider = new PiSessionHistoryProvider({ baseDir, eventStore });
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

    expect(events.filter((event) => event.type === 'turn_start' && event.turnId === 'turn-active')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'user_message' && event.turnId === 'turn-active')).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.type === 'tool_call' && event.payload.toolCallId === 'call-active',
      ),
    ).toHaveLength(1);
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

  it('keeps verbose persistence for providerId="pi" until Pi session metadata exists', async () => {
    const provider = new PiSessionHistoryProvider({});

    const before = provider.shouldPersist?.({
      sessionId: 'session-1',
      providerId: 'pi',
      attributes: {},
    });
    expect(before).toBe(true);

    const after = provider.shouldPersist?.({
      sessionId: 'session-2',
      providerId: 'pi',
      attributes: {
        providers: {
          pi: {
            sessionId: 'pi-session-1',
            cwd: '/home/kevin',
          },
        },
      },
    });
    expect(after).toBe(false);
  });

  it('falls back to the event store when Pi session metadata is missing', async () => {
    const sessionId = 'session-fallback';
    const userEvent: ChatEvent = {
      id: 'event-1',
      timestamp: Date.now(),
      sessionId,
      turnId: 'turn-1',
      type: 'user_message',
      payload: { text: 'Hello' },
    };

    const eventStore: EventStore = {
      append: async () => undefined,
      appendBatch: async () => undefined,
      getEvents: async () => [userEvent],
      getEventsSince: async () => [userEvent],
      subscribe: () => () => undefined,
      clearSession: async () => undefined,
      deleteSession: async () => undefined,
    };

    const provider = new PiSessionHistoryProvider({ eventStore });
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      attributes: {},
    });

    expect(events.length).toBe(1);
    expect(events[0]?.type).toBe('user_message');
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

  it('keeps the turn open when Pi history ends on an in-progress tool call', async () => {
    const baseDir = await createTempDir('pi-session-history-open-tool');
    const sessionId = 'session-open-tool';
    const piSessionId = 'pi-session-open-tool';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        message: {
          role: 'user',
          id: 'turn-open',
          content: 'sleep 10',
        },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-open',
          content: [
            {
              type: 'toolCall',
              id: 'tool-open',
              name: 'shell_command',
              arguments: { command: 'sleep 10' },
            },
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

    expect(events.some((event) => event.type === 'tool_call' && event.payload.toolCallId === 'tool-open')).toBe(true);
    expect(events.some((event) => event.type === 'turn_end' && event.turnId === 'turn-open')).toBe(false);
  });

  it('preserves commentary-phase assistant text with phase metadata', async () => {
    const baseDir = await createTempDir('pi-session-history-phase');
    const sessionId = 'session-phase';
    const piSessionId = 'pi-session-phase';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-23T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-commentary',
          content: [
            {
              type: 'text',
              text: '{"tool":"noop"}',
              textSignature: JSON.stringify({ v: 1, id: 'msg-commentary-1', phase: 'commentary' }),
            },
            {
              type: 'text',
              text: 'Actual answer',
              textSignature: JSON.stringify({ v: 1, id: 'msg-final-1', phase: 'final_answer' }),
            },
          ],
        },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-commentary-only',
          content: [
            {
              type: 'text',
              text: 'internal commentary only',
              textSignature: JSON.stringify({ v: 1, id: 'msg-commentary-2', phase: 'commentary' }),
            },
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

    const assistantEvents = events.filter(
      (event) => event.type === 'assistant_done',
    ) as Array<Extract<ChatEvent, { type: 'assistant_done' }>>;
    expect(
      assistantEvents.map((event) => ({
        text: event.payload.text,
        phase: event.payload.phase,
        textSignature: event.payload.textSignature,
      })),
    ).toEqual([
      {
        text: '{"tool":"noop"}',
        phase: 'commentary',
        textSignature: JSON.stringify({ v: 1, id: 'msg-commentary-1', phase: 'commentary' }),
      },
      {
        text: 'Actual answer',
        phase: 'final_answer',
        textSignature: JSON.stringify({ v: 1, id: 'msg-final-1', phase: 'final_answer' }),
      },
      {
        text: 'internal commentary only',
        phase: 'commentary',
        textSignature: JSON.stringify({ v: 1, id: 'msg-commentary-2', phase: 'commentary' }),
      },
    ]);
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

    expect(events.some((event) => event.type === 'tool_call' && event.payload.toolCallId === 'call-open')).toBe(true);
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
          arguments: '{"command":"/home/kevin/skills/personal/private/assistant/questions/questions-cli ask --prompt \\"Test questionnaire\\" --schema \\"{}\\""}',
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
