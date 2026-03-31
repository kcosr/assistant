import { describe, expect, it } from 'vitest';

import { buildCanonicalPiReplayMessages } from './piSessionReplay';

describe('buildCanonicalPiReplayMessages', () => {
  it('preserves Pi assistant messages and callback metadata from raw Pi session logs', () => {
    const content = [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-session',
        timestamp: '2026-03-26T00:00:00.000Z',
        cwd: '/tmp/example',
      }),
      JSON.stringify({
        type: 'message',
        id: 'm1',
        parentId: null,
        timestamp: '2026-03-26T00:00:01.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Earlier request' }],
          timestamp: 1,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'm2',
        parentId: 'm1',
        timestamp: '2026-03-26T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Working on it',
              textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
            },
            {
              type: 'toolCall',
              id: 'call-1|fc_1',
              name: 'lists_items_list',
              arguments: { listId: 'focus' },
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'toolUse',
          timestamp: 2,
        },
      }),
      JSON.stringify({
        type: 'message',
        id: 'm3',
        parentId: 'm2',
        timestamp: '2026-03-26T00:00:03.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1|fc_1',
          toolName: 'lists_items_list',
          content: [
            {
              type: 'text',
              text: '{"ok":true,"result":[{"title":"Cline"}]}',
            },
          ],
          isError: false,
          timestamp: 3,
        },
      }),
      JSON.stringify({
        type: 'custom_message',
        id: 'm4',
        parentId: 'm3',
        timestamp: '2026-03-26T00:00:04.000Z',
        customType: 'assistant.input',
        content: 'Callback text',
        details: {
          kind: 'callback',
          fromAgentId: 'worker',
          fromSessionId: 's2',
        },
        display: false,
      }),
      JSON.stringify({
        type: 'message',
        id: 'm5',
        parentId: 'm4',
        timestamp: '2026-03-26T00:00:05.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Final answer',
              textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: 5,
        },
      }),
    ].join('\n');

    const messages = buildCanonicalPiReplayMessages(content);

    expect(messages).toHaveLength(5);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'Earlier request',
      historyTimestampMs: 1,
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Working on it',
      historyTimestampMs: 2,
      piSdkMessage: {
        role: 'assistant',
        stopReason: 'toolUse',
      },
    });
    expect(messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1|fc_1',
      content: '{"ok":true,"result":[{"title":"Cline"}]}',
      historyTimestampMs: 3,
    });
    expect(messages[3]).toMatchObject({
      role: 'user',
      content: 'Callback text',
      historyTimestampMs: Date.parse('2026-03-26T00:00:04.000Z'),
      meta: {
        source: 'callback',
        fromAgentId: 'worker',
        fromSessionId: 's2',
        visibility: 'hidden',
      },
    });
    expect(messages[4]).toMatchObject({
      role: 'assistant',
      content: 'Final answer',
      historyTimestampMs: 5,
      piSdkMessage: {
        role: 'assistant',
        stopReason: 'stop',
      },
    });
  });

  it('preserves all final_answer text blocks in order', () => {
    const content = [
      JSON.stringify({
        type: 'session',
        version: 3,
        id: 'pi-session',
        timestamp: '2026-03-26T00:00:00.000Z',
        cwd: '/tmp/example',
      }),
      JSON.stringify({
        type: 'message',
        id: 'm1',
        parentId: null,
        timestamp: '2026-03-26T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'First final block',
              textSignature: '{"v":1,"id":"msg-final-1","phase":"final_answer"}',
            },
            {
              type: 'text',
              text: 'Second final block',
              textSignature: '{"v":1,"id":"msg-final-2","phase":"final_answer"}',
            },
          ],
          api: 'openai-responses',
          provider: 'openai-codex',
          model: 'gpt-5.4',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: 5,
        },
      }),
    ].join('\n');

    const messages = buildCanonicalPiReplayMessages(content);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: 'First final block\n\nSecond final block',
      historyTimestampMs: 5,
    });
  });
});
