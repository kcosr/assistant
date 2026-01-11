import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import { toClaudeCLIPrompt, toCodexCLIPrompt, toOpenAIMessages, toSessionSummary } from './index';
import type { ChatCompletionMessage } from '../chatCompletionTypes';

function baseEvent(type: ChatEvent['type']): Omit<ChatEvent, 'type' | 'payload'> {
  return {
    id: `${type}-1`,
    timestamp: Date.now(),
    sessionId: 'session-1',
  };
}

describe('toOpenAIMessages', () => {
  it('projects user and assistant messages', () => {
    const events: ChatEvent[] = [
      {
        ...baseEvent('user_message'),
        type: 'user_message',
        payload: { text: 'Hello there' },
      },
      {
        ...baseEvent('assistant_done'),
        type: 'assistant_done',
        payload: { text: 'Hi, how can I help?' },
      },
    ];

    const messages = toOpenAIMessages(events);

    expect(messages).toHaveLength(2);
    const first = messages[0] as ChatCompletionMessage;
    const second = messages[1] as ChatCompletionMessage;

    expect(first.role).toBe('user');
    expect(first.content).toBe('Hello there');
    expect(second.role).toBe('assistant');
    expect(second.content).toBe('Hi, how can I help?');
  });

  it('groups tool calls into assistant messages and emits tool results', () => {
    const events: ChatEvent[] = [
      {
        ...baseEvent('user_message'),
        type: 'user_message',
        payload: { text: 'Run the tool' },
      },
      {
        ...baseEvent('tool_call'),
        type: 'tool_call',
        payload: {
          toolCallId: 'call-1',
          toolName: 'test_tool',
          args: { foo: 'bar' },
        },
      },
      {
        ...baseEvent('tool_result'),
        type: 'tool_result',
        payload: {
          toolCallId: 'call-1',
          result: { ok: true },
          error: undefined,
        },
      },
    ];

    const messages = toOpenAIMessages(events);
    expect(messages).toHaveLength(3);

    const user = messages[0] as ChatCompletionMessage;
    const assistantWithToolCall = messages[1] as ChatCompletionMessage & {
      tool_calls?: unknown;
    };
    const tool = messages[2] as ChatCompletionMessage;

    expect(user.role).toBe('user');

    expect(assistantWithToolCall.role).toBe('assistant');
    expect(assistantWithToolCall.content).toBe('');
    expect(Array.isArray(assistantWithToolCall.tool_calls)).toBe(true);
    const toolCalls = assistantWithToolCall.tool_calls as
      | {
          id: string;
          type: string;
          function: { name: string; arguments: string };
        }[]
      | undefined;
    expect(toolCalls?.length).toBe(1);
    const firstCall = toolCalls?.[0];
    expect(firstCall?.id).toBe('call-1');
    expect(firstCall?.type).toBe('function');
    expect(firstCall?.function.name).toBe('test_tool');
    expect(firstCall?.function.arguments).toBe(JSON.stringify({ foo: 'bar' }));

    expect(tool.role).toBe('tool');
    expect((tool as { tool_call_id?: string }).tool_call_id).toBe('call-1');
    const parsed = JSON.parse(String(tool.content)) as { ok: boolean; result: unknown };
    expect(parsed.ok).toBe(true);
    expect(parsed.result).toEqual({ ok: true });
  });

  it('projects agent callbacks as user messages', () => {
    const events: ChatEvent[] = [
      {
        ...baseEvent('agent_callback'),
        type: 'agent_callback',
        payload: {
          messageId: 'msg-1',
          fromAgentId: 'code-agent',
          fromSessionId: 'other-session',
          result: 'Task completed',
        },
      },
    ];

    const messages = toOpenAIMessages(events);
    expect(messages).toHaveLength(1);
    const callbackMessage = messages[0] as ChatCompletionMessage;
    expect(callbackMessage.role).toBe('user');
    expect(callbackMessage.content).toBe('[Callback from code-agent]: Task completed');
  });
});

describe('CLI prompt projections', () => {
  it('builds a plain-text transcript for Claude CLI', () => {
    const events: ChatEvent[] = [
      {
        ...baseEvent('user_message'),
        type: 'user_message',
        payload: { text: 'Hello' },
      },
      {
        ...baseEvent('assistant_done'),
        type: 'assistant_done',
        payload: { text: 'Hi there' },
      },
      {
        ...baseEvent('agent_callback'),
        type: 'agent_callback',
        payload: {
          messageId: 'm1',
          fromAgentId: 'code-agent',
          fromSessionId: 's2',
          result: 'Callback details',
        },
      },
    ];

    const prompt = toClaudeCLIPrompt(events);
    expect(prompt).toContain('User: Hello');
    expect(prompt).toContain('Assistant: Hi there');
    expect(prompt).toContain('[Callback from code-agent]: Callback details');
  });

  it('Codex CLI prompt matches Claude CLI prompt for now', () => {
    const events: ChatEvent[] = [
      {
        ...baseEvent('user_message'),
        type: 'user_message',
        payload: { text: 'Test' },
      },
    ];

    const claudePrompt = toClaudeCLIPrompt(events);
    const codexPrompt = toCodexCLIPrompt(events);
    expect(codexPrompt).toBe(claudePrompt);
  });
});

describe('toSessionSummary', () => {
  it('summarises last message and counts visible messages', () => {
    const events: ChatEvent[] = [
      {
        ...baseEvent('turn_start'),
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        ...baseEvent('user_message'),
        type: 'user_message',
        payload: { text: 'First question' },
      },
      {
        ...baseEvent('assistant_done'),
        type: 'assistant_done',
        payload: { text: 'First answer' },
      },
      {
        ...baseEvent('agent_callback'),
        type: 'agent_callback',
        payload: {
          messageId: 'm2',
          fromAgentId: 'helper',
          fromSessionId: 's3',
          result: 'Extra info',
        },
      },
      {
        ...baseEvent('tool_call'),
        type: 'tool_call',
        payload: {
          toolCallId: 'call-1',
          toolName: 'tool',
          args: {},
        },
      },
    ];

    const summary = toSessionSummary(events);

    expect(summary.messageCount).toBe(3);
    expect(summary.lastMessage).toBe('[Callback from helper]: Extra info');
  });

  it('returns empty summary when there are no visible messages', () => {
    const events: ChatEvent[] = [
      {
        ...baseEvent('turn_start'),
        type: 'turn_start',
        payload: { trigger: 'user' },
      },
      {
        ...baseEvent('turn_end'),
        type: 'turn_end',
        payload: {},
      },
    ];

    const summary = toSessionSummary(events);

    expect(summary.messageCount).toBe(0);
    expect(summary.lastMessage).toBe('');
  });
});
