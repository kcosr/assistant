import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import {
  ClaudeSessionHistoryProvider,
  CodexSessionHistoryProvider,
  type HistoryRequest,
  loadCanonicalPiSessionEvents,
  loadCanonicalPiTranscriptEvents,
} from './historyProvider';
import type { AgentDefinition } from '../agents';
import type { EventStore } from '../events';

async function createTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
}

function createPiHistoryProvider(baseDir?: string): {
  getHistory: (request: HistoryRequest) => Promise<ChatEvent[]>;
  shouldPersist: (_request?: HistoryRequest) => false;
} {
  return {
    getHistory: async (request) =>
      loadCanonicalPiSessionEvents({
        sessionId: request.sessionId,
        ...(request.providerId ? { providerId: request.providerId } : {}),
        ...(request.attributes ? { attributes: request.attributes } : {}),
        ...(baseDir ? { baseDir } : {}),
      }),
    shouldPersist: () => false,
  };
}

describe('canonical Pi session history loader', () => {
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

    const provider = createPiHistoryProvider(baseDir);
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

  it('replays assistant extension entries from canonical user metadata plus assistant.event', async () => {
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
        type: 'message',
        id: 'input-agent-1',
        parentId: null,
        timestamp: '2026-01-20T00:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Hello from agent' }],
          meta: { source: 'agent', fromAgentId: 'agent-a', fromSessionId: 'sess-a' },
          timestamp: Date.parse('2026-01-20T00:00:00.000Z'),
        },
      }),
      JSON.stringify({
        message: {
          role: 'assistant',
          id: 'resp-1',
          content: [{ type: 'text', text: 'Hi back' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'input-callback-1',
        parentId: null,
        timestamp: '2026-01-20T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Hidden callback input' }],
          meta: {
            source: 'callback',
            fromAgentId: 'agent-b',
            fromSessionId: 'sess-b',
            visibility: 'hidden',
          },
          timestamp: Date.parse('2026-01-20T00:00:01.000Z'),
        },
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
        customType: 'assistant.agent_callback',
        data: {
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
        customType: 'assistant.interaction_request',
        data: {
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
        customType: 'assistant.assistant_done',
        data: {
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
        customType: 'assistant.interrupt',
        data: {
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

    const provider = createPiHistoryProvider(baseDir);
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
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-explicit-1', trigger: 'user' },
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
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-explicit-1', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi',
      chat: { provider: 'pi' },
    };

    const provider = createPiHistoryProvider(baseDir);
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

    const provider = createPiHistoryProvider(baseDir);
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

  it('maps aborted assistant messages with visible text as interrupted assistant events', async () => {
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

    const provider = createPiHistoryProvider(baseDir);
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
    expect(assistantEvents).toHaveLength(1);
    expect(assistantEvents[0]).toMatchObject({
      payload: {
        text: 'Partial that should be dropped',
        interrupted: true,
      },
    });
    const userEvents = events.filter((event) => event.type === 'user_message');
    expect(userEvents).toHaveLength(1);
  });

  it('does not merge overlay interaction events from the event store', async () => {
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

    const agent: AgentDefinition = {
      agentId: 'pi',
      displayName: 'Pi',
      description: 'Pi CLI',
      chat: {
        provider: 'pi-cli',
      },
    };

    const provider = createPiHistoryProvider(baseDir);
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

    expect(events.some((event) => event.type === 'interaction_request')).toBe(false);
    expect(events.some((event) => event.type === 'interaction_pending')).toBe(false);
  });

  it('does not merge in-flight turn events from the event store for replay', async () => {
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

    const provider = createPiHistoryProvider(baseDir);
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
      false,
    );
    expect(
      events.some(
        (event) => event.type === 'user_message' && event.turnId === 'turn-active' && event.payload.text === 'sleep 10',
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.type === 'tool_call' &&
          event.turnId === 'turn-active' &&
          event.payload.toolCallId === 'call-active',
      ),
    ).toBe(false);
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
        customType: 'assistant.request_start',
        type: 'custom',
        timestamp: new Date(1000).toISOString(),
        data: { v: 1, requestId: 'turn-active', trigger: 'user' },
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
        customType: 'assistant.request_end',
        type: 'custom',
        timestamp: new Date(1003).toISOString(),
        data: { v: 1, requestId: 'turn-active' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = createPiHistoryProvider(baseDir);
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

  it('always treats Pi sessions as external history', async () => {
    const provider = createPiHistoryProvider();

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

  it('disables sidecar persistence for providerId="pi" immediately', async () => {
    const provider = createPiHistoryProvider();

    const before = provider.shouldPersist?.({
      sessionId: 'session-1',
      providerId: 'pi',
      attributes: {},
    });
    expect(before).toBe(false);

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

  it('does not replay overlay-only Pi history when canonical session metadata is missing', async () => {
    const sessionId = 'session-fallback';
    const provider = createPiHistoryProvider();
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      attributes: {},
    });

    expect(events).toEqual([]);
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

    const provider = createPiHistoryProvider(baseDir);
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

    const provider = createPiHistoryProvider(baseDir);
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

  it('replays Pi assistant.event in-flight voice turns before finalized messages exist', async () => {
    const baseDir = await createTempDir('pi-session-history-event-only');
    const sessionId = 'session-event-only';
    const piSessionId = 'pi-session-event-only';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-voice', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.001Z',
        customType: 'assistant.turn_start',
        data: {
          payload: { trigger: 'user' },
          turnId: 'turn-voice',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.002Z',
        customType: 'assistant.user_audio',
        data: {
          payload: { transcription: 'run sleep for ten seconds', durationMs: 221 },
          turnId: 'turn-voice',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:01.000Z',
        customType: 'assistant.tool_call',
        data: {
          payload: {
            toolCallId: 'tool-voice',
            toolName: 'bash',
            args: { command: 'sleep 10' },
          },
          turnId: 'turn-voice',
          responseId: 'resp-voice',
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = createPiHistoryProvider(baseDir);
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

    expect(events.filter((event) => event.type === 'turn_start' && event.turnId === 'turn-voice')).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'user_audio' &&
          event.turnId === 'turn-voice' &&
          event.payload.transcription === 'run sleep for ten seconds',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'tool_call' &&
          event.turnId === 'turn-voice' &&
          event.payload.toolCallId === 'tool-voice',
      ),
    ).toHaveLength(1);
    expect(events.some((event) => event.type === 'turn_end' && event.turnId === 'turn-voice')).toBe(false);
  });

  it('dedupes Pi assistant.event replay against later finalized messages for the same voice turn', async () => {
    const baseDir = await createTempDir('pi-session-history-voice-dedupe');
    const sessionId = 'session-voice-dedupe';
    const piSessionId = 'pi-session-voice-dedupe';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-voice', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.001Z',
        customType: 'assistant.turn_start',
        data: {
          payload: { trigger: 'user' },
          turnId: 'turn-voice',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.002Z',
        customType: 'assistant.user_audio',
        data: {
          payload: { transcription: 'run sleep for ten seconds', durationMs: 221 },
          turnId: 'turn-voice',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:01.000Z',
        customType: 'assistant.tool_call',
        data: {
          payload: {
            toolCallId: 'tool-voice',
            toolName: 'bash',
            args: { command: 'sleep 10' },
          },
          turnId: 'turn-voice',
          responseId: 'resp-voice',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:11.000Z',
        customType: 'assistant.tool_result',
        data: {
          payload: {
            toolCallId: 'tool-voice',
            result: { ok: true, output: '', exitCode: 0 },
          },
          turnId: 'turn-voice',
          responseId: 'resp-voice',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:12.000Z',
        customType: 'assistant.assistant_done',
        data: {
          payload: { text: 'Done! The sleep completed.' },
          turnId: 'turn-voice',
          responseId: 'resp-voice',
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:12.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'run sleep for ten seconds' }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:12.000Z',
        message: {
          role: 'assistant',
          id: 'resp-voice',
          content: [
            { type: 'toolCall', id: 'tool-voice', name: 'bash', arguments: { command: 'sleep 10' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:12.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-voice',
          toolName: 'bash',
          content: [{ type: 'text', text: '{\"ok\":true,\"result\":{\"ok\":true,\"output\":\"\",\"exitCode\":0}}' }],
          isError: false,
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:12.000Z',
        message: {
          role: 'assistant',
          id: 'resp-voice-final',
          content: [{ type: 'text', text: 'Done! The sleep completed.' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:12.000Z',
        customType: 'assistant.turn_end',
        data: {
          payload: {},
          turnId: 'turn-voice',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:12.001Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-voice', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = createPiHistoryProvider(baseDir);
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

    expect(events.filter((event) => event.type === 'turn_start' && event.turnId === 'turn-voice')).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'user_audio' &&
          event.turnId === 'turn-voice' &&
          event.payload.transcription === 'run sleep for ten seconds',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'user_message' &&
          event.turnId === 'turn-voice' &&
          event.payload.text === 'run sleep for ten seconds',
      ),
    ).toHaveLength(0);
    expect(
      events.filter(
        (event) =>
          event.type === 'tool_call' &&
          event.turnId === 'turn-voice' &&
          event.payload.toolCallId === 'tool-voice',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'tool_result' &&
          event.turnId === 'turn-voice' &&
          event.payload.toolCallId === 'tool-voice',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'assistant_done' &&
          event.turnId === 'turn-voice' &&
          event.payload.text === 'Done! The sleep completed.',
      ),
    ).toHaveLength(1);
    expect(events.filter((event) => event.type === 'turn_end' && event.turnId === 'turn-voice')).toHaveLength(1);
  });

  it('dedupes Pi explicit thinking_done against later finalized assistant toolUse messages', async () => {
    const baseDir = await createTempDir('pi-session-history-thinking-dedupe');
    const sessionId = 'session-thinking-dedupe';
    const piSessionId = 'pi-session-thinking-dedupe';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const thinkingText =
      '**Obtaining current date**\n\nI need to find out the current date using `date`.\n\n';
    const lines = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-thinking', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.001Z',
        customType: 'assistant.turn_start',
        data: {
          payload: { trigger: 'user' },
          turnId: 'turn-thinking',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.002Z',
        customType: 'assistant.user_message',
        data: {
          payload: { text: "what's the date?" },
          turnId: 'turn-thinking',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:01.000Z',
        customType: 'assistant.thinking_done',
        data: {
          payload: { text: thinkingText },
          turnId: 'turn-thinking',
          responseId: 'resp-thinking-event',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:01.100Z',
        customType: 'assistant.tool_call',
        data: {
          payload: {
            toolCallId: 'tool-thinking',
            toolName: 'bash',
            args: { command: "date '+%A, %B %-d, %Y'" },
          },
          turnId: 'turn-thinking',
          responseId: 'resp-thinking-event',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:02.000Z',
        customType: 'assistant.tool_result',
        data: {
          payload: {
            toolCallId: 'tool-thinking',
            result: { ok: true, output: 'Monday, March 30, 2026\n', exitCode: 0 },
          },
          turnId: 'turn-thinking',
          responseId: 'resp-thinking-event',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:03.000Z',
        customType: 'assistant.assistant_done',
        data: {
          payload: { text: 'Today is Monday, March 30, 2026.' },
          turnId: 'turn-thinking',
          responseId: 'resp-thinking-event',
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:03.001Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: "what's the date?" }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:03.002Z',
        message: {
          role: 'assistant',
          id: 'resp-thinking-message',
          content: [
            { type: 'thinking', thinking: thinkingText.trimEnd() },
            {
              type: 'toolCall',
              id: 'tool-thinking',
              name: 'bash',
              arguments: { command: "date '+%A, %B %-d, %Y'" },
            },
          ],
          stopReason: 'toolUse',
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:03.003Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-thinking',
          toolName: 'bash',
          content: [
            {
              type: 'text',
              text: '{"ok":true,"result":{"ok":true,"output":"Monday, March 30, 2026\\n","exitCode":0}}',
            },
          ],
          isError: false,
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:03.004Z',
        message: {
          role: 'assistant',
          id: 'resp-thinking-final',
          content: [{ type: 'text', text: 'Today is Monday, March 30, 2026.' }],
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:03.005Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-thinking', status: 'completed' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:03.006Z',
        customType: 'assistant.turn_end',
        data: {
          payload: {},
          turnId: 'turn-thinking',
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = createPiHistoryProvider(baseDir);
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

    expect(
      events.filter(
        (event) =>
          event.type === 'thinking_done' &&
          event.turnId === 'turn-thinking' &&
          event.payload.text.includes('Obtaining current date'),
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'tool_call' &&
          event.turnId === 'turn-thinking' &&
          event.payload.toolCallId === 'tool-thinking',
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'assistant_done' &&
          event.turnId === 'turn-thinking' &&
          event.payload.text === 'Today is Monday, March 30, 2026.',
      ),
    ).toHaveLength(1);
  });

  it('ignores late raw provider messages already covered by mirrored explicit turn events', async () => {
    const baseDir = await createTempDir('pi-session-history-late-raw-dedupe');
    const sessionId = 'session-late-raw-dedupe';
    const piSessionId = 'pi-session-late-raw-dedupe';
    const cwd = '/home/kevin';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-01-18T00-00-00-000Z_${piSessionId}.jsonl`);
    const firstPrompt = 'kick off the triage workflow';
    const firstThinking = '**Reviewing workspace and docs**';
    const firstCommentary = 'Reviewing chat/tool plumbing and preparing an isolated worktree.';
    const secondPrompt = 'change of plans just create a work tree called missing replay';
    const lines = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-1', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.001Z',
        customType: 'assistant.user_message',
        data: {
          payload: { text: firstPrompt },
          turnId: 'turn-1',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.002Z',
        customType: 'assistant.thinking_done',
        data: {
          payload: { text: firstThinking },
          turnId: 'turn-1',
          responseId: 'resp-1',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.003Z',
        customType: 'assistant.assistant_done',
        data: {
          payload: { text: firstCommentary, phase: 'commentary' },
          turnId: 'turn-1',
          responseId: 'resp-1',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:00.004Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-1', status: 'interrupted' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:10.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-2', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:10.001Z',
        customType: 'assistant.user_audio',
        data: {
          payload: { transcription: secondPrompt, durationMs: 250 },
          turnId: 'turn-2',
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:11.000Z',
        message: {
          role: 'user',
          timestamp: Date.parse('2026-01-18T00:00:00.001Z'),
          content: [{ type: 'text', text: firstPrompt }],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-01-18T00:00:11.001Z',
        message: {
          role: 'assistant',
          id: 'resp-1-raw',
          timestamp: Date.parse('2026-01-18T00:00:00.002Z'),
          content: [
            { type: 'thinking', thinking: firstThinking },
            { type: 'text', text: firstCommentary },
          ],
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-01-18T00:00:10.002Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-2', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = createPiHistoryProvider(baseDir);
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

    expect(
      events.filter(
        (event) =>
          event.type === 'user_message' &&
          event.payload.text === firstPrompt,
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'user_message' &&
          event.payload.text === firstPrompt &&
          event.turnId === 'turn-2',
      ),
    ).toHaveLength(0);
    expect(
      events.filter(
        (event) =>
          event.type === 'thinking_done' &&
          event.payload.text === firstThinking,
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'thinking_done' &&
          event.payload.text === firstThinking &&
          event.turnId === 'turn-2',
      ),
    ).toHaveLength(0);
    expect(
      events.filter(
        (event) =>
          event.type === 'assistant_done' &&
          event.payload.text === firstCommentary,
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === 'assistant_done' &&
          event.payload.text === firstCommentary &&
          event.turnId === 'turn-2',
      ),
    ).toHaveLength(0);
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

    const provider = createPiHistoryProvider(baseDir);
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

  it('orders canonical assistant narration before earlier-appended overlay tool events on replay', async () => {
    const baseDir = await createTempDir('pi-session-history-replay-order');
    const sessionId = 'session-replay-order';
    const piSessionId = 'pi-session-replay-order';
    const cwd = '/home/kevin/assistant';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-03-31T14-21-05-772Z_${piSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T14:46:13.150Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-worktree', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T14:46:16.782Z',
        customType: 'assistant.tool_call',
        data: {
          turnId: 'turn-worktree',
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
        timestamp: '2026-03-31T14:46:16.942Z',
        customType: 'assistant.tool_result',
        data: {
          turnId: 'turn-worktree',
          responseId: 'resp-worktree',
          payload: {
            toolCallId: 'tool-worktree',
            result: { ok: true, output: 'created' },
          },
        },
      }),
      JSON.stringify({
        type: 'message',
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
        timestamp: '2026-03-31T14:46:24.900Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-worktree', status: 'completed' },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = createPiHistoryProvider(baseDir);
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      attributes: {
        providers: {
          pi: {
            sessionId: piSessionId,
            cwd,
          },
        },
      },
    });

    const assistantIndex = events.findIndex(
      (event) =>
        event.type === 'assistant_done' &&
        event.turnId === 'turn-worktree' &&
        event.payload.text === 'The repo is ready. Creating the worktree now:',
    );
    const toolCallIndex = events.findIndex(
      (event) =>
        event.type === 'tool_call' &&
        event.turnId === 'turn-worktree' &&
        event.payload.toolCallId === 'tool-worktree',
    );
    const toolResultIndex = events.findIndex(
      (event) =>
        event.type === 'tool_result' &&
        event.turnId === 'turn-worktree' &&
        event.payload.toolCallId === 'tool-worktree',
    );

    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(toolResultIndex).toBeGreaterThanOrEqual(0);
    expect(assistantIndex).toBeLessThan(toolCallIndex);
    expect(assistantIndex).toBeLessThan(toolResultIndex);
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

  it('orders canonical thinking before later overlay tool events on replay', async () => {
    const baseDir = await createTempDir('pi-session-history-thinking-order');
    const sessionId = 'session-thinking-order';
    const piSessionId = 'pi-session-thinking-order';
    const cwd = '/home/kevin/assistant';
    const encodedCwd = `--${cwd.replace(/^[/\\]/, '').replace(/[\\/:]/g, '-')}--`;
    const sessionDir = path.join(baseDir, encodedCwd);
    await fs.mkdir(sessionDir, { recursive: true });
    const filePath = path.join(sessionDir, `2026-03-31T16-40-52-138Z_${piSessionId}.jsonl`);
    const thinkingText =
      '**Inspecting worktrees skill**\n\nI should read the worktrees skill before responding.';
    const lines = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T16:41:34.478Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-thinking', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T16:41:34.482Z',
        customType: 'assistant.user_message',
        data: {
          payload: {
            text: 'review the worktrees skill and tell me when you are ready',
          },
          turnId: 'turn-thinking',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T16:41:40.029Z',
        customType: 'assistant.thinking_done',
        data: {
          payload: { text: `${thinkingText}\n\n` },
          turnId: 'turn-thinking',
          responseId: 'resp-overlay-thinking',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T16:41:40.118Z',
        customType: 'assistant.tool_call',
        data: {
          payload: {
            toolCallId: 'tool-thinking',
            toolName: 'read',
            args: { path: '/home/kevin/.agents/skills/worktrees/SKILL.md' },
          },
          turnId: 'turn-thinking',
          responseId: 'resp-overlay-thinking',
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-31T16:41:44.683Z',
        message: {
          role: 'assistant',
          id: 'resp-canonical-thinking',
          timestamp: '2026-03-31T16:41:34.487Z',
          content: [
            {
              type: 'thinking',
              thinking: thinkingText,
            },
            {
              type: 'toolCall',
              id: 'tool-thinking',
              name: 'read',
              arguments: { path: '/home/kevin/.agents/skills/worktrees/SKILL.md' },
            },
          ],
          stopReason: 'toolUse',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T16:41:44.685Z',
        customType: 'assistant.turn_end',
        data: {
          payload: {},
          turnId: 'turn-thinking',
        },
      }),
    ];
    await fs.writeFile(filePath, lines.join('\n'), 'utf8');

    const provider = createPiHistoryProvider(baseDir);
    const events = await provider.getHistory({
      sessionId,
      providerId: 'pi',
      attributes: {
        providers: {
          pi: {
            sessionId: piSessionId,
            cwd,
          },
        },
      },
    });

    const thinkingEvents = events.filter(
      (event) =>
        event.type === 'thinking_done' &&
        event.turnId === 'turn-thinking' &&
        event.payload.text.trimEnd() === thinkingText,
    );
    const thinkingIndex = events.findIndex(
      (event) =>
        event.type === 'thinking_done' &&
        event.turnId === 'turn-thinking' &&
        event.payload.text.trimEnd() === thinkingText,
    );
    const toolCallIndex = events.findIndex(
      (event) =>
        event.type === 'tool_call' &&
        event.turnId === 'turn-thinking' &&
        event.payload.toolCallId === 'tool-thinking',
    );

    expect(thinkingEvents).toHaveLength(1);
    expect(thinkingIndex).toBeGreaterThanOrEqual(0);
    expect(toolCallIndex).toBeGreaterThanOrEqual(0);
    expect(thinkingIndex).toBeLessThan(toolCallIndex);
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
        payload: { type: 'task_complete', turn_id: 'provider-turn-1', last_agent_message: 'hi' },
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
