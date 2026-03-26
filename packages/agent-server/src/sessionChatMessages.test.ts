import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';
import { AgentRegistry } from './agents';
import { buildChatMessagesFromEvents } from './sessionChatMessages';

describe('buildChatMessagesFromEvents', () => {
  it('converts agent_message records to user role messages', () => {
    const registry = new AgentRegistry([]);
    const events: ChatEvent[] = [
      {
        id: 'evt-1',
        timestamp: Date.now(),
        sessionId: 'session-1',
        type: 'agent_message',
        payload: {
          messageId: 'msg-1',
          targetAgentId: 'agent-b',
          targetSessionId: 'session-2',
          message: 'Hello from another agent',
          wait: true,
        },
      },
    ];

    const messages = buildChatMessagesFromEvents(events, registry, undefined, []);

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('Hello from another agent');
  });

  it('converts agent_callback records to user role messages', () => {
    const registry = new AgentRegistry([]);
    const events: ChatEvent[] = [
      {
        id: 'evt-2',
        timestamp: Date.now(),
        sessionId: 'session-caller',
        type: 'agent_callback',
        payload: {
          messageId: 'msg-2',
          fromAgentId: 'target-agent',
          fromSessionId: 'session-target',
          result: 'Callback from target agent',
        },
      },
    ];

    const messages = buildChatMessagesFromEvents(events, registry, undefined, []);

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('Callback from target agent');
  });

  it('skips interrupted assistant output when rebuilding prompt messages', () => {
    const registry = new AgentRegistry([]);
    const events: ChatEvent[] = [
      {
        id: 'evt-user',
        timestamp: Date.now(),
        sessionId: 'session-1',
        type: 'user_message',
        payload: { text: 'Hello' },
      },
      {
        id: 'evt-assistant',
        timestamp: Date.now(),
        sessionId: 'session-1',
        responseId: 'resp-1',
        type: 'assistant_done',
        payload: { text: 'Partial answer' },
      },
      {
        id: 'evt-interrupt',
        timestamp: Date.now(),
        sessionId: 'session-1',
        responseId: 'resp-1',
        type: 'interrupt',
        payload: { reason: 'user_cancel' },
      },
    ];

    const messages = buildChatMessagesFromEvents(events, registry, undefined, []);

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('Hello');
  });

  it('appends project directory to the system message when provided', () => {
    const registry = new AgentRegistry([]);
    const events: ChatEvent[] = [];

    const messages = buildChatMessagesFromEvents(
      events,
      registry,
      undefined,
      [],
      undefined,
      '/home/kevin/worktrees/project-a',
    );

    expect(messages.length).toBe(1);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain(
      'Project directory: /home/kevin/worktrees/project-a',
    );
  });

  it('preserves tool call boundaries when rebuilding prompt messages', () => {
    const registry = new AgentRegistry([]);
    const sessionId = 'session-tools';
    const timestamp = Date.now();
    const events: ChatEvent[] = [
      {
        id: 'evt-user',
        timestamp,
        sessionId,
        type: 'user_message',
        payload: { text: 'Run the workflow' },
      },
      {
        id: 'evt-tool-1',
        timestamp: timestamp + 1,
        sessionId,
        responseId: 'resp-1',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-1',
          toolName: 'lists_list',
          args: { limit: 10 },
        },
      },
      {
        id: 'evt-result-1',
        timestamp: timestamp + 2,
        sessionId,
        responseId: 'resp-1',
        type: 'tool_result',
        payload: {
          toolCallId: 'call-1',
          result: { ok: true },
        },
      },
      {
        id: 'evt-tool-2',
        timestamp: timestamp + 3,
        sessionId,
        responseId: 'resp-1',
        type: 'tool_call',
        payload: {
          toolCallId: 'call-2',
          toolName: 'lists_items_search',
          args: { query: 'now' },
        },
      },
      {
        id: 'evt-result-2',
        timestamp: timestamp + 4,
        sessionId,
        responseId: 'resp-1',
        type: 'tool_result',
        payload: {
          toolCallId: 'call-2',
          result: { ok: true },
        },
      },
      {
        id: 'evt-done',
        timestamp: timestamp + 5,
        sessionId,
        responseId: 'resp-1',
        type: 'assistant_done',
        payload: { text: 'Finished.' },
      },
    ];

    const messages = buildChatMessagesFromEvents(events, registry, undefined, []);

    expect(messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-1',
          function: {
            name: 'lists_list',
            arguments: JSON.stringify({ limit: 10 }),
          },
        },
      ],
    });
    expect(messages[4]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-2',
          function: {
            name: 'lists_items_search',
            arguments: JSON.stringify({ query: 'now' }),
          },
        },
      ],
    });
    expect(messages[6]).toMatchObject({
      role: 'assistant',
      content: 'Finished.',
    });
  });
});
