import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import { CodexCLINormalizer, type NormalizerContext } from './codexCliNormalizer';

function createTestContext(): NormalizerContext {
  let counter = 0;
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    responseId: 'response-1',
    generateEventId: () => {
      counter += 1;
      return `event-${counter}`;
    },
    timestamp: () => 1700000000000,
  };
}

function eventSummary(event: ChatEvent) {
  return {
    type: event.type,
    payload: event.payload,
    sessionId: event.sessionId,
    turnId: event.turnId,
    responseId: event.responseId,
  };
}

describe('CodexCLINormalizer', () => {
  it('normalizes completed agent_message items into assistant_chunk and assistant_done events', () => {
    const normalizer = new CodexCLINormalizer();
    const ctx = createTestContext();

    const line = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_0',
        type: 'agent_message',
        text: 'Hello from Codex',
      },
    });

    const events = normalizer.normalize(line, ctx);

    expect(events).toHaveLength(2);
    const summaries = events.map(eventSummary);

    expect(summaries[0]).toMatchObject({
      type: 'assistant_chunk',
      payload: { text: 'Hello from Codex' },
      sessionId: 'session-1',
      turnId: 'turn-1',
      responseId: 'response-1',
    });

    expect(summaries[1]).toMatchObject({
      type: 'assistant_done',
      payload: { text: 'Hello from Codex' },
      sessionId: 'session-1',
      turnId: 'turn-1',
      responseId: 'response-1',
    });
  });

  it('normalizes completed reasoning items into thinking_chunk and thinking_done events', () => {
    const normalizer = new CodexCLINormalizer();
    const ctx = createTestContext();

    const line = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'reasoning',
        text: 'Thinking through the problem…',
      },
    });

    const events = normalizer.normalize(line, ctx);

    expect(events).toHaveLength(2);
    const summaries = events.map(eventSummary);

    expect(summaries[0]).toMatchObject({
      type: 'thinking_chunk',
      payload: { text: 'Thinking through the problem…' },
    });

    expect(summaries[1]).toMatchObject({
      type: 'thinking_done',
      payload: { text: 'Thinking through the problem…' },
    });
  });

  it('normalizes agent_message_delta into assistant_chunk events', () => {
    const normalizer = new CodexCLINormalizer();
    const ctx = createTestContext();

    const line = JSON.stringify({
      type: 'agent_message_delta',
      delta: 'partial text ',
    });

    const events = normalizer.normalize(line, ctx);

    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) {
      throw new Error('Expected a single assistant_chunk event');
    }

    expect(eventSummary(event)).toMatchObject({
      type: 'assistant_chunk',
      payload: { text: 'partial text ' },
    });
  });

  it('normalizes function_call events into tool_call ChatEvents', () => {
    const normalizer = new CodexCLINormalizer();
    const ctx = createTestContext();

    const line = JSON.stringify({
      type: 'function_call',
      name: 'my_tool',
      call_id: 'call-123',
      arguments: '{"foo": "bar", "count": 2}',
    });

    const events = normalizer.normalize(line, ctx);

    expect(events).toHaveLength(1);
    const event = events[0];
    if (!event) {
      throw new Error('Expected a single tool_call event');
    }
    const summary = eventSummary(event);

    expect(summary).toMatchObject({
      type: 'tool_call',
      payload: {
        toolCallId: 'call-123',
        toolName: 'my_tool',
        args: { foo: 'bar', count: 2 },
      },
      sessionId: 'session-1',
      turnId: 'turn-1',
      responseId: 'response-1',
    });
  });
});
