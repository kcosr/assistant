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
        type: 'message',
        id: 'm4',
        parentId: 'm3',
        timestamp: '2026-03-26T00:00:04.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Callback text' }],
          meta: {
            source: 'callback',
            fromAgentId: 'worker',
            fromSessionId: 's2',
            visibility: 'hidden',
          },
          timestamp: 4,
        },
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
      historyTimestampMs: 4,
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

  it('replays assistant.event agent callbacks into canonical history', () => {
    const content = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-04-01T00:14:33.494Z',
        customType: 'assistant.agent_callback',
        data: {
          payload: {
            messageId: 'questionnaire-1',
            fromAgentId: 'unknown',
            fromSessionId: '4d4cc8a3-3c8f-4bac-9864-27046c7d4159',
            result:
              '<questionnaire-response questionnaire-request-id="questionnaire-1" tool="questions_ask" />',
          },
          turnId: 'turn-callback',
          responseId: 'resp-callback',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-04-01T00:15:33.320Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-callback', status: 'interrupted' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-04-01T00:15:50.635Z',
        customType: 'assistant.user_audio',
        data: {
          payload: {
            transcription: "i mean didn't you already get answers to the questionnaire",
          },
          turnId: 'turn-followup',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-04-01T00:15:51.000Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-followup', status: 'interrupted' },
      }),
    ].join('\n');

    const messages = buildCanonicalPiReplayMessages(content);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content:
        '[Callback from unknown]: <questionnaire-response questionnaire-request-id="questionnaire-1" tool="questions_ask" />',
      historyTimestampMs: Date.parse('2026-04-01T00:14:33.494Z'),
      meta: {
        source: 'callback',
        fromAgentId: 'unknown',
        fromSessionId: '4d4cc8a3-3c8f-4bac-9864-27046c7d4159',
        visibility: 'visible',
      },
    });
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: "i mean didn't you already get answers to the questionnaire",
      historyTimestampMs: Date.parse('2026-04-01T00:15:50.635Z'),
    });
  });

  it('does not duplicate agent callbacks once the same callback was persisted as a callback-meta user message', () => {
    const callbackText =
      '[Callback from unknown]: <questionnaire-response questionnaire-request-id="questionnaire-1" tool="questions_ask" />';
    const content = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-04-01T00:14:33.494Z',
        customType: 'assistant.agent_callback',
        data: {
          payload: {
            messageId: 'questionnaire-1',
            fromAgentId: 'unknown',
            fromSessionId: '4d4cc8a3-3c8f-4bac-9864-27046c7d4159',
            result:
              '<questionnaire-response questionnaire-request-id="questionnaire-1" tool="questions_ask" />',
          },
          turnId: 'turn-callback',
          responseId: 'resp-callback',
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-04-01T00:16:10.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: callbackText }],
          meta: {
            source: 'callback',
            fromAgentId: 'unknown',
            fromSessionId: '4d4cc8a3-3c8f-4bac-9864-27046c7d4159',
            visibility: 'visible',
          },
          timestamp: Date.parse('2026-04-01T00:16:10.000Z'),
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-04-01T00:16:20.000Z',
        customType: 'assistant.user_message',
        data: {
          payload: {
            text: 'follow-up',
          },
          turnId: 'turn-followup',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-04-01T00:16:21.000Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-followup', status: 'interrupted' },
      }),
    ].join('\n');

    const messages = buildCanonicalPiReplayMessages(content);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: callbackText,
      historyTimestampMs: Date.parse('2026-04-01T00:16:10.000Z'),
      meta: {
        source: 'callback',
        fromAgentId: 'unknown',
        fromSessionId: '4d4cc8a3-3c8f-4bac-9864-27046c7d4159',
        visibility: 'visible',
      },
    });
    expect(messages[1]).toMatchObject({
      role: 'user',
      content: 'follow-up',
      historyTimestampMs: Date.parse('2026-04-01T00:16:20.000Z'),
    });
  });

  it('replays interrupted assistant.event tool turns into canonical history', () => {
    const content = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T22:02:44.000Z',
        customType: 'assistant.request_start',
        data: { v: 1, requestId: 'turn-interrupted', trigger: 'user' },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T22:02:44.100Z',
        customType: 'assistant.user_audio',
        data: {
          payload: { transcription: 'no message will send a message after create' },
          turnId: 'turn-interrupted',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T22:02:44.200Z',
        customType: 'assistant.assistant_chunk',
        data: {
          payload: { text: 'Partial text that should not replay', phase: 'commentary' },
          turnId: 'turn-interrupted',
          responseId: 'resp-interrupted',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T22:02:44.300Z',
        customType: 'assistant.tool_call',
        data: {
          payload: {
            toolCallId: 'call-1',
            toolName: 'agents.js create',
            args: { prompt: 'ask questions', timeout: 300 },
          },
          turnId: 'turn-interrupted',
          responseId: 'resp-interrupted',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T22:02:45.000Z',
        customType: 'assistant.tool_result',
        data: {
          payload: {
            toolCallId: 'call-1',
            error: {
              code: 'tool_interrupted',
              message: 'Tool call was interrupted by the user',
            },
          },
          turnId: 'turn-interrupted',
          responseId: 'resp-interrupted',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T22:02:45.050Z',
        customType: 'assistant.interrupt',
        data: {
          payload: { reason: 'user_cancel' },
          turnId: 'turn-interrupted',
          responseId: 'resp-interrupted',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T22:02:45.060Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-interrupted', status: 'interrupted' },
      }),
    ].join('\n');

    const messages = buildCanonicalPiReplayMessages(content);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'no message will send a message after create',
      historyTimestampMs: Date.parse('2026-03-31T22:02:44.100Z'),
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '',
      historyTimestampMs: Date.parse('2026-03-31T22:02:44.300Z'),
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: {
            name: 'agents.js create',
            arguments: '{"prompt":"ask questions","timeout":300}',
          },
        },
      ],
    });
    expect(messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-1',
      historyTimestampMs: Date.parse('2026-03-31T22:02:45.000Z'),
    });
    expect(messages[2]?.content).toBe(
      '{"ok":false,"error":{"code":"tool_interrupted","message":"Tool call was interrupted by the user"}}',
    );
  });

  it('dedupes interrupted assistant.event replay once Pi message entries absorb the same tool turn', () => {
    const content = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:06:18.208Z',
        customType: 'assistant.user_message',
        data: {
          payload: { text: "what's the date?" },
          turnId: 'turn-date',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:06:35.712Z',
        customType: 'assistant.tool_call',
        data: {
          payload: {
            toolCallId: 'toolu_015Nb6oGWeBgkM83vjVhPTDa',
            toolName: 'bash',
            args: { command: 'date' },
          },
          turnId: 'turn-date',
          responseId: 'resp-date',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:06:35.723Z',
        customType: 'assistant.tool_result',
        data: {
          payload: {
            toolCallId: 'toolu_015Nb6oGWeBgkM83vjVhPTDa',
            result: {
              ok: true,
              output: 'Tue Mar 31 06:06:35 PM CDT 2026\n',
              exitCode: 0,
            },
          },
          turnId: 'turn-date',
          responseId: 'resp-date',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:06:39.314Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-date', status: 'interrupted' },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-31T23:06:39.312Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: "what's the date?" }],
          timestamp: 1774998378208,
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-31T23:06:39.312Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: "Today's date \u2014 let me check:" },
            {
              type: 'toolCall',
              id: 'toolu_015Nb6oGWeBgkM83vjVhPTDa',
              name: 'bash',
              arguments: { command: 'date' },
            },
          ],
          stopReason: 'toolUse',
          timestamp: 1774998393525,
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-31T23:06:39.312Z',
        message: {
          role: 'toolResult',
          toolCallId: 'toolu_015Nb6oGWeBgkM83vjVhPTDa',
          toolName: 'bash',
          content: [
            {
              type: 'text',
              text: '{"ok":true,"result":{"ok":true,"output":"Tue Mar 31 06:06:35 PM CDT 2026\\n","exitCode":0}}',
            },
          ],
          isError: false,
          timestamp: 1774998395723,
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-03-31T23:06:39.312Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Today is **Tuesday, March 31, 2026**.' }],
          stopReason: 'stop',
          timestamp: 1774998395723,
        },
      }),
    ].join('\n');

    const messages = buildCanonicalPiReplayMessages(content);

    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: "what's the date?",
      historyTimestampMs: 1774998378208,
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: "Today's date \u2014 let me check:",
      historyTimestampMs: 1774998393525,
      piSdkMessage: {
        role: 'assistant',
        stopReason: 'toolUse',
      },
    });
    expect(messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'toolu_015Nb6oGWeBgkM83vjVhPTDa',
      historyTimestampMs: 1774998395723,
    });
    expect(messages[3]).toMatchObject({
      role: 'assistant',
      content: 'Today is **Tuesday, March 31, 2026**.',
      historyTimestampMs: 1774998395723,
    });
  });

  it('synthesizes an interrupted tool result when a recorded interrupted turn ends before tool_result is written', () => {
    const content = [
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:40:00.000Z',
        customType: 'assistant.user_message',
        data: {
          payload: { text: 'check the date' },
          turnId: 'turn-orphan',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:40:00.100Z',
        customType: 'assistant.tool_call',
        data: {
          payload: {
            toolCallId: 'call-orphan',
            toolName: 'bash',
            args: { command: 'date' },
          },
          turnId: 'turn-orphan',
          responseId: 'resp-orphan',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:40:00.200Z',
        customType: 'assistant.interrupt',
        data: {
          payload: { reason: 'user_cancel' },
          turnId: 'turn-orphan',
          responseId: 'resp-orphan',
        },
      }),
      JSON.stringify({
        type: 'custom',
        timestamp: '2026-03-31T23:40:00.201Z',
        customType: 'assistant.request_end',
        data: { v: 1, requestId: 'turn-orphan', status: 'interrupted' },
      }),
    ].join('\n');

    const messages = buildCanonicalPiReplayMessages(content);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: 'check the date',
    });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call-orphan',
          type: 'function',
          function: {
            name: 'bash',
            arguments: '{"command":"date"}',
          },
        },
      ],
    });
    expect(messages[2]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call-orphan',
      historyTimestampMs: Date.parse('2026-03-31T23:40:00.200Z'),
    });
    expect(messages[2]?.content).toBe(
      '{"ok":false,"error":{"code":"tool_interrupted","message":"Tool call was interrupted before a result was recorded."}}',
    );
  });
});
