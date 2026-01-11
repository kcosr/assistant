import { describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';

import { ClaudeCLINormalizer } from './claudeCliNormalizer';
import type { NormalizerContext } from './types';

function createContext(): NormalizerContext {
  let counter = 0;
  return {
    sessionId: 'session-123',
    turnId: 'turn-1',
    responseId: 'response-1',
    generateEventId: () => `event-${++counter}`,
    timestamp: () => 1700000000000 + counter,
  };
}

describe('ClaudeCLINormalizer', () => {
  it('emits assistant_chunk events for explicit text deltas', () => {
    const normalizer = new ClaudeCLINormalizer();
    const ctx = createContext();

    const events1 = normalizer.normalize(JSON.stringify({ delta: { text: 'Hello' } }), ctx);
    const events2 = normalizer.normalize(JSON.stringify({ delta: { text: ' world' } }), ctx);

    const allEvents = [...events1, ...events2];
    expect(allEvents).toHaveLength(2);
    expect(allEvents[0]?.type).toBe('assistant_chunk');
    expect((allEvents[0] as ChatEvent).payload).toEqual({ text: 'Hello' });
    expect(allEvents[1]?.type).toBe('assistant_chunk');
    expect((allEvents[1] as ChatEvent).payload).toEqual({ text: ' world' });
  });

  it('derives assistant_chunk events from full-text message events', () => {
    const normalizer = new ClaudeCLINormalizer();
    const ctx = createContext();

    const events1 = normalizer.normalize(
      JSON.stringify({
        message: { content: [{ type: 'text', text: 'Hello' }] },
      }),
      ctx,
    );
    const events2 = normalizer.normalize(
      JSON.stringify({
        message: { content: [{ type: 'text', text: 'Hello there' }] },
      }),
      ctx,
    );

    const allEvents = [...events1, ...events2];
    expect(allEvents.map((e) => e.type)).toEqual(['assistant_chunk', 'assistant_chunk']);
    expect((allEvents[0] as ChatEvent).payload).toEqual({ text: 'Hello' });
    expect((allEvents[1] as ChatEvent).payload).toEqual({ text: ' there' });
  });

  it('emits thinking_chunk and thinking_done for thinking deltas and result summary', () => {
    const normalizer = new ClaudeCLINormalizer();
    const ctx = createContext();

    const thinkingEvents = normalizer.normalize(
      JSON.stringify({
        type: 'content_block_delta',
        delta: {
          type: 'thinking_delta',
          thinking: 'Let me analyze this...',
        },
      }),
      ctx,
    );

    const resultEvents = normalizer.normalize(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Final text result...',
      }),
      ctx,
    );

    const allEvents = [...thinkingEvents, ...resultEvents];
    expect(allEvents.map((e) => e.type)).toEqual([
      'thinking_chunk',
      'thinking_done',
      'assistant_done',
    ]);
    expect((allEvents[0] as ChatEvent).payload).toEqual({
      text: 'Let me analyze this...',
    });
    expect((allEvents[1] as ChatEvent).payload).toEqual({
      text: 'Let me analyze this...',
    });
    expect((allEvents[2] as ChatEvent).payload).toEqual({
      text: 'Final text result...',
    });
  });

  it('emits tool_call and tool_result events linked by toolCallId from content blocks', () => {
    const normalizer = new ClaudeCLINormalizer();
    const ctx = createContext();

    const events1 = normalizer.normalize(
      JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'get_weather',
          input: { location: 'NYC' },
        },
      }),
      ctx,
    );

    const events2 = normalizer.normalize(
      JSON.stringify({
        type: 'content_block_start',
        content_block: {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          result: { ok: true, tempC: 20 },
        },
      }),
      ctx,
    );

    const allEvents = [...events1, ...events2];
    expect(allEvents).toHaveLength(2);
    const toolCall = allEvents[0] as ChatEvent;
    const toolResult = allEvents[1] as ChatEvent;

    expect(toolCall.type).toBe('tool_call');
    expect(toolResult.type).toBe('tool_result');
    expect(toolCall.payload).toMatchObject({
      toolName: 'get_weather',
      args: { location: 'NYC' },
    });
    expect(toolResult.payload).toMatchObject({
      result: { ok: true, tempC: 20 },
    });
    expect(toolCall.payload).toHaveProperty('toolCallId');
    expect(toolResult.payload).toHaveProperty('toolCallId');
    expect((toolCall.payload as { toolCallId: string }).toolCallId).toBe(
      (toolResult.payload as { toolCallId: string }).toolCallId,
    );
  });

  it('throws on unexpected non-JSON input', () => {
    const normalizer = new ClaudeCLINormalizer();
    const ctx = createContext();

    expect(() => normalizer.normalize('not-json', ctx)).toThrow(/Unexpected Claude CLI output/);
  });
});
