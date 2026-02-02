import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mariozechner/pi-ai', () => ({
  getModels: vi.fn(),
  getProviders: vi.fn(),
  streamSimple: vi.fn(),
}));

import { getModels, getProviders, streamSimple } from '@mariozechner/pi-ai';

import type { ChatCompletionMessage } from '../chatCompletionTypes';
import {
  buildPiContext,
  mapChatCompletionToolsToPiTools,
  resolvePiSdkModel,
  runPiSdkChatCompletionIteration,
} from './piSdkProvider';

beforeEach(() => {
  vi.resetAllMocks();
});

function createStream(events: unknown[], result: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    result: async () => result,
  };
}

describe('resolvePiSdkModel', () => {
  it('resolves provider/model using the default provider', () => {
    vi.mocked(getProviders).mockReturnValue(['openai', 'anthropic']);
    vi.mocked(getModels).mockImplementation((provider: string) => {
      if (provider === 'openai') {
        return [{ id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never];
      }
      return [];
    });

    const resolved = resolvePiSdkModel({
      modelSpec: 'gpt-4o-mini',
      defaultProvider: 'openai',
    });

    expect(resolved.providerId).toBe('openai');
    expect(resolved.modelId).toBe('gpt-4o-mini');
  });

  it('throws when provider is missing and no default provider is configured', () => {
    vi.mocked(getProviders).mockReturnValue(['openai']);
    vi.mocked(getModels).mockReturnValue([]);

    expect(() =>
      resolvePiSdkModel({
        modelSpec: 'gpt-4o-mini',
      }),
    ).toThrow(/provider\/model format/i);
  });
});

describe('buildPiContext', () => {
  it('converts messages and tool calls into Pi context', () => {
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: 'Hi there',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: { name: 'doThing', arguments: '{"foo": "bar"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call-1', content: '{"error":"bad"}' },
    ];

    const tools = mapChatCompletionToolsToPiTools([
      { type: 'function', function: { name: 'doThing', parameters: { type: 'object' } } },
    ]);

    const context = buildPiContext({
      messages,
      tools,
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
    });

    expect(context.systemPrompt).toBe('System prompt');
    expect(context.messages).toHaveLength(3);
    expect(context.tools).toEqual([
      { name: 'doThing', description: '', parameters: { type: 'object' } },
    ]);

    const assistantMessage = context.messages[1] as {
      role: string;
      content: Array<{ type: string; text?: string; id?: string; name?: string; arguments?: unknown }>;
    };
    expect(assistantMessage.role).toBe('assistant');
    expect(assistantMessage.content[0]).toEqual({ type: 'text', text: 'Hi there' });
    expect(assistantMessage.content[1]).toEqual({
      type: 'toolCall',
      id: 'call-1',
      name: 'doThing',
      arguments: { foo: 'bar' },
    });

    const toolResult = context.messages[2] as {
      role: string;
      toolCallId?: string;
      toolName?: string;
      isError?: boolean;
    };
    expect(toolResult.role).toBe('toolResult');
    expect(toolResult.toolCallId).toBe('call-1');
    expect(toolResult.toolName).toBe('doThing');
    expect(toolResult.isError).toBe(true);
  });

  it('preserves Pi SDK assistant content blocks (thinking + tool calls)', () => {
    const assistantMessage = {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Planning', thinkingSignature: 'rs_1' },
        { type: 'toolCall', id: 'fc_1', name: 'doThing', arguments: { ok: true } },
      ],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'toolUse',
      timestamp: Date.now(),
    } as const;

    const messages: ChatCompletionMessage[] = [
      {
        role: 'assistant',
        content: '',
        piSdkMessage: assistantMessage as never,
      },
      {
        role: 'tool',
        tool_call_id: 'fc_1',
        content: '{"ok":true}',
      },
    ];

    const context = buildPiContext({
      messages,
      tools: [],
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai-responses' } as never,
    });

    expect(context.messages).toHaveLength(2);
    const assistant = context.messages[0] as {
      role: string;
      content: Array<{ type: string; id?: string; name?: string; thinking?: string }>;
    };
    expect(assistant.role).toBe('assistant');
    expect(assistant.content[0]).toMatchObject({ type: 'thinking', thinking: 'Planning' });
    expect(assistant.content[1]).toMatchObject({ type: 'toolCall', id: 'fc_1', name: 'doThing' });

    const toolResult = context.messages[1] as { role: string; toolName?: string };
    expect(toolResult.role).toBe('toolResult');
    expect(toolResult.toolName).toBe('doThing');
  });
});

describe('runPiSdkChatCompletionIteration', () => {
  it('streams text, thinking, and tool calls', async () => {
    const events = [
      { type: 'thinking_start' },
      { type: 'thinking_delta', delta: 'Considering' },
      { type: 'thinking_end' },
      { type: 'text_delta', delta: 'Hello' },
      { type: 'text_delta', delta: ' world' },
      { type: 'toolcall_end', toolCall: { id: 'tc-1', name: 'doThing', arguments: { ok: 1 } } },
    ];

    vi.mocked(streamSimple).mockReturnValue(
      createStream(events, { stopReason: 'stop' }) as never,
    );

    const textDeltas: string[] = [];
    const toolStarts: Array<{ id: string; name: string }> = [];
    const toolInputs: Array<{ id: string; name: string; argumentsJson: string }> = [];
    let thinkingStarted = false;
    let thinkingDone = false;

    const result = await runPiSdkChatCompletionIteration({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      messages: [],
      tools: [],
      abortSignal: new AbortController().signal,
      onDeltaText: (delta) => {
        textDeltas.push(delta);
      },
      onThinkingStart: () => {
        thinkingStarted = true;
      },
      onThinkingDelta: (_delta) => undefined,
      onThinkingDone: (_text) => {
        thinkingDone = true;
      },
      onToolCallStart: (info) => {
        toolStarts.push(info);
      },
      onToolInputDelta: (info) => {
        toolInputs.push(info);
      },
    });

    expect(textDeltas).toEqual(['Hello', ' world']);
    expect(thinkingStarted).toBe(true);
    expect(thinkingDone).toBe(true);
    expect(toolStarts).toEqual([{ id: 'tc-1', name: 'doThing' }]);
    expect(toolInputs).toEqual([
      {
        id: 'tc-1',
        name: 'doThing',
        argumentsDelta: '{"ok":1}',
        argumentsJson: '{"ok":1}',
      },
    ]);
    expect(result.text).toBe('Hello world');
    expect(result.toolCalls).toEqual([
      { id: 'tc-1', name: 'doThing', argumentsJson: '{"ok":1}' },
    ]);
  });

  it('marks aborted when the stream stops with aborted', async () => {
    vi.mocked(streamSimple).mockReturnValue(
      createStream(
        [{ type: 'error', reason: 'aborted' }],
        { stopReason: 'aborted' },
      ) as never,
    );

    const result = await runPiSdkChatCompletionIteration({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      messages: [],
      tools: [],
      abortSignal: new AbortController().signal,
      onDeltaText: () => undefined,
    });

    expect(result.aborted).toBe(true);
  });

  it('throws on error stop reason', async () => {
    vi.mocked(streamSimple).mockReturnValue(
      createStream([], { stopReason: 'error', errorMessage: 'boom' }) as never,
    );

    await expect(
      runPiSdkChatCompletionIteration({
        model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
        messages: [],
        tools: [],
        abortSignal: new AbortController().signal,
        onDeltaText: () => undefined,
      }),
    ).rejects.toThrow(/boom/);
  });

  it('passes onPayload through and invokes onResponse', async () => {
    const assistantMessage = {
      role: 'assistant',
      content: [],
      api: 'openai-responses',
      provider: 'openai',
      model: 'gpt-4o-mini',
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: 'stop',
      timestamp: Date.now(),
    } as const;

    vi.mocked(streamSimple).mockReturnValue(
      createStream([], assistantMessage) as never,
    );

    const onPayload = vi.fn();
    const onResponse = vi.fn();

    await runPiSdkChatCompletionIteration({
      model: { id: 'gpt-4o-mini', provider: 'openai', api: 'openai' } as never,
      messages: [],
      tools: [],
      abortSignal: new AbortController().signal,
      onDeltaText: () => undefined,
      onPayload,
      onResponse,
    });

    const options = vi.mocked(streamSimple).mock.calls[0]?.[2] as {
      onPayload?: (payload: unknown) => void;
    };
    options.onPayload?.({ foo: 'bar' });
    expect(onPayload).toHaveBeenCalledWith({ foo: 'bar' });

    expect(onResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        message: assistantMessage,
        text: '',
        toolCalls: [],
        thinkingText: '',
        aborted: false,
      }),
    );
  });
});
